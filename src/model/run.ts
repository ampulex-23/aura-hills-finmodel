import type { ModelResult, NomenclatureItem, Params, ScenarioName, ScenarioMatrix, ServiceSpec } from './types'
import { resolveScenario } from './scenario'
import { computeRevenue } from './revenue'
import { computeOpex } from './opex'
import { computeFot } from './fot'
import { computeCapex } from './capex'
import { computeProfitTaxes, computeVat } from './taxes'
import { computePnl } from './pnl'
import { computeCashFlow } from './cashflow'
import { computeKpis } from './kpis'
import { computeBalance } from './balance'

/** Стоимость капитала по CAPM: ke = rf + β·ERP + страновая + size/startup премии.
 *  Проект без долга → WACC = ke. */
export function capmWacc(p: Params): number {
  const c = p.general.capm
  return c.rf + c.beta * c.erp + c.countryPremium + c.sizePremium
}

/** Ставка дисконтирования, которую реально применяет модель */
export function resolveWacc(p: Params): number {
  return p.general.waccMode === 'capm' && p.general.capm ? capmWacc(p) : p.general.wacc
}

function shiftIso(iso: string, months: number): string {
  const [y, m] = iso.slice(0, 7).split('-').map(Number)
  const t = y * 12 + (m - 1) + months
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`
}

// Полный прогон модели: параметры + сценарий + режимы -> все отчёты + KPI.
// Порядок: НДС (от выручки) → нетто-выручка → EBIT → CIT → ЧП → дивиденды/SDC.
// Overrides позволяют sensitivity-анализу подменять входы без мутации params.
export function runModel(
  params: Params,
  matrix: ScenarioMatrix,
  items: NomenclatureItem[],
  services: ServiceSpec[],
  scenario: ScenarioName = params.meta.scenario,
  overrides: Partial<{
    demandMult: number
    wacc: number
    priceGrowth: number
    capexAdj: number
    priceMult: number
    loadMult: number
    uptake: number
    mode: 'Да' | 'Нет'
    vatMode: 'Гросс' | 'С возмещением'
    mutate: (p: Params) => void
  }> = {},
): ModelResult {
  const p: Params = JSON.parse(JSON.stringify(params))
  if (overrides.demandMult !== undefined) p.service.demandMult = overrides.demandMult
  if (overrides.priceMult !== undefined) applyPriceMult(p, overrides.priceMult)
  if (overrides.mode !== undefined) p.meta.mode = overrides.mode
  if (overrides.vatMode !== undefined) p.meta.vatMode = overrides.vatMode
  if (overrides.mutate) overrides.mutate(p)
  // WACC: CAPM-расчёт или ручной; явный override всегда побеждает (sensitivity)
  p.general.wacc = overrides.wacc !== undefined ? overrides.wacc : resolveWacc(p)

  const sc = resolveScenario(p, matrix, scenario)
  if (overrides.priceGrowth !== undefined) sc.priceGrowth = overrides.priceGrowth
  if (overrides.capexAdj !== undefined) sc.capexAdj = overrides.capexAdj
  if (overrides.uptake !== undefined) {
    sc.uptake = overrides.uptake
    sc.effectiveUptake = p.meta.mode === 'Да' ? 1 : overrides.uptake
  }
  // Сценарные стрессы стройки и энергии (аудит 14, W-13): задержка сдвигает
  // открытие и удлиняет стройку (CAPEX, аренда земли, pre-opening — на дольше);
  // energyCostMult масштабирует энергетические статьи постоянных OPEX.
  if (sc.constructionDelayMonths > 0) {
    p.meta.capexMonths += sc.constructionDelayMonths
    p.meta.openingDate = shiftIso(p.meta.openingDate, sc.constructionDelayMonths)
  }
  if (sc.energyCostMult !== 1)
    for (const f of p.opexFixed) if (f.energy) f.base *= sc.energyCostMult
  // loadMult — общий масштаб спроса/загрузки (break-even, tornado): все
  // векторы загрузки и планы членства умножаются на один коэффициент.
  if (overrides.loadMult !== undefined) {
    const L = overrides.loadMult
    for (const key of ['bathsLoad', 'steamLoad', 'massageLoad', 'extraLoad', 'glampLoad', 'publicBathLoad', 'restLoad'] as const)
      sc[key] = sc[key].map((v) => v * L)
    sc.membersMonth = sc.membersMonth.map((v) => v * L)
  }

  const capex = computeCapex(p, items, sc.capexAdj)
  const revenue = computeRevenue(p, sc)
  const opex = computeOpex(p, items, revenue, services)
  const fot = computeFot(p, revenue, services)
  const vat = computeVat(p, revenue, opex, capex)

  const ebit = revenue.map(
    (r, k) =>
      r.total - vat[k].vatOut - opex[k].variableTotal - opex[k].pctTotal -
      opex[k].fixedTotal - opex[k].itTotal - opex[k].landRent - fot[k].total - capex.amortMonthly[k],
  )
  // CIT не зависит от чистой прибыли → первый проход даёт корректный CIT.
  // Дивиденды берут ЧП с лагом 12 мес → второй проход с реальной базой.
  // CIT считается от налоговой базы: EBIT с налоговой амортизацией (capital
  // allowances) вместо бухгалтерской — на Кипре они разные графики.
  const citEbit = ebit.map((e, k) => e + capex.amortMonthly[k] - capex.taxDeprMonthly[k])
  const citPass = computeProfitTaxes(p, revenue, citEbit, citEbit.map(() => 0), vat)
  const netPreDiv = ebit.map((e, k) => e - citPass.taxes[k].cit)
  const { taxes, citByYear } = computeProfitTaxes(p, revenue, citEbit, netPreDiv, vat)

  const pnl = computePnl(p, revenue, opex, fot, taxes, capex.amortMonthly)
  const cashflow = computeCashFlow(
    p, pnl, capex.adjustedEur, sc.presaleMonthly, capex.deferred,
    capex.amortizableEur, capex.deferredPhase1Total, capex.phase2Outflow,
  )
  const balance = computeBalance(cashflow)
  const kpis = computeKpis(p, cashflow, pnl)

  return {
    scenario: sc, revenue, opex, fot, taxes, pnl, cashflow, balance, capex, citByYear, kpis,
  }
}

// Мультипликатор всех цен (таблица 3 sensitivity): прайсы модулей, услуг,
// членств, глэмпинга, F&B, сертификатов, депозиты.
function applyPriceMult(p: Params, mult: number): void {
  for (const m of p.modules) m.prices = m.prices.map((x) => x * mult)
  for (const set of [p.procedures.steam, p.procedures.massage, p.procedures.extra])
    set.prices = set.prices.map((x) => x * mult)
  p.prices.membershipMonth *= mult
  p.prices.membershipYear *= mult
  p.prices.certificate *= mult
  p.prices.glampSmall *= mult
  p.prices.glampBig *= mult
  p.prices.fbPerGuest *= mult
  p.deposit.base *= mult
  p.deposit.steamBase *= mult
  p.deposit.massageBase *= mult
  if (p.publicBath) p.publicBath.ticketEur *= mult
  if (p.restaurant) p.restaurant.avgCheck *= mult
  if (p.publicBath?.serviceSpendPerVisit != null) p.publicBath.serviceSpendPerVisit *= mult
}
