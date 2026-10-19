import ExcelJS from 'exceljs'
import type { ModelResult, NomenclatureItem, Params, ScenarioMatrix, ServiceSpec } from '../model/types'
import { YEAR_KEYS } from '../model/types'
import { runModel } from '../model/run'
import { computeSensitivity, computeTornado } from '../model/sensitivity'
import { landedCost } from '../model/opex'
import { capexWeights } from '../model/cashflow'
import { serviceLaborShare, laborPct } from '../model/spec'

// Полностью живая выгрузка модели в .xlsx (защита в Excel):
// — каждый вход модели — синяя editable-ячейка на листах-входах; формулы
//   ссылаются на них, бизнес-константы в формулах не зашиты;
// — цепочка живая: Допущения/Сценарии/Модули/Сезонность/Штат/Спеки/
//   Номенклатура → Драйверы/Услуги/Списание (расчётные листы) →
//   Выручка/OPEX/ФОТ/Налоги → PnL → Cash-Flow → NPV/IRR/KPI;
// — каждая формула несёт кешированный result ядра — значения видны до
//   пересчёта; паритет проверяется tests/excel-parity.test.ts;
// — стилистика фин. модели: синий = вход, чёрный = формула,
//   зелёный = межлистовая ссылка; Arial 10, фриз шапки.

const ARIAL = { name: 'Arial', size: 10 } as const
const NAVY = 'FF1A2334'
const SEC_BG = 'FFD9E2F0'
const BLUE = 'FF1F4ECC' // входы и драйверы
const GREEN = 'FF1E7B34' // ссылки на другие листы
const GREY = 'FF8A97B0' // справочные/расчётные строки
const FMT_EUR = '#,##0;(#,##0);"–"'
const FMT_EUR2 = '#,##0.00;(#,##0.00);"–"'
const FMT_PCT = '0.0%'
const FMT_INT = '#,##0'

const fill = (argb: string) =>
  ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
const thinTop = { top: { style: 'thin' as const } }
const dblTop = { top: { style: 'double' as const } }

// Колонка → буква (1 → A)
const L = (n: number) => {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

type FontStyle = 'input' | 'calc' | 'link' | 'note'
const FONT: Record<FontStyle, Partial<ExcelJS.Font>> = {
  input: { ...ARIAL, color: { argb: BLUE } },
  calc: { ...ARIAL },
  link: { ...ARIAL, color: { argb: GREEN } },
  note: { ...ARIAL, color: { argb: GREY } },
}

function headerRow(ws: ExcelJS.Worksheet, r = 1) {
  ws.getRow(r).eachCell((c) => {
    c.font = { ...ARIAL, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = fill(NAVY)
    c.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  ws.getRow(r).height = 18
}

function freezeFirst(ws: ExcelJS.Worksheet) {
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]
}

// Ячейка: число, или формула с кешированным результатом, или пусто
type NumCell = number | { f: string; v: number } | null

function putCell(
  ws: ExcelJS.Worksheet, r: number, c: number, v: NumCell,
  fmt = FMT_EUR, style: FontStyle = 'calc', bold = false,
) {
  const cell = ws.getCell(r, c)
  if (v == null) return
  cell.value = typeof v === 'number' ? v : { formula: v.f, result: v.v }
  cell.numFmt = fmt
  cell.font = { ...FONT[style], bold: bold || FONT[style].bold }
}

// Строка помесячной таблицы: значения ядра и/или формулы
interface MonthRow {
  label: string
  cells: NumCell[]
  fmt?: string
  style?: FontStyle
  bold?: boolean
  section?: boolean
  border?: 'top' | 'double'
}

function monthSheet(
  wb: ExcelJS.Workbook, name: string, labels: string[], rows: MonthRow[],
  tabColor?: string,
): { ws: ExcelJS.Worksheet; rows: Map<string, number> } {
  const ws = wb.addWorksheet(name)
  if (tabColor) ws.properties.tabColor = { argb: tabColor }
  ws.addRow(['Статья', ...labels])
  headerRow(ws)
  freezeFirst(ws)
  ws.getColumn(1).width = 36
  const rowMap = new Map<string, number>()
  for (const rd of rows) {
    const r = ws.addRow([rd.label])
    rowMap.set(rd.label, r.number)
    ws.getCell(r.number, 1).font = {
      ...ARIAL,
      bold: rd.bold || !!rd.section,
      italic: !!rd.section && !rd.bold,
    }
    if (rd.section) r.eachCell((c) => (c.fill = fill(SEC_BG)))
    if (rd.border) r.eachCell((c) => (c.border = rd.border === 'top' ? thinTop : dblTop))
    rd.cells.forEach((v, i) => {
      if (rd.style) putCell(ws, r.number, i + 2, v, rd.fmt ?? FMT_EUR, rd.style, rd.bold)
      else {
        const cell = ws.getCell(r.number, i + 2)
        if (v == null) return
        cell.value = typeof v === 'number' ? v : { formula: v.f, result: v.v }
        cell.numFmt = rd.fmt ?? FMT_EUR
        const isLink = typeof v === 'object' && v.f.includes('!')
        cell.font = { ...ARIAL, bold: rd.bold, color: { argb: isLink ? GREEN : 'FF000000' } }
      }
    })
  }
  labels.forEach((_, i) => (ws.getColumn(i + 2).width = 10))
  return { ws, rows: rowMap }
}

const nums = (arr: number[]): NumCell[] => arr
const f = (formula: string, v: number): NumCell => ({ f: formula, v })
const ymIdx = (iso: string) => {
  const [y, m] = iso.slice(0, 7).split('-').map(Number)
  return y * 12 + m
}
const normRoleJs = (s: string) => {
  const n = s.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim()
  return n === 'пармейстер' ? 'пармастер' : n
}

export async function exportWorkbook(
  params: Params,
  matrix: ScenarioMatrix,
  items: NomenclatureItem[],
  services: ServiceSpec[],
  scenario?: string,
): Promise<Blob> {
  const scen0 = scenario ?? params.meta.scenario
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AURA HILLS Model'
  wb.calcProperties.fullCalcOnLoad = true // при открытии пересчитать живые формулы
  const results = matrix.names.map((n) => runModel(params, matrix, items, services, n))
  const r = results[matrix.names.indexOf(scen0)] ?? results[1]
  const scen = r.scenario
  const ops = params.meta.opsMonths
  const capM = r.cashflow.filter((m) => !m.isOps).length
  const cfTotal = capM + ops
  const openIdxBase = ymIdx(params.meta.openingDate)
  const constrIdx = ymIdx(params.meta.constructionStart)
  const labels = Array.from({ length: ops }, (_, i) => {
    const t = openIdxBase - 1 + i + scen.constructionDelayMonths
    return `${String((t % 12) + 1).padStart(2, '0')}.${Math.floor(t / 12)}`
  })
  const sCurve = capexWeights({ ...params, meta: { ...params.meta, capexMonths: capM } })
  const landCost = params.land.mode === 'purchase' ? params.land.purchaseCost : 0
  const modules = [...params.modules].sort((a, b) => a.id - b.id)
  const p2Mods = modules.filter((m) => (m.phase ?? 1) === 2)
  const rentalSpecs = services.filter((s) => s.direction === 'Аренда бани')
  const specItems: { specIdx: number; it: ServiceSpec['items'][number] }[] = []
  services.forEach((s, si) => s.items.forEach((it) => specItems.push({ specIdx: si, it })))
  const specCodes = new Set(
    services.flatMap((s) => s.items.filter((i) => i.kind === 'material' && i.code).map((i) => i.code!)),
  )
  // кеши ядра для результирующих значений формул
  const serviceLaborShareCached = (s: ServiceSpec) => serviceLaborShare(s, params)
  const laborPctCached = (it: ServiceSpec['items'][number], price: number) => laborPct(it, price, params)
  const nSpec = services.length
  const nMod = modules.length
  const nItems = items.length
  const nSpecItems = specItems.length
  const nRoles = params.fot.roles.length
  const phases = params.fot.phases ?? []
  const calYears = [...new Set(r.revenue.map((m) => Math.floor((openIdxBase + scen.constructionDelayMonths - 1 + m.yearIdx * 0 + r.revenue.indexOf(m)) / 12)))]
  void calYears
  // календарные годы операционного горизонта (для CIT/GESY годовых блоков)
  const calYearList: number[] = []
  {
    const firstYr = Math.floor((openIdxBase + scen.constructionDelayMonths - 1) / 12)
    const lastYr = Math.floor((openIdxBase + scen.constructionDelayMonths - 1 + ops - 1) / 12)
    for (let y = firstYr; y <= lastYr; y++) calYearList.push(y)
  }
  // статьи переменных OPEX (нормативные + спековые) — как в computeOpex
  const opexNormItems = items.filter(
    (it) => it.use !== 'CAPEX' && it.opexArticle != null && it.normBase != null && !specCodes.has(it.code),
  )
  const specArticlesSet = new Set<string>()
  for (const it of items)
    if (specCodes.has(it.code)) specArticlesSet.add(it.opexArticle ?? it.category ?? 'Материалы услуг')
  const specArticleOf = (code: string) => {
    const m = items.find((x) => x.code === code)
    return m?.opexArticle ?? m?.category ?? 'Материалы услуг'
  }
  const varArticles = [
    ...new Set([...opexNormItems.map((it) => it.opexArticle!), ...specArticlesSet]),
  ]
  // кешированные производные (для result-значений формул)
  const n0v = modules.filter((m) => m.status === 'Активен' && (m.phase ?? 1) === 1 && ymIdx(m.launchDate) <= openIdxBase + scen.constructionDelayMonths).length
  const fixedStartV =
    params.opexFixed.reduce((s, fx) => s + fx.base * (fx.perModule ? n0v : 1) * (fx.energy ? scen.energyCostMult : 1), 0) +
    (params.it.enabled ? params.it.opex.reduce((s, x) => s + x.base, 0) : 0)
  const baseSal0v =
    params.fot.count.reduce((s, c2, i) => s + c2 * (params.fot.salary[i] ?? 0), 0) +
    (params.it.enabled ? params.it.curator : 0) +
    (params.fb?.enabled ? (params.fb.cookCount ?? 0) * (params.fb.cookSalary ?? 0) : 0)

  // ═══ КАРТА ЯЧЕЕК: ключ → абсолютная ссылка 'Лист'!$X$n ═══
  const C: Record<string, string> = {}
  const Q = (s: string) => `'${s}'`
  // Поздние формулы: ставятся после создания всех листов-источников
  const FIX: { sheet: string; r: number; c: number; f: string; v: number; fmt?: string; style?: FontStyle }[] = []
  // Лист «Сценарии»: жёсткая раскладка строк (блоки по 5 лет + скаляры) —
  // известна до создания листа, чтобы Допущения могли ссылаться сразу.
  const SCr = {
    baths: 2, steam: 7, massage: 12, extra: 17, glamping: 22, membersMonth: 27,
    publicBath: 32, restaurant: 37,
    bathsP2: 42, steamP2: 47, massageP2: 52, extraP2: 57,
    priceGrowth: 63, capexAdj: 64, rampMonths: 65, uptake: 66, delay: 67, energyMult: 68,
  }
  // Резолвленные сценарные значения через INDEX(блок, №года, №сценария)
  const scenAt = (row: number) => `INDEX('Сценарии'!$B$${row}:$D$${row + 4},{{Y}}+1,${'{'}SCENIDX{'}'})` // unused
  void scenAt

  // Обложка создаётся первой (порядок листов), заполняется в конце —
  // ей нужны готовые ссылки на остальные листы.
  const wsCover = wb.addWorksheet('Обложка')

  // ═══ ДОПУЩЕНИЯ — скалярные входы + таблицы ═══
  {
    const ws = wb.addWorksheet('Допущения')
    ws.properties.tabColor = { argb: 'FF4472C4' }
    ws.getColumn(1).width = 40
    ws.getColumn(2).width = 15
    ws.getColumn(3).width = 55
    ws.addRow(['Параметр', 'Значение', 'Комментарий'])
    headerRow(ws)
    freezeFirst(ws)
    const inp = (key: string, label: string, v: number | string, note = '', fmt?: string) => {
      const row = ws.addRow([label, v, note])
      ws.getCell(row.number, 1).font = { ...ARIAL }
      const vc = ws.getCell(row.number, 2)
      vc.font = (typeof v === 'number' ? FONT.input : { ...ARIAL, color: { argb: BLUE } }) as ExcelJS.Font
      if (fmt) vc.numFmt = fmt
      ws.getCell(row.number, 3).font = FONT.note as ExcelJS.Font
      C[key] = `'Допущения'!$B$${row.number}`
      return row.number
    }
    const calc = (key: string, label: string, fo: string, v: number, note = '', fmt?: string, style: FontStyle = 'calc') => {
      const row = ws.addRow([label, '', note])
      ws.getCell(row.number, 1).font = { ...ARIAL }
      const vc = ws.getCell(row.number, 2)
      vc.value = { formula: fo, result: v }
      vc.font = FONT[style] as ExcelJS.Font
      if (fmt) vc.numFmt = fmt
      ws.getCell(row.number, 3).font = FONT.note as ExcelJS.Font
      C[key] = `'Допущения'!$B$${row.number}`
      return row.number
    }
    const flag = (key: string, label: string, on: boolean, note = '') =>
      inp(key, label, on ? 'Да' : 'Нет', `${note}; «Да»/«Нет»`)
    const F = (key: string) => `(${C[key]}="Да")`

    // ─── Мета и таймлайн ───
    ws.addRow(['МОДЕЛЬ И ТАЙМЛАЙН']).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    inp('modelName', 'Модель', 'AURA HILLS', 'название попадает на Обложку')
    inp('scenario', 'Активный сценарий', scen0, `варианты: ${matrix.names.join(' / ')}`)
    calc('scenIdx', '№ сценария в матрице', `MATCH(${C.scenario},'Сценарии'!$B$1:$D$1,0)`, matrix.names.indexOf(scen0) + 1)
    inp('mode', 'Пакетный режим', params.meta.mode, 'Да/Нет: пакетный форсит uptake = 100%')
    calc('pkg', 'Пакетный флаг (0/1)', `IF(${C.mode}="Да",1,0)`, params.meta.mode === 'Да' ? 1 : 0)
    inp('vatMode', 'Режим НДС', params.meta.vatMode, 'Гросс / С возмещением')
    calc('reimb', 'Возмещение НДС (0/1)', `IF(${C.vatMode}="С возмещением",1,0)`, params.meta.vatMode === 'С возмещением' ? 1 : 0)
    inp('constrY', 'Стройка: год старта', Number(params.meta.constructionStart.slice(0, 4)), '', '0')
    inp('constrM', 'Стройка: месяц старта', Number(params.meta.constructionStart.slice(5, 7)), '', '0')
    calc('constrIdx', 'Стройка: индекс месяца (год×12+мес)', `${C.constrY}*12+${C.constrM}`, constrIdx, '', '0')
    inp('openY', 'Открытие: год', Number(params.meta.openingDate.slice(0, 4)), '', '0')
    inp('openM', 'Открытие: месяц', Number(params.meta.openingDate.slice(5, 7)), '', '0')
    calc('openIdx', 'Открытие: индекс месяца', `${C.openY}*12+${C.openM}`, openIdxBase, '', '0')
    inp('capMbase', 'Месяцев стройки (без задержки)', params.meta.capexMonths, 'задержка сценария добавляется сверху', '0')
    const delayRow = ws.addRow(['Задержка стройки сценария, мес', '', 'матрица Сценарии × активный сценарий']).number
    ws.getCell(delayRow, 1).font = { ...ARIAL }
    ws.getCell(delayRow, 3).font = FONT.note as ExcelJS.Font
    C.delay = `'Допущения'!$B$${delayRow}`
    FIX.push({ sheet: 'Допущения', r: delayRow, c: 2, f: `INDEX('Сценарии'!$B$${SCr.delay}:$D$${SCr.delay},1,${C.scenIdx})`, v: scen.constructionDelayMonths, fmt: '0', style: 'link' })
    calc('capM', 'Месяцев стройки ИТОГО (с задержкой)', `${C.capMbase}+${C.delay}`, capM, '', '0')
    inp('ops', 'Месяцев операций', ops, '', '0')
    calc('openIdxEff', 'Открытие: индекс с учётом задержки', `${C.openIdx}+${C.delay}`, openIdxBase + scen.constructionDelayMonths, '', '0')

    // ─── Общие ───
    ws.addRow(['ОБЩИЕ']).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    inp('inflation', 'Инфляция, годовых', params.general.inflation, 'индексация OPEX/ФОТ по календарным годам операций', FMT_PCT)
    if (params.general.waccMode === 'capm') {
      calc('wacc', 'WACC (CAPM), годовых', `'WACC'!$B$8`, r.kpis.wacc, 'лист WACC; помесячно (1+WACC)^(1/12)−1', FMT_PCT, 'link')
    } else {
      inp('wacc', 'WACC, годовых', params.general.wacc, 'эффективная годовая; помесячно (1+WACC)^(1/12)−1', FMT_PCT)
    }

    // ─── Сценарные скаляры (резолвятся из матрицы по активному сценарию) ───
    ws.addRow(['СЦЕНАРИЙ — резолвленные значения']).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    calc('priceGrowth', 'Рост цен, годовых', `INDEX('Сценарии'!$B$${SCr.priceGrowth}:$D$${SCr.priceGrowth},1,${C.scenIdx})`, scen.priceGrowth, '', FMT_PCT, 'link')
    calc('capexAdj', 'Буфер CAPEX сценария', `INDEX('Сценарии'!$B$${SCr.capexAdj}:$D$${SCr.capexAdj},1,${C.scenIdx})`, scen.capexAdj, '', FMT_PCT, 'link')
    calc('rampM', 'Выход на план, мес', `MAX(1,INDEX('Сценарии'!$B$${SCr.rampMonths}:$D$${SCr.rampMonths},1,${C.scenIdx}))`, scen.rampMonths, '', '0', 'link')
    calc('uptake', 'Доля реализации услуг (uptake)', `INDEX('Сценарии'!$B$${SCr.uptake}:$D$${SCr.uptake},1,${C.scenIdx})`, scen.uptake, '', FMT_PCT, 'link')
    calc('uptakeEff', 'Uptake эффективный (пакет → 100%)', `IF(${C.pkg}=1,1,${C.uptake})`, scen.effectiveUptake, '', FMT_PCT, 'link')
    calc('energyMult', 'Множитель энергозатрат', `INDEX('Сценарии'!$B$${SCr.energyMult}:$D$${SCr.energyMult},1,${C.scenIdx})`, scen.energyCostMult, '', '0.00', 'link')

    // ─── Услуги, депозит, цены ───
    ws.addRow(['УСЛУГИ И ЦЕНЫ']).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    inp('dm', 'Мультипликатор спроса', params.service.demandMult)
    flag('svcLoads', 'Сценарные векторы услуг включены', params.service.serviceLoads, 'Нет → uptake применяется напрямую')
    inp('upgradeShare', 'Доля апгрейдов сверх депозита', params.service.upgradeShare, '', FMT_PCT)
    inp('walletExtraShare', 'Доля кошелька на доп.услуги', params.service.walletExtraShare, '', FMT_PCT)
    inp('depBase', 'Депозит на гостя, €', params.deposit.base, '', FMT_EUR)
    inp('depSteam', 'Депозит на парение, €', params.deposit.steamBase, '', FMT_EUR)
    inp('depMass', 'Депозит на массаж, €', params.deposit.massageBase, '', FMT_EUR)
    calc('baseW', 'Вес пакета услуг (для сервисного чека)',
      `(1-${C.walletExtraShare})*(${C.depSteam}+${C.depMass})+${C.walletExtraShare}*${C.depBase}`,
      (1 - params.service.walletExtraShare) * (params.deposit.steamBase + params.deposit.massageBase) + params.service.walletExtraShare * params.deposit.base, '', FMT_EUR2)
    calc('shSteam', 'Доля сервисного чека → парения', `IF(${C.baseW}>0,(1-${C.walletExtraShare})*${C.depSteam}/${C.baseW},0)`, 0, '', '0.000', 'link')
    calc('shMass', 'Доля сервисного чека → массаж', `IF(${C.baseW}>0,(1-${C.walletExtraShare})*${C.depMass}/${C.baseW},0)`, 0, '', '0.000', 'link')
    calc('shExtra', 'Доля сервисного чека → допы', `IF(${C.baseW}>0,${C.walletExtraShare}*${C.depBase}/${C.baseW},0)`, 0, '', '0.000', 'link')
    inp('pMemberM', 'Членство месячное, €', params.prices.membershipMonth, '', FMT_EUR)
    inp('pMemberY', 'Членство годовое, €', params.prices.membershipYear, '', FMT_EUR)
    inp('pCert', 'Сертификат, €', params.prices.certificate, '', FMT_EUR)
    inp('pGlampS', 'Глэмпинг малый, €/ночь', params.prices.glampSmall, '', FMT_EUR)
    inp('pGlampB', 'Глэмпинг большой, €/ночь', params.prices.glampBig, '', FMT_EUR)
    inp('pFB', 'F&B на гостя, €', params.prices.fbPerGuest, '', FMT_EUR)

    // ─── Слои (тоглы и их параметры) ───
    ws.addRow(['СЛОИ ВЫРУЧКИ']).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    flag('membersOn', 'Членство клуба', !!params.members.enabled)
    flag('consume', 'Члены занимают слоты', !!params.members.consumeSlots)
    inp('visits', 'Визитов члена/мес', params.members.visitsPerMonth, '', '0.0')
    inp('party', 'Размер компании члена', params.members.partySize, '', '0.0')
    inp('peak', 'Доля пиковых слотов (вытеснение)', params.members.peakShare ?? 1, '', FMT_PCT)
    inp('memberSpend', 'Сервисный чек члена, €', params.members.serviceSpendPerVisit ?? 0, '', FMT_EUR)
    flag('certsOn', 'Сертификаты', !!params.units.certsEnabled)
    inp('certsPerMonth', 'Сертификатов в месяц', params.units.certsPerMonth, '', '0')
    inp('presaleMonths', 'Пресейл, мес до открытия', params.units.presaleMonths, '', '0')
    flag('presaleDef', 'Пресейл deferred (распознаётся)', params.units.presaleMode === 'deferred')
    inp('recogMonths', 'Прогорание пресейла, мес', params.units.presaleRecognizeMonths, '', '0')
    inp('certRedem', 'Погашение сертификата', params.units.certRedemptionRate ?? 0, '', FMT_PCT)
    inp('certGuests', 'Гостей на сертификат', params.units.certGuestsPerCert ?? 1, '', '0.0')
    {
      const rr = ws.addRow(['Годовые членства, план по годам', '', 'y1..y5'])
      ws.getCell(rr.number, 1).font = { ...ARIAL }
      ws.getCell(rr.number, 3).font = FONT.note as ExcelJS.Font
      params.units.annualMembersPlan.forEach((v, i) => putCell(ws, rr.number, 2 + i, v, '0', 'input'))
      C.annualPlan = `'Допущения'!$B$${rr.number}:$F$${rr.number}`
    }
    calc('presaleMonthly', 'Пресейл, €/мес',
      `IF(${C.certsOn}="Да",${C.certsPerMonth}*${C.pCert},0)+IF(${C.membersOn}="Да",INDEX('Сценарии'!$B$${SCr.membersMonth}:$D$${SCr.membersMonth + 4},1,${C.scenIdx})*${C.pMemberM}+INDEX(${C.annualPlan},1,1)*${C.pMemberY}/12,0)`,
      scen.presaleMonthly, 'сертификаты + мес. членства год 1 + годовые/12', FMT_EUR, 'link')
    flag('glampOn', 'Глэмпинг', !!params.glamping?.enabled)
    inp('glampSmallN', 'Глэмпингов малых', params.units.glampSmall, '', '0')
    inp('glampBigN', 'Глэмпингов больших', params.units.glampBig, '', '0')
    flag('fbOn', 'F&B', !!params.fb?.enabled)
    inp('fbFoodPct', 'Food-cost F&B', params.fb?.foodCostPct ?? 0, '', FMT_PCT)
    inp('fbCook', 'Поваров (штат)', params.fb?.cookCount ?? 0, '', '0')
    inp('fbCookSal', 'Оклад повара, €', params.fb?.cookSalary ?? 0, '', FMT_EUR)
    flag('pbOn', 'Общественная баня (оч.2)', !!params.publicBath?.enabled)
    inp('pbTicket', 'Билет обществ. бани, €', params.publicBath?.ticketEur ?? 0, '', FMT_EUR)
    inp('pbCap', 'Пропускная, чел/день', params.publicBath?.capacity ?? 0, '', '0')
    inp('pbY', 'Запуск обществ. бани: год', Number((params.publicBath?.launchDate ?? '2031-01').slice(0, 4)), '', '0')
    inp('pbM', 'Запуск обществ. бани: месяц', Number((params.publicBath?.launchDate ?? '2031-01').slice(5, 7)), '', '0')
    calc('pbLaunchIdx', 'Запуск обществ. бани: индекс', `${C.pbY}*12+${C.pbM}`, ymIdx(params.publicBath?.launchDate ?? '2031-01'), '', '0')
    inp('pbSpend', 'Сервисный чек посетителя, €', params.publicBath?.serviceSpendPerVisit ?? 0, '', FMT_EUR)
    flag('restOn', 'Ресторан (оч.2)', params.restaurant?.enabled !== false)
    inp('restSeats', 'Ресторан: мест', params.restaurant?.seats ?? 0, '', '0')
    inp('restTurns', 'Ресторан: оборотов/день', params.restaurant?.turnsPerDay ?? 0, '', '0.0')
    inp('restCheck', 'Ресторан: средний чек, €', params.restaurant?.avgCheck ?? 0, '', FMT_EUR)
    inp('restFoodPct', 'Ресторан: food-cost', params.restaurant?.foodCostPct ?? 0, '', FMT_PCT)
    flag('otaOn', 'OTA-канал глэмпинга', !!params.glampOta?.enabled)
    inp('otaShare', 'OTA: доля ночей', params.glampOta?.share ?? 0, '', FMT_PCT)
    inp('otaComm', 'OTA: комиссия', params.glampOta?.commissionPct ?? 0, '', FMT_PCT)

    // ─── Земля, IT, прочие слои ───
    ws.addRow(['ЗЕМЛЯ / IT / СТРОЙКА']).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    inp('landMode', 'Земля: режим', params.land.mode, 'lease — аренда; purchase — покупка')
    calc('landLeaseF', 'Земля: аренда (0/1)', `IF(${C.landMode}="lease",1,0)`, params.land.mode === 'lease' ? 1 : 0)
    calc('landBuyF', 'Земля: покупка (0/1)', `IF(${C.landMode}="purchase",1,0)`, params.land.mode === 'purchase' ? 1 : 0)
    inp('landRent', 'Аренда земли, €/мес', params.land.rentMonthly, '', FMT_EUR)
    inp('landCost', 'Земля (покупка), €', params.land.purchaseCost, 'не амортизируется', FMT_EUR)
    flag('itOn', 'IT / АСУ', !!params.it.enabled)
    inp('itCurator', 'IT-куратор, €/мес (оклад)', params.it.curator, '', FMT_EUR)
    flag('laundryOn', 'Своя прачечная', !!params.laundry?.enabled, 'спековый текстиль по ownPrice')
    flag('preopenOn', 'Pre-opening расходы', !!params.preopen?.enabled)
    inp('preopenMonths', 'Pre-opening, мес', params.preopen?.months ?? 0, '', '0')
    flag('maintOn', 'Maintenance CAPEX', !!params.capexMaint?.enabled)
    inp('maintPct', 'Maint CAPEX, % базы/год', params.capexMaint?.pctPerYear ?? 0, '', FMT_PCT)
    inp('maintStart', 'Maint CAPEX: с года', params.capexMaint?.startYear ?? 1, '', '0')
    inp('maintLumpYear', 'Капремонт: год', params.capexMaint?.lumpYear ?? 0, '', '0')
    inp('maintLump', 'Капремонт: сумма, €', params.capexMaint?.lumpEur ?? 0, '', FMT_EUR)

    // ─── Очередь 2 ───
    ws.addRow(['ОЧЕРЕДЬ 2']).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    inp('p2Y', 'Оч.2 стройка: год', Number((params.phase2?.constructionStart ?? '2029-01').slice(0, 4)), '', '0')
    inp('p2M', 'Оч.2 стройка: месяц', Number((params.phase2?.constructionStart ?? '2029-01').slice(5, 7)), '', '0')
    calc('p2StartIdx', 'Оч.2 стройка: индекс', `${C.p2Y}*12+${C.p2M}`, ymIdx(params.phase2?.constructionStart ?? '2029-01'), '', '0')
    inp('p2Months', 'Оч.2: месяцев стройки', params.phase2?.months ?? 0, '', '0')
    inp('p2Adj', 'Оч.2: буфер CAPEX', params.phase2?.capexAdj ?? 0, '', FMT_PCT)
    inp('p2Ramp', 'Оч.2: ramp-up, мес', params.phase2?.rampMonths ?? 1, '', '0')
    flag('p2FundEq', 'Оч.2: финансирование equity', params.phase2?.funding === 'equity')

    // ─── Процентные OPEX и налоги ───
    ws.addRow(['OPEX % И НАЛОГИ']).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    inp('pctAcq', 'Эквайринг, % выручки', params.opexPct.acquiring, '', FMT_PCT)
    inp('pctMaint', 'Обслуживание/ремонт, % выручки', params.opexPct.maintenance, '', FMT_PCT)
    inp('cit', 'CIT', params.taxes.cit, 'реформа Кипра 2026: 15%', FMT_PCT)
    inp('vatStd', 'НДС стандартный', params.taxes.vatStd, '', FMT_PCT)
    inp('vatGlamp', 'НДС глэмпинг', params.taxes.vatGlamp, '', FMT_PCT)
    inp('vatFb', 'НДС F&B/ресторан', params.taxes.vatFb, '', FMT_PCT)
    inp('vatInput', 'НДС входной', params.taxes.vatInput, '', FMT_PCT)
    flag('vatQ', 'НДС квартальная уплата', !!params.taxes.vatQuarterly)
    inp('er', 'Взносы работодателя', params.taxes.employerRate, '', FMT_PCT)
    inp('sdc', 'SDC на дивиденды', params.taxes.sdc, 'реформа 2026: 5% резидентам-домицилам', FMT_PCT)
    inp('gesy', 'GESY', params.taxes.gesy, '', FMT_PCT)
    inp('gesyCap', 'GESY: потолок базы, €/год', params.taxes.gesyCap ?? 0, '', FMT_EUR)

    // ─── Амортизация ───
    ws.addRow(['АМОРТИЗАЦИЯ']).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    ws.addRow(['Группа', 'Доля', 'Срок, лет']).font = { ...ARIAL, bold: true }
    const amortRows: number[] = []
    params.amort.groups.forEach((g, i) => {
      const row = ws.addRow([g, params.amort.shares[i], params.amort.years[i]])
      ws.getCell(row.number, 2).font = FONT.input as ExcelJS.Font
      ws.getCell(row.number, 2).numFmt = FMT_PCT
      ws.getCell(row.number, 3).font = FONT.input as ExcelJS.Font
      amortRows.push(row.number)
    })
    calc('amortRate', 'Ставка амортизации, доля/мес',
      amortRows.map((x) => `$B$${x}/($C$${x}*12)`).join('+'),
      params.amort.shares.reduce((s, sh, i) => s + sh / (params.amort.years[i] * 12), 0), '', '0.000000', 'link')
    flag('taxDeprOn', 'Налоговая амортизация отдельно', !!params.taxDepr?.enabled)
    ws.addRow(['Налоговая аморт.: сроки по группам', '', 'конструкции/оборудование/прочее']).font = { ...ARIAL, bold: true }
    {
      const rr = ws.addRow(['Сроки, лет', ...(params.taxDepr?.years ?? [])])
      ws.getCell(rr.number, 1).font = { ...ARIAL }
      ;(params.taxDepr?.years ?? []).forEach((v, i) => {
        const cell = ws.getCell(rr.number, 2 + i)
        cell.font = FONT.input as ExcelJS.Font
        cell.numFmt = '0'
        cell.value = v
      })
      C.taxDeprYears = `'Допущения'!$B$${rr.number}:$D$${rr.number}`
    }
    calc('taxDeprRate', 'Налоговая ставка аморт., доля/мес',
      amortRows.map((x, i) => `$B$${x}/(${L(2 + i)}$${Number((C.taxDeprYears ?? '').match(/\$(\d+):/)![1])}*12)`).join('+'),
      params.amort.shares.reduce((s, sh, i) => s + sh / ((params.taxDepr?.years[i] ?? params.amort.years[i]) * 12), 0), '', '0.000000', 'link')
    calc('p2TaxRate', 'Ставка аморт. оч.2 (по режиму)',
      `IF(${C.taxDeprOn}="Да",${C.taxDeprRate},${C.amortRate})`,
      (params.taxDepr?.enabled ? params.amort.shares.reduce((s, sh, i) => s + sh / ((params.taxDepr?.years[i] ?? params.amort.years[i]) * 12), 0)
        : params.amort.shares.reduce((s, sh, i) => s + sh / (params.amort.years[i] * 12), 0)), '', '0.000000', 'link')

    // ─── Партнёры ───
    ws.addRow(['ПАРТНЁРЫ']).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    ws.addRow(['Имя', 'Доля', 'Статус', 'Резидент-домицилий (0/1)']).font = { ...ARIAL, bold: true }
    const partnerRows: number[] = []
    params.partners.names.forEach((n, i) => {
      const row = ws.addRow([n, params.partners.shares[i], params.partners.statuses[i], ''])
      ws.getCell(row.number, 2).font = FONT.input as ExcelJS.Font
      ws.getCell(row.number, 2).numFmt = FMT_PCT
      ws.getCell(row.number, 3).font = { ...ARIAL, color: { argb: BLUE } }
      const rc = ws.getCell(row.number, 4)
      rc.value = { formula: `IF($C${row.number}="Резидент Кипра (17%)",1,0)`, result: params.partners.statuses[i] === 'Резидент Кипра (17%)' ? 1 : 0 }
      rc.font = { ...ARIAL }
      partnerRows.push(row.number)
    })
    C.partnerShares = `'Допущения'!$B$${partnerRows[0]}:$B$${partnerRows[partnerRows.length - 1]}`
    C.partnerRes = `'Допущения'!$D$${partnerRows[0]}:$D$${partnerRows[partnerRows.length - 1]}`
    inp('corpMgmt', 'Доля менеджмента (корп.)', params.partners.corporate.mgmt, '', FMT_PCT)
    inp('corpReserve', 'Резерв корпоративный', params.partners.corporate.reserve, '', FMT_PCT)
    calc('distShare', 'Доля распределения ИТОГО',
      `SUM(${C.partnerShares})+${C.corpMgmt}`,
      params.partners.shares.reduce((a, b) => a + b, 0) + params.partners.corporate.mgmt, '', FMT_PCT, 'link')

    // ─── Постоянные OPEX ───
    ws.addRow(['ПОСТОЯННЫЕ OPEX']).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    ws.addRow(['Статья', 'База, €/мес', 'на модуль (0/1)', 'энергия (0/1)', '% выручки']).font = { ...ARIAL, bold: true }
    const opexFixedRows: number[] = []
    params.opexFixed.forEach((fx) => {
      const row = ws.addRow([fx.name, fx.base, fx.perModule ? 1 : 0, fx.energy ? 1 : 0, fx.pctOfRevenue ?? 0])
      ws.getCell(row.number, 2).font = FONT.input as ExcelJS.Font
      ws.getCell(row.number, 2).numFmt = FMT_EUR
      for (const ci of [3, 4, 5]) {
        ws.getCell(row.number, ci).font = FONT.input as ExcelJS.Font
        if (ci === 5) ws.getCell(row.number, ci).numFmt = FMT_PCT
      }
      opexFixedRows.push(row.number)
    })
    C.opexRow0 = String(opexFixedRows[0])
    C.opexRowN = String(opexFixedRows[opexFixedRows.length - 1])

    // ─── IT OPEX ───
    ws.addRow(['IT OPEX / ПОДПИСКИ']).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    ws.addRow(['Статья', '€/мес']).font = { ...ARIAL, bold: true }
    const itRows: number[] = []
    params.it.opex.forEach((x) => {
      const row = ws.addRow([x.name, x.base])
      ws.getCell(row.number, 2).font = FONT.input as ExcelJS.Font
      ws.getCell(row.number, 2).numFmt = FMT_EUR
      itRows.push(row.number)
    })
    C.itRow0 = String(itRows[0])
    C.itRowN = String(itRows[itRows.length - 1])

    // ─── Служебные итоги (pre-opening) ───
    ws.addRow(['ПРОИЗВОДНЫЕ']).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    calc('n0', 'Активных модулей на открытие',
      `SUMPRODUCT(('Модули'!$C$2:$C$${1 + nMod})*('Модули'!$D$2:$D$${1 + nMod}=1)*('Модули'!$K$2:$K$${1 + nMod}<=${C.openIdxEff}))`,
      n0v, 'очередь 1, запущены к открытию', '0', 'link')
    calc('fixedStart', 'Постоянные OPEX на старте, €/мес',
      `SUMPRODUCT($B$${C.opexRow0}:$B$${C.opexRowN},(1-$C$${C.opexRow0}:$C$${C.opexRowN}),(1+$D$${C.opexRow0}:$D$${C.opexRowN}*(${C.energyMult}-1)))+${C.n0}*SUMPRODUCT($B$${C.opexRow0}:$B$${C.opexRowN},$C$${C.opexRow0}:$C$${C.opexRowN},(1+$D$${C.opexRow0}:$D$${C.opexRowN}*(${C.energyMult}-1)))+IF(${C.itOn}="Да",SUM($B$${C.itRow0}:$B$${C.itRowN}),0)`,
      fixedStartV, 'без инфляции — база pre-opening', FMT_EUR, 'link')
    const preopenRow = ws.addRow(['Pre-opening burn, €/мес', '', '= −(фонд окладов старта × (1+взносы) + постоянные+IT)']).number
    ws.getCell(preopenRow, 1).font = { ...ARIAL }
    ws.getCell(preopenRow, 3).font = FONT.note as ExcelJS.Font
    C.preopenMonthly = `'Допущения'!$B$${preopenRow}`
    calc('presold', 'Годовые члены проданы пресейлом (0/1)',
      `IF(AND(${C.membersOn}="Да",${C.presaleDef}="Да",${C.presaleMonths}>0),1,0)`,
      params.members.enabled && params.units.presaleMode === 'deferred' && params.units.presaleMonths > 0 ? 1 : 0, '', '0', 'link')
    // легенда
    ws.addRow([])
    ws.addRow(['Легенда']).font = { ...ARIAL, bold: true }
    const legend: [string, Partial<ExcelJS.Font>][] = [
      ['Синий — вход / допущение (можно менять)', FONT.input],
      ['Чёрный — формула', FONT.calc],
      ['Зелёный — ссылка на другой лист', FONT.link],
      ['Серый — расчётная/справочная строка', FONT.note],
    ]
    for (const [t, f2] of legend) {
      const row = ws.addRow([t])
      row.getCell(1).font = f2 as ExcelJS.Font
    }
  }

  // ═══ СЦЕНАРИИ — матрица (раскладка строк = SCr) ═══
  {
    const ws = wb.addWorksheet('Сценарии')
    ws.addRow(['Параметр', ...matrix.names])
    headerRow(ws)
    freezeFirst(ws)
    ws.getColumn(1).width = 30
    const putAt = (r0: number, label: string, vals: number[], fmt: string, style: FontStyle = 'input') => {
      ws.getCell(r0, 1).value = label
      ws.getCell(r0, 1).font = { ...ARIAL }
      vals.forEach((v, i) => putCell(ws, r0, i + 2, v, fmt, style))
    }
    const streams: [number, string, number[][], string][] = [
      [SCr.baths, 'Бани, загрузка', YEAR_KEYS.map((y) => matrix.baths[y]), FMT_PCT],
      [SCr.steam, 'Парения, загрузка', YEAR_KEYS.map((y) => matrix.steam[y]), FMT_PCT],
      [SCr.massage, 'Массаж, загрузка', YEAR_KEYS.map((y) => matrix.massage[y]), FMT_PCT],
      [SCr.extra, 'Допы, загрузка', YEAR_KEYS.map((y) => matrix.extra[y]), FMT_PCT],
      [SCr.glamping, 'Глэмпинг, загрузка', YEAR_KEYS.map((y) => matrix.glamping[y]), FMT_PCT],
      [SCr.membersMonth, 'Членов (мес)', YEAR_KEYS.map((y) => matrix.membersMonth[y]), FMT_INT],
      [SCr.publicBath, 'Обществ. баня, загрузка', YEAR_KEYS.map((y) => matrix.publicBath?.[y] ?? [0, 0, 0]), FMT_PCT],
      [SCr.restaurant, 'Ресторан, загрузка', YEAR_KEYS.map((y) => matrix.restaurant?.[y] ?? [0, 0, 0]), FMT_PCT],
      [SCr.bathsP2, 'Бани оч. 2, загрузка', YEAR_KEYS.map((y) => matrix.bathsP2?.[y] ?? matrix.baths[y]), FMT_PCT],
      [SCr.steamP2, 'Парения оч. 2, загрузка', YEAR_KEYS.map((y) => matrix.steamP2?.[y] ?? matrix.steam[y]), FMT_PCT],
      [SCr.massageP2, 'Массаж оч. 2, загрузка', YEAR_KEYS.map((y) => matrix.massageP2?.[y] ?? matrix.massage[y]), FMT_PCT],
      [SCr.extraP2, 'Допы оч. 2, загрузка', YEAR_KEYS.map((y) => matrix.extraP2?.[y] ?? matrix.extra[y]), FMT_PCT],
    ]
    for (const [r0, label, vecs, fmt] of streams)
      YEAR_KEYS.forEach((_, i) => putAt(r0 + i, `${label} — Год ${i + 1}`, vecs[i], fmt))
    putAt(SCr.priceGrowth, 'Рост цен', matrix.priceGrowth, FMT_PCT)
    putAt(SCr.capexAdj, 'Корректировка CAPEX', matrix.capexAdj, FMT_PCT)
    putAt(SCr.rampMonths, 'Выход на план, мес', matrix.rampMonths, '0')
    putAt(SCr.uptake, 'Uptake (непакетный)', matrix.uptake, FMT_PCT)
    putAt(SCr.delay, 'Задержка стройки, мес', matrix.constructionDelayMonths, '0')
    putAt(SCr.energyMult, 'Множитель энергозатрат', matrix.energyCostMult, '0.00')
    ws.addRow([])
    ws.addRow(['РЕЗУЛЬТАТЫ (снимок ядра)', ...matrix.names])
    headerRow(ws, ws.rowCount)
    const put = (label: string, vals: number[], fmt = FMT_EUR) => {
      const row = ws.addRow([label])
      row.getCell(1).font = { ...ARIAL }
      vals.forEach((v, i) => putCell(ws, row.number, i + 2, v, fmt, 'calc'))
    }
    put('NPV (весь горизонт), EUR', results.map((x) => Math.round(x.kpis.npv)))
    put('IRR годовой', results.map((x) => x.kpis.irrAnnual), FMT_PCT)
    put('Окупаемость, мес', results.map((x) => x.kpis.paybackMonths), '0')
    put('Диск. окупаемость, мес', results.map((x) => x.kpis.discountedPaybackMonths), '0')
    put('Пиковая потребность, EUR', results.map((x) => Math.round(x.kpis.peakFundingNeed)))
  }

  // ═══ МОДУЛИ ═══
  const MOD = {
    first: 2,
    last: 1 + nMod,
    priceLen: params.slotMix.length,
  }
  const modFit0 = 14 + MOD.priceLen // первый столбец «подходит ли спека аренды»
  const modSpecRowCol = modFit0 + rentalSpecs.length
  const modP2Col = modSpecRowCol + 1
  // Строки спек на листе «Спеки»: заголовок + шапка → спеки с 3-й строки
  const SP0 = 3
  {
    const ws = wb.addWorksheet('Модули')
    ws.properties.tabColor = { argb: 'FF4472C4' }
    const heads = ['ID', 'Статус', 'Вкл (0/1)', 'Очередь', 'Вместимость', 'Слотов/день', 'Uptime', 'LoadK', 'Запуск: год', 'Запуск: мес', 'Запуск: индекс', 'CF-мес', 'Ср. цена слота, €']
    params.slotMix.forEach((_, i) => heads.push(`Цена ${params.slotNames?.[i] ?? `слот ${i + 1}`}`))
    rentalSpecs.forEach((s) => heads.push(`≈${s.code}`))
    heads.push('Спека аренды (№)', '№ модуля оч.2')
    ws.addRow(heads)
    headerRow(ws)
    freezeFirst(ws)
    ws.getColumn(1).width = 6
    ws.getColumn(2).width = 10
    for (let c = 3; c <= heads.length; c++) ws.getColumn(c).width = 11
    modules.forEach((m, i) => {
      const rN = 2 + i
      const launchIdx = ymIdx(m.launchDate)
      const row = ws.addRow([
        m.id, m.status,
        { formula: `IF($B${rN}="Активен",1,0)`, result: m.status === 'Активен' ? 1 : 0 },
        m.phase ?? 1, m.capacity, m.slotsPerDay, m.uptime, m.loadK,
        Number(m.launchDate.slice(0, 4)), Number(m.launchDate.slice(5, 7)),
        { formula: `$I${rN}*12+$J${rN}`, result: launchIdx },
        { formula: `$K${rN}-${C.constrIdx}+1`, result: launchIdx - constrIdx + 1 },
        { formula: `SUMPRODUCT($${L(14)}${rN}:$${L(13 + MOD.priceLen)}${rN},${'SLOTMIX'})`, result: m.prices.reduce((a, p, j) => a + p * (params.slotMix[j] ?? 0), 0) },
        ...m.prices.slice(0, MOD.priceLen),
      ])
      // стили: входы синие
      for (const ci of [2, 4, 5, 6, 7, 8, 9, 10, ...params.slotMix.map((_, j) => 14 + j)])
        ws.getCell(rN, ci).font = FONT.input as ExcelJS.Font
      ws.getCell(rN, 2).font = { ...ARIAL, color: { argb: BLUE } }
      // подбор спеки аренды: первая по порядку таблицы с capacity ≥ вместимости
      rentalSpecs.forEach((s, j) => {
        const specNum = services.indexOf(s) + 1
        const specCapCell = `'Спеки'!$F$${SP0 + services.indexOf(s)}`
        const cell = ws.getCell(rN, modFit0 + j)
        cell.value = {
          formula: `IF(OR(${specCapCell}="",${specCapCell}>=$E${rN}),${specNum},999999)`,
          result: m.capacity <= (s.capacity ?? Infinity) ? specNum : 999999,
        }
        cell.font = { ...ARIAL, color: { argb: GREY } }
        cell.numFmt = '0'
      })
      // назначенная спека: min подходящего №, иначе последняя арендная
      const t = (() => {
        let idx = rentalSpecs.findIndex((s) => m.capacity <= (s.capacity ?? Infinity))
        if (idx < 0) idx = rentalSpecs.length - 1
        return idx >= 0 ? services.indexOf(rentalSpecs[idx]) + 1 : 0
      })()
      const sr = ws.getCell(rN, modSpecRowCol)
      sr.value = rentalSpecs.length
        ? {
            formula: `IF(MIN(${L(modFit0)}${rN}:${L(modSpecRowCol - 1)}${rN})=999999,${rentalSpecs.length ? services.indexOf(rentalSpecs[rentalSpecs.length - 1]) + 1 : 0},MIN(${L(modFit0)}${rN}:${L(modSpecRowCol - 1)}${rN}))`,
            result: t,
          }
        : 0
      sr.font = { ...ARIAL }
      sr.numFmt = '0'
      const p2n = ws.getCell(rN, modP2Col)
      const p2num = modules.slice(0, i + 1).filter((x) => (x.phase ?? 1) === 2).length
      p2n.value = (m.phase ?? 1) === 2
        ? { formula: `COUNTIF($D$2:$D${rN},2)`, result: p2num }
        : ''
      p2n.font = { ...ARIAL }
      p2n.numFmt = '0'
      void row
    })
    // микс слотов (веса) + средняя ёмкость активных — служебный блок
    const mixRow = ws.addRow([]).number + 1
    ws.getCell(mixRow, 1).value = 'Микс слотов (веса)'
    ws.getCell(mixRow, 1).font = { ...ARIAL, bold: true }
    params.slotMix.forEach((v, j) => putCell(ws, mixRow, 2 + j, v, FMT_PCT, 'input'))
    C.slotMix = `'Модули'!$B$${mixRow}:$${L(1 + MOD.priceLen)}$${mixRow}`
    const avgRow = mixRow + 1
    ws.getCell(avgRow, 1).value = 'Средняя ёмкость активных модулей'
    ws.getCell(avgRow, 1).font = { ...ARIAL }
    ws.getCell(avgRow, 2).value = {
      formula: `SUMPRODUCT($C$2:$C$${MOD.last},$E$2:$E$${MOD.last})/MAX(1,SUM($C$2:$C$${MOD.last}))`,
      result: scen.avgCapacity,
    }
    ws.getCell(avgRow, 2).font = FONT.link as ExcelJS.Font
    ws.getCell(avgRow, 2).numFmt = '0.0'
    C.avgCapAll = `'Модули'!$B$${avgRow}`
    C.modRows = `${MOD.first}:${MOD.last}`
  }
  // подставляем ссылку на slotMix в формулу avgPrice (была с плейсхолдером)
  {
    const ws = wb.getWorksheet('Модули')!
    for (let i = 0; i < nMod; i++) {
      const cell = ws.getCell(2 + i, 13)
      const v = cell.value as { formula: string; result: number }
      cell.value = { formula: v.formula.replace('SLOTMIX', C.slotMix), result: v.result }
    }
  }

  // ═══ СЕЗОННОСТЬ ═══
  {
    const ws = wb.addWorksheet('Сезонность')
    ws.properties.tabColor = { argb: 'FF4472C4' }
    ws.addRow(['Ряд', ...Array.from({ length: 12 }, (_, i) => `M${i + 1}`)])
    headerRow(ws)
    freezeFirst(ws)
    ws.getColumn(1).width = 22
    const putSeas = (key: string, label: string, arr: number[]) => {
      const row = ws.addRow([label, ...arr])
      ws.getCell(row.number, 1).font = { ...ARIAL }
      for (let i = 0; i < 12; i++) {
        const cell = ws.getCell(row.number, i + 2)
        cell.font = FONT.input as ExcelJS.Font
        cell.numFmt = '0.00'
      }
      C[key] = `'Сезонность'!$B$${row.number}:$M$${row.number}`
    }
    putSeas('seasB', 'Бани', params.seasonality.baths)
    putSeas('seasG', 'Глэмпинг', params.seasonality.glamping)
    putSeas('seasC', 'Сертификаты', params.seasonality.certificates ?? params.seasonality.baths.map(() => 1))
  }

  // ═══ ШТАТ ═══
  const ST = {
    firstRole: 5,
    lastRole: 4 + nRoles,
    baseCol: 4, // D — базовый вектор
    phase0: 5, // E.. — фазы
    phaseN: 4 + Math.max(1, phases.length),
    normCol: 0, // посчитаем ниже
  }
  ST.normCol = ST.phase0 + Math.max(1, phases.length)
  {
    const ws = wb.addWorksheet('Штат')
    ws.properties.tabColor = { argb: 'FF4472C4' }
    ws.addRow(['Роль', 'Оклад, €', 'График', 'База', ...phases.map((ph, i) => ph.label ?? `Фаза ${i + 1}`), 'Роль (норм.)'])
    headerRow(ws)
    freezeFirst(ws)
    ws.getColumn(1).width = 26
    ws.getColumn(2).width = 11
    ws.getColumn(3).width = 10
    ws.getColumn(ST.normCol + 1).width = 14
    ws.getRow(2).getCell(1).value = 'старт фазы: год'
    ws.getRow(3).getCell(1).value = 'старт фазы: месяц'
    ws.getRow(4).getCell(1).value = 'старт фазы: индекс'
    for (const rr of [2, 3, 4]) {
      ws.getCell(rr, 1).font = { ...ARIAL, italic: true, color: { argb: GREY } }
    }
    ws.getCell(4, ST.baseCol).value = 0
    phases.forEach((ph, i) => {
      const [y, m] = ph.from.split('-').map(Number)
      const col = ST.phase0 + i
      putCell(ws, 2, col, y, '0', 'input')
      putCell(ws, 3, col, m, '0', 'input')
      const cell = ws.getCell(4, col)
      cell.value = { formula: `${L(col)}2*12+${L(col)}3`, result: y * 12 + m }
      cell.font = { ...ARIAL, color: { argb: GREY } }
      cell.numFmt = '0'
    })
    params.fot.roles.forEach((role, i) => {
      const rN = ST.firstRole + i
      const row = ws.addRow([
        role,
        params.fot.salary[i] ?? 0,
        params.fot.schedule?.[i] ?? '',
        params.fot.count[i] ?? 0,
        ...phases.map((ph) => ph.count[i] ?? 0),
        '',
      ])
      void row
      ws.getCell(rN, 2).font = FONT.input as ExcelJS.Font
      ws.getCell(rN, 2).numFmt = FMT_EUR
      ws.getCell(rN, 3).font = { ...ARIAL, color: { argb: BLUE } }
      for (let ci = ST.baseCol; ci <= ST.phase0 + phases.length - 1; ci++) {
        ws.getCell(rN, ci).font = FONT.input as ExcelJS.Font
        ws.getCell(rN, ci).numFmt = '0.#'
      }
      const nr = ws.getCell(rN, ST.normCol + 1)
      nr.value = {
        formula: `TRIM(LOWER(SUBSTITUTE(IFERROR(LEFT($A${rN},FIND("(",$A${rN})-1),$A${rN}),"пармейстер","пармастер")))`,
        result: normRoleJs(role),
      }
      nr.font = FONT.note as ExcelJS.Font
    })
    const fundRow = ws.addRow([]).number + 1
    ws.getCell(fundRow, 1).value = 'Фонд окладов старта, €/мес'
    ws.getCell(fundRow, 1).font = { ...ARIAL, bold: true }
    ws.getCell(fundRow, 2).value = {
      formula: `SUMPRODUCT($D$${ST.firstRole}:$D$${ST.lastRole},$B$${ST.firstRole}:$B$${ST.lastRole})+IF(${C.itOn}="Да",${C.itCurator},0)+IF(${C.fbOn}="Да",${C.fbCook}*${C.fbCookSal},0)`,
      result: baseSal0v,
    }
    ws.getCell(fundRow, 2).font = { ...ARIAL, bold: true, color: { argb: GREEN } }
    ws.getCell(fundRow, 2).numFmt = FMT_EUR
    C.baseSal0 = `'Штат'!$B$${fundRow}`
    C.staffIdxRow = `'Штат'!$D$4:$${L(ST.phase0 + Math.max(1, phases.length) - 1)}$4`
    C.staffCountCol0 = L(ST.baseCol)
    C.staffCountColN = L(ST.phase0 + Math.max(1, phases.length) - 1)
    // preopening burn — теперь есть C.baseSal0
    FIX.push({
      sheet: 'Допущения',
      r: Number(C.preopenMonthly.match(/\$(\d+)$/)![1]),
      c: 2,
      f: `-(${C.baseSal0}*(1+${C.er})+${C.fixedStart})`,
      v: -(baseSal0v * (1 + params.taxes.employerRate) + fixedStartV),
      fmt: FMT_EUR,
      style: 'link',
    })
  }

  // ═══ СПЕКИ + СОСТАВЫ ═══
  {
    const ws = wb.addWorksheet('Спеки')
    ws.properties.tabColor = { argb: 'FF4472C4' }
    ws.addRow(['СПЕЦИФИКАЦИИ УСЛУГ'])
    ws.getRow(1).getCell(1).font = { ...ARIAL, bold: true }
    ws.addRow(['Код', 'Название', 'Направление', 'Цена, €', 'Вес', 'Вместимость', 'KPI-доля', 'w·p'])
    headerRow(ws, 2)
    freezeFirst(ws)
    ws.getColumn(1).width = 12
    ws.getColumn(2).width = 30
    ws.getColumn(3).width = 14
    const it0 = SP0 + nSpec + 4 // начало таблицы составов (после спек + итоги + шапка)
    services.forEach((s, i) => {
      const rN = SP0 + i
      const labor = serviceLaborShareCached(s)
      ws.addRow([s.code, s.name, s.direction, s.price, s.weight ?? 0, s.capacity ?? '', '', s.price * (s.weight ?? 0)])
      ws.getCell(rN, 4).font = FONT.input as ExcelJS.Font
      ws.getCell(rN, 4).numFmt = FMT_EUR
      ws.getCell(rN, 5).font = FONT.input as ExcelJS.Font
      ws.getCell(rN, 5).numFmt = '0.00'
      ws.getCell(rN, 6).font = FONT.input as ExcelJS.Font
      const ls = ws.getCell(rN, 7)
      ls.value = { formula: `SUMIFS($G$${it0 + 1}:$G$${it0 + nSpecItems},$A$${it0 + 1}:$A$${it0 + nSpecItems},$A${rN})`, result: labor }
      ls.numFmt = FMT_PCT
      ls.font = { ...ARIAL }
      const wp = ws.getCell(rN, 8)
      wp.value = { formula: `$D${rN}*$E${rN}`, result: s.price * (s.weight ?? 0) }
      wp.font = { ...ARIAL }
      wp.numFmt = FMT_EUR2
    })
    C.specR0 = String(SP0)
    C.specRN = String(SP0 + nSpec - 1)
    const swpOf = (dir: string) => services.filter((s) => s.direction === dir).reduce((a, s) => a + s.price * (s.weight ?? 0), 0)
    const swpRow = SP0 + nSpec
    const swps: [string, string, number][] = [
      ['swpSteam', 'Σ w·p парения', swpOf('Парения')],
      ['swpMass', 'Σ w·p массаж', swpOf('Массаж')],
      ['swpExtra', 'Σ w·p допы', swpOf('Доп. услуги')],
    ]
    swps.forEach(([key, label, v], i) => {
      const rN = swpRow + i
      ws.getCell(rN, 1).value = label
      ws.getCell(rN, 1).font = { ...ARIAL, italic: true }
      ws.getCell(rN, 8).value = { formula: `SUMIFS($H$${SP0}:$H$${SP0 + nSpec - 1},$C$${SP0}:$C$${SP0 + nSpec - 1},"${label.includes('пар') ? 'Парения' : label.includes('масс') ? 'Массаж' : 'Доп. услуги'}")`, result: v }
      ws.getCell(rN, 8).font = { ...ARIAL, color: { argb: GREEN } }
      ws.getCell(rN, 8).numFmt = FMT_EUR
      C[key] = `'Спеки'!$H$${rN}`
    })
    // составы
    ws.getCell(it0 - 1, 1).value = 'СОСТАВ СПЕЦИФИКАЦИЙ'
    ws.getCell(it0 - 1, 1).font = { ...ARIAL, bold: true }
    const heads = ['Спека', 'Вид', 'Материал/роль', 'Кол-во', 'Доля KPI', 'Минуты (устар.)', 'Эфф. доля', 'Роль (норм.)']
    heads.forEach((h, i) => (ws.getCell(it0, i + 1).value = h))
    headerRow(ws, it0)
    specItems.forEach(({ specIdx, it }, i) => {
      const rN = it0 + 1 + i
      const s = services[specIdx]
      const ref = it.kind === 'material' ? it.code ?? '' : it.role ?? ''
      const labor = laborPctCached(it, s.price)
      ws.addRow([s.code, it.kind, ref, it.qty ?? '', it.pct ?? '', it.minutes ?? '', '', ''])
      ws.getCell(rN, 4).font = FONT.input as ExcelJS.Font
      ws.getCell(rN, 5).font = FONT.input as ExcelJS.Font
      ws.getCell(rN, 6).font = FONT.input as ExcelJS.Font
      const nr = ws.getCell(rN, 8)
      nr.value = it.role
        ? {
            formula: `TRIM(LOWER(SUBSTITUTE(IFERROR(LEFT($C${rN},FIND("(",$C${rN})-1),$C${rN}),"пармейстер","пармастер")))`,
            result: normRoleJs(it.role),
          }
        : ''
      nr.font = FONT.note as ExcelJS.Font
      const ep = ws.getCell(rN, 7)
      ep.value = {
        formula: `IF($B${rN}="labor",IF($E${rN}<>"",$E${rN},IF($F${rN}<>"",($F${rN}/60)*IFERROR(INDEX('Штат'!$B$${ST.firstRole}:$B$${ST.lastRole},MATCH($H${rN},'Штат'!$${L(ST.normCol + 1)}$${ST.firstRole}:$${L(ST.normCol + 1)}$${ST.lastRole},0)),0)*(1+${C.er})/173/INDEX($D$${SP0}:$D$${SP0 + nSpec - 1},MATCH($A${rN},$A$${SP0}:$A$${SP0 + nSpec - 1},0)),0)),"")`,
        result: it.kind === 'labor' ? labor : '',
      }
      ep.numFmt = FMT_PCT
      ep.font = { ...ARIAL }
    })
    C.specItemR0 = String(it0 + 1)
    C.specItemRN = String(it0 + nSpecItems)
  }

  // ═══ НОМЕНКЛАТУРА ═══
  const NOM = { first: 2, last: 1 + nItems, artFirst: 0 }
  {
    const ws = wb.addWorksheet('Номенклатура')
    ws.properties.tabColor = { argb: 'FF4472C4' }
    ws.addRow(['Код', 'Наименование', 'Категория', 'Тип', 'Ед.', 'Цена €', 'Дост.€/ед', 'Дост.%', 'Landed €', 'Учёт', 'Статья OPEX', 'Норма', 'База', 'Кол-во', 'Нач. запас', 'Запас оч.2', 'Прач. €', 'В спеке', 'Эфф. цена', 'Статья списания'])
    headerRow(ws)
    freezeFirst(ws)
    ws.autoFilter = { from: 'A1', to: 'T1' }
    ws.getColumn(1).width = 10
    ws.getColumn(2).width = 34
    ws.getColumn(3).width = 20
    ws.getColumn(11).width = 18
    ws.getColumn(20).width = 18
    items.forEach((it) => {
      const rN = ws.rowCount + 1
      const inSpec = specCodes.has(it.code) ? 1 : 0
      const effPrice = params.laundry?.enabled && it.ownPrice != null ? it.ownPrice : landedCost(it)
      const art = it.opexArticle ?? it.category
      ws.addRow([it.code, it.name, it.category, it.type, it.unit, it.price, it.deliveryFix, it.deliveryPct,
        '', it.use, it.opexArticle, it.norm, it.normBase, it.qty, it.initialQty ?? 0, it.initialQtyP2 ?? 0,
        it.ownPrice ?? '', '', '', ''])
      ws.getCell(rN, 1).font = { ...ARIAL }
      ws.getCell(rN, 2).font = { ...ARIAL }
      ws.getCell(rN, 3).font = { ...ARIAL }
      for (const ci of [6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17]) ws.getCell(rN, ci).font = FONT.input as ExcelJS.Font
      ws.getCell(rN, 8).numFmt = FMT_PCT
      const lc = ws.getCell(rN, 9)
      lc.value = { formula: `F${rN}+MAX(G${rN},F${rN}*H${rN})`, result: landedCost(it) }
      lc.numFmt = FMT_EUR2
      const ins = ws.getCell(rN, 18)
      ins.value = { formula: `MIN(1,COUNTIF('Спеки'!$C$${C.specItemR0}:$C$${C.specItemRN},$A${rN}))`, result: inSpec }
      ins.font = { ...ARIAL, color: { argb: GREY } }
      const ep = ws.getCell(rN, 19)
      ep.value = { formula: `IF(AND(${C.laundryOn}="Да",$Q${rN}<>""),$Q${rN},$I${rN})`, result: effPrice }
      ep.numFmt = FMT_EUR2
      ep.font = { ...ARIAL }
      const ta = ws.getCell(rN, 20)
      ta.value = { formula: `IF($K${rN}<>"",$K${rN},$C${rN})`, result: art }
      ta.font = { ...ARIAL }
    })
    // суммы нормативных баз (€/слот, €/гость, €/мес)
    const h0 = ws.rowCount + 2
    ws.getCell(h0, 1).value = 'Нормативные суммы по статьям (€ на единицу базы)'
    ws.getCell(h0, 1).font = { ...ARIAL, bold: true }
    ws.getCell(h0 + 1, 1).value = 'Статья OPEX'
    ws.getCell(h0 + 1, 2).value = '€/слот'
    ws.getCell(h0 + 1, 3).value = '€/гость'
    ws.getCell(h0 + 1, 4).value = '€/мес'
    headerRow(ws, h0 + 1)
    NOM.artFirst = h0 + 2
    const rng = (cl: string) => `$${cl}$${NOM.first}:$${cl}$${NOM.last}`
    varArticles.forEach((a, i) => {
      const rN = NOM.artFirst + i
      ws.getCell(rN, 1).value = a
      ws.getCell(rN, 1).font = { ...ARIAL }
      const mk = (base: string) =>
        `SUMPRODUCT((${rng('J')}<>"CAPEX")*(${rng('K')}=$A${rN})*(${rng('M')}="${base}")*(${rng('R')}=0)*${rng('L')}*${rng('I')})`
      const v = (base: string) =>
        opexNormItems
          .filter((x) => x.opexArticle === a && x.normBase === base)
          .reduce((s, x) => s + x.norm * landedCost(x), 0)
      ws.getCell(rN, 2).value = { formula: mk('слот'), result: v('слот') }
      ws.getCell(rN, 3).value = { formula: mk('гость'), result: v('гость') }
      ws.getCell(rN, 4).value = { formula: mk('мес'), result: v('мес') }
      for (const ci of [2, 3, 4]) {
        ws.getCell(rN, ci).font = { ...ARIAL }
        ws.getCell(rN, ci).numFmt = FMT_EUR2
      }
    })
    C.nomArtR0 = String(NOM.artFirst)
    C.nomArtRN = String(NOM.artFirst + varArticles.length - 1)
  }

  // ═══ CAPEX — сметная ведомость с WBS ═══
  // Столбцы: A статья | B ед. | C кол-во | D ставка | E сумма |
  //          F очередь | G объект | H ед/модуль | I объект включён — служебные.
  const CX: Record<string, number> = {}
  let modulesRow = 0
  const itemRows: number[] = []
  const itemRowsP2: number[] = []
  const p2ItemRowRange = { first: 0, last: 0 }
  const sharedItemRowsP2: number[] = [] // позиции оч.2 без привязки к объекту
  const buckets: { label: string; eurCell: string; startCell: string; v: number; sv: number }[] = []
  const sharedFlagRows: number[] = [] // item-строки оч.2 без объекта → флаг = anyP2
  {
    const ws = wb.addWorksheet('CAPEX')
    ws.properties.tabColor = { argb: 'FFBF8F00' }
    ws.addRow(['Статья затрат / элемент работ', 'Ед.', 'Кол-во', 'Ставка, €', 'Сумма, €', 'Оч.', 'Объект', 'ед/мод', 'вкл'])
    headerRow(ws)
    freezeFirst(ws)
    ws.getColumn(1).width = 56
    ws.getColumn(2).width = 8
    ws.getColumn(3).width = 10
    ws.getColumn(4).width = 12
    ws.getColumn(5).width = 14
    for (const ci of [6, 7, 8, 9]) ws.getColumn(ci).width = 8
    const groups: { name: string; items: typeof r.capex.items }[] = []
    const gix = new Map<string, number>()
    for (const it of r.capex.items) {
      const g = `${it.phase === 2 ? 'Оч.2 · ' : ''}${it.group ?? 'Прочее'}`
      const ix = gix.get(g)
      if (ix === undefined) { gix.set(g, groups.length); groups.push({ name: g, items: [it] }) }
      else groups[ix].items.push(it)
    }
    // исходный capexItem для помодульной логики (по имени — порядок совпадает с visible)
    const perModuleN = (name: string): number | null => {
      const it = params.capexItems.find((x) => (x.name ?? '') === name)
      if (!it) return null
      const m = /^MODULES_COUNT(?::(\d+))?$/.exec(String(it.qty))
      return m ? Number(m[1] ?? 1) : null
    }
    const objEnabledCell = (row: number, phase: 1 | 2, object: string | undefined) => {
      const cell = ws.getCell(row, 9)
      if (object === 'public')
        cell.value = { formula: `IF(${C.pbOn}="Да",1,0)`, result: params.publicBath?.enabled ? 1 : 0 }
      else if (/^vip\d+$/.test(object ?? '')) {
        const n = Number((object ?? '').slice(3))
        const mod = p2Mods[n - 1]
        cell.value = {
          formula: `IFERROR(INDEX('Модули'!$C$${MOD.first}:$C$${MOD.last},MATCH(${n},'Модули'!$${L(modP2Col)}$${MOD.first}:$${L(modP2Col)}$${MOD.last},0)),0)`,
          result: mod && mod.status === 'Активен' ? 1 : 0,
        }
      } else if (object)
        cell.value = 1
      else if (phase === 2) {
        cell.value = { formula: '1', result: 1 }
        sharedFlagRows.push(row)
      } else
        cell.value = 1
      cell.font = { ...ARIAL, color: { argb: GREY } }
      cell.numFmt = '0'
    }
    groups.forEach((g, gi) => {
      const head = ws.addRow([`Раздел ${gi + 1}. ${g.name}`, '', '', '', ''])
      head.eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
      const itemEurCells: string[] = []
      for (const it of g.items) {
        const ir = ws.addRow([it.name, it.unit ?? '', it.qty ?? '', it.rate ?? '', ''])
        ;(it.phase === 2 ? itemRowsP2 : itemRows).push(ir.number)
        if (it.phase === 2 && !p2ItemRowRange.first) p2ItemRowRange.first = ir.number
        if (it.phase === 2) p2ItemRowRange.last = ir.number
        if (it.phase === 2 && !it.object) sharedItemRowsP2.push(ir.number)
        itemEurCells.push(`$E$${ir.number}`)
        if (it.name.includes('Банные модуля')) modulesRow = ir.number
        ir.getCell(1).font = { ...ARIAL, bold: true }
        const ph = ws.getCell(ir.number, 6)
        ph.value = it.phase ?? 1
        ph.font = { ...ARIAL, color: { argb: GREY } }
        const ob = ws.getCell(ir.number, 7)
        ob.value = it.object ?? ''
        ob.font = { ...ARIAL, color: { argb: GREY } }
        objEnabledCell(ir.number, it.phase ?? 1, it.phase === 2 ? it.object : undefined)
        const n = perModuleN(it.name)
        const hn = ws.getCell(ir.number, 8)
        if (n !== null) {
          hn.value = n
          hn.font = { ...ARIAL, color: { argb: GREY } }
        }
        // кол-во: помодульные строки считаются по активным модулям своей очереди
        if (n !== null) {
          const qc = ir.getCell(3)
          qc.value = {
            formula: `$H${ir.number}*COUNTIFS('Модули'!$C$${MOD.first}:$C$${MOD.last},1,'Модули'!$D$${MOD.first}:$D$${MOD.last},$F${ir.number})`,
            result: it.qty,
          }
          qc.font = { ...ARIAL, color: { argb: GREEN } }
          qc.numFmt = '#,##0.##'
        } else {
          ir.getCell(3).font = FONT.input as ExcelJS.Font
          ir.getCell(3).numFmt = '#,##0.##'
        }
        ir.getCell(2).font = { ...ARIAL }
        ir.getCell(4).font = FONT.input as ExcelJS.Font
        ir.getCell(4).numFmt = FMT_EUR
        const ec = ir.getCell(5)
        ec.numFmt = FMT_EUR
        ec.font = { ...ARIAL, bold: true }
        // WBS-подразделы и строки работ
        const secRows: number[] = []
        const catTotalRows: number[] = []
        for (const sec of it.wbs ?? []) {
          const sr = ws.addRow([`    ${sec.code} ${sec.title}`, '', '', '', ''])
          secRows.push(sr.number)
          sr.getCell(1).font = { ...ARIAL, italic: true }
          sr.eachCell((c) => (c.fill = fill(SEC_BG)))
          const lineRows: number[] = []
          for (const l of sec.items) {
            const dispRate = l.qty && l.rate != null ? l.eur / l.qty : l.rate
            const lr = ws.addRow([
              `        ${l.code} ${l.name}${l.tag ? ` · ${l.tag}` : ''}`,
              l.unit ?? '', l.qty ?? '', dispRate ?? '', '',
            ])
            lineRows.push(lr.number)
            lr.getCell(1).font = { ...ARIAL, size: 9 }
            lr.getCell(3).font = { ...FONT.input, size: 9 } as ExcelJS.Font
            lr.getCell(3).numFmt = '#,##0.##'
            lr.getCell(4).font = { ...FONT.input, size: 9 } as ExcelJS.Font
            lr.getCell(4).numFmt = FMT_EUR
            const le = lr.getCell(5)
            le.numFmt = FMT_EUR
            le.font = { ...ARIAL, size: 9 }
            le.value = l.qty != null && dispRate != null
              ? { formula: `$C$${lr.number}*$D$${lr.number}`, result: l.eur }
              : l.eur
          }
          const se = sr.getCell(5)
          se.numFmt = FMT_EUR
          se.font = { ...ARIAL, bold: true, italic: true }
          se.value = { formula: `SUM(${lineRows.map((x) => `$E$${x}`).join(',')})`, result: sec.total }
        }
        // Наполнение: категории номенклатуры → SKU
        if (it.detail?.some((d) => d.category)) {
          const cix = new Map<string, typeof it.detail>()
          for (const d of it.detail!) {
            const c = d.category ?? 'Прочее'
            cix.set(c, [...(cix.get(c) ?? []), d])
          }
          for (const [cat, rows] of cix) {
            const cr = ws.addRow([`    ${cat}`, '', '', '', ''])
            catTotalRows.push(cr.number)
            cr.getCell(1).font = { ...ARIAL, italic: true }
            cr.eachCell((c) => (c.fill = fill(SEC_BG)))
            const skuRows: number[] = []
            let catSum = 0
            for (const d of rows) {
              const dr = ws.addRow([`        ${d.code} ${d.name}`, d.unit ?? '', d.qty, d.landed, ''])
              skuRows.push(dr.number)
              catSum += d.eur
              dr.getCell(1).font = { ...ARIAL, size: 9 }
              dr.getCell(3).font = { ...FONT.input, size: 9 } as ExcelJS.Font
              dr.getCell(3).numFmt = '#,##0.##'
              dr.getCell(4).font = { ...FONT.input, size: 9 } as ExcelJS.Font
              dr.getCell(4).numFmt = FMT_EUR2
              const de = dr.getCell(5)
              de.numFmt = FMT_EUR
              de.font = { ...ARIAL, size: 9 }
              de.value = { formula: `$C$${dr.number}*$D$${dr.number}`, result: d.eur }
            }
            const ce = cr.getCell(5)
            ce.numFmt = FMT_EUR
            ce.font = { ...ARIAL, bold: true, italic: true }
            ce.value = { formula: `SUM(${skuRows.map((x) => `$E$${x}`).join(',')})`, result: catSum }
          }
        }
        // помодульные детали
        if (it.detail && !it.detail.some((d) => d.category) && !it.wbs?.length) {
          for (const d of it.detail) {
            const dr = ws.addRow([`        ${d.code} · ${d.name}`, d.unit ?? '', d.qty, d.landed, ''])
            dr.getCell(1).font = { ...ARIAL, size: 9 }
            dr.getCell(4).numFmt = FMT_EUR
            const de = dr.getCell(5)
            de.numFmt = FMT_EUR
            de.font = { ...ARIAL, size: 9 }
            de.value = { formula: `$C$${dr.number}*$D$${dr.number}`, result: d.eur }
          }
        }
        // сумма позиции: живые источники для справочных/условных строк,
        // иначе qty×rate×флаг объекта
        const gate = `$I$${ir.number}`
        if (it.name === 'Наполнение' || it.name.startsWith('Наполнение ')) {
          ec.value = {
            formula: `SUMPRODUCT(('Номенклатура'!$J$${NOM.first}:$J$${NOM.last}="CAPEX")*'Номенклатура'!$I$${NOM.first}:$I$${NOM.last}*'Номенклатура'!$N$${NOM.first}:$N$${NOM.last})`,
            result: it.eur,
          }
          ec.font = { ...ARIAL, bold: true, color: { argb: GREEN } }
        } else if (it.name === 'Закуп: стартовые запасы') {
          ec.value = {
            formula: `SUMPRODUCT(('Номенклатура'!$J$${NOM.first}:$J$${NOM.last}<>"CAPEX")*'Номенклатура'!$I$${NOM.first}:$I$${NOM.last}*'Номенклатура'!$O$${NOM.first}:$O$${NOM.last})`,
            result: it.eur,
          }
          ec.font = { ...ARIAL, bold: true, color: { argb: GREEN } }
        } else if (it.name === 'Закуп: стартовые запасы очереди 2') {
          ec.value = {
            formula: `SUMPRODUCT('Номенклатура'!$I$${NOM.first}:$I$${NOM.last}*'Номенклатура'!$P$${NOM.first}:$P$${NOM.last})*${gate}`,
            result: it.eur,
          }
          ec.font = { ...ARIAL, bold: true, color: { argb: GREEN } }
        } else if (it.name === 'Земля / участок') {
          ec.value = { formula: `${C.landBuyF}*${C.landCost}`, result: it.eur }
          ec.font = { ...ARIAL, bold: true, color: { argb: GREEN } }
        } else if (secRows.length) {
          ec.value = { formula: `SUM(${secRows.map((x) => `$E$${x}`).join(',')})*${gate}`, result: it.eur }
        } else if (catTotalRows.length) {
          ec.value = { formula: `SUM(${catTotalRows.map((x) => `$E$${x}`).join(',')})*${gate}`, result: it.eur }
        } else if (it.qty != null && it.rate != null) {
          ec.value = { formula: `$C$${ir.number}*$D$${ir.number}*${gate}`, result: it.eur }
        } else {
          ec.value = { formula: it.phase === 2 ? `${it.eur}*${gate}` : `${it.eur}`, result: it.eur }
          ec.font = { ...ARIAL, bold: true, color: { argb: it.phase === 2 ? GREEN : BLUE } }
        }
      }
      const totalRow = ws.addRow([`    Итого по разделу ${gi + 1}`, '', '', '', ''])
      const te = totalRow.getCell(5)
      te.numFmt = FMT_EUR
      te.font = { ...ARIAL, bold: true }
      te.value = { formula: `SUM(${itemEurCells.join(',')})`, result: g.items.reduce((s, x) => s + x.eur, 0) }
      totalRow.getCell(1).font = { ...ARIAL, bold: true }
      totalRow.eachCell((c) => (c.border = thinTop))
    })
    CX.total = ws.addRow(['ИТОГО CAPEX — очередь 1', '', '', '', '']).number
    const totE = ws.getCell(CX.total, 5)
    totE.value = { formula: `SUM(${itemRows.map((x) => `E${x}`).join(',')})`, result: r.capex.totalEur }
    totE.numFmt = FMT_EUR
    ws.getRow(CX.total).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.border = dblTop })
    const anyP2v = !!params.publicBath?.enabled || p2Mods.some((m) => m.status === 'Активен')
    CX.anyP2 = ws.addRow(['Очередь 2 включена (0/1)', '', '', '', '']).number
    const ap2 = ws.getCell(CX.anyP2, 5)
    ap2.value = {
      formula: `IF(OR(${C.pbOn}="Да",COUNTIFS('Модули'!$D$${MOD.first}:$D$${MOD.last},2,'Модули'!$C$${MOD.first}:$C$${MOD.last},1)>0),1,0)`,
      result: anyP2v ? 1 : 0,
    }
    ap2.font = { ...ARIAL, color: { argb: GREEN } }
    C.anyP2 = `'CAPEX'!$E$${CX.anyP2}`
    for (const rr2 of sharedFlagRows)
      FIX.push({ sheet: 'CAPEX', r: rr2, c: 9, f: C.anyP2, v: anyP2v ? 1 : 0, fmt: '0', style: 'note' })
    CX.p2 = ws.addRow(['ИТОГО CAPEX — очередь 2', '', '', '', '']).number
    const p2e = ws.getCell(CX.p2, 5)
    p2e.value = {
      formula: itemRowsP2.length ? `SUM(${itemRowsP2.map((x) => `E${x}`).join(',')})` : '0',
      result: r.capex.phase2Eur,
    }
    p2e.numFmt = FMT_EUR
    ws.getRow(CX.p2).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.border = thinTop })
    CX.p2adj = ws.addRow(['С буфером оч. 2 (в т.ч. закуп)', '', '', '', '']).number
    const p2ae = ws.getCell(CX.p2adj, 5)
    p2ae.value = { formula: `$E$${CX.p2}*(1+${C.p2Adj})`, result: r.capex.phase2AdjEur }
    p2ae.numFmt = FMT_EUR
    p2ae.font = { ...ARIAL, bold: true, color: { argb: GREEN } }
    CX.adj = ws.addRow(['С буфером сценария', '', '', '', '']).number
    const adjE = ws.getCell(CX.adj, 5)
    adjE.value = { formula: `$E$${CX.total}*(1+${C.capexAdj})`, result: r.capex.adjustedEur }
    adjE.numFmt = FMT_EUR
    adjE.font = { ...ARIAL, bold: true, color: { argb: GREEN } }
    // служебные ячейки: отложенный CAPEX, амортизация
    const landItemRow = itemRows.find((x) => (ws.getCell(x, 1).value as string) === 'Земля / участок') ?? 0
    CX.amortBase = ws.addRow(['Амортизируемая база оч.1', '', '', '', '']).number
    const ab = ws.getCell(CX.amortBase, 5)
    ab.value = {
      formula: `$E$${CX.adj}-${landItemRow ? `$E$${landItemRow}*(1+${C.capexAdj})` : '0'}`,
      result: r.capex.amortizableEur,
    }
    ab.numFmt = FMT_EUR
    ab.font = { ...ARIAL, color: { argb: GREEN } }
    CX.amort = ws.addRow(['Амортизация оч.1, €/мес (старт)', '', '', '', '']).number
    const amE = ws.getCell(CX.amort, 5)
    amE.value = { formula: `$E$${CX.amortBase}*${C.amortRate}`, result: r.capex.monthlyAmort }
    amE.numFmt = FMT_EUR
    amE.font = { ...ARIAL, color: { argb: GREEN } }
    CX.taxDepr = ws.addRow(['Налоговая аморт. оч.1, €/мес', '', '', '', '']).number
    const td = ws.getCell(CX.taxDepr, 5)
    td.value = {
      formula: `$E$${CX.amortBase}*IF(${C.taxDeprOn}="Да",${C.taxDeprRate},${C.amortRate})`,
      result: r.capex.monthlyTaxDepr,
    }
    td.numFmt = FMT_EUR
    td.font = { ...ARIAL, color: { argb: GREEN } }
    CX.unitEur = ws.addRow(['CAPEX за модуль оч.1 (отложенный)', '', '', '', '']).number
    const ue = ws.getCell(CX.unitEur, 5)
    const unitEurV = params.capexItems
      .filter((it) => !it.ifLaundry || params.laundry?.enabled)
      .filter((it) => (it.phase ?? 1) === 1)
      .reduce((s, it) => {
        const m = /^MODULES_COUNT(?::(\d+))?$/.exec(String(it.qty))
        return m ? s + Number(it.priceEur ?? 0) * Number(m[1] ?? 1) : s
      }, 0)
    ue.value = {
      formula: `SUMPRODUCT($D$2:$D$${CX.total - 1},$H$2:$H$${CX.total - 1},($F$2:$F$${CX.total - 1}=1)*1)`,
      result: unitEurV,
    }
    ue.numFmt = FMT_EUR
    ue.font = { ...ARIAL, color: { argb: GREEN } }
    CX.defP1 = ws.addRow(['Отложенный CAPEX оч.1, всего', '', '', '', '']).number
    const dp = ws.getCell(CX.defP1, 5)
    dp.value = {
      formula: `$E$${CX.unitEur}*(1+${C.capexAdj})*SUMPRODUCT(('Модули'!$C$${MOD.first}:$C$${MOD.last})*('Модули'!$D$${MOD.first}:$D$${MOD.last}=1)*('Модули'!$K$${MOD.first}:$K$${MOD.last}>${C.openIdxEff}))`,
      result: r.capex.deferredPhase1Total,
    }
    dp.numFmt = FMT_EUR
    dp.font = { ...ARIAL, color: { argb: GREEN } }
    // бакеты амортизации оч.2: объект → сумма и старт (операц. месяц)
    ws.addRow([])
    const bh = ws.addRow(['Амортизация оч.2 (по объектам)', '', '', '', 'Сумма, €', 'Старт, оп.мес'])
    bh.eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
    const objKeys = [...new Set(params.capexItems.filter((x) => x.phase === 2 && x.object).map((x) => x.object!))]
    const objEur = new Map<string, number>()
    let sharedEurV = 0
    for (const i2 of r.capex.items) {
      if ((i2.phase ?? 1) !== 2) continue
      if (i2.object) objEur.set(i2.object, (objEur.get(i2.object) ?? 0) + i2.eur)
      else sharedEurV += i2.eur
    }
    const startCells: string[] = []
    for (const obj of objKeys) {
      const br = ws.addRow([`  ${obj}`, '', '', '', '', '']).number
      const eurV = objEur.get(obj) ?? 0
      const eurC = ws.getCell(br, 5)
      eurC.value = p2ItemRowRange.first
        ? { formula: `SUMIFS($E$${p2ItemRowRange.first}:$E$${p2ItemRowRange.last},$G$${p2ItemRowRange.first}:$G$${p2ItemRowRange.last},"${obj}")`, result: eurV }
        : { formula: '0', result: 0 }
      eurC.numFmt = FMT_EUR
      eurC.font = { ...ARIAL, color: { argb: GREEN } }
      let sv = 0
      let startF = '0'
      if (obj === 'public') {
        startF = `${C.pbLaunchIdx}-${C.openIdxEff}`
        sv = ymIdx(params.publicBath?.launchDate ?? '2031-01') - openIdxBase - scen.constructionDelayMonths
      } else {
        const n = /^vip(\d+)$/.exec(obj)?.[1] ?? '0'
        const mod = p2Mods[Number(n) - 1]
        startF = `IFERROR(INDEX('Модули'!$K$${MOD.first}:$K$${MOD.last},MATCH(${n},'Модули'!$${L(modP2Col)}$${MOD.first}:$${L(modP2Col)}$${MOD.last},0)),0)-${C.openIdxEff}`
        sv = mod ? ymIdx(mod.launchDate) - openIdxBase - scen.constructionDelayMonths : 0
      }
      const stC = ws.getCell(br, 6)
      stC.value = { formula: startF, result: sv }
      stC.font = { ...ARIAL, color: { argb: GREEN } }
      stC.numFmt = '0'
      startCells.push(`$F$${br}`)
      buckets.push({ label: obj, eurCell: `'CAPEX'!$E$${br}`, startCell: `'CAPEX'!$F$${br}`, v: eurV, sv })
    }
    // общие строки оч.2 (без объекта) + закуп оч.2 — со старта первого объекта
    const shr = ws.addRow(['  общие + закуп оч.2', '', '', '', '', '']).number
    const shE = ws.getCell(shr, 5)
    shE.value = sharedItemRowsP2.length
      ? { formula: `SUM(${sharedItemRowsP2.map((x) => `$E$${x}`).join(',')})`, result: sharedEurV }
      : { formula: '0', result: 0 }
    shE.numFmt = FMT_EUR
    shE.font = { ...ARIAL, color: { argb: GREEN } }
    const shS = ws.getCell(shr, 6)
    const minLaunch = Math.min(...buckets.map((b) => b.sv), Infinity)
    shS.value = startCells.length
      ? { formula: `MIN(${startCells.join(',')})`, result: minLaunch }
      : { formula: '0', result: 0 }
    shS.font = { ...ARIAL, color: { argb: GREEN } }
    shS.numFmt = '0'
    buckets.push({ label: 'shared', eurCell: `'CAPEX'!$E$${shr}`, startCell: `'CAPEX'!$F$${shr}`, v: sharedEurV, sv: minLaunch === Infinity ? 0 : minLaunch })
  }
  const CX$ = (r2: number) => `'CAPEX'!$E$${r2}`

  // ═══ ДРАЙВЕРЫ — помесячные промежуточные величины ═══
  // Строки фиксированы в DR. Колонка k = B+k (k = 0..ops-1).
  const DR = {
    k: 3, absIdx: 4, mo: 5, calYear: 6, yIdx: 7, ramp: 8, growth: 9, infl: 10,
    bathsLoad: 11, glampLoad: 12, modsNow: 13, capAvg: 14, memberRamp: 15,
    mmCount: 16, annualActive: 17, myCount: 18, memberGuests: 19, memberSlots: 20,
    certsSold: 21, certGuests: 22, certSlots: 23, capSlots: 24, slotsPre: 25,
    displacing: 26, slots: 27, scale: 28, guestsBath: 29, pbRamp: 30, pubLoad: 31,
    publicGuests: 32, pbRev: 33, guestsPrePub: 34, guests: 35,
    memberSpend: 36, publicSpend: 37, streamSpend: 38,
    upSt: 39, upMass: 40, upExtra: 41, restCovers: 42, restRev: 43,
    bathsLoadP2: 44, capAvgP1: 45, capAvgP2: 46, slotsP1: 47, slotsP2: 48,
    upStP2: 49, upMassP2: 50, upExtraP2: 51,
  }
  // кеши для result-значений драйверов
  const capAvgOf = (i: number) => {
    const act = params.modules.filter((m) => m.status === 'Активен' && ymIdx(m.launchDate) <= openIdxBase + scen.constructionDelayMonths + i)
    if (act.length) return act.reduce((s, m) => s + m.capacity, 0) / act.length
    const all = params.modules.filter((m) => m.status === 'Активен')
    return all.length ? all.reduce((s, m) => s + m.capacity, 0) / all.length : Infinity
  }
  // Пофазные величины — JS-зеркала движка (revenue.ts)
  const loadBaths = (i: number, ph: 1 | 2) =>
    Math.min(1, params.service.demandMult * (ph === 2 ? scen.bathsLoadP2 : scen.bathsLoad)[r.revenue[i].yearIdx] *
      params.seasonality.baths[r.revenue[i].monthOfYear - 1] * r.revenue[i].ramp)
  const capAvgPhase = (i: number, ph: 1 | 2) => {
    const act = params.modules.filter((m) => (m.phase ?? 1) === ph && m.status === 'Активен' &&
      ymIdx(m.launchDate) <= openIdxBase + scen.constructionDelayMonths + i)
    return act.length ? act.reduce((s, m) => s + m.capacity, 0) / act.length : 0
  }
  const capP = (i: number, ph: 1 | 2) => {
    const v = capAvgPhase(i, ph)
    if (v > 0) return v
    const all = capAvgOf(i)
    return all === Infinity ? 0 : all
  }
  // потенциал модуля (слоты без загрузки, с рампой оч. 2) — как 'Услуги'!pot
  const potOf = (mi: number, i: number): number => {
    const m = modules[mi]
    if (m.status !== 'Активен' || ymIdx(m.launchDate) > openIdxBase + scen.constructionDelayMonths + i) return 0
    const mr = (m.phase ?? 1) === 2
      ? Math.min(1, (openIdxBase + scen.constructionDelayMonths + i - ymIdx(m.launchDate) + 1) / Math.max(1, params.phase2?.rampMonths ?? 1))
      : 1
    return 30 * m.slotsPerDay * m.uptime * m.loadK * mr
  }
  // 'Модули'!$D = очередь: фрагмент SUMPRODUCT-фильтра по фазе
  const phF = (ph: 1 | 2) => `('Модули'!$D$${MOD.first}:$D$${MOD.last}=${ph})`
  const memRamp = (i: number) =>
    (Math.floor(i / 12) === 0 && params.members.enabled && params.units.presaleMode === 'deferred' && params.units.presaleMonths > 0 ? 1 : Math.min(1, (i + 1) / Math.max(1, scen.rampMonths)))
  // Блоки «Услуги»: потенциал модулей / проданные слоты / выручка спек / кол-во
  const SV = {
    pot0: 3,
    sold0: 0,
    rev0: 0,
    cnt0: 0,
  }
  SV.sold0 = SV.pot0 + nMod + 2
  SV.rev0 = SV.sold0 + nMod + 2
  SV.cnt0 = SV.rev0 + nSpec + 2
  {
    const ws = wb.addWorksheet('Драйверы')
    ws.properties.tabColor = { argb: 'FF7F7F7F' }
    const dr = (key: keyof typeof DR | 'title' | 'head', label: string, mk?: (i: number) => NumCell, fmt = '0.000') => {
      const row = key === 'title' ? 1 : key === 'head' ? 2 : DR[key as keyof typeof DR]
      ws.getCell(row, 1).value = label
      ws.getCell(row, 1).font = { ...ARIAL, color: { argb: GREY } }
      if (!mk) return
      for (let i = 0; i < ops; i++) putCell(ws, row, i + 2, mk(i), fmt, 'calc')
    }
    ws.getCell(1, 1).value = 'ДРАЙВЕРЫ — служебный лист, не редактировать'
    ws.getCell(1, 1).font = { ...ARIAL, bold: true }
    ws.getCell(2, 1).value = 'период'
    labels.forEach((l2, i) => {
      ws.getCell(2, i + 2).value = l2
      ws.getCell(2, i + 2).font = { ...ARIAL, bold: true }
    })
    freezeFirst(ws)
    ws.getColumn(1).width = 26
    const D = (row: number, i: number) => `'Драйверы'!${L(i + 2)}$${row}`
    dr('k', 'k (0-базовый)', (i) => i, '0')
    dr('absIdx', 'индекс мес (календ.)', (i) => f(`${C.openIdxEff}+${D(DR.k, i)}`, openIdxBase + scen.constructionDelayMonths + i), '0')
    dr('mo', 'месяц года', (i) => f(`MOD(${D(DR.absIdx, i)}-1,12)+1`, r.revenue[i].monthOfYear), '0')
    dr('calYear', 'календ. год (индекс)', (i) => f(`INT((${D(DR.absIdx, i)}-1)/12)`, Math.floor((openIdxBase + scen.constructionDelayMonths - 1 + i) / 12)), '0')
    dr('yIdx', 'операц. год 0..4', (i) => f(`MIN(4,INT(${D(DR.k, i)}/12))`, r.revenue[i].yearIdx), '0')
    dr('ramp', 'рампа открытия', (i) => f(`MIN(1,(${D(DR.k, i)}+1)/${C.rampM})`, r.revenue[i].ramp))
    dr('growth', 'индекс цен', (i) => f(`(1+${C.priceGrowth})^INT(${D(DR.k, i)}/12)`, Math.pow(1 + scen.priceGrowth, Math.floor(i / 12))))
    dr('infl', 'индекс инфляции', (i) => f(`(1+${C.inflation})^INT(${D(DR.k, i)}/12)`, Math.pow(1 + params.general.inflation, Math.floor(i / 12))))
    dr('bathsLoad', 'загрузка бань', (i) => f(`MIN(1,${C.dm}*INDEX('Сценарии'!$B$${SCr.baths}:$D$${SCr.baths + 4},${D(DR.yIdx, i)}+1,${C.scenIdx})*INDEX(${C.seasB},1,${D(DR.mo, i)})*${D(DR.ramp, i)})`, r.revenue[i].bathsLoad))
    dr('glampLoad', 'загрузка глэмпинга', (i) => f(`MIN(1,${C.dm}*INDEX('Сценарии'!$B$${SCr.glamping}:$D$${SCr.glamping + 4},${D(DR.yIdx, i)}+1,${C.scenIdx})*INDEX(${C.seasG},1,${D(DR.mo, i)})*${D(DR.ramp, i)})`, Math.min(1, params.service.demandMult * scen.glampLoad[r.revenue[i].yearIdx] * params.seasonality.glamping[r.revenue[i].monthOfYear - 1] * r.revenue[i].ramp)))
    dr('modsNow', 'модулей запущено', (i) => f(`SUMPRODUCT(('Модули'!$C$${MOD.first}:$C$${MOD.last})*('Модули'!$K$${MOD.first}:$K$${MOD.last}<=${D(DR.absIdx, i)}))`, params.modules.filter((m) => m.status === 'Активен' && ymIdx(m.launchDate) <= openIdxBase + scen.constructionDelayMonths + i).length), '0')
    dr('capAvg', 'ср. ёмкость запущенных', (i) => f(`IF(${D(DR.modsNow, i)}>0,SUMPRODUCT(('Модули'!$C$${MOD.first}:$C$${MOD.last})*('Модули'!$K$${MOD.first}:$K$${MOD.last}<=${D(DR.absIdx, i)})*('Модули'!$E$${MOD.first}:$E$${MOD.last}))/${D(DR.modsNow, i)},${C.avgCapAll})`, capAvgOf(i) === Infinity ? 0 : capAvgOf(i)))
    dr('memberRamp', 'рампа членов', (i) => f(`IF(AND(${D(DR.yIdx, i)}=0,${C.presold}=1),1,${D(DR.ramp, i)})`, memRamp(i)))
    dr('mmCount', 'членов мес. (кол-во)', (i) => f(`IF(${C.membersOn}="Да",${C.dm}*INDEX('Сценарии'!$B$${SCr.membersMonth}:$D$${SCr.membersMonth + 4},${D(DR.yIdx, i)}+1,${C.scenIdx})*${D(DR.memberRamp, i)},0)`, r.revenue[i].membersMonthCount))
    dr('annualActive', 'годовых членов активно', (i) => f(`IF(${C.membersOn}="Да",${C.dm}*INDEX(${C.annualPlan},1,${D(DR.yIdx, i)}+1)*${D(DR.memberRamp, i)},0)`, params.members.enabled ? params.service.demandMult * (params.units.annualMembersPlan[r.revenue[i].yearIdx] ?? 0) * memRamp(i) : 0))
    dr('myCount', 'годовых членов (продажи/мес)', (i) => f(`${D(DR.annualActive, i)}/12`, params.members.enabled ? (params.service.demandMult * (params.units.annualMembersPlan[r.revenue[i].yearIdx] ?? 0) / 12) * memRamp(i) : 0))
    dr('memberGuests', 'гостей-членов', (i) => f(`IF(AND(${C.membersOn}="Да",${C.consume}="Да"),(${D(DR.mmCount, i)}+${D(DR.annualActive, i)})*${C.visits}*${C.party},0)`, r.revenue[i].memberGuests))
    dr('memberSlots', 'слотов членов', (i) => f(`IF(${D(DR.capAvg, i)}>0,${D(DR.memberGuests, i)}/${D(DR.capAvg, i)},0)`, capAvgOf(i) > 0 && capAvgOf(i) !== Infinity ? r.revenue[i].memberGuests / capAvgOf(i) : 0))
    dr('certsSold', 'сертификатов продано', (i) => f(`IF(${C.certsOn}="Да",${C.certsPerMonth}*${C.dm}*${D(DR.ramp, i)}*INDEX(${C.seasC},1,${D(DR.mo, i)}),0)`, r.revenue[i].certsSold))
    dr('certGuests', 'гостей по сертификатам', (i) => f(`${D(DR.certsSold, i)}*${C.certRedem}*${C.certGuests}`, r.revenue[i].certGuests))
    dr('certSlots', 'слотов сертификатов', (i) => f(`IF(${D(DR.capAvg, i)}>0,${D(DR.certGuests, i)}/${D(DR.capAvg, i)},0)`, capAvgOf(i) > 0 && capAvgOf(i) !== Infinity ? r.revenue[i].certGuests / capAvgOf(i) : 0))
    dr('capSlots', 'ёмкость слотов (потенциал)', (i) => f(`SUM('Услуги'!${L(i + 2)}$${SV.pot0}:${L(i + 2)}$${SV.pot0 + nMod - 1})`, modules.reduce((s, _m, mi) => s + potOf(mi, i), 0)))
    // слоты до вытеснения = Σ потенциал × загрузка СВОЕЙ очереди (оч. 1 ↔ bathsLoad, оч. 2 ↔ bathsLoadP2)
    dr('slotsPre', 'слоты до вытеснения', (i) => f(`SUMPRODUCT('Услуги'!${L(i + 2)}$${SV.pot0}:${L(i + 2)}$${SV.pot0 + nMod - 1}*${phF(1)})*${D(DR.bathsLoad, i)}+SUMPRODUCT('Услуги'!${L(i + 2)}$${SV.pot0}:${L(i + 2)}$${SV.pot0 + nMod - 1}*${phF(2)})*${D(DR.bathsLoadP2, i)}`, modules.reduce((s, m, mi) => s + potOf(mi, i) * loadBaths(i, (m.phase ?? 1) === 2 ? 2 : 1), 0)))
    dr('displacing', 'вытесняющие слоты', (i) => f(`(${D(DR.memberSlots, i)}+${D(DR.certSlots, i)})*${C.peak}`, ((capAvgOf(i) > 0 && capAvgOf(i) !== Infinity ? r.revenue[i].memberGuests / capAvgOf(i) : 0) + (capAvgOf(i) > 0 && capAvgOf(i) !== Infinity ? r.revenue[i].certGuests / capAvgOf(i) : 0)) * (params.members.peakShare ?? 1)))
    dr('slots', 'слоты проданные', (i) => f(`IF(AND(${D(DR.displacing, i)}>0,${D(DR.capSlots, i)}>0),MAX(0,MIN(${D(DR.slotsPre, i)},${D(DR.capSlots, i)}-${D(DR.displacing, i)})),${D(DR.slotsPre, i)})`, r.revenue[i].slots))
    dr('scale', 'масштаб вытеснения', (i) => f(`IF(AND(${D(DR.displacing, i)}>0,${D(DR.capSlots, i)}>0),IF(${D(DR.slotsPre, i)}>0,${D(DR.slots, i)}/${D(DR.slotsPre, i)},1),1)`, r.revenue[i].displacedSlots > 0 && r.revenue[i].bathCounts.reduce((s, b) => s + b, 0) > 0 ? r.revenue[i].slots / Math.max(1e-9, r.revenue[i].bathCounts.reduce((s, b) => s + b, 0)) : 1))
    // гости = Σ проданные слоты × вместимость — проданные уже несут загрузку своей очереди и масштаб вытеснения
    dr('guestsBath', 'гости (бани, платные)', (i) => f(`SUMPRODUCT('Услуги'!${L(i + 2)}$${SV.sold0}:${L(i + 2)}$${SV.sold0 + nMod - 1},'Модули'!$E$${MOD.first}:$E$${MOD.last})`, r.revenue[i].bathCounts.reduce((s, b, mi) => s + b * modules[mi].capacity, 0)))
    dr('pbRamp', 'рампа обществ. бани', (i) => f(`IF(AND(${C.pbOn}="Да",${C.pbLaunchIdx}<=${D(DR.absIdx, i)}),MIN(1,(${D(DR.absIdx, i)}-${C.pbLaunchIdx}+1)/${C.p2Ramp}),0)`, params.publicBath?.enabled && ymIdx(params.publicBath.launchDate) <= openIdxBase + scen.constructionDelayMonths + i ? Math.min(1, (openIdxBase + scen.constructionDelayMonths + i - ymIdx(params.publicBath.launchDate) + 1) / Math.max(1, params.phase2?.rampMonths ?? 1)) : 0))
    dr('pubLoad', 'загрузка обществ. бани', (i) => f(`MIN(1,${C.dm}*INDEX('Сценарии'!$B$${SCr.publicBath}:$D$${SCr.publicBath + 4},${D(DR.yIdx, i)}+1,${C.scenIdx})*INDEX(${C.seasB},1,${D(DR.mo, i)})*${D(DR.pbRamp, i)})`, r.revenue[i].publicGuests > 0 ? Math.min(1, params.service.demandMult * scen.publicBathLoad[r.revenue[i].yearIdx] * params.seasonality.baths[r.revenue[i].monthOfYear - 1] * Math.min(1, (openIdxBase + scen.constructionDelayMonths + i - ymIdx(params.publicBath!.launchDate) + 1) / Math.max(1, params.phase2?.rampMonths ?? 1))) : 0))
    dr('publicGuests', 'гости обществ. бани', (i) => f(`30*${C.pbCap}*${D(DR.pubLoad, i)}`, r.revenue[i].publicGuests))
    dr('pbRev', 'выручка обществ. бани', (i) => f(`${D(DR.publicGuests, i)}*${C.pbTicket}*${D(DR.growth, i)}`, r.revenue[i].publicBath))
    dr('guestsPrePub', 'гости до обществ. (для F&B)', (i) => f(`${D(DR.guestsBath, i)}+${D(DR.memberGuests, i)}+${D(DR.certGuests, i)}`, r.revenue[i].guests - r.revenue[i].publicGuests))
    dr('guests', 'гости итого', (i) => f(`${D(DR.guestsPrePub, i)}+${D(DR.publicGuests, i)}`, r.revenue[i].guests))
    dr('memberSpend', 'сервисный чек членов, €', (i) => f(`${D(DR.memberGuests, i)}*${C.memberSpend}*${D(DR.growth, i)}`, r.revenue[i].memberServices))
    dr('publicSpend', 'сервисный чек обществ., €', (i) => f(`${D(DR.publicGuests, i)}*${C.pbSpend}*${D(DR.growth, i)}`, r.revenue[i].publicGuests * (params.publicBath?.serviceSpendPerVisit ?? 0) * Math.pow(1 + scen.priceGrowth, Math.floor(i / 12))))
    dr('streamSpend', 'сервисный чек итого, €', (i) => f(`${D(DR.memberSpend, i)}+${D(DR.publicSpend, i)}`, r.revenue[i].memberServices + r.revenue[i].publicGuests * (params.publicBath?.serviceSpendPerVisit ?? 0) * Math.pow(1 + scen.priceGrowth, Math.floor(i / 12))))
    dr('upSt', 'реализация парений', (i) => f(`${C.uptakeEff}*IF(${C.svcLoads}="Да",MIN(1,INDEX('Сценарии'!$B$${SCr.steam}:$D$${SCr.steam + 4},${D(DR.yIdx, i)}+1,${C.scenIdx})),1)`, scen.effectiveUptake * (params.service.serviceLoads ? Math.min(1, scen.steamLoad[r.revenue[i].yearIdx]) : 1)))
    dr('upMass', 'реализация массажа', (i) => f(`${C.uptakeEff}*IF(${C.svcLoads}="Да",MIN(1,INDEX('Сценарии'!$B$${SCr.massage}:$D$${SCr.massage + 4},${D(DR.yIdx, i)}+1,${C.scenIdx})),1)`, scen.effectiveUptake * (params.service.serviceLoads ? Math.min(1, scen.massageLoad[r.revenue[i].yearIdx]) : 1)))
    dr('upExtra', 'реализация допов', (i) => f(`${C.uptakeEff}*IF(${C.svcLoads}="Да",MIN(1,INDEX('Сценарии'!$B$${SCr.extra}:$D$${SCr.extra + 4},${D(DR.yIdx, i)}+1,${C.scenIdx})),1)`, scen.effectiveUptake * (params.service.serviceLoads ? Math.min(1, Math.max(0, scen.extraLoad[r.revenue[i].yearIdx])) : 1)))
    dr('restCovers', 'посадки ресторана', (i) => f(`IF(AND(${C.restOn}="Да",${D(DR.pbRamp, i)}>0,INDEX('Сценарии'!$B$${SCr.restaurant}:$D$${SCr.restaurant + 4},${D(DR.yIdx, i)}+1,${C.scenIdx})>0),30*${C.restSeats}*${C.restTurns}*MIN(1,${C.dm}*INDEX('Сценарии'!$B$${SCr.restaurant}:$D$${SCr.restaurant + 4},${D(DR.yIdx, i)}+1,${C.scenIdx})*INDEX(${C.seasB},1,${D(DR.mo, i)})*${D(DR.pbRamp, i)}),0)`, r.revenue[i].restCovers))
    dr('restRev', 'выручка ресторана', (i) => f(`${D(DR.restCovers, i)}*${C.restCheck}*${D(DR.infl, i)}`, r.revenue[i].restaurant))
    // ─── Очередь 2: пофазные загрузки и базы услуг ───
    dr('bathsLoadP2', 'загрузка бань оч. 2', (i) => f(`MIN(1,${C.dm}*INDEX('Сценарии'!$B$${SCr.bathsP2}:$D$${SCr.bathsP2 + 4},${D(DR.yIdx, i)}+1,${C.scenIdx})*INDEX(${C.seasB},1,${D(DR.mo, i)})*${D(DR.ramp, i)})`, loadBaths(i, 2)))
    dr('capAvgP1', 'ср. ёмкость оч. 1', (i) => f(`IF(SUMPRODUCT('Модули'!$C$${MOD.first}:$C$${MOD.last}*${phF(1)}*('Модули'!$K$${MOD.first}:$K$${MOD.last}<=${D(DR.absIdx, i)}))>0,SUMPRODUCT('Модули'!$C$${MOD.first}:$C$${MOD.last}*${phF(1)}*('Модули'!$K$${MOD.first}:$K$${MOD.last}<=${D(DR.absIdx, i)})*'Модули'!$E$${MOD.first}:$E$${MOD.last})/SUMPRODUCT('Модули'!$C$${MOD.first}:$C$${MOD.last}*${phF(1)}*('Модули'!$K$${MOD.first}:$K$${MOD.last}<=${D(DR.absIdx, i)})),${C.avgCapAll})`, capP(i, 1)))
    dr('capAvgP2', 'ср. ёмкость оч. 2', (i) => f(`IF(SUMPRODUCT('Модули'!$C$${MOD.first}:$C$${MOD.last}*${phF(2)}*('Модули'!$K$${MOD.first}:$K$${MOD.last}<=${D(DR.absIdx, i)}))>0,SUMPRODUCT('Модули'!$C$${MOD.first}:$C$${MOD.last}*${phF(2)}*('Модули'!$K$${MOD.first}:$K$${MOD.last}<=${D(DR.absIdx, i)})*'Модули'!$E$${MOD.first}:$E$${MOD.last})/SUMPRODUCT('Модули'!$C$${MOD.first}:$C$${MOD.last}*${phF(2)}*('Модули'!$K$${MOD.first}:$K$${MOD.last}<=${D(DR.absIdx, i)})),${C.avgCapAll})`, capP(i, 2)))
    dr('slotsP1', 'слоты проданные оч. 1', (i) => f(`SUMPRODUCT('Услуги'!${L(i + 2)}$${SV.sold0}:${L(i + 2)}$${SV.sold0 + nMod - 1}*${phF(1)})`, r.revenue[i].slotsP1))
    dr('slotsP2', 'слоты проданные оч. 2', (i) => f(`SUMPRODUCT('Услуги'!${L(i + 2)}$${SV.sold0}:${L(i + 2)}$${SV.sold0 + nMod - 1}*${phF(2)})`, r.revenue[i].slotsP2))
    dr('upStP2', 'реализация парений оч. 2', (i) => f(`${C.uptakeEff}*IF(${C.svcLoads}="Да",MIN(1,INDEX('Сценарии'!$B$${SCr.steamP2}:$D$${SCr.steamP2 + 4},${D(DR.yIdx, i)}+1,${C.scenIdx})),1)`, scen.effectiveUptake * (params.service.serviceLoads ? Math.min(1, scen.steamLoadP2[r.revenue[i].yearIdx]) : 1)))
    dr('upMassP2', 'реализация массажа оч. 2', (i) => f(`${C.uptakeEff}*IF(${C.svcLoads}="Да",MIN(1,INDEX('Сценарии'!$B$${SCr.massageP2}:$D$${SCr.massageP2 + 4},${D(DR.yIdx, i)}+1,${C.scenIdx})),1)`, scen.effectiveUptake * (params.service.serviceLoads ? Math.min(1, scen.massageLoadP2[r.revenue[i].yearIdx]) : 1)))
    dr('upExtraP2', 'реализация допов оч. 2', (i) => f(`${C.uptakeEff}*IF(${C.svcLoads}="Да",MIN(1,INDEX('Сценарии'!$B$${SCr.extraP2}:$D$${SCr.extraP2 + 4},${D(DR.yIdx, i)}+1,${C.scenIdx})),1)`, scen.effectiveUptake * (params.service.serviceLoads ? Math.min(1, Math.max(0, scen.extraLoadP2[r.revenue[i].yearIdx])) : 1)))
  }
  const DD = (row: number, i: number) => `'Драйверы'!${L(i + 2)}$${row}`

  // ═══ УСЛУГИ — расчёт помодульных слотов и потоков спек ═══
  {
    const ws = wb.addWorksheet('Услуги')
    ws.properties.tabColor = { argb: 'FF7F7F7F' }
    ws.getCell(1, 1).value = 'РАСЧЁТ УСЛУГ — служебный лист, не редактировать'
    ws.getCell(1, 1).font = { ...ARIAL, bold: true }
    ws.getCell(2, 1).value = 'период'
    labels.forEach((l2, i) => {
      ws.getCell(2, i + 2).value = l2
      ws.getCell(2, i + 2).font = { ...ARIAL, bold: true }
    })
    freezeFirst(ws)
    ws.getColumn(1).width = 30
    // потенциал модулей (слоты без фактора загрузки)
    ws.getCell(SV.pot0 - 1, 1).value = 'Потенциал слотов по модулям'
    ws.getCell(SV.pot0 - 1, 1).font = { ...ARIAL, italic: true }
    modules.forEach((m, mi) => {
      const rN = SV.pot0 + mi
      ws.getCell(rN, 1).value = `Модуль #${m.id}`
      ws.getCell(rN, 1).font = { ...ARIAL, color: { argb: GREY } }
      const mrow = MOD.first + mi
      for (let i = 0; i < ops; i++) {
        const abs = DD(DR.absIdx, i)
        const rampExpr = `(('Модули'!$D$${mrow}=2)*MIN(1,(${abs}-'Модули'!$K$${mrow}+1)/${C.p2Ramp})+('Модули'!$D$${mrow}<>2))`
        const v = m.status === 'Активен' && ymIdx(m.launchDate) <= openIdxBase + scen.constructionDelayMonths + i
          ? 30 * m.slotsPerDay * m.uptime * m.loadK * ((m.phase ?? 1) === 2 ? Math.min(1, (openIdxBase + scen.constructionDelayMonths + i - ymIdx(m.launchDate) + 1) / Math.max(1, params.phase2?.rampMonths ?? 1)) : 1)
          : 0
        putCell(ws, rN, i + 2, {
          f: `IF(AND('Модули'!$C$${mrow}=1,'Модули'!$K$${mrow}<=${abs}),30*'Модули'!$F$${mrow}*'Модули'!$G$${mrow}*'Модули'!$H$${mrow}*${rampExpr},0)`,
          v,
        }, '0.0')
      }
    })
    // проданные слоты (после загрузки и вытеснения)
    ws.getCell(SV.sold0 - 1, 1).value = 'Проданные слоты по модулям'
    ws.getCell(SV.sold0 - 1, 1).font = { ...ARIAL, italic: true }
    modules.forEach((m, mi) => {
      const rN = SV.sold0 + mi
      ws.getCell(rN, 1).value = `Модуль #${m.id} — продано`
      ws.getCell(rN, 1).font = { ...ARIAL, color: { argb: GREY } }
      for (let i = 0; i < ops; i++) {
        putCell(ws, rN, i + 2, {
          f: `${L(i + 2)}$${SV.pot0 + mi}*IF('Модули'!$D$${MOD.first + mi}=2,${DD(DR.bathsLoadP2, i)},${DD(DR.bathsLoad, i)})*${DD(DR.scale, i)}`,
          v: r.revenue[i].bathCounts[mi] ?? 0,
        }, '0.0')
      }
    })
    // выручка по спецификациям
    ws.getCell(SV.rev0 - 1, 1).value = 'Выручка по спецификациям'
    ws.getCell(SV.rev0 - 1, 1).font = { ...ARIAL, italic: true }
    services.forEach((s, si) => {
      const rN = SV.rev0 + si
      const srow = SP0 + si
      ws.getCell(rN, 1).value = `${s.code} · ${s.direction}`
      ws.getCell(rN, 1).font = { ...ARIAL, color: { argb: GREY } }
      for (let i = 0; i < ops; i++) {
        let fo = '0'
        let v = 0
        const p_ = `'Спеки'!$D$${srow}`
        const w_ = `'Спеки'!$E$${srow}`
        // база услуг пофазная: слоты оч.1 × ср.ёмкость оч.1 × реализация оч.1
        // + то же для оч. 2 — загрузки услуг у очередей свои
        const svcPh = (up1: number, up2: number) =>
          `(${DD(DR.slotsP1, i)}*${DD(DR.capAvgP1, i)}*${DD(up1, i)}+${DD(DR.slotsP2, i)}*${DD(DR.capAvgP2, i)}*${DD(up2, i)})`
        if (s.direction === 'Парения') {
          const j = services.filter((x) => x.direction === 'Парения').indexOf(s)
          v = r.revenue[i].steam[j] ?? 0
          fo = `IF(${C.swpSteam}>0,${svcPh(DR.upSt, DR.upStP2)}*((1-${C.walletExtraShare})*${C.depSteam}*${w_}*${p_}/${C.swpSteam}+${C.upgradeShare}*${w_}*(${p_}-${C.depSteam}))*${DD(DR.growth, i)}+IF(${C.baseW}>0,${DD(DR.streamSpend, i)}*${C.shSteam}*${w_}*${p_}/${C.swpSteam},0),0)`
        } else if (s.direction === 'Массаж') {
          const j = services.filter((x) => x.direction === 'Массаж').indexOf(s)
          v = r.revenue[i].massage[j] ?? 0
          fo = `IF(${C.swpMass}>0,${svcPh(DR.upMass, DR.upMassP2)}*((1-${C.walletExtraShare})*${C.depMass}*${w_}*${p_}/${C.swpMass}+${C.upgradeShare}*${w_}*(${p_}-${C.depMass}))*${DD(DR.growth, i)}+IF(${C.baseW}>0,${DD(DR.streamSpend, i)}*${C.shMass}*${w_}*${p_}/${C.swpMass},0),0)`
        } else if (s.direction === 'Доп. услуги') {
          const j = services.filter((x) => x.direction === 'Доп. услуги').indexOf(s)
          v = r.revenue[i].extra[j] ?? 0
          fo = `IF(${C.swpExtra}>0,${svcPh(DR.upExtra, DR.upExtraP2)}*${C.walletExtraShare}*${C.depBase}*${w_}*${p_}/${C.swpExtra}*${DD(DR.growth, i)}+IF(${C.baseW}>0,${DD(DR.streamSpend, i)}*${C.shExtra}*${w_}*${p_}/${C.swpExtra},0),0)`
        }
        putCell(ws, rN, i + 2, fo === '0' ? v : { f: fo, v }, FMT_EUR2)
      }
    })
    // количество услуг (counts) — база списаний и KPI
    ws.getCell(SV.cnt0 - 1, 1).value = 'Количество услуг по спецификациям'
    ws.getCell(SV.cnt0 - 1, 1).font = { ...ARIAL, italic: true }
    services.forEach((s, si) => {
      const rN = SV.cnt0 + si
      const srow = SP0 + si
      ws.getCell(rN, 1).value = `${s.code} · кол-во`
      ws.getCell(rN, 1).font = { ...ARIAL, color: { argb: GREY } }
      for (let i = 0; i < ops; i++) {
        if (s.direction === 'Аренда бани') {
          const j = rentalSpecs.indexOf(s)
          const specNum = si + 1
          // кол-во = слоты модулей, назначенных этой спеке
          let cnt = 0
          modules.forEach((m, mi) => {
            const caps = rentalSpecs.map((x) => x.capacity ?? Infinity)
            let t = caps.findIndex((c2) => m.capacity <= c2)
            if (t < 0) t = rentalSpecs.length - 1
            if (t === j) cnt += r.revenue[i].bathCounts[mi] ?? 0
          })
          putCell(ws, rN, i + 2, {
            f: modules.map((_, mi) => `IF('Модули'!$${L(modSpecRowCol)}$${MOD.first + mi}=${specNum},${L(i + 2)}$${SV.sold0 + mi},0)`).join('+'),
            v: cnt,
          }, '0.0')
        } else {
          const cnt = s.price * Math.pow(1 + scen.priceGrowth, Math.floor(i / 12)) > 0
            ? ((r.revenue[i].serviceCounts[s.code] ?? 0))
            : 0
          putCell(ws, rN, i + 2, {
            f: `IF('Спеки'!$D$${srow}*${DD(DR.growth, i)}>0,${L(i + 2)}$${SV.rev0 + si}/('Спеки'!$D$${srow}*${DD(DR.growth, i)}),0)`,
            v: cnt,
          }, '0.0')
        }
      }
    })
  }

  // ═══ СПИСАНИЕ — спековое потребление материалов ═══
  const SUSE = { first: 3, itemRows: [] as { specIdx: number; code: string; qty: number; article: string; row: number }[] }
  {
    const ws = wb.addWorksheet('Списание')
    ws.properties.tabColor = { argb: 'FF7F7F7F' }
    ws.getCell(1, 1).value = 'СПЕКОВОЕ СПИСАНИЕ МАТЕРИАЛОВ — служебный лист'
    ws.getCell(1, 1).font = { ...ARIAL, bold: true }
    ws.getCell(2, 1).value = 'позиция'
    ws.getCell(2, 2).value = 'кол-во/услугу'
    ws.getCell(2, 3).value = '€/ед (эфф.)'
    ws.getCell(2, 4).value = 'статья'
    labels.forEach((l2, i) => {
      ws.getCell(2, i + 5).value = l2
      ws.getCell(2, i + 5).font = { ...ARIAL, bold: true }
    })
    ws.getCell(2, 2).font = { ...ARIAL, bold: true }
    ws.getCell(2, 3).font = { ...ARIAL, bold: true }
    ws.getCell(2, 4).font = { ...ARIAL, bold: true }
    freezeFirst(ws)
    ws.getColumn(1).width = 30
    let rN = SUSE.first
    const matItems: { s: ServiceSpec; si: number; code: string; qty: number }[] = []
    services.forEach((s, si) =>
      s.items.forEach((it) => {
        if (it.kind === 'material' && it.code && (it.qty ?? 0) > 0) matItems.push({ s, si, code: it.code, qty: it.qty! })
      }),
    )
    for (const mi of matItems) {
      const m = items.find((x) => x.code === mi.code)
      const effCost = m ? (params.laundry?.enabled && m.ownPrice != null ? m.ownPrice : landedCost(m)) : 0
      const article = specArticleOf(mi.code)
      ws.getCell(rN, 1).value = `${mi.s.code} → ${mi.code}`
      ws.getCell(rN, 1).font = { ...ARIAL, color: { argb: GREY } }
      const qc = ws.getCell(rN, 2)
      qc.value = mi.qty
      qc.font = FONT.input as ExcelJS.Font
      qc.numFmt = '0.00'
      const cc = ws.getCell(rN, 3)
      cc.value = {
        formula: `IFERROR(VLOOKUP("${mi.code}",'Номенклатура'!$A$${NOM.first}:$S$${NOM.last},19,0),0)`,
        result: effCost,
      }
      cc.numFmt = FMT_EUR2
      cc.font = { ...ARIAL }
      const ac = ws.getCell(rN, 4)
      ac.value = {
        formula: `IFERROR(VLOOKUP("${mi.code}",'Номенклатура'!$A$${NOM.first}:$T$${NOM.last},20,0),"Материалы услуг")`,
        result: article,
      }
      ac.font = { ...ARIAL }
      // месячное потребление: qty × count спеки
      // counts по спеке mi.si — блок cnt на «Услуги»
      // для аренды count уже есть; для прочих — тоже.
      const cntRow = SV.cnt0 + mi.si
      // кеш: сколько позиции списывается по месяцам = qty × count(spec)
      const specQtyK = (k: number) => {
        const dir = mi.s.direction
        const dirSpecs = services.filter((x) => x.direction === dir)
        const j = dirSpecs.indexOf(mi.s)
        if (dir === 'Аренда бани') {
          // dirCounts аренды — по баням
          const caps = dirSpecs.map((x) => x.capacity ?? Infinity)
          let cnt = 0
          modules.forEach((mod, modI) => {
            const bc = r.revenue[k].bathCounts[modI] ?? 0
            if (bc <= 0) return
            let t = caps.findIndex((c2) => mod.capacity <= c2)
            if (t < 0) t = dirSpecs.length - 1
            if (t === j) cnt += bc
          })
          return cnt
        }
        return r.revenue[k].serviceCounts[dirSpecs[j].code] ?? 0
      }
      for (let i = 0; i < ops; i++) {
        putCell(ws, rN, i + 5, {
          f: `$B$${rN}*'Услуги'!${L(i + 2)}$${cntRow}`,
          v: mi.qty * specQtyK(i),
        }, '0.0')
      }
      SUSE.itemRows.push({ specIdx: mi.si, code: mi.code, qty: mi.qty, article, row: rN })
      rN++
    }
    C.suseR0 = String(SUSE.first)
    C.suseRN = String(rN - 1)
  }

  // ═══ ВЫРУЧКА ═══
  const specRevRows = (dir: string) =>
    services.map((s, si) => ({ s, si })).filter((x) => x.s.direction === dir).map((x) => SV.rev0 + x.si)
  const sumSpecRev = (dir: string, col: string) => {
    const rows = specRevRows(dir)
    return rows.length ? `SUM(${rows.map((rr) => `'Услуги'!$${col}$${rr}`).join(',')})` : '0'
  }
  const REV: Record<string, number> = {}
  {
    const rows: MonthRow[] = [
      {
        label: 'Аренда банных комплексов',
        cells: r.revenue.map((m, i) => ({
          f: `SUMPRODUCT('Услуги'!${L(i + 2)}$${SV.sold0}:${L(i + 2)}$${SV.sold0 + nMod - 1},'Модули'!$M$${MOD.first}:$M$${MOD.last})*${DD(DR.growth, i)}`,
          v: m.rental,
        })),
      },
      { label: 'Парения', cells: r.revenue.map((m, i) => f(`${sumSpecRev('Парения', L(i + 2))}`, m.steamTotal)) },
      { label: 'Массаж', cells: r.revenue.map((m, i) => f(`${sumSpecRev('Массаж', L(i + 2))}`, m.massageTotal)) },
      { label: 'Доп. услуги', cells: r.revenue.map((m, i) => f(`${sumSpecRev('Доп. услуги', L(i + 2))}`, m.extraTotal)) },
      {
        label: 'Глэмпинг',
        cells: r.revenue.map((m, i) => ({
          f: `IF(${C.glampOn}="Да",30*(${C.glampSmallN}*${DD(DR.glampLoad, i)}*${C.pGlampS}+${C.glampBigN}*${DD(DR.glampLoad, i)}*${C.pGlampB})*${DD(DR.growth, i)},0)`,
          v: m.glamping,
        })),
      },
      {
        label: 'Членства (мес.)',
        cells: r.revenue.map((m, i) => f(`${DD(DR.mmCount, i)}*${C.pMemberM}*${DD(DR.growth, i)}`, m.membersMonth)),
      },
      {
        label: 'Членства (годовые)',
        cells: r.revenue.map((m, i) => f(`${DD(DR.myCount, i)}*${C.pMemberY}*${DD(DR.growth, i)}`, m.membersYear)),
      },
      {
        label: 'Сертификаты',
        cells: r.revenue.map((m, i) => f(`${DD(DR.certsSold, i)}*${C.pCert}*${DD(DR.growth, i)}`, m.certificates)),
      },
      {
        label: 'Членства + сертификаты',
        bold: true, border: 'top',
        cells: r.revenue.map((m, i) => ({
          f: `${L(i + 2)}${1 + 8 - 3}+${L(i + 2)}${1 + 9 - 3}`, v: m.membershipTotal, // placeholder, patched below
        })),
      },
      {
        label: 'F&B',
        cells: r.revenue.map((m, i) => ({
          f: `IF(${C.fbOn}="Да",${DD(DR.guestsPrePub, i)}*${C.pFB}*${DD(DR.growth, i)},0)`,
          v: m.fb,
        })),
      },
      { label: 'Общественная баня (оч.2)', cells: r.revenue.map((m, i) => f(`${DD(DR.pbRev, i)}`, m.publicBath)) },
      { label: 'Ресторан (оч.2)', cells: r.revenue.map((m, i) => f(`${DD(DR.restRev, i)}`, m.restaurant)) },
      {
        label: 'ИТОГО выручка (брутто)',
        bold: true, border: 'double',
        cells: r.revenue.map((m, i) => ({ f: 'TOT', v: m.total })),
      },
      {
        label: 'Гостей за месяц',
        cells: r.revenue.map((m, i) => f(`${DD(DR.guests, i)}`, m.guests)),
        fmt: '#,##0', style: 'note',
      },
      {
        label: 'Продано слотов',
        cells: r.revenue.map((m, i) => f(`${DD(DR.slots, i)}`, m.slots)),
        fmt: '#,##0', style: 'note',
      },
    ]
    const { ws, rows: rm } = monthSheet(wb, 'Выручка', labels, rows, 'FF2E7D32')
    for (const [key, label] of [
      ['rental', 'Аренда банных комплексов'], ['steam', 'Парения'], ['massage', 'Массаж'],
      ['extra', 'Доп. услуги'], ['glamp', 'Глэмпинг'], ['membM', 'Членства (мес.)'],
      ['membY', 'Членства (годовые)'], ['certs', 'Сертификаты'], ['membT', 'Членства + сертификаты'],
      ['fb', 'F&B'], ['pubBath', 'Общественная баня (оч.2)'], ['rest', 'Ресторан (оч.2)'],
      ['total', 'ИТОГО выручка (брутто)'], ['guests', 'Гостей за месяц'], ['slots', 'Продано слотов'],
    ] as const) REV[key] = rm.get(label)!
    // итоговые формулы: сумма компонент
    for (let i = 0; i < ops; i++) {
      const col = L(i + 2)
      const mt = ws.getCell(REV.membT, i + 2)
      mt.value = {
        formula: `${col}${REV.membM}+${col}${REV.membY}+${col}${REV.certs}`,
        result: r.revenue[i].membershipTotal,
      }
      const tt = ws.getCell(REV.total, i + 2)
      tt.value = {
        formula: `${col}${REV.rental}+${col}${REV.steam}+${col}${REV.massage}+${col}${REV.extra}+${col}${REV.glamp}+${col}${REV.membT}+${col}${REV.fb}+${col}${REV.pubBath}+${col}${REV.rest}`,
        result: r.revenue[i].total,
      }
    }
  }
  const V = (key: string, i: number) => `'Выручка'!${L(i + 2)}$${REV[key]}`

  // ═══ OPEX ═══
  const OPX: Record<string, number> = {}
  {
    const rows: MonthRow[] = []
    rows.push({ label: 'ПОСТОЯННЫЕ', cells: new Array(ops).fill(null), section: true })
    const fixedStartRow = rows.length + 2 // строка первой статьи в таблице
    params.opexFixed.forEach((fx, j) => {
      const dopRow = Number(C.opexRow0) + j
      rows.push({
        label: `  ${fx.name}`,
        cells: r.opex.map((m, i) => ({
          f: `IF('Допущения'!$E$${dopRow}>0,MAX('Допущения'!$B$${dopRow}*(1+'Допущения'!$D$${dopRow}*(${C.energyMult}-1))*IF('Допущения'!$C$${dopRow}=1,${DD(DR.modsNow, i)},1)*${DD(DR.infl, i)},'Допущения'!$E$${dopRow}*${V('total', i)}),'Допущения'!$B$${dopRow}*(1+'Допущения'!$D$${dopRow}*(${C.energyMult}-1))*IF('Допущения'!$C$${dopRow}=1,${DD(DR.modsNow, i)},1)*${DD(DR.infl, i)})`,
          v: m.fixed[j] ?? 0,
        })),
      })
    })
    rows.push({
      label: 'Итого постоянные', bold: true, border: 'top',
      cells: r.opex.map((m, i) => ({ f: `SUM(${L(i + 2)}${fixedStartRow}:${L(i + 2)}${fixedStartRow + params.opexFixed.length - 1})`, v: m.fixedTotal })),
    })
    rows.push({ label: 'IT / ПОДПИСКИ', cells: new Array(ops).fill(null), section: true })
    const itStartRow = rows.length + 2
    params.it.opex.forEach((x, j) => {
      const dopRow = Number(C.itRow0) + j
      rows.push({
        label: `  ${x.name}`,
        cells: r.opex.map((m, i) => ({
          f: `IF(${C.itOn}="Да",'Допущения'!$B$${dopRow}*${DD(DR.infl, i)},0)`,
          v: m.it[j]?.amount ?? 0,
        })),
      })
    })
    rows.push({
      label: 'Итого IT', bold: true, border: 'top',
      cells: r.opex.map((m, i) => ({ f: `SUM(${L(i + 2)}${itStartRow}:${L(i + 2)}${itStartRow + params.it.opex.length - 1})`, v: m.itTotal })),
    })
    rows.push({
      label: 'Аренда земли (операционка)',
      cells: r.opex.map((m, i) => f(`IF(${C.landLeaseF}=1,${C.landRent}*${DD(DR.infl, i)},0)`, m.landRent)),
    })
    rows.push({ label: 'ПЕРЕМЕННЫЕ / НОМЕНКЛАТУРА', cells: new Array(ops).fill(null), section: true })
    const varStartRow = rows.length + 2
    varArticles.forEach((a, j) => {
      const artRow = NOM.artFirst + j
      // спековое списание: Σ кол-во×эфф.цена по строкам Списание с этой статьёй
      const specF = `'Списание'!${L(0)}` // placeholder
      void specF
      const suseRange = `'Списание'!$D$${SUSE.first}:$D$${Number(C.suseRN)}`
      const specSpend = SUSE.itemRows.length
        ? `SUMPRODUCT('Списание'!${L(0 + 5)}$${SUSE.first}:$${L(0 + 5)}$${Number(C.suseRN)},'Списание'!$C$${SUSE.first}:$C$${Number(C.suseRN)},(${suseRange}="X")*1)`
        : '0'
      void specSpend
      rows.push({
        label: `  ${a}`,
        cells: r.opex.map((m, i) => {
          const col5 = L(i + 5) // колонка месяца на «Списание»
          const specPart = SUSE.itemRows.length
            ? `SUMPRODUCT('Списание'!${col5}$${SUSE.first}:${col5}$${Number(C.suseRN)},'Списание'!$C$${SUSE.first}:$C$${Number(C.suseRN)},('Списание'!$D$${SUSE.first}:$D$${Number(C.suseRN)}="${a.replace(/"/g, '""')}")*1)`
            : '0'
          return {
            f: `(${DD(DR.slots, i)}*'Номенклатура'!$B$${artRow}+${DD(DR.guests, i)}*'Номенклатура'!$C$${artRow}+'Номенклатура'!$D$${artRow}+${specPart})*${DD(DR.infl, i)}`,
            v: m.variable.find((x) => x.article === a)?.amount ?? 0,
          }
        }),
      })
    })
    rows.push({
      label: 'Итого переменные', bold: true, border: 'top',
      cells: r.opex.map((m, i) => ({ f: `SUM(${L(i + 2)}${varStartRow}:${L(i + 2)}${varStartRow + varArticles.length - 1})`, v: m.variableTotal })),
    })
    rows.push({ label: 'ПРОЦЕНТНЫЕ', cells: new Array(ops).fill(null), section: true })
    const pctStartRow = rows.length + 2
    rows.push({ label: '  Эквайринг', cells: r.opex.map((m, i) => f(`${C.pctAcq}*${V('total', i)}`, m.pct.acquiring)) })
    rows.push({ label: '  Ремонт и содержание', cells: r.opex.map((m, i) => f(`${C.pctMaint}*${V('total', i)}`, m.pct.maintenance)) })
    rows.push({ label: '  Себестоимость F&B', cells: r.opex.map((m, i) => f(`IF(${C.fbOn}="Да",${C.fbFoodPct}*${V('fb', i)},0)`, m.pct.fbCost)) })
    rows.push({ label: '  Себестоимость ресторана', cells: r.opex.map((m, i) => f(`IF(${C.restOn}="Да",${C.restFoodPct}*${V('rest', i)},0)`, m.pct.restCost)) })
    rows.push({ label: '  OTA-комиссия глэмпинга', cells: r.opex.map((m, i) => f(`IF(${C.otaOn}="Да",${V('glamp', i)}*${C.otaShare}*${C.otaComm},0)`, m.pct.ota)) })
    rows.push({
      label: 'Итого процентные', bold: true, border: 'top',
      cells: r.opex.map((m, i) => ({ f: `SUM(${L(i + 2)}${pctStartRow}:${L(i + 2)}${pctStartRow + 4})`, v: m.pctTotal })),
    })
    rows.push({
      label: 'ИТОГО OPEX', bold: true, border: 'double',
      cells: r.opex.map((m, i) => ({ f: 'TOT', v: m.total })),
    })
    const { ws, rows: rm } = monthSheet(wb, 'OPEX', labels, rows, 'FFC62828')
    const landRow = rm.get('Аренда земли (операционка)')!
    OPX.fixedT = rm.get('Итого постоянные')!
    OPX.itT = rm.get('Итого IT')!
    OPX.land = landRow
    OPX.varT = rm.get('Итого переменные')!
    OPX.pctT = rm.get('Итого процентные')!
    OPX.total = rm.get('ИТОГО OPEX')!
    for (let i = 0; i < ops; i++) {
      const col = L(i + 2)
      ws.getCell(OPX.total, i + 2).value = {
        formula: `${col}${OPX.fixedT}+${col}${OPX.itT}+${col}${OPX.land}+${col}${OPX.varT}+${col}${OPX.pctT}`,
        result: r.opex[i].total,
      }
    }
  }
  const O = (key: string, i: number) => `'OPEX'!${L(i + 2)}$${OPX[key]}`

  // ═══ ФОТ ═══
  const FOT: Record<string, number> = {}
  {
    const rows: MonthRow[] = []
    rows.push({ label: 'ОКЛАДЫ ПО РОЛЯМ', cells: new Array(ops).fill(null), section: true })
    params.fot.roles.forEach((role, j) => {
      const stRow = ST.firstRole + j
      rows.push({
        label: `  ${role}`,
        cells: r.fot.map((m, i) => {
          const hc = (() => {
            const kMonth = openIdxBase - 1 + scen.constructionDelayMonths + i
            let cnt = params.fot.count[j] ?? 0
            for (const ph of phases) {
              const [y, mo] = ph.from.split('-').map(Number)
              if (y * 12 + (m0(mo)) <= kMonth) cnt = ph.count[j] ?? 0
            }
            return cnt
          })()
          return {
            f: `INDEX('Штат'!$D$${stRow}:$${L(ST.phase0 + Math.max(1, phases.length) - 1)}$${stRow},1,MATCH(${DD(DR.absIdx, i)},${C.staffIdxRow},1))*'Штат'!$B$${stRow}*${DD(DR.infl, i)}`,
            v: hc * (params.fot.salary[j] ?? 0) * Math.pow(1 + params.general.inflation, Math.floor(i / 12)),
          }
        }),
      })
    })
    rows.push({
      label: '  IT-куратор',
      cells: r.fot.map((m, i) => ({
        f: `IF(${C.itOn}="Да",${C.itCurator}*${DD(DR.infl, i)},0)`,
        v: (params.it.enabled ? params.it.curator : 0) * Math.pow(1 + params.general.inflation, Math.floor(i / 12)),
      })),
    })
    rows.push({
      label: '  Повара F&B',
      cells: r.fot.map((m, i) => ({
        f: `IF(${C.fbOn}="Да",${C.fbCook}*${C.fbCookSal}*${DD(DR.infl, i)},0)`,
        v: (params.fb?.enabled ? (params.fb.cookCount ?? 0) * (params.fb.cookSalary ?? 0) : 0) * Math.pow(1 + params.general.inflation, Math.floor(i / 12)),
      })),
    })
    rows.push({
      label: 'Оклады итого', bold: true, border: 'top',
      cells: r.fot.map((m, i) => ({ f: 'SAL', v: m.salaries })),
    })
    rows.push({
      label: 'KPI-бонусы (спеки)',
      cells: r.fot.map((m, i) => ({
        f: `SUMPRODUCT('Услуги'!${L(i + 2)}$${SV.cnt0}:${L(i + 2)}$${SV.cnt0 + nSpec - 1},'Спеки'!$D$${SP0}:$D$${SP0 + nSpec - 1},'Спеки'!$G$${SP0}:$G$${SP0 + nSpec - 1})`,
        v: m.bonuses,
      })),
    })
    rows.push({
      label: 'Процедур с KPI',
      cells: r.fot.map((m, i) => m.procCount), fmt: '#,##0', style: 'note',
    })
    rows.push({ label: 'ФОТ брутто', bold: true, cells: r.fot.map((m) => ({ f: 'GROSS', v: m.gross })) })
    rows.push({
      label: 'Взносы работодателя',
      cells: r.fot.map((m, i) => ({ f: 'EC', v: m.employerContrib })),
    })
    rows.push({ label: 'ИТОГО ФОТ', bold: true, border: 'double', cells: r.fot.map((m) => ({ f: 'TOT', v: m.total })) })
    const { ws, rows: rm } = monthSheet(wb, 'ФОТ', labels, rows, 'FF7B1FA2')
    const roleRows = params.fot.roles.map((role) => rm.get(`  ${role}`)!)
    FOT.sal = rm.get('Оклады итого')!
    FOT.bonus = rm.get('KPI-бонусы (спеки)')!
    FOT.gross = rm.get('ФОТ брутто')!
    FOT.contrib = rm.get('Взносы работодателя')!
    FOT.total = rm.get('ИТОГО ФОТ')!
    const itRow = rm.get('  IT-куратор')!
    const cookRow = rm.get('  Повара F&B')!
    for (let i = 0; i < ops; i++) {
      const col = L(i + 2)
      ws.getCell(FOT.sal, i + 2).value = {
        formula: `SUM(${roleRows.map((rr) => `${col}${rr}`).join(',')})+${col}${itRow}+${col}${cookRow}`,
        result: r.fot[i].salaries,
      }
      ws.getCell(FOT.gross, i + 2).value = { formula: `${col}${FOT.sal}+${col}${FOT.bonus}`, result: r.fot[i].gross }
      ws.getCell(FOT.contrib, i + 2).value = { formula: `${col}${FOT.gross}*${C.er}`, result: r.fot[i].employerContrib }
      ws.getCell(FOT.total, i + 2).value = { formula: `${col}${FOT.gross}+${col}${FOT.contrib}`, result: r.fot[i].total }
    }
  }
  const FT = (key: string, i: number) => `'ФОТ'!${L(i + 2)}$${FOT[key]}`
  function m0(mo: number) { return mo - 1 }

  // ═══ НАЛОГИ ═══
  const TAX: Record<string, number> = {}
  const taxDeprCell = (i: number) =>
    `${CX$(CX.taxDepr)}` +
    buckets.map((b) => `+IF(${DD(DR.k, i)}>=${b.startCell},${b.eurCell}*(1+${C.p2Adj})*${C.p2TaxRate},0)`).join('')
  const amortCell = (i: number) =>
    `${CX$(CX.amort)}` +
    buckets.map((b) => `+IF(${DD(DR.k, i)}>=${b.startCell},${b.eurCell}*(1+${C.p2Adj})*${C.amortRate},0)`).join('')
  const deferredEurCell = (i: number) =>
    `SUMPRODUCT(('Модули'!$L$${MOD.first}:$L$${MOD.last}=${C.capM}+${DD(DR.k, i)}+1)*('Модули'!$D$${MOD.first}:$D$${MOD.last}=1)*('Модули'!$C$${MOD.first}:$C$${MOD.last})*('Модули'!$K$${MOD.first}:$K$${MOD.last}>${C.openIdxEff}))*${CX$(CX.unitEur)}*(1+${C.capexAdj})` +
    `+IF(AND(${C.capM}+${DD(DR.k, i)}+1>=${C.p2StartIdx}-${C.constrIdx}+1,${C.capM}+${DD(DR.k, i)}+1<${C.p2StartIdx}-${C.constrIdx}+1+${C.p2Months}),${CX$(CX.p2adj)}*P2W,0)`
  {
    const rows: MonthRow[] = []
    const taxDeprV = (i: number) => r.capex.taxDeprMonthly[i]
    const amortV = (i: number) => r.capex.amortMonthly[i]
    const deferredV = (i: number) =>
      r.capex.deferred.filter((d) => d.month === capM + i + 1).reduce((s, d) => s + d.eur, 0)
    rows.push({
      label: 'Выходной НДС 19%',
      cells: r.taxes.map((m, i) => ({
        f: `(${V('rental', i)}+${V('steam', i)}+${V('massage', i)}+${V('extra', i)}+${V('membT', i)}+${V('pubBath', i)})*${C.vatStd}/(1+${C.vatStd})`,
        v: m.vatOut19,
      })),
    })
    rows.push({
      label: 'Выходной НДС 9%',
      cells: r.taxes.map((m, i) => ({
        f: `${V('glamp', i)}*${C.vatGlamp}/(1+${C.vatGlamp})+(${V('fb', i)}+${V('rest', i)})*${C.vatFb}/(1+${C.vatFb})`,
        v: m.vatOut9,
      })),
    })
    rows.push({ label: 'Выходной НДС итого', bold: true, cells: r.taxes.map((m, i) => ({ f: 'VO', v: m.vatOut })) })
    rows.push({
      label: 'Входной НДС (OPEX + CAPEX)',
      cells: r.taxes.map((m, i) => ({
        f: `(${O('fixedT', i)}+${O('varT', i)}+${O('itT', i)})*${C.vatInput}/(1+${C.vatInput})*${C.reimb}+IF(${DD(DR.k, i)}=0,(${CX$(CX.amortBase)}-${CX$(CX.defP1)})*${C.vatInput}/(1+${C.vatInput})*${C.reimb},0)+(${deferredEurCell(i)})*${C.vatInput}/(1+${C.vatInput})*${C.reimb}`,
        v: m.inputVat,
      })),
    })
    rows.push({ label: 'Переходящий кредит НДС (накопл.)', style: 'note', cells: r.taxes.map((m, i) => ({ f: 'CR', v: m.vatCredit })) })
    rows.push({ label: 'НДС к уплате (начисл.)', bold: true, cells: r.taxes.map((m, i) => ({ f: 'VP', v: m.vatPayable })) })
    rows.push({ label: 'НДС уплачено (кварт. график)', cells: r.taxes.map((m, i) => ({ f: 'VD', v: m.vatPaid })) })
    rows.push({ label: 'Налоговая амортизация (база CIT)', style: 'note', cells: r.taxes.map((m, i) => ({ f: taxDeprCell(i), v: taxDeprV(i) })) })
    rows.push({
      label: 'Налогооблагаемая база (citEBIT)',
      style: 'note',
      cells: r.taxes.map((m, i) => ({
        f: 'CITEBIT',
        v: r.pnl[i].ebit + r.capex.amortMonthly[i] - r.capex.taxDeprMonthly[i],
      })),
    })
    rows.push({ label: 'ЧП до дивидендов (для лага)', style: 'note', cells: r.taxes.map((m, i) => ({ f: 'NPD', v: r.pnl[i].netProfit })) })
    rows.push({ label: 'CIT (корп. налог)', cells: r.taxes.map((m, i) => ({ f: 'CIT', v: m.cit })) })
    rows.push({ label: 'Дивиденды брутто (лаг 12)', cells: r.taxes.map((m, i) => ({ f: 'DIV', v: m.dividends })) })
    rows.push({ label: 'SDC с дивидендов', cells: r.taxes.map((m, i) => ({ f: 'SDC', v: m.sdc })) })
    rows.push({ label: 'GESY с дивидендов', cells: r.taxes.map((m, i) => ({ f: 'GESY', v: m.gesy })) })
    rows.push({ label: 'ИТОГО налоговая нагрузка', bold: true, border: 'double', cells: r.taxes.map((m) => ({ f: 'TOT', v: m.total })) })
    const { ws, rows: rm } = monthSheet(wb, 'Налоги', labels, rows, 'FF455A64')
    TAX.vatOut19 = rm.get('Выходной НДС 19%')!
    TAX.vatOut9 = rm.get('Выходной НДС 9%')!
    TAX.vatOut = rm.get('Выходной НДС итого')!
    TAX.inputVat = rm.get('Входной НДС (OPEX + CAPEX)')!
    TAX.credit = rm.get('Переходящий кредит НДС (накопл.)')!
    TAX.vatPayable = rm.get('НДС к уплате (начисл.)')!
    TAX.vatPaid = rm.get('НДС уплачено (кварт. график)')!
    TAX.taxDepr = rm.get('Налоговая амортизация (база CIT)')!
    TAX.citEbit = rm.get('Налогооблагаемая база (citEBIT)')!
    TAX.npPreDiv = rm.get('ЧП до дивидендов (для лага)')!
    TAX.cit = rm.get('CIT (корп. налог)')!
    TAX.div = rm.get('Дивиденды брутто (лаг 12)')!
    TAX.sdc = rm.get('SDC с дивидендов')!
    TAX.gesy = rm.get('GESY с дивидендов')!
    TAX.total = rm.get('ИТОГО налоговая нагрузка')!
    // цепочки по месяцам
    for (let i = 0; i < ops; i++) {
      const col = L(i + 2)
      const prev = i > 0 ? `${L(i + 1)}${TAX.credit}` : '0'
      ws.getCell(TAX.vatOut, i + 2).value = { formula: `${col}${TAX.vatOut19}+${col}${TAX.vatOut9}`, result: r.taxes[i].vatOut }
      ws.getCell(TAX.credit, i + 2).value = {
        formula: `MAX(0,${prev}+${col}${TAX.inputVat}-${col}${TAX.vatOut})`,
        result: r.taxes[i].vatCredit,
      }
      const prevCr = i > 0 ? `${L(i + 1)}${TAX.credit}` : '0'
      ws.getCell(TAX.vatPayable, i + 2).value = {
        formula: `MAX(0,${col}${TAX.vatOut}-${col}${TAX.inputVat}-${prevCr})`,
        result: r.taxes[i].vatPayable,
      }
      // квартальный график: платёж в k = сумма начислений квартала, кончившегося в k−2
      const vatPaidF = params.taxes.vatQuarterly
        ? (() => {
            const qEnd = i - 2 // месяц конца квартала
            if (qEnd < 0) return { formula: `IF(${C.vatQ}="Да",0,${col}${TAX.vatPayable})`, result: r.taxes[i].vatPaid }
            const from = Math.max(0, qEnd - 2)
            const rngSum = `${L(from + 2)}$${TAX.vatPayable}:${L(qEnd + 2)}$${TAX.vatPayable}`
            return {
              formula: `IF(${C.vatQ}="Да",IF(${DD(DR.mo, qEnd)}-3*INT(${DD(DR.mo, qEnd)}/3)=0,SUM(${rngSum}),0),${col}${TAX.vatPayable})`,
              result: r.taxes[i].vatPaid,
            }
          })()
        : { formula: `${col}${TAX.vatPayable}`, result: r.taxes[i].vatPaid }
      ws.getCell(TAX.vatPaid, i + 2).value = vatPaidF
      ws.getCell(TAX.citEbit, i + 2).value = {
        formula: `(${V('total', i)}-${col}${TAX.vatOut}-${O('varT', i)}-${O('pctT', i)}-${O('fixedT', i)}-${O('itT', i)}-${O('land', i)}-${FT('total', i)})-${col}${TAX.taxDepr}`,
        result: r.pnl[i].ebit + r.capex.amortMonthly[i] - r.capex.taxDeprMonthly[i],
      }
      ws.getCell(TAX.npPreDiv, i + 2).value = {
        formula: `(${V('total', i)}-${col}${TAX.vatOut}-${O('varT', i)}-${O('pctT', i)}-${O('fixedT', i)}-${O('itT', i)}-${O('land', i)}-${FT('total', i)})-(${amortCell(i)})-${col}${TAX.cit}`,
        result: r.pnl[i].netProfit,
      }
      ws.getCell(TAX.div, i + 2).value = {
        formula: `IF(${DD(DR.k, i)}>=12,MAX(0,'Налоги'!${L(Math.max(0, i - 12) + 2)}$${TAX.npPreDiv})*${C.distShare},0)`,
        result: r.taxes[i].dividends,
      }
      ws.getCell(TAX.sdc, i + 2).value = {
        formula: `${col}${TAX.div}*SUMPRODUCT(${C.partnerShares},${C.partnerRes})/IF(${C.distShare}>0,${C.distShare},1)*${C.sdc}`,
        result: r.taxes[i].sdc,
      }
      ws.getCell(TAX.gesy, i + 2).value = { formula: 'GESYT', result: r.taxes[i].gesy }
      ws.getCell(TAX.total, i + 2).value = {
        formula: `${col}${TAX.vatPayable}+${col}${TAX.cit}+${col}${TAX.sdc}+${col}${TAX.gesy}`,
        result: r.taxes[i].total,
      }
    }
    // ─── годовой CIT с переносом убытков ───
    const cy0 = ws.rowCount + 2
    ws.getCell(cy0, 1).value = 'CIT ПО КАЛЕНДАРНЫМ ГОДАМ (перенос убытков)'
    ws.getCell(cy0, 1).font = { ...ARIAL, bold: true }
    ws.getCell(cy0 + 1, 1).value = 'Год'
    ws.getCell(cy0 + 1, 2).value = 'База (Σ citEBIT)'
    ws.getCell(cy0 + 1, 3).value = 'Перенос убытка (вх.)'
    ws.getCell(cy0 + 1, 4).value = 'Использовано'
    ws.getCell(cy0 + 1, 5).value = 'Облагаемо'
    ws.getCell(cy0 + 1, 6).value = 'CIT года'
    ws.getCell(cy0 + 1, 7).value = 'Убыток (вых.)'
    ws.getCell(cy0 + 1, 8).value = 'Дат платежа'
    headerRow(ws, cy0 + 1)
    const citRowByYear = new Map<number, number>()
    calYearList.forEach((yr, j) => {
      const rN = cy0 + 2 + j
      citRowByYear.set(yr, rN)
      ws.getCell(rN, 1).value = yr
      ws.getCell(rN, 1).font = { ...ARIAL }
      const moCols = (mo: number) =>
        `SUMPRODUCT((\'Драйверы\'!$B$${DR.calYear}:$${L(ops + 1)}$${DR.calYear}=${yr})*(\'Драйверы\'!$B$${DR.mo}:$${L(ops + 1)}$${DR.mo}=${mo}))`
      ws.getCell(rN, 2).value = {
        formula: `SUMPRODUCT(('Драйверы'!$B$${DR.calYear}:$${L(ops + 1)}$${DR.calYear}=${yr})*'Налоги'!$B$${TAX.citEbit}:$${L(ops + 1)}$${TAX.citEbit})`,
        result: r.pnl.reduce((s, m, k) => s + (Math.floor((openIdxBase + scen.constructionDelayMonths - 1 + k) / 12) === yr ? m.ebit + r.capex.amortMonthly[k] - r.capex.taxDeprMonthly[k] : 0), 0),
      }
      const ebitY = r.pnl.reduce((s, m, k) => s + (Math.floor((openIdxBase + scen.constructionDelayMonths - 1 + k) / 12) === yr ? m.ebit + r.capex.amortMonthly[k] - r.capex.taxDeprMonthly[k] : 0), 0)
      const lossIn = calYearList.slice(0, j).reduce((carry, _y, jj) => {
        const e = r.pnl.reduce((s, m, k) => s + (Math.floor((openIdxBase + scen.constructionDelayMonths - 1 + k) / 12) === calYearList[jj] ? m.ebit + r.capex.amortMonthly[k] - r.capex.taxDeprMonthly[k] : 0), 0)
        const used2 = Math.min(Math.max(0, e), carry)
        return carry - used2 + Math.max(0, -e)
      }, 0)
      ws.getCell(rN, 3).value = { formula: j === 0 ? '0' : `G${rN - 1}`, result: lossIn }
      ws.getCell(rN, 4).value = { formula: `MIN(MAX(0,$B${rN}),$C${rN})`, result: Math.min(Math.max(0, ebitY), lossIn) }
      ws.getCell(rN, 5).value = { formula: `MAX(0,$B${rN}-$D${rN})`, result: Math.max(0, ebitY - Math.min(Math.max(0, ebitY), lossIn)) }
      const used = Math.min(Math.max(0, ebitY), lossIn)
      ws.getCell(rN, 6).value = { formula: `$E${rN}*${C.cit}`, result: Math.max(0, ebitY - used) * params.taxes.cit }
      ws.getCell(rN, 7).value = { formula: `$C${rN}-$D${rN}+MAX(0,-$B${rN})`, result: lossIn - used + Math.max(0, -ebitY) }
      ws.getCell(rN, 8).value = {
        formula: `${moCols(7)}+${moCols(12)}`,
        result: r.revenue.filter((m) => Math.floor((openIdxBase + scen.constructionDelayMonths - 1 + r.revenue.indexOf(m)) / 12) === yr && (m.monthOfYear === 7 || m.monthOfYear === 12)).length,
      }
      for (let ci = 2; ci <= 8; ci++) ws.getCell(rN, ci).numFmt = ci === 8 ? '0' : FMT_EUR
    })
    // помесячный CIT: июль/декабрь → доля годового CIT
    for (let i = 0; i < ops; i++) {
      const yr = Math.floor((openIdxBase + scen.constructionDelayMonths - 1 + i) / 12)
      ws.getCell(TAX.cit, i + 2).value = {
        formula: `IF(OR(${DD(DR.mo, i)}=7,${DD(DR.mo, i)}=12),IFERROR(INDEX($F$${cy0 + 2}:$F$${cy0 + 1 + calYearList.length},MATCH(${DD(DR.calYear, i)},$A$${cy0 + 2}:$A$${cy0 + 1 + calYearList.length},0))/IFERROR(INDEX($H$${cy0 + 2}:$H$${cy0 + 1 + calYearList.length},MATCH(${DD(DR.calYear, i)},$A$${cy0 + 2}:$A$${cy0 + 1 + calYearList.length},0)),1),0),0)`,
        result: r.taxes[i].cit,
      }
    }
    // ─── GESY по партнёрам-резидентам (годовой потолок базы) ───
    const resIdx = params.partners.shares.map((_, pi) => pi).filter((pi) => params.partners.statuses[pi] === 'Резидент Кипра (17%)')
    const gy0 = ws.rowCount + 2
    ws.getCell(gy0, 1).value = 'GESY — база по партнёрам-резидентам (потолок/год)'
    ws.getCell(gy0, 1).font = { ...ARIAL, bold: true }
    const gesyBaseRows: number[] = []
    resIdx.forEach((pi) => {
      const rN = ws.rowCount + 1
      gesyBaseRows.push(rN)
      ws.getCell(rN, 1).value = `  ${params.partners.names[pi] ?? `Партнёр ${pi + 1}`}: облагаемая база`
      ws.getCell(rN, 1).font = { ...ARIAL, color: { argb: GREY } }
      const shareCell = `'Допущения'!$B$${Number(C.partnerShares.match(/\$B\$(\d+)/)![1]) + pi}`
      for (let i = 0; i < ops; i++) {
        const divI = r.taxes[i].dividends * params.partners.shares[pi] / (params.partners.shares.reduce((a, b) => a + b, 0) + params.partners.corporate.mgmt)
        const yr = Math.floor((openIdxBase + scen.constructionDelayMonths - 1 + i) / 12)
        let usedB = 0
        for (let kk = 0; kk < i; kk++) {
          if (Math.floor((openIdxBase + scen.constructionDelayMonths - 1 + kk) / 12) !== yr) continue
          const d = r.taxes[kk].dividends * params.partners.shares[pi] / (params.partners.shares.reduce((a, b) => a + b, 0) + params.partners.corporate.mgmt)
          usedB += Math.max(0, Math.min(d, (params.taxes.gesyCap ?? Infinity) - usedB))
        }
        const taxable = Math.max(0, Math.min(divI, (params.taxes.gesyCap ?? Infinity) - usedB))
        const cell = ws.getCell(rN, i + 2)
        const divIExpr = `${L(i + 2)}$${TAX.div}*${shareCell}/IF(${C.distShare}>0,${C.distShare},1)`
        cell.value = {
          formula: i === 0
            ? `MIN(MAX(0,${divIExpr}),${C.gesyCap})`
            : `MIN(MAX(0,${divIExpr}),MAX(0,${C.gesyCap}-SUMIFS($B$${rN}:$${L(i + 1)}$${rN},'Драйверы'!$B$${DR.calYear}:$${L(i + 1)}$${DR.calYear},${DD(DR.calYear, i)})))`,
          result: taxable,
        }
        cell.numFmt = FMT_EUR
        cell.font = { ...ARIAL, color: { argb: GREY } }
      }
    })
    for (let i = 0; i < ops; i++) {
      const col = L(i + 2)
      ws.getCell(TAX.gesy, i + 2).value = {
        formula: resIdx.length ? `(${gesyBaseRows.map((rr) => `${col}${rr}`).join('+')})*${C.gesy}` : '0',
        result: r.taxes[i].gesy,
      }
    }
  }
  const T = (key: string, i: number) => `'Налоги'!${L(i + 2)}$${TAX[key]}`

  // ═══ P&L ═══
  const PNL: Record<string, number> = {}
  {
    const rows: MonthRow[] = [
      { label: 'Выручка брутто', cells: r.pnl.map((m, i) => f(`${V('total', i)}`, m.revenueGross)) },
      { label: '− НДС начисленный', cells: r.pnl.map((m, i) => f(`-${T('vatOut', i)}`, -m.vatOut)) },
      { label: 'Выручка нетто', bold: true, border: 'top', cells: r.pnl.map((m, i) => ({ f: 'NET', v: m.revenueNet })) },
      { label: '− Переменные / номенклатура', cells: r.pnl.map((m, i) => f(`-${O('varT', i)}`, -m.variableOpex)) },
      { label: '− Процентные OPEX', cells: r.pnl.map((m, i) => f(`-${O('pctT', i)}`, -m.pctOpex)) },
      { label: 'Маржинальная прибыль', bold: true, border: 'top', cells: r.pnl.map((m, i) => ({ f: 'MP', v: m.marginalProfit })) },
      { label: '− Постоянные OPEX', cells: r.pnl.map((m, i) => f(`-${O('fixedT', i)}`, -r.opex[i].fixedTotal)) },
      { label: '− IT-подписки', cells: r.pnl.map((m, i) => f(`-${O('itT', i)}`, -r.opex[i].itTotal)) },
      { label: '− Аренда земли', cells: r.pnl.map((m, i) => f(`-${O('land', i)}`, -r.opex[i].landRent)) },
      { label: '− ФОТ с начислениями', cells: r.pnl.map((m, i) => f(`-${FT('total', i)}`, -m.fot)) },
      { label: 'EBITDA', bold: true, border: 'top', cells: r.pnl.map((m, i) => ({ f: 'EB', v: m.ebitda })) },
      { label: '− Амортизация (бухг.)', cells: r.pnl.map((m, i) => ({ f: `-(${amortCell(i)})`, v: -m.amortization })) },
      { label: 'EBIT', bold: true, cells: r.pnl.map((m, i) => ({ f: 'E', v: m.ebit })) },
      { label: '− CIT', cells: r.pnl.map((m, i) => f(`-${T('cit', i)}`, -m.cit)) },
      { label: 'ЧИСТАЯ ПРИБЫЛЬ', bold: true, border: 'double', cells: r.pnl.map((m) => ({ f: 'NP', v: m.netProfit })) },
      { label: 'Дивиденды брутто', cells: r.pnl.map((m, i) => f(`${T('div', i)}`, m.dividends)) },
      { label: '− SDC', cells: r.pnl.map((m, i) => f(`-${T('sdc', i)}`, -m.sdc)) },
      { label: '− GESY', cells: r.pnl.map((m, i) => f(`-${T('gesy', i)}`, -m.gesy)) },
      { label: 'ЧП после SDC/GESY', cells: r.pnl.map((m) => ({ f: 'NS', v: m.netAfterSdc })) },
    ]
    const { ws, rows: rm } = monthSheet(wb, 'PnL', labels, rows, 'FF00695C')
    for (const [key, label] of [
      ['gross', 'Выручка брутто'], ['vat', '− НДС начисленный'], ['net', 'Выручка нетто'],
      ['var', '− Переменные / номенклатура'], ['pct', '− Процентные OPEX'], ['mp', 'Маржинальная прибыль'],
      ['fixed', '− Постоянные OPEX'], ['it', '− IT-подписки'], ['land', '− Аренда земли'],
      ['fot', '− ФОТ с начислениями'], ['ebitda', 'EBITDA'], ['amort', '− Амортизация (бухг.)'],
      ['ebit', 'EBIT'], ['cit', '− CIT'], ['np', 'ЧИСТАЯ ПРИБЫЛЬ'], ['div', 'Дивиденды брутто'],
      ['sdc', '− SDC'], ['gesy', '− GESY'], ['ns', 'ЧП после SDC/GESY'],
    ] as const) PNL[key] = rm.get(label)!
    for (let i = 0; i < ops; i++) {
      const col = L(i + 2)
      const put = (key: string, fo: string, v: number) => {
        const cell = ws.getCell(PNL[key], i + 2)
        cell.value = { formula: fo, result: v }
      }
      put('net', `${col}${PNL.gross}+${col}${PNL.vat}`, r.pnl[i].revenueNet)
      put('mp', `${col}${PNL.net}+${col}${PNL.var}+${col}${PNL.pct}`, r.pnl[i].marginalProfit)
      put('ebitda', `${col}${PNL.mp}+${col}${PNL.fixed}+${col}${PNL.it}+${col}${PNL.land}+${col}${PNL.fot}`, r.pnl[i].ebitda)
      put('ebit', `${col}${PNL.ebitda}+${col}${PNL.amort}`, r.pnl[i].ebit)
      put('np', `${col}${PNL.ebit}+${col}${PNL.cit}`, r.pnl[i].netProfit)
      put('ns', `${col}${PNL.np}+${col}${PNL.sdc}+${col}${PNL.gesy}`, r.pnl[i].netAfterSdc)
    }
  }
  const P = (key: string, i: number) => `'PnL'!${L(i + 2)}$${PNL[key]}`

  // ═══ CASH-FLOW (стройка + операционка) ═══
  const CF: Record<string, number> = {}
  {
    const ws = wb.addWorksheet('Cash-Flow')
    ws.properties.tabColor = { argb: 'FF1565C0' }
    const MONTHS_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
    const cfLabels = r.cashflow.map((m) => m.label)
    ws.addRow(['Статья', ...cfLabels])
    headerRow(ws)
    freezeFirst(ws)
    ws.getColumn(1).width = 38
    cfLabels.forEach((_, i) => (ws.getColumn(i + 2).width = 10))
    const M1 = 2, ISOPS = 3, OPSIDX = 4
    const row = (label: string, mk: (i: number, self: number) => NumCell, fmt = FMT_EUR, style?: FontStyle, bold = false, border?: 'top' | 'double') => {
      const rN = ws.rowCount + 1
      ws.getCell(rN, 1).value = label
      ws.getCell(rN, 1).font = { ...ARIAL, bold }
      if (border) ws.getRow(rN).eachCell((c) => (c.border = border === 'top' ? thinTop : dblTop))
      for (let i = 0; i < cfTotal; i++) putCell(ws, rN, i + 2, mk(i, rN), fmt, style ?? 'calc', bold)
      return rN
    }
    row('№ месяца CF', (i) => i + 1, '0', 'note')
    row('Операционный (0/1)', (i) => ({ f: `IF(${L(i + 2)}$${M1}>${C.capM},1,0)`, v: r.cashflow[i].isOps ? 1 : 0 }), '0', 'note')
    row('Операционный месяц k (0-базовый)', (i) => ({ f: `${L(i + 2)}$${M1}-${C.capM}-1`, v: i - capM }), '0', 'note')
    ws.getRow(M1).hidden = false
    const opsIdxCell = (i: number) => `${L(i + 2)}$${OPSIDX}`
    const pnlIdx = (prow: number, i: number) =>
      `IF(AND(${opsIdxCell(i)}>=0,${opsIdxCell(i)}<${ops}),INDEX('PnL'!$B$${prow}:$${L(ops + 1)}$${prow},1,${opsIdxCell(i)}+1),0)`
    const taxIdx = (trow: number, i: number) =>
      `IF(AND(${opsIdxCell(i)}>=0,${opsIdxCell(i)}<${ops}),INDEX('Налоги'!$B$${trow}:$${L(ops + 1)}$${trow},1,${opsIdxCell(i)}+1),0)`
    CF.np = row('Чистая прибыль', (i) => ({ f: pnlIdx(PNL.np, i), v: r.cashflow[i].netProfit }))
    CF.amort = row('+ Амортизация', (i) => ({ f: `-(${pnlIdx(PNL.amort, i)})`, v: r.cashflow[i].amortization }))
    CF.vatT = row('Δ НДС (начисл. − уплач.)', (i) => ({
      f: `IF(AND(${opsIdxCell(i)}>=0,${opsIdxCell(i)}<${ops}),INDEX('Налоги'!$B$${TAX.vatOut}:$${L(ops + 1)}$${TAX.vatOut},1,${opsIdxCell(i)}+1)-INDEX('Налоги'!$B$${TAX.vatPaid}:$${L(ops + 1)}$${TAX.vatPaid},1,${opsIdxCell(i)}+1),0)`,
      v: r.cashflow[i].vatTiming,
    }))
    CF.opCf = row('ОПЕРАЦИОННЫЙ CF', (i, s) => ({ f: `${L(i + 2)}${CF.np}+${L(i + 2)}${CF.amort}+${L(i + 2)}${CF.vatT}`, v: r.cashflow[i].operatingCf }), FMT_EUR, 'calc', true, 'top')
    CF.capex = row('CAPEX стройки (S-кривая)', (i, s) => ({
      f: `IF(${L(i + 2)}$${M1}<=${C.capM},-(${CX$(CX.adj)}-${CX$(CX.defP1)})*WCELL,0)`,
      v: r.cashflow[i].capex,
    }))
    CF.deferred = row('Отложенный CAPEX (модули + оч.2)', (i) => {
      const m1 = `${L(i + 2)}$${M1}`
      return {
        f: `-(SUMPRODUCT(('Модули'!$L$${MOD.first}:$L$${MOD.last}=${m1})*('Модули'!$D$${MOD.first}:$D$${MOD.last}=1)*('Модули'!$C$${MOD.first}:$C$${MOD.last})*('Модули'!$K$${MOD.first}:$K$${MOD.last}>${C.openIdxEff}))*${CX$(CX.unitEur)}*(1+${C.capexAdj})+IF(AND(${m1}>=${C.p2StartIdx}-${C.constrIdx}+1,${m1}<${C.p2StartIdx}-${C.constrIdx}+1+${C.p2Months}),${CX$(CX.p2adj)}*P2WCELL,0))`,
        v: r.cashflow[i].deferredCapex,
      }
    })
    CF.presale = row('Пресейл (вход денег)', (i) => ({
      f: `IF(AND(${L(i + 2)}$${M1}<=${C.capM},${L(i + 2)}$${M1}>=${C.capM}-${C.presaleMonths}+1),${C.presaleMonthly},0)`,
      v: r.cashflow[i].presale,
    }))
    CF.unwind = row('Прогорание пресейла (deferred)', (i) => ({
      f: `IF(AND(${opsIdxCell(i)}>=0,${opsIdxCell(i)}<${C.recogMonths},${C.presaleDef}="Да"),-${C.presaleMonthly}*${C.presaleMonths}/MAX(1,${C.recogMonths}),0)`,
      v: r.cashflow[i].presaleUnwind,
    }))
    CF.pool = row('Пул предоплат (остаток)', (i, s) => ({
      f: `${i > 0 ? `${L(i + 1)}${s}` : '0'}+${L(i + 2)}${CF.presale}+${L(i + 2)}${CF.unwind}`,
      v: r.cashflow[i].prepaidPool,
    }))
    CF.land = row('Аренда земли (стройка)', (i) => ({
      f: `IF(${L(i + 2)}$${M1}<=${C.capM},-${C.landLeaseF}*${C.landRent},0)`,
      v: r.cashflow[i].landLease,
    }))
    CF.preopen = row('Pre-opening burn', (i) => ({
      f: `IF(AND(${C.preopenOn}="Да",${L(i + 2)}$${M1}<=${C.capM},${L(i + 2)}$${M1}>=${C.capM}-MIN(${C.preopenMonths},${C.capM})+1),${C.preopenMonthly},0)`,
      v: r.cashflow[i].preopen,
    }))
    CF.maint = row('Maintenance CAPEX', (i) => ({
      f: `IF(AND(${opsIdxCell(i)}>=0,${C.maintOn}="Да"),-IF(INT(${opsIdxCell(i)}/12)+1>=${C.maintStart},${CX$(CX.amortBase)}*${C.maintPct}/12,0)-IF(AND(INT(${opsIdxCell(i)}/12)+1=${C.maintLumpYear},MOD(${opsIdxCell(i)},12)=0),${C.maintLump},0),0)`,
      v: r.cashflow[i].maintCapex,
    }))
    CF.fcff = row('FCFF', (i) => ({
      f: `${L(i + 2)}${CF.opCf}+${L(i + 2)}${CF.capex}+${L(i + 2)}${CF.deferred}+${L(i + 2)}${CF.presale}+${L(i + 2)}${CF.unwind}+${L(i + 2)}${CF.land}+${L(i + 2)}${CF.preopen}+${L(i + 2)}${CF.maint}`,
      v: r.cashflow[i].fcff,
    }), FMT_EUR, 'calc', true, 'top')
    CF.div = row('Дивиденды брутто', (i) => ({ f: `-${taxIdx(TAX.div, i)}`, v: r.cashflow[i].dividends }))
    CF.total = row('ИТОГО CF месяца', (i) => ({ f: `${L(i + 2)}${CF.fcff}+${L(i + 2)}${CF.div}`, v: r.cashflow[i].totalCf }), FMT_EUR, 'calc', true)
    CF.p2eq = row('Транш оч.2 (equity-финанс.)', (i) => ({
      f: `IF(${C.p2FundEq}="Да",IF(AND(${L(i + 2)}$${M1}>=${C.p2StartIdx}-${C.constrIdx}+1,${L(i + 2)}$${M1}<${C.p2StartIdx}-${C.constrIdx}+1+${C.p2Months}),${CX$(CX.p2adj)}*P2WCELL,0),0)`,
      v: r.cashflow[i].phase2Equity,
    }))
    CF.equity = ws.rowCount + 2 // equity-строка идёт сразу после кассы — вычисляем номер заранее
    CF.cash = row('Касса на конец месяца', (i, s) => ({
      f: `${i > 0 ? `${L(i + 1)}${s}` : '0'}+${L(i + 2)}${CF.total}+${L(i + 2)}${CF.equity}`,
      v: r.cashflow[i].cash,
    }), FMT_EUR, 'calc', true)
    row('Equity-транш (закрытие разрыва)', (i, s) => ({
      f: `${L(i + 2)}${CF.p2eq}+MAX(0,-(${i > 0 ? `${L(i + 1)}${CF.cash}` : '0'}+${L(i + 2)}${CF.total}+${L(i + 2)}${CF.p2eq}))`,
      v: r.cashflow[i].equityIn,
    }))
    CF.cumFcff = row('FCFF накопительно', (i, s) => ({ f: `${i > 0 ? `${L(i + 1)}${s}` : '0'}+${L(i + 2)}${CF.fcff}`, v: r.cashflow[i].cumFcff }), FMT_EUR, 'note')
    CF.df = row('Дисконт-фактор', (i) => ({
      f: `1/POWER(1+${C.wacc},${L(i + 2)}$${M1}/12)`,
      v: r.cashflow[i].discountFactor,
    }), '0.000', 'note')
    CF.dfcff = row('Дисконт. FCFF', (i) => ({ f: `${L(i + 2)}${CF.fcff}*${L(i + 2)}${CF.df}`, v: r.cashflow[i].discountedFcff }))
    CF.cumDcf = row('NPV накопительно', (i, s) => ({ f: `${i > 0 ? `${L(i + 1)}${s}` : '0'}+${L(i + 2)}${CF.dfcff}`, v: r.cashflow[i].cumDcf }), FMT_EUR, 'calc', true)
    // флаги «первый положительный месяц» — для payback без массивных формул
    CF.pb1 = row('  флаг: cumFCFF впервые >0', (i) => ({
      f: i === 0
        ? `IF(${L(2)}${CF.cumFcff}>0,1,0)`
        : `IF(AND(${L(i + 2)}${CF.cumFcff}>0,${L(i + 1)}${CF.cumFcff}<=0),1,0)`,
      v: r.cashflow[i].cumFcff > 0 && (i === 0 || r.cashflow[i - 1].cumFcff <= 0) ? 1 : 0,
    }), '0', 'note')
    CF.pb2 = row('  флаг: cumDCF впервые >0', (i) => ({
      f: i === 0
        ? `IF(${L(2)}${CF.cumDcf}>0,1,0)`
        : `IF(AND(${L(i + 2)}${CF.cumDcf}>0,${L(i + 1)}${CF.cumDcf}<=0),1,0)`,
      v: r.cashflow[i].cumDcf > 0 && (i === 0 || r.cashflow[i - 1].cumDcf <= 0) ? 1 : 0,
    }), '0', 'note')
    // ─── вспомогательные строки весов ───
    ws.addRow([])
    CF.w = ws.rowCount + 1
    ws.getCell(CF.w, 1).value = 'S-кривая CAPEX (веса, вход)'
    ws.getCell(CF.w, 1).font = { ...ARIAL, color: { argb: GREY } }
    const scRaw = params.capexSCurve ?? []
    for (let i = 0; i < cfTotal; i++) {
      const w = i < capM ? (scRaw.length === capM ? scRaw[i] : 1 / capM) : 0
      putCell(ws, CF.w, i + 2, w, '0.000', 'input')
    }
    // нормализация внутри формулы строки capex: вес/Σвесов (или равномерно)
    for (let i = 0; i < cfTotal; i++) {
      const cell = ws.getCell(CF.capex, i + 2)
      const v = cell.value as { formula: string; result: number }
      cell.value = {
        formula: v.formula.replace('WCELL', `IF(SUM($B$${CF.w}:$${L(cfTotal + 1)}$${CF.w})>0,${L(i + 2)}$${CF.w}/SUM($B$${CF.w}:$${L(cfTotal + 1)}$${CF.w}),1/${C.capM})`),
        result: v.result,
      }
    }
    CF.w2 = ws.rowCount + 1
    ws.getCell(CF.w2, 1).value = 'S-кривая оч.2 (веса, вход)'
    ws.getCell(CF.w2, 1).font = { ...ARIAL, color: { argb: GREY } }
    const p2CfStart = (params.phase2 ? ymIdx(params.phase2.constructionStart) : 0) - constrIdx + 1
    const p2wRaw = params.phase2?.sCurve?.length ? params.phase2.sCurve.slice(0, Math.round(params.phase2.months)) : new Array(Math.round(params.phase2?.months ?? 0)).fill(1)
    for (let i = 0; i < cfTotal; i++) {
      const pos = i + 1 - p2CfStart
      putCell(ws, CF.w2, i + 2, pos >= 0 && pos < p2wRaw.length ? p2wRaw[pos] : 0, '0.000', 'input')
    }
    // подставить веса оч.2 в формулы deferred/p2eq
    const w2expr = (i: number) =>
      `INDEX($B$${CF.w2}:$${L(cfTotal + 1)}$${CF.w2},1,${L(i + 2)}$${M1})/IF(SUM($B$${CF.w2}:$${L(cfTotal + 1)}$${CF.w2})>0,SUM($B$${CF.w2}:$${L(cfTotal + 1)}$${CF.w2}),1)`
    for (const rN of [CF.deferred, CF.p2eq]) {
      for (let i = 0; i < cfTotal; i++) {
        const cell = ws.getCell(rN, i + 2)
        const v = cell.value as { formula: string; result: number }
        cell.value = { formula: v.formula.replace('P2WCELL', w2expr(i)), result: v.result }
      }
    }
    // deferred-НДС на «Налоги» тоже ссылается на окно оч.2 — патчим P2W
    for (let i = 0; i < ops; i++) {
      const wtx = wb.getWorksheet('Налоги')!.getCell(TAX.inputVat, i + 2)
      const v = wtx.value as { formula: string; result: number }
      wtx.value = {
        formula: v.formula.replace('P2W', `INDEX('Cash-Flow'!$B$${CF.w2}:$${L(cfTotal + 1)}$${CF.w2},1,${C.capM}+${DD(DR.k, i)}+1)/IF(SUM('Cash-Flow'!$B$${CF.w2}:$${L(cfTotal + 1)}$${CF.w2})>0,SUM('Cash-Flow'!$B$${CF.w2}:$${L(cfTotal + 1)}$${CF.w2}),1)`),
        result: v.result,
      }
    }
  }
  const CFX = (key: string, i: number) => `'Cash-Flow'!${L(i + 2)}$${CF[key]}`

  // ═══ БАЛАНС ═══
  const B: Record<string, number> = {}
  {
    const ws = wb.addWorksheet('Баланс')
    ws.properties.tabColor = { argb: 'FF00695C' }
    const cfLabels = r.cashflow.map((m) => m.label)
    ws.addRow(['Статья', ...cfLabels])
    headerRow(ws)
    freezeFirst(ws)
    ws.getColumn(1).width = 38
    const row = (label: string, mk: (i: number, self: number) => NumCell, bold = false, border?: 'top' | 'double') => {
      const rN = ws.rowCount + 1
      ws.getCell(rN, 1).value = label
      ws.getCell(rN, 1).font = { ...ARIAL, bold }
      if (border) ws.getRow(rN).eachCell((c) => (c.border = border === 'top' ? thinTop : dblTop))
      for (let i = 0; i < cfTotal; i++) putCell(ws, rN, i + 2, mk(i, rN), FMT_EUR, 'calc', bold)
      return rN
    }
    B.cash = row('Денежные средства', (i) => f(`${CFX('cash', i)}`, r.balance[i].cash))
    B.ppe = row('ОС по остаточной стоимости', (i, s) => ({
      f: `${i > 0 ? `${L(i + 1)}${s}` : '0'}-(${CFX('capex', i)}+${CFX('deferred', i)}+${CFX('maint', i)})-${CFX('amort', i)}`,
      v: r.balance[i].ppeNbv,
    }))
    B.assets = row('АКТИВЫ', (i) => ({ f: `${L(i + 2)}${B.cash}+${L(i + 2)}${B.ppe}`, v: r.balance[i].totalAssets }), true, 'top')
    B.pool = row('Пул предоплат', (i) => f(`${CFX('pool', i)}`, r.balance[i].prepaidPool))
    B.vatNet = row('Нетто-расчёты по НДС', (i, s) => ({ f: `${i > 0 ? `${L(i + 1)}${s}` : '0'}+${CFX('vatT', i)}`, v: r.balance[i].vatNet }))
    B.equity = row('Внесённый капитал', (i, s) => ({ f: `${i > 0 ? `${L(i + 1)}${s}` : '0'}+${CFX('equity', i)}`, v: r.balance[i].equityIn }))
    B.retained = row('Нераспределённая прибыль', (i, s) => ({
      f: `${i > 0 ? `${L(i + 1)}${s}` : '0'}+${CFX('np', i)}+${CFX('land', i)}+${CFX('preopen', i)}+${CFX('div', i)}`,
      v: r.balance[i].retained,
    }))
    B.liabEq = row('ОБЯЗАТЕЛЬСТВА + КАПИТАЛ', (i) => ({
      f: `${L(i + 2)}${B.pool}+${L(i + 2)}${B.vatNet}+${L(i + 2)}${B.equity}+${L(i + 2)}${B.retained}`,
      v: r.balance[i].totalLiabEq,
    }), true, 'top')
    B.check = row('Проверка (должно быть 0)', (i) => ({ f: `${L(i + 2)}${B.assets}-${L(i + 2)}${B.liabEq}`, v: r.balance[i].check }), true, 'double')
    for (let i = 0; i < cfTotal; i++) {
      ws.getCell(B.check, i + 2).fill = fill(r.balance[i].check > -1 && r.balance[i].check < 1 ? 'FFC6EFCE' : 'FFFFC7CE')
    }
  }

  // ═══ WACC (CAPM) ═══
  {
    const ws = wb.addWorksheet('WACC')
    ws.properties.tabColor = { argb: 'FF7F7F7F' }
    ws.addRow(['Параметр', 'Значение'])
    headerRow(ws)
    ws.getColumn(1).width = 40
    ws.getColumn(2).width = 14
    const capm = params.general.capm
    const put = (rN: number, label: string, v: number | string, input = true) => {
      ws.getCell(rN, 1).value = label
      ws.getCell(rN, 1).font = { ...ARIAL }
      const c2 = ws.getCell(rN, 2)
      c2.value = v
      c2.font = (input ? FONT.input : FONT.calc) as ExcelJS.Font
      c2.numFmt = FMT_PCT
    }
    put(3, 'Безрисковая ставка', capm?.rf ?? 0)
    put(4, 'Бета', capm?.beta ?? 1)
    put(5, 'Премия за рынок (ERP)', capm?.erp ?? 0)
    put(6, 'Страновая премия', capm?.countryPremium ?? 0)
    put(7, 'Премия за размер/стадию', capm?.sizePremium ?? 0)
    const waccV = params.general.waccMode === 'capm' && capm
      ? capm.rf + capm.beta * capm.erp + capm.countryPremium + capm.sizePremium
      : params.general.wacc
    ws.getCell(8, 1).value = 'WACC (CAPM)'
    ws.getCell(8, 1).font = { ...ARIAL, bold: true }
    ws.getCell(8, 2).value = { formula: 'B3+B4*B5+B6+B7', result: waccV }
    ws.getCell(8, 2).font = { ...ARIAL, bold: true }
    ws.getCell(8, 2).numFmt = FMT_PCT
    ws.getCell(10, 1).value = `Режим: ${params.general.waccMode === 'capm' ? 'CAPM (эта таблица)' : 'ручной (Допущения → WACC)'}`
    ws.getCell(10, 1).font = FONT.note as ExcelJS.Font
  }

  // ═══ ЧУВСТВИТЕЛЬНОСТЬ — статический слепок многопрогонного анализа ═══
  {
    const ws = wb.addWorksheet('Чувствительность')
    ws.properties.tabColor = { argb: 'FF7F7F7F' }
    ws.addRow(['Анализ чувствительности NPV — слепок на момент выгрузки (каждая ячейка = отдельный прогон ядра, не пересчитывается формулами)'])
    ws.getRow(1).getCell(1).font = { ...ARIAL, bold: true }
    ws.mergeCells(1, 1, 1, 8)
    const sens = computeSensitivity(params, matrix, items, services)
    let rN = 3
    const pctRow = (r: number, c: number, v: number) => {
      const cell = ws.getCell(r, c)
      cell.value = v
      cell.font = { ...ARIAL }
      cell.numFmt = FMT_PCT
    }
    const numRow = (r: number, c: number, v: number, fmt = FMT_EUR) => {
      const cell = ws.getCell(r, c)
      cell.value = v
      cell.font = { ...ARIAL }
      cell.numFmt = fmt
    }
    const tableHead = (title: string, cols: string[]) => {
      ws.getCell(rN, 1).value = title
      ws.getCell(rN, 1).font = { ...ARIAL, bold: true }
      rN++
      cols.forEach((h, j) => (ws.getCell(rN, j + 1).value = h))
      headerRow(ws, rN)
      rN++
    }
    // T1: спрос × WACC → NPV
    tableHead('T1. NPV: спрос (строки) × WACC (столбцы)', ['Спрос \\ WACC', ...sens.t1.waccAxis.map((w) => `${Math.round(w * 100)}%`)])
    for (const row2 of sens.t1.rows) {
      pctRow(rN, 1, row2.demand)
      row2.cells.forEach((cell, j) => numRow(rN, j + 2, cell.npv))
      rN++
    }
    rN++
    // T2: рост цен × буфер CAPEX → NPV
    tableHead('T2. NPV: рост цен (строки) × буфер CAPEX (столбцы)', ['Рост \\ CAPEX', ...sens.t2.capexAxis.map((w) => `${Math.round(w * 100)}%`)])
    for (const row2 of sens.t2.rows) {
      pctRow(rN, 1, row2.priceGrowth)
      row2.cells.forEach((cell, j) => numRow(rN, j + 2, cell.npv))
      rN++
    }
    rN++
    // T3: множитель цен → NPV / IRR
    tableHead('T3. Уровень цен → NPV и IRR', ['Множитель', 'NPV', 'IRR годовая'])
    for (const row2 of sens.t3) {
      pctRow(rN, 1, row2.priceMult)
      numRow(rN, 2, row2.npv)
      numRow(rN, 3, row2.irr, FMT_PCT)
      rN++
    }
    rN++
    // T4: uptake × спрос → NPV
    tableHead('T4. NPV: доля услуг uptake (строки) × спрос (столбцы)', ['Uptake \\ Спрос', ...sens.t4.loadAxis.map((w) => `${Math.round(w * 100)}%`)])
    for (const row2 of sens.t4.rows) {
      pctRow(rN, 1, row2.uptake)
      row2.cells.forEach((cell, j) => numRow(rN, j + 2, cell.npv))
      rN++
    }
    rN++
    // T5: задержка × буфер CAPEX → NPV
    tableHead('T5. NPV: задержка стройки, мес (строки) × буфер CAPEX', ['Задержка \\ CAPEX', ...sens.t5.capexAxis.map((w) => `${Math.round(w * 100)}%`)])
    for (const row2 of sens.t5.rows) {
      numRow(rN, 1, row2.delayMonths, '0')
      row2.cells.forEach((cell, j) => numRow(rN, j + 2, cell.npv))
      rN++
    }
    rN++
    // Торнадо
    const tornado = computeTornado(params, matrix, items, services, r.kpis.npv)
    tableHead('Торнадо: влияние драйверов на NPV', ['Драйвер', 'Пессимист.', 'Оптимист.', 'NPV min', 'NPV max', 'Размах'])
    for (const t of tornado) {
      ws.getCell(rN, 1).value = t.label
      ws.getCell(rN, 1).font = { ...ARIAL }
      ws.getCell(rN, 2).value = t.loLabel
      ws.getCell(rN, 3).value = t.hiLabel
      ws.getCell(rN, 2).font = FONT.note as ExcelJS.Font
      ws.getCell(rN, 3).font = FONT.note as ExcelJS.Font
      numRow(rN, 4, t.npvLo)
      numRow(rN, 5, t.npvHi)
      ws.getCell(rN, 6).value = { formula: `E${rN}-D${rN}`, result: t.npvHi - t.npvLo }
      ws.getCell(rN, 6).numFmt = FMT_EUR
      rN++
    }
    ws.getColumn(1).width = 30
  }

  // ═══ KPI ═══
  {
    const ws = wb.addWorksheet('KPI')
    ws.properties.tabColor = { argb: 'FF00695C' }
    ws.addRow(['Показатель', 'Значение', 'Примечание'])
    headerRow(ws)
    freezeFirst(ws)
    ws.getColumn(1).width = 38
    ws.getColumn(2).width = 16
    ws.getColumn(3).width = 50
    const lastCol = L(cfTotal + 1)
    const krow = (label: string, fo: string, v: number, fmt = FMT_EUR, note = '') => {
      const rN = ws.rowCount + 1
      ws.getCell(rN, 1).value = label
      ws.getCell(rN, 1).font = { ...ARIAL, bold: true }
      const c2 = ws.getCell(rN, 2)
      c2.value = { formula: fo, result: v }
      c2.font = FONT.link as ExcelJS.Font
      c2.numFmt = fmt
      ws.getCell(rN, 3).value = note
      ws.getCell(rN, 3).font = FONT.note as ExcelJS.Font
      return rN
    }
    const k = r.kpis
    krow('WACC (эфф. годовая)', `${C.wacc}`, k.wacc, FMT_PCT, 'CAPM или ручная — см. Допущения')
    krow('NPV', `'Cash-Flow'!${lastCol}${CF.cumDcf}`, k.npv, FMT_EUR, 'Σ дисконт. FCFF за весь горизонт')
    krow('IRR (мес.)', `IRR('Cash-Flow'!$B$${CF.fcff}:$${lastCol}$${CF.fcff},0.01)`, k.irrMonthly, '0.00%', 'месячная ставка по FCFF')
    krow('IRR (эфф. годовая)', `(1+B4)^12-1`, k.irrAnnual, FMT_PCT, 'сопоставим с WACC')
    krow('Payback, мес.', `IFERROR(MATCH(1,'Cash-Flow'!$B$${CF.pb1}:$${lastCol}$${CF.pb1},0),0)`, k.paybackMonths, '0', 'первый месяц cumFCFF > 0')
    krow('Дисконт. payback, мес.', `IFERROR(MATCH(1,'Cash-Flow'!$B$${CF.pb2}:$${lastCol}$${CF.pb2},0),0)`, k.discountedPaybackMonths, '0')
    krow('Пик кассового разрыва', `MIN('Cash-Flow'!$B$${CF.cumFcff}:$${lastCol}$${CF.cumFcff})`, k.peakFundingNeed, FMT_EUR, 'минимум накопленного FCFF')
    krow('Equity всего', `SUM('Cash-Flow'!$B$${CF.equity}:$${lastCol}$${CF.equity})`, k.equityTotal, FMT_EUR)
    krow('Вложено (Σ отриц. FCFF)', `-SUMIF('Cash-Flow'!$B$${CF.fcff}:$${lastCol}$${CF.fcff},"<0")`, k.investedTotal, FMT_EUR)
    krow('MOIC', `SUMIF('Cash-Flow'!$B$${CF.fcff}:$${lastCol}$${CF.fcff},">0")/B10`, k.moic, '0.00"x"', 'вернулось / вложено')
    const y3a = capM + 24 + 1, y3b = Math.min(cfTotal, capM + 36)
    krow('Cash-on-cash (год 3)', `SUM('Cash-Flow'!${L(y3a + 1)}${CF.fcff}:${L(y3b + 1)}${CF.fcff})/B10`, k.cashOnCash, '0.0%', 'FCFF 3-го опер. года / вложено')
    krow('Terminal value (Gordon)', `IF(AND(${'TVON'},${C.wacc}>TVG),SUM('Cash-Flow'!${L(cfTotal - 10)}${CF.fcff}:${lastCol}${CF.fcff})*(1+TVG)/(${C.wacc}-TVG)*'Cash-Flow'!${lastCol}${CF.df},0)`, k.tvValue, FMT_EUR)
    krow('TV по exit-multiple', `IF(TVON,SUM('PnL'!${L(ops - 10)}${PNL.ebitda}:${L(ops + 1)}${PNL.ebitda})*TVX*'Cash-Flow'!${lastCol}${CF.df},0)`, k.tvExitValue, FMT_EUR)
    krow('NPV + TV', `B3+B13`, k.npvWithTv, FMT_EUR)
    // TV-параметры — служебные ячейки
    const tvRow = ws.rowCount + 2
    ws.getCell(tvRow, 1).value = 'TV включена (Да/Нет)'
    ws.getCell(tvRow, 2).value = params.tv?.enabled ? 'Да' : 'Нет'
    ws.getCell(tvRow, 2).font = FONT.input as ExcelJS.Font
    ws.getCell(tvRow + 1, 1).value = 'TV: рост g'
    ws.getCell(tvRow + 1, 2).value = params.tv?.growth ?? 0
    ws.getCell(tvRow + 1, 2).font = FONT.input as ExcelJS.Font
    ws.getCell(tvRow + 1, 2).numFmt = FMT_PCT
    ws.getCell(tvRow + 2, 1).value = 'TV: exit-мультипликатор'
    ws.getCell(tvRow + 2, 2).value = params.tv?.exitMultiple ?? 0
    ws.getCell(tvRow + 2, 2).font = FONT.input as ExcelJS.Font
    ws.getCell(tvRow + 2, 2).numFmt = '0.0"x"'
    for (const [rr, token, repl] of [
      [13, 'TVON', `'KPI'!$B$${tvRow}="Да"`],
      [13, 'TVG', `'KPI'!$B$${tvRow + 1}`],
      [14, 'TVON', `'KPI'!$B$${tvRow}="Да"`],
      [14, 'TVX', `'KPI'!$B$${tvRow + 2}`],
    ] as const) {
      const cell = ws.getCell(rr, 2)
      const v = cell.value as { formula: string; result: number }
      cell.value = { formula: v.formula.split(token).join(repl), result: v.result }
    }
  }

  // ═══ CHECKS — независимые пересчёты ═══
  {
    const ws = wb.addWorksheet('Checks')
    ws.properties.tabColor = { argb: 'FF388E3C' }
    ws.addRow(['Проверка', 'Формула', 'Ожидание', 'Отклонение', 'Статус'])
    headerRow(ws)
    freezeFirst(ws)
    ws.getColumn(1).width = 52
    ws.getColumn(2).width = 18
    ws.getColumn(3).width = 18
    ws.getColumn(4).width = 14
    ws.getColumn(5).width = 10
    const lastCol = L(cfTotal + 1)
    const opsLastCol = L(ops + 1)
    const y1End = Math.min(ops, 12)
    const chk = (label: string, fo: string, expected: number, tol = 1) => {
      const rN = ws.rowCount + 1
      ws.getCell(rN, 1).value = label
      ws.getCell(rN, 1).font = { ...ARIAL }
      const cc = ws.getCell(rN, 2)
      cc.value = { formula: fo, result: expected }
      cc.numFmt = '#,##0.00'
      cc.font = FONT.link as ExcelJS.Font
      ws.getCell(rN, 3).value = expected
      ws.getCell(rN, 3).numFmt = '#,##0.00'
      const dc = ws.getCell(rN, 4)
      dc.value = { formula: `B${rN}-C${rN}`, result: 0 }
      dc.numFmt = '#,##0.00'
      const sc = ws.getCell(rN, 5)
      sc.value = { formula: `IF(ABS(D${rN})<=${tol},"OK","FAIL")`, result: 'OK' }
      sc.font = { ...ARIAL, bold: true }
      sc.fill = fill('FFC6EFCE')
      return rN
    }
    // 1. Баланс сходится: макс. |расхождение| = 0
    chk(
      'Баланс: максимальное расхождение Активы−Пассивы',
      `MAX(MAX('Баланс'!$B$${B.check}:$${lastCol}$${B.check}),-MIN('Баланс'!$B$${B.check}:$${lastCol}$${B.check}))`,
      0,
    )
    // 2. NPV: независимый SUMPRODUCT
    chk('NPV = SUMPRODUCT(FCFF × DF)', `SUMPRODUCT('Cash-Flow'!$B$${CF.fcff}:$${lastCol}$${CF.fcff},'Cash-Flow'!$B$${CF.df}:$${lastCol}$${CF.df})`, r.kpis.npv)
    // 3. Выручка год 1 нетто = PnL
    chk(
      'Выручка нетто год 1 (Σ PnL)',
      `SUM('PnL'!$B$${PNL.net}:${L(y1End + 1)}$${PNL.net})`,
      r.pnl.slice(0, y1End).reduce((s, m) => s + m.revenueNet, 0),
    )
    // 4. OPEX год 1
    chk('OPEX год 1 (Σ)', `SUM('OPEX'!$B$${OPX.total}:${L(y1End + 1)}$${OPX.total})`, r.opex.slice(0, y1End).reduce((s, m) => s + m.total, 0))
    // 5. Чистая прибыль год 1
    chk('Чистая прибыль год 1 (Σ)', `SUM('PnL'!$B$${PNL.np}:${L(y1End + 1)}$${PNL.np})`, r.pnl.slice(0, y1End).reduce((s, m) => s + m.netProfit, 0))
    // 6. PnL ЧП ≡ Налоги «ЧП до дивидендов»
    chk(
      'PnL ЧП ≡ Налоги ЧП-до-дивидендов (год 1)',
      `SUM('PnL'!$B$${PNL.np}:${L(y1End + 1)}$${PNL.np})-SUM('Налоги'!$B$${TAX.npPreDiv}:${L(y1End + 1)}$${TAX.npPreDiv})`,
      0,
    )
    // 7. Итого выручка = сумма компонент (год 1)
    chk(
      'Выручка брутто год 1 (Σ компонент = Σ итого)',
      `SUM('Выручка'!$B$${REV.total}:${L(y1End + 1)}$${REV.total})-SUM('Выручка'!$B$${REV.rental}:${L(y1End + 1)}$${REV.rental})-SUM('Выручка'!$B$${REV.steam}:${L(y1End + 1)}$${REV.steam})-SUM('Выручка'!$B$${REV.massage}:${L(y1End + 1)}$${REV.massage})-SUM('Выручка'!$B$${REV.extra}:${L(y1End + 1)}$${REV.extra})-SUM('Выручка'!$B$${REV.glamp}:${L(y1End + 1)}$${REV.glamp})-SUM('Выручка'!$B$${REV.membT}:${L(y1End + 1)}$${REV.membT})-SUM('Выручка'!$B$${REV.fb}:${L(y1End + 1)}$${REV.fb})-SUM('Выручка'!$B$${REV.pubBath}:${L(y1End + 1)}$${REV.pubBath})-SUM('Выручка'!$B$${REV.rest}:${L(y1End + 1)}$${REV.rest})`,
      0,
    )
    // 8. CAPEX: итог с буфером = итог × (1 + capexAdj) — независимый пересчёт
    chk(
      'CAPEX оч.1: итог с буфером = итог × (1+adj)',
      `'CAPEX'!$E$${CX.adj}-'CAPEX'!$E$${CX.total}*(1+${C.capexAdj})`,
      0,
    )
    // 9. S-кривая CAPEX: Σ весов = 100%
    chk('S-кривая CAPEX: Σ весов', `SUM('Cash-Flow'!$B$${CF.w}:$${lastCol}$${CF.w})`, params.capexSCurve?.length === capM ? params.capexSCurve!.reduce((a, b) => a + b, 0) : 1, 0.01)
    // 10. Накопленный FCFF последнего месяца = Σ FCFF
    chk('Накопл. FCFF (конец) = Σ FCFF', `'Cash-Flow'!${lastCol}${CF.cumFcff}-SUM('Cash-Flow'!$B$${CF.fcff}:$${lastCol}$${CF.fcff})`, 0)
    void opsLastCol
  }

  // ═══ ОБЛОЖКА: метаданные + карта книги + легенда ═══
  {
    const ws = wsCover
    ws.properties.tabColor = { argb: NAVY }
    ws.getColumn(1).width = 30
    ws.getColumn(2).width = 44
    ws.getColumn(3).width = 60
    ws.mergeCells('A1:C1')
    ws.getCell('A1').value = 'AURA HILLS — финансовая модель'
    ws.getCell('A1').font = { name: 'Arial', size: 16, bold: true, color: { argb: NAVY } }
    ws.getCell('A1').alignment = { vertical: 'middle' }
    ws.getRow(1).height = 26
    const meta: [string, string | { f: string; v: string | number }, string][] = [
      ['Модель', { f: `${C.modelName}`, v: 'AURA HILLS' }, 'из Допущения!B-модель'],
      ['Сценарий', { f: `${C.scenario}`, v: scen0 }, 'меняется на листе Допущения'],
      ['Дата выгрузки', `=TODAY()`, 'пересчитывается при открытии'],
      ['Версия', (globalThis as { __BUILD_ID__?: string }).__BUILD_ID__ ?? 'dev', 'git commit сборки приложения'],
      ['Режим', { f: `${C.mode} & " / " & ${C.vatMode}`, v: `${params.meta.mode} / ${params.meta.vatMode}` }, 'пакетный / НДС'],
      ['Горизонт', `${capM} мес. стройки + ${ops} мес. операций`, 'в колонках месячных листов'],
    ]
    let rN = 3
    for (const [k2, v, note] of meta) {
      ws.getCell(rN, 1).value = k2
      ws.getCell(rN, 1).font = { ...ARIAL, bold: true }
      const c2 = ws.getCell(rN, 2)
      c2.value = typeof v === 'object' ? { formula: (v as { f: string }).f.startsWith('=') ? (v as { f: string }).f.slice(1) : (v as { f: string }).f, result: (v as { v: unknown }).v as string | number } : v
      if (typeof v === 'string' && v.startsWith('=')) c2.value = { formula: v.slice(1), result: new Date() }
      c2.font = { ...ARIAL, color: { argb: GREEN } }
      ws.getCell(rN, 3).value = note
      ws.getCell(rN, 3).font = FONT.note as ExcelJS.Font
      rN++
    }
    rN++
    ws.getCell(rN, 1).value = 'КАРТА КНИГИ'
    ws.getCell(rN, 1).font = { ...ARIAL, bold: true }
    rN++
    const toc: [string, string][] = [
      ['ВХОДЫ (синие ячейки — менять здесь)', ''],
      ['Допущения', 'скаляры, тоглы, партнёры, постоянные OPEX и IT'],
      ['Сценарии', 'матрица сценариев: загрузки, рост цен, рампа, задержка, энергия'],
      ['Модули', 'банные комплексы: статус, очередь, цены, запуск, uptime'],
      ['Сезонность', 'множители по месяцам'],
      ['Штат', 'роли, оклады, графики, фазы численности'],
      ['Спеки', 'спецификации услуг: цены, веса, составы (материалы + труд)'],
      ['Номенклатура', 'цены/доставка → landed cost; нормы расхода'],
      ['РАСЧЁТ (не редактировать)', ''],
      ['Драйверы → Услуги → Списание', 'промежуточные помесячные величины'],
      ['Выручка → OPEX → ФОТ → Налоги', 'операционные потоки'],
      ['CAPEX → PnL → Cash-Flow → Баланс', 'инвестиции и финансовый результат'],
      ['KPI → Checks → WACC → Чувствительность', 'итоги, контроль, ставка, стресс-тесты'],
    ]
    for (const [a, b] of toc) {
      ws.getCell(rN, 1).value = a
      ws.getCell(rN, 1).font = b ? { ...ARIAL } : { ...ARIAL, bold: true }
      ws.getCell(rN, 3).value = b
      ws.getCell(rN, 3).font = FONT.note as ExcelJS.Font
      rN++
    }
    rN++
    ws.getCell(rN, 1).value = 'ЛЕГЕНДА ЦВЕТОВ'
    ws.getCell(rN, 1).font = { ...ARIAL, bold: true }
    rN++
    const legend: [string, Partial<ExcelJS.Font>][] = [
      ['Синий — вход / допущение (можно менять)', FONT.input],
      ['Чёрный — формула этого листа', FONT.calc],
      ['Зелёный — ссылка на другой лист', FONT.link],
      ['Серый — служебная/справочная строка', FONT.note],
    ]
    for (const [t, f2] of legend) {
      ws.getCell(rN, 1).value = t
      ws.getCell(rN, 1).font = f2 as ExcelJS.Font
      rN++
    }
    rN++
    ws.getCell(rN, 1).value = 'Изменение входов пересчитывает всю цепочку до NPV. Изменение задержки стройки требует реэкспорта (структура колонок Cash-Flow статична).'
    ws.getCell(rN, 1).font = FONT.note as ExcelJS.Font
    ws.mergeCells(`A${rN}:C${rN}`)
  }

  // ═══ FIX: поздние ссылки ═══
  for (const fx of FIX) {
    const ws = wb.getWorksheet(fx.sheet)
    if (!ws) continue
    const cell = ws.getCell(fx.r, fx.c)
    cell.value = { formula: fx.f, result: fx.v }
    if (fx.fmt) cell.numFmt = fx.fmt
    if (fx.style) cell.font = FONT[fx.style] as ExcelJS.Font
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}


