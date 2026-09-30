import type { FotMonth, OpexMonth, Params, PnlMonth, RevenueMonth, TaxMonth } from './types'

// P&L помесячно: нетто-выручка − переменные − % − фикс − ФОТ − амортизация − CIT − SDC
export function computePnl(
  params: Params,
  revenue: RevenueMonth[],
  opex: OpexMonth[],
  fot: FotMonth[],
  taxes: TaxMonth[],
  monthlyAmort: number,
): PnlMonth[] {
  return revenue.map((rev, k) => {
    const revenueNet = rev.total - taxes[k].vatPayable
    const marginalProfit = revenueNet - opex[k].variableTotal - opex[k].pctTotal
    const ebitda = marginalProfit - opex[k].fixedTotal - fot[k].total
    const ebit = ebitda - monthlyAmort
    const netProfit = ebit - taxes[k].cit
    return {
      revenueNet,
      revenueGross: rev.total,
      variableOpex: opex[k].variableTotal,
      pctOpex: opex[k].pctTotal,
      marginalProfit,
      fixedOpex: opex[k].fixedTotal + opex[k].itTotal,
      fot: fot[k].total,
      ebitda,
      amortization: monthlyAmort,
      ebit,
      cit: taxes[k].cit,
      netProfit,
      dividends: taxes[k].dividends,
      sdc: taxes[k].sdc,
      netAfterSdc: netProfit - taxes[k].sdc,
    }
  })
}
