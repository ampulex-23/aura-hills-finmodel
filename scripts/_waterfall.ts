import { runModel } from '../src/model/run'
import paramsJson from '../src/data/params.json'
import scenariosJson from '../src/data/scenarios.json'
import nomenclatureJson from '../src/data/nomenclature.json'
import servicesJson from '../src/data/services.json'
import type { NomenclatureItem, Params, ScenarioMatrix, ServiceSpec } from '../src/model/types'

const items = nomenclatureJson as NomenclatureItem[]
const services = servicesJson.services as unknown as ServiceSpec[]
const M = () => JSON.parse(JSON.stringify(scenariosJson)) as ScenarioMatrix
const P = () => JSON.parse(JSON.stringify(paramsJson)) as Params

const base = runModel(P(), M(), items, services, 'Base')
console.log('CURRENT Base NPV:', base.kpis.npv.toFixed(0), 'wacc', (base.kpis.wacc*100).toFixed(1)+'%')
const k = (v: number) => ((v - base.kpis.npv) / 1000).toFixed(0) + 'k'

const run = (label: string, fn: (p: Params, m: ScenarioMatrix) => void) => {
  const p = P(), m = M()
  fn(p, m)
  const r = runModel(p, m, items, services, 'Base')
  console.log(label.padEnd(52), 'NPV', r.kpis.npv.toFixed(0).padStart(9), 'Δ', k(r.kpis.npv))
}
run('НДС → Гросс (убрать возмещение)', (p) => { p.meta.vatMode = 'Гросс' })
run('CIT 15→12.5%, employer 15.4→15.15%', (p) => { p.taxes.cit = 0.125; p.taxes.employerRate = 0.1515 })
run('НДС квартал → помесячно', (p) => { p.taxes.vatQuarterly = false })
run('contingency Base 10% → 0', (_, m) => { m.capexAdj[1] = 0 })
run('задержка стройки Base 1 → 0 мес', (_, m) => { m.constructionDelayMonths[1] = 0 })
run('энергия mult → 1', (_, m) => { m.energyCostMult = m.names.map(() => 1) })
run('члены: вытеснение 100%, без сервис-чека', (p) => { p.members.peakShare = 1; p.members.serviceSpendPerVisit = 0 })
run('сертификаты без ёмкости (redemption 0)', (p) => { p.units.certRedemptionRate = 0 })
run('маркетинг фикс €5k вместо 3.5% выручки', (p) => { for (const f of p.opexFixed) delete f.pctOfRevenue })
run('maintenance CAPEX выкл', (p) => { p.capexMaint.enabled = false })
run('S-кривая → равномерная стройка', (p) => { p.capexSCurve = [] })
run('WACC CAPM 17.4% → ручной 14%', (p) => { p.general.waccMode = 'manual'; p.general.wacc = 0.14 })
run('WACC CAPM 17.4% → ручной 14% + плоский wacc/12', (p) => { p.general.waccMode = 'manual'; p.general.wacc = Math.pow(1 + 0.14 / 12, 12) - 1 })
run('ВСЁ старое сразу (путь к €1.42M)', (p, m) => {
  p.meta.vatMode = 'Гросс'; p.taxes.cit = 0.125; p.taxes.employerRate = 0.1515
  p.taxes.vatQuarterly = false; m.capexAdj[1] = 0; m.constructionDelayMonths[1] = 0
  m.energyCostMult = m.names.map(() => 1); p.members.peakShare = 1
  p.members.serviceSpendPerVisit = 0; p.units.certRedemptionRate = 0
  for (const f of p.opexFixed) delete f.pctOfRevenue
  p.capexMaint.enabled = false; p.capexSCurve = []
  p.general.waccMode = 'manual'; p.general.wacc = Math.pow(1 + 0.14 / 12, 12) - 1
})
