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
    const g = byYear.get(y) ?? {
      year: y, revenue: 0, opex: 0, fot: 0, ebitda: 0, cit: 0, netProfit: 0,
      capexOutflow: 0, dividends: 0, equityIn: 0, fcff: 0, cumFcff: 0,
    }
    g.fcff = (g.fcff as number) + cf.fcff
    g.cumFcff = cf.cumFcff
    g.capexOutflow = (g.capexOutflow as number) - (cf.capex + cf.deferredCapex + cf.maintCapex)
    g.dividends = (g.dividends as number) - cf.dividends
    g.equityIn = (g.equityIn as number) + cf.equityIn
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

  // Десять потоков выручки за весь горизонт (оч. 1 + оч. 2)
  const streams = {
    rental: 0, steam: 0, massage: 0, extra: 0, glamping: 0, membership: 0, fb: 0,
    publicBath: 0, restaurant: 0,
  }
  for (const m of r.revenue) {
    streams.rental += m.rental
    streams.steam += m.steamTotal
    streams.massage += m.massageTotal
    streams.extra += m.extraTotal
    streams.glamping += m.glamping
    streams.membership += m.membershipTotal
    streams.fb += m.fb
    streams.publicBath += m.publicBath
    streams.restaurant += m.restaurant
  }

  const monthly = r.cashflow.map((cf, i) => ({
    month: cf.label,
    revenue: cf.isOps ? R(r.revenue[i - capexM]?.total) : 0,
    ebitda: cf.isOps ? R(r.pnl[i - capexM]?.ebitda) : 0,
    fot: cf.isOps ? R(r.fot[i - capexM]?.total) : 0,
    capex: R(-(cf.capex + cf.deferredCapex)),
    fcff: R(cf.fcff),
    cumFcff: R(cf.cumFcff),
    cash: R(cf.cash),
    equityIn: R(cf.equityIn),
  }))

  // Смета CAPEX по очередям и разделам — чтобы агент отвечал про инвестиции
  // без догадок: группы с суммами и строками, итоги, окно оттока оч. 2.
  const groups = new Map<string, { phase: 1 | 2; group: string; eur: number; items: { name: string; object?: string; eur: number }[] }>()
  for (const it of r.capex.items) {
    const phase = (it.phase ?? 1) as 1 | 2
    const key = `${phase}|${it.group ?? 'Прочее'}`
    const g = groups.get(key) ?? { phase, group: it.group ?? 'Прочее', eur: 0, items: [] }
    g.eur += it.eur
    g.items.push({ name: it.name, ...(it.object ? { object: it.object } : {}), eur: R(it.eur) as number })
    groups.set(key, g)
  }
  const p2 = r.capex.phase2Outflow
  const capex = {
    phase1: {
      totalEur: R(r.capex.totalEur), capexAdj: r.scenario.capexAdj, adjustedEur: R(r.capex.adjustedEur),
      amortizableEur: R(r.capex.amortizableEur), monthlyAmort: R(r.capex.monthlyAmort),
      note: 'Платится в месяцы стройки оч. 1 по S-кривой; отложенные модули — траншем в месяц ввода',
    },
    phase2: {
      totalEur: R(r.capex.phase2Eur), capexAdj: params.phase2?.capexAdj ?? 0, adjustedEur: R(r.capex.phase2AdjEur),
      outflowMonths: p2.length,
      firstMonth: p2[0] ? r.cashflow[p2[0].month - 1]?.label : null,
      lastMonth: p2.length ? r.cashflow[p2[p2.length - 1].month - 1]?.label : null,
      objects: {
        public: !!params.publicBath?.enabled,
        ...Object.fromEntries(
          params.modules.filter((m) => m.phase === 2).sort((a, b) => a.id - b.id)
            .map((m, i) => [`vip${i + 1}`, m.status === 'Активен']),
        ),
      },
      note: 'Объектные строки платятся при включённом объекте, общие — если включён хотя бы один; отток помесячно в окне стройки',
    },
    groups: [...groups.values()].map((g) => ({ ...g, eur: R(g.eur) })),
  }

  return {
    // Опциональные слои выручки (тоглы Допущений; выключенный слой = 0 в потоках)
    features: {
      members: !!params.members.enabled,
      certs: !!params.units.certsEnabled,
      fb: !!params.fb.enabled,
      glamping: !!params.glamping?.enabled,
    },
    horizon: {
      constructionStart: params.meta.constructionStart.slice(0, 7),
      openingDate: params.meta.openingDate.slice(0, 7),
      constructionMonths: capexM,
      opsMonths: params.meta.opsMonths,
      totalMonths: r.cashflow.length,
      phase2: params.phase2
        ? { constructionStart: params.phase2.constructionStart, months: params.phase2.months, launch: params.publicBath?.launchDate ?? null }
        : null,
    },
    kpis: r.kpis,
    revenueStreamsTotal: Object.fromEntries(Object.entries(streams).map(([k, v]) => [k, R(v)])),
    yearly: [...byYear.values()].map((g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, R(v as number)]))),
    monthly,
    capex,
  }
}
