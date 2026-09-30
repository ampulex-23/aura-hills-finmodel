import { describe, expect, it } from 'vitest'
import paramsJson from '../src/data/params.json'
import scenariosJson from '../src/data/scenarios.json'
import nomenclatureJson from '../src/data/nomenclature.json'
import type { NomenclatureItem, Params, ScenarioMatrix } from '../src/model/types'
import { computeSensitivity } from '../src/model/sensitivity'

const params = paramsJson as Params
params.it.enabled = false // IT/АСУ нет в оракуле — сверяем ядро 1:1
const matrix = scenariosJson as ScenarioMatrix
const items = nomenclatureJson as NomenclatureItem[]

// Оракул sens_run.py (57 точек, до перехода OPEX на номенклатуру → ожидаемый
// системный сдвиг ≈ −0.25%). Проверяем направление и порядок величин.
// Пересчитано после фикса привязки услуг к слотам текущего месяца (был C13-костыль).
const ORACLE = {
  t1_d08_w14: 5186479, t1_d10_w14: 7196339, t1_d12_w14: 9059840,
  t2_g0_c30: 6203438, t2_g7_c30: 7695381, t3_p08: 5019733, t3_p12: 9372944,
}

describe('sensitivity: 57 точек реального пересчёта', () => {
  const s = computeSensitivity(params, matrix, items)

  it('таблица 1: спрос × WACC', () => {
    const npv = (d: number, w: number) =>
      s.t1.rows[d].cells[w].npv
    expect(npv(0, 2)).toBeGreaterThan(ORACLE.t1_d08_w14 * 0.985)
    expect(npv(0, 2)).toBeLessThan(ORACLE.t1_d08_w14 * 1.005)
    expect(npv(2, 2)).toBeGreaterThan(ORACLE.t1_d10_w14 * 0.985)
    expect(npv(4, 2)).toBeGreaterThan(npv(0, 2)) // спрос +20% > спрос −20%
    // Кэп 100% загрузки: рост нелинейный
    expect(npv(4, 2) - npv(2, 2)).toBeLessThan(npv(2, 2) - npv(0, 2))
  })

  const near = (v: number, ref: number, tol = 0.01) => {
    expect(v).toBeGreaterThan(ref * (1 - tol))
    expect(v).toBeLessThan(ref * (1 + tol))
  }

  it('таблица 2: рост цен × CAPEX буфер', () => {
    near(s.t2.rows[0].cells[4].npv, ORACLE.t2_g0_c30)
    near(s.t2.rows[4].cells[4].npv, ORACLE.t2_g7_c30)
  })

  it('таблица 3: уровень цен', () => {
    near(s.t3[0].npv, ORACLE.t3_p08)
    near(s.t3[4].npv, ORACLE.t3_p12)
    // Почти линейная чувствительность
    expect(s.t3[4].npv / s.t3[0].npv).toBeGreaterThan(1.8)
  })

  it('производительность: 57 точек < 5с', () => {
    expect(s.computedInMs).toBeLessThan(5000)
  })
})
