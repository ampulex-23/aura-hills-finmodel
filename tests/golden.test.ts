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

// Оракул: formulas-движок на AURA_HILLS_MODEL.xlsx (пакетный режим, НДС=Гросс,
// после перевода OPEX на номенклатуру И фикса привязки услуг к текущему месяцу).
// NPV/IRR/payback — из прогона, расхождение ядра < 0.01% — остаток float-шум оракула.
// Осознанные расхождения от книги: авансы CIT перенесены июнь→июль (на Кипре
// провизиональный налог платится 31 июля и 31 декабря); KPI-бонусы переведены
// с глобального пула (30% парений + 30% массажа + 1% выручки) на спецификации
// (продано услуг × прайс спеки × % ролей, клинеры/аренда без KPI) — обе правки
// намеренные, поэтому ниже зафиксирован ПОСТ-KPI эталон прогона ядра (не книги).
// Далее из OPEX удалён якорь «Веники» (NC-001, €3.09/слот) — веники живут
// только в спецификациях парений по реальным SKU.
const ORACLE = {
  Conservative: { npv: 3730741, irr: 0.7129, payback: 34, discPayback: 37, peak: -1663225 },
  Base: { npv: 6189625, irr: 1.1668, payback: 26, discPayback: 27, peak: -1386057 },
  Aggressive: { npv: 9037417, irr: 1.6404, payback: 23, discPayback: 23, peak: -1346680 },
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
