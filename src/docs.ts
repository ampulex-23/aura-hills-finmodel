// Документы Data Room: .md-файлы в src/docs/ — коммитятся в git,
// бандлятся статикой (Vite raw import) и рендерятся с формулами/таблицами.
const raw = import.meta.glob('./docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export interface DocEntry {
  id: string
  title: string
  navTitle: string
  source: string
}

export const DOCS: DocEntry[] = Object.entries(raw)
  .map(([path, source]) => {
    const id = path.replace('./docs/', '').replace(/\.md$/, '')
    const title = source.match(/^#\s+(.+)/m)?.[1]?.trim() ?? id
    return { id, title, navTitle: title.replace(/^AURA HILLS\s*—\s*/, ''), source }
  })
  .sort((a, b) => a.id.localeCompare(b.id))

export const getDoc = (id: string) => DOCS.find((d) => d.id === id)
