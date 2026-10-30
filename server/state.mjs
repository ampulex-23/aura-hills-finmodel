// Версионирование состояния модели через git.
// DATA_DIR — отдельный git-репозиторий (НЕ внутри репо приложения:
// deploy-vds.sh делает git pull --ff-only, вложенный репо его сломает).
// Файлы: params.json, scenarios.json, nomenclature.json, services.json —
// те же имена, что в src/data/, + meta.json (активный сценарий, заметка).
// Каждое сохранение = один коммит. Откат = новый коммит «Restore <sha>» —
// история никогда не переписывается. DATA_REMOTE — опциональный remote
// (приватный репо) для бэкапа: push после каждого коммита, ошибки не фатальны.
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(REPO_ROOT, 'data')
const DATA_REMOTE = process.env.DATA_REMOTE || ''
const SRC_DATA = join(REPO_ROOT, 'src', 'data')
const STATE_FILES = ['params.json', 'scenarios.json', 'nomenclature.json', 'services.json', 'meta.json']

const git = (args) =>
  new Promise((resolve, reject) =>
    execFile('git', args, { cwd: DATA_DIR, encoding: 'utf8' }, (e, out, err) =>
      e ? reject(Object.assign(new Error('git ' + args[0] + ': ' + (err || e.message).trim()), { stderr: err }))
        : resolve(out)))

// Все записи сериализуются — гонка коммитов недопустима
let queue = Promise.resolve()
const enqueue = (fn) => (queue = queue.then(fn, fn))

const exists = async (p) => { try { await readFile(p); return true } catch { return false } }

async function atomicWrite(path, text) {
  const tmp = path + '.tmp'
  await writeFile(tmp, text)
  await rename(tmp, path)
}

let ready = null // Promise<boolean> — репо инициализирован и git доступен
function bootstrap() {
  if (ready) return ready
  ready = (async () => {
    await mkdir(DATA_DIR, { recursive: true })
    // DATA_DIR — корень СВОЕГО репозитория: is-inside-work-tree истинен
    // и внутри чужого репо, тогда коммиты уедут в репо приложения.
    const top = await git(['rev-parse', '--show-toplevel']).then((s) => s.trim()).catch(() => null)
    const isRepo = !!top && normalize(top) === normalize(DATA_DIR)
    if (!isRepo) await git(['init', '-b', 'main'])
    if (DATA_REMOTE) {
      const remotes = await git(['remote']).catch(() => '')
      if (!remotes.split('\n').includes('origin'))
        await git(['remote', 'add', 'origin', DATA_REMOTE])
    }
    // Первый запуск: сеем дефолты из src/data и фиксируем baseline
    if (!(await exists(join(DATA_DIR, 'params.json')))) {
      await git(['config', 'user.name', 'AURA Model']).catch(() => {})
      await git(['config', 'user.email', 'aura-model@local']).catch(() => {})
      for (const [src, dst] of [['params.json', 'params.json'], ['scenarios.json', 'scenarios.json'],
        ['nomenclature.json', 'nomenclature.json'], ['services.json', 'services.json']])
        await copyFile(join(SRC_DATA, src), join(DATA_DIR, dst))
      await atomicWrite(join(DATA_DIR, 'meta.json'),
        JSON.stringify({ scenario: JSON.parse(await readFile(join(DATA_DIR, 'params.json'), 'utf8')).meta?.scenario ?? 'Base' }, null, 2))
      await git(['add', '-A'])
      await git(['-c', 'user.name=AURA Model', '-c', 'user.email=aura-model@local',
        'commit', '-m', 'baseline: дефолты из src/data'])
      await push()
    }
    return true
  })().catch((e) => { console.error('[state] bootstrap failed:', e.message); ready = null; return false })
  return ready
}

async function push() {
  if (!DATA_REMOTE) return
  try { await git(['push', '-u', 'origin', 'main']) }
  catch (e) { console.error('[state] push failed (non-fatal):', e.message.slice(0, 300)) }
}

const sha = () => git(['rev-parse', 'HEAD']).then((s) => s.trim())

async function readJson(file, rev = null) {
  const text = rev
    ? await git(['show', `${rev}:${file}`]).catch(() => null)
    : await readFile(join(DATA_DIR, file), 'utf8').catch(() => null)
  if (text == null) return null
  try { return JSON.parse(text) } catch { return null }
}

async function stateAt(rev = null) {
  const [params, scenarios, nomenclature, services, meta] =
    await Promise.all(STATE_FILES.map((f) => readJson(f, rev)))
  if (!params || !scenarios || !nomenclature) return null
  return {
    params,
    matrix: scenarios,
    items: nomenclature,
    services: Array.isArray(services) ? services : services?.services ?? [],
    scenario: meta?.scenario ?? params.meta?.scenario,
  }
}

function validate(body) {
  const bad = []
  if (!body?.params?.meta?.openingDate) bad.push('params.meta.openingDate')
  if (!body?.matrix || typeof body.matrix !== 'object') bad.push('matrix')
  if (!Array.isArray(body?.items)) bad.push('items')
  if (!Array.isArray(body?.services)) bad.push('services')
  return bad
}

export const stateApi = {
  async isReady() { return bootstrap() },

  async getState() {
    await bootstrap() || Promise.reject(new Error('versioning unavailable'))
    return { head: await sha(), state: await stateAt(), updatedAt: new Date().toISOString() }
  },

  async saveState(body) {
    if (!(await bootstrap())) throw new Error('versioning unavailable')
    const bad = validate(body)
    if (bad.length) { const e = new Error('invalid state: ' + bad.join(', ')); e.status = 400; throw e }
    const author = String(body.author || 'web').slice(0, 80)
    const message = String(body.message || 'обновление параметров').slice(0, 300)
    return enqueue(async () => {
      const head = await sha()
      if (body.base && body.base !== head) {
        const e = new Error('conflict'); e.status = 409; e.head = head; throw e
      }
      await atomicWrite(join(DATA_DIR, 'params.json'), JSON.stringify(body.params, null, 2))
      await atomicWrite(join(DATA_DIR, 'scenarios.json'), JSON.stringify(body.matrix, null, 2))
      await atomicWrite(join(DATA_DIR, 'nomenclature.json'), JSON.stringify(body.items, null, 2))
      await atomicWrite(join(DATA_DIR, 'services.json'), JSON.stringify({ services: body.services }, null, 2))
      await atomicWrite(join(DATA_DIR, 'meta.json'),
        JSON.stringify({ scenario: body.scenario ?? null }, null, 2))
      await git(['add', '-A'])
      try {
        await git(['-c', `user.name=${author}`, '-c', 'user.email=aura-model@local',
          'commit', '-m', message])
      } catch (e) {
        if (/nothing to commit/.test((e.stderr || '') + (e.message || ''))) return { head, sha: head, unchanged: true }
        await git(['checkout', '--', '.']).catch(() => {})
        throw e
      }
      const next = await sha()
      push() // не ждём — бэкап фоном
      return { head: next, sha: next }
    })
  },

  async listVersions(limit = 200) {
    await bootstrap() || Promise.reject(new Error('versioning unavailable'))
    const out = await git(['log', `--format=%H%x1f%aI%x1f%an%x1f%s`, '-n', String(limit)])
    return out.trim().split('\n').filter(Boolean).map((line) => {
      const [s, date, author, message] = line.split('\x1f')
      return { sha: s, date, author, message }
    })
  },

  async getVersion(s) {
    if (!(await bootstrap())) throw new Error('versioning unavailable')
    if (!/^[0-9a-f]{7,40}$/i.test(s)) { const e = new Error('bad sha'); e.status = 400; throw e }
    const state = await stateAt(s)
    if (!state) { const e = new Error('version not found'); e.status = 404; throw e }
    return { sha: s, state }
  },

  async restoreVersion(s, author = 'web') {
    if (!(await bootstrap())) throw new Error('versioning unavailable')
    if (!/^[0-9a-f]{7,40}$/i.test(s)) { const e = new Error('bad sha'); e.status = 400; throw e }
    return enqueue(async () => {
      const src = await git(['log', '-1', '--format=%s', s]).catch(() => s.slice(0, 7))
      for (const f of STATE_FILES) {
        const text = await git(['show', `${s}:${f}`]).catch(() => null)
        if (text != null) await atomicWrite(join(DATA_DIR, f), text)
      }
      await git(['add', '-A'])
      await git(['-c', `user.name=${String(author).slice(0, 80)}`, '-c', 'user.email=aura-model@local',
        'commit', '-m', `restore ${s.slice(0, 7)}: ${src.trim().slice(0, 200)}`])
      const next = await sha()
      push()
      return { head: next, sha: next, state: await stateAt() }
    })
  },
}
