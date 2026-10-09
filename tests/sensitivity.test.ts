import { describe, expect, it } from 'vitest'
import { computeSensitivity } from '../src/model/sensitivity'
import { baselineMatrix, baselineParams, items, services } from './_baseline'

const params = baselineParams()
const matrix = baselineMatrix()

// Эталон — прогон ядра после номенклатурного реворка (спековый COGS,
// аренда 3×flat, CAPEX из ТЗ-2). Зафиксирован как baseline ядра; проверяются
// и абсолютные уровни, и направление/нелинейность кривых.
const ORACLE = {
  t1_d08_w14: 2110636, t1_d10_w14: 3396222, t1_d12_w14: 4587134,
  t2_g0_c30: 2390270, t2_g7_c30: 3812372, t3_p08: 1462239, t3_p12: 5329908,
}

describe('sensitivity: 100 точек реального пересчёта', () => {
  const s = computeSensitivity(params, matrix, items, services)

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

  it('таблица 4: пакет × загрузка — 100% пакета ≈ пакетный режим, меньше пакета → меньше NPV', () => {
    const pkg = s.t4.rows[4].cells[2].npv // uptake 1.0, loadMult 1.0
    expect(pkg).toBeGreaterThan(s.t4.rows[0].cells[2].npv)
    expect(s.t4.rows[0].cells[2].npv).toBeLessThan(s.t4.rows[0].cells[4].npv) // загрузка помогает
  })

  it('таблица 5: дороже рубль → дороже CAPEX → меньше NPV', () => {
    expect(s.t5.rows[0].cells[0].npv).toBeLessThan(s.t5.rows[4].cells[0].npv) // 80 ₽/€ хуже 120
    expect(s.t5.rows[2].cells[3].npv).toBeLessThan(s.t5.rows[2].cells[0].npv) // +30% буфер хуже 0
  })

  it('производительность: 100 точек < 8с', () => {
    expect(s.computedInMs).toBeLessThan(8000)
  })
})
