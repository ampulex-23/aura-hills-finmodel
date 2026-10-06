import type { CashFlowMonth, Params, PnlMonth } from './types'
import { baseSalariesMonthly } from './fot'
import { fixedOpexMonthly } from './opex'

const MONTHS_RU = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']

function addMonthsIso(isoDate: string, months: number): string {
  const [y, m] = isoDate.slice(0, 7).split('-').map(Number)
  const t = y * 12 + (m - 1) + months
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

// Cash-Flow на 72 месяца: 12 стройки + 60 операционных.
// FCFF = операционный CF + CAPEX-отток + пре-сейл; пре-сейл — последние presaleMonths стройки.
// Deferred-режим: пресейл — это предоплата тех же членств. P&L их доходит при потреблении
// (выручка не трогается), а в CF пул прогорает равномерно за presaleRecognizeMonths —
// иначе одни и те же членства приносят кэш дважды (и в стройке, и в операционке).
export function computeCashFlow(
  params: Params,
  pnl: PnlMonth[],
  capexAdjustedEur: number,
  presaleMonthly: number,
  deferredCapex: { month: number; eur: number }[] = [],
): CashFlowMonth[] {
  const total = params.meta.capexMonths + params.meta.opsMonths
  // Отложенный CAPEX (модули, запускаемые после открытия) исключён из стройки —
  // платится в месяц ввода модуля; остаток делится равномерно по capexMonths.
  const deferredTotal = deferredCapex.reduce((s, d) => s + d.eur, 0)
  const capexPerMonth = -(capexAdjustedEur - deferredTotal) / params.meta.capexMonths
  const presaleEnd = params.meta.capexMonths // последние N месяцев стройки
  const presaleStart = presaleEnd - params.units.presaleMonths + 1 // 1-based
  const deferred = params.units.presaleMode === 'deferred'
  const recogMonths = Math.max(1, params.units.presaleRecognizeMonths)
  const unwindMonthly = deferred ? (presaleMonthly * params.units.presaleMonths) / recogMonths : 0

  // Pre-opening: последние N мес стройки штат уже нанят и объект работает «вхолостую»:
  // оклады + взносы работодателя + постоянные/IT расходы. Без переменных (нет гостей)
  // и без аренды земли — она идёт отдельной строкой landLease во все месяцы стройки.
  const preopenMonths = params.preopen.enabled
    ? Math.min(params.preopen.months, params.meta.capexMonths)
    : 0
  const preopenStart = params.meta.capexMonths - preopenMonths + 1
  const preopenMonthly = -(
    baseSalariesMonthly(params) * (1 + params.taxes.employerRate) +
    fixedOpexMonthly(params)
  )

  let cumCash = 0
  let cumFcff = 0
  let cumDcf = 0
  let pool = 0 // остаток обязательств по предоплатам (deferred revenue)
  const out: CashFlowMonth[] = []

  for (let i = 0; i < total; i++) {
    const m1 = i + 1 // месяц 1..72, как COLUMN()-2 в Excel
    const isOps = m1 > params.meta.capexMonths
    const opsIdx = m1 - params.meta.capexMonths - 1
    const date = addMonthsIso(params.meta.constructionStart, i)
    const label = `${MONTHS_RU[Number(date.slice(5)) - 1]} ${date.slice(0, 4)}`

    const netProfit = isOps ? pnl[opsIdx].netProfit : 0
    const amortization = isOps ? pnl[opsIdx].amortization : 0
    // P&L берёт выручку за вычетом НАЧИСЛЕННОГО НДС, а в кэше остаётся
    // неуплаченная часть (входной кредит OPEX/CAPEX) → добавляем Δ обязательства.
    // В режиме «Гросс» vatOut ≡ vatPayable и строка всегда 0.
    const vatTiming = isOps ? pnl[opsIdx].vatOut - pnl[opsIdx].vatPayable : 0
    const operatingCf = netProfit + amortization + vatTiming
    const defCapex = deferredCapex
      .filter((d) => d.month === m1)
      .reduce((s, d) => s - d.eur, 0)
    const capex = m1 <= params.meta.capexMonths ? capexPerMonth : 0
    const presale =
      m1 <= presaleEnd && m1 >= presaleStart ? presaleMonthly : 0
    const presaleUnwind = isOps && opsIdx < recogMonths ? -unwindMonthly : 0
    // Пул предоплат: растёт на приток пресейла, прогорает на unwind — это
    // обязательство компании перед гостями (deferred revenue на балансе).
    pool += presale + presaleUnwind
    // Аренда земли в стройке: площадку арендуют до открытия (после — в OPEX с инфляцией)
    const landLease =
      !isOps && params.land.mode === 'lease' ? -params.land.rentMonthly : 0
    const preopen = !isOps && m1 >= preopenStart ? preopenMonthly : 0
    const fcff = operatingCf + capex + defCapex + presale + presaleUnwind + landLease + preopen
    const dividends = isOps ? -pnl[opsIdx].dividends : 0
    const sdc = isOps ? -pnl[opsIdx].sdc : 0
    const gesy = isOps ? -pnl[opsIdx].gesy : 0
    const totalCf = fcff + dividends + sdc + gesy

    cumCash += totalCf
    cumFcff += fcff
    const discountFactor = 1 / Math.pow(1 + params.general.wacc / 12, m1)
    const discountedFcff = fcff * discountFactor
    cumDcf += discountedFcff

    out.push({
      label, isOps, netProfit, amortization, vatTiming, operatingCf, capex, deferredCapex: defCapex,
      presale, presaleUnwind, prepaidPool: pool,
      landLease, preopen, fcff, dividends, sdc, gesy, totalCf, cumCash, cumFcff,
      discountFactor, discountedFcff, cumDcf,
    })
  }
  return out
}
