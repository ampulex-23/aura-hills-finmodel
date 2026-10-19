import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import paramsJson from './data/params.json'
import scenariosJson from './data/scenarios.json'
import nomenclatureJson from './data/nomenclature.json'
import servicesJson from './data/services.json'
import { api, sameBundle, type ModelBundle } from './api'
import type {
  NomenclatureItem, Params, ScenarioMatrix, ServiceSpec, SpecItem,
} from './model/types'

// Отложенный черновик: при входе в режим просмотра версии текущие правки
// прячутся сюда, чтобы просмотр не затирал несохранённую работу.
const STASH_KEY = 'aura-hills-draft-stash'

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
  // ---- версионирование (git на сервере) ----
  versioned: boolean | null          // null — сервер ещё не отвечал
  baseSha: string | null             // sha версии, на которой основан черновик
  dirty: boolean                     // есть несохранённые изменения
  previewSha: string | null          // режим просмотра версии (мутации заблокированы)
  savedState: ModelBundle | null     // последнее серверное состояние (для счётчика diff)
  serverPending: { sha: string; state: ModelBundle } | null // сервер ≠ локальный черновик
  stashInfo: { savedAt: string } | null                     // есть отложенный черновик
  author: string
  setAuthor: (a: string) => void
  syncVersions: () => Promise<void>
  keepDraft: () => void              // оставить локальные изменения
  applyServer: () => void            // взять серверную версию вместо черновика
  restoreStash: () => void           // вернуть отложенный черновик
  saveVersion: (message: string, force?: boolean) => Promise<'ok' | 'conflict' | 'error'>
  loadVersion: (sha: string) => Promise<void>   // read-only просмотр
  exitPreview: () => void
  restoreVersion: (sha: string) => Promise<void>
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
// Экспортирована для тестов.
export function fillDefaults<T>(cur: unknown, def: T): T {
  if (cur === undefined || cur === null) return def
  if (Array.isArray(def)) {
    if (!Array.isArray(cur)) return def
    const tpl = def[def.length - 1]
    // Элементы с полем `code` мёржатся с дефолтом ТОГО ЖЕ кода, а не той же
    // позиции — иначе после удаления/перестановки строк дефолтные поля
    // (weight и т.п.) попадают в чужие записи.
    const byCode = new Map(
      def.filter((d) => d && typeof d === 'object' && 'code' in d)
        .map((d) => [(d as { code: string }).code, d]),
    )
    return cur.map((v, i) => {
      const d =
        v && typeof v === 'object' && 'code' in v && byCode.has((v as { code: string }).code)
          ? byCode.get((v as { code: string }).code)
          : i < def.length ? def[i] : tpl
      return fillDefaults(v, d)
    }) as T
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
    (set, get) => {
      const bundle = (): ModelBundle => ({
        params: get().params, matrix: get().matrix, items: get().items,
        services: get().services, scenario: get().scenario,
      })
      const applyBundle = (b: ModelBundle) =>
        set({ params: b.params, matrix: b.matrix, items: b.items, services: b.services, scenario: b.scenario })
      // Все мутации через edit: в режиме просмотра версии правки заблокированы,
      // любая правка помечает черновик как dirty (не засинхронено с git).
      const edit = (patch: Partial<ModelState>) => {
        if (!get().previewSha) set({ ...patch, dirty: true })
      }
      return {
        ...defaults(),
        scenario: (paramsJson as Params).meta.scenario,
        setScenario: (s) => edit({ scenario: s }),
        setParam: (path, value) => edit({ params: deepSet(get().params, path, value) }),
        setItem: (idx, patch) =>
          edit({ items: get().items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }),
        setMatrixCell: (path, col, value) => {
          const copy = JSON.parse(JSON.stringify(get().matrix))
          const keys = path.split('.')
          // Опциональные блоки очереди 2 могут отсутствовать в старых
          // матрицах — сеем их копией векторов очереди 1 при первой правке
          // (соответствует резолву fallback'а в scenario.ts).
          const p2Base: Record<string, string> = {
            bathsP2: 'baths', steamP2: 'steam', massageP2: 'massage', extraP2: 'extra',
          }
          if (keys.length > 1 && copy[keys[0]] === undefined && p2Base[keys[0]])
            copy[keys[0]] = JSON.parse(JSON.stringify(copy[p2Base[keys[0]]]))
          let cur = copy
          for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]]
          cur[keys[keys.length - 1]][col] = value
          edit({ matrix: copy })
        },
        setServicePrice: (code, price) =>
          edit({
            services: get().services.map((s) => (s.code === code ? { ...s, price } : s)),
          }),
        setSpecQty: (serviceCode, itemIdx, qty) =>
          edit({
            services: get().services.map((s) =>
              s.code === serviceCode
                ? { ...s, items: s.items.map((it, i) => (i === itemIdx ? { ...it, ...(it.kind === 'labor' ? { pct: qty } : { qty }) } : it)) }
                : s,
            ),
          }),
        addItem: (item) => edit({ items: [...get().items, item] }),
        // Удаление позиции заодно вычищает её из составов спек — иначе код
        // остаётся мёртвой строкой и позиция визуально «продолжает участвовать».
        removeItem: (code) =>
          edit({
            items: get().items.filter((i) => i.code !== code),
            services: get().services.map((s) => ({
              ...s,
              items: s.items.filter((e) => !(e.kind === 'material' && e.code === code)),
            })),
          }),
        duplicateItem: (code) => {
          const src = get().items.find((i) => i.code === code)
          if (!src) return
          const prefix = src.code.replace(/\d+$/, '') || 'NC-'
          edit({ items: [...get().items, { ...src, code: nextCode(prefix, get().items.map((i) => i.code)), name: `${src.name} (копия)` }] })
        },
        addService: (service) => edit({ services: [...get().services, service] }),
        removeService: (code) => edit({ services: get().services.filter((s) => s.code !== code) }),
        updateService: (code, patch) =>
          edit({ services: get().services.map((s) => (s.code === code ? { ...s, ...patch } : s)) }),
        addSpecEntry: (serviceCode, entry) =>
          edit({
            services: get().services.map((s) =>
              s.code === serviceCode ? { ...s, items: [...s.items, entry] } : s,
            ),
          }),
        removeSpecEntry: (serviceCode, itemIdx) =>
          edit({
            services: get().services.map((s) =>
              s.code === serviceCode
                ? { ...s, items: s.items.filter((_, i) => i !== itemIdx) }
                : s,
            ),
          }),
        resetAll: () => edit({ ...defaults(), scenario: (paramsJson as Params).meta.scenario }),
        exportJson: () => JSON.stringify(bundle(), null, 2),
        importJson: (json) => {
          const d = JSON.parse(json)
          edit({
            params: d.params ?? get().params,
            matrix: d.matrix ?? get().matrix,
            items: d.items ?? get().items,
            services: d.services ?? get().services,
            scenario: d.scenario ?? get().scenario,
          })
        },
        // ---- версионирование ----
        versioned: null,
        baseSha: null,
        dirty: false,
        previewSha: null,
        savedState: null,
        serverPending: null,
        stashInfo: null,
        author: '',
        setAuthor: (a) => set({ author: a }),
        syncVersions: async () => {
          try {
            const h = await api.health()
            if (!h.versioning) return set({ versioned: false })
            const { head, state } = await api.getState()
            const stash = localStorage.getItem(STASH_KEY)
            const patch: Partial<ModelState> = {
              versioned: true, baseSha: head, savedState: state,
              stashInfo: stash ? JSON.parse(stash).meta : null,
            }
            if (sameBundle(bundle(), state)) set({ ...patch, dirty: false })
            else set({ ...patch, serverPending: { sha: head, state } })
          } catch {
            set({ versioned: false })
          }
        },
        keepDraft: () => set({ serverPending: null, dirty: true }),
        applyServer: () => {
          const p = get().serverPending
          if (!p) return
          applyBundle(p.state)
          set({ serverPending: null, dirty: false, savedState: p.state })
        },
        restoreStash: () => {
          const raw = localStorage.getItem(STASH_KEY)
          if (!raw) return
          applyBundle(JSON.parse(raw).state)
          localStorage.removeItem(STASH_KEY)
          set({ stashInfo: null, serverPending: null, dirty: true })
        },
        saveVersion: async (message, force = false) => {
          try {
            const r = await api.saveState(bundle(), message, get().author || 'web', force ? null : get().baseSha)
            set({ baseSha: r.sha, savedState: bundle(), dirty: false, serverPending: null })
            return 'ok'
          } catch (e) {
            return (e as { status?: number }).status === 409 ? 'conflict' : 'error'
          }
        },
        loadVersion: async (sha) => {
          const { state } = await api.getVersion(sha)
          const savedAt = new Date().toISOString()
          localStorage.setItem(STASH_KEY, JSON.stringify({ meta: { savedAt }, state: bundle() }))
          applyBundle(state)
          set({ previewSha: sha, dirty: false, stashInfo: { savedAt } })
        },
        exitPreview: () => {
          const raw = localStorage.getItem(STASH_KEY)
          if (raw) {
            applyBundle(JSON.parse(raw).state)
            localStorage.removeItem(STASH_KEY)
            set({ previewSha: null, dirty: true, stashInfo: null })
          } else {
            const s = get().savedState
            if (s) applyBundle(s)
            set({ previewSha: null, dirty: false, stashInfo: null })
          }
        },
        restoreVersion: async (sha) => {
          const r = await api.restoreVersion(sha, get().author || 'web')
          localStorage.removeItem(STASH_KEY)
          applyBundle(r.state)
          set({
            baseSha: r.sha, savedState: r.state, dirty: false,
            previewSha: null, stashInfo: null, serverPending: null,
          })
        },
      }
    },
    {
      name: 'aura-hills-model',
      // v2: номенклатурный реворк — старые снапшоты (115 позиций, старые коды
      // спек) несовместимы → migrate сбрасывает к новым дефолтам.
      // v5: аудит 14 — новая форма матрицы сценариев (полные 5-летние векторы),
      // CAPM/WACC, members.peakShare, capexMaint и т.д. → сброс к дефолтам.
      // v6: смета CAPEX переведена с ₽ на € (priceRub → priceEur, курса нет) → сброс.
      // v7: меню услуг переехало из params.procedures в веса спек (spec.weight) → сброс.
      version: 7,
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
      // Персистим только данные модели + имя автора: поля версионирования
      // (baseSha/dirty/previewSha/…) — сессионные, на старте их восстановит syncVersions.
      partialize: (s) => ({
        params: s.params, matrix: s.matrix, items: s.items,
        services: s.services, scenario: s.scenario, author: s.author,
      }),
    },
  ),
)

export function useResult(scenarioOverride?: string) {
  const { params, matrix, items, scenario } = useModel()
  const s = scenarioOverride ?? scenario
  return { params, matrix, items, scenario: s }
}
