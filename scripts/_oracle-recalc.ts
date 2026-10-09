// Временный рекалькулятор golden-эталонов — те же overrides, что в golden.test.ts
import paramsJson from '../src/data/params.json'
import scenariosJson from '../src/data/scenarios.json'
import nomenclatureJson from '../src/data/nomenclature.json'
import servicesJson from '../src/data/services.json'
import type { NomenclatureItem, Params, ScenarioMatrix, ServiceSpec } from '../src/model/types'
import { runModel } from '../src/model/run'

const params = paramsJson as Params
params.it.enabled = false
params.units.presaleMode = 'incremental'
params.fb.enabled = false
params.preopen.enabled = false
params.members.consumeSlots = false
params.taxes.gesy = 0
params.taxDepr.enabled = false
params.glampOta.enabled = false
params.service.serviceLoads = false
const matrix = scenariosJson as ScenarioMatrix
const items = nomenclatureJson as NomenclatureItem[]
const services = servicesJson.services as unknown as ServiceSpec[]

for (const name of ['Conservative', 'Base', 'Aggressive'] as const) {
  const r = runModel(params, matrix, items, services, name)
  console.log(
    `${name}: { npv: ${Math.round(r.kpis.npv)}, irr: ${r.kpis.irrAnnual.toFixed(4)}, ` +
      `payback: ${r.kpis.paybackMonths}, discPayback: ${r.kpis.discountedPaybackMonths}, peak: ${Math.round(r.kpis.peakFundingNeed)} },`,
  )
}
