import type { NomenclatureItem, Params, ScenarioMatrix } from './types'
import { runModel } from './run'

// Sensitivity: настоящий пересчёт модели (не эвристика) — как sens_run.py по формулам.
// Таблица 1: спрос × WACC → NPV + диск.окупаемость
// Таблица 2: рост цен × буфер CAPEX → NPV + IRR
// Таблица 3: уровень всех цен × → NPV + IRR

export interface SensPoint { npv: number; irr: number; discPayback: number }
export interface SensTable1Row { demand: number; cells: { wacc: number; npv: number; discPayback: number }[] }
export interface SensTable2Row { priceGrowth: number; cells: { capexAdj: number; npv: number; irr: number }[] }
export interface SensTable3Row { priceMult: number; npv: number; irr: number }

export interface SensitivityResult {
  t1: { waccAxis: number[]; rows: SensTable1Row[] }
  t2: { capexAxis: number[]; rows: SensTable2Row[] }
  t3: SensTable3Row[]
  computedInMs: number
}

export const T1_DEMAND = [0.8, 0.9, 1.0, 1.1, 1.2]
export const T1_WACC = [0.1, 0.12, 0.14, 0.17, 0.2]
export const T2_GROWTH = [0, 0.02, 0.03, 0.05, 0.07]
export const T2_CAPEX = [0, 0.1, 0.15, 0.2, 0.3]
export const T3_PRICE = [0.8, 0.9, 1.0, 1.1, 1.2]

export function computeSensitivity(
  params: Params,
  matrix: ScenarioMatrix,
  items: NomenclatureItem[],
): SensitivityResult {
  const t0 = performance.now()
  const scenario = params.meta.scenario

  const t1: SensTable1Row[] = T1_DEMAND.map((demand) => ({
    demand,
    cells: T1_WACC.map((wacc) => {
      const r = runModel(params, matrix, items, scenario, { demandMult: demand, wacc })
      return { wacc, npv: r.kpis.npv, discPayback: r.kpis.discountedPaybackMonths }
    }),
  }))

  const t2: SensTable2Row[] = T2_GROWTH.map((priceGrowth) => ({
    priceGrowth,
    cells: T2_CAPEX.map((capexAdj) => {
      const r = runModel(params, matrix, items, scenario, { priceGrowth, capexAdj })
      return { capexAdj, npv: r.kpis.npv, irr: r.kpis.irrAnnual }
    }),
  }))

  const t3: SensTable3Row[] = T3_PRICE.map((priceMult) => {
    const r = runModel(params, matrix, items, scenario, { priceMult })
    return { priceMult, npv: r.kpis.npv, irr: r.kpis.irrAnnual }
  })

  return {
    t1: { waccAxis: T1_WACC, rows: t1 },
    t2: { capexAxis: T2_CAPEX, rows: t2 },
    t3,
    computedInMs: performance.now() - t0,
  }
}
