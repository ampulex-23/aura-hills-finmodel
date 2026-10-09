import type { NomenclatureItem, OpexMonth, Params, RevenueMonth, ServiceSpec } from './types'
import { dirCounts } from './revenue'

// Landed cost: цена + MAX(доставка фикс, цена × доставка %) — Номенклатура!J
export function landedCost(item: NomenclatureItem): number {
  return item.price + Math.max(item.deliveryFix, item.price * item.deliveryPct)
}

// Постоянные + IT расходы месяца 0 (без инфляции) — для pre-opening burn в стройке
export function fixedOpexMonthly(params: Params): number {
  return (
    params.opexFixed.reduce(
      (s, f) => s + f.base * (f.perModule ? activeModuleCountAt(params, 0) : 1),
      0,
    ) + (params.it.enabled ? params.it.opex.reduce((s, x) => s + x.base, 0) : 0)
  )
}

// Переменные расходы месяца = нормативные статьи (слоты/гости/мес)
// + спековое списание: материалы из спецификаций списываются по числу
// проведённых услуг (та же база counts, что и KPI-труд). Позиция, входящая
// в любую спецификацию, по норме не списывается — защита от двойного счёта
// (модель заказчика: «норма 0 у позиций, ушедших в COGS спеки»).
export function computeOpexMonth(
  params: Params,
  items: NomenclatureItem[],
  rev: RevenueMonth,
  services: ServiceSpec[],
  k: number,
): OpexMonth {
  const infl = Math.pow(1 + params.general.inflation, Math.floor(k / 12))

  // Помодульные статьи берут только модули, уже запущенные к этому месяцу —
  // статус «Активен» с launchDate в будущем не должен тратить деньги заранее.
  const modulesNow = activeModuleCountAt(params, k)
  // Статья с pctOfRevenue (маркетинг) — не меньше базы, но масштабируется с
  // выручкой (аудит 14, W-14: фикс €5k превращался в 1.5% выручки к году 3).
  const fixed = params.opexFixed.map((f) => {
    const base = f.base * (f.perModule ? modulesNow : 1) * infl
    return f.pctOfRevenue ? Math.max(base, f.pctOfRevenue * rev.total) : base
  })
  const fixedTotal = fixed.reduce((a, b) => a + b, 0)

  // IT / АСУ: подписки и инфраструктура с индексацией на инфляцию
  const it = params.it.enabled
    ? params.it.opex.map((x) => ({ name: x.name, amount: x.base * infl }))
    : []
  const itTotal = it.reduce((s, x) => s + x.amount, 0)

  // Коды, ушедшие в спецификации, исключаются из норм ВСЕГДА — даже в месяцы
  // с нулевым count, иначе норма «оживала» бы на месяц без продаж услуги.
  const specCodes = new Set(
    services.flatMap((s) =>
      s.items.filter((i) => i.kind === 'material' && i.code).map((i) => i.code!),
    ),
  )

  // Спековое потребление материалов за месяц: Σ по услугам count × qty.
  const specQty = new Map<string, number>()
  const dirOrder = [...new Set(services.map((s) => s.direction))]
  for (const dir of dirOrder) {
    const dirSpecs = services.filter((s) => s.direction === dir)
    const counts = dirCounts(rev, dir, dirSpecs, params)
    dirSpecs.forEach((s, idx) => {
      const cnt = counts[idx] ?? 0
      if (cnt <= 0) return
      for (const it of s.items) {
        if (it.kind === 'material' && it.code && (it.qty ?? 0) > 0)
          specQty.set(it.code, (specQty.get(it.code) ?? 0) + cnt * it.qty!)
      }
    })
  }
  const byCode = new Map(items.map((i) => [i.code, i]))

  // Нормативные позиции: статья+база заданы И код не списывается спеками.
  const opexItems = items.filter(
    (it) =>
      it.use !== 'CAPEX' &&
      it.opexArticle != null &&
      it.normBase != null &&
      !specCodes.has(it.code),
  )
  // Статьи — динамически из данных: в UI статья вводится свободным текстом,
  // жёсткий список молча выкидывал бы пользовательские статьи из OPEX.
  // Спековое списание группируется по opexArticle позиции, иначе по категории.
  const specRows = [...specQty.entries()].map(([code, qty]) => {
    const m = byCode.get(code)
    const article = m?.opexArticle ?? m?.category ?? 'Материалы услуг'
    return { article, amount: qty * (m ? landedCost(m) : 0) }
  })
  const articles = [
    ...new Set([
      ...opexItems.map((it) => it.opexArticle!),
      ...specRows.map((r) => r.article),
    ]),
  ]
  const variable = articles.map((article) => {
    const rel = opexItems.filter((it) => it.opexArticle === article)
    const byBase = (base: string) =>
      rel
        .filter((it) => it.normBase === base)
        .reduce((s, it) => s + it.norm * landedCost(it), 0)
    const amount =
      (rev.slots * byBase('слот') +
        rev.guests * byBase('гость') +
        byBase('мес') +
        specRows
          .filter((r) => r.article === article)
          .reduce((s, r) => s + r.amount, 0)) *
      infl
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
  services: ServiceSpec[],
): OpexMonth[] {
  return revenue.map((r, k) => computeOpexMonth(params, items, r, services, k))
}

export function activeModuleCount(params: Params): number {
  return params.modules.filter((m) => m.status === 'Активен').length
}

// Модули, запущенные к операционному месяцу k (launchDate ≤ opening + k).
const ymIndex = (iso: string) => {
  const [y, m] = iso.slice(0, 7).split('-').map(Number)
  return y * 12 + m
}
export function activeModuleCountAt(params: Params, k: number): number {
  const now = ymIndex(params.meta.openingDate) + k
  return params.modules.filter(
    (m) => m.status === 'Активен' && ymIndex(m.launchDate) <= now,
  ).length
}

// Наполнение CAPEX из справочника: Σ landedCost × qty по позициям use='CAPEX'
// плюс начальные запасы (initialQty × landed) у не-CAPEX позиций — халаты,
// полотенца и т.п. закупаются на открытие, а потом пополняются нормой OPEX.
// У CAPEX-позиций «Кол-во» само является закупкой на открытие — initialQty
// там не используется, чтобы не было скрытого второго счётчика.
export function nomenclatureCapexEur(items: NomenclatureItem[]): number {
  return items.reduce(
    (s, it) =>
      s + landedCost(it) * (it.use === 'CAPEX' ? it.qty : (it.initialQty ?? 0)),
    0,
  )
}
