import type { OpexMonth, Params, RevenueMonth, TaxMonth } from './types'

export interface VatMonth {
  vatOut19: number
  vatOut9: number
  inputVat: number
  vatCredit: number
  vatPayable: number
}

// НДС: выходной 19% (бани/услуги/членства) + 9% (глэмпинг/F&B), extracted-ставки.
// Режим «С возмещением»: входной НДС с OPEX (помесячно) и CAPEX (разово, мес.0);
// переходящий кредит уменьшает платёж следующих месяцев — Налоги!9/13/15.
export function computeVat(
  params: Params,
  revenue: RevenueMonth[],
  opex: OpexMonth[],
  capexAdjustedEur: number,
): VatMonth[] {
  const r = params.taxes
  const reimb = params.meta.vatMode === 'С возмещением'
  const out: VatMonth[] = []
  let credit = 0
  for (let k = 0; k < revenue.length; k++) {
    const rev = revenue[k]
    const vatOut19 =
      ((rev.rental + rev.steamTotal + rev.massageTotal + rev.extraTotal + rev.membershipTotal) *
        r.vatStd) / (1 + r.vatStd)
    const vatOut9 =
      (rev.glamping * r.vatGlamp) / (1 + r.vatGlamp) + (rev.fb * r.vatFb) / (1 + r.vatFb)
    const inputVat = reimb
      ? ((opex[k].fixedTotal + opex[k].variableTotal + opex[k].itTotal) * r.vatInput) / (1 + r.vatInput) +
        (k === 0 ? (capexAdjustedEur * r.vatInput) / (1 + r.vatInput) : 0)
      : 0
    const vatOut = vatOut19 + vatOut9
    const vatPayable = Math.max(0, vatOut - inputVat - credit)
    credit = Math.max(0, credit + inputVat - vatOut)
    out.push({ vatOut19, vatOut9, inputVat, vatCredit: credit, vatPayable })
  }
  return out
}

// CIT: годовой блок с переносом убытков; уплата двумя авансами — июнь и декабрь.
// Дивиденды: 90% чистой прибыли того же месяца годом ранее (лаг 12), с месяца 13.
// SDC: дивиденды × Σ(доля×ставка)/Σ(доли партнёров + УК) — Налоги!17.
export function computeProfitTaxes(
  params: Params,
  revenue: RevenueMonth[],
  ebit: number[],
  netProfitPreDiv: number[],
  vat: VatMonth[],
): { taxes: TaxMonth[]; citByYear: number[] } {
  const r = params.taxes
  const years = Math.ceil(params.meta.opsMonths / 12)

  // Годовой CIT с переносом убытков — Налоги!C22:G31
  const citByYear: number[] = []
  let lossCarry = 0
  for (let y = 0; y < years; y++) {
    const ebitY = ebit.slice(y * 12, y * 12 + 12).reduce((a, b) => a + b, 0)
    const used = Math.min(Math.max(0, ebitY), lossCarry)
    const taxable = Math.max(0, ebitY - used)
    citByYear.push(taxable * r.cit)
    lossCarry = lossCarry - used + Math.max(0, -ebitY)
  }

  const distShare =
    params.partners.shares.reduce((a, b) => a + b, 0) + params.partners.corporate.mgmt
  // SDC 17% и GESY 2.65% — на дивиденды резидентам Кипра (non-dom освобождены от обоих)
  const sdcWeighted = params.partners.shares.reduce(
    (s, sh, i) =>
      s + sh * (params.partners.statuses[i] === 'Резидент Кипра (17%)' ? r.sdc : 0),
    0,
  )
  const gesyWeighted = params.partners.shares.reduce(
    (s, sh, i) =>
      s + sh * (params.partners.statuses[i] === 'Резидент Кипра (17%)' ? r.gesy : 0),
    0,
  )

  const taxes = vat.map((v, k) => {
    const y = Math.min(years - 1, Math.floor(k / 12))
    const mo = revenue[k].monthOfYear
    const cit = mo === 6 || mo === 12 ? citByYear[y] / 2 : 0
    const dividends = k >= 12 ? Math.max(0, netProfitPreDiv[k - 12]) * distShare : 0
    const sdc = (dividends * sdcWeighted) / distShare
    const gesy = (dividends * gesyWeighted) / distShare
    return { ...v, cit, dividends, sdc, gesy, total: v.vatPayable + cit + sdc + gesy }
  })
  return { taxes, citByYear }
}
