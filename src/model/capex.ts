import type { NomenclatureItem, Params } from './types'
import { activeModuleCount, landedCost, nomenclatureCapexEur } from './opex'

// CAPEX: qty × ценаRUB / курс = EUR; строка «Наполнение» = справочник; итог × (1+capexAdj)
export function computeCapex(
  params: Params,
  items: NomenclatureItem[],
  capexAdj: number,
): {
  items: { name: string; eur: number }[]
  totalEur: number
  adjustedEur: number
  monthlyAmort: number
  amortizableEur: number
  monthlyTaxDepr: number
  deferred: { month: number; eur: number }[]
} {
  const rate = params.general.rubEurRate
  const out: {
    name: string
    eur: number
    detail?: { code: string; name: string; qty: number; landed: number; eur: number }[]
  }[] = params.capexItems.map((it) => {
    let eur: number
    let detail: { code: string; name: string; qty: number; landed: number; eur: number }[] | undefined
    if (it.row === 30) {
      eur = nomenclatureCapexEur(items) // наполнение — из справочника, уже в EUR
      detail = items
        .filter((x) => x.use === 'CAPEX')
        .map((x) => ({
          code: x.code, name: x.name, qty: x.qty,
          landed: landedCost(x), eur: landedCost(x) * x.qty,
        }))
    } else {
      const isModules = it.qty === 'MODULES_COUNT'
      const qty = isModules ? activeModuleCount(params) : Number(it.qty ?? 0)
      eur = (qty * Number(it.priceRub ?? 0)) / rate
      if (isModules) {
        const unit = Number(it.priceRub ?? 0) / rate
        detail = params.modules
          .filter((m) => m.status === 'Активен')
          .map((m) => ({
            code: `Модуль #${m.id}`, name: `запуск ${m.launchDate.slice(0, 7)}`,
            qty: 1, landed: unit, eur: unit,
          }))
      }
    }
    return { name: it.name ?? '', eur, detail }
  })
  // IT / АСУ: внедрение кастомного слоя — разовые вложения в период стройки (уже в EUR)
  if (params.it.enabled) out.push(...params.it.capex.map((c) => ({ name: c.name, eur: c.eur })))
  // Земля (режим purchase): входит в CAPEX, но НЕ амортизируется — земля не изнашивается
  const landEur = params.land.mode === 'purchase' ? params.land.purchaseCost : 0
  if (landEur) out.push({ name: 'Земля / участок', eur: landEur })
  const totalEur = out.reduce((s, i) => s + i.eur, 0)
  const adjustedEur = totalEur * (1 + capexAdj)
  const amortizableEur = adjustedEur - landEur * (1 + capexAdj)
  const monthlyAmort =
    params.amort.shares.reduce(
      (s, sh, i) => s + (amortizableEur * sh) / (params.amort.years[i] * 12),
      0,
    )
  // Налоговая амортизация (capital allowances): те же доли активов, другие сроки —
  // конструкции 25 лет (~4%/год), оборудование 7 лет (~14%), прочее/IT 5 лет (20%).
  const monthlyTaxDepr = params.taxDepr.enabled
    ? params.amort.shares.reduce(
        (s, sh, i) => s + (amortizableEur * sh) / (params.taxDepr.years[i] * 12),
        0,
      )
    : monthlyAmort
  // Real option: активный модуль с запуском после открытия платит свою долю
  // помодульного CAPEX (строки qty=MODULES_COUNT) в месяц ввода, а не в стройке.
  // Амортизация упрощённо идёт с общей даты открытия — отмечено в аудите.
  const unitEur = params.capexItems
    .filter((it) => it.qty === 'MODULES_COUNT')
    .reduce((s, it) => s + Number(it.priceRub ?? 0) / rate, 0)
  const ym = (iso: string) => {
    const [y, m] = iso.slice(0, 7).split('-').map(Number)
    return y * 12 + m
  }
  const openYm = ym(params.meta.openingDate)
  const deferred = params.modules
    .filter((m) => m.status === 'Активен' && ym(m.launchDate) > openYm)
    .map((m) => ({
      month: ym(m.launchDate) - ym(params.meta.constructionStart) + 1, // 1-based месяц CF
      eur: unitEur * (1 + capexAdj),
    }))
  return { items: out, totalEur, adjustedEur, monthlyAmort, amortizableEur, monthlyTaxDepr, deferred }
}
