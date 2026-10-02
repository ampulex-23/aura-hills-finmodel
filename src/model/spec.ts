import { landedCost } from './opex'
import type { NomenclatureItem, Params, ServiceCost, ServiceSpec } from './types'

// Норма часов в месяце для перевода оклада в ставку (≈40 ч/нед × 4.33).
export const STAFF_HOURS_PER_MONTH = 173

// Сопоставление ролей спецификаций со штатом: скобки/уточнения срезаются,
// известные расхождения имён — через алиасы (старые снапшоты/правки).
const ROLE_ALIASES: Record<string, string> = {
  'пармейстер': 'пармастер',
}
const normRole = (s: string) => {
  const n = s.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim()
  return ROLE_ALIASES[n] ?? n
}

// Ставка €/час из штатного расписания: оклад × (1 + взносы работодателя) / часы.
// 0 — роль не найдена в штате.
export function deriveRateFromStaff(role: string, params: Params): number {
  const i = params.fot.roles.findIndex((r) => normRole(r) === normRole(role))
  if (i < 0) return 0
  return (params.fot.salary[i] ?? 0) * (1 + params.taxes.employerRate) / STAFF_HOURS_PER_MONTH
}

// Себестоимость услуги = Σ landedCost(материал) × qty + Σ минуты/60 × ставка роли.
// Порт листа «Себестоимость услуг» из исходной модели.
export function costService(
  spec: ServiceSpec,
  items: NomenclatureItem[],
  params: Params,
): ServiceCost {
  const byCode = new Map(items.map((i) => [i.code, i]))
  let materialsCost = 0
  let laborCost = 0
  for (const it of spec.items) {
    if (it.kind === 'material' && it.code) {
      const m = byCode.get(it.code)
      if (m) materialsCost += landedCost(m) * (it.qty ?? 0)
    } else if (it.kind === 'labor' && it.role) {
      laborCost += ((it.minutes ?? 0) / 60) * deriveRateFromStaff(it.role, params)
    }
  }
  const cost = materialsCost + laborCost
  const margin = spec.price - cost
  return {
    spec,
    materialsCost,
    laborCost,
    cost,
    margin,
    marginPct: spec.price > 0 ? margin / spec.price : 0,
  }
}

export function costAllServices(
  services: ServiceSpec[],
  items: NomenclatureItem[],
  params: Params,
): ServiceCost[] {
  return services.map((s) => costService(s, items, params))
}
