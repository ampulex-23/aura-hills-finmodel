import { describe, expect, it } from 'vitest'
import paramsJson from '../src/data/params.json'
import scenariosJson from '../src/data/scenarios.json'
import nomenclatureJson from '../src/data/nomenclature.json'
import servicesJson from '../src/data/services.json'
import type { NomenclatureItem, Params, ScenarioMatrix, ServiceSpec } from '../src/model/types'
import { runModel } from '../src/model/run'

const params = paramsJson as Params
// IT/АСУ-блок — новый слой модели, его нет в Excel-оракуле: выключаем,
// чтобы golden-master продолжал сверять порт ядра 1:1.
params.it.enabled = false
// Deferred-пресейл — расширение сверх Excel-оракула (в книге только incremental):
// golden сверяет порт ядра 1:1, поэтому в тесте остаёмся на поведении оракула.
params.units.presaleMode = 'incremental'
// F&B-слой (food-cost + повар) — расширение сверх Excel-оракула.
params.fb.enabled = false
params.preopen.enabled = false // pre-opening вне оракула
// Расширения сверх Excel-оракула: ёмкость членов, GESY, налоговый график CIT.
params.members.consumeSlots = false
params.taxes.gesy = 0
params.taxDepr.enabled = false
params.glampOta.enabled = false // OTA-комиссия вне оракула
// Векторы загрузки услуг (парения/массаж/допы) — расширение сверх оракула:
// в Excel-книге строки присутствовали, но не участвовали в расчёте.
params.service.serviceLoads = false
const matrix = scenariosJson as ScenarioMatrix
const items = nomenclatureJson as NomenclatureItem[]
const services = servicesJson.services as unknown as ServiceSpec[]

// Эталон — прогон ядра после номенклатурного реворка (Блоки 1–7, спеки услуг
// несут материальный COGS, аренда = 3 бани × flat-цена 250/500/750, пармастер
// 3% гарантированно со слота, процедуры 30%, CAPEX из ТЗ-2 с нач. запасами).
// Excel-оракул к этой экономике неприменим: константы зафиксированы как
// golden-baseline ядра — ловят регрессии при дальнейших правках.
// Исторические отклонения от книги: авансы CIT июль/декабрь (Кипр),
// KPI по спецификациям вместо глобального пула.
const ORACLE = {
  Conservative: { npv: 1563700, irr: 0.3956, payback: 42, discPayback: 49, peak: -1909829 },
  Base: { npv: 3395476, irr: 0.7185, payback: 33, discPayback: 37, peak: -1567366 },
  Aggressive: { npv: 5516036, irr: 1.0442, payback: 27, discPayback: 28, peak: -1518685 },
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
