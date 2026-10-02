import type { ModelResult, NomenclatureItem, Params, ScenarioName, ScenarioMatrix } from './types'
import { resolveScenario } from './scenario'
import { computeRevenue } from './revenue'
import { computeOpex } from './opex'
import { computeFot } from './fot'
import { computeCapex } from './capex'
import { computeProfitTaxes, computeVat } from './taxes'
import { computePnl } from './pnl'
import { computeCashFlow } from './cashflow'
import { computeKpis } from './kpis'

// Полный прогон модели: параметры + сценарий + режимы -> все отчёты + KPI.
// Порядок: НДС (от выручки) → нетто-выручка → EBIT → CIT → ЧП → дивиденды/SDC.
// Overrides позволяют sensitivity-анализу подменять входы без мутации params.
export function runModel(
  params: Params,
  matrix: ScenarioMatrix,
  items: NomenclatureItem[],
  scenario: ScenarioName = params.meta.scenario,
  overrides: Partial<{
    demandMult: number
    wacc: number
    priceGrowth: number
    capexAdj: number
    priceMult: number
    mode: 'Да' | 'Нет'
    vatMode: 'Гросс' | 'С возмещением'
  }> = {},
): ModelResult {
  const p: Params = JSON.parse(JSON.stringify(params))
  if (overrides.demandMult !== undefined) p.service.demandMult = overrides.demandMult
  if (overrides.wacc !== undefined) p.general.wacc = overrides.wacc
  if (overrides.priceMult !== undefined) applyPriceMult(p, overrides.priceMult)
  if (overrides.mode !== undefined) p.meta.mode = overrides.mode
  if (overrides.vatMode !== undefined) p.meta.vatMode = overrides.vatMode

  const sc = resolveScenario(p, matrix, scenario)
  if (overrides.priceGrowth !== undefined) sc.priceGrowth = overrides.priceGrowth
  if (overrides.capexAdj !== undefined) sc.capexAdj = overrides.capexAdj

  const capex = computeCapex(p, items, sc.capexAdj)
  const revenue = computeRevenue(p, sc)
  const opex = computeOpex(p, items, revenue)
  const fot = computeFot(p, revenue)
  const vat = computeVat(p, revenue, opex, capex.adjustedEur)

  const ebit = revenue.map(
    (r, k) =>
      r.total - vat[k].vatPayable - opex[k].variableTotal - opex[k].pctTotal -
      opex[k].fixedTotal - opex[k].itTotal - opex[k].landRent - fot[k].total - capex.monthlyAmort,
  )
  // CIT не зависит от чистой прибыли → первый проход даёт корректный CIT.
  // Дивиденды берут ЧП с лагом 12 мес → второй проход с реальной базой.
  const citPass = computeProfitTaxes(p, revenue, ebit, ebit.map(() => 0), vat)
  const netPreDiv = ebit.map((e, k) => e - citPass.taxes[k].cit)
  const { taxes, citByYear } = computeProfitTaxes(p, revenue, ebit, netPreDiv, vat)

  const pnl = computePnl(p, revenue, opex, fot, taxes, capex.monthlyAmort)
  const cashflow = computeCashFlow(p, pnl, capex.adjustedEur, sc.presaleMonthly)
  const kpis = computeKpis(p, cashflow)

  return {
    scenario: sc, revenue, opex, fot, taxes, pnl, cashflow, capex, citByYear, kpis,
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
}
