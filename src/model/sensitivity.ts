import type { NomenclatureItem, Params, ScenarioMatrix, ServiceSpec } from './types'
import { resolveWacc, runModel } from './run'
import { resolveScenario } from './scenario'

// Sensitivity: настоящий пересчёт модели (не эвристика) — как sens_run.py по формулам.
// Таблица 1: спрос × WACC → NPV + диск.окупаемость (ось WACC центрирована на базовой)
// Таблица 2: рост цен × буфер CAPEX → NPV + IRR
// Таблица 3: уровень всех цен × → NPV + IRR
// Таблица 4: доля гостей с пакетом (uptake, непакетный режим) × загрузка → NPV
// Таблица 5: задержка стройки × буфер CAPEX → NPV

export interface SensPoint { npv: number; irr: number; discPayback: number }
export interface SensTable1Row { demand: number; cells: { wacc: number; npv: number; discPayback: number }[] }
export interface SensTable2Row { priceGrowth: number; cells: { capexAdj: number; npv: number; irr: number }[] }
export interface SensTable3Row { priceMult: number; npv: number; irr: number }
export interface SensTable4Row { uptake: number; cells: { loadMult: number; npv: number; irr: number }[] }
export interface SensTable5Row { delayMonths: number; cells: { capexAdj: number; npv: number; irr: number }[] }

export interface SensitivityResult {
  t1: { waccAxis: number[]; rows: SensTable1Row[] }
  t2: { capexAxis: number[]; rows: SensTable2Row[] }
  t3: SensTable3Row[]
  t4: { loadAxis: number[]; rows: SensTable4Row[] }
  t5: { capexAxis: number[]; rows: SensTable5Row[] }
  computedInMs: number
}

export const T1_DEMAND = [0.8, 0.9, 1.0, 1.1, 1.2]
/** Ось WACC: симметрично вокруг базовой ставки (центр = база — sanity-check таблицы) */
export const waccAxis = (base: number) => [-0.04, -0.02, 0, 0.03, 0.06].map((d) => Math.round((base + d) * 1000) / 1000)
export const T2_GROWTH = [0, 0.02, 0.03, 0.05, 0.07]
export const T2_CAPEX = [0, 0.1, 0.15, 0.2, 0.3]
export const T3_PRICE = [0.8, 0.9, 1.0, 1.1, 1.2]
export const T4_UPTAKE = [0.3, 0.5, 0.7, 0.85, 1.0]
export const T4_LOAD = [0.8, 0.9, 1.0, 1.1, 1.2]
export const T5_DELAY = [0, 3, 6, 9, 12]
export const T5_CAPEX = [0, 0.1, 0.2, 0.3]

export function computeSensitivity(
  params: Params,
  matrix: ScenarioMatrix,
  items: NomenclatureItem[],
  services: ServiceSpec[],
): SensitivityResult {
  const t0 = performance.now()
  const scenario = params.meta.scenario
  const T1_WACC = waccAxis(resolveWacc(params))

  const t1: SensTable1Row[] = T1_DEMAND.map((demand) => ({
    demand,
    cells: T1_WACC.map((wacc) => {
      const r = runModel(params, matrix, items, services, scenario, { demandMult: demand, wacc })
      return { wacc, npv: r.kpis.npv, discPayback: r.kpis.discountedPaybackMonths }
    }),
  }))

  const t2: SensTable2Row[] = T2_GROWTH.map((priceGrowth) => ({
    priceGrowth,
    cells: T2_CAPEX.map((capexAdj) => {
      const r = runModel(params, matrix, items, services, scenario, { priceGrowth, capexAdj })
      return { capexAdj, npv: r.kpis.npv, irr: r.kpis.irrAnnual }
    }),
  }))

  const t3: SensTable3Row[] = T3_PRICE.map((priceMult) => {
    const r = runModel(params, matrix, items, services, scenario, { priceMult })
    return { priceMult, npv: r.kpis.npv, irr: r.kpis.irrAnnual }
  })

  // T4: пакет как ключевой коммерческий риск (аудит 14, W-9). uptake=1.0 ≡ пакетный режим.
  const t4: SensTable4Row[] = T4_UPTAKE.map((uptake) => ({
    uptake,
    cells: T4_LOAD.map((loadMult) => {
      const r = runModel(params, matrix, items, services, scenario, { mode: 'Нет', uptake, loadMult })
      return { loadMult, npv: r.kpis.npv, irr: r.kpis.irrAnnual }
    }),
  }))

  // T5: задержка стройки (месяцы к constructionStart→opening) × буфер CAPEX
  const t5: SensTable5Row[] = T5_DELAY.map((delayMonths) => ({
    delayMonths,
    cells: T5_CAPEX.map((capexAdj) => {
      const r = runModel(params, matrix, items, services, scenario, {
        capexAdj,
        mutate: (p) => {
          p.meta.capexMonths += delayMonths
          const [y, m] = p.meta.openingDate.slice(0, 7).split('-').map(Number)
          const t = y * 12 + (m - 1) + delayMonths
          p.meta.openingDate = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`
        },
      })
      return { capexAdj, npv: r.kpis.npv, irr: r.kpis.irrAnnual }
    }),
  }))

  return {
    t1: { waccAxis: T1_WACC, rows: t1 },
    t2: { capexAxis: T2_CAPEX, rows: t2 },
    t3,
    t4: { loadAxis: T4_LOAD, rows: t4 },
    t5: { capexAxis: T5_CAPEX, rows: t5 },
    computedInMs: performance.now() - t0,
  }
}

// ── Break-even по загрузке ────────────────────────────────────────────────
// Бинарный поиск общего множителя спроса (loadMult масштабирует все векторы
// загрузки и членства), при котором средняя EBITDA устаканенного 3-го года = 0.
// Ответ — доля от плановой загрузки сценария (например 0.58 → «58% от плана»).
export interface BreakEvenResult {
  /** Доля планового спроса, при которой EBITDA года 3 = 0 (NaN — уже убыточно) */
  loadMult: number
  /** Среднемесячная EBITDA года 3 при плановом спросе */
  ebitdaBase: number
}

export function computeBreakEven(
  params: Params,
  matrix: ScenarioMatrix,
  items: NomenclatureItem[],
  services: ServiceSpec[],
): BreakEvenResult {
  const scenario = params.meta.scenario
  const ebitdaY3 = (mult: number) => {
    const r = runModel(params, matrix, items, services, scenario, { loadMult: mult })
    return r.pnl.slice(24, 36).reduce((s, p) => s + p.ebitda, 0) / 12
  }
  const ebitdaBase = ebitdaY3(1)
  if (ebitdaBase <= 0 || ebitdaY3(0) >= 0) return { loadMult: NaN, ebitdaBase }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (ebitdaY3(mid) > 0) hi = mid
    else lo = mid
  }
  return { loadMult: hi, ebitdaBase }
}

// ── Tornado: однофакторный пересчёт топ-драйверов NPV ─────────────────────
export interface TornadoBar {
  label: string
  loLabel: string
  hiLabel: string
  npvLo: number // NPV в пессимистичной точке
  npvHi: number // NPV в оптимистичной точке
}

export function computeTornado(
  params: Params,
  matrix: ScenarioMatrix,
  items: NomenclatureItem[],
  services: ServiceSpec[],
  baseNpv: number,
): TornadoBar[] {
  const scenario = params.meta.scenario
  const baseCapexAdj = resolveScenario(params, matrix, scenario).capexAdj
  const baseWacc = resolveWacc(params)

  type Ov = Parameters<typeof runModel>[5]
  const drivers: { label: string; loLabel: string; hiLabel: string; lo: Ov; hi: Ov }[] = [
    { label: 'Спрос', loLabel: '−15%', hiLabel: '+15%', lo: { demandMult: 0.85 }, hi: { demandMult: 1.15 } },
    { label: 'Уровень цен', loLabel: '−10%', hiLabel: '+10%', lo: { priceMult: 0.9 }, hi: { priceMult: 1.1 } },
    { label: 'Загрузка слотов', loLabel: '−15%', hiLabel: '+15%', lo: { loadMult: 0.85 }, hi: { loadMult: 1.15 } },
    { label: 'CAPEX', loLabel: '+15%', hiLabel: 'без буфера', lo: { capexAdj: baseCapexAdj + 0.15 }, hi: { capexAdj: 0 } },
    { label: 'WACC', loLabel: `+3п.п.`, hiLabel: '−3п.п.', lo: { wacc: baseWacc + 0.03 }, hi: { wacc: Math.max(0.01, baseWacc - 0.03) } },
    {
      label: 'Uptime модулей', loLabel: '−5п.п.', hiLabel: '+3п.п.',
      lo: { mutate: (p) => p.modules.forEach((m) => { m.uptime = Math.max(0.5, m.uptime - 0.05) }) },
      hi: { mutate: (p) => p.modules.forEach((m) => { m.uptime = Math.min(1, m.uptime + 0.03) }) },
    },
    {
      label: 'Постоянные OPEX', loLabel: '+15%', hiLabel: '−15%',
      lo: { mutate: (p) => p.opexFixed.forEach((f) => { f.base *= 1.15 }) },
      hi: { mutate: (p) => p.opexFixed.forEach((f) => { f.base *= 0.85 }) },
    },
    {
      label: 'Оклады штата', loLabel: '+15%', hiLabel: '−15%',
      lo: { mutate: (p) => { p.fot.salary = p.fot.salary.map((s) => s * 1.15) } },
      hi: { mutate: (p) => { p.fot.salary = p.fot.salary.map((s) => s * 0.85) } },
    },
    {
      label: 'Себестоимость F&B', loLabel: '+5п.п.', hiLabel: '−5п.п.',
      lo: { mutate: (p) => { p.fb.foodCostPct += 0.05 } },
      hi: { mutate: (p) => { p.fb.foodCostPct = Math.max(0, p.fb.foodCostPct - 0.05) } },
    },
    {
      label: 'Доля OTA (глэмпинг)', loLabel: '+15п.п.', hiLabel: '0% (прямые)',
      lo: { mutate: (p) => { p.glampOta.share = Math.min(1, p.glampOta.share + 0.15) } },
      hi: { mutate: (p) => { p.glampOta.share = 0 } },
    },
    {
      label: 'Инфляция', loLabel: '+1п.п.', hiLabel: '−1п.п.',
      lo: { mutate: (p) => { p.general.inflation += 0.01 } },
      hi: { mutate: (p) => { p.general.inflation = Math.max(0, p.general.inflation - 0.01) } },
    },
  ]

  return drivers
    .map((d) => ({
      label: d.label,
      loLabel: d.loLabel,
      hiLabel: d.hiLabel,
      npvLo: runModel(params, matrix, items, services, scenario, d.lo).kpis.npv,
      npvHi: runModel(params, matrix, items, services, scenario, d.hi).kpis.npv,
    }))
    .sort(
      (a, b) =>
        Math.max(Math.abs(b.npvHi - baseNpv), Math.abs(b.npvLo - baseNpv)) -
        Math.max(Math.abs(a.npvHi - baseNpv), Math.abs(a.npvLo - baseNpv)),
    )
}
