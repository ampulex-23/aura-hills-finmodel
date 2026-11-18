// Слой методики: правила расчёта переключаются параметром, дефолт ('cyprus')
// обязан совпадать с поведением ядра до появления слоя.
import { describe, expect, test } from 'vitest'
import paramsJson from '../src/data/params.json'
import scenariosJson from '../src/data/scenarios.json'
import { runModel } from '../src/model/run'
import { METHODOLOGY_PRESETS, resolveMethodology } from '../src/model/methodology'
import type { Params, ScenarioMatrix } from '../src/model/types'
import { items, services } from './_baseline'

// Сценарные стрессы стройки сдвигают открытие — здесь проверяются правила
// методики на календаре из params, поэтому задержка обнулена.
const matrix = JSON.parse(JSON.stringify(scenariosJson)) as ScenarioMatrix
matrix.constructionDelayMonths = matrix.names.map(() => 0)
const base = (): Params => JSON.parse(JSON.stringify(paramsJson))
const run = (mutate?: (p: Params) => void) => {
  const p = base()
  mutate?.(p)
  return runModel(p, matrix, items, services)
}
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0)

describe('методика: резолв', () => {
  test('без поля methodology действует cyprus; явный id даёт тот же результат', () => {
    expect(resolveMethodology(base())).toEqual(METHODOLOGY_PRESETS.cyprus)
    const a = run()
    const b = run((p) => { p.methodology = { id: 'cyprus' } })
    expect(b.kpis).toEqual(a.kpis)
    expect(b.cashflow).toEqual(a.cashflow)
    expect(a.methodology.id).toBe('cyprus')
  })
  test('переопределение правила поверх пресета; неизвестный id → cyprus', () => {
    const p = base()
    p.methodology = { id: 'investor', tax: { notionalInterestRate: 0.05 } }
    const m = resolveMethodology(p)
    expect(m.daysBasis).toBe('calendar')
    expect(m.tax).toEqual({ cit: 'monthly', allowNegative: true, notionalInterestRate: 0.05 })
    p.methodology = { id: 'нет-такой' }
    expect(resolveMethodology(p).tax).toEqual(METHODOLOGY_PRESETS.cyprus.tax)
  })
})

describe('методика: дни месяца', () => {
  test('calendar: аренда месяца = fixed30 × дни/30, февраль 28/29', () => {
    const a = run()
    const b = run((p) => { p.methodology = { daysBasis: 'calendar' } })
    b.revenue.forEach((r, k) => {
      expect(a.revenue[k].days).toBe(30)
      expect(r.rental).toBeCloseTo((a.revenue[k].rental * r.days) / 30, 6)
    })
    const feb = b.revenue.filter((r) => r.monthOfYear === 2).map((r) => r.days)
    expect(new Set(feb)).toEqual(new Set([28, 29])) // 2028 и 2032 — високосные
    expect(b.revenue.find((r) => r.monthOfYear === 1)!.days).toBe(31)
  })
})

describe('методика: индекс цен', () => {
  const g = 0.05
  const withGrowth = (rule: Params['methodology']) =>
    runModel({ ...base(), methodology: rule }, matrix, items, services, undefined, { priceGrowth: g })
  test('opsYear — ступень в годовщину открытия; calendarYear — 1 января', () => {
    const ops = withGrowth(undefined)
    const cal = withGrowth({ priceIndex: 'calendarYear' })
    // открытие 10.2027: k=3 — январь 2028, k=12 — октябрь 2028
    expect(ops.revenue.slice(0, 12).every((r) => r.priceIndex === 1)).toBe(true)
    expect(ops.revenue[12].priceIndex).toBeCloseTo(1 + g, 12)
    expect(cal.revenue[2].priceIndex).toBe(1)
    expect(cal.revenue[3].priceIndex).toBeCloseTo(1 + g, 12)
    expect(cal.revenue[15].priceIndex).toBeCloseTo((1 + g) ** 2, 12)
  })
  test('table — явные коэффициенты по календарным годам, пропуск года держит последний', () => {
    const t = withGrowth({ priceIndex: 'table', priceIndexTable: { '2029': 1.05, '2031': 1.15 } })
    const at = (y: number) => t.revenue[(y - 2027) * 12 - 9].priceIndex // январь года y
    expect([at(2028), at(2029), at(2030), at(2031), at(2033)]).toEqual([1, 1.05, 1.05, 1.15, 1.15])
  })
})

describe('методика: индексация бонусов', () => {
  test('inflation: бонус месяца = неиндексированный × (1+инфляция)^опер.год', () => {
    const a = run()
    const b = run((p) => { p.methodology = { bonusIndex: 'inflation' } })
    const infl = base().general.inflation
    expect(a.fot[30].bonuses).toBeGreaterThan(0)
    b.fot.forEach((f, k) =>
      expect(f.bonuses).toBeCloseTo(a.fot[k].bonuses * (1 + infl) ** Math.floor(k / 12), 6))
  })
})

describe('методика: помесячный налог', () => {
  const monthly = (tax: object, mutate?: (p: Params) => void) =>
    run((p) => { p.methodology = { tax: { cit: 'monthly', allowNegative: true, notionalInterestRate: 0, ...tax } }; mutate?.(p) })

  test('CIT месяца = ставка × база; отрицательный разрешён только флагом', () => {
    const neg = monthly({})
    const pos = monthly({ allowNegative: false })
    expect(neg.taxes.some((t) => t.cit < 0)).toBe(true)
    expect(pos.taxes.every((t) => t.cit >= 0)).toBe(true)
    neg.taxes.forEach((t, k) => expect(pos.taxes[k].cit).toBeCloseTo(Math.max(0, t.cit), 6))
    expect(sum(neg.citByYear)).toBeCloseTo(sum(neg.taxes.map((t) => t.cit)), 6)
    expect(neg.taxes.every((t) => t.notionalInterest === 0)).toBe(true)
  })

  test('условные проценты = дефицит накопленного FCFF прошлого месяца × ставка/12', () => {
    const r = monthly({ notionalInterestRate: 0.09 })
    const c = base().meta.capexMonths
    const rate = base().taxes.cit
    r.taxes.forEach((t, k) => {
      const deficit = Math.max(0, -r.cashflow[c + k - 1].cumFcff)
      expect(t.notionalInterest).toBeCloseTo((deficit * 0.09) / 12, 6)
    })
    // проценты только уменьшают базу: CIT ниже ровно на ставку × проценты
    const plain = monthly({})
    expect(sum(r.taxes.map((t) => t.notionalInterest))).toBeGreaterThan(0)
    expect(sum(plain.taxes.map((t) => t.cit)) - sum(r.taxes.map((t) => t.cit)))
      .toBeCloseTo(rate * sum(r.taxes.map((t) => t.notionalInterest)), 4)
  })

  test('nonDeductible: строка остаётся в EBITDA и кэше, но не уменьшает базу CIT', () => {
    const a = monthly({})
    const b = monthly({}, (p) => { p.opexFixed[2].nonDeductible = true })
    const nd = sum(b.opex.map((o) => o.fixedNonDeductible))
    expect(nd).toBeGreaterThan(0)
    expect(sum(a.opex.map((o) => o.fixedNonDeductible))).toBe(0)
    b.pnl.forEach((m, k) => expect(m.ebitda).toBeCloseTo(a.pnl[k].ebitda, 6))
    expect(sum(b.taxes.map((t) => t.cit)) - sum(a.taxes.map((t) => t.cit)))
      .toBeCloseTo(base().taxes.cit * nd, 4)
  })
})
