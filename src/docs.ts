// Документы Data Room. Два источника:
// 1) встроенные — .md в src/docs/ (коммитятся в git приложения, бандлятся
//    статикой) + презентация (слайды) + генплан (артефакты bim-as-code);
// 2) библиотека — документы из серверного DOCS_DIR (git-репо документов),
//    загружаются через /api/docs/tree, редактируются из UI.
import { useCallback, useEffect, useState } from 'react'
import { docsApi, type DocsTree, type LibDoc } from './lib/docsApi'

const raw = import.meta.glob('./docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const slideUrls = import.meta.glob('./docs/deck/*.jpg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const DECK_SLIDES = Object.keys(slideUrls)
  .sort()
  .map((k) => slideUrls[k])

export interface DocEntry {
  id: string
  title: string
  navTitle: string
  source: string
  kind: 'md' | 'deck' | 'genplan' | 'lib'
  /** путь в DOCS_DIR (только kind='lib') */
  path?: string
  ext?: string
  /** отображаемая категория в дереве Data Room */
  category: string
  builtin: boolean
}

const NAV_TITLES: Record<string, string> = {
  'model-guide': 'Руководство',
}
const BUILTIN_CATEGORY: Record<string, string> = {
  'pitch-deck': 'Презентация',
  'genplan': 'Проект',
  'model-guide': 'Финансы',
  'navigation': 'Навигация',
}

export const BUILTIN_DOCS: DocEntry[] = [
  {
    id: 'pitch-deck',
    title: 'Презентация проекта',
    navTitle: 'Презентация',
    source: '',
    kind: 'deck',
    category: 'Презентация',
    builtin: true,
  },
  {
    id: 'genplan',
    title: 'Генплан участка',
    navTitle: 'Генплан',
    source: '',
    kind: 'genplan',
    category: 'Проект',
    builtin: true,
  },
  ...Object.entries(raw)
    .map(([path, source]) => {
      const id = path.replace('./docs/', '').replace(/\.md$/, '')
      const title = source.match(/^#\s+(.+)/m)?.[1]?.trim() ?? id
      return {
        id, title, navTitle: NAV_TITLES[id] ?? title, source,
        kind: 'md' as const,
        category: BUILTIN_CATEGORY[id] ?? 'Прочее',
        builtin: true,
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id)),
]

// Обратная совместимость
export const DOCS = BUILTIN_DOCS
export const getDoc = (id: string) => DOCS.find((d) => d.id === id)

export const libToEntry = (d: LibDoc): DocEntry => ({
  id: d.id,
  title: d.title,
  navTitle: d.title,
  source: '',
  kind: 'lib',
  path: d.path,
  ext: d.ext,
  category: d.category,
  builtin: false,
})

// Канонический порядок разделов в дереве Data Room
const CAT_ORDER = ['Презентация', 'Концепция', 'Продукт', 'Проект', 'Финансы', 'Юридическое', 'Навигация', 'Входящие', 'inbox']
const catIdx = (t: string) => {
  const i = CAT_ORDER.indexOf(t)
  return i < 0 ? 900 : i
}

/** Объединённое дерево: встроенные + библиотека, сгруппировано по названию раздела.
 *  Встроенные md-документы (Руководство и др.) засеваются сервером в DOCS_DIR —
 *  если в библиотеке есть doc с тем же slug, показываем библиотечный (редактируемый),
 *  а статичный дубль скрываем. */
export function docGroups(tree: DocsTree | null): { title: string; docs: DocEntry[] }[] {
  const map = new Map<string, DocEntry[]>()
  const put = (d: DocEntry, catTitle: string) => {
    const arr = map.get(catTitle) ?? []
    arr.push(d)
    map.set(catTitle, arr)
  }
  const libSlugs = new Set(
    (tree?.categories ?? []).flatMap((c) =>
      c.docs.map((d) => d.id.split('/').pop()))
  )
  for (const d of BUILTIN_DOCS) {
    if (d.kind === 'md' && libSlugs.has(d.id)) continue
    put(d, d.category)
  }
  const catTitle = new Map((tree?.categories ?? []).map((c) => [c.id, c.title]))
  for (const c of tree?.categories ?? [])
    for (const d of c.docs) put(libToEntry(d), catTitle.get(c.id) ?? c.title)
  return [...map.entries()]
    .sort((a, b) => catIdx(a[0]) - catIdx(b[0]) || a[0].localeCompare(b[0]))
    .map(([title, docs]) => ({ title, docs }))
}

/** Хук загрузки дерева библиотеки. enabled=false — сервер без git/docs. */
export function useDocLibrary() {
  const [tree, setTree] = useState<DocsTree | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const refresh = useCallback(async () => {
    try {
      setTree(await docsApi.tree())
      setEnabled(true)
    } catch {
      setEnabled(false)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { tree, enabled, refresh }
}
