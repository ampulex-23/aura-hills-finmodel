import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import paramsJson from './data/params.json'
import scenariosJson from './data/scenarios.json'
import nomenclatureJson from './data/nomenclature.json'
import servicesJson from './data/services.json'
import type {
  LaborRole, NomenclatureItem, Params, ScenarioMatrix, ServiceSpec,
} from './model/types'

interface ModelState {
  params: Params
  matrix: ScenarioMatrix
  items: NomenclatureItem[]
  services: ServiceSpec[]
  labor: LaborRole[]
  scenario: string
  setScenario: (s: string) => void
  setParam: (path: string, value: unknown) => void
  setItem: (idx: number, patch: Partial<NomenclatureItem>) => void
  setMatrixCell: (path: string, col: number, value: number) => void
  setServicePrice: (code: string, price: number) => void
  setSpecQty: (serviceCode: string, itemIdx: number, qty: number) => void
  setLaborRate: (role: string, rateHour: number) => void
  resetAll: () => void
  exportJson: () => string
  importJson: (json: string) => void
}

const defaults = () => ({
  params: paramsJson as Params,
  matrix: scenariosJson as ScenarioMatrix,
  items: nomenclatureJson as NomenclatureItem[],
  services: servicesJson.services as ServiceSpec[],
  labor: servicesJson.labor as LaborRole[],
})

// setParam('general.wacc', 0.12) — точечное обновление по пути
function deepSet<T>(obj: T, path: string, value: unknown): T {
  const copy: any = JSON.parse(JSON.stringify(obj))
  const keys = path.split('.')
  let cur = copy
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]]
  cur[keys[keys.length - 1]] = value
  return copy
}

export const useModel = create<ModelState>()(
  persist(
    (set, get) => ({
      ...defaults(),
      scenario: (paramsJson as Params).meta.scenario,
      setScenario: (s) => set({ scenario: s }),
      setParam: (path, value) => set({ params: deepSet(get().params, path, value) }),
      setItem: (idx, patch) =>
        set({ items: get().items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }),
      setMatrixCell: (path, col, value) => {
        const m = get().matrix as any
        const copy = JSON.parse(JSON.stringify(m))
        const keys = path.split('.')
        let cur = copy
        for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]]
        cur[keys[keys.length - 1]][col] = value
        set({ matrix: copy })
      },
      setServicePrice: (code, price) =>
        set({
          services: get().services.map((s) => (s.code === code ? { ...s, price } : s)),
        }),
      setSpecQty: (serviceCode, itemIdx, qty) =>
        set({
          services: get().services.map((s) =>
            s.code === serviceCode
              ? { ...s, items: s.items.map((it, i) => (i === itemIdx ? { ...it, ...(it.kind === 'labor' ? { minutes: qty } : { qty }) } : it)) }
              : s,
          ),
        }),
      setLaborRate: (role, rateHour) =>
        set({ labor: get().labor.map((l) => (l.role === role ? { ...l, rateHour } : l)) }),
      resetAll: () => set({ ...defaults(), scenario: (paramsJson as Params).meta.scenario }),
      exportJson: () =>
        JSON.stringify(
          {
            params: get().params, matrix: get().matrix, items: get().items,
            services: get().services, labor: get().labor, scenario: get().scenario,
          },
          null, 2,
        ),
      importJson: (json) => {
        const d = JSON.parse(json)
        set({
          params: d.params ?? get().params,
          matrix: d.matrix ?? get().matrix,
          items: d.items ?? get().items,
          services: d.services ?? get().services,
          labor: d.labor ?? get().labor,
          scenario: d.scenario ?? get().scenario,
        })
      },
    }),
    {
      name: 'aura-hills-model',
      version: 1,
      // Устаревшая форма состояния → сброс к дефолтам вместо падения
      migrate: () =>
        ({ ...defaults(), scenario: (paramsJson as Params).meta.scenario }) as ModelState,
      partialize: (s) => ({
        params: s.params, matrix: s.matrix, items: s.items,
        services: s.services, labor: s.labor, scenario: s.scenario,
      }),
    },
  ),
)

export function useResult(scenarioOverride?: string) {
  const { params, matrix, items, scenario } = useModel()
  const s = scenarioOverride ?? scenario
  return { params, matrix, items, scenario: s }
}
