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

  // Пре-сейл: сертификаты + мес. членства (год 1) + годовые план/12.
  // Слагаемые следуют тоглам слоёв: выключенный поток в пресейле не продаётся.
  const presaleMonthly =
    (params.units.certsEnabled ? params.units.certsPerMonth * params.prices.certificate : 0) +
    (params.members.enabled
      ? membersMonth[0] * params.prices.membershipMonth +
        (params.units.annualMembersPlan[0] * params.prices.membershipYear) / 12
      : 0)

  return {
    name,
    bathsLoad: years(matrix.baths),
    steamLoad: years(matrix.steam),
    massageLoad: years(matrix.massage),
    extraLoad: years(matrix.extra).map((v) => Math.max(0, v)),
    // Очередь 2: свои векторы загрузок; строка отсутствует → поток
    // использует вектор очереди 1 (совместимость со старыми матрицами).
    bathsLoadP2: years(matrix.bathsP2 ?? matrix.baths),
    steamLoadP2: years(matrix.steamP2 ?? matrix.steam),
    massageLoadP2: years(matrix.massageP2 ?? matrix.massage),
    extraLoadP2: years(matrix.extraP2 ?? matrix.extra).map((v) => Math.max(0, v)),
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
