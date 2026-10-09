import type { CashFlowMonth, Kpis, Params, PnlMonth } from './types'

// Месячный IRR по FCFF — bisection. Годовой эффективный = (1+r)^12−1 —
// единственный публикуемый IRR, сопоставим с WACC (эффективная годовая).
function irr(flows: number[]): number {
  let lo = -0.99
  let hi = 10
  const npv = (r: number) =>
    flows.reduce((s, f, i) => s + f / Math.pow(1 + r, i + 1), 0)
  while (npv(hi) > 0 && hi < 1e4) hi *= 2
  if (npv(lo) * npv(hi) > 0) return NaN
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2
    if (npv(lo) * npv(mid) <= 0) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

export function computeKpis(params: Params, cashflow: CashFlowMonth[], pnl: PnlMonth[]): Kpis {
  const fcff = cashflow.map((m) => m.fcff)
  const npv = cashflow[cashflow.length - 1].cumDcf
  const irrMonthly = irr(fcff)
  const irrAnnual = Math.pow(1 + irrMonthly, 12) - 1
  const paybackMonths = cashflow.findIndex((m) => m.cumFcff > 0) + 1 || 0
  const discountedPaybackMonths = cashflow.findIndex((m) => m.cumDcf > 0) + 1 || 0
  const peakFundingNeed = Math.min(...cashflow.map((m) => m.cumFcff))
  const equityTotal = cashflow.reduce((s, m) => s + m.equityIn, 0)

  const investedTotal = fcff.filter((f) => f < 0).reduce((s, f) => s - f, 0)
  const returnedTotal = fcff.filter((f) => f > 0).reduce((s, f) => s + f, 0)
  const moic = investedTotal > 0 ? returnedTotal / investedTotal : NaN
  // Устаканенный год — 3-й операционный
  const c = params.meta.capexMonths
  const y3 = fcff.slice(c + 24, c + 36)
  const cashOnCash = investedTotal > 0 ? y3.reduce((s, f) => s + f, 0) / investedTotal : NaN

  // Terminal value (аудит 14, W-11): FCFF последнего года уже за вычетом
  // maintenance CAPEX (нормализован). Cross-check — exit-multiple по EBITDA
  // последнего года и подразумеваемый EV/EBITDA гордоновской TV.
  const g = params.tv?.growth ?? 0
  const lastDf = cashflow[cashflow.length - 1].discountFactor
  const lastYearFcff = fcff.slice(-12).reduce((s, f) => s + f, 0)
  const lastYearEbitda = pnl.slice(-12).reduce((s, m) => s + m.ebitda, 0)
  let tvValue = 0
  let tvEvEbitda = NaN
  if (params.tv?.enabled && params.general.wacc > g) {
    const tvUndisc = (lastYearFcff * (1 + g)) / (params.general.wacc - g)
    tvValue = tvUndisc * lastDf
    tvEvEbitda = lastYearEbitda > 0 ? tvUndisc / lastYearEbitda : NaN
  }
  const tvExitValue = params.tv?.enabled ? lastYearEbitda * (params.tv.exitMultiple ?? 0) * lastDf : 0
  const npvWithTv = npv + tvValue

  return {
    wacc: params.general.wacc, npv, irrMonthly, irrAnnual, paybackMonths, discountedPaybackMonths,
    peakFundingNeed, equityTotal, moic, cashOnCash, investedTotal, tvValue, tvExitValue, tvEvEbitda, npvWithTv,
  }
}
