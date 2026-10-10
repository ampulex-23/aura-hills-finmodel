import { describe, expect, it } from 'vitest'
import { runModel } from '../src/model/run'
import { baselineMatrix, baselineParams, items, services } from './_baseline'
import type { Params } from '../src/model/types'

const matrix = baselineMatrix()
const clone = (): Params => baselineParams()

// Включает все объекты очереди 2 (VIP-модули + общественная баня)
const allP2 = (p: Params): Params => {
  p.modules.forEach((m) => { if (m.phase === 2) m.status = 'Активен' })
  if (p.publicBath) p.publicBath.enabled = true
  return p
}

describe('очередь 2: данные и инварианты', () => {
  it('все объекты выключены → phase2Eur = 0, нет отложенного CAPEX и потоков', () => {
    const r = runModel(clone(), matrix, items, services, 'Base')
    expect(r.capex.phase2Eur).toBe(0)
    expect(r.capex.phase2Outflow).toHaveLength(0)
    expect(r.capex.deferred).toHaveLength(0)
    expect(r.revenue.every((m) => m.publicBath === 0 && m.restaurant === 0)).toBe(true)
  })

  it('полная реализация: отток за 24 мес окна 2029–2030, сумма = phase2AdjEur', () => {
    const r = runModel(allP2(clone()), matrix, items, services, 'Base')
    expect(r.capex.phase2Eur).toBeCloseTo(1_501_000, -3)
    expect(r.capex.phase2AdjEur).toBeCloseTo(1_501_000 * 1.1, -3)
    const out = r.capex.phase2Outflow
    expect(out).toHaveLength(24)
    expect(out[0].month).toBe(25) // янв 2029 — 25-й месяц CF (стройка оч.1 = мес 1–12)
    expect(out[23].month).toBe(48) // дек 2030
    expect(out.reduce((s, d) => s + d.eur, 0)).toBeCloseTo(r.capex.phase2AdjEur, 6)
  })

  it('частичная реализация: vip1-only = объектные строки vip1 + общие', () => {
    const p = clone()
    p.modules.find((m) => m.id === 4)!.status = 'Активен' // vip1
    const r = runModel(p, matrix, items, services, 'Base')
    // 84к здание + 70к наполнение + общие (55+40+10+25+25+30+72=257к)
    expect(r.capex.phase2Eur).toBeCloseTo(154_000 + 257_000, 0)
    // publicBath-строки не вошли
    expect(r.capex.items.filter((i) => i.phase === 2 && i.object === 'public')).toHaveLength(0)
  })

  it('общественная баня: посетители = 30 × 40 × загрузка, билет €35', () => {
    const p = clone()
    p.publicBath!.enabled = true
    p.publicBath!.launchDate = '2028-01'
    if (p.phase2) p.phase2.rampMonths = 1 // рампа мгновенная — проверяем голую формулу
    const r = runModel(p, matrix, items, services, 'Base')
    // год 1, январь: загрузка = min(1, 0.35 × сезонность янв 1.25) — как bathsLoad
    const k = 0
    const guests = r.revenue[k].publicGuests
    expect(guests).toBeCloseTo(30 * 40 * Math.min(1, 0.35 * p.seasonality.baths[0]), 0)
    expect(r.revenue[k].publicBath).toBeCloseTo(guests * 35, 0)
    // гости бани вошли в guests (COGS), но не в F&B-кафе очереди 1
    expect(r.revenue[k].guests).toBeGreaterThanOrEqual(guests)
  })

  it('ресторан: посадки × чек × инфляция; food-cost идёт в pctTotal', () => {
    const p = allP2(clone())
    p.publicBath!.launchDate = '2028-01'
    p.phase2!.rampMonths = 1
    const r = runModel(p, matrix, items, services, 'Base')
    const k = 12 // год 2: restLoad Base y2 = 0.45, сезонность янв 1.25 → min(1,·)=1
    const covers = 30 * 40 * 1.5 * Math.min(1, 0.45 * 1.25)
    const check = 28 * Math.pow(1 + p.general.inflation, 1)
    expect(r.revenue[k].restaurant).toBeCloseTo(covers * check, 0)
    const restCost = r.revenue[k].restaurant * p.restaurant!.foodCostPct
    expect(r.opex[k].pct.restCost).toBeCloseTo(restCost, 2)
  })

  it('VIP-модуль очереди 2: слоты с 2031, своя рампа phase2.rampMonths', () => {
    const p = clone()
    const vip = p.modules.find((m) => m.id === 4)!
    vip.status = 'Активен'
    vip.launchDate = '2030-06' // ввод через 29 мес операционки
    p.phase2!.rampMonths = 2
    p.seasonality.baths = Array(12).fill(1) // изолируем рампу от сезонности
    const r = runModel(p, matrix, items, services, 'Base')
    expect(r.revenue[28].bathCounts[3] ?? 0).toBe(0) // до ввода слотов нет
    const s29 = r.revenue[29].bathCounts[3] // месяц ввода: рампа 0.5
    const s30 = r.revenue[30].bathCounts[3] // месяц 2: рампа 1
    expect(s29).toBeGreaterThan(0)
    expect(s30).toBeCloseTo(s29 * 2, 6)
  })

  it('амортизация очереди 2 начинается с месяца ввода объектов', () => {
    const p = allP2(clone())
    p.publicBath!.launchDate = '2031-01'
    p.modules.forEach((m) => { if (m.phase === 2) m.launchDate = '2031-01-01' })
    const r = runModel(p, matrix, items, services, 'Base')
    // до ввода (ops k=35 = дек 2030) — только амортизация очереди 1
    expect(r.capex.amortMonthly[35]).toBeCloseTo(r.capex.monthlyAmort, 6)
    // с ввода (k=36 = янв 2031) — выросла на амортизацию очереди 2
    expect(r.capex.amortMonthly[36]).toBeGreaterThan(r.capex.amortMonthly[35] * 1.2)
    expect(r.pnl[36].amortization).toBeCloseTo(r.capex.amortMonthly[36], 6)
    expect(r.pnl[35].amortization).toBeCloseTo(r.capex.amortMonthly[35], 6)
  })

  it('входной НДС очереди 2 приходит помесячно в окне стройки', () => {
    const p = allP2(clone())
    p.meta.vatMode = 'С возмещением'
    const r = runModel(p, matrix, items, services, 'Base')
    const vatRate = p.taxes.vatInput / (1 + p.taxes.vatInput)
    // ops k=12 (янв 2029) — первый месяц окна: входной НДС включает транш очереди 2
    const monthEur = r.capex.phase2Outflow[0].eur
    const opexPart = (r.opex[12].fixedTotal + r.opex[12].variableTotal + r.opex[12].itTotal) * vatRate
    expect(r.taxes[12].inputVat).toBeCloseTo(opexPart + monthEur * vatRate, 0)
  })

  it('funding=equity: транш покрывает отток стройки помесячно', () => {
    const p = allP2(clone())
    p.phase2!.funding = 'equity'
    const r = runModel(p, matrix, items, services, 'Base')
    const eqSum = r.cashflow.reduce((s, m) => s + m.phase2Equity, 0)
    expect(eqSum).toBeCloseTo(r.capex.phase2AdjEur, 0)
    const m25 = r.cashflow[24] // янв 2029
    expect(m25.phase2Equity).toBeCloseTo(r.capex.phase2Outflow[0].eur, 6)
    // funding=ops: транша нет
    const r2 = runModel(allP2(clone()), matrix, items, services, 'Base')
    expect(r2.cashflow.every((m) => m.phase2Equity === 0)).toBe(true)
  })

  it('отключение очереди 2 сохраняет baseline очереди 1', () => {
    const off = runModel(clone(), matrix, items, services, 'Base')
    const p = allP2(clone())
    // всё выключаем обратно
    p.modules.forEach((m) => { if (m.phase === 2) m.status = 'В резерве' })
    p.publicBath!.enabled = false
    const r = runModel(p, matrix, items, services, 'Base')
    expect(r.revenue.map((x) => x.total)).toEqual(off.revenue.map((x) => x.total))
    expect(r.pnl.map((x) => x.netProfit)).toEqual(off.pnl.map((x) => x.netProfit))
    expect(r.capex.totalEur).toBeCloseTo(off.capex.totalEur, 6)
  })
})
