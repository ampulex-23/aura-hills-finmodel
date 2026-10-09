import params from '../src/data/params.json'
import scenarios from '../src/data/scenarios.json'
import items from '../src/data/nomenclature.json'
import services from '../src/data/services.json'
import { runModel } from '../src/model/run'
import { headcountAt, baseSalariesMonthly } from '../src/model/fot'
import type { Params, ScenarioMatrix, NomenclatureItem, ServiceSpec } from '../src/model/types'

const r = runModel(params as Params, scenarios as ScenarioMatrix, items as NomenclatureItem[], (services as any).services as ServiceSpec[], 'Base')
for (const k of [0, 11, 12, 35, 36, 47, 48])
  console.log(
    'k=', k, 'sal=', r.fot[k].salaries.toFixed(0),
    'hc=', headcountAt(params as Params, k).join(','),
    'base=', baseSalariesMonthly(params as Params, k).toFixed(0),
    'infl=', Math.pow(1 + params.general.inflation, Math.floor(k / 12)).toFixed(4),
  )
