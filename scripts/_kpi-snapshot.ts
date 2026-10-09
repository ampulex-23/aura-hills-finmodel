import { runModel } from '../src/model/run'
import paramsJson from '../src/data/params.json'
import scenariosJson from '../src/data/scenarios.json'
import nomenclatureJson from '../src/data/nomenclature.json'
import servicesJson from '../src/data/services.json'
import type { NomenclatureItem, Params, ScenarioMatrix, ServiceSpec } from '../src/model/types'

const p = paramsJson as Params
const m = scenariosJson as ScenarioMatrix
const items = nomenclatureJson as NomenclatureItem[]
const services = servicesJson.services as unknown as ServiceSpec[]
for (const name of m.names) {
  const r = runModel(p, m, items, services, name)
  const k = r.kpis
  console.log(`${name}: NPV=${k.npv.toFixed(0)} NPV+TV=${k.npvWithTv.toFixed(0)} wacc=${(k.wacc*100).toFixed(2)}% irr=${(k.irrAnnual*100).toFixed(1)}% pb=${k.paybackMonths} dpb=${k.discountedPaybackMonths} peak=${k.peakFundingNeed.toFixed(0)} moic=${k.moic.toFixed(2)} cf=${r.cashflow.length} capex=${r.capex.adjustedEur.toFixed(0)}`)
}
