import { describe, expect, it } from 'vitest'
import paramsJson from '../src/data/params.json'
import scenariosJson from '../src/data/scenarios.json'
import nomenclatureJson from '../src/data/nomenclature.json'
import servicesJson from '../src/data/services.json'
import type { NomenclatureItem, Params, ScenarioMatrix, ServiceSpec } from '../src/model/types'
import { YEAR_KEYS } from '../src/model/types'
import { runModel } from '../src/model/run'
import { baseSalariesMonthly } from '../src/model/fot'

// Инварианты модели (аудит 14, I-12): не «какие числа», а «что всегда должно
// сходиться» — на реальных данных, со всеми слоями включёнными.
const params = paramsJson as Params
const matrix = scenariosJson as ScenarioMatrix
const items = nomenclatureJson as NomenclatureItem[]
const services = servicesJson.services as unknown as ServiceSpec[]
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)
const mean = (a: number[]) => sum(a) / a.length

describe('инварианты данных', () => {
  it('сезонность нормирована к среднему 1.0', () => {
    for (const k of ['baths', 'glamping', 'certificates'] as const)
      expect(Math.abs(mean(params.seasonality[k]) - 1)).toBeLessThan(1e-3)
  })
  it('доли амортизации = 100%, сроки > 0, доли партнёров + УК + резерв = 100%', () => {
    expect(sum(params.amort.shares)).toBeCloseTo(1, 6)
    expect(params.amort.years.every((y) => y > 0)).toBe(true)
    expect(params.taxDepr.years.every((y) => y > 0)).toBe(true)
    expect(sum(params.partners.shares) + params.partners.corporate.mgmt + params.partners.corporate.reserve).toBeCloseTo(1, 3)
    expect(sum(params.slotMix)).toBeCloseTo(1, 6)
  })
  it('номенклатура: цены > 0, веса процедур > 0', () => {
    expect(items.every((i) => i.price > 0)).toBe(true)
    for (const set of [params.procedures.steam, params.procedures.massage, params.procedures.extra])
      expect(set.weights.every((w) => w > 0)).toBe(true)
  })
  it('матрица сценариев: все потоки заданы на 5 лет, значения в [0, 1] для долей', () => {
    for (const key of ['baths', 'steam', 'massage', 'extra', 'glamping'] as const)
      for (const y of YEAR_KEYS) {
        expect(matrix[key][y]).toHaveLength(matrix.names.length)
        expect(matrix[key][y].every((v) => v >= 0 && v <= 1)).toBe(true)
      }
    expect(matrix.capexAdj[1]).toBeGreaterThanOrEqual(0.1) // contingency в Base (аудит 14, W-6)
  })
})

describe('инварианты расчёта', () => {
  for (const name of matrix.names) {
    const r = runModel(params, matrix, items, services, name)
    const last = r.cashflow[r.cashflow.length - 1]

    it(`${name}: Σ FCFF = накопл. FCFF; Σ FCFF×DF = NPV`, () => {
      expect(sum(r.cashflow.map((m) => m.fcff))).toBeCloseTo(last.cumFcff, 4)
      expect(sum(r.cashflow.map((m) => m.fcff * m.discountFactor))).toBeCloseTo(r.kpis.npv, 4)
      expect(last.cumDcf).toBeCloseTo(r.kpis.npv, 6)
    })
    it(`${name}: CAPEX = Σ позиций; WBS сходится с родителем; S-кривая = 100%`, () => {
      expect(sum(r.capex.items.map((i) => i.eur))).toBeCloseTo(r.capex.totalEur, 4)
      for (const it of r.capex.items)
        if (it.wbs?.length) expect(sum(it.wbs.map((w) => w.total))).toBeCloseTo(it.eur, 2)
      const build = r.cashflow.filter((m) => !m.isOps)
      const deferred = sum(r.capex.deferred.map((d) => d.eur))
      expect(-sum(build.map((m) => m.capex))).toBeCloseTo(r.capex.adjustedEur - deferred, 2)
    })
    it(`${name}: баланс сходится, касса ≥ 0, пул предоплат ≥ 0`, () => {
      for (const b of r.balance) expect(Math.abs(b.check)).toBeLessThan(1e-4)
      for (const m of r.cashflow) {
        expect(m.cash).toBeGreaterThanOrEqual(-1e-6)
        expect(m.prepaidPool).toBeGreaterThanOrEqual(-1e-6)
      }
    })
    it(`${name}: ФОТ растёт ступенями по фазам очередей`, () => {
      // Оч.2 = 2031-01 (календарь): фазы привязаны к датам, при задержке
      // стройки openingDate сдвигается внутри runModel — учитываем сдвиг.
      if (!params.fot.phases?.length) return
      const delay = r.scenario.constructionDelayMonths
      const infl = (k: number) => Math.pow(1 + params.general.inflation, Math.floor(k / 12))
      const sal = r.fot.map((m) => m.salaries)
      const [y0, m0] = params.meta.openingDate.split('-').map(Number)
      const kAt = (from: string) => {
        const [y, m] = from.split('-').map(Number)
        return y * 12 + (m - 1) - (y0 * 12 + m0 - 1) - delay
      }
      const at = (count: number[], k: number) => {
        const p2 = { ...params, fot: { ...params.fot, count, phases: [] } }
        return baseSalariesMonthly(p2, 0) * infl(k)
      }
      const [ph1, ph2, ph3] = params.fot.phases
      const k2 = kAt(ph2.from)
      expect(sal[0]).toBeCloseTo(at(params.fot.count, 0), 6)
      expect(sal[k2 - 1]).toBeCloseTo(at(ph1.count, k2 - 1), 6)
      expect(sal[k2]).toBeCloseTo(at(ph2.count, k2), 6)
      expect(sal[kAt(ph3.from)]).toBeCloseTo(at(ph3.count, kAt(ph3.from)), 6)
      expect(sal[k2]).toBeGreaterThan(sal[k2 - 1])
    })
    it(`${name}: налоги неотрицательны; пресейл замкнут`, () => {
      for (const t of r.taxes) {
        expect(t.cit).toBeGreaterThanOrEqual(0)
        expect(t.vatPayable).toBeGreaterThanOrEqual(0)
        expect(t.vatCredit).toBeGreaterThanOrEqual(0)
        expect(t.vatPaid).toBeGreaterThanOrEqual(0)
      }
      expect(sum(r.cashflow.map((m) => m.presale + m.presaleUnwind))).toBeCloseTo(0, 4)
    })
    it(`${name}: детализация переменных статей сходится со статьёй и итогом`, () => {
      // Σ позиций внутри статьи = строка статьи; Σ всех позиций = variableTotal
      for (const m of r.opex) {
        for (const v of m.variable)
          expect(sum(m.variableDetail.filter((d) => d.article === v.article).map((d) => d.amount))).toBeCloseTo(v.amount, 6)
        expect(sum(m.variableDetail.map((d) => d.amount))).toBeCloseTo(m.variableTotal, 6)
      }
    })
    it(`${name}: аренда не убывает год к году при неубывающей загрузке и росте цен ≥ 0`, () => {
      // Ловит каннибализацию членскими слотами (аудит 14, C-2)
      const yr = (y: number) => sum(r.revenue.slice(y * 12, y * 12 + 12).map((m) => m.rental))
      for (let y = 1; y < 5; y++)
        if (r.scenario.bathsLoad[y] >= r.scenario.bathsLoad[y - 1] && r.scenario.priceGrowth >= 0)
          expect(yr(y)).toBeGreaterThanOrEqual(yr(y - 1) * 0.995)
    })
  }

  it('монотонность: NPV падает с ростом WACC, CAPEX; растёт со спросом', () => {
    const base = runModel(params, matrix, items, services, 'Base')
    expect(runModel(params, matrix, items, services, 'Base', { wacc: base.kpis.wacc + 0.01 }).kpis.npv).toBeLessThan(base.kpis.npv)
    expect(runModel(params, matrix, items, services, 'Base', { capexAdj: base.scenario.capexAdj + 0.1 }).kpis.npv).toBeLessThan(base.kpis.npv)
    expect(runModel(params, matrix, items, services, 'Base', { demandMult: 1.1 }).kpis.npv).toBeGreaterThan(base.kpis.npv)
  })

  it('задержка стройки удлиняет CF и ухудшает NPV', () => {
    const m = JSON.parse(JSON.stringify(matrix)) as ScenarioMatrix
    m.constructionDelayMonths = [0, 0, 0]
    const noDelay = runModel(params, m, items, services, 'Base')
    m.constructionDelayMonths = [0, 3, 0]
    const delay = runModel(params, m, items, services, 'Base')
    expect(delay.cashflow).toHaveLength(noDelay.cashflow.length + 3)
    expect(delay.kpis.npv).toBeLessThan(noDelay.kpis.npv)
  })

  it('прачечная: «своя» добавляет ifLaundry-строки в CAPEX и снижает спековую стирку', () => {
    const own = runModel(params, matrix, items, services, 'Base', { mutate: (p) => { p.laundry = { enabled: true } } })
    const out = runModel(params, matrix, items, services, 'Base')
    const laundryEur = params.capexItems
      .filter((i) => i.ifLaundry)
      .reduce((s, i) => s + Number(i.priceEur ?? 0) * Number(i.qty), 0)
    expect(own.capex.totalEur - out.capex.totalEur).toBeCloseTo(laundryEur, 4)
    const laundryCost = (r: typeof out) =>
      sum(r.opex.map((m) => m.variable.filter((v) => v.article === 'Прачечная / текстиль').reduce((s, v) => s + v.amount, 0)))
    expect(laundryCost(own)).toBeLessThan(laundryCost(out))
    expect(laundryCost(out)).toBeGreaterThan(0)
  })

  it('WBS-детализация задаёт цену строки: ΣWBS / wbsQty', () => {
    const base = runModel(params, matrix, items, services, 'Base')
    // qty=1 строка: +€10k в WBS → +€10k в CAPEX
    const r = runModel(params, matrix, items, services, 'Base', {
      mutate: (p) => {
        p.capexItems.find((i) => i.row === 24)!.wbs![0].items[0].eur += 10_000
      },
    })
    expect(r.capex.totalEur).toBeCloseTo(base.capex.totalEur + 10_000, 4)
    // помодульная строка (wbsQty=3): +€3k в WBS → +€1k на каждый активный модуль
    const r2 = runModel(params, matrix, items, services, 'Base', {
      mutate: (p) => {
        p.capexItems.find((i) => i.row === 7)!.wbs![0].items[0].eur += 3_000
      },
    })
    const mods = params.modules.filter((m) => m.status === 'Активен').length
    expect(r2.capex.totalEur).toBeCloseTo(base.capex.totalEur + (3_000 / 3) * mods, 4)
  })

  it('члены: peakShare=0 → нет вытеснения; peakShare=1 → вытеснение максимально', () => {
    const mk = (peak: number) => runModel(params, matrix, items, services, 'Aggressive', { mutate: (p) => { p.members.peakShare = peak } })
    const r0 = mk(0), r1 = mk(1)
    expect(sum(r0.revenue.map((m) => m.displacedSlots))).toBe(0)
    expect(sum(r1.revenue.map((m) => m.displacedSlots))).toBeGreaterThan(0)
    expect(r0.kpis.npv).toBeGreaterThan(r1.kpis.npv)
  })
})
