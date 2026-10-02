import type { FotMonth, Params, RevenueMonth } from './types'

// ФОТ: оклады × инфляция^год; KPI-бонусы = 30% парений + 30% массажа + 1% выручки; взносы 15.15%
export function computeFotMonth(params: Params, rev: RevenueMonth, k: number): FotMonth {
  const infl = Math.pow(1 + params.general.inflation, Math.floor(k / 12))
  const salaries =
    (params.fot.count.reduce((s, c, i) => s + c * params.fot.salary[i], 0) +
      (params.it.enabled ? params.it.curator : 0) +
      (params.fb.enabled ? params.fb.cookCount * params.fb.cookSalary : 0)) * infl
  const bonuses =
    rev.steamTotal * params.kpi.steamShare +
    rev.massageTotal * params.kpi.massageShare +
    rev.total * params.kpi.revenueShare
  const gross = salaries + bonuses
  const employerContrib = gross * params.taxes.employerRate
  return { salaries, bonuses, gross, employerContrib, total: gross + employerContrib }
}

export function computeFot(params: Params, revenue: RevenueMonth[]): FotMonth[] {
  return revenue.map((r, k) => computeFotMonth(params, r, k))
}
