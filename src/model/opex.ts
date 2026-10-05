import type { NomenclatureItem, OpexMonth, Params, RevenueMonth } from './types'

// Landed cost: цена + MAX(доставка фикс, цена × доставка %) — Номенклатура!J
export function landedCost(item: NomenclatureItem): number {
  return item.price + Math.max(item.deliveryFix, item.price * item.deliveryPct)
}

// Постоянные + IT расходы месяца 0 (без инфляции) — для pre-opening burn в стройке
export function fixedOpexMonthly(params: Params): number {
  return (
    params.opexFixed.reduce(
      (s, f) => s + f.base * (f.perModule ? activeModuleCount(params) : 1),
      0,
    ) + (params.it.enabled ? params.it.opex.reduce((s, x) => s + x.base, 0) : 0)
  )
}

// Переменные расходы статьи = слоты × Σ(норма_слот) + гости × Σ(норма_гость) + Σ(норма_мес)
// Порт OPEX!C20:C29 (SUMPRODUCT по справочнику).
export function computeOpexMonth(
  params: Params,
  items: NomenclatureItem[],
  rev: RevenueMonth,
  k: number,
): OpexMonth {
  const infl = Math.pow(1 + params.general.inflation, Math.floor(k / 12))

  const fixed = params.opexFixed.map(
    (f) => f.base * (f.perModule ? activeModuleCount(params) : 1) * infl,
  )
  const fixedTotal = fixed.reduce((a, b) => a + b, 0)

  // IT / АСУ: подписки и инфраструктура с индексацией на инфляцию
  const it = params.it.enabled
    ? params.it.opex.map((x) => ({ name: x.name, amount: x.base * infl }))
    : []
  const itTotal = it.reduce((s, x) => s + x.amount, 0)

  const articles = [
    'Представительские', 'Веники', 'Дрова основные', 'Дрова для очага', 'Брикеты руф',
    'Средства гигиены', 'Косметика / SPA', 'Косметика / массаж', 'Инвентарь / уборка',
    'Прачечная / текстиль',
  ]
  // Позиция списывается в OPEX, если заданы статья и база нормы — независимо
  // от флага «Учёт» (кроме CAPEX): «Спецификация»-материал со статьёй и нормой
  // тоже считается расходником, иначе заполненные нормы молча игнорировались бы.
  const opexItems = items.filter(
    (it) => it.use !== 'CAPEX' && it.opexArticle != null && it.normBase != null,
  )
  const variable = articles.map((article) => {
    const rel = opexItems.filter((it) => it.opexArticle === article)
    const byBase = (base: string) =>
      rel
        .filter((it) => it.normBase === base)
        .reduce((s, it) => s + it.norm * landedCost(it), 0)
    const amount =
      (rev.slots * byBase('слот') + rev.guests * byBase('гость') + byBase('мес')) * infl
    return { article, amount }
  })
  const variableTotal = variable.reduce((s, v) => s + v.amount, 0)

  const acquiring = params.opexPct.acquiring * rev.total
  const maintenance = params.opexPct.maintenance * rev.total
  // Себестоимость F&B — % от выручки F&B (не от общей), продукты/расходники кухни
  const fbCost = params.fb.enabled ? params.fb.foodCostPct * rev.fb : 0
  // OTA-комиссия глэмпинга: доля ночей через Booking/Airbnb × ставка комиссии
  const ota = params.glampOta.enabled
    ? rev.glamping * params.glampOta.share * params.glampOta.commissionPct
    : 0
  // Аренда земли (режим lease): фиксированный платёж, индексируется инфляцией.
  // В период стройки аренда уходит в CF отдельно (cashflow.ts), здесь — только операционка.
  const landRent = params.land.mode === 'lease' ? params.land.rentMonthly * infl : 0
  return {
    fixed,
    fixedTotal,
    it,
    itTotal,
    landRent,
    variable,
    variableTotal,
    pct: { acquiring, maintenance, fbCost, ota },
    pctTotal: acquiring + maintenance + fbCost + ota,
    total: fixedTotal + itTotal + landRent + variableTotal + acquiring + maintenance + fbCost + ota,
  }
}

export function computeOpex(
  params: Params,
  items: NomenclatureItem[],
  revenue: RevenueMonth[],
): OpexMonth[] {
  return revenue.map((r, k) => computeOpexMonth(params, items, r, k))
}

export function activeModuleCount(params: Params): number {
  return params.modules.filter((m) => m.status === 'Активен').length
}

// Наполнение CAPEX из справочника: Σ landedCost × qty по позициям use='CAPEX' — CAPEX!G30/H30
export function nomenclatureCapexEur(items: NomenclatureItem[]): number {
  return items
    .filter((it) => it.use === 'CAPEX')
    .reduce((s, it) => s + landedCost(it) * it.qty, 0)
}
