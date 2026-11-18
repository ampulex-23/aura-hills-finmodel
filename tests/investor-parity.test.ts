// Сверка версии «Инвестор — СПА Авдиму» (scenarios/investor-avdimou/bundle.json,
// методика 'investor') с расчётом инвестора (tests/oracle/investor-avdimou.json).
// Часть строк совпадает помесячно до цента; остальные расходятся на
// перечисленные ниже причины, и каждая причина закреплена своей суммой —
// «мост» в scenarios/investor-avdimou/README.md берёт цифры отсюда.
import { describe, expect, test } from 'vitest'
import bundleJson from '../scenarios/investor-avdimou/bundle.json'
import oracleJson from './oracle/investor-avdimou.json'
import { runModel } from '../src/model/run'
import type { NomenclatureItem, Params, ScenarioMatrix, ServiceSpec } from '../src/model/types'

const b = bundleJson as unknown as { params: Params; matrix: ScenarioMatrix; items: NomenclatureItem[]; services: ServiceSpec[] }
const o = oracleJson as unknown as {
  months: string[]; opsStartIndex: number; totals: Record<string, number>
  rows: Record<string, number[]>; revenue: Record<string, number[]>; fot: Record<string, number[]>
}
const r = runModel(b.params, b.matrix, b.items, b.services, 'Base')
const c = o.opsStartIndex
const ops = (v: number[]) => v.slice(c)
const sum = (v: number[]) => v.reduce((a, x) => a + x, 0)
const neg = (v: number[]) => v.map((x) => -x)
const add = (...vs: number[][]) => vs[0].map((_, i) => vs.reduce((s, v) => s + v[i], 0))
const eachClose = (a: number[], e: number[], skip: (k: number) => boolean = () => false) =>
  a.forEach((x, k) => { if (!skip(k)) expect(x, `опер. месяц ${k + 1} (${o.months[c + k]})`).toBeCloseTo(e[k], 2) })
// Февраль високосного года: у инвестора 28 дней, по календарю 29
const leapFeb = (k: number) => ['2028-02', '2032-02'].includes(o.months[c + k])
const diff = (a: number[], e: number[]) => Math.round(sum(a) - sum(e))

describe('инвестор: совпадает помесячно до цента', () => {
  test('методика версии — investor с таблицей индекса цен', () => {
    expect(r.methodology).toMatchObject({
      id: 'investor', daysBasis: 'calendar', priceIndex: 'table', bonusIndex: 'inflation',
      tax: { cit: 'monthly', allowNegative: true, notionalInterestRate: 0.09 },
    })
    expect(r.revenue).toHaveLength(87)
  })
  test('движение денег стройки очереди 1 (07.2026–09.2027)', () => {
    r.cashflow.slice(0, c).forEach((m, i) => expect(m.totalCf, o.months[i]).toBeCloseTo(o.rows.cashFlow[i], 2))
  })
  test('отток стройки очереди 2 (01.2029–12.2030)', () => {
    const theirs = add(o.rows.construction, o.rows.projectOffice)
    r.cashflow.forEach((m, i) => { if (m.isOps) expect(-m.deferredCapex, o.months[i]).toBeCloseTo(theirs[i], 2) })
  })
  test('постоянные расходы, IT и маркетинг', () => {
    const fee = r.opex.map((m) => m.fixedNonDeductible)
    eachClose(add(r.opex.map((m) => m.fixedTotal), neg(fee)),
      ops(add(o.rows.fixedCore, o.rows.maintenance, o.rows.insurance, o.rows.it, o.rows.marketing)))
  })
  test('оклады, индексы цен и затрат, число дней', () => {
    eachClose(r.fot.map((m) => m.salaries), ops(o.fot.salaries))
    eachClose(r.revenue.map((m) => m.priceIndex), ops(o.revenue.priceIndex))
    eachClose(r.revenue.map((m) => m.days), ops(o.revenue.days), leapFeb)
  })
  test('гости, бонусы и ФОТ — кроме двух високосных февралей', () => {
    eachClose(r.revenue.map((m) => m.guests), ops(o.fot.guests), leapFeb)
    eachClose(r.fot.map((m) => m.bonuses), ops(add(o.fot.bonusSteam, o.fot.bonusMassage)), leapFeb)
    // 06.2029: на главном листе инвестора ФОТ на 5000 € больше, чем на его листе «ФОТ»
    eachClose(r.fot.map((m) => m.total), ops(o.rows.fot), (k) => leapFeb(k) || o.months[c + k] === '2029-06')
    eachClose(r.fot.map((m) => m.total), ops(o.fot.total), leapFeb)
  })
  test('себестоимость услуг — за вычетом лишних 15.52 €/мес в сумме инвестора', () => {
    // SUM(22:26) листа «Выручка база» захватывает ячейки норм 2.55 и 12.97
    eachClose(r.opex.map((m) => m.variableTotal), ops(neg(o.rows.variable)).map((x) => x - 15.52), leapFeb)
  })
  test('налоговая амортизация до ввода очереди 2', () => {
    eachClose(r.capex.taxDeprMonthly.slice(0, 39), ops(o.rows.taxDepr).slice(0, 39))
  })
  test('выручка = заявленные гости в день × дни × 260 € × индекс цен', () => {
    const declared = o.revenue.guestsPerDayP1.map((g, i) =>
      (g + o.revenue.guestsPerDayP2[i]) * o.revenue.days[i] * 260 * o.revenue.priceIndex[i])
    eachClose(r.revenue.map((m) => m.total), ops(declared), leapFeb)
  })
})

describe('инвестор: мост расхождений итогового остатка денег', () => {
  const rev = diff(r.revenue.map((m) => m.total), ops(o.rows.revenueGross))
  const vat = -diff(r.taxes.map((m) => m.vatPaid), ops(neg(o.rows.vat)))
  const fee = -diff(r.opex.map((m) => m.fixedNonDeductible), ops(neg(o.rows.mgmtFee)))
  const cit = -diff(r.taxes.map((m) => m.cit), ops(neg(o.rows.cit)))
  const fot = -diff(r.fot.map((m) => m.total), ops(o.rows.fot))
  const variable = -diff(r.opex.map((m) => m.variableTotal), ops(neg(o.rows.variable)))
  // У инвестора в 10 месяцах (10.2032–07.2033) строка «Расходы» движения денег
  // уменьшена на условные проценты — денег, которых нет в его же строке расходов.
  const formula = -Math.round(sum(o.rows.cashFlow.map((cf, i) =>
    cf - (o.rows.revenueGross[i] + o.rows.vat[i] - o.rows.expensesTotal[i] + o.rows.mgmtFee[i] + o.rows.cit[i]))))
  const total = diff(r.cashflow.map((m) => m.totalCf), o.rows.cashFlow)

  test('каждая причина — своей суммой, €', () => {
    expect({ rev, vat, fee, cit, fot, variable, formula }).toEqual({
      rev: -487794, // выручка инвестора посчитана не от его же гостей в день
      vat: 77883, // НДС с этой разницы выручки
      fee: 40730, // УК: 2000 €/мес с индексацией против 2000→3000 без неё
      cit: 52822, // налог на прибыль — следствие остальных строк
      fot: 1543, // разовые 5000 € в 06.2029 у инвестора минус два високосных февраля
      variable: 411, // лишние 15.52 €/мес минус високосные февраля
      formula: -62882, // ошибка формулы движения денег у инвестора
    })
  })
  test('причины в сумме дают всё расхождение; итоги версии', () => {
    expect(Math.abs(rev + vat + fee + cit + fot + variable + formula - total)).toBeLessThanOrEqual(3)
    expect(total).toBe(-377287)
    expect(Math.round(sum(r.cashflow.map((m) => m.totalCf)))).toBe(1754752)
    expect(Math.round(o.totals.cashEnd)).toBe(2132040)
    expect(Math.round(-r.kpis.peakFundingNeed)).toBe(3498137)
    expect(Math.round(o.totals.fundingNeed)).toBe(3533731)
    expect(r.kpis.paybackMonths).toBe(87)
    expect(o.rows.cashCum.findIndex((x, i) => i >= c && x > 0) + 1).toBe(86) // в файле заявлено 83
  })
})

describe('инвестор: версия пригодна для остальной модели', () => {
  test('снимок для ИИ и статики, анализ чувствительности считаются без ошибок', async () => {
    const { scenarioView } = await import('../src/model/view')
    expect(JSON.stringify(scenarioView(r, b.params))).not.toMatch(/NaN|null,null/)
    const { computeSensitivity } = await import('../src/model/sensitivity')
    expect(() => computeSensitivity(b.params, b.matrix, b.items, b.services)).not.toThrow()
  })
})
