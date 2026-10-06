import type { ModelResult, Params } from './types'

// Компактная проекция прогона модели — единый формат и для статического
// model-snapshot.json (AI/краулеры), и для живого контекста чата: агент
// видит те же числа, что пользователь видит в таблицах, с учётом его правок.
const R = (v: number | undefined | null) =>
  typeof v === 'number' && isFinite(v) ? Math.round(v) : v

export function scenarioView(r: ModelResult, params: Params) {
  const capexM = params.meta.capexMonths

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

  return {
    kpis: r.kpis,
    revenueStreamsTotal: Object.fromEntries(Object.entries(streams).map(([k, v]) => [k, R(v)])),
    yearly: [...byYear.values()].map((g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, R(v as number)]))),
    monthly,
  }
}
