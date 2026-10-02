// Снимок рассчитанной модели → public/data/model-snapshot.json.
// Запускается через esbuild-бандл из scripts/build-static.mjs на prebuild —
// даёт AI-агентам/краулерам готовые таблицы без исполнения приложения.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import paramsJson from '../src/data/params.json'
import matrixJson from '../src/data/scenarios.json'
import nomenclatureJson from '../src/data/nomenclature.json'
import { runModel } from '../src/model/run'
import { computeBreakEven, computeSensitivity, computeTornado } from '../src/model/sensitivity'
import type { NomenclatureItem, Params, ScenarioMatrix, ScenarioName } from '../src/model/types'

const params = paramsJson as unknown as Params
const matrix = matrixJson as unknown as ScenarioMatrix
const items = nomenclatureJson as unknown as NomenclatureItem[]
const capexM = params.meta.capexMonths
const R = (v: number | undefined | null) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : v)

const scenarios: Record<string, unknown> = {}
for (const name of matrix.names as ScenarioName[]) {
  const r = runModel(params, matrix, items, name)

  // Годовая агрегация по меткам месяцев ('Янв 27' → '2027')
  const byYear = new Map<string, Record<string, number | string>>()
  r.cashflow.forEach((cf, i) => {
    const y = `20${cf.label.slice(-2)}`
    const g = byYear.get(y) ?? { year: y, revenue: 0, opex: 0, fot: 0, ebitda: 0, cit: 0, netProfit: 0, fcff: 0, cumFcff: 0 }
    g.fcff = (g.fcff as number) + cf.fcff
    g.cumFcff = cf.cumFcff
    if (cf.isOps) {
      const p = r.pnl[i - capexM]
      const o = r.opex[i - capexM]
      const f = r.fot[i - capexM]
      if (p) {
        g.revenue = (g.revenue as number) + p.revenueGross
        g.ebitda = (g.ebitda as number) + p.ebitda
        g.cit = (g.cit as number) + p.cit
        g.netProfit = (g.netProfit as number) + p.netProfit
      }
      if (o) g.opex = (g.opex as number) + o.total
      if (f) g.fot = (g.fot as number) + f.total
    }
    byYear.set(y, g)
  })

  // Выручка по потокам — итоги за горизонт
  const streams = { rental: 0, steam: 0, massage: 0, extra: 0, glamping: 0, membership: 0, fb: 0 }
  for (const m of r.revenue) {
    streams.rental += m.rental
    streams.steam += m.steamTotal
    streams.massage += m.massageTotal
    streams.extra += m.extraTotal
    streams.glamping += m.glamping
    streams.membership += m.membershipTotal
    streams.fb += m.fb
  }

  const monthly = r.cashflow.map((cf, i) => ({
    month: cf.label,
    revenue: cf.isOps ? R(r.revenue[i - capexM]?.total) : 0,
    ebitda: cf.isOps ? R(r.pnl[i - capexM]?.ebitda) : 0,
    fcff: R(cf.fcff),
    cumFcff: R(cf.cumFcff),
  }))

  scenarios[name] = {
    kpis: r.kpis,
    revenueStreamsTotal: Object.fromEntries(Object.entries(streams).map(([k, v]) => [k, R(v)])),
    yearly: [...byYear.values()].map((g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, R(v as number)]))),
    monthly,
  }
}

const sens = computeSensitivity(params, matrix, items)
const tornado = computeTornado(params, matrix, items, runModel(params, matrix, items, params.meta.scenario).kpis.npv)
const breakEven = computeBreakEven(params, matrix, items)

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
