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

import { computeSensitivity } from '../src/model/sensitivity'
const s = computeSensitivity(params, matrix, items, services)
console.log('t1_d08_w14:', Math.round(s.t1.rows[0].cells[2].npv))
console.log('t1_d10_w14:', Math.round(s.t1.rows[2].cells[2].npv))
console.log('t1_d12_w14:', Math.round(s.t1.rows[4].cells[2].npv))
console.log('t2_g0_c30:', Math.round(s.t2.rows[0].cells[4].npv))
console.log('t2_g7_c30:', Math.round(s.t2.rows[4].cells[4].npv))
console.log('t3_p08:', Math.round(s.t3[0].npv))
console.log('t3_p12:', Math.round(s.t3[4].npv))
