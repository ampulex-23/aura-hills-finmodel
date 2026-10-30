// Клиент библиотеки документов Data Room (/api/docs/*).
// Сервер хранит документы в отдельном git-репозитории DOCS_DIR —
// каждая правка/удаление это коммит с автором.
export interface LibDoc {
  path: string
  id: string
  title: string
  ext: string
  category: string
  subdir: string | null
  confidential: boolean
  size: number
  updated: string | null
}

export interface DocsTree {
  head: string
  categories: { id: string; title: string; docs: LibDoc[] }[]
}

export interface DocFile {
  path: string
  ext: string
  source: string
  meta: { title?: string; confidential?: boolean }
  head: string
}

export interface DocVersion {
  sha: string
  date: string
  author: string
  message: string
}

const req = async (path: string, init?: RequestInit) => {
  const r = await fetch(path, init)
  const data = await r.json().catch(() => null)
  if (!r.ok) throw Object.assign(new Error(data?.error || `HTTP ${r.status}`), { status: r.status, head: data?.head })
  return data
}
const body = (obj: unknown, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
})

export const docsApi = {
  tree: () => req('/api/docs/tree') as Promise<DocsTree>,
  get: (path: string) => req(`/api/docs/file?path=${encodeURIComponent(path)}`) as Promise<DocFile>,
  save: (path: string, source: string, opts: { title?: string; message?: string; author?: string; base?: string }) =>
    req('/api/docs/file', body({ path, source, ...opts }, 'PUT')) as Promise<{ head: string; unchanged?: boolean }>,
  create: (opts: { category: string; categoryTitle?: string; title: string; slug?: string; source?: string; author?: string }) =>
    req('/api/docs/create', body(opts)) as Promise<{ path: string; head: string }>,
  move: (from: string, to: string, author?: string) =>
    req('/api/docs/move', body({ from, to, author })) as Promise<{ path: string; head: string }>,
  remove: (path: string, opts: { message?: string; author?: string }) =>
    req('/api/docs/file', body({ path, ...opts }, 'DELETE')) as Promise<{ head: string }>,
  saveAsset: (name: string, dataBase64: string, opts: { dir?: string; author?: string }) =>
    req('/api/docs/asset', body({ name, dataBase64, ...opts })) as Promise<{ path: string; head: string }>,
  history: (path: string) =>
    req(`/api/docs/history?path=${encodeURIComponent(path)}`) as Promise<{ history: DocVersion[] }>,
  version: (path: string, sha: string) =>
    req(`/api/docs/version?path=${encodeURIComponent(path)}&sha=${sha}`) as Promise<{ path: string; sha: string; source: string }>,
  rawUrl: (path: string) => `/api/docs/raw?path=${encodeURIComponent(path)}`,
}

export const fileToBase64 = (f: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(f)
  })
