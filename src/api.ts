// Клиент серверного API версионирования состояния модели.
// Сервер (server/state.mjs) хранит state-bundle в git-репо DATA_DIR:
// каждое сохранение — коммит, история append-only, откат = новый коммит.
import type { NomenclatureItem, Params, ScenarioMatrix, ServiceSpec } from './model/types'

export interface ModelBundle {
  params: Params
  matrix: ScenarioMatrix
  items: NomenclatureItem[]
  services: ServiceSpec[]
  scenario: string
}

export interface VersionInfo {
  sha: string
  date: string
  author: string
  message: string
}

const req = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(path, init)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) {
    const e = new Error(body.error || `HTTP ${r.status}`) as Error & { status?: number; head?: string }
    e.status = r.status
    e.head = body.head
    throw e
  }
  return body as T
}

export const api = {
  health: () => req<{ ok: boolean; versioning?: boolean }>('/api/health'),
  getState: () => req<{ head: string; state: ModelBundle }>('/api/state'),
  saveState: (bundle: ModelBundle, message: string, author: string, base?: string | null) =>
    req<{ sha: string; unchanged?: boolean }>('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...bundle, message, author, base: base ?? undefined }),
    }),
  listVersions: () => req<{ versions: VersionInfo[] }>('/api/versions'),
  getVersion: (sha: string) => req<{ sha: string; state: ModelBundle }>(`/api/versions/${sha}`),
  restoreVersion: (sha: string, author: string) =>
    req<{ sha: string; state: ModelBundle }>(`/api/versions/${sha}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author }),
    }),
}

// Каноническая сериализация (ключи отсортированы рекурсивно) — чтобы сравнение
// «локальный черновик == серверная версия» не зависело от порядка ключей.
export const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.keys(val).sort().reduce((o: Record<string, unknown>, k) => ((o[k] = val[k]), o), {})
      : val)

export const sameBundle = (a: ModelBundle, b: ModelBundle) => canon(a) === canon(b)
