import type { FotMonth, Params, RevenueMonth, ServiceSpec } from './types'
import { dirCounts } from './revenue'
import { serviceLaborShare } from './spec'

// Численность штата на операционный месяц k: базовый вектор count,
// с месяца `from` каждой фазы — полный вектор фазы (последняя подошедшая
// побеждает). `from` — календарная дата: при задержке стройки openingDate
// уже сдвинута внутри runModel, поэтому фаза остаётся привязанной к календарю.
// delayMonths — для вызовов извне движка (отчёты): туда передают
// scenario.constructionDelayMonths, т.к. их params не сдвинут.
export function headcountAt(params: Params, k: number, delayMonths = 0): number[] {
  const [y0, m0] = params.meta.openingDate.split('-').map(Number)
  const kMonth = y0 * 12 + (m0 - 1) + k + delayMonths
  let count = params.fot.count
  for (const ph of params.fot.phases ?? []) {
    const [y, m] = ph.from.split('-').map(Number)
    if (y * 12 + (m - 1) <= kMonth) count = ph.count
  }
  return count
}

// Базовый фонд окладов месяца k (без бонусов и индексации) — штат + IT-куратор + повар
export function baseSalariesMonthly(params: Params, k = 0, delayMonths = 0): number {
  const count = headcountAt(params, k, delayMonths)
  return (
    count.reduce((s, c, i) => s + c * params.fot.salary[i], 0) +
    (params.it.enabled ? params.it.curator : 0) +
    (params.fb.enabled ? params.fb.cookCount * params.fb.cookSalary : 0)
  )
}

// ФОТ: оклады × инфляция^год + KPI-бонусы из спецификаций услуг.
// Бонус услуги за месяц = продано услуг × прайс спецификации × Σ долей ролей.
// Не провёл ни одной услуги → бонус 0, роль получает голый оклад.
// Роли с окладом (клинер, охрана) в спеки не входят — KPI получают только
// роли, явно указанные в составе услуги с долей pct от её прайса.
export function computeFotMonth(
  params: Params,
  rev: RevenueMonth,
  services: ServiceSpec[],
  k: number,
): FotMonth {
  const infl = Math.pow(1 + params.general.inflation, Math.floor(k / 12))
  const salaries = baseSalariesMonthly(params, k) * infl

  let bonuses = 0
  const byDir = new Map<string, number>()
  const dirOrder = [...new Set(services.map((s) => s.direction))]
  for (const dir of dirOrder) {
    const dirSpecs = services.filter((s) => s.direction === dir)
    const counts = dirCounts(rev, dir, dirSpecs, params)
    dirSpecs.forEach((s, idx) => {
      const amt = (counts[idx] ?? 0) * s.price * serviceLaborShare(s, params)
      if (amt > 0) {
        bonuses += amt
        byDir.set(dir, (byDir.get(dir) ?? 0) + amt)
      }
    })
  }
  const bonusDetail = [...byDir.entries()]
    .map(([d, v]) => `${d.toLowerCase()} €${Math.round(v).toLocaleString('ru-RU')}`)
    .join(' + ')

  const gross = salaries + bonuses
  const employerContrib = gross * params.taxes.employerRate
  return { salaries, bonuses, bonusDetail, gross, employerContrib, total: gross + employerContrib }
}

export function computeFot(
  params: Params,
  revenue: RevenueMonth[],
  services: ServiceSpec[],
): FotMonth[] {
  return revenue.map((r, k) => computeFotMonth(params, r, services, k))
}
