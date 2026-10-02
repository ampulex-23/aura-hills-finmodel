import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import paramsJson from './data/params.json'
import scenariosJson from './data/scenarios.json'
import nomenclatureJson from './data/nomenclature.json'
import servicesJson from './data/services.json'
import type {
  LaborRole, NomenclatureItem, Params, ScenarioMatrix, ServiceSpec, SpecItem,
} from './model/types'

// Запись в localStorage с debounce: NumField дёргает set() на каждый ввод,
// а сериализация всего стейта на keystroke даёт микролаги — пишем раз в 400мс.
const debouncedLocalStorage = (() => {
  let timer: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<string, string>()
  const flush = () => {
    pending.forEach((v, k) => localStorage.setItem(k, v))
    pending.clear()
    timer = null
  }
  return {
    getItem: (k: string) => pending.get(k) ?? localStorage.getItem(k),
    setItem: (k: string, v: string) => {
      pending.set(k, v)
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 400)
    },
    removeItem: (k: string) => {
      pending.delete(k)
      localStorage.removeItem(k)
    },
  }
})()

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
  // CRUD по справочникам
  addItem: (item: NomenclatureItem) => void
  removeItem: (code: string) => void
  duplicateItem: (code: string) => void
  addService: (service: ServiceSpec) => void
  removeService: (code: string) => void
  updateService: (code: string, patch: Partial<ServiceSpec>) => void
  addSpecEntry: (serviceCode: string, entry: SpecItem) => void
  removeSpecEntry: (serviceCode: string, itemIdx: number) => void
  addLaborRole: (role: LaborRole) => void
  removeLaborRole: (role: string) => void
  renameLaborRole: (oldRole: string, newRole: string) => void
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

// Следующий свободный код: максимум числового хвоста среди кодов с тем же префиксом + 1.
export function nextCode(prefix: string, existing: string[]): string {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`)
  let max = 0
  for (const c of existing) {
    const m = c.match(re)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

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
      addItem: (item) => set({ items: [...get().items, item] }),
      removeItem: (code) => set({ items: get().items.filter((i) => i.code !== code) }),
      duplicateItem: (code) => {
        const src = get().items.find((i) => i.code === code)
        if (!src) return
        const prefix = src.code.replace(/\d+$/, '') || 'NC-'
        set({ items: [...get().items, { ...src, code: nextCode(prefix, get().items.map((i) => i.code)), name: `${src.name} (копия)` }] })
      },
      addService: (service) => set({ services: [...get().services, service] }),
      removeService: (code) => set({ services: get().services.filter((s) => s.code !== code) }),
      updateService: (code, patch) =>
        set({ services: get().services.map((s) => (s.code === code ? { ...s, ...patch } : s)) }),
      addSpecEntry: (serviceCode, entry) =>
        set({
          services: get().services.map((s) =>
            s.code === serviceCode ? { ...s, items: [...s.items, entry] } : s,
          ),
        }),
      removeSpecEntry: (serviceCode, itemIdx) =>
        set({
          services: get().services.map((s) =>
            s.code === serviceCode
              ? { ...s, items: s.items.filter((_, i) => i !== itemIdx) }
              : s,
          ),
        }),
      addLaborRole: (role) => set({ labor: [...get().labor, role] }),
      removeLaborRole: (role) => set({ labor: get().labor.filter((l) => l.role !== role) }),
      // Переименование роли протягиваем в составы спецификаций — там ссылки по имени
      renameLaborRole: (oldRole, newRole) =>
        set({
          labor: get().labor.map((l) => (l.role === oldRole ? { ...l, role: newRole } : l)),
          services: get().services.map((s) => ({
            ...s,
            items: s.items.map((e) => (e.kind === 'labor' && e.role === oldRole ? { ...e, role: newRole } : e)),
          })),
        }),
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
      storage: createJSONStorage(() => debouncedLocalStorage),
      // Устаревшая форма состояния → сброс к дефолтам вместо падения
      migrate: () =>
        ({ ...defaults(), scenario: (paramsJson as Params).meta.scenario }) as ModelState,
      // Снапшоты старой структуры: добираем отсутствующие блоки (params.it и т.п.) из дефолтов
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ModelState>
        const merged = { ...current, ...p } as ModelState
        if (merged.params && !merged.params.it) {
          merged.params = { ...merged.params, it: defaults().params.it }
        }
        if (merged.params && !merged.params.fb) {
          merged.params = { ...merged.params, fb: defaults().params.fb }
        }
        if (merged.params && !merged.params.land) {
          merged.params = { ...merged.params, land: defaults().params.land }
        }
        if (merged.params && !merged.params.preopen) {
          merged.params = { ...merged.params, preopen: defaults().params.preopen }
        }
        if (merged.params && !merged.params.members) {
          merged.params = { ...merged.params, members: defaults().params.members }
        }
        if (merged.params && !merged.params.taxDepr) {
          merged.params = { ...merged.params, taxDepr: defaults().params.taxDepr }
        }
        if (merged.params && !merged.params.glampOta) {
          merged.params = { ...merged.params, glampOta: defaults().params.glampOta }
        }
        if (merged.params && !merged.params.tv) {
          merged.params = { ...merged.params, tv: defaults().params.tv }
        }
        if (merged.params?.taxes && merged.params.taxes.gesy === undefined) {
          merged.params.taxes = { ...merged.params.taxes, gesy: defaults().params.taxes.gesy }
        }
        if (merged.params?.units && !merged.params.units.presaleMode) {
          merged.params = { ...merged.params, units: { ...defaults().params.units, ...merged.params.units } }
        }
        return merged
      },
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
