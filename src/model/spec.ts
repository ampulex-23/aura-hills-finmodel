import { landedCost } from './opex'
import type { LaborRole, NomenclatureItem, ServiceCost, ServiceSpec } from './types'

// Себестоимость услуги = Σ landedCost(материал) × qty + Σ минуты/60 × ставка роли.
// Порт листа «Себестоимость услуг» из исходной модели.
export function costService(
  spec: ServiceSpec,
  items: NomenclatureItem[],
  labor: LaborRole[],
): ServiceCost {
  const byCode = new Map(items.map((i) => [i.code, i]))
  const byRole = new Map(labor.map((l) => [l.role, l.rateHour]))
  let materialsCost = 0
  let laborCost = 0
  for (const it of spec.items) {
    if (it.kind === 'material' && it.code) {
      const m = byCode.get(it.code)
      if (m) materialsCost += landedCost(m) * (it.qty ?? 0)
    } else if (it.kind === 'labor' && it.role) {
      laborCost += ((it.minutes ?? 0) / 60) * (byRole.get(it.role) ?? 0)
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
  labor: LaborRole[],
): ServiceCost[] {
  return services.map((s) => costService(s, items, labor))
}
