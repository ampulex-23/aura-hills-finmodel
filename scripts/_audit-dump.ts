// Годовая сводка модели для аудита: npx tsx scripts/_audit-dump.ts
import { readFileSync } from 'fs'
import { runModel } from '../src/model/run'
import { computeSensitivity } from '../src/model/sensitivity'

const params = JSON.parse(readFileSync('src/data/params.json', 'utf8'))
const matrix = JSON.parse(readFileSync('src/data/scenarios.json', 'utf8'))
const items = JSON.parse(readFileSync('src/data/nomenclature.json', 'utf8'))
const services = JSON.parse(readFileSync('src/data/services.json', 'utf8')).services

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)
const yr = (a: number[], y: number) => sum(a.slice(y * 12, y * 12 + 12))
const r0 = (x: number) => Math.round(x).toLocaleString('en-US')
const pct = (x: number) => (x * 100).toFixed(1) + '%'

for (const name of matrix.names) {
  const r = runModel(params, matrix, items, services, name)
  console.log(`\n=== ${name} ===`)
  console.log('CAPEX total', r0(r.capex.totalEur), 'adj', r0(r.capex.adjustedEur), 'amort/mo', r0(r.capex.monthlyAmort), 'taxDepr/mo', r0(r.capex.monthlyTaxDepr))
  console.log('KPI', JSON.stringify({ npv: r0(r.kpis.npv), irrA: pct(r.kpis.irrAnnual), irrNom: pct(r.kpis.irrNominal), pb: r.kpis.paybackMonths, dpb: r.kpis.discountedPaybackMonths, peak: r0(r.kpis.peakFundingNeed), moic: r.kpis.moic.toFixed(2), coc: pct(r.kpis.cashOnCash), invested: r0(r.kpis.investedTotal), tv: r0(r.kpis.tvValue) }))
  console.log('Year | Rev | Rental | Steam | Massage | Extra | Glamp | Members | F&B | OPEXvar | OPEXpct | OPEXfix | FOT | EBITDA | marg | CIT | NP | Div')
  for (let y = 0; y < 5; y++) {
    const rev = r.revenue.map((m) => m.total)
    const e = yr(r.pnl.map((m) => m.ebitda), y)
    console.log([
      y + 1, r0(yr(rev, y)), r0(yr(r.revenue.map((m) => m.rental), y)), r0(yr(r.revenue.map((m) => m.steamTotal), y)),
      r0(yr(r.revenue.map((m) => m.massageTotal), y)), r0(yr(r.revenue.map((m) => m.extraTotal), y)), r0(yr(r.revenue.map((m) => m.glamping), y)),
      r0(yr(r.revenue.map((m) => m.membershipTotal), y)), r0(yr(r.revenue.map((m) => m.fb), y)),
      r0(yr(r.opex.map((m) => m.variableTotal), y)), r0(yr(r.opex.map((m) => m.pctTotal), y)), r0(yr(r.opex.map((m) => m.fixedTotal + m.itTotal + m.landRent), y)),
      r0(yr(r.fot.map((m) => m.total), y)), r0(e), pct(e / yr(rev, y)), r0(yr(r.pnl.map((m) => m.cit), y)), r0(yr(r.pnl.map((m) => m.netProfit), y)), r0(yr(r.pnl.map((m) => m.dividends), y)),
    ].join(' | '))
  }
  console.log('citByYear', r.citByYear.map(r0).join(', '))
  const cf = r.cashflow
  console.log('CF: presale total', r0(sum(cf.map((m) => m.presale))), 'unwind', r0(sum(cf.map((m) => m.presaleUnwind))), 'preopen', r0(sum(cf.map((m) => m.preopen))), 'landLease', r0(sum(cf.map((m) => m.landLease))), 'capex', r0(sum(cf.map((m) => m.capex))), 'deferred', r0(sum(cf.map((m) => m.deferredCapex))))
  console.log('CF: sum FCFF', r0(sum(cf.map((m) => m.fcff))), 'sum totalCf', r0(sum(cf.map((m) => m.totalCf))), 'final cumCash', r0(cf[cf.length - 1].cumCash))
  console.log('FCFF ops years', [0, 1, 2, 3, 4].map((y) => r0(sum(cf.slice(12 + y * 12, 24 + y * 12).map((m) => m.fcff)))).join(' | '))
  const m0 = r.revenue[0], m12 = r.revenue[12]
  console.log('M1: slots', m0.slots.toFixed(1), 'guests', m0.guests.toFixed(0), 'memberSlots', m0.memberSlots.toFixed(1), 'load', pct(m0.bathsLoad), 'ramp', m0.ramp.toFixed(2))
  console.log('M13: slots', m12.slots.toFixed(1), 'guests', m12.guests.toFixed(0), 'memberSlots', m12.memberSlots.toFixed(1), 'load', pct(m12.bathsLoad))
  // юнит-экономика на слот (год 3)
  const y3slots = yr(r.revenue.map((m) => m.slots), 2)
  console.log('Y3 rev/slot', r0(yr(r.revenue.map((m) => m.total), 2) / y3slots), 'rental/slot', r0(yr(r.revenue.map((m) => m.rental), 2) / y3slots), 'svc/slot', r0(yr(r.revenue.map((m) => m.steamTotal + m.massageTotal + m.extraTotal), 2) / y3slots))
  console.log('VAT y1: out', r0(yr(r.taxes.map((m) => m.vatOut), 0)), 'input', r0(yr(r.taxes.map((m) => m.inputVat), 0)), 'payable', r0(yr(r.taxes.map((m) => m.vatPayable), 0)))
  console.log('FOT y1: salaries', r0(yr(r.fot.map((m) => m.salaries), 0)), 'bonuses', r0(yr(r.fot.map((m) => m.bonuses), 0)), 'contrib', r0(yr(r.fot.map((m) => m.employerContrib), 0)))
  console.log('OPEX var articles y3:', r.opex[30].variable.map((v) => `${v.article}=${r0(v.amount)}`).join('; '))
}
// TV при включении
const rTv = runModel(params, matrix, items, services, 'Base', { mutate: (p) => { p.tv.enabled = true } })
console.log('\nBase with TV: tv', r0(rTv.kpis.tvValue), 'npvWithTv', r0(rTv.kpis.npvWithTv), 'TV share', pct(rTv.kpis.tvValue / rTv.kpis.npvWithTv))
// VAT с возмещением
const rV = runModel(params, matrix, items, services, 'Base', { vatMode: 'С возмещением' })
console.log('Base VAT reimb: NPV', r0(rV.kpis.npv), 'IRR', pct(rV.kpis.irrAnnual), 'y1 input', r0(yr(rV.taxes.map((m) => m.inputVat), 0)), 'credit end y1', r0(rV.taxes[11].vatCredit))
// Непакетный режим
const rN = runModel(params, matrix, items, services, 'Base', { mode: 'Нет' })
console.log('Base non-package: NPV', r0(rN.kpis.npv), 'IRR', pct(rN.kpis.irrAnnual), 'rev y3', r0(yr(rN.revenue.map((m) => m.total), 2)))
// Break-even по загрузке
for (const L of [0.5, 0.6, 0.7, 0.8]) {
  const rb = runModel(params, matrix, items, services, 'Base', { loadMult: L })
  console.log(`loadMult ${L}: NPV ${r0(rb.kpis.npv)} IRR ${pct(rb.kpis.irrAnnual)} EBITDA y3 ${r0(yr(rb.pnl.map((m) => m.ebitda), 2))}`)
}
const s = computeSensitivity(params, matrix, items, services)
console.log('Sens T1 center', r0(s.t1.rows[Math.floor(s.t1.rows.length / 2)].cells[Math.floor(s.t1.rows[0].cells.length / 2)].npv))
