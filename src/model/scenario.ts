import type { Params, ResolvedScenario, ScenarioMatrix, ScenarioName, YearVectors } from './types'
import { YEAR_KEYS } from './types'

// Резолюция сценария: матрица «Сценарии» → годовые векторы [5].
// Все потоки заданы явно по пяти годам (аудит 14, W-10): интерполяций и
// унаследованных из Excel коэффициентов (20/35, 15/25, steam−0.25…) больше нет.
export function resolveScenario(
  params: Params,
  matrix: ScenarioMatrix,
  name: ScenarioName,
): ResolvedScenario {
  const i = matrix.names.indexOf(name)
  if (i < 0) throw new Error(`Unknown scenario: ${name}`)
  const pick = (v: number[]) => v[i]
  const years = (v: YearVectors) => YEAR_KEYS.map((y) => pick(v[y]))

  const isPackage = params.meta.mode === 'Да'
  const uptake = pick(matrix.uptake)
  const activeMods = params.modules.filter((m) => m.status === 'Активен')
  const avgCapacity =
    activeMods.reduce((s, m) => s + m.capacity, 0) / Math.max(1, activeMods.length)
  const membersMonth = years(matrix.membersMonth)

  // Пре-сейл: сертификаты + мес. членства (год 1) + годовые план/12
  const presaleMonthly =
    params.units.certsPerMonth * params.prices.certificate +
    membersMonth[0] * params.prices.membershipMonth +
    (params.units.annualMembersPlan[0] * params.prices.membershipYear) / 12

  return {
    name,
    bathsLoad: years(matrix.baths),
    steamLoad: years(matrix.steam),
    massageLoad: years(matrix.massage),
    extraLoad: years(matrix.extra).map((v) => Math.max(0, v)),
    glampLoad: years(matrix.glamping),
    membersMonth,
    priceGrowth: pick(matrix.priceGrowth),
    capexAdj: pick(matrix.capexAdj),
    rampMonths: Math.max(1, pick(matrix.rampMonths)), // 0 молча выключал рампу (деление на 0 → ∞ → min(1,∞)=1)
    uptake,
    effectiveUptake: isPackage ? 1 : uptake,
    presaleMonthly,
    activeModules: activeMods.length,
    avgCapacity,
    constructionDelayMonths: Math.max(0, Math.round(pick(matrix.constructionDelayMonths ?? [0, 0, 0]))),
    energyCostMult: pick(matrix.energyCostMult ?? [1, 1, 1]),
    // Очередь 2: загрузки новых потоков; отсутствие строк = поток выключен
    publicBathLoad: matrix.publicBath ? years(matrix.publicBath) : [0, 0, 0, 0, 0],
    restLoad: matrix.restaurant ? years(matrix.restaurant) : [0, 0, 0, 0, 0],
  }
}
