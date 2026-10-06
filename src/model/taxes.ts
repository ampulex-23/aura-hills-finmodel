import type { OpexMonth, Params, RevenueMonth, TaxMonth } from './types'

export interface VatMonth {
  vatOut19: number
  vatOut9: number
  /** Начисленный выходной НДС — то, что уходит из выручки в P&L независимо от кредита */
  vatOut: number
  inputVat: number
  vatCredit: number
  vatPayable: number
}

// НДС: выходной 19% (бани/услуги/членства) + 9% (глэмпинг/F&B), extracted-ставки.
// Режим «С возмещением»: входной НДС с OPEX (помесячно) и CAPEX;
// переходящий кредит уменьшает платёж следующих месяцев — Налоги!9/13/15.
// CAPEX-НДС: база без земли (у покупки участка возмещаемого НДС нет) и без
// отложенных модулей — их входной НДС приходит в месяц ввода модуля.
export function computeVat(
  params: Params,
  revenue: RevenueMonth[],
  opex: OpexMonth[],
  capex: { amortizableEur: number; deferred: { month: number; eur: number }[] },
): VatMonth[] {
  const r = params.taxes
  const reimb = params.meta.vatMode === 'С возмещением'
  const capexVat = (eur: number) => (eur * r.vatInput) / (1 + r.vatInput)
  const deferredVat = new Map<number, number>()
  for (const d of capex.deferred) {
    const k = d.month - params.meta.capexMonths - 1 // 1-based CF-месяц → ops-месяц
    deferredVat.set(k, (deferredVat.get(k) ?? 0) + capexVat(d.eur))
  }
  const upfrontVat = capexVat(
    capex.amortizableEur - capex.deferred.reduce((s, d) => s + d.eur, 0),
  )
  const out: VatMonth[] = []
  let credit = 0
  for (let k = 0; k < revenue.length; k++) {
    const rev = revenue[k]
    const vatOut19 =
      ((rev.rental + rev.steamTotal + rev.massageTotal + rev.extraTotal + rev.membershipTotal) *
        r.vatStd) / (1 + r.vatStd)
    const vatOut9 =
      (rev.glamping * r.vatGlamp) / (1 + r.vatGlamp) + (rev.fb * r.vatFb) / (1 + r.vatFb)
    const vatOut = vatOut19 + vatOut9
    const inputVat = reimb
      ? ((opex[k].fixedTotal + opex[k].variableTotal + opex[k].itTotal) * r.vatInput) / (1 + r.vatInput) +
        (k === 0 ? upfrontVat : 0) + (deferredVat.get(k) ?? 0)
      : 0
    const vatPayable = Math.max(0, vatOut - inputVat - credit)
    credit = Math.max(0, credit + inputVat - vatOut)
    out.push({ vatOut19, vatOut9, vatOut, inputVat, vatCredit: credit, vatPayable })
  }
  return out
}

// CIT: годовой блок с переносом убытков по КАЛЕНДАРНЫМ годам; уплата двумя
// авансами — 31 июля и 31 декабря (провизиональный налог Кипра). Если в календарном
// году доступна только одна дата платежа (напр. открытие осенью), годовой CIT
// уходит в неё целиком.
// Дивиденды: доля распределения × чистая прибыль того же месяца годом ранее
// (лаг 12), с месяца 13. SDC: дивиденды × Σ(доля×ставка)/Σдолей — Налоги!17.
export function computeProfitTaxes(
  params: Params,
  revenue: RevenueMonth[],
  ebit: number[],
  netProfitPreDiv: number[],
  vat: VatMonth[],
): { taxes: TaxMonth[]; citByYear: number[] } {
  const r = params.taxes
  const [oy, om] = params.meta.openingDate.slice(0, 7).split('-').map(Number)
  const calYearOf = (k: number) => Math.floor((oy * 12 + (om - 1) + k) / 12)
  const yearKeys = [...new Set(revenue.map((_, k) => calYearOf(k)))]

  // Годовой CIT с переносом убытков — Налоги!C22:G31
  const citByYear: number[] = []
  let lossCarry = 0
  for (const y of yearKeys) {
    const ebitY = ebit.reduce((s, e, k) => s + (calYearOf(k) === y ? e : 0), 0)
    const used = Math.min(Math.max(0, ebitY), lossCarry)
    const taxable = Math.max(0, ebitY - used)
    citByYear.push(taxable * r.cit)
    lossCarry = lossCarry - used + Math.max(0, -ebitY)
  }
  const citOf = new Map(yearKeys.map((y, i) => [y, citByYear[i]]))
  // Даты платежа в году: июль и декабрь; если обеих нет — годовой CIT в одну дату
  const payCount = new Map<number, number>()
  revenue.forEach((rev, k) => {
    if (rev.monthOfYear === 7 || rev.monthOfYear === 12)
      payCount.set(calYearOf(k), (payCount.get(calYearOf(k)) ?? 0) + 1)
  })

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
    const mo = revenue[k].monthOfYear
    const cit =
      mo === 7 || mo === 12
        ? (citOf.get(calYearOf(k)) ?? 0) / (payCount.get(calYearOf(k)) ?? 1)
        : 0
    const dividends = k >= 12 ? Math.max(0, netProfitPreDiv[k - 12]) * distShare : 0
    const sdc = (dividends * sdcWeighted) / distShare
    const gesy = (dividends * gesyWeighted) / distShare
    return { ...v, cit, dividends, sdc, gesy, total: v.vatPayable + cit + sdc + gesy }
  })
  return { taxes, citByYear }
}
