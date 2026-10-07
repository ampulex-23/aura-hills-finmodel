// Снимок рассчитанной модели → public/data/model-snapshot.json.
// Запускается через esbuild-бандл из scripts/build-static.mjs на prebuild —
// даёт AI-агентам/краулерам готовые таблицы без исполнения приложения.
// Проекция сценария — src/model/view.ts (та же форма уходит в ИИ-чат как live-данные).
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import paramsJson from '../src/data/params.json'
import matrixJson from '../src/data/scenarios.json'
import nomenclatureJson from '../src/data/nomenclature.json'
import servicesJson from '../src/data/services.json'
import { runModel } from '../src/model/run'
import { computeBreakEven, computeSensitivity, computeTornado } from '../src/model/sensitivity'
import { scenarioView } from '../src/model/view'
import type { NomenclatureItem, Params, ScenarioMatrix, ScenarioName, ServiceSpec } from '../src/model/types'

const params = paramsJson as unknown as Params
const matrix = matrixJson as unknown as ScenarioMatrix
const items = nomenclatureJson as unknown as NomenclatureItem[]
const services = servicesJson.services as unknown as ServiceSpec[]
const capexM = params.meta.capexMonths

const scenarios: Record<string, unknown> = {}
for (const name of matrix.names as ScenarioName[]) {
  scenarios[name] = scenarioView(runModel(params, matrix, items, services, name), params)
}

const sens = computeSensitivity(params, matrix, items, services)
const tornado = computeTornado(params, matrix, items, services, runModel(params, matrix, items, services, params.meta.scenario).kpis.npv)
const breakEven = computeBreakEven(params, matrix, items, services)

const snapshot = {
  generatedAt: new Date().toISOString(),
  note: 'Рассчитанный снимок модели AURA HILLS: KPI, годовые P&L/FCFF, помесячные таблицы, чувствительность. Валюта EUR.',
  currency: 'EUR',
  horizonMonths: capexM + params.meta.opsMonths,
  constructionMonths: capexM,
  wacc: params.general.wacc,
  scenarios,
  sensitivity: { ...sens, tornado, breakEven },
}

const out = resolve(process.cwd(), 'public/data/model-snapshot.json')
writeFileSync(out, JSON.stringify(snapshot))
console.log(`snapshot → ${out}`)
