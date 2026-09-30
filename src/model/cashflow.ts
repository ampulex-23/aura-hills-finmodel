import type { CashFlowMonth, Params, PnlMonth } from './types'

const MONTHS_RU = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']

function addMonthsIso(isoDate: string, months: number): string {
  const [y, m] = isoDate.slice(0, 7).split('-').map(Number)
  const t = y * 12 + (m - 1) + months
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

// Cash-Flow на 72 месяца: 12 стройки + 60 операционных.
// FCFF = операционный CF + CAPEX-отток + пре-сейл; пре-сейл — последние presaleMonths стройки.
export function computeCashFlow(
  params: Params,
  pnl: PnlMonth[],
  capexAdjustedEur: number,
  presaleMonthly: number,
): CashFlowMonth[] {
  const total = params.meta.capexMonths + params.meta.opsMonths
  const capexPerMonth = -capexAdjustedEur / params.meta.capexMonths
  const presaleEnd = params.meta.capexMonths // последние N месяцев стройки
  const presaleStart = presaleEnd - params.units.presaleMonths + 1 // 1-based

  let cumCash = 0
  let cumFcff = 0
  let cumDcf = 0
  const out: CashFlowMonth[] = []

  for (let i = 0; i < total; i++) {
    const m1 = i + 1 // месяц 1..72, как COLUMN()-2 в Excel
    const isOps = m1 > params.meta.capexMonths
    const opsIdx = m1 - params.meta.capexMonths - 1
    const date = addMonthsIso(params.meta.constructionStart, i)
    const label = `${MONTHS_RU[Number(date.slice(5)) - 1]} ${date.slice(0, 4)}`

    const netProfit = isOps ? pnl[opsIdx].netProfit : 0
    const amortization = isOps ? pnl[opsIdx].amortization : 0
    const operatingCf = netProfit + amortization
    const capex = m1 <= params.meta.capexMonths ? capexPerMonth : 0
    const presale =
      m1 <= presaleEnd && m1 >= presaleStart ? presaleMonthly : 0
    const fcff = operatingCf + capex + presale
    const dividends = isOps ? -pnl[opsIdx].dividends : 0
    const sdc = isOps ? -pnl[opsIdx].sdc : 0
    const totalCf = fcff + dividends + sdc

    cumCash += totalCf
    cumFcff += fcff
    const discountFactor = 1 / Math.pow(1 + params.general.wacc / 12, m1)
    const discountedFcff = fcff * discountFactor
    cumDcf += discountedFcff

    out.push({
      label, isOps, netProfit, amortization, operatingCf, capex, presale,
      fcff, dividends, sdc, totalCf, cumCash, cumFcff,
      discountFactor, discountedFcff, cumDcf,
    })
  }
  return out
}
