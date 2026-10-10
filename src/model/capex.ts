import type { CapexItem, NomenclatureItem, Params, WbsSection } from './types'
import { landedCost, nomenclatureEquipEur, nomenclatureStockEur } from './opex'

// CAPEX: qty × цена EUR = EUR; строка «Наполнение» = справочник; итог × (1+capexAdj)
// qty 'MODULES_COUNT[:N]' → N единиц на каждый активный модуль СВОЕЙ очереди
// (очередь строки = it.phase ?? 1): помодульные строки очереди 1 считают
// активные модули очереди 1 и не раздуваются от включения VIP очереди 2.
function perModuleUnits(qty: CapexItem['qty']): number | null {
  const m = /^MODULES_COUNT(?::(\d+))?$/.exec(String(qty))
  return m ? Number(m[1] ?? 1) : null
}

const ym = (iso: string) => {
  const [y, m] = iso.slice(0, 7).split('-').map(Number)
  return y * 12 + m
}

export function computeCapex(
  params: Params,
  items: NomenclatureItem[],
  capexAdj: number,
): {
  items: { name: string; eur: number; group?: string; phase?: 1 | 2; object?: string }[]
  totalEur: number
  adjustedEur: number
  phase2Eur: number
  phase2AdjEur: number
  monthlyAmort: number
  amortizableEur: number
  monthlyTaxDepr: number
  amortMonthly: number[]
  taxDeprMonthly: number[]
  deferred: { month: number; eur: number }[]
  deferredPhase1Total: number
  phase2Outflow: { month: number; eur: number }[]
} {
  type Item = {
    name: string
    eur: number
    group?: string
    phase?: 1 | 2
    object?: string
    unit?: string
    qty?: number
    rate?: number
    wbs?: (WbsSection & { total: number })[]
    detail?: { code: string; name: string; qty: number; landed: number; eur: number; category?: string; unit?: string }[]
  }

  const isActive = (m: Params['modules'][0]) => m.status === 'Активен'
  const mods1 = params.modules.filter((m) => (m.phase ?? 1) === 1)
  const mods2 = params.modules
    .filter((m) => (m.phase ?? 1) === 2)
    .sort((a, b) => a.id - b.id)
  const activeMods1 = mods1.filter(isActive)

  // Объект очереди 2 → включён ли: 'public' = publicBath.enabled,
  // 'vip1'..'vip4' = N-й модуль phase=2 с status 'Активен'.
  const objectEnabled = (object?: string): boolean => {
    if (!object) return true
    if (object === 'public') return !!params.publicBath?.enabled
    const m = /^vip(\d+)$/.exec(object)
    if (m) {
      const mod = mods2[+m[1] - 1]
      return !!mod && isActive(mod)
    }
    return true
  }
  const anyP2 = !!params.publicBath?.enabled || mods2.some(isActive)

  // Активных модулей для qty=MODULES_COUNT — своей очереди
  const activeCount = (phase: 1 | 2) =>
    (phase === 2 ? mods2 : mods1).filter(isActive).length

  const mapItem = (it: Params['capexItems'][0], phase: 1 | 2): Item => {
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
      // 'MODULES_COUNT' = 1 ед. на активный модуль очереди строки; ':N' = N на модуль.
      // У строк с WBS цена выводится из детализации: ΣWBS / wbsQty.
      const perModule = perModuleUnits(it.qty)
      const wbsSum = it.wbs?.length
        ? it.wbs.reduce((s, sec) => s + sec.items.reduce((x, l) => x + l.eur, 0), 0)
        : null
      const unitEur = wbsSum !== null ? wbsSum / (it.wbsQty ?? 1) : Number(it.priceEur ?? 0)
      qty = perModule !== null ? perModule * activeCount(phase) : Number(it.qty ?? 0)
      rateEur = unitEur
      eur = qty * unitEur
      if (perModule !== null) {
        detail = (phase === 2 ? mods2 : mods1)
          .filter(isActive)
          .map((m) => ({
            code: `Модуль #${m.id}`, name: `запуск ${m.launchDate.slice(0, 7)}`,
            qty: perModule, landed: unitEur, eur: unitEur * perModule, unit: 'шт',
          }))
      }
    }
    // WBS-детализация хранится в EUR на эталонный объём; масштабируем до суммы строки.
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
    return { name: it.name ?? '', eur, group: it.group, phase, object: it.object, unit, qty, rate: rateEur, wbs, detail }
  }

  // Условные строки (своя прачечная) — только при включённом режиме.
  const visible = params.capexItems.filter((it) => !it.ifLaundry || params.laundry?.enabled)
  const out: Item[] = visible
    .filter((it) => (it.phase ?? 1) === 1)
    .map((it) => mapItem(it, 1))
  // Очередь 2: объектные строки — только при включённом объекте; общие
  // (без object) — если включён хотя бы один объект очереди 2.
  const p2Items = anyP2
    ? visible.filter((it) => it.phase === 2 && objectEnabled(it.object)).map((it) => mapItem(it, 2))
    : []
  out.push(...p2Items)

  // Смета закупа: стартовые запасы расходников (initialQty) — отдельной группой.
  const stockEur = nomenclatureStockEur(items)
  if (stockEur > 0) {
    out.push({
      name: 'Закуп: стартовые запасы',
      eur: stockEur,
      group: 'Смета закупа',
      phase: 1,
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
  // Закуп под очередь 2 (initialQtyP2) — общая строка, если есть включённые объекты.
  const stock2Eur = anyP2
    ? items.reduce((s, x) => s + landedCost(x) * (x.initialQtyP2 ?? 0), 0)
    : 0
  if (stock2Eur > 0) {
    out.push({
      name: 'Закуп: стартовые запасы очереди 2',
      eur: stock2Eur,
      group: 'Смета закупа Оч.2',
      phase: 2,
      unit: 'справ.',
      detail: items
        .filter((x) => (x.initialQtyP2 ?? 0) > 0)
        .map((x) => ({
          code: x.code, name: x.name,
          qty: x.initialQtyP2 ?? 0, landed: landedCost(x), eur: landedCost(x) * (x.initialQtyP2 ?? 0),
          category: x.category, unit: x.unit,
        })),
    })
  }
  // IT / АСУ: внедрение кастомного слоя — разовые вложения в период стройки (уже в EUR)
  if (params.it.enabled) out.push(...params.it.capex.map((c) => ({ name: c.name, eur: c.eur, group: 'IT и автоматизация' as const, phase: 1 as const })))
  // Земля (режим purchase): входит в CAPEX, но НЕ амортизируется — земля не изнашивается
  const landEur = params.land.mode === 'purchase' ? params.land.purchaseCost : 0
  if (landEur) out.push({ name: 'Земля / участок', eur: landEur, group: 'Земля', phase: 1 })

  // Итоги очереди 1 (сущ. поведение) и очереди 2 (свой буфер phase2.capexAdj)
  const totalEur = out.filter((i) => (i.phase ?? 1) === 1).reduce((s, i) => s + i.eur, 0)
  const adjustedEur = totalEur * (1 + capexAdj)
  const phase2Eur = p2Items.reduce((s, i) => s + i.eur, 0) + stock2Eur
  const adj2 = params.phase2?.capexAdj ?? 0
  const phase2AdjEur = phase2Eur * (1 + adj2)

  const amortizableEur = adjustedEur - landEur * (1 + capexAdj)
  const amortRate =
    params.amort.shares.reduce((s, sh, i) => s + sh / (params.amort.years[i] * 12), 0)
  const monthlyAmort = amortizableEur * amortRate
  // Налоговая амортизация (capital allowances): те же доли активов, другие сроки —
  // конструкции 25 лет (~4%/год), оборудование 7 лет (~14%), прочее/IT 5 лет (20%).
  const taxDeprRate = params.amort.shares.reduce((s, sh, i) => s + sh / (params.taxDepr.years[i] * 12), 0)
  const monthlyTaxDepr = params.taxDepr.enabled ? amortizableEur * taxDeprRate : monthlyAmort

  const openYm = ym(params.meta.openingDate)
  const constrYm = ym(params.meta.constructionStart)
  const toCfMonth = (iso: string) => ym(iso) - constrYm + 1 // 1-based месяц CF
  const toOpsIdx = (iso: string) => ym(iso) - openYm // операционный месяц (0-based)

  // Real option: активный модуль ОЧЕРЕДИ 1 с запуском после открытия платит свою
  // долю помодульного CAPEX (строки qty=MODULES_COUNT[:N] очереди 1) в месяц ввода.
  const unitEur = visible
    .filter((it) => (it.phase ?? 1) === 1)
    .reduce((s, it) => {
      const n = perModuleUnits(it.qty)
      return n === null ? s : s + Number(it.priceEur ?? 0) * n
    }, 0)
  const deferredP1 = activeMods1
    .filter((m) => ym(m.launchDate) > openYm)
    .map((m) => ({ month: toCfMonth(m.launchDate), eur: unitEur * (1 + capexAdj) }))
  const deferredPhase1Total = deferredP1.reduce((s, d) => s + d.eur, 0)

  // Очередь 2: отток CAPEX растянут по месяцам окна стройки (2029–2030):
  // профиль — phase2.sCurve или равномерный.
  const phase2Outflow: { month: number; eur: number }[] = []
  const p2 = params.phase2
  if (p2 && phase2AdjEur > 0) {
    const months = Math.max(1, Math.round(p2.months))
    const w = p2.sCurve?.length ? p2.sCurve.slice(0, months) : new Array(months).fill(1)
    const wSum = w.reduce((s, x) => s + x, 0) || 1
    const startMonth = toCfMonth(p2.constructionStart)
    for (let i = 0; i < months; i++) {
      phase2Outflow.push({ month: startMonth + i, eur: (phase2AdjEur * w[i]) / wSum })
    }
  }
  const deferred = [...deferredP1, ...phase2Outflow]

  // Амортизация по датам ввода: очередь 1 — с открытия; очередь 2 — по объектам
  // с их launchDate (объектный CAPEX + общие строки от первого введённого объекта).
  const opsN = params.meta.opsMonths
  const amortMonthly = new Array<number>(opsN).fill(monthlyAmort)
  const taxDeprMonthly = new Array<number>(opsN).fill(monthlyTaxDepr)
  const p2TaxRate = params.taxDepr.enabled ? taxDeprRate : amortRate
  if (anyP2 && phase2Eur > 0) {
    const objEur = new Map<string, number>()
    let sharedEur = stock2Eur
    for (const i of p2Items) {
      if (i.object) objEur.set(i.object, (objEur.get(i.object) ?? 0) + i.eur)
      else sharedEur += i.eur
    }
    const objLaunchOps = (object: string): number => {
      if (object === 'public') return toOpsIdx(params.publicBath?.launchDate ?? '2031-01')
      const m = /^vip(\d+)$/.exec(object)
      const mod = m ? mods2[+m[1] - 1] : undefined
      return mod ? toOpsIdx(mod.launchDate) : 0
    }
    const buckets: { opsStart: number; eur: number }[] = []
    let minLaunch = Infinity
    for (const [obj, eur] of objEur) {
      const l = objLaunchOps(obj)
      buckets.push({ opsStart: l, eur })
      if (l < minLaunch) minLaunch = l
    }
    if (sharedEur > 0 && minLaunch < Infinity) buckets.push({ opsStart: minLaunch, eur: sharedEur })
    for (const b of buckets) {
      const amortM = (b.eur * (1 + adj2) * amortRate)
      const taxM = (b.eur * (1 + adj2) * p2TaxRate)
      for (let k = Math.max(0, b.opsStart); k < opsN; k++) {
        amortMonthly[k] += amortM
        taxDeprMonthly[k] += taxM
      }
    }
  }

  return {
    items: out, totalEur, adjustedEur,
    phase2Eur, phase2AdjEur,
    monthlyAmort, amortizableEur, monthlyTaxDepr,
    amortMonthly, taxDeprMonthly,
    deferred, deferredPhase1Total, phase2Outflow,
  }
}
