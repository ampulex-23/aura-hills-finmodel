import { describe, expect, it } from 'vitest'
import paramsJson from '../src/data/params.json'
import scenariosJson from '../src/data/scenarios.json'
import nomenclatureJson from '../src/data/nomenclature.json'
import servicesJson from '../src/data/services.json'
import type { NomenclatureItem, Params, ScenarioMatrix, ServiceSpec } from '../src/model/types'
import { runModel } from '../src/model/run'
import { dirCounts } from '../src/model/revenue'
import { costService, serviceLaborShare } from '../src/model/spec'

// Механики проверяются без сценарных стрессов стройки (задержка сдвигает индексы месяцев)
const matrix = (() => {
  const m = JSON.parse(JSON.stringify(scenariosJson)) as ScenarioMatrix
  m.constructionDelayMonths = m.names.map(() => 0)
  return m
})()
const items = nomenclatureJson as NomenclatureItem[]
const services = servicesJson.services as unknown as ServiceSpec[]
// Очередь 2 включена по умолчанию в проде; регрессии ниже — ядро очереди 1,
// поэтому гасим её в клонах (поведение оч. 2 покрыто phase2.test.ts).
const clone = () => {
  const p = JSON.parse(JSON.stringify(paramsJson)) as Params
  for (const m of p.modules) if (m.phase === 2) m.status = 'В резерве'
  if (p.publicBath) p.publicBath.enabled = false
  // Опциональные слои выручки выключены по умолчанию; регрессии — полная модель.
  p.members.enabled = true
  p.units.certsEnabled = true
  p.glamping.enabled = true
  p.fb.enabled = true
  return p
}

describe('аудит-регрессии', () => {
  it('«С возмещением»: P&L берёт НАЧИСЛЕННЫЙ НДС, а не уплаченный', () => {
    const r = runModel(clone(), matrix, items, services, 'Base', { vatMode: 'С возмещением' })
    for (let k = 0; k < 60; k++) {
      const vatOut = r.taxes[k].vatOut19 + r.taxes[k].vatOut9
      expect(r.pnl[k].revenueNet).toBeCloseTo(r.revenue[k].total - vatOut, 6)
      // CF-корректировка закрывает разницу начисленный vs уплаченный кэшем
      expect(r.cashflow[k + 12].vatTiming).toBeCloseTo(vatOut - r.taxes[k].vatPaid, 6)
      expect(r.cashflow[k + 12].operatingCf).toBeCloseTo(
        r.pnl[k].netProfit + r.pnl[k].amortization + r.cashflow[k + 12].vatTiming, 6,
      )
    }
    // Пока горит CAPEX-кредит, EBITDA не должна содержать выходной НДС
    const k = 5 // кредит ещё активен
    expect(r.taxes[k].vatPayable).toBe(0)
    expect(r.pnl[k].ebitda).toBeLessThan(r.revenue[k].total * 0.9)
  })

  it('«Гросс» + помесячная уплата: vatTiming всегда 0', () => {
    const p = clone()
    p.taxes.vatQuarterly = false
    const r = runModel(p, matrix, items, services, 'Base', { vatMode: 'Гросс' })
    expect(r.cashflow.every((m) => Math.abs(m.vatTiming) < 1e-9)).toBe(true)
  })

  it('квартальная уплата НДС: Σ уплачено = Σ начислено минус хвост последнего квартала', () => {
    const r = runModel(clone(), matrix, items, services, 'Base')
    const payable = r.taxes.reduce((s, t) => s + t.vatPayable, 0)
    const paid = r.taxes.reduce((s, t) => s + t.vatPaid, 0)
    // последний квартал (Окт–Дек года 5) платится уже за горизонтом
    const tail = r.taxes.slice(-3).reduce((s, t) => s + t.vatPayable, 0)
    expect(paid).toBeCloseTo(payable - tail, 6)
    // платежи только в месяцы 2, 5, 8, 11 (через 2 мес после конца квартала)
    r.taxes.forEach((t, k) => { if (t.vatPaid > 0) expect([2, 5, 8, 11]).toContain(r.revenue[k].monthOfYear) })
  })

  it('SDC/GESY удерживаются ИЗ дивидендов: отток компании = дивиденды брутто', () => {
    const r = runModel(clone(), matrix, items, services, 'Base')
    r.cashflow.forEach((m) => {
      expect(m.totalCf).toBeCloseTo(m.fcff + m.dividends, 6)
      expect(m.cash).toBeGreaterThanOrEqual(-1e-6)
    })
  })

  it('потолок GESY €180k на партнёра в календарный год', () => {
    const p = clone()
    p.taxes.gesyCap = 1000 // низкий потолок: GESY упирается в него
    const r = runModel(p, matrix, items, services, 'Aggressive')
    const residents = p.partners.statuses.filter((s) => s.startsWith('Резидент')).length
    const byYear = new Map<number, number>()
    r.taxes.forEach((t, k) => {
      const y = Math.floor(k / 12)
      byYear.set(y, (byYear.get(y) ?? 0) + t.gesy)
    })
    for (const [, g] of byYear) expect(g).toBeLessThanOrEqual(residents * 1000 * p.taxes.gesy + 1e-6)
  })

  it('входной НДС по CAPEX исключает землю и отложенные модули', () => {
    const p = clone()
    p.land.mode = 'purchase'
    p.meta.vatMode = 'С возмещением'
    p.modules[3].status = 'Активен'
    p.modules[3].phase = 1 // иначе модуль — объект очереди 2 (vip1) с окном 2029–30
    p.modules[3].launchDate = '2029-01-01' // запуск → ops месяц 12 (дефолт сдвинут на 2031-01)
    const r = runModel(p, matrix, items, services, 'Base')
    const vatRate = p.taxes.vatInput / (1 + p.taxes.vatInput)
    // месяц 0: (amortizable − deferred очереди 1) × extracted-ставка
    const defTotal = r.capex.deferredPhase1Total
    const expected0 = (r.capex.amortizableEur - defTotal) * vatRate
    const opexPart0 = (r.opex[0].fixedTotal + r.opex[0].variableTotal + r.opex[0].itTotal) * vatRate
    expect(r.taxes[0].inputVat).toBeCloseTo(opexPart0 + expected0, 2)
    // месяц запуска модуля (ops k=12): входной НДС с отложенного CAPEX
    const opexPart12 = (r.opex[12].fixedTotal + r.opex[12].variableTotal + r.opex[12].itTotal) * vatRate
    expect(r.taxes[12].inputVat).toBeCloseTo(opexPart12 + defTotal * vatRate, 2)
  })

  it('CIT платится в июле и декабре календарного года, по календарным годам', () => {
    const r = runModel(clone(), matrix, items, services, 'Base')
    for (const [k, t] of r.taxes.entries()) {
      const mo = r.revenue[k].monthOfYear
      if (t.cit > 0) expect([7, 12]).toContain(mo)
    }
    // сумма платежей года = citByYear года
    expect(r.taxes[6].cit + r.taxes[11].cit).toBeCloseTo(r.citByYear[0], 6)
  })

  it('extraLoad не уходит в минус при низком steam', () => {
    const m = JSON.parse(JSON.stringify(matrix)) as ScenarioMatrix
    m.steam.y1 = [0.1, 0.1, 0.1] // < 0.25 → без пола была бы отрицательная выручка
    const r = runModel(clone(), m, items, services, 'Base')
    expect(r.revenue.every((x) => x.extraTotal >= 0)).toBe(true)
  })

  it('rampMonths=0 не даёт NaN и не молча отключает рампу', () => {
    const m = JSON.parse(JSON.stringify(matrix)) as ScenarioMatrix
    m.rampMonths[1] = 0
    const r = runModel(clone(), m, items, services, 'Base')
    expect(Number.isFinite(r.revenue[0].total)).toBe(true)
    expect(r.revenue[0].ramp).toBe(1) // защита max(1, rampMonths) → сразу полная загрузка
  })

  it('помодульный OPEX и ёмкость членов учитывают только запущенные модули', () => {
    const p = clone()
    p.modules[3].status = 'Активен'
    p.modules[3].launchDate = '2029-01-01' // запуск → ops месяц 12 (дефолт сдвинут на 2031-01)
    const r = runModel(p, matrix, items, services, 'Base')
    // «Обслуживание модулей» €100/модуль: 3 модуля до запуска, 4 после.
    // fixed[m] = (Σ базовых + 100×модули) × инфляция года → m13 = m0×infl + 100×infl
    // (маркетинг исключён — он теперь % выручки, см. opexFixed[0].pctOfRevenue)
    const noMkt = (f: number[]) => f.filter((_, i) => !p.opexFixed[i].pctOfRevenue).reduce((s, v) => s + v, 0)
    const svcM0 = noMkt(r.opex[0].fixed)
    const svcM13 = noMkt(r.opex[13].fixed)
    const inflY2 = Math.pow(1.025, 1)
    expect(svcM13).toBeCloseTo(svcM0 * inflY2 + 100 * inflY2, 0)
  })

  it('начальный запас (initialQty) уходит в CAPEX и не трогает OPEX', () => {
    const base = runModel(clone(), matrix, items, services, 'Base')
    const items2 = items.map((it) =>
      it.code === 'NC-087' ? { ...it, initialQty: 100 } : it,
    )
    const r = runModel(clone(), matrix, items2, services, 'Base')
    const robe = items2.find((x) => x.code === 'NC-087')!
    const landed = robe.price + Math.max(robe.deliveryFix, robe.price * robe.deliveryPct)
    const capexRow = r.capex.items.find((i) => i.name.includes('Закуп'))!
    // у NC-087 уже есть initialQty 6 из Блока 5 — дельта считается от неё
    const prevQty = items.find((x) => x.code === 'NC-087')!.initialQty ?? 0
    expect(r.capex.totalEur).toBeCloseTo(base.capex.totalEur + landed * (100 - prevQty), 2)
    expect(capexRow.detail!.some((d) => d.code === 'NC-087' && d.qty === 100)).toBe(true)
    // помесячный OPEX не изменился — норма та же
    expect(r.opex[5].variableTotal).toBeCloseTo(base.opex[5].variableTotal, 6)
  })

  it('MODULES_COUNT:N — отложенный модуль платит полный помодульный CAPEX', () => {
    const p = clone()
    p.modules[3].status = 'Активен' // launch 2029-01
    p.modules[3].phase = 1 // deferred-механика очереди 1; иначе это vip1 с окном 2029–30
    const r = runModel(p, matrix, items, services, 'Base')
    // 7M (корпус) + 2×1M (Афродита) = 9M RUB = €90k
    // (печи и купели переехали в номенклатурное наполнение — там не помодульные)
    expect(r.capex.deferred).toHaveLength(1)
    expect(r.capex.deferred[0].eur).toBeCloseTo(90_000 * (1 + r.scenario.capexAdj), 2)
    // общий CAPEX (до буфера) вырос на полную помодульную сумму (раньше добавлялся только корпус €70k)
    const base = runModel(clone(), matrix, items, services, 'Base')
    expect(r.capex.totalEur).toBeCloseTo(base.capex.totalEur + 90_000, 0)
  })
})

describe('KPI по спецификациям (не глобальный пул)', () => {
  it('ноль проданных услуг → ноль KPI, голый оклад платится', () => {
    const p = clone()
    p.service.demandMult = 0 // ни одного слота/услуги за все месяцы
    const r = runModel(p, matrix, items, services, 'Base')
    expect(r.fot.every((m) => m.bonuses === 0)).toBe(true)
    expect(r.fot[0].salaries).toBeGreaterThan(0)
    expect(r.fot[0].total).toBeCloseTo(
      r.fot[0].salaries * (1 + p.taxes.employerRate), 6,
    )
  })

  it('бонус месяца = Σ продано услуг × прайс спеки × Σ% ролей', () => {
    const r = runModel(clone(), matrix, items, services, 'Base')
    const k = 24 // устаканенный месяц
    const p = clone()
    const r2 = runModel(p, matrix, items, services, 'Base')
    const dirOrder = [...new Set(services.map((s) => s.direction))]
    const expected = dirOrder.reduce((tot, dir) => {
      const dirSpecs = services.filter((s) => s.direction === dir)
      const counts = dirCounts(r2.revenue[k], dir, dirSpecs, p)
      return tot + dirSpecs.reduce(
        (s, sv, i) => s + counts[i] * sv.price * serviceLaborShare(sv, p), 0,
      )
    }, 0)
    expect(r.fot[k].bonuses).toBeCloseTo(expected, 6)
  })

  it('legacy params.kpi не влияет на ФОТ', () => {
    const p = clone()
    p.kpi = { steamShare: 0, massageShare: 0, revenueShare: 0 }
    const withZero = runModel(p, matrix, items, services, 'Base')
    const base = runModel(clone(), matrix, items, services, 'Base')
    expect(withZero.fot.map((m) => m.bonuses)).toEqual(base.fot.map((m) => m.bonuses))
  })

  it('взносы работодателя берутся с окладов + KPI', () => {
    const p = clone()
    const r = runModel(p, matrix, items, services, 'Base')
    for (const m of r.fot) {
      expect(m.gross).toBeCloseTo(m.salaries + m.bonuses, 9)
      expect(m.employerContrib).toBeCloseTo(m.gross * p.taxes.employerRate, 9)
      expect(m.total).toBeCloseTo(m.gross + m.employerContrib, 9)
    }
  })

  it('несервисные роли (клинеры) отсутствуют в спеках', () => {
    const labor = services.flatMap((s) => s.items.filter((i) => i.kind === 'labor'))
    expect(labor.every((i) => i.role !== 'Клинер (горничная)')).toBe(true)
    // у аренды KPI есть только гарантированные 3% пармастеру (за ведение слота)
    expect(
      services.filter((s) => s.direction === 'Аренда бани')
        .every((s) => s.items.filter((i) => i.kind === 'labor')
          .every((i) => i.role === 'Пармастер' && i.pct === 0.03)),
    ).toBe(true)
  })

  it('себестоимость труда в спеке = прайс × % ролей (не минуты × ставка)', () => {
    const p = clone()
    const steam = services.find((s) => s.code === 'SVC-P1')!
    const c = costService(steam, items, p)
    const share = steam.items.reduce((a, it) => a + (it.pct ?? 0), 0)
    expect(c.laborCost).toBeCloseTo(steam.price * share, 9)
    // несколько ролей складываются от полной цены
    const two: typeof steam = {
      ...steam,
      items: [
        { kind: 'labor', role: 'Пармастер', pct: 0.2 },
        { kind: 'labor', role: 'Массажист', pct: 0.05 },
      ],
    }
    expect(costService(two, items, p).laborCost).toBeCloseTo(two.price * 0.25, 9)
  })
})
