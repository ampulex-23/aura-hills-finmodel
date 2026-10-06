import type { CashFlowMonth, Kpis, Params } from './types'

// Месячный IRR по FCFF — bisection (Excel IRR с guess 0.02). Годовой = (1+r)^12−1.
function irr(flows: number[], guess = 0.02): number {
  let lo = -0.99
  let hi = 10
  const npv = (r: number) =>
    flows.reduce((s, f, i) => s + f / Math.pow(1 + r, i + 1), 0)
  // Расширяем hi пока знак не сменится
  while (npv(hi) > 0 && hi < 1e4) hi *= 2
  if (npv(lo) * npv(hi) > 0) return NaN
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2
    if (npv(lo) * npv(mid) <= 0) hi = mid
    else lo = mid
  }
  void guess
  return (lo + hi) / 2
}

export function computeKpis(params: Params, cashflow: CashFlowMonth[]): Kpis {
  const fcff = cashflow.map((m) => m.fcff)
  const npv = cashflow[cashflow.length - 1].cumDcf
  const irrMonthly = irr(fcff)
  const irrAnnual = Math.pow(1 + irrMonthly, 12) - 1
  // Дисконтирование ведётся по WACC/12 как номинальной ставке — значит,
  // сопоставимый с WACC показатель доходности — номинальный IRR (мес×12).
  const irrNominal = irrMonthly * 12
  const paybackMonths = cashflow.findIndex((m) => m.cumFcff > 0) + 1 || 0
  const discountedPaybackMonths = cashflow.findIndex((m) => m.cumDcf > 0) + 1 || 0
  const peakFundingNeed = Math.min(...cashflow.map((m) => m.cumFcff))

  // Вложено = всё, что утекло (стройка + убытки, за вычетом пресейла в стройке — он внутри fcff).
  const investedTotal = fcff.filter((f) => f < 0).reduce((s, f) => s - f, 0)
  const returnedTotal = fcff.filter((f) => f > 0).reduce((s, f) => s + f, 0)
  const moic = investedTotal > 0 ? returnedTotal / investedTotal : NaN
  // Устаканенный год — 3-й операционный (месяцы capexMonths+24 … +35).
  const y3 = fcff.slice(params.meta.capexMonths + 24, params.meta.capexMonths + 36)
  const cashOnCash = investedTotal > 0 ? y3.reduce((s, f) => s + f, 0) / investedTotal : NaN

  // Terminal value (Gordon growth): TV = FCF_год5 × (1+g) / (WACC − g),
  // дисконтируется фактором последнего месяца. Отдельная метрика — база без TV.
  const g = params.tv?.growth ?? 0
  let tvValue = 0
  if (params.tv?.enabled && params.general.wacc > g) {
    const lastYearFcff = fcff.slice(-12).reduce((s, f) => s + f, 0)
    const tvUndisc = (lastYearFcff * (1 + g)) / (params.general.wacc - g)
    tvValue = tvUndisc * cashflow[cashflow.length - 1].discountFactor
  }
  const npvWithTv = npv + tvValue

  return { npv, irrMonthly, irrAnnual, irrNominal, paybackMonths, discountedPaybackMonths, peakFundingNeed, moic, cashOnCash, investedTotal, tvValue, npvWithTv }
}
