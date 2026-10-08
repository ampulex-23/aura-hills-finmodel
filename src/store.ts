import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import paramsJson from './data/params.json'
import scenariosJson from './data/scenarios.json'
import nomenclatureJson from './data/nomenclature.json'
import servicesJson from './data/services.json'
import type {
  NomenclatureItem, Params, ScenarioMatrix, ServiceSpec, SpecItem,
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
  scenario: string
  setScenario: (s: string) => void
  setParam: (path: string, value: unknown) => void
  setItem: (idx: number, patch: Partial<NomenclatureItem>) => void
  setMatrixCell: (path: string, col: number, value: number) => void
  setServicePrice: (code: string, price: number) => void
  setSpecQty: (serviceCode: string, itemIdx: number, qty: number) => void
  // CRUD по справочникам
  addItem: (item: NomenclatureItem) => void
  removeItem: (code: string) => void
  duplicateItem: (code: string) => void
  addService: (service: ServiceSpec) => void
  removeService: (code: string) => void
  updateService: (code: string, patch: Partial<ServiceSpec>) => void
  addSpecEntry: (serviceCode: string, entry: SpecItem) => void
  removeSpecEntry: (serviceCode: string, itemIdx: number) => void
  resetAll: () => void
  exportJson: () => string
  importJson: (json: string) => void
}

const defaults = () => ({
  params: paramsJson as Params,
  matrix: scenariosJson as ScenarioMatrix,
  items: nomenclatureJson as NomenclatureItem[],
  services: servicesJson.services as ServiceSpec[],
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

// Рекурсивно добирает недостающие ключи из дефолтов. Массивы: элементы сверх
// дефолтной длины мёржатся с последним элементом-шаблоном (новые поля внутри
// пользовательских объектов тоже заполняются — modules[i].status и т.п.).
function fillDefaults<T>(cur: unknown, def: T): T {
  if (cur === undefined || cur === null) return def
  if (Array.isArray(def)) {
    if (!Array.isArray(cur)) return def
    const tpl = def[def.length - 1]
    return cur.map((v, i) => fillDefaults(v, i < def.length ? def[i] : tpl)) as T
  }
  if (def !== null && typeof def === 'object') {
    if (typeof cur !== 'object') return def
    const out: Record<string, unknown> = { ...(cur as Record<string, unknown>) }
    for (const k of Object.keys(def as Record<string, unknown>))
      out[k] = fillDefaults((cur as Record<string, unknown>)[k], (def as Record<string, unknown>)[k])
    return out as T
  }
  return cur as T
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
              ? { ...s, items: s.items.map((it, i) => (i === itemIdx ? { ...it, ...(it.kind === 'labor' ? { pct: qty } : { qty }) } : it)) }
              : s,
          ),
        }),
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
      resetAll: () => set({ ...defaults(), scenario: (paramsJson as Params).meta.scenario }),
      exportJson: () =>
        JSON.stringify(
          {
            params: get().params, matrix: get().matrix, items: get().items,
            services: get().services, scenario: get().scenario,
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
          scenario: d.scenario ?? get().scenario,
        })
      },
    }),
    {
      name: 'aura-hills-model',
      // v2: номенклатурный реворк — старые снапшоты (115 позиций, старые коды
      // спек) несовместимы → migrate сбрасывает к новым дефолтам.
      version: 2,
      storage: createJSONStorage(() => debouncedLocalStorage),
      // Устаревшая форма состояния → сброс к дефолтам вместо падения
      migrate: () =>
        ({ ...defaults(), scenario: (paramsJson as Params).meta.scenario }) as ModelState,
      // Снапшоты старой структуры: добираем отсутствующие блоки (params.it и т.п.) из дефолтов
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ModelState>
        const d = defaults()
        const merged = {
          ...current,
          ...p,
          params: fillDefaults(p.params, d.params),
          matrix: fillDefaults(p.matrix, d.matrix),
          items: fillDefaults(p.items, d.items),
          services: fillDefaults(p.services, d.services),
        } as ModelState
        return merged
      },
      partialize: (s) => ({
        params: s.params, matrix: s.matrix, items: s.items,
        services: s.services, scenario: s.scenario,
      }),
    },
  ),
)

export function useResult(scenarioOverride?: string) {
  const { params, matrix, items, scenario } = useModel()
  const s = scenarioOverride ?? scenario
  return { params, matrix, items, scenario: s }
}
