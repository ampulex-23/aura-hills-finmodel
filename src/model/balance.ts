import type { BalanceMonth, CashFlowMonth } from './types'

// Мини-баланс на конец каждого месяца (аудит 14, I-1). Строится из тех же
// потоков, что и CF, поэтому сходится тождественно:
//   Активы:        касса + ОС по остаточной стоимости (CAPEX − амортизация)
//   Обязательства: пул предоплат (deferred revenue) + нетто-расчёты по НДС
//   Капитал:       equity-транши + нераспределённая прибыль
//                  (ЧП операционных месяцев + расходы стройки: аренда земли,
//                   pre-opening — они не проходят через P&L, но уменьшают капитал;
//                   минус дивиденды брутто)
export function computeBalance(cashflow: CashFlowMonth[]): BalanceMonth[] {
  let ppe = 0
  let vatNet = 0
  let equityIn = 0
  let retained = 0
  return cashflow.map((m) => {
    ppe += -(m.capex + m.deferredCapex + m.maintCapex) - m.amortization
    vatNet += m.vatTiming
    equityIn += m.equityIn
    retained += m.netProfit + m.landLease + m.preopen + m.dividends
    const totalAssets = m.cash + ppe
    const totalLiabEq = m.prepaidPool + vatNet + equityIn + retained
    return {
      label: m.label, cash: m.cash, ppeNbv: ppe, totalAssets,
      prepaidPool: m.prepaidPool, vatNet, equityIn, retained, totalLiabEq,
      check: totalAssets - totalLiabEq,
    }
  })
}
