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
  const paybackMonths = cashflow.findIndex((m) => m.cumFcff > 0) + 1 || 0
  const discountedPaybackMonths = cashflow.findIndex((m) => m.cumDcf > 0) + 1 || 0
  const peakFundingNeed = Math.min(...cashflow.map((m) => m.cumFcff))
  return { npv, irrMonthly, irrAnnual, paybackMonths, discountedPaybackMonths, peakFundingNeed }
}
