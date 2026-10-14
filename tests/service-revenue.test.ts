import { describe, expect, it } from 'vitest'
import paramsJson from '../src/data/params.json'
import scenariosJson from '../src/data/scenarios.json'
import nomenclatureJson from '../src/data/nomenclature.json'
import servicesJson from '../src/data/services.json'
import type { NomenclatureItem, Params, ScenarioMatrix, ServiceSpec } from '../src/model/types'
import { runModel } from '../src/model/run'

// Спеки — источник распределения выручки направлений (парения/массаж/допы):
// цена и вес живут в спецификации, объёмы привязаны к коду, а не к позиции
// в списке. Регрессия на баг «удалённая позиция продолжает участвовать в
// распределении через позиционный сдвиг».
// Экономика кошелька: депозитный пул направления фиксирован (деньги уже
// собраны), поэтому удаление позиции НЕ уменьшает суммарную выручку
// направления — её доля распределяется по оставшемуся меню. Зато исчезают
// её COGS и KPI-бонусы, и объёмы других спек считаются по ИХ весам.
const params = paramsJson as Params
const matrix = scenariosJson as ScenarioMatrix
const items = nomenclatureJson as NomenclatureItem[]
const services = servicesJson.services as unknown as ServiceSpec[]
const S = () => JSON.parse(JSON.stringify(services)) as ServiceSpec[]

const dirRevenue = (r: ReturnType<typeof runModel>, key: 'steam' | 'massage' | 'extra') =>
  r.revenue.reduce((a, m) => a + m[`${key}Total`], 0)

describe('спеки как источник распределения выручки', () => {
  it('удаление услуги из середины: пул остаётся, её COGS/KPI исчезают', () => {
    const base = runModel(params, matrix, items, services, 'Base')
    const s = S().filter((x) => x.code !== 'SVC-M2')
    const after = runModel(params, matrix, items, s, 'Base')
    // депозитный пул направления не изменился (upgradeShare=0)
    expect(dirRevenue(after, 'massage')).toBeCloseTo(dirRevenue(base, 'massage'), 6)
    // объёмы по коду: удалённой спеки нет, соседи поделили её долю по своим весам
    const cBase = base.revenue[24].serviceCounts
    const cAfter = after.revenue[24].serviceCounts
    expect(cAfter['SVC-M2']).toBeUndefined()
    expect(cAfter['SVC-M1']).toBeGreaterThan(cBase['SVC-M1']) // веса перевзвешены, не сдвинуты
    // KPI-бонусы удалённой спеки исчезли из ФОТ
    const bBase = base.fot.reduce((a, m) => a + m.bonuses, 0)
    const bAfter = after.fot.reduce((a, m) => a + m.bonuses, 0)
    expect(bAfter).toBeLessThan(bBase)
  })

  it('удаление спеки с весом в «Доп. услуги» (веса разные) — без позиционного сдвига', () => {
    const s = S().filter((x) => x.code !== 'SVC-D3')
    const r = runModel(params, matrix, items, s, 'Base')
    const sc = r.revenue[24].serviceCounts
    expect(sc['SVC-D3']).toBeUndefined()
    expect(sc['SVC-D1']).toBeGreaterThan(0)
    expect(sc['SVC-D7']).toBeGreaterThan(0)
  })

  it('пустое направление → нулевой поток, без NaN', () => {
    const s = S().filter((x) => x.direction !== 'Массаж')
    const r = runModel(params, matrix, items, s, 'Base')
    expect(r.revenue.every((m) => m.massageTotal === 0)).toBe(true)
    expect(r.revenue.every((m) => Number.isFinite(m.total))).toBe(true)
  })

  it('спека без weight не продаётся', () => {
    const s = S()
    const m1 = s.find((x) => x.code === 'SVC-M1')!
    delete m1.weight
    const r = runModel(params, matrix, items, s, 'Base')
    expect(r.revenue[24].serviceCounts['SVC-M1'] ?? 0).toBe(0)
  })

  it('weight спеки управляет долей: удвоение веса растёт её объём', () => {
    const s = S()
    s.find((x) => x.code === 'SVC-P1')!.weight = 0.5 // было 0.25
    const r = runModel(params, matrix, items, s, 'Base')
    const c = r.revenue[24].serviceCounts
    expect(c['SVC-P1']).toBeGreaterThan(c['SVC-P4']) // 50€×0.5 vs 250€×0.25 — по объёму P1 больше
  })
})
