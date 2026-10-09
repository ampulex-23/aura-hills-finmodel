import { describe, expect, it } from 'vitest'
import { runModel } from '../src/model/run'
import { baselineMatrix, baselineParams, items, services } from './_baseline'

// Слои сверх Excel-оракула (IT, F&B, pre-opening, члены, GESY, CAPM, maintenance
// CAPEX, квартальный НДС и т.д.) выключены в tests/_baseline.ts — golden
// сверяет ядро расчёта.
const params = baselineParams()
const matrix = baselineMatrix()

// Эталон — прогон ядра после номенклатурного реворка (Блоки 1–7, спеки услуг
// несут материальный COGS, аренда = 3 бани × flat-цена 250/500/750, пармастер
// 3% гарантированно со слота, процедуры 30%, CAPEX из ТЗ-2 с нач. запасами).
// Excel-оракул к этой экономике неприменим: константы зафиксированы как
// golden-baseline ядра — ловят регрессии при дальнейших правках.
// Исторические отклонения от книги: авансы CIT июль/декабрь (Кипр),
// KPI по спецификациям вместо глобального пула.
const ORACLE = {
  Conservative: { npv: 1564559, irr: 0.3958, payback: 42, discPayback: 49, peak: -1908852 },
  Base: { npv: 3396222, irr: 0.7188, payback: 33, discPayback: 37, peak: -1566516 },
  Aggressive: { npv: 5516782, irr: 1.0447, payback: 27, discPayback: 28, peak: -1517835 },
}

describe('golden-master: TS-ядро vs formulas-оракул', () => {
  for (const name of matrix.names) {
    it(`сценарий ${name}`, () => {
      const r = runModel(params, matrix, items, services, name)
      const exp = ORACLE[name as keyof typeof ORACLE]
      expect(r.kpis.npv).toBeGreaterThan(exp.npv - 2000)
      expect(r.kpis.npv).toBeLessThan(exp.npv + 2000)
      expect(r.kpis.irrAnnual).toBeCloseTo(exp.irr, 2)
      expect(r.kpis.paybackMonths).toBe(exp.payback)
      expect(r.kpis.discountedPaybackMonths).toBe(exp.discPayback)
      expect(Math.abs(r.kpis.peakFundingNeed - exp.peak)).toBeLessThan(100)
    })
  }

  it('структура: 72 месяца CF, 60 месяцев выручки', () => {
    const r = runModel(params, matrix, items, services, 'Base')
    expect(r.cashflow).toHaveLength(72)
    expect(r.revenue).toHaveLength(60)
    expect(r.revenue[0].steam).toHaveLength(4)
    expect(r.cashflow.every((m) => isFinite(m.fcff))).toBe(true)
  })

  it('режим «С возмещением» снижает НДС к уплате', () => {
    const gross = runModel(params, matrix, items, services, 'Base')
    const reimb = runModel(params, matrix, items, services, 'Base', { vatMode: 'С возмещением' })
    const vatG = gross.taxes.reduce((s, t) => s + t.vatPayable, 0)
    const vatR = reimb.taxes.reduce((s, t) => s + t.vatPayable, 0)
    expect(vatR).toBeLessThan(vatG - 200000) // экономия ~€284k по модели
  })

  it('непакетный режим: uptake < 100% снижает выручку от услуг', () => {
    const pkg = runModel(params, matrix, items, services, 'Base')
    const nopkg = runModel(params, matrix, items, services, 'Base', { mode: 'Нет' })
    expect(nopkg.revenue[0].steamTotal).toBeCloseTo(pkg.revenue[0].steamTotal * 0.3, 0)
  })
})
