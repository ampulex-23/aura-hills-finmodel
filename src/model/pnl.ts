import type { FotMonth, OpexMonth, Params, PnlMonth, RevenueMonth, TaxMonth } from './types'

// P&L помесячно: нетто-выручка − переменные − % − фикс − ФОТ − амортизация − CIT − SDC
export function computePnl(
  params: Params,
  revenue: RevenueMonth[],
  opex: OpexMonth[],
  fot: FotMonth[],
  taxes: TaxMonth[],
  amortMonthly: number[],
): PnlMonth[] {
  return revenue.map((rev, k) => {
    // Нетто-выручка = брутто − НАЧИСЛЕННЫЙ выходной НДС. Уплаченный НДС
    // (за вычетом входного кредита) — кэш-эффект, уходит в CF через vatTiming;
    // иначе в режиме «С возмещением» месяцы сгорания CAPEX-кредита показывали
    // бы EBITDA с полным НДС внутри.
    const revenueNet = rev.total - taxes[k].vatOut
    const marginalProfit = revenueNet - opex[k].variableTotal - opex[k].pctTotal
    const ebitda = marginalProfit - opex[k].fixedTotal - opex[k].itTotal - opex[k].landRent - fot[k].total
    const ebit = ebitda - amortMonthly[k]
    const netProfit = ebit - taxes[k].cit
    return {
      revenueNet,
      revenueGross: rev.total,
      vatOut: taxes[k].vatOut,
      vatPayable: taxes[k].vatPayable,
      vatPaid: taxes[k].vatPaid,
      variableOpex: opex[k].variableTotal,
      pctOpex: opex[k].pctTotal,
      marginalProfit,
      fixedOpex: opex[k].fixedTotal + opex[k].itTotal + opex[k].landRent,
      fot: fot[k].total,
      ebitda,
      amortization: amortMonthly[k],
      ebit,
      cit: taxes[k].cit,
      netProfit,
      dividends: taxes[k].dividends,
      sdc: taxes[k].sdc,
      gesy: taxes[k].gesy,
      netAfterSdc: netProfit - taxes[k].sdc - taxes[k].gesy,
    }
  })
}
