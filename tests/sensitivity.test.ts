import { describe, expect, it } from 'vitest'
import paramsJson from '../src/data/params.json'
import scenariosJson from '../src/data/scenarios.json'
import nomenclatureJson from '../src/data/nomenclature.json'
import type { NomenclatureItem, Params, ScenarioMatrix } from '../src/model/types'
import { computeSensitivity } from '../src/model/sensitivity'

const params = paramsJson as Params
params.it.enabled = false // IT/АСУ нет в оракуле — сверяем ядро 1:1
params.units.presaleMode = 'incremental' // deferred-пресейл вне оракула (см. golden.test)
params.fb.enabled = false // F&B-слой вне оракула
params.preopen.enabled = false // pre-opening вне оракула
params.members.consumeSlots = false // ёмкость членов вне оракула
params.taxes.gesy = 0 // GESY вне оракула
params.taxDepr.enabled = false // налоговый график CIT вне оракула
params.glampOta.enabled = false // OTA-комиссия вне оракула
const matrix = scenariosJson as ScenarioMatrix
const items = nomenclatureJson as NomenclatureItem[]

// Оракул sens_run.py (57 точек, до перехода OPEX на номенклатуру → ожидаемый
// системный сдвиг ≈ −0.25%). Проверяем направление и порядок величин.
// Пересчитано после фикса привязки услуг к слотам текущего месяца (был C13-костыль).
const ORACLE = {
  t1_d08_w14: 4182495, t1_d10_w14: 5946522, t1_d12_w14: 7573750,
  t2_g0_c30: 4988922, t2_g7_c30: 6395268, t3_p08: 4033807, t3_p12: 7859236,
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
