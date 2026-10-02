// Документы Data Room: .md-файлы в src/docs/ — коммитятся в git,
// бандлятся статикой (Vite raw import) и рендерятся с формулами/таблицами.
// Презентация — отдельный вид записи: слайды-изображения из src/docs/deck/.
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
  kind: 'md' | 'deck'
}

const NAV_TITLES: Record<string, string> = {
  'model-guide': 'Руководство',
}

export const DOCS: DocEntry[] = [
  {
    id: 'pitch-deck',
    title: 'Презентация проекта',
    navTitle: 'Презентация',
    source: '',
    kind: 'deck',
  },
  ...Object.entries(raw)
    .map(([path, source]) => {
      const id = path.replace('./docs/', '').replace(/\.md$/, '')
      const title = source.match(/^#\s+(.+)/m)?.[1]?.trim() ?? id
      return { id, title, navTitle: NAV_TITLES[id] ?? title, source, kind: 'md' as const }
    })
    .sort((a, b) => a.id.localeCompare(b.id)),
]

export const getDoc = (id: string) => DOCS.find((d) => d.id === id)
