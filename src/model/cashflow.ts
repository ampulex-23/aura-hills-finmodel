import type { CashFlowMonth, Params, PnlMonth } from './types'
import { baseSalariesMonthly } from './fot'
import { fixedOpexMonthly } from './opex'

const MONTHS_RU = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']

function addMonthsIso(isoDate: string, months: number): string {
  const [y, m] = isoDate.slice(0, 7).split('-').map(Number)
  const t = y * 12 + (m - 1) + months
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

/** Месячная ставка, эквивалентная эффективной годовой: (1+WACC)^(1/12) − 1.
 *  Раньше бралось WACC/12 — эффективно 14.93% вместо 14% (аудит 14, W-4). */
export function monthlyRate(annual: number): number {
  return Math.pow(1 + annual, 1 / 12) - 1
}

/** Веса S-кривой освоения CAPEX по месяцам стройки: нормированы к 1; при
 *  несовпадении длины с capexMonths — равномерно. */
export function capexWeights(params: Params): number[] {
  const n = params.meta.capexMonths
  const raw = params.capexSCurve
  if (!raw || raw.length !== n || raw.some((w) => !(w >= 0))) return Array.from({ length: n }, () => 1 / n)
  const s = raw.reduce((a, b) => a + b, 0)
  return s > 0 ? raw.map((w) => w / s) : Array.from({ length: n }, () => 1 / n)
}

// Cash-Flow: capexMonths стройки + opsMonths операций.
// FCFF = операционный CF + CAPEX (S-кривая) + отложенные модули + пресейл + земля
//        + pre-opening + maintenance CAPEX.
// Deferred-пресейл — предоплата членств: P&L их доходит при потреблении, в CF пул
// прогорает за presaleRecognizeMonths — иначе одни и те же членства дали бы кэш дважды.
// Дивиденды — брутто: SDC/GESY удерживаются ИЗ них (не доп. отток компании).
// Equity-транши закрывают кассовый разрыв месяца → cash ≥ 0 всегда.
export function computeCashFlow(
  params: Params,
  pnl: PnlMonth[],
  capexAdjustedEur: number,
  presaleMonthly: number,
  deferredCapex: { month: number; eur: number }[] = [],
  amortizableEur = capexAdjustedEur,
  deferredPhase1Total?: number,
  phase2Outflow: { month: number; eur: number }[] = [],
): CashFlowMonth[] {
  const total = params.meta.capexMonths + params.meta.opsMonths
  // В освоение стройки очереди 1 вычитаются только её отложенные суммы —
  // CAPEX очереди 2 не входит в capexAdjustedEur и приходит отдельным
  // помесячным графиком (deferredCapex месяцы окна 2029–2030).
  const deferredTotal = deferredPhase1Total ?? deferredCapex.reduce((s, d) => s + d.eur, 0)
  const weights = capexWeights(params)
  const buildCapex = capexAdjustedEur - deferredTotal
  // Финансирование очереди 2: 'equity' — выделенный транш акционеров под
  // отток стройки; 'ops' — гасится операционным CF (equityIn только на разрыв).
  const p2EquityMode = params.phase2?.funding === 'equity'
  const presaleEnd = params.meta.capexMonths
  const presaleStart = presaleEnd - params.units.presaleMonths + 1 // 1-based
  const deferred = params.units.presaleMode === 'deferred'
  const recogMonths = Math.max(1, params.units.presaleRecognizeMonths)
  const unwindMonthly = deferred ? (presaleMonthly * params.units.presaleMonths) / recogMonths : 0

  const preopenMonths = params.preopen.enabled
    ? Math.min(params.preopen.months, params.meta.capexMonths)
    : 0
  const preopenStart = params.meta.capexMonths - preopenMonths + 1
  const preopenMonthly = -(
    baseSalariesMonthly(params) * (1 + params.taxes.employerRate) +
    fixedOpexMonthly(params)
  )

  // Maintenance CAPEX: % амортизируемой базы в год (помесячно, с года startYear)
  // + разовый капремонт в первый месяц lumpYear (аудит 14, W-7).
  const mt = params.capexMaint
  const maintMonthly = mt?.enabled ? -(amortizableEur * mt.pctPerYear) / 12 : 0

  const rM = monthlyRate(params.general.wacc)
  let cumCash = 0
  let cumFcff = 0
  let cumDcf = 0
  let cash = 0
  let pool = 0
  const out: CashFlowMonth[] = []

  for (let i = 0; i < total; i++) {
    const m1 = i + 1
    const isOps = m1 > params.meta.capexMonths
    const opsIdx = m1 - params.meta.capexMonths - 1
    const opsYear = Math.floor(opsIdx / 12) + 1 // 1-based операционный год
    const date = addMonthsIso(params.meta.constructionStart, i)
    const label = `${MONTHS_RU[Number(date.slice(5)) - 1]} ${date.slice(0, 4)}`

    const netProfit = isOps ? pnl[opsIdx].netProfit : 0
    const amortization = isOps ? pnl[opsIdx].amortization : 0
    // P&L берёт выручку за вычетом НАЧИСЛЕННОГО НДС; в кэше остаётся неуплаченная
    // часть (входной кредит + квартальный график) → Δ обязательства по НДС.
    const vatTiming = isOps ? pnl[opsIdx].vatOut - pnl[opsIdx].vatPaid : 0
    const operatingCf = netProfit + amortization + vatTiming
    const defCapex = deferredCapex
      .filter((d) => d.month === m1)
      .reduce((s, d) => s - d.eur, 0)
    const capex = !isOps ? -buildCapex * weights[i] : 0
    const presale = m1 <= presaleEnd && m1 >= presaleStart ? presaleMonthly : 0
    const presaleUnwind = isOps && opsIdx < recogMonths ? -unwindMonthly : 0
    pool += presale + presaleUnwind
    const landLease = !isOps && params.land.mode === 'lease' ? -params.land.rentMonthly : 0
    const preopen = !isOps && m1 >= preopenStart ? preopenMonthly : 0
    let maintCapex = 0
    if (isOps && mt?.enabled) {
      if (opsYear >= mt.startYear) maintCapex += maintMonthly
      if (opsYear === mt.lumpYear && opsIdx % 12 === 0) maintCapex -= mt.lumpEur
    }
    const fcff = operatingCf + capex + defCapex + presale + presaleUnwind + landLease + preopen + maintCapex
    const dividends = isOps ? -pnl[opsIdx].dividends : 0
    const sdc = isOps ? pnl[opsIdx].sdc : 0
    const gesy = isOps ? pnl[opsIdx].gesy : 0
    const totalCf = fcff + dividends

    cumCash += totalCf
    // Транш под очередь 2 идёт первым — до автоматического закрытия разрыва.
    const phase2Equity = p2EquityMode
      ? phase2Outflow.filter((d) => d.month === m1).reduce((s, d) => s + d.eur, 0)
      : 0
    const equityIn = phase2Equity + Math.max(0, -(cash + totalCf + phase2Equity))
    cash = cash + totalCf + equityIn
    cumFcff += fcff
    const discountFactor = 1 / Math.pow(1 + rM, m1)
    const discountedFcff = fcff * discountFactor
    cumDcf += discountedFcff

    out.push({
      label, isOps, netProfit, amortization, vatTiming, operatingCf, capex, deferredCapex: defCapex,
      presale, presaleUnwind, prepaidPool: pool,
      landLease, preopen, maintCapex, fcff, dividends, sdc, gesy, totalCf,
      equityIn, phase2Equity, cash, cumCash, cumFcff, discountFactor, discountedFcff, cumDcf,
    })
  }
  return out
}
