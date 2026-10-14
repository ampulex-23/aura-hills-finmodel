// Семантический diff двух снапшотов состояния модели — для вкладки «Версии»
// и бейджа «N изменений». Не сырой git diff: params сравниваются по пути,
// номенклатура и спецификации — по коду (не по индексу), матрица — по ячейке.
import type { ModelBundle } from './api'

export interface DiffEntry {
  section: 'Допущения' | 'Сценарии' | 'Номенклатура' | 'Спецификации'
  key: string         // params.revenue.sauna.price | items.NC-001.price
  label: string       // человекочитаемое
  before: unknown
  after: unknown
  kind: 'change' | 'add' | 'remove'
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

const fmt = (v: unknown): string =>
  v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)

// Рекурсивный обход листьев дерева (числа/строки/булевы, массивы — по индексу)
function walk(a: unknown, b: unknown, path: string, section: DiffEntry['section'], out: DiffEntry[]) {
  if (Object.is(a, b)) return
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
      walk(a[k], b[k], path ? `${path}.${k}` : k, section, out)
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++)
      walk(a[i], b[i], `${path}[${i}]`, section, out)
    return
  }
  out.push({
    section, key: path, label: path,
    before: a, after: b,
    kind: a === undefined ? 'add' : b === undefined ? 'remove' : 'change',
  })
}

// Сравнение массива объектов по ключу (code): добавленные/удалённые/изменённые
function walkKeyed(
  a: { code: string }[] | undefined, b: { code: string }[] | undefined,
  section: DiffEntry['section'], out: DiffEntry[],
) {
  const am = new Map((a ?? []).map((x) => [x.code, x]))
  const bm = new Map((b ?? []).map((x) => [x.code, x]))
  for (const [code, item] of bm) {
    const prev = am.get(code)
    if (!prev) out.push({ section, key: `${section}.${code}`, label: `${code} ${(item as { name?: string }).name ?? ''}`.trim(), before: undefined, after: item, kind: 'add' })
    else walk(prev, item, `${code}`, section, out)
  }
  for (const [code, item] of am)
    if (!bm.has(code))
      out.push({ section, key: `${section}.${code}`, label: `${code} ${(item as { name?: string }).name ?? ''}`.trim(), before: item, after: undefined, kind: 'remove' })
}

export function diffBundles(before: ModelBundle, after: ModelBundle): DiffEntry[] {
  const out: DiffEntry[] = []
  walk(before.params, after.params, '', 'Допущения', out)
  walk(before.matrix, after.matrix, '', 'Сценарии', out)
  walkKeyed(before.items, after.items, 'Номенклатура', out)
  walkKeyed(before.services, after.services, 'Спецификации', out)
  if (before.scenario !== after.scenario)
    out.push({ section: 'Сценарии', key: 'scenario', label: 'Активный сценарий', before: before.scenario, after: after.scenario, kind: 'change' })
  return out
}

export const fmtVal = fmt
