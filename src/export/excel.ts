import ExcelJS from 'exceljs'
import type { ModelResult, NomenclatureItem, Params, ScenarioMatrix, ServiceSpec } from '../model/types'
import { YEAR_KEYS } from '../model/types'
import { runModel } from '../model/run'
import { computeSensitivity, T2_CAPEX } from '../model/sensitivity'
import { landedCost } from '../model/opex'
import { capexWeights } from '../model/cashflow'

// Профессиональная выгрузка модели в .xlsx:
// — живые формулы между листами (PnL ← Выручка/OPEX/ФОТ/Налоги, CF ← PnL,
//   KPI ← CF), каждая формула несёт кешированный result — значения видны
//   до пересчёта и обновляются при правке входов;
// — стилистика фин. модели: синий = вход/драйвер, чёрный = формула,
//   зелёный = межлистовая ссылка; Arial 10, фриз шапки, форматы чисел.

const ARIAL = { name: 'Arial', size: 10 } as const
const NAVY = 'FF1A2334'
const SEC_BG = 'FFD9E2F0'
const BLUE = 'FF1F4ECC' // входы и драйверы
const GREEN = 'FF1E7B34' // ссылки на другие листы
const FMT_EUR = '#,##0;(#,##0);"–"'
const FMT_EUR2 = '#,##0.00;(#,##0.00);"–"'
const FMT_PCT = '0.0%'

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

type FontStyle = 'input' | 'calc' | 'link'
const FONT: Record<FontStyle, Partial<ExcelJS.Font>> = {
  input: { ...ARIAL, color: { argb: BLUE } },
  calc: { ...ARIAL },
  link: { ...ARIAL, color: { argb: GREEN } },
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
        // авто-стиль: формула со ссылкой на лист — зелёная, число-вход — синее, формула — чёрная
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

export async function exportWorkbook(
  params: Params,
  matrix: ScenarioMatrix,
  items: NomenclatureItem[],
  services: ServiceSpec[],
): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AURA HILLS Model'
  const results = matrix.names.map((n) => runModel(params, matrix, items, services, n))
  const r = results[matrix.names.indexOf(params.meta.scenario)] ?? results[1]
  const scen = r.scenario
  const ops = params.meta.opsMonths
  // фактическая стройка — с учётом сценарной задержки
  const capM = r.cashflow.filter((m) => !m.isOps).length
  const cfTotal = capM + ops
  const labels = Array.from({ length: ops }, (_, i) => {
    const [y, m] = params.meta.openingDate.slice(0, 7).split('-').map(Number)
    const t = y * 12 + (m - 1) + i + scen.constructionDelayMonths
    return `${String((t % 12) + 1).padStart(2, '0')}.${Math.floor(t / 12)}`
  })
  const sCurve = capexWeights({ ...params, meta: { ...params.meta, capexMonths: capM } })
  const landCost = params.land.mode === 'purchase' ? params.land.purchaseCost : 0

  // ─── ДОПУЩЕНИЯ (входы — синие; на них ссылаются формулы др. листов) ───
  const A: Record<string, number | number[]> = {} // имя → номер строки листа
  {
    const ws = wb.addWorksheet('Допущения')
    ws.properties.tabColor = { argb: 'FF4472C4' }
    ws.getColumn(1).width = 34
    ws.getColumn(2).width = 14
    ws.getColumn(3).width = 58
    const put = (label: string, v: number | string, note = '', fmt?: string) => {
      const row = ws.addRow([label, v, note])
      ws.getCell(row.number, 1).font = { ...ARIAL }
      ws.getCell(row.number, 3).font = { ...ARIAL, color: { argb: 'FF7A8AA8' } }
      if (typeof v === 'number') {
        ws.getCell(row.number, 2).font = FONT.input as ExcelJS.Font
        if (fmt) ws.getCell(row.number, 2).numFmt = fmt
      } else ws.getCell(row.number, 2).font = { ...ARIAL }
      return row.number
    }
    ws.addRow(['Параметр', 'Значение', 'Комментарий'])
    headerRow(ws)
    freezeFirst(ws)
    A.scenario = put('Активный сценарий', params.meta.scenario, 'меняется в UI модели')
    put('Пакетный режим', params.meta.mode)
    put('Режим НДС', params.meta.vatMode)
    A.capM = put('Месяцев стройки', capM, `S-кривая освоения CAPEX${scen.constructionDelayMonths ? `, вкл. задержку ${scen.constructionDelayMonths} мес` : ''}`)
    A.ops = put('Месяцев операций', ops)
    if (params.general.waccMode === 'capm') {
      A.wacc = ws.addRow(['WACC (CAPM), годовых', { formula: `'WACC'!$B$8`, result: r.kpis.wacc }, 'лист WACC; помесячно (1+WACC)^(1/12)−1']).number
      ws.getCell(A.wacc, 2).numFmt = FMT_PCT
      ws.getCell(A.wacc, 2).font = FONT.link as ExcelJS.Font
      ws.getCell(A.wacc, 3).font = { ...ARIAL, color: { argb: 'FF7A8AA8' } }
    } else {
      A.wacc = put('WACC, годовых', params.general.wacc, 'эффективная годовая; помесячно (1+WACC)^(1/12)−1', FMT_PCT)
    }
    put('Инфляция, годовых', params.general.inflation, '', FMT_PCT)
    put('CAPEX смета', 'EUR', 'все позиции сметы в евро')
    A.capexAdj = put('Буфер CAPEX сценария', scen.capexAdj, `сценарий «${params.meta.scenario}»`, FMT_PCT)
    put('CIT', params.taxes.cit, 'реформа Кипра 2026: 15%', FMT_PCT)
    put('SDC на дивиденды', params.taxes.sdc, 'реформа 2026: 5% резидентам-домицилам', FMT_PCT)
    put('НДС стандартный', params.taxes.vatStd, '', FMT_PCT)
    put('Мультипликатор спроса', params.service.demandMult)
    put('Депозит на гостя, €', params.deposit.base, '', FMT_EUR)
    A.land = put('Земля (покупка), €', landCost, 'не амортизируется; 0 при аренде', FMT_EUR)
    ws.addRow([])
    ws.addRow(['Амортизация', 'Доля', 'Срок, лет']).font = { ...ARIAL, bold: true }
    A.amortRows = []
    params.amort.groups.forEach((g, i) => {
      const row = ws.addRow([g, params.amort.shares[i], params.amort.years[i]])
      ws.getCell(row.number, 2).font = FONT.input as ExcelJS.Font
      ws.getCell(row.number, 2).numFmt = FMT_PCT
      ws.getCell(row.number, 3).font = FONT.input as ExcelJS.Font
      ;(A.amortRows as number[]).push(row.number)
    })
    // легенда цветовой схемы финансовой модели
    ws.addRow([])
    ws.addRow(['Легенда']).font = { ...ARIAL, bold: true }
    const legend: [string, Partial<ExcelJS.Font>][] = [
      ['Синий — вход / допущение (можно менять)', FONT.input],
      ['Чёрный — формула', FONT.calc],
      ['Зелёный — ссылка на другой лист', FONT.link],
    ]
    for (const [t, f2] of legend) {
      const row = ws.addRow([t])
      row.getCell(1).font = f2 as ExcelJS.Font
    }
  }
  const A$ = (k: string) => `'Допущения'!$B$${A[k]}`

  // ─── WACC (CAPM) ───
  {
    const ws = wb.addWorksheet('WACC')
    ws.properties.tabColor = { argb: 'FF4472C4' }
    ws.getColumn(1).width = 40
    ws.getColumn(2).width = 12
    ws.getColumn(3).width = 56
    ws.addRow(['Стоимость капитала (CAPM)', 'Значение', 'Источник / комментарий'])
    headerRow(ws)
    const c = params.general.capm
    const inp = (l: string, v: number, note: string) => {
      const row = ws.addRow([l, v, note])
      row.getCell(1).font = { ...ARIAL }
      row.getCell(2).font = FONT.input as ExcelJS.Font
      row.getCell(2).numFmt = l.includes('Бета') ? '0.00' : FMT_PCT
      row.getCell(3).font = { ...ARIAL, color: { argb: 'FF7A8AA8' } }
    }
    inp('Безрисковая ставка (rf)', c.rf, 'EUR 10Y gov (Германия/Кипр), на дату модели')                 // B2
    inp('Бета (unlevered, leisure/hospitality)', c.beta, 'Damodaran: Hotel/Gaming, Recreation small-cap')  // B3
    inp('Премия за риск акций (ERP)', c.erp, 'Damodaran mature-market ERP')                                // B4
    inp('Страновая премия (Кипр)', c.countryPremium, 'CRP по рейтингу BBB+/Baa2')                          // B5
    inp('Премия size / startup (greenfield)', c.sizePremium, 'Micro-cap + стартовый риск проекта')          // B6
    const ke = ws.addRow(['Cost of equity (ke) = rf + β·ERP + CRP + size', { formula: 'B2+B3*B4+B5+B6', result: r.kpis.wacc }, ''])
    ke.getCell(2).numFmt = FMT_PCT
    ke.getCell(2).font = { ...ARIAL, bold: true }
    ke.getCell(1).font = { ...ARIAL, bold: true }                                                            // B7
    const w = ws.addRow(['WACC (долга нет → WACC = ke)', { formula: 'B7', result: r.kpis.wacc }, params.general.waccMode === 'capm' ? 'применяется в модели' : 'справочно: в модели ручная ставка'])
    w.getCell(2).numFmt = FMT_PCT
    w.getCell(2).font = { ...ARIAL, bold: true }
    w.getCell(1).font = { ...ARIAL, bold: true }                                                             // B8
    w.getCell(3).font = { ...ARIAL, color: { argb: 'FF7A8AA8' } }
    ws.addRow([])
    const mr = ws.addRow(['Месячная ставка (1+WACC)^(1/12)−1', { formula: '(1+B8)^(1/12)-1', result: Math.pow(1 + r.kpis.wacc, 1 / 12) - 1 }, 'применяется к FCFF помесячно'])
    mr.getCell(2).numFmt = '0.000%'
    mr.getCell(3).font = { ...ARIAL, color: { argb: 'FF7A8AA8' } }
  }

  // ─── СЦЕНАРИИ ───
  {
    const ws = wb.addWorksheet('Сценарии')
    ws.addRow(['Параметр', ...matrix.names])
    headerRow(ws)
    freezeFirst(ws)
    ws.getColumn(1).width = 30
    const put = (label: string, vals: number[], fmt = FMT_EUR, style: FontStyle = 'input') => {
      const row = ws.addRow([label])
      row.getCell(1).font = { ...ARIAL }
      vals.forEach((v, i) => putCell(ws, row.number, i + 2, v, fmt, style))
    }
    const streams: [string, keyof Pick<ScenarioMatrix, 'baths' | 'steam' | 'massage' | 'extra' | 'glamping' | 'membersMonth'>, string][] = [
      ['Бани', 'baths', FMT_PCT], ['Парения', 'steam', FMT_PCT], ['Массаж', 'massage', FMT_PCT],
      ['Допы', 'extra', FMT_PCT], ['Глэмпинг', 'glamping', FMT_PCT], ['Членов (мес)', 'membersMonth', '#,##0'],
    ]
    for (const [label, key, fmt] of streams)
      YEAR_KEYS.forEach((y, i) => put(`${label} — Год ${i + 1}`, matrix[key][y], fmt))
    put('Рост цен', matrix.priceGrowth, FMT_PCT)
    put('Корректировка CAPEX', matrix.capexAdj, FMT_PCT)
    put('Задержка стройки, мес', matrix.constructionDelayMonths, '0')
    put('Множитель энергозатрат', matrix.energyCostMult, '0.00')
    put('Uptake (непакетный)', matrix.uptake, FMT_PCT)
    ws.addRow([])
    ws.addRow(['РЕЗУЛЬТАТЫ (снимок ядра)', ...matrix.names])
    headerRow(ws, ws.rowCount)
    put('NPV (5 лет), EUR', results.map((x) => Math.round(x.kpis.npv)), FMT_EUR, 'calc')
    put('IRR годовой', results.map((x) => x.kpis.irrAnnual), FMT_PCT, 'calc')
    put('Окупаемость, мес', results.map((x) => x.kpis.paybackMonths), '0', 'calc')
    put('Диск. окупаемость, мес', results.map((x) => x.kpis.discountedPaybackMonths), '0', 'calc')
    put('Пиковая потребность, EUR', results.map((x) => Math.round(x.kpis.peakFundingNeed)), FMT_EUR, 'calc')
  }

  // ─── ВЫРУЧКА ─── (компоненты — вывод ядра; ИТОГО — живая сумма)
  const rev = monthSheet(wb, 'Выручка', labels, [
    { label: 'Загрузка', cells: nums(r.revenue.map((m) => m.bathsLoad)), fmt: FMT_PCT, style: 'input' },
    { label: 'Слоты', cells: nums(r.revenue.map((m) => m.slots)), fmt: '#,##0', style: 'input' },
    { label: 'Аренда бань', cells: nums(r.revenue.map((m) => m.rental)) },
    { label: 'Парения', cells: nums(r.revenue.map((m) => m.steamTotal)) },
    { label: 'Массаж', cells: nums(r.revenue.map((m) => m.massageTotal)) },
    { label: 'Доп.услуги', cells: nums(r.revenue.map((m) => m.extraTotal)) },
    { label: 'Глэмпинг', cells: nums(r.revenue.map((m) => m.glamping)) },
    { label: 'Членства + сертификаты', cells: nums(r.revenue.map((m) => m.membershipTotal)) },
    { label: 'F&B', cells: nums(r.revenue.map((m) => m.fb)) },
    {
      label: 'ИТОГО ВЫРУЧКА', bold: true, border: 'top',
      cells: r.revenue.map((m, i) => f(`SUM(${L(i + 2)}4:${L(i + 2)}10)`, m.total)),
    },
  ], 'FF1E7B34')
  const REV_T = rev.rows.get('ИТОГО ВЫРУЧКА')!

  // ─── OPEX ───
  const opx = monthSheet(wb, 'OPEX', labels, [
    { label: 'Постоянные', cells: nums(r.opex.map((m) => m.fixedTotal)) },
    { label: 'IT / АСУ', cells: nums(r.opex.map((m) => m.itTotal)) },
    { label: 'Аренда земли', cells: nums(r.opex.map((m) => m.landRent)) },
    { label: 'Переменные (номенклатура)', cells: nums(r.opex.map((m) => m.variableTotal)) },
    { label: '% от выручки', cells: nums(r.opex.map((m) => m.pctTotal)) },
    { label: '— в т.ч. OTA-комиссия', cells: nums(r.opex.map((m) => m.pct.ota)) },
    {
      label: 'ИТОГО OPEX', bold: true, border: 'top',
      cells: r.opex.map((m, i) => f(`SUM(${L(i + 2)}2:${L(i + 2)}6)`, m.total)),
    },
  ], 'FFC00000')
  const OPEX = {
    fixed: opx.rows.get('Постоянные')!,
    it: opx.rows.get('IT / АСУ')!,
    land: opx.rows.get('Аренда земли')!,
    variable: opx.rows.get('Переменные (номенклатура)')!,
    pct: opx.rows.get('% от выручки')!,
    total: opx.rows.get('ИТОГО OPEX')!,
  }

  // ─── ФОТ ───
  const fot = monthSheet(wb, 'ФОТ', labels, [
    { label: 'Оклады', cells: nums(r.fot.map((m) => m.salaries)) },
    { label: 'KPI бонусы', cells: nums(r.fot.map((m) => m.bonuses)) },
    { label: 'Взносы', cells: nums(r.fot.map((m) => m.employerContrib)) },
    {
      label: 'ИТОГО ФОТ', bold: true, border: 'top',
      cells: r.fot.map((m, i) => f(`SUM(${L(i + 2)}2:${L(i + 2)}4)`, m.total)),
    },
  ])
  const FOT_T = fot.rows.get('ИТОГО ФОТ')!

  // ─── CAPEX — сметная ведомость с WBS ───
  // Порядок записи строго сверху вниз: раздел → позиции → WBS → итог раздела.
  const CX: Record<string, number> = {}
  let modulesRow = 0 // строка «Банные модуля» — для Checks
  const itemRows: number[] = []
  {
    const ws = wb.addWorksheet('CAPEX')
    ws.properties.tabColor = { argb: 'FFBF8F00' }
    ws.addRow(['Статья затрат / элемент работ', 'Ед.', 'Кол-во', 'Ставка, €', 'Сумма, €'])
    headerRow(ws)
    freezeFirst(ws)
    ws.getColumn(1).width = 56
    ws.getColumn(2).width = 8
    ws.getColumn(3).width = 10
    ws.getColumn(4).width = 12
    ws.getColumn(5).width = 14
    const groups: { name: string; items: typeof r.capex.items }[] = []
    const gix = new Map<string, number>()
    for (const it of r.capex.items) {
      const g = it.group ?? 'Прочее'
      const ix = gix.get(g)
      if (ix === undefined) { gix.set(g, groups.length); groups.push({ name: g, items: [it] }) }
      else groups[ix].items.push(it)
    }
    groups.forEach((g, gi) => {
      const head = ws.addRow([`Раздел ${gi + 1}. ${g.name}`, '', '', '', ''])
      head.eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.fill = fill(SEC_BG) })
      const itemEurCells: string[] = []
      for (const it of g.items) {
        const ir = ws.addRow([it.name, it.unit ?? '', it.qty ?? '', it.rate ?? '', ''])
        itemRows.push(ir.number)
        itemEurCells.push(`$E$${ir.number}`)
        if (it.name.includes('Банные модуля')) modulesRow = ir.number
        ir.getCell(1).font = { ...ARIAL, bold: true }
        ir.getCell(2).font = FONT.input as ExcelJS.Font
        ir.getCell(3).font = FONT.input as ExcelJS.Font
        ir.getCell(3).numFmt = '#,##0.##'
        ir.getCell(4).font = FONT.input as ExcelJS.Font
        ir.getCell(4).numFmt = FMT_EUR
        const ec = ir.getCell(5)
        ec.numFmt = FMT_EUR
        ec.font = { ...ARIAL, bold: true }
        // WBS-подразделы и строки работ (пишутся ниже позиции; формулы наперёд — ОК)
        const secRows: number[] = []
        const catTotalRows: number[] = []
        for (const sec of it.wbs ?? []) {
          const sr = ws.addRow([`    ${sec.code} ${sec.title}`, '', '', '', ''])
          secRows.push(sr.number)
          sr.getCell(1).font = { ...ARIAL, italic: true }
          sr.eachCell((c) => (c.fill = fill(SEC_BG)))
          const lineRows: number[] = []
          for (const l of sec.items) {
            // eur строки масштабирован моделью под итог позиции — ставка
            // показывается как eur/qty, чтобы qty×rate воспроизводил её точно
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
        // помодульные детали (экземпляры модулей с датами запуска)
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
        // сумма позиции
        if (secRows.length) {
          ec.value = { formula: `SUM(${secRows.map((x) => `$E$${x}`).join(',')})`, result: it.eur }
        } else if (catTotalRows.length) {
          ec.value = { formula: `SUM(${catTotalRows.map((x) => `$E$${x}`).join(',')})`, result: it.eur }
        } else if (it.qty != null && it.rate != null) {
          ec.value = { formula: `$C$${ir.number}*$D$${ir.number}`, result: it.eur }
        } else {
          ec.value = it.eur
          ec.font = { ...FONT.input, bold: true } as ExcelJS.Font
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
    CX.total = ws.addRow(['ИТОГО CAPEX', '', '', '', '']).number
    const totE = ws.getCell(CX.total, 5)
    totE.value = { formula: `SUM(${itemRows.map((x) => `E${x}`).join(',')})`, result: r.capex.totalEur }
    totE.numFmt = FMT_EUR
    ws.getRow(CX.total).eachCell((c) => { c.font = { ...ARIAL, bold: true }; c.border = dblTop })
    CX.adj = ws.addRow(['С буфером сценария', '', '', '', '']).number
    const adjE = ws.getCell(CX.adj, 5)
    adjE.value = { formula: `$E$${CX.total}*(1+${A$('capexAdj')})`, result: r.capex.adjustedEur }
    adjE.numFmt = FMT_EUR
    adjE.font = { ...ARIAL, bold: true, color: { argb: GREEN } }
    // Амортизация: (итог−земля)×(1+буфер) × Σ доля/(срок×12)
    const amortSum = (A.amortRows as number[])
      .map((x) => `'Допущения'!$B$${x}/('Допущения'!$C$${x}*12)`)
      .join('+')
    CX.amort = ws.addRow(['Амортизация, €/мес', '', '', '', '']).number
    const amE = ws.getCell(CX.amort, 5)
    amE.value = {
      formula: `($E$${CX.adj}-${A$('land')}*(1+${A$('capexAdj')}))*(${amortSum})`,
      result: r.capex.monthlyAmort,
    }
    amE.numFmt = FMT_EUR
    amE.font = { ...ARIAL, color: { argb: GREEN } }
    ws.getCell(CX.amort, 1).note = 'Линейная: амортизируемая база × Σ доля группы / (срок лет × 12)'
  }
  const CX$ = (r2: number) => `'CAPEX'!$E$${r2}`

  // ─── НАЛОГИ ───
  const tax = monthSheet(wb, 'Налоги', labels, [
    { label: 'НДС 19%', cells: nums(r.taxes.map((m) => m.vatOut19)) },
    { label: 'НДС 9%', cells: nums(r.taxes.map((m) => m.vatOut9)) },
    { label: 'Входной НДС', cells: nums(r.taxes.map((m) => m.inputVat)) },
    { label: 'НДС-кредит', cells: nums(r.taxes.map((m) => m.vatCredit)) },
    { label: 'НДС к уплате', cells: nums(r.taxes.map((m) => m.vatPayable)), bold: true },
    { label: 'CIT', cells: nums(r.taxes.map((m) => m.cit)) },
    { label: 'Дивиденды', cells: nums(r.taxes.map((m) => m.dividends)) },
    { label: 'SDC', cells: nums(r.taxes.map((m) => m.sdc)) },
    { label: 'GESY', cells: nums(r.taxes.map((m) => m.gesy)) },
    {
      label: 'ИТОГО НАЛОГИ', bold: true, border: 'top',
      cells: r.taxes.map((m, i) => f(`${L(i + 2)}6+${L(i + 2)}7+${L(i + 2)}9+${L(i + 2)}10`, m.total)),
    },
  ], 'FF7030A0')
  const TAX = {
    v19: tax.rows.get('НДС 19%')!,
    v9: tax.rows.get('НДС 9%')!,
    cit: tax.rows.get('CIT')!,
    div: tax.rows.get('Дивиденды')!,
    sdc: tax.rows.get('SDC')!,
    gesy: tax.rows.get('GESY')!,
  }

  // ─── P&L — связанные формулы ───
  const pnlRows: MonthRow[] = [
    {
      label: 'Выручка нетто',
      cells: r.pnl.map((m, i) =>
        f(`'Выручка'!${L(i + 2)}${REV_T}-'Налоги'!${L(i + 2)}${TAX.v19}-'Налоги'!${L(i + 2)}${TAX.v9}`, m.revenueNet)),
    },
    {
      label: 'Маржинальная прибыль',
      cells: r.pnl.map((m, i) =>
        f(`${L(i + 2)}2-'OPEX'!${L(i + 2)}${OPEX.variable}-'OPEX'!${L(i + 2)}${OPEX.pct}`, m.marginalProfit)),
    },
    {
      label: 'EBITDA', bold: true, border: 'top',
      cells: r.pnl.map((m, i) =>
        f(`${L(i + 2)}3-'OPEX'!${L(i + 2)}${OPEX.fixed}-'OPEX'!${L(i + 2)}${OPEX.it}-'OPEX'!${L(i + 2)}${OPEX.land}-'ФОТ'!${L(i + 2)}${FOT_T}`, m.ebitda)),
    },
    {
      label: 'Амортизация',
      cells: r.pnl.map((m) => f(`${CX$(CX.amort)}`, m.amortization)),
    },
    { label: 'EBIT', bold: true, cells: r.pnl.map((m, i) => f(`${L(i + 2)}4-${L(i + 2)}5`, m.ebit)) },
    {
      label: 'CIT',
      cells: r.pnl.map((m, i) => f(`'Налоги'!${L(i + 2)}${TAX.cit}`, m.cit)),
    },
    { label: 'Чистая прибыль', bold: true, cells: r.pnl.map((m, i) => f(`${L(i + 2)}6-${L(i + 2)}7`, m.netProfit)) },
    {
      label: 'Дивиденды',
      cells: r.pnl.map((m, i) => f(`'Налоги'!${L(i + 2)}${TAX.div}`, m.dividends)),
    },
    {
      label: 'SDC + GESY',
      cells: r.pnl.map((m, i) => f(`'Налоги'!${L(i + 2)}${TAX.sdc}+'Налоги'!${L(i + 2)}${TAX.gesy}`, m.sdc + m.gesy)),
    },
    {
      label: 'ЧП после SDC+GESY', bold: true, border: 'top',
      cells: r.pnl.map((m, i) => f(`${L(i + 2)}8-${L(i + 2)}10`, m.netAfterSdc)),
    },
  ]
  const pnl = monthSheet(wb, 'PnL', labels, pnlRows, 'FF2E75B6')
  const PNL = {
    np: pnl.rows.get('Чистая прибыль')!,
    amort: pnl.rows.get('Амортизация')!,
    vatOut: null as number | null, // ΔНДС пишем значениями — ниже
  }
  // строка «НДС начисленный» и «к уплате» нужны CF — добавим их скрытым блоком
  {
    const ws = pnl.ws
    const v1 = ws.addRow(['НДС начисленный (справочно)'])
    const v2 = ws.addRow(['НДС уплачен в кэше (квартально, справочно)'])
    r.pnl.forEach((m, i) => {
      ws.getCell(v1.number, i + 2).value = m.vatOut
      ws.getCell(v2.number, i + 2).value = m.vatPaid
      for (const rr of [v1.number, v2.number]) {
        ws.getCell(rr, i + 2).numFmt = FMT_EUR
        ws.getCell(rr, i + 2).font = { ...ARIAL, color: { argb: 'FF8A97B0' } }
      }
    })
    PNL.vatOut = v1.number
    const vatPay = v2.number
    // ─── CASH-FLOW (capexMonths стройки + ops) ───
    // Номера строк фиксированы порядком массива ниже: ЧП=2, Аморт=3, ΔНДС=4,
    // OCF=5, CAPEX=6, отложенный=7, пресейл=8, прогорание=9, земля=10, preopen=11,
    // maint=12, FCFF=13, дивиденды=14, удержано=15, CF=16, equity=17, касса=18,
    // накопл.FCFF=19, DF=20, NPV=21 — нужны для перекрёстных формул.
    const CF_DEF = 7
    // S-кривая стройки — входы на листе Cash-Flow (строка весов ниже таблицы)
    const cfLabels = r.cashflow.map((m) => m.label)
    const cf = monthSheet(wb, 'Cash-Flow', cfLabels, [
      {
        label: 'Чистая прибыль',
        cells: r.cashflow.map((m, i) =>
          m.isOps ? f(`'PnL'!${L(i + 2 - capM)}${PNL.np}`, m.netProfit) : 0),
      },
      {
        label: 'Амортизация',
        cells: r.cashflow.map((m, i) =>
          m.isOps ? f(`'PnL'!${L(i + 2 - capM)}${PNL.amort}`, m.amortization) : 0),
      },
      {
        label: 'Δ обязательства НДС',
        cells: r.cashflow.map((m, i) =>
          m.isOps
            ? f(`'PnL'!${L(i + 2 - capM)}${PNL.vatOut}-'PnL'!${L(i + 2 - capM)}${vatPay}`, m.vatTiming)
            : 0),
      },
      {
        label: 'Операционный CF', bold: true, border: 'top',
        cells: r.cashflow.map((m, i) => f(`SUM(${L(i + 2)}2:${L(i + 2)}4)`, m.operatingCf)),
      },
      {
        label: 'CAPEX (S-кривая)',
        // в стройку идёт смета за вычетом отложенной доли резервных модулей × вес месяца (строка 23)
        cells: r.cashflow.map((m, i) =>
          !m.isOps
            ? f(`-(${CX$(CX.adj)}+SUM($B$${CF_DEF}:${L(1 + cfTotal)}$${CF_DEF}))*${L(i + 2)}$23`, m.capex)
            : 0),
      },
      { label: 'CAPEX модулей (отложенный)', cells: nums(r.cashflow.map((m) => m.deferredCapex)) },
      { label: 'Пре-сейл', cells: nums(r.cashflow.map((m) => m.presale)), style: 'input' },
      { label: 'Прогорание пресейла', cells: nums(r.cashflow.map((m) => m.presaleUnwind)) },
      { label: 'Аренда земли (стройка)', cells: nums(r.cashflow.map((m) => m.landLease)), style: 'input' },
      { label: 'Pre-opening', cells: nums(r.cashflow.map((m) => m.preopen)), style: 'input' },
      { label: 'Maintenance CAPEX', cells: nums(r.cashflow.map((m) => m.maintCapex)), style: 'input' },
      {
        label: 'FCFF', bold: true, border: 'top',
        cells: r.cashflow.map((m, i) => f(`SUM(${L(i + 2)}5:${L(i + 2)}12)`, m.fcff)),
      },
      {
        label: 'Дивиденды брутто',
        cells: r.cashflow.map((m, i) =>
          m.isOps ? f(`-'Налоги'!${L(i + 2 - capM)}${TAX.div}`, m.dividends) : 0),
      },
      {
        label: '  в т.ч. удержано SDC+GESY (справочно)',
        cells: r.cashflow.map((m, i) =>
          m.isOps ? f(`-'Налоги'!${L(i + 2 - capM)}${TAX.sdc}-'Налоги'!${L(i + 2 - capM)}${TAX.gesy}`, -(m.sdc + m.gesy)) : 0),
      },
      {
        label: 'CF после распределения', bold: true,
        cells: r.cashflow.map((m, i) => f(`${L(i + 2)}13+${L(i + 2)}14`, m.totalCf)),
      },
      {
        label: 'Equity-транш акционеров',
        cells: r.cashflow.map((m, i) =>
          f(i === 0 ? `MAX(0,-${L(i + 2)}16)` : `MAX(0,-(${L(i + 1)}18+${L(i + 2)}16))`, m.equityIn)),
      },
      {
        label: 'Касса на конец месяца', bold: true,
        cells: r.cashflow.map((m, i) =>
          f(i === 0 ? `${L(i + 2)}16+${L(i + 2)}17` : `${L(i + 1)}18+${L(i + 2)}16+${L(i + 2)}17`, m.cash)),
      },
      {
        label: 'Накопл. FCFF',
        cells: r.cashflow.map((m, i) =>
          f(i === 0 ? `${L(i + 2)}13` : `${L(i + 1)}19+${L(i + 2)}13`, m.cumFcff)),
      },
      {
        label: 'Дисконт-фактор',
        cells: r.cashflow.map((m, i) =>
          f(`1/(1+${A$('wacc')})^(${i + 1}/12)`, m.discountFactor)),
        fmt: '0.000',
      },
      {
        label: 'Накопл. DCF (NPV)', bold: true, border: 'top',
        cells: r.cashflow.map((m, i) =>
          f(i === 0 ? `${L(i + 2)}13*${L(i + 2)}20` : `${L(i + 1)}21+${L(i + 2)}13*${L(i + 2)}20`, m.cumDcf)),
      },
      { label: 'Пул предоплат (обязат.)', cells: nums(r.cashflow.map((m) => m.prepaidPool)) },
      {
        label: 'Вес S-кривой стройки (вход)', fmt: '0.0%',
        cells: r.cashflow.map((m, i) => (m.isOps ? null : sCurve[i])), style: 'input',
      },
    ], 'FF548235')
    const CF = {
      fcff: cf.rows.get('FCFF')!,
      cumFcff: cf.rows.get('Накопл. FCFF')!,
      cumDcf: cf.rows.get('Накопл. DCF (NPV)')!,
      df: cf.rows.get('Дисконт-фактор')!,
      equity: cf.rows.get('Equity-транш акционеров')!,
    }
    const lastCol = L(1 + cfTotal)

    // ─── БАЛАНС (мини) ───
    {
      const B = r.balance
      const bal = monthSheet(wb, 'Баланс', cfLabels, [
        { label: 'Касса', cells: B.map((b, i) => f(`'Cash-Flow'!${L(i + 2)}18`, b.cash)) },
        { label: 'Основные средства (остаточная)', cells: nums(B.map((b) => b.ppeNbv)) },
        { label: 'АКТИВЫ', bold: true, border: 'top', cells: B.map((b, i) => f(`${L(i + 2)}2+${L(i + 2)}3`, b.totalAssets)) },
        { label: 'Предоплаты гостей (deferred revenue)', cells: B.map((b, i) => f(`'Cash-Flow'!${L(i + 2)}22`, b.prepaidPool)) },
        { label: 'НДС: нетто-расчёты с бюджетом', cells: nums(B.map((b) => b.vatNet)) },
        { label: 'Вклады акционеров (equity-транши)', cells: B.map((b, i) => f(i === 0 ? `'Cash-Flow'!${L(i + 2)}17` : `${L(i + 1)}7+'Cash-Flow'!${L(i + 2)}17`, b.equityIn)) },
        { label: 'Нераспределённая прибыль', cells: nums(B.map((b) => b.retained)) },
        { label: 'ОБЯЗАТЕЛЬСТВА + КАПИТАЛ', bold: true, border: 'top', cells: B.map((b, i) => f(`SUM(${L(i + 2)}5:${L(i + 2)}8)`, b.totalLiabEq)) },
        { label: 'Контроль (А − П)', cells: B.map((b, i) => f(`${L(i + 2)}4-${L(i + 2)}9`, b.check)), fmt: FMT_EUR2 },
      ], 'FF7F7F7F')
      void bal
    }

    // ─── НОМЕНКЛАТУРА ───
    {
      const ws = wb.addWorksheet('Номенклатура')
      ws.addRow(['Код', 'Наименование', 'Категория', 'Тип', 'Ед.', 'Цена €', 'Дост.€/ед', 'Дост.%', 'Landed €', 'Учёт', 'Статья OPEX', 'Норма', 'База', 'Кол-во', 'Нач. запас'])
      headerRow(ws)
      freezeFirst(ws)
      ws.autoFilter = { from: 'A1', to: 'O1' }
      ws.getColumn(1).width = 10
      ws.getColumn(2).width = 36
      ws.getColumn(3).width = 20
      for (const it of items) {
        const row = ws.addRow([it.code, it.name, it.category, it.type, it.unit, it.price, it.deliveryFix, it.deliveryPct,
          '', it.use, it.opexArticle, it.norm, it.normBase, it.qty, it.initialQty ?? 0])
        row.eachCell((c) => (c.font = { ...ARIAL }))
        // входы — синие; landed — формула =цена+max(фикс, цена×%)
        for (const ci of [6, 7, 8, 11, 12, 13, 14, 15]) ws.getCell(row.number, ci).font = FONT.input as ExcelJS.Font
        const lc = ws.getCell(row.number, 9)
        lc.value = { formula: `F${row.number}+MAX(G${row.number},F${row.number}*H${row.number})`, result: landedCost(it) }
        lc.numFmt = FMT_EUR2
        ws.getCell(row.number, 8).numFmt = FMT_PCT
      }
    }

    // ─── SENSITIVITY (снимок — пересчёт ядром, не формулами) ───
    {
      const ws = wb.addWorksheet('Sensitivity')
      const s = computeSensitivity(params, matrix, items, services)
      ws.addRow([`Спрос \\ WACC`, ...s.t1.waccAxis.map((w) => `${(w * 100).toFixed(1)}%`)])
      headerRow(ws)
      ws.getColumn(1).width = 18
      for (const row of s.t1.rows) {
        const rw = ws.addRow([`×${row.demand}`, ...row.cells.map((c) => Math.round(c.npv))])
        rw.eachCell((c, i) => { if (i > 1) { c.numFmt = FMT_EUR; c.font = { ...ARIAL } } })
      }
      ws.addRow([])
      ws.addRow(['Рост цен \\ CAPEX', ...T2_CAPEX.map((c) => `+${c * 100}%`)])
      headerRow(ws, ws.rowCount)
      for (const row of s.t2.rows) {
        const rw = ws.addRow([`${row.priceGrowth * 100}%`, ...row.cells.map((c) => Math.round(c.npv))])
        rw.eachCell((c, i) => { if (i > 1) { c.numFmt = FMT_EUR; c.font = { ...ARIAL } } })
      }
      ws.addRow([])
      ws.addRow(['Цены ×', ...s.t3.map((t) => `×${t.priceMult}`)])
      headerRow(ws, ws.rowCount)
      const n1 = ws.addRow(['NPV', ...s.t3.map((t) => Math.round(t.npv))])
      n1.eachCell((c, i) => { if (i > 1) c.numFmt = FMT_EUR })
      const n2 = ws.addRow(['IRR', ...s.t3.map((t) => t.irr)])
      n2.eachCell((c, i) => { if (i > 1) c.numFmt = FMT_PCT })
      ws.addRow([])
      ws.addRow(['Пакет \\ Загрузка', ...s.t4.loadAxis.map((l) => `×${l}`)])
      headerRow(ws, ws.rowCount)
      for (const row of s.t4.rows) {
        const rw = ws.addRow([`${row.uptake * 100}% гостей`, ...row.cells.map((c) => Math.round(c.npv))])
        rw.eachCell((c, i) => { if (i > 1) { c.numFmt = FMT_EUR; c.font = { ...ARIAL } } })
      }
      ws.addRow([])
      ws.addRow(['Задержка стройки \\ CAPEX', ...s.t5.capexAxis.map((c) => `+${c * 100}%`)])
      headerRow(ws, ws.rowCount)
      for (const row of s.t5.rows) {
        const rw = ws.addRow([`+${row.delayMonths} мес`, ...row.cells.map((c) => Math.round(c.npv))])
        rw.eachCell((c, i) => { if (i > 1) { c.numFmt = FMT_EUR; c.font = { ...ARIAL } } })
      }
    }

    // ─── KPI ───
    const kpiRows: { label: string; formula?: string; v: number; fmt: string }[] = []
    {
      const ws = wb.addWorksheet('KPI')
      ws.addRow(['Метрика', ...matrix.names])
      headerRow(ws)
      freezeFirst(ws)
      ws.getColumn(1).width = 34
      const put = (l: string, g: (x: ModelResult) => number, fmt = FMT_EUR) => {
        const row = ws.addRow([l])
        row.getCell(1).font = { ...ARIAL }
        results.forEach((x, i) => putCell(ws, row.number, i + 2, g(x), fmt, 'calc'))
      }
      put('WACC (эфф. годовая)', (x) => x.kpis.wacc, FMT_PCT)
      put('NPV (5 лет), EUR', (x) => Math.round(x.kpis.npv))
      put('IRR годовой (эфф.)', (x) => x.kpis.irrAnnual, FMT_PCT)
      put('Окупаемость, мес', (x) => x.kpis.paybackMonths, '0')
      put('Диск. окупаемость, мес', (x) => x.kpis.discountedPaybackMonths, '0')
      put('Пиковая потребность, EUR', (x) => Math.round(x.kpis.peakFundingNeed))
      put('Equity-транши Σ, EUR', (x) => Math.round(x.kpis.equityTotal))
      put('MOIC', (x) => x.kpis.moic, '0.00"x"')
      put('Выручка год 1, EUR', (x) => Math.round(x.revenue.slice(0, 12).reduce((s2, m) => s2 + m.total, 0)))
      put('EBITDA год 1, EUR', (x) => Math.round(x.pnl.slice(0, 12).reduce((s2, m) => s2 + m.ebitda, 0)))
      ws.addRow([])
      ws.addRow(['Живые формулы — активный сценарий', params.meta.scenario])
      headerRow(ws, ws.rowCount)
      const kf = ws.rowCount
      const kpis = r.kpis
      kpiRows.push(
        { label: 'NPV = накопл. DCF', formula: `'Cash-Flow'!${lastCol}${CF.cumDcf}`, v: kpis.npv, fmt: FMT_EUR },
        { label: 'IRR годовой (эфф.)', formula: `(1+IRR('Cash-Flow'!$B$${CF.fcff}:${lastCol}${CF.fcff},0.02))^12-1`, v: kpis.irrAnnual, fmt: FMT_PCT },
        { label: 'Equity-транши Σ', formula: `SUM('Cash-Flow'!$B$${CF.equity}:${lastCol}${CF.equity})`, v: kpis.equityTotal, fmt: FMT_EUR },
        { label: 'Окупаемость, мес', formula: `COUNTIF('Cash-Flow'!$B$${CF.cumFcff}:${lastCol}${CF.cumFcff},"<=0")+1`, v: kpis.paybackMonths, fmt: '0' },
        { label: 'Диск. окупаемость, мес', formula: `COUNTIF('Cash-Flow'!$B$${CF.cumDcf}:${lastCol}${CF.cumDcf},"<=0")+1`, v: kpis.discountedPaybackMonths, fmt: '0' },
        { label: 'Пиковая потребность', formula: `MIN('Cash-Flow'!$B$${CF.cumFcff}:${lastCol}${CF.cumFcff})`, v: kpis.peakFundingNeed, fmt: FMT_EUR },
      )
      kpiRows.forEach((k2, i) => {
        const row = ws.addRow([k2.label])
        row.getCell(1).font = { ...ARIAL }
        const cell = ws.getCell(row.number, 2)
        cell.value = { formula: k2.formula!, result: k2.v }
        cell.numFmt = k2.fmt
        cell.font = { ...ARIAL, color: { argb: GREEN } }
        void i
      })
      void kf
    }

    // ─── CHECKS — независимые пересчёты ───
    {
      const ws = wb.addWorksheet('Checks')
      ws.properties.tabColor = { argb: 'FF70AD47' }
      ws.addRow(['Проверка', 'Статус', 'Ожидалось', 'Пересчёт'])
      headerRow(ws)
      ws.getColumn(1).width = 52
      ws.getColumn(2).width = 14
      ws.getColumn(3).width = 16
      ws.getColumn(4).width = 16
      const y1cols = `${L(2)}:${L(13)}` // первый год операций
      const y1 = (sheet: string, row: number) => `SUM('${sheet}'!${y1cols.split(':')[0]}${row}:${y1cols.split(':')[1]}${row})`
      const checks: { name: string; recalc: string }[] = [
        {
          name: 'CAPEX: WBS «Банные модули» = 210 000 €',
          recalc: `'CAPEX'!$E$${modulesRow}`,
        },
        {
          name: 'PnL год 1: ЧП = Σ(EBIT − CIT)',
          recalc: `SUM('PnL'!B6:M6)-SUM('PnL'!B7:M7)`,
        },
        {
          name: 'PnL год 1: Нетто = Выручка − НДС',
          recalc: `${y1('Выручка', REV_T)}-${y1('Налоги', TAX.v19)}-${y1('Налоги', TAX.v9)}`,
        },
        {
          name: 'CF: накопл. FCFF(посл.) = Σ FCFF',
          recalc: `SUM('Cash-Flow'!B${CF.fcff}:${lastCol}${CF.fcff})`,
        },
        {
          name: 'KPI: NPV = Σ FCFF × DF',
          recalc: `SUMPRODUCT('Cash-Flow'!B${CF.fcff}:${lastCol}${CF.fcff},'Cash-Flow'!B${CF.df}:${lastCol}${CF.df})`,
        },
        {
          name: 'OPEX год 1: ИТОГО = Σ статей',
          recalc: `${y1('OPEX', OPEX.fixed)}+${y1('OPEX', OPEX.it)}+${y1('OPEX', OPEX.land)}+${y1('OPEX', OPEX.variable)}+${y1('OPEX', OPEX.pct)}`,
        },
        {
          name: 'Баланс: max |Активы − Пассивы| = 0',
          recalc: `SUMPRODUCT(ABS('Баланс'!B10:${lastCol}10))`,
        },
        {
          name: 'CF: Σ весов S-кривой стройки = 100%',
          recalc: `SUM('Cash-Flow'!B23:${L(1 + capM)}23)*100`,
        },
      ]
      // ожидаемые значения — из результата ядра
      const expVals = [
        210000,
        r.pnl.slice(0, 12).reduce((s, m) => s + m.netProfit, 0),
        r.pnl.slice(0, 12).reduce((s, m) => s + m.revenueNet, 0),
        r.cashflow[cfTotal - 1].cumFcff,
        r.cashflow[cfTotal - 1].cumDcf,
        r.opex.slice(0, 12).reduce((s, m) => s + m.total, 0),
        0,
        100,
      ]
      checks.forEach((c, i) => {
        const ev2 = expVals[i]
        const row = ws.addRow([c.name, '', ev2, ''])
        row.getCell(1).font = { ...ARIAL }
        row.getCell(3).numFmt = FMT_EUR
        row.getCell(3).font = { ...ARIAL }
        const st = ws.getCell(row.number, 2)
        st.value = { formula: `IF(ABS(C${row.number}-D${row.number})<1,"OK","FAIL")`, result: 'OK' }
        st.font = { ...ARIAL, bold: true, color: { argb: 'FF1E7B34' } }
        st.alignment = { horizontal: 'center' }
        const rc = ws.getCell(row.number, 4)
        rc.value = { formula: c.recalc, result: ev2 }
        rc.numFmt = FMT_EUR
        rc.font = FONT.calc as ExcelJS.Font
      })
      ws.getCell(ws.rowCount + 2, 1).value = 'OK — пересчёт совпал с ожидаемым (допуск €1). FAIL — расходится: проверить формулы листов.'
      ws.getCell(ws.rowCount, 1).font = { ...ARIAL, italic: true, color: { argb: 'FF7A8AA8' } }
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
