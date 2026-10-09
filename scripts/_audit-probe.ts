import { readFileSync } from 'fs'
import { runModel } from '../src/model/run'
import type { Params } from '../src/model/types'

const params: Params = JSON.parse(readFileSync('src/data/params.json', 'utf8'))
const matrix = JSON.parse(readFileSync('src/data/scenarios.json', 'utf8'))
const items = JSON.parse(readFileSync('src/data/nomenclature.json', 'utf8'))
const services = JSON.parse(readFileSync('src/data/services.json', 'utf8')).services
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)
const yr = (a: number[], y: number) => sum(a.slice(y * 12, y * 12 + 12))
const r0 = (x: number) => Math.round(x).toLocaleString('en-US')
const pct = (x: number) => (x * 100).toFixed(1) + '%'

const base = runModel(params, matrix, items, services, 'Base')
console.log('BASE npv', r0(base.kpis.npv), 'irr', pct(base.kpis.irrAnnual), 'sum div', r0(sum(base.pnl.map((m) => m.dividends))), 'sum sdc', r0(sum(base.pnl.map((m) => m.sdc))), 'sum cit', r0(sum(base.pnl.map((m) => m.cit))))

// 1. Налоговая реформа 2026: CIT 15%, SDC 5%
const tax = runModel(params, matrix, items, services, 'Base', { mutate: (p) => { p.taxes.cit = 0.15; p.taxes.sdc = 0.05 } })
console.log('TAX REFORM npv', r0(tax.kpis.npv), 'irr', pct(tax.kpis.irrAnnual), 'sum cit', r0(sum(tax.pnl.map((m) => m.cit))), 'sum sdc', r0(sum(tax.pnl.map((m) => m.sdc))), 'ΔNPV', r0(tax.kpis.npv - base.kpis.npv))

// 2. Взносы работодателя 15.4%
const er = runModel(params, matrix, items, services, 'Base', { mutate: (p) => { p.taxes.employerRate = 0.154 } })
console.log('EMPLOYER 15.4% ΔNPV', r0(er.kpis.npv - base.kpis.npv))

// 3. Сезонность: среднее
const sb = sum(params.seasonality.baths) / 12, sg = sum(params.seasonality.glamping) / 12
console.log('seasonality mean baths', sb.toFixed(4), 'glamping', sg.toFixed(4))
const sn = runModel(params, matrix, items, services, 'Base', { mutate: (p) => { p.seasonality.glamping = p.seasonality.glamping.map((x) => x / sg); p.seasonality.baths = p.seasonality.baths.map((x) => x / sb) } })
console.log('NORMALIZED seasonality ΔNPV', r0(sn.kpis.npv - base.kpis.npv), 'glamp y3', r0(yr(sn.revenue.map((m) => m.glamping), 2)), 'vs', r0(yr(base.revenue.map((m) => m.glamping), 2)))

// 4. Члены клуба не вытесняют слоты
const nm = runModel(params, matrix, items, services, 'Base', { mutate: (p) => { p.members.consumeSlots = false } })
console.log('MEMBERS no displacement ΔNPV', r0(nm.kpis.npv - base.kpis.npv), 'rental y5', r0(yr(nm.revenue.map((m) => m.rental), 4)), 'vs', r0(yr(base.revenue.map((m) => m.rental), 4)))
// вытеснение по годам в Base
for (let y = 0; y < 5; y++) {
  const ms = yr(base.revenue.map((m) => m.memberSlots), y), sl = yr(base.revenue.map((m) => m.slots), y)
  console.log(` y${y + 1} memberSlots ${r0(ms)} paidSlots ${r0(sl)} share ${pct(ms / (ms + sl))}`)
}

// 5. Эффективная годовая ставка дисконтирования
const eff = Math.pow(1 + params.general.wacc / 12, 12) - 1
console.log('WACC', params.general.wacc, 'effective annual', pct(eff))
const monthlyEff = Math.pow(1 + params.general.wacc, 1 / 12) - 1
// пересчёт NPV при эффективной месячной ставке
let npvEff = 0
base.cashflow.forEach((m, i) => { npvEff += m.fcff / Math.pow(1 + monthlyEff, i + 1) })
console.log('NPV at effective monthly rate', r0(npvEff), 'Δ', r0(npvEff - base.kpis.npv))

// 6. Сертификаты: доля в выручке
console.log('certs y1', r0(yr(base.revenue.map((m) => m.certificates), 0)), 'y5', r0(yr(base.revenue.map((m) => m.certificates), 4)), 'total 5y', r0(sum(base.revenue.map((m) => m.certificates))))
const nc = runModel(params, matrix, items, services, 'Base', { mutate: (p) => { p.units.certsPerMonth = 0 } })
console.log('NO CERTS ΔNPV', r0(nc.kpis.npv - base.kpis.npv))

// 7. Маркетинг как % выручки
for (let y = 0; y < 5; y++) console.log(` y${y + 1} marketing share`, pct(60000 * Math.pow(1.025, y) / yr(base.revenue.map((m) => m.total), y)))

// 8. Contingency 10% в Base
const ct = runModel(params, matrix, items, services, 'Base', { capexAdj: 0.1 })
console.log('CAPEX +10% ΔNPV', r0(ct.kpis.npv - base.kpis.npv), 'irr', pct(ct.kpis.irrAnnual))

// 9. Остаточная стоимость активов на конец горизонта (балансовая)
const nbv = base.capex.amortizableEur - base.capex.monthlyAmort * 60
console.log('NBV end of y5', r0(nbv), 'PV', r0(nbv * base.cashflow[base.cashflow.length - 1].discountFactor))

// 10. Загрузка: слотов/день на баню Y3
const y3slots = yr(base.revenue.map((m) => m.slots), 2)
console.log('Y3 slots/yr', r0(y3slots), 'per day', (y3slots / 365).toFixed(1), 'per bath/day', (y3slots / 365 / 3).toFixed(2), 'guests/yr', r0(yr(base.revenue.map((m) => m.guests), 2)))

// 11. Пакет: доля сервисной выручки
const svc = sum(base.revenue.map((m) => m.steamTotal + m.massageTotal + m.extraTotal)), tot = sum(base.revenue.map((m) => m.total))
console.log('services share of revenue 5y', pct(svc / tot))

// 12. Dividends vs cash: минимальный cumCash после начала дивидендов
const cf = base.cashflow
console.log('min cumCash', r0(Math.min(...cf.map((m) => m.cumCash))), 'cumCash at first dividend', r0(cf.find((m) => m.dividends < 0)?.cumCash ?? 0))

// 13. Month 1 vs presale: пресейл-членства уже в выручке Y1?
console.log('members revenue m1', r0(base.revenue[0].membershipTotal), 'presale/mo', r0(base.scenario.presaleMonthly))

// 14. Входной НДС: гросс vs возмещение — какой режим должен быть базовым
const rv = runModel(params, matrix, items, services, 'Base', { vatMode: 'С возмещением' })
console.log('VAT reimb ΔNPV', r0(rv.kpis.npv - base.kpis.npv))

// 15. Стресс: Conservative + реформа + contingency
const stress = runModel(params, matrix, items, services, 'Conservative', { mutate: (p) => { p.taxes.cit = 0.15; p.taxes.sdc = 0.05 } })
console.log('Conservative+reform npv', r0(stress.kpis.npv), 'irr', pct(stress.kpis.irrAnnual))
