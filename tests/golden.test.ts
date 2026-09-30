import { describe, expect, it } from 'vitest'
import paramsJson from '../src/data/params.json'
import scenariosJson from '../src/data/scenarios.json'
import nomenclatureJson from '../src/data/nomenclature.json'
import type { NomenclatureItem, Params, ScenarioMatrix } from '../src/model/types'
import { runModel } from '../src/model/run'

const params = paramsJson as Params
// IT/АСУ-блок — новый слой модели, его нет в Excel-оракуле: выключаем,
// чтобы golden-master продолжал сверять порт ядра 1:1.
params.it.enabled = false
const matrix = scenariosJson as ScenarioMatrix
const items = nomenclatureJson as NomenclatureItem[]

// Оракул: formulas-движок на AURA_HILLS_MODEL.xlsx (пакетный режим, НДС=Гросс,
// после перевода OPEX на номенклатуру И фикса привязки услуг к текущему месяцу).
// NPV/IRR/payback — из прогона, расхождение ядра < 0.01% — остаток float-шум оракула.
const ORACLE = {
  Conservative: { npv: 4607483, irr: 0.9638, payback: 27, discPayback: 29, peak: -1597957 },
  Base: { npv: 7196339, irr: 1.5930, payback: 22, discPayback: 22, peak: -1364680 },
  Aggressive: { npv: 9972774, irr: 2.1306, payback: 19, discPayback: 19, peak: -1346680 },
}

describe('golden-master: TS-ядро vs formulas-оракул', () => {
  for (const name of matrix.names) {
    it(`сценарий ${name}`, () => {
      const r = runModel(params, matrix, items, name)
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
    const r = runModel(params, matrix, items, 'Base')
    expect(r.cashflow).toHaveLength(72)
    expect(r.revenue).toHaveLength(60)
    expect(r.revenue[0].steam).toHaveLength(4)
    expect(r.cashflow.every((m) => isFinite(m.fcff))).toBe(true)
  })

  it('режим «С возмещением» снижает НДС к уплате', () => {
    const gross = runModel(params, matrix, items, 'Base')
    const reimb = runModel(params, matrix, items, 'Base', { vatMode: 'С возмещением' })
    const vatG = gross.taxes.reduce((s, t) => s + t.vatPayable, 0)
    const vatR = reimb.taxes.reduce((s, t) => s + t.vatPayable, 0)
    expect(vatR).toBeLessThan(vatG - 200000) // экономия ~€284k по модели
  })

  it('непакетный режим: uptake < 100% снижает выручку от услуг', () => {
    const pkg = runModel(params, matrix, items, 'Base')
    const nopkg = runModel(params, matrix, items, 'Base', { mode: 'Нет' })
    expect(nopkg.revenue[0].steamTotal).toBeCloseTo(pkg.revenue[0].steamTotal * 0.3, 0)
  })
})
