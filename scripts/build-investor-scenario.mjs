// Сборка версии модели «Инвестор — СПА Авдиму, 30 клиентов» из расчёта
// инвестора (tests/oracle/investor-avdimou.json, снят extract-investor-oracle.py).
// Результат — scenarios/investor-avdimou/bundle.json в формате состояния модели
// ({params, matrix, items, services, scenario}): его принимает POST /api/state.
// Ядро не правится: всё выражено параметрами и методикой 'investor'.
// Правило выбора значений: берётся то, что расчёт инвестора ФАКТИЧЕСКИ считает
// на главном листе; где его листы противоречат друг другу — см. README рядом.
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const load = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'))
const params = load('src/data/params.json')
const oracle = load('tests/oracle/investor-avdimou.json')

const CAP = 39 // гостей в день при 100%: 13 гостей × 3 слота (лист «Выручка база»)
const mIdx = (ym) => oracle.months.indexOf(ym)
const monthly = (keys, from, n) =>
  Array.from({ length: n }, (_, i) => keys.reduce((s, k) => s + oracle.rows[k][mIdx(from) + i], 0))
const total = (key, from, n) => monthly([key], from, n).reduce((a, b) => a + b, 0)

// ---------- Таймлайн и методика ----------
Object.assign(params.meta, {
  constructionStart: '2026-07-01', capexMonths: 15, openingDate: '2027-10-01', opsMonths: 87,
  mode: 'Да', vatMode: 'Гросс', scenario: 'Base',
})
params.methodology = {
  id: 'investor',
  // Цены: +5 п.п. к базе каждый январь начиная с 2029 (линейно, не сложным процентом)
  priceIndex: 'table',
  priceIndexTable: { 2029: 1.05, 2030: 1.1, 2031: 1.15, 2032: 1.2, 2033: 1.25, 2034: 1.3 },
}
params.general.inflation = 0.025
Object.assign(params.taxes, { cit: 0.15, vatStd: 0.19, employerRate: 0.154, vatQuarterly: false })

// ---------- Мощности: два агрегата (очередь 1 и очередь 2) ----------
const cluster = (id, phase, launchDate) => ({
  id, status: 'Активен', phase, launchDate, uptime: 1, loadK: 1, slotsPerDay: 3, capacity: 13,
  prices: [1300, 1300, 1300], avgPrice: null, // 100 €/гость × 13 гостей в слоте
})
params.modules = [cluster(1, 1, '2027-10-01'), cluster(2, 2, '2031-01-01')]
params.slotMix = [1 / 3, 1 / 3, 1 / 3]
params.seasonality = { baths: Array(12).fill(1), glamping: Array(12).fill(1), certificates: Array(12).fill(1) }
Object.assign(params.service, { upgradeShare: 0, walletExtraShare: 0, demandMult: 1, serviceLoads: false })
// Чек 260 = аренда 100 + парение 100 + массаж 120 × 50% гостей
Object.assign(params.deposit, { base: 0, steamBase: 100, massageBase: 60 })

// ---------- Слои, которых в расчёте инвестора нет ----------
params.members.enabled = false
params.units.certsEnabled = false
params.glamping.enabled = false
params.fb.enabled = false
params.glampOta.enabled = false
params.publicBath.enabled = false
params.restaurant.enabled = false
params.laundry = { enabled: false }
params.preopen.enabled = false
params.capexMaint.enabled = false
params.tv.enabled = false
params.opexPct = { acquiring: 0, maintenance: 0 }

// ---------- Постоянные расходы (лист OPEX, база до индексации) ----------
params.opexFixed = [
  ['Электроэнергия', 1500], ['Водоснабжение', 800], ['Отопление (газ)', 300], ['Транспорт/ГСМ', 300],
  ['Прочие операционные', 200], ['Страхование', 180], ['Обслуживание объектов', 100],
  ['Бухгалтерия', 400], ['Юридические услуги', 200], ['IT-сервисы', 600], ['Маркетинг, реклама', 4000],
].map(([name, base]) => ({ name, base }))
// Вознаграждение УК: в расчёте инвестора — фиксированный платёж после налога
// (подписан «10% от прибыли», но считается суммой в месяц и базу CIT не уменьшает).
params.opexFixed.push({ name: 'Вознаграждение управляющей компании', base: 2000, nonDeductible: true })
params.it = { enabled: true, curator: 1000, opex: [], capex: [] }

// ---------- Штат (лист ФОТ): пармастеры и массажисты — только бонус ----------
params.fot = {
  roles: ['Пармастер', 'Массажист', 'Администратор', 'Хаусмен (до 2031)', 'Хаусмен (с 2031)',
    'Управляющий', 'Бронист', 'Клинер', 'Инженер'],
  salary: [0, 0, 1500, 1500, 1000, 4500, 1320, 1050, 2200],
  schedule: ['2/2', '2/2', '2/2', '5/2', '5/2', '5/2', '5/2', '2/2', '5/2'],
  count: [4, 2, 2, 0, 0, 1, 0, 2, 0],
  phases: [
    { from: '2029-01', label: 'С 01.2029: +2 пармастера, +1 массажист, +1 хаусмен', count: [6, 3, 2, 1, 0, 1, 0, 2, 0] },
    { from: '2031-01', label: 'С 01.2031: оклад хаусмена 1000', count: [6, 3, 2, 0, 1, 1, 0, 2, 0] },
  ],
}

// ---------- CAPEX: суммы и помесячный график — из главного листа ----------
const P1 = ['2026-07', 15] // 07.2026–09.2027
const P2 = ['2029-01', 24] // 01.2029–12.2030
const line = (name, key, group, phase, row) => ({
  name, unit: 'компл', qty: 1, row, group, phase, ...(phase === 2 ? { object: 'vip1' } : {}),
  priceEur: total(key, ...(phase === 1 ? P1 : P2)),
})
const LINES = [
  ['СМР', 'smr', 'Строительство'], ['Государственные сборы, 1,95% от СМР', 'stateFees', 'Строительство'],
  ['Солнечные батареи', 'solar', 'Строительство'], ['Согласования, 1,25% от СМР', 'approvals', 'Строительство'],
  ['Проектирование и дизайн, 5% от СМР', 'design', 'Строительство'], ['Технадзор, 5% от СМР', 'supervision', 'Строительство'],
  ['Непредвиденные, 5% от СМР', 'contingency', 'Строительство'],
  ['Руководитель проекта и офис', 'projectOffice', 'Управление проектом'],
]
params.capexItems = [
  line('Юридические расходы на приобретение участка', 'landLegal', 'Участок', 1, 101),
  line('Агентские за поиск участка, 10%', 'landAgent', 'Участок', 1, 102),
  line('Маркетинг до открытия (07–09.2027)', 'marketing', 'Управление проектом', 1, 103),
  ...LINES.map(([n, k, g], i) => line(`${n} — очередь 1`, k === 'smr' ? 'smr1' : k, g, 1, 110 + i)),
  ...LINES.map(([n, k, g], i) => line(`${n} — очередь 2`, k === 'smr' ? 'smr2' : k, g, 2, 210 + i)),
]
params.land = { mode: 'purchase', purchaseCost: total('land', ...P1), rentMonthly: 0 }
const CAPEX_ROWS = ['land', 'landLegal', 'landAgent', 'construction', 'projectOffice', 'marketing']
params.capexSCurve = monthly(CAPEX_ROWS, ...P1)
params.phase2 = {
  constructionStart: '2029-01', months: 24, capexAdj: 0, rampMonths: 1, funding: 'ops',
  sCurve: monthly(['construction', 'projectOffice'], ...P2),
}
// Амортизация 4% в год (25 лет). У инвестора амортизируются СМР + проектирование 5%
// + непредвиденные 5% + солнечные батареи; сборы, согласования, технадзор, офис и
// расходы на покупку — нет. Доля амортизируемого — по очереди 1.
const p1Total = params.capexItems.filter((i) => i.phase === 1).reduce((s, i) => s + i.priceEur, 0)
const p1Depreciable = total('smr1', ...P1) * 1.1 + total('solar', ...P1)
params.amort = { groups: ['СМР, проект, непредвиденные, солнечные', '—', '—'], shares: [p1Depreciable / p1Total, 0, 0], years: [25, 7, 5] }
params.taxDepr = { enabled: true, years: [25, 7, 5] }

// Распределений прибыли партнёрам в расчёте инвестора нет
params.partners.shares = params.partners.shares.map(() => 0)
params.partners.corporate = { mgmt: 0, reserve: 0 }

// ---------- Сценарная матрица: один расчёт во всех трёх колонках ----------
const all = (v) => [v, v, v]
const years = (v) => Object.fromEntries(v.map((x, i) => [`y${i + 1}`, all(x)]))
const flat = (x) => years(Array(5).fill(x))
const matrix = {
  names: ['Conservative', 'Base', 'Aggressive'],
  baths: years([16 / CAP, 20 / CAP, 20 / CAP, 20 / CAP, 20 / CAP]), // 16 → 20 гостей в день
  bathsP2: years([0, 0, 0, 10 / CAP, 10 / CAP]), // с 01.2031 всего 30 гостей в день
  steam: flat(1), massage: flat(1), extra: flat(0), steamP2: flat(1), massageP2: flat(1), extraP2: flat(0),
  glamping: flat(0), membersMonth: flat(0), publicBath: flat(0), restaurant: flat(0),
  priceGrowth: all(0), capexAdj: all(0), rampMonths: all(1), uptake: all(1),
  constructionDelayMonths: all(0), energyCostMult: all(1),
}

// ---------- Услуги и себестоимость на гостя ----------
const services = [
  { code: 'INV-A', direction: 'Аренда бани', name: 'Аренда бани, 3 часа (100 € на гостя)', price: 1300, capacity: 13, items: [] },
  { code: 'INV-S', direction: 'Парения', name: 'Парение', price: 100, weight: 1, items: [{ kind: 'labor', role: 'Пармастер', pct: 0.4 }] },
  { code: 'INV-M', direction: 'Массаж', name: 'Массаж (каждый второй гость)', price: 120, weight: 1, items: [{ kind: 'labor', role: 'Массажист', pct: 0.35 }] },
]
const cogs = (code, name, price) => ({
  code, name, category: 'Материалы услуг', type: 'Расходник', unit: 'гость', price,
  deliveryFix: 0, deliveryPct: 0, use: 'OPEX', opexArticle: 'Себестоимость услуг', norm: 1, normBase: 'гость', qty: 0,
  note: 'Норма на гостя из расчёта инвестора (лист «Выручка база»)',
})
const items = [
  cogs('INV-C1', 'Материалы парения', 3.6),
  cogs('INV-C2', 'Материалы массажа (у инвестора — на каждого гостя)', 2.55),
  cogs('INV-C3', 'Материалы аренды', 12.97),
]

writeFileSync(new URL('scenarios/investor-avdimou/bundle.json', root),
  JSON.stringify({ params, matrix, items, services, scenario: 'Base' }, null, 2) + '\n')
console.log('bundle.json: CAPEX оч.1', Math.round(p1Total + params.land.purchaseCost), 'доля амортизируемого', (p1Depreciable / p1Total).toFixed(4))
