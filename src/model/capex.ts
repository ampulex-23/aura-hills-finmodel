import type { NomenclatureItem, Params } from './types'
import { activeModuleCount, nomenclatureCapexEur } from './opex'

// CAPEX: qty × ценаRUB / курс = EUR; строка «Наполнение» = справочник; итог × (1+capexAdj)
export function computeCapex(
  params: Params,
  items: NomenclatureItem[],
  capexAdj: number,
): { items: { name: string; eur: number }[]; totalEur: number; adjustedEur: number; monthlyAmort: number } {
  const rate = params.general.rubEurRate
  const out = params.capexItems.map((it) => {
    let eur: number
    if (it.row === 30) {
      eur = nomenclatureCapexEur(items) // наполнение — из справочника, уже в EUR
    } else {
      const qty = it.qty === 'MODULES_COUNT' ? activeModuleCount(params) : Number(it.qty ?? 0)
      eur = (qty * Number(it.priceRub ?? 0)) / rate
    }
    return { name: it.name ?? '', eur }
  })
  // IT / АСУ: внедрение кастомного слоя — разовые вложения в период стройки (уже в EUR)
  if (params.it.enabled) out.push(...params.it.capex.map((c) => ({ name: c.name, eur: c.eur })))
  const totalEur = out.reduce((s, i) => s + i.eur, 0)
  const adjustedEur = totalEur * (1 + capexAdj)
  const monthlyAmort =
    params.amort.shares.reduce(
      (s, sh, i) => s + (adjustedEur * sh) / (params.amort.years[i] * 12),
      0,
    )
  return { items: out, totalEur, adjustedEur, monthlyAmort }
}
