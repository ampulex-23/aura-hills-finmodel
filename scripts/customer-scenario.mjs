// Сдержанный просчёт по вводным заказчика (НЕ трогает модель/стейт).
// Читает реальные данные ядра: src/data/{nomenclature,services,params}.json
// и считает по формулам движка (src/model/{fot,opex,taxes}.ts):
//   - цены услуг = gross, НДС выделяется rate/(1+rate)
//   - спековые материалы = count услуги × qty позиции × цена номенклатуры
//   - KPI-бонус = count × price × laborShare (по спеке)
//   - соцвзносы работодателя = gross ФОТ × employerRate
//   - нормативные расходники = norm × гости (normBase='гость')
//   - CIT 15% от прибыли, VAT quarterly
// Запуск: node scripts/customer-scenario.mjs → out/customer-conservative.xlsx
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import ExcelJS from 'exceljs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const params = J('src/data/params.json')
const nomenclature = J('src/data/nomenclature.json')
const services = J('src/data/services.json').services

const byCode = new Map(nomenclature.map((i) => [i.code, i]))
const price = (code) => byCode.get(code)?.priceEur ?? byCode.get(code)?.price ?? 0
const svc = (code) => services.find((s) => s.code === code)

// ---------- Вводные заказчика ----------
const CFG = {
  months: 36,                    // горизонт операционки, мес
  daysPerMonth: 30,
  guestsPerDay: [12, 16],        // год1 / год2+
  vat: params.taxes.vatStd,      // 19% на услуги
  cit: params.taxes.cit,         // 15%
  employerRate: params.taxes.employerRate, // 15.4%
  inflation: params.general.inflation,     // 2.5%/год на оклады

  // услуги на гостя (гросс, НДС внутри)
  streams: [
    { name: 'Парения Дубль',        price: 100, uptake: 1.0, spec: 'SVC-P2', perGuest: true },
    { name: 'Аренда бани',          price: 100, uptake: 1.0, spec: 'SVC-A1', perGuest: true, shareOfSession: 4 }, // спека — на сессию до 4 чел
    { name: 'Массаж 2 (глубокий)',  price: 100, uptake: 0.5, spec: 'SVC-M2', perGuest: true },
  ],

  // штат (численность по годам) — оклады €/мес
  staff: [
    { role: 'Пармастер',     salary: 500,  count: [4, 6] },
    { role: 'Массажист',     salary: 500,  count: [2, 4] },
    { role: 'Управляющий',   salary: 2500, count: [1, 1] },
    { role: 'Администратор', salary: 1500, count: [1, 1] },
  ],
  itCuratorMonthly: params.it.curator, // 1000/мес — в ФОТ как в ядре

  // прочие OPEX (€/мес, если не % выручки)
  marketing: (m) => (m <= 6 ? 5000 : m <= 12 ? 5000 - (m - 6) * ((5000 - 2500) / 6) : 2500),
  insurance: 100,
  acquiringPct: 0.02,   // 2% выручки
  maintenancePct: 0.01, // 1% выручки («ремонт/обслуживание 1»)
  itMonthly: 1180,      // содержание IT

  // CAPEX (месяц 0)
  land: 1_500_000,
  itCapex: 17_000,
}

// ---------- производные из данных ядра ----------
// Стоимость материалов спеки на одну услугу (и доля labor ролей)
function specCost(specCode, { perGuest = 1 } = {}) {
  const s = svc(specCode)
  const mats = s.items.filter((i) => i.kind === 'material' && i.code)
  const labor = s.items.filter((i) => i.kind === 'labor')
  const matCost = mats.reduce((sum, i) => sum + i.qty * price(i.code), 0) / perGuest
  return { spec: s, mats, labor, matCost }
}
for (const st of CFG.streams) {
  const per = st.shareOfSession ?? 1 // аренда: спека на сессию ≤4 чел → /4 на гостя
  st.detail = specCost(st.spec, { perGuest: per })
}

// Нормативные расходники на гостя (normBase='гость', не входящие в спеки)
const specCodes = new Set(services.flatMap((s) => s.items.filter((i) => i.code).map((i) => i.code)))
const guestNormItems = nomenclature.filter(
  (i) => i.normBase === 'гость' && i.use !== 'CAPEX' && i.opexArticle != null && !specCodes.has(i.code),
)
const guestNormCost = guestNormItems.reduce((s, i) => s + i.norm * price(i.code), 0)

// ---------- помесячный расчёт ----------
const months = []
for (let m = 1; m <= CFG.months; m++) {
  const year = Math.floor((m - 1) / 12) // 0=год1, 1+=год2+
  const guests = CFG.guestsPerDay[Math.min(year, CFG.guestsPerDay.length - 1)] * CFG.daysPerMonth
  const infl = Math.pow(1 + CFG.inflation, year)

  // выручка (гросс, НДС внутри) и материалы по потокам
  let revGross = 0, matCost = 0, kpiBonus = 0
  const streamRows = []
  for (const st of CFG.streams) {
    const cnt = guests * st.uptake
    const rev = cnt * st.price
    revGross += rev
    matCost += cnt * st.detail.matCost
    for (const l of st.detail.labor) kpiBonus += rev * (l.pct ?? 0)
    streamRows.push({ name: st.name, cnt, rev, mat: cnt * st.detail.matCost })
  }
  const guestsCons = guests * guestNormCost // расходники на гостя

  // ФОТ
  const salaries =
    CFG.staff.reduce((s, r) => s + r.salary * r.count[Math.min(year, r.count.length - 1)], 0) * infl +
    CFG.itCuratorMonthly
  const grossFot = salaries + kpiBonus
  const social = grossFot * CFG.employerRate
  const fot = grossFot + social

  // OPEX
  const acquiring = revGross * CFG.acquiringPct
  const maintenance = revGross * CFG.maintenancePct
  const marketing = CFG.marketing(m)
  const opex = matCost + guestsCons + acquiring + maintenance + marketing + CFG.insurance + CFG.itMonthly

  // НДС: output = выручка ×19/119; input = материалы и расходники ×19/119
  const vatOut = (revGross * CFG.vat) / (1 + CFG.vat)
  const vatIn = ((matCost + guestsCons) * CFG.vat) / (1 + CFG.vat)
  const ebitda = revGross - vatOut - opex - fot

  months.push({
    m, year: year + 1, guests, infl, streamRows, revGross, vatOut, vatIn,
    matCost, guestsCons, salaries, kpiBonus, social, fot,
    acquiring, maintenance, marketing, opex, ebitda,
  })
}

// CIT 15% на годовую прибыль (EBITDA−амортизация; упрощённо: аморт=0, т.к. земля не амортизируется, IT мелкий)
for (const mo of months) {
  const yearStart = (mo.year - 1) * 12
  // CIT начисляем по году — платим в декабре года (консервативно)
  mo.cit = 0
  if (mo.m % 12 === 0) {
    const profit = months.slice(yearStart, yearStart + 12).reduce((s, x) => s + x.ebitda, 0)
    mo.cit = Math.max(0, profit * CFG.cit)
  }
  mo.vatPayable = Math.max(0, mo.vatOut - mo.vatIn) + (mo.m === 1 ? (CFG.itCapex * CFG.vat) / (1 + CFG.vat) * -1 : 0)
  mo.capex = mo.m === 1 ? CFG.land + CFG.itCapex : 0
  mo.cf = mo.ebitda - mo.cit - mo.vatPayable - mo.capex
}
months.forEach((mo, i) => (mo.cumCf = months.slice(0, i + 1).reduce((s, x) => s + x.cf, 0)))

const y1 = months.slice(0, 12), y2 = months.slice(12, 24), y3 = months.slice(24, 36)
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0)

// ---------- консольная сводка ----------
console.log('=== Сводка ===')
console.log(`Гость приносит: €${CFG.streams.reduce((s, x) => s + x.price * x.uptake, 0)} gross`)
console.log(`Материалы/гость: парение €${CFG.streams[0].detail.matCost.toFixed(2)} + аренда €${CFG.streams[1].detail.matCost.toFixed(2)} + массаж €${(CFG.streams[2].detail.matCost * 0.5).toFixed(2)} + расходники €${guestNormCost.toFixed(2)}`)
for (const [lbl, arr] of [['Год 1', y1], ['Год 2', y2], ['Год 3', y3]])
  console.log(`${lbl}: выручка €${Math.round(sum(arr, (x) => x.revGross)).toLocaleString('ru')}, EBITDA €${Math.round(sum(arr, (x) => x.ebitda)).toLocaleString('ru')}, CF €${Math.round(sum(arr, (x) => x.cf)).toLocaleString('ru')}`)
console.log(`Накопл. CF за 36 мес: €${Math.round(months[35].cumCf).toLocaleString('ru')}`)

// ---------- Excel ----------
const wb = new ExcelJS.Workbook()
wb.creator = 'AURA HILLS'

const FONT = 'Calibri'
const C = {
  title: 'FF1B2330', header: 'FF2A3A55', headerTxt: 'FFFFFFFF',
  sub: 'FF4A5A78', pos: 'FF2E7D32', neg: 'FFC62828', dim: 'FF8B98AD',
  band: 'FFF2F5FA', bandD: 'FFE8EDF5', card: 'FFFFFFFF',
}
const eur = '#,##0 "€"'
const eur2 = '#,##0.00 "€"'

const sheet = (name) => {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.getRow(1).height = 26
  return ws
}
const title = (ws, text, note) => {
  ws.mergeCells(1, 1, 1, 6)
  const c = ws.getCell(1, 1); c.value = text
  c.font = { name: FONT, size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.title } }
  c.alignment = { vertical: 'middle', indent: 1 }
  if (note) {
    ws.mergeCells(2, 1, 2, 6)
    const n = ws.getCell(2, 1); n.value = note
    n.font = { name: FONT, size: 9, italic: true, color: { argb: C.dim } }
  }
}
const header = (ws, row, cells, widths) => {
  cells.forEach((v, i) => {
    const c = ws.getCell(row, i + 1); c.value = v
    c.font = { name: FONT, size: 10, bold: true, color: { argb: C.headerTxt } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.header } }
    c.alignment = { vertical: 'middle' }
  })
  widths?.forEach((w, i) => (ws.getColumn(i + 1).width = w))
}
const row = (ws, r, cells, fmt = []) => {
  cells.forEach((v, i) => {
    const c = ws.getCell(r, i + 1); c.value = v
    c.font = { name: FONT, size: 10 }
    if (fmt[i]) c.numFmt = fmt[i]
    if (typeof v === 'number') c.alignment = { horizontal: 'right' }
  })
}
const sec = (ws, r, label) => {
  ws.mergeCells(r, 1, r, 6)
  const c = ws.getCell(r, 1); c.value = label
  c.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.sub } }
}
const kv = (ws, r, k, v, fmtV) => {
  ws.getCell(r, 1).value = k; ws.getCell(r, 1).font = { name: FONT, size: 10 }
  const c = ws.getCell(r, 2); c.value = v; c.font = { name: FONT, size: 10, bold: true }
  if (fmtV) c.numFmt = fmtV
  c.alignment = { horizontal: 'right' }
}
const totalRow = (ws, r, cells, fmt = []) => {
  cells.forEach((v, i) => {
    const c = ws.getCell(r, i + 1); c.value = v
    c.font = { name: FONT, size: 10, bold: true }
    if (fmt[i]) c.numFmt = fmt[i]
    if (typeof v === 'number') c.alignment = { horizontal: 'right' }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.bandD } }
    c.border = { top: { style: 'thin', color: { argb: C.sub } } }
  })
}

// ---- Лист 1: Допущения ----
{
  const ws = sheet('Допущения')
  title(ws, 'AURA HILLS — сдержанный сценарий (вводные заказчика)', `Дата расчёта: ${new Date().toLocaleDateString('ru-RU')} · цены с НДС · горизонт 36 мес`)
  let r = 4
  sec(ws, r++, 'Посещаемость')
  kv(ws, r++, 'Гостей в день — год 1', CFG.guestsPerDay[0])
  kv(ws, r++, 'Гостей в день — год 2+', CFG.guestsPerDay[1])
  kv(ws, r++, 'Дней в месяце', CFG.daysPerMonth)
  kv(ws, r++, 'Гостей в месяц — год 1', CFG.guestsPerDay[0] * 30)
  kv(ws, r++, 'Гостей в месяц — год 2+', CFG.guestsPerDay[1] * 30)
  r++
  sec(ws, r++, 'Услуги на гостя (цены с НДС)')
  for (const st of CFG.streams) {
    kv(ws, r, `  ${st.name}`, st.price, eur)
    ws.getCell(r, 3).value = st.uptake === 1 ? 'каждый гость' : `${st.uptake * 100}% гостей`
    ws.getCell(r, 3).font = { name: FONT, size: 9, italic: true, color: { argb: C.dim } }
    ws.getCell(r, 4).value = `материалы €${st.detail.matCost.toFixed(2)}/гость`
    ws.getCell(r, 4).font = { name: FONT, size: 9, color: { argb: C.dim } }
    r++
  }
  kv(ws, r++, 'Итого выручка на гостя (средняя)', CFG.streams.reduce((s, x) => s + x.price * x.uptake, 0), eur)
  r++
  sec(ws, r++, 'Штат (оклад €/мес; KPI — % с процедур по спецификациям)')
  for (const s of CFG.staff)
    kv(ws, r++, `  ${s.role} — ${s.count[0]} чел → год 2: ${s.count[1]} чел`, s.salary, eur)
  kv(ws, r++, '  Куратор IT', CFG.itCuratorMonthly, eur)
  kv(ws, r++, 'Соцвзносы работодателя (на ФОТ с KPI)', CFG.employerRate, '0.0%')
  kv(ws, r++, 'Индексация окладов (инфляция)', CFG.inflation, '0.0%')
  r++
  sec(ws, r++, 'Прочие OPEX')
  kv(ws, r++, 'Маркетинг — мес 1–6', 5000, eur)
  kv(ws, r++, 'Маркетинг — мес 7–12 (линейное снижение к)', 2500, eur)
  kv(ws, r++, 'Маркетинг — год 2+', 2500, eur)
  kv(ws, r++, 'Страхование', CFG.insurance, eur)
  kv(ws, r++, 'Эквайринг', CFG.acquiringPct, '0%')
  kv(ws, r++, 'Ремонт/обслуживание', CFG.maintenancePct, '0%')
  kv(ws, r++, 'IT-содержание', CFG.itMonthly, eur)
  kv(ws, r++, 'Расходники на гостя (нормативные, 15 позиций)', guestNormCost, eur2)
  r++
  sec(ws, r++, 'CAPEX и налоги')
  kv(ws, r++, 'Земля', CFG.land, eur)
  kv(ws, r++, 'IT-внедрение', CFG.itCapex, eur)
  kv(ws, r++, 'НДС на услуги', CFG.vat, '0%')
  kv(ws, r++, 'Налог на прибыль (CIT)', CFG.cit, '0%')
  ws.getColumn(1).width = 52
  ws.getColumn(2).width = 14
  ws.getColumn(3).width = 22
  ws.getColumn(4).width = 26
}

// ---- Лист 2: Спецификации услуг ----
{
  const ws = sheet('Спецификации')
  title(ws, 'Расходные материалы по процедурам (из номенклатуры ядра)')
  let r = 4
  for (const st of CFG.streams) {
    sec(ws, r++, `${st.name} — €${st.price}${st.shareOfSession ? ` (спека на сессию до ${st.shareOfSession} чел → /${st.shareOfSession} на гостя)` : ''}`)
    header(ws, r++, ['Код', 'Материал', 'Норма', 'Ед.', 'Цена €', 'Стоимость €/гость'], [10, 40, 8, 8, 10, 16])
    for (const it of st.detail.mats) {
      const p = price(it.code)
      const per = (st.shareOfSession ?? 1)
      row(ws, r++, [it.code, byCode.get(it.code)?.name, it.qty, byCode.get(it.code)?.unit, p, (it.qty * p) / per],
        [null, null, '0.000', null, eur2, eur2])
    }
    for (const l of st.detail.labor)
      row(ws, r++, ['', `KPI ${l.role} — % от выручки услуги`, l.pct, '%', null, null], [null, null, '0%'])
    totalRow(ws, r++, ['', 'Итого материалы на гостя', '', '', '', st.detail.matCost], [null, null, null, null, null, eur2])
    r++
  }
  sec(ws, r++, 'Нормативные расходники на гостя (помесячное потребление)')
  header(ws, r++, ['Код', 'Материал', 'Норма/гость', 'Ед.', 'Цена €', 'Стоимость €/гость'])
  for (const i of guestNormItems)
    row(ws, r++, [i.code, i.name, i.norm, i.unit, price(i.code), i.norm * price(i.code)], [null, null, '0.000', null, eur2, eur2])
  totalRow(ws, r++, ['', 'Итого на гостя', '', '', '', guestNormCost], [null, null, null, null, null, eur2])
}

// ---- Листы с помесячными рядами ----
const monthSheet = (name, titleT, note, makeRows, totals) => {
  const ws = sheet(name)
  title(ws, titleT, note)
  header(ws, 4, ['Показатель', ...y1.map((x) => `М${x.m}`), 'Год 1', 'Год 2', 'Год 3', 'Σ 36 мес'],
    [34, ...Array(12).fill(9), 11, 11, 11, 12])
  let r = 5
  for (const [label, get, fmt = eur] of makeRows) {
    const cells = [label, ...y1.map(get), sum(y1, get), sum(y2, get), sum(y3, get), sum(months, get)]
    const isTotal = totals?.includes(label)
    ;(isTotal ? totalRow : row)(ws, r++, cells, [null, ...Array(12).fill(fmt), fmt, fmt, fmt, fmt])
    if (isTotal) ws.getRow(r - 1).getCell(1).font = { name: FONT, size: 10, bold: true }
  }
  return ws
}

monthSheet('Выручка', 'Выручка по потокам (гросс, €)', 'Гости/мес: год 1 = 360, год 2+ = 480',
  [
    ['Гостей/мес', (x) => x.guests, '0'],
    ...CFG.streams.map((st) => [`${st.name} (услуг ×€${st.price})`, (x) => x.streamRows.find((s) => s.name === st.name).rev]),
    ['ВЫРУЧКА ГРОСС', (x) => x.revGross],
    ['  НДС 19% (внутри)', (x) => -x.vatOut],
    ['Выручка нетто', (x) => x.revGross - x.vatOut],
  ], ['ВЫРУЧКА ГРОСС', 'Выручка нетто'])

monthSheet('OPEX', 'Операционные расходы (€)', 'Переменные из спецификаций + нормативы на гостя + фиксированные',
  [
    ['Материалы процедур (спеки)', (x) => x.matCost],
    ['Расходники на гостя', (x) => x.guestsCons],
    ['Эквайринг 2%', (x) => x.acquiring],
    ['Ремонт/обслуживание 1%', (x) => x.maintenance],
    ['Маркетинг', (x) => x.marketing],
    ['Страхование', (x) => CFG.insurance],
    ['IT-содержание', (x) => CFG.itMonthly],
    ['ИТОГО OPEX', (x) => x.opex],
  ], ['ИТОГО OPEX'])

monthSheet('ФОТ', 'Фонд оплаты труда (€)', 'Оклады × индексация + KPI 30%/3% с процедур + соцвзносы 15.4%',
  [
    ['Оклады + IT-куратор', (x) => x.salaries],
    ['KPI-бонусы (по спекам)', (x) => x.kpiBonus],
    ['Соцвзносы 15.4%', (x) => x.social],
    ['ИТОГО ФОТ', (x) => x.fot],
  ], ['ИТОГО ФОТ'])

monthSheet('Налоги', 'Налоги (€)', 'НДС 19% к уплате (output − input по материалам) · CIT 15% от годовой прибыли, платёж в декабре',
  [
    ['НДС исходящий', (x) => x.vatOut],
    ['НДС входящий (материалы)', (x) => -x.vatIn],
    ['НДС к уплате', (x) => x.vatPayable],
    ['CIT 15%', (x) => x.cit],
    ['ИТОГО НАЛОГИ', (x) => x.vatPayable + x.cit],
  ], ['ИТОГО НАЛОГИ'])

monthSheet('P&L', 'Прибыли и убытки (€/мес)', 'Нетто-выручка − OPEX − ФОТ; земля не амортизируется',
  [
    ['Выручка нетто', (x) => x.revGross - x.vatOut],
    ['OPEX', (x) => -x.opex],
    ['ФОТ', (x) => -x.fot],
    ['EBITDA', (x) => x.ebitda],
    ['CIT', (x) => -x.cit],
    ['ЧИСТАЯ ПРИБЫЛЬ', (x) => x.ebitda - x.cit],
    ['Маржа EBITDA, %', (x) => x.ebitda / (x.revGross - x.vatOut), '0.0%'],
  ], ['EBITDA', 'ЧИСТАЯ ПРИБЫЛЬ'])

monthSheet('Cash-Flow', 'Движение денежных средств (€)', 'Месяц 1: CAPEX = земля €1.5M + IT €17k',
  [
    ['EBITDA', (x) => x.ebitda],
    ['Налоги (НДС+CIT)', (x) => -(x.vatPayable + x.cit)],
    ['CAPEX', (x) => -x.capex],
    ['Чистый CF', (x) => x.cf],
    ['Накопленный CF', (x) => x.cumCf],
  ], ['Чистый CF'])

// ---- Лист: Итоги ----
{
  const ws = sheet('Итоги')
  title(ws, 'Ключевые показатели — сдержанный сценарий')
  header(ws, 4, ['Показатель', 'Год 1', 'Год 2', 'Год 3', 'Σ 36 мес', ''], [38, 14, 14, 14, 14, 6])
  const ySum = (f) => [sum(y1, f), sum(y2, f), sum(y3, f), sum(months, f)]
  let r = 5
  const krow = (label, vals, fmt = eur, bold = false) => {
    const cells = [label, ...vals]
    ;(bold ? totalRow : row)(ws, r++, cells, [null, fmt, fmt, fmt, fmt])
  }
  krow('Выручка гросс', ySum((x) => x.revGross))
  krow('Выручка нетто', ySum((x) => x.revGross - x.vatOut))
  krow('OPEX', ySum((x) => x.opex))
  krow('ФОТ', ySum((x) => x.fot))
  krow('Налоги (НДС + CIT)', ySum((x) => x.vatPayable + x.cit))
  krow('EBITDA', ySum((x) => x.ebitda), eur, true)
  krow('CAPEX', ySum((x) => x.capex))
  krow('Чистый CF', ySum((x) => x.cf), eur, true)
  row(ws, r++, ['Накопленный CF на конец периода', months[11].cumCf, months[23].cumCf, months[35].cumCf, months[35].cumCf], [null, eur, eur, eur, eur])
  r++
  sec(ws, r++, 'На гостя')
  krow('Выручка гросс / гость', [250, 250, 250, 250], eur2)
  const varPer = CFG.streams.reduce((s, x) => s + x.detail.matCost * x.uptake, 0) + guestNormCost
  krow('Переменные расходы / гость (материалы+расходники)', [varPer, varPer, varPer, varPer], eur2)
  const ebitdaM1 = y1[11].ebitda / (y1[11].revGross - y1[11].vatOut)
  krow('Маржа EBITDA (декабрь г.1)', [ebitdaM1, null, null, null], '0.0%')
  r++
  sec(ws, r++, 'Окупаемость')
  const payback = months.find((x) => x.cumCf > 0)
  krow('Месяц выхода в плюс (накопл. CF > 0)', [payback ? `М${payback.m} (год ${payback.year})` : 'не достигнут', '', '', ''], null)
  krow('Инвестиции (земля + IT)', [CFG.land + CFG.itCapex, '', '', ''], eur)
}

mkdirSync(join(ROOT, 'out'), { recursive: true })
const file = join(ROOT, 'out', 'customer-conservative.xlsx')
await wb.xlsx.writeFile(file)
console.log(`\nExcel → ${file}`)
