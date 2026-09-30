import type { Params, ResolvedScenario, ScenarioMatrix, ScenarioName } from './types'

// Резолюция сценария: раскрывает матрицу «Сценарии» в годовые векторы [5].
// Логика интерполяции 1:1 с Допущения!C49:G54:
//   steam/massage y2 = y1 + (y3 − y1) * 20/35
//   glamping      y2 = y1 + (y3 − y1) * 15/25
//   members       y2 = ROUND(y1 + (y3 − y1) * 30/70)
//   extra = steam − 0.25
export function resolveScenario(
  params: Params,
  matrix: ScenarioMatrix,
  name: ScenarioName,
): ResolvedScenario {
  const i = matrix.names.indexOf(name)
  if (i < 0) throw new Error(`Unknown scenario: ${name}`)
  const pick = (v: number[]) => v[i]

  const steam = {
    y1: pick(matrix.steam.y1),
    y3: pick(matrix.steam.y3),
  }
  const massage = {
    y1: pick(matrix.massage.y1),
    y3: pick(matrix.massage.y3),
  }
  const glamping = {
    y1: pick(matrix.glamping.y1),
    y3: pick(matrix.glamping.y3),
  }
  const members = {
    y1: pick(matrix.membersMonth.y1),
    y3: pick(matrix.membersMonth.y3),
  }

  const steamLoad = [
    steam.y1,
    steam.y1 + (steam.y3 - steam.y1) * (20 / 35),
    steam.y3,
    Math.min(1, steam.y3 + 0.05),
    Math.min(1, steam.y3 + 0.05),
  ]
  const massageLoad = [
    massage.y1,
    massage.y1 + (massage.y3 - massage.y1) * (20 / 35),
    massage.y3,
    massage.y3 + 0.05,
    massage.y3 + 0.1,
  ]
  const glampLoad = [
    glamping.y1,
    glamping.y1 + (glamping.y3 - glamping.y1) * (15 / 25),
    glamping.y3,
    glamping.y3 + 0.05,
    glamping.y3 + 0.1,
  ]
  const membersMonth = [
    members.y1,
    Math.round(members.y1 + (members.y3 - members.y1) * (30 / 70)),
    members.y3,
    Math.round(members.y3 * 1.25),
    Math.round(members.y3 * (170 / 120)),
  ]

  const isPackage = params.meta.mode === 'Да'
  const uptake = pick(matrix.uptake)
  const activeMods = params.modules.filter((m) => m.status === 'Активен')
  const avgCapacity =
    activeMods.reduce((s, m) => s + m.capacity, 0) / Math.max(1, activeMods.length)

  // Пре-сейл: сертификаты + мес. членства (год 1) + годовые план/12 — Допущения!C131
  const presaleMonthly =
    params.units.certsPerMonth * params.prices.certificate +
    membersMonth[0] * params.prices.membershipMonth +
    (params.units.annualMembersPlan[0] * params.prices.membershipYear) / 12

  return {
    name,
    bathsLoad: matrix.baths
      ? [
          pick(matrix.baths.y1),
          pick(matrix.baths.y2),
          pick(matrix.baths.y3),
          pick(matrix.baths.y4),
          pick(matrix.baths.y5),
        ]
      : [],
    steamLoad,
    massageLoad,
    extraLoad: steamLoad.map((v) => v - 0.25),
    glampLoad,
    membersMonth,
    priceGrowth: pick(matrix.priceGrowth),
    capexAdj: pick(matrix.capexAdj),
    rampMonths: pick(matrix.rampMonths),
    uptake,
    effectiveUptake: isPackage ? 1 : uptake,
    presaleMonthly,
    activeModules: activeMods.length,
    avgCapacity,
  }
}
