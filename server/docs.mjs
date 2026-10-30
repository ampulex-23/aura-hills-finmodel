// Библиотека документов Data Room — git-версионирование, как у состояния модели.
// DOCS_DIR — отдельный git-репозиторий (НЕ внутри репо приложения).
// Файловая система = дерево: <категория>/<подраздел>/<slug>.md|.typ,
// оригиналы импортируемых файлов и вложения — в assets/.
// manifest.json — порядок категорий/документов и метаданные (title, confidential).
// Каждая правка = один коммит; удаление тоже коммит — история append-only.
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises'
import { join, normalize, dirname, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DOCS_DIR = process.env.DOCS_DIR || join(REPO_ROOT, 'docs-data')
const DOCS_REMOTE = process.env.DOCS_REMOTE || ''
const DOC_EXT = new Set(['.md', '.typ'])

const MIME = {
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.gif': 'image/gif', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.typ': 'text/plain; charset=utf-8',
  '.zip': 'application/zip', '.csv': 'text/csv; charset=utf-8',
}

const git = (args) =>
  new Promise((resolve, reject) =>
    execFile('git', args, { cwd: DOCS_DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (e, out, err) =>
      e ? reject(Object.assign(new Error('git ' + args[0] + ': ' + (err || e.message).trim()), { stderr: err }))
        : resolve(out)))

let queue = Promise.resolve()
const enqueue = (fn) => (queue = queue.then(fn, fn))

const exists = async (p) => { try { await stat(p); return true } catch { return false } }
const atomicWrite = async (p, data) => {
  await mkdir(dirname(p), { recursive: true })
  const tmp = p + '.tmp'
  await writeFile(tmp, data)
  await rename(tmp, p)
}

// ---------- валидация путей ----------
// Относительный posix-путь внутри DOCS_DIR. Никаких .., абсолютных, ~, NUL.
function cleanPath(p) {
  if (typeof p !== 'string') return null
  const rel = p.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!rel || rel.length > 400 || /[\x00-\x1f~`]/.test(rel)) return null
  const norm = normalize(rel).replace(/\\/g, '/')
  if (norm === '.' || norm.startsWith('..') || norm.includes('/../') || norm !== rel.replace(/\/+/g, '/')) return null
  return norm
}
const isDocPath = (p) => p && DOC_EXT.has(extname(p).toLowerCase()) && !p.startsWith('assets/') && basename(p) !== 'manifest.json'
const isAssetPath = (p) => p && p.startsWith('assets/') && !DOC_EXT.has(extname(p).toLowerCase())

const TRANSLIT = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
}
export const slugify = (s) =>
  s.toLowerCase().split('').map((c) => TRANSLIT[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'doc'

// ---------- manifest ----------
async function readManifest(rev = null) {
  const text = rev
    ? await git(['show', `${rev}:manifest.json`]).catch(() => null)
    : await readFile(join(DOCS_DIR, 'manifest.json'), 'utf8').catch(() => null)
  if (text == null) return { categories: [], order: [], docs: {} }
  try {
    const m = JSON.parse(text)
    return {
      categories: Array.isArray(m.categories) ? m.categories : [],
      order: Array.isArray(m.order) ? m.order : [],
      docs: m.docs && typeof m.docs === 'object' ? m.docs : {},
    }
  } catch { return { categories: [], order: [], docs: {} } }
}

async function writeManifest(m, author, message) {
  await atomicWrite(join(DOCS_DIR, 'manifest.json'), JSON.stringify(m, null, 2))
  return commit(`${author}`, `${message}`)
}

// ---------- git-обвязка ----------
async function commit(author, message) {
  await git(['add', '-A'])
  try {
    await git(['-c', `user.name=${String(author).slice(0, 80)}`, '-c', 'user.email=aura-docs@local',
      'commit', '-m', String(message).slice(0, 300)])
  } catch (e) {
    if (/nothing to commit/.test((e.stderr || '') + (e.message || ''))) return null
    throw e
  }
  const next = (await git(['rev-parse', 'HEAD'])).trim()
  push()
  return next
}

async function push() {
  if (!DOCS_REMOTE) return
  try { await git(['push', '-u', 'origin', 'main']) }
  catch (e) { console.error('[docs] push failed (non-fatal):', e.message.slice(0, 300)) }
}

const sha = () => git(['rev-parse', 'HEAD']).then((s) => s.trim())

let ready = null
function bootstrap() {
  if (ready) return ready
  ready = (async () => {
    await mkdir(join(DOCS_DIR, 'assets'), { recursive: true })
    // rev-parse --is-inside-work-tree истинен и внутри чужого репо —
    // DOCS_DIR должен быть корнем СВОЕГО репозитория, иначе коммиты
    // уедут в репо приложения.
    const top = await git(['rev-parse', '--show-toplevel']).then((s) => s.trim()).catch(() => null)
    const isRepo = !!top && normalize(top) === normalize(DOCS_DIR)
    if (!isRepo) {
      await git(['init', '-b', 'main'])
      await git(['config', 'user.name', 'AURA Docs']).catch(() => {})
      await git(['config', 'user.email', 'aura-docs@local']).catch(() => {})
    }
    if (DOCS_REMOTE) {
      const remotes = await git(['remote']).catch(() => '')
      if (!remotes.split('\n').includes('origin'))
        await git(['remote', 'add', 'origin', DOCS_REMOTE])
    }
    if (!(await exists(join(DOCS_DIR, 'manifest.json')))) {
      const m = {
        categories: [
          { id: 'concept', title: 'Концепция' },
          { id: 'product', title: 'Продукт' },
          { id: 'project', title: 'Проект' },
          { id: 'finance', title: 'Финансы' },
          { id: 'legal', title: 'Юридическое' },
          { id: 'inbox', title: 'Входящие' },
        ],
        order: [],
        docs: {},
      }
      await atomicWrite(join(DOCS_DIR, 'manifest.json'), JSON.stringify(m, null, 2))
      await git(['add', '-A'])
      await git(['-c', 'user.name=AURA Docs', '-c', 'user.email=aura-docs@local',
        'commit', '-m', 'baseline: manifest с категориями Data Room'])
      await push()
    }
    return true
  })().catch((e) => { console.error('[docs] bootstrap failed:', e.message); ready = null; return false })
  return ready
}

// ---------- дерево ----------
const titleOf = (source, fallback) =>
  source.match(/^#\s+(.+)/m)?.[1]?.trim() ?? fallback

async function scanDocs() {
  const files = []
  async function walk(dir, rel) {
    let entries = []
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'assets') continue
        await walk(join(dir, e.name), r)
      } else if (e.isFile() && DOC_EXT.has(extname(e.name).toLowerCase()) && e.name !== 'manifest.json') {
        files.push(r)
      }
    }
  }
  await walk(DOCS_DIR, '')
  return files
}

export const docsApi = {
  async isReady() { return bootstrap() },

  async tree() {
    if (!(await bootstrap())) throw new Error('docs unavailable')
    const [m, files] = await Promise.all([readManifest(), scanDocs()])
    const entries = await Promise.all(files.map(async (path) => {
      const st = await stat(join(DOCS_DIR, path)).catch(() => null)
      const meta = m.docs[path] ?? {}
      let title = meta.title
      if (!title) {
        const src = await readFile(join(DOCS_DIR, path), 'utf8').catch(() => '')
        title = titleOf(src, basename(path).replace(/\.[^.]+$/, ''))
      }
      const segs = path.split('/')
      return {
        path,
        id: path.replace(/\.[^.]+$/, ''),
        title,
        ext: extname(path).slice(1),
        category: segs[0] ?? 'inbox',
        subdir: segs.slice(1, -1).join('/') || null,
        confidential: Boolean(meta.confidential),
        size: st?.size ?? 0,
        updated: st?.mtime?.toISOString() ?? null,
      }
    }))
    const orderIdx = new Map(m.order.map((p, i) => [p, i]))
    const catIdx = new Map(m.categories.map((c, i) => [c.id, i]))
    const knownCats = new Map(m.categories.map((c) => [c.id, c.title]))
    for (const e of entries)
      if (!knownCats.has(e.category)) knownCats.set(e.category, e.category)
    const categories = [...knownCats.entries()]
      .sort((a, b) => (catIdx.get(a[0]) ?? 999) - (catIdx.get(b[0]) ?? 999))
      .map(([id, title]) => ({
        id, title,
        docs: entries.filter((e) => e.category === id)
          .sort((a, b) => (orderIdx.get(a.path) ?? 999) - (orderIdx.get(b.path) ?? 999) || a.path.localeCompare(b.path)),
      }))
      .filter((c) => c.docs.length || m.categories.some((x) => x.id === c.id))
    return { head: await sha(), categories }
  },

  async get(path) {
    if (!(await bootstrap())) throw new Error('docs unavailable')
    const p = cleanPath(path)
    if (!isDocPath(p)) { const e = new Error('bad path'); e.status = 400; throw e }
    const source = await readFile(join(DOCS_DIR, p), 'utf8').catch(() => null)
    if (source == null) { const e = new Error('not found'); e.status = 404; throw e }
    const m = await readManifest()
    return { path: p, ext: extname(p).slice(1), source, meta: m.docs[p] ?? {}, head: await sha() }
  },

  // Бинарная выдача (assets/ и сам документ как файл для скачивания)
  async raw(path) {
    if (!(await bootstrap())) throw new Error('docs unavailable')
    const p = cleanPath(path)
    if (!p || (!isAssetPath(p) && !isDocPath(p))) { const e = new Error('bad path'); e.status = 400; throw e }
    const full = join(DOCS_DIR, p)
    const st = await stat(full).catch(() => null)
    if (!st?.isFile()) { const e = new Error('not found'); e.status = 404; throw e }
    const data = await readFile(full)
    return { data, mime: MIME[extname(p).toLowerCase()] ?? 'application/octet-stream', name: basename(p) }
  },

  async save(body) {
    if (!(await bootstrap())) throw new Error('docs unavailable')
    const p = cleanPath(body.path)
    if (!isDocPath(p)) { const e = new Error('bad path'); e.status = 400; throw e }
    if (typeof body.source !== 'string' || body.source.length > 2_000_000) {
      const e = new Error('bad source'); e.status = 400; throw e
    }
    const author = String(body.author || 'web').slice(0, 80)
    return enqueue(async () => {
      const head = await sha()
      if (body.base && body.base !== head) {
        const e = new Error('conflict'); e.status = 409; e.head = head; throw e
      }
      const isNew = !(await exists(join(DOCS_DIR, p)))
      await atomicWrite(join(DOCS_DIR, p), body.source)
      const m = await readManifest()
      if (body.title && m.docs[p]?.title !== body.title) {
        m.docs[p] = { ...(m.docs[p] ?? {}), title: String(body.title).slice(0, 200) }
        await atomicWrite(join(DOCS_DIR, 'manifest.json'), JSON.stringify(m, null, 2))
      }
      const next = await commit(author, body.message || (isNew ? `docs: +${p}` : `docs: ${p}`))
      return { head: next ?? head, sha: next ?? head, unchanged: !next }
    })
  },

  async create(body) {
    if (!(await bootstrap())) throw new Error('docs unavailable')
    const cat = slugify(String(body.category || 'inbox'))
    const title = String(body.title || 'Новый документ').slice(0, 200)
    const base = slugify(body.slug || title)
    return enqueue(async () => {
      let p = `${cat}/${base}.md`
      for (let i = 2; await exists(join(DOCS_DIR, p)); i++) p = `${cat}/${base}-${i}.md`
      const src = `# ${title}\n\n${String(body.source ?? '').replace(/^#\s+.*\n/, '')}`
      await atomicWrite(join(DOCS_DIR, p), src)
      const m = await readManifest()
      if (!m.categories.some((c) => c.id === cat)) {
        m.categories.push({ id: cat, title: String(body.categoryTitle || cat).slice(0, 80) })
      }
      m.docs[p] = { title }
      await atomicWrite(join(DOCS_DIR, 'manifest.json'), JSON.stringify(m, null, 2))
      const next = await commit(String(body.author || 'web'), `docs: +${p}`)
      return { path: p, head: next }
    })
  },

  async move(body) {
    if (!(await bootstrap())) throw new Error('docs unavailable')
    const from = cleanPath(body.from)
    const to = cleanPath(body.to)
    if (!isDocPath(from) || !isDocPath(to)) { const e = new Error('bad path'); e.status = 400; throw e }
    return enqueue(async () => {
      if (!(await exists(join(DOCS_DIR, from)))) { const e = new Error('not found'); e.status = 404; throw e }
      if (await exists(join(DOCS_DIR, to))) { const e = new Error('target exists'); e.status = 409; throw e }
      await mkdir(dirname(join(DOCS_DIR, to)), { recursive: true })
      await rename(join(DOCS_DIR, from), join(DOCS_DIR, to))
      const m = await readManifest()
      if (m.docs[from]) { m.docs[to] = m.docs[from]; delete m.docs[from] }
      m.order = m.order.map((p) => (p === from ? to : p))
      await atomicWrite(join(DOCS_DIR, 'manifest.json'), JSON.stringify(m, null, 2))
      const next = await commit(String(body.author || 'web'), `docs: ${from} → ${to}`)
      return { path: to, head: next }
    })
  },

  async remove(body) {
    if (!(await bootstrap())) throw new Error('docs unavailable')
    const p = cleanPath(body.path)
    if (!isDocPath(p)) { const e = new Error('bad path'); e.status = 400; throw e }
    return enqueue(async () => {
      if (!(await exists(join(DOCS_DIR, p)))) { const e = new Error('not found'); e.status = 404; throw e }
      await unlink(join(DOCS_DIR, p))
      const m = await readManifest()
      delete m.docs[p]
      m.order = m.order.filter((x) => x !== p)
      await atomicWrite(join(DOCS_DIR, 'manifest.json'), JSON.stringify(m, null, 2))
      const next = await commit(String(body.author || 'web'), `docs: -${p} (${String(body.message || 'удалён').slice(0, 120)})`)
      return { head: next }
    })
  },

  async saveAsset(body) {
    if (!(await bootstrap())) throw new Error('docs unavailable')
    const name = String(body.name || 'file')
    const ext = extname(name).toLowerCase()
    const base = slugify(basename(name, extname(name)))
    const dir = cleanPath(body.dir || 'assets') || 'assets'
    if (!dir.startsWith('assets')) { const e = new Error('assets only'); e.status = 400; throw e }
    let buf
    try { buf = Buffer.from(String(body.dataBase64 || ''), 'base64') } catch { buf = null }
    if (!buf?.length || buf.length > 60_000_000) { const e = new Error('bad data'); e.status = 400; throw e }
    return enqueue(async () => {
      let p = `${dir}/${base}${ext}`
      for (let i = 2; await exists(join(DOCS_DIR, p)); i++) p = `${dir}/${base}-${i}${ext}`
      await atomicWrite(join(DOCS_DIR, p), buf)
      const next = await commit(String(body.author || 'web'), `docs: asset ${p}`)
      return { path: p, head: next }
    })
  },

  async history(path, limit = 100) {
    if (!(await bootstrap())) throw new Error('docs unavailable')
    const p = cleanPath(path)
    if (!p) { const e = new Error('bad path'); e.status = 400; throw e }
    const out = await git(['log', '--follow', `--format=%H%x1f%aI%x1f%an%x1f%s`, '-n', String(limit), '--', p])
    return out.trim().split('\n').filter(Boolean).map((line) => {
      const [s, date, author, message] = line.split('\x1f')
      return { sha: s, date, author, message }
    })
  },

  async version(path, rev) {
    if (!(await bootstrap())) throw new Error('docs unavailable')
    const p = cleanPath(path)
    if (!p || !/^[0-9a-f]{7,40}$/i.test(rev)) { const e = new Error('bad args'); e.status = 400; throw e }
    const source = await git(['show', `${rev}:${p}`]).catch(() => null)
    if (source == null) { const e = new Error('not found'); e.status = 404; throw e }
    return { path: p, sha: rev, source }
  },

  async saveManifest(body) {
    if (!(await bootstrap())) throw new Error('docs unavailable')
    const m = await readManifest()
    if (Array.isArray(body.categories)) {
      m.categories = body.categories
        .filter((c) => c && typeof c.id === 'string')
        .map((c) => ({ id: String(c.id).slice(0, 60), title: String(c.title || c.id).slice(0, 80) }))
    }
    if (Array.isArray(body.order)) m.order = body.order.map(String).slice(0, 500)
    if (body.docs && typeof body.docs === 'object') {
      for (const [k, v] of Object.entries(body.docs)) {
        const p = cleanPath(k)
        if (p) m.docs[p] = { ...(m.docs[p] ?? {}), ...(typeof v === 'object' ? v : {}) }
      }
    }
    return enqueue(async () => {
      const head = await writeManifest(m, String(body.author || 'web'), body.message || 'docs: manifest')
      return { head: head ?? (await sha()) }
    })
  },
}
