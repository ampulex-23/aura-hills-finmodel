import type { CapexItem, NomenclatureItem, Params, WbsSection } from './types'
import { activeModuleCount, landedCost, nomenclatureEquipEur, nomenclatureStockEur } from './opex'

// CAPEX: qty × цена EUR = EUR; строка «Наполнение» = справочник; итог × (1+capexAdj)
// qty 'MODULES_COUNT[:N]' → N единиц на каждый активный модуль (N по умолчанию 1).
function perModuleUnits(qty: CapexItem['qty']): number | null {
  const m = /^MODULES_COUNT(?::(\d+))?$/.exec(String(qty))
  return m ? Number(m[1] ?? 1) : null
}
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
  type Item = {
    name: string
    eur: number
    group?: string
    unit?: string
    qty?: number
    rate?: number
    wbs?: (WbsSection & { total: number })[]
    detail?: { code: string; name: string; qty: number; landed: number; eur: number; category?: string; unit?: string }[]
  }
  const out: Item[] = params.capexItems
    // Условные строки (своя прачечная) входят в смету только при включённом режиме —
    // оборудование амортизируется в общем графике amort.shares.
    .filter((it) => !it.ifLaundry || params.laundry?.enabled)
    .map((it) => {
    let eur: number
    let unit: string | undefined = it.unit
    let qty: number | undefined
    let rateEur: number | undefined
    let detail: Item['detail']
    if (it.row === 30) {
      eur = nomenclatureEquipEur(items) // наполнение — оборудование из справочника
      unit = 'справ.'
      detail = items
        .filter((x) => x.use === 'CAPEX')
        .map((x) => ({
          code: x.code, name: x.name,
          qty: x.qty, landed: landedCost(x), eur: landedCost(x) * x.qty, category: x.category, unit: x.unit,
        }))
    } else {
      // 'MODULES_COUNT' = 1 ед. на активный модуль; 'MODULES_COUNT:N' = N ед. на модуль.
      // Так оборудование модулей (печи, купели, ванны) масштабируется при активации
      // резервных модулей, а не остаётся захардкоженным под стартовый контур.
      // У строк с WBS цена выводится из детализации: ΣWBS / wbsQty (wbsQty —
      // эталонный объём, на который составлена WBS; цена за единицу).
      const perModule = perModuleUnits(it.qty)
      const wbsSum = it.wbs?.length
        ? it.wbs.reduce((s, sec) => s + sec.items.reduce((x, l) => x + l.eur, 0), 0)
        : null
      const unitEur = wbsSum !== null ? wbsSum / (it.wbsQty ?? 1) : Number(it.priceEur ?? 0)
      qty = perModule !== null ? perModule * activeModuleCount(params) : Number(it.qty ?? 0)
      rateEur = unitEur
      eur = qty * unitEur
      if (perModule !== null) {
        detail = params.modules
          .filter((m) => m.status === 'Активен')
          .map((m) => ({
            code: `Модуль #${m.id}`, name: `запуск ${m.launchDate.slice(0, 7)}`,
            qty: perModule, landed: unitEur, eur: unitEur * perModule, unit: 'шт',
          }))
      }
    }
    // WBS-детализация хранится в EUR на эталонный объём; масштабируем до фактической
    // суммы строки (для помодульных статей — под текущее число активных модулей).
    let wbs: Item['wbs']
    if (it.wbs?.length) {
      const base = it.wbs.reduce((s, sec) => s + sec.items.reduce((x, l) => x + l.eur, 0), 0)
      const k = base > 0 ? eur / base : 1
      wbs = it.wbs.map((sec) => ({
        ...sec,
        total: sec.items.reduce((x, l) => x + l.eur, 0) * k,
        items: sec.items.map((l) => ({ ...l, eur: l.eur * k })),
      }))
    }
    return { name: it.name ?? '', eur, group: it.group, unit, qty, rate: rateEur, wbs, detail }
  })
  // Смета закупа: стартовые запасы расходников (initialQty) — отдельной группой
  // в CAPEX, правится на вкладке «Смета закупа».
  const stockEur = nomenclatureStockEur(items)
  if (stockEur > 0) {
    out.push({
      name: 'Закуп: стартовые запасы',
      eur: stockEur,
      group: 'Смета закупа',
      unit: 'справ.',
      detail: items
        .filter((x) => x.use !== 'CAPEX' && (x.initialQty ?? 0) > 0)
        .map((x) => ({
          code: x.code, name: x.name,
          qty: x.initialQty ?? 0, landed: landedCost(x), eur: landedCost(x) * (x.initialQty ?? 0),
          category: x.category, unit: x.unit,
        })),
    })
  }
  // IT / АСУ: внедрение кастомного слоя — разовые вложения в период стройки (уже в EUR)
  if (params.it.enabled) out.push(...params.it.capex.map((c) => ({ name: c.name, eur: c.eur, group: 'IT и автоматизация' })))
  // Земля (режим purchase): входит в CAPEX, но НЕ амортизируется — земля не изнашивается
  const landEur = params.land.mode === 'purchase' ? params.land.purchaseCost : 0
  if (landEur) out.push({ name: 'Земля / участок', eur: landEur, group: 'Земля' })
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
  // помодульного CAPEX (строки qty=MODULES_COUNT[:N]) в месяц ввода — сумму
  // ВСЕХ помодульных статей за единицу, а не только корпуса.
  // Амортизация упрощённо идёт с общей даты открытия — отмечено в аудите.
  const unitEur = params.capexItems.reduce((s, it) => {
    const n = perModuleUnits(it.qty)
    return n === null ? s : s + Number(it.priceEur ?? 0) * n
  }, 0)
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
