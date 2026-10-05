// AURA HILLS — backend: статика dist/ + /api/chat прокси к polza.ai.
// Ключ живёт только здесь (env), браузер его никогда не видит.
// Zero-dependency: node >= 20. Запуск: POLZA_API_KEY=... node server/index.mjs
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../dist', import.meta.url))
const PORT = Number(process.env.PORT || 8090)
const HOST = process.env.HOST || '127.0.0.1'
const API_KEY = process.env.POLZA_API_KEY || ''
const MODEL = process.env.AI_MODEL || 'anthropic/claude-sonnet-4.5'
const UPSTREAM = process.env.AI_BASE_URL || 'https://api.polza.ai/api/v1'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.ico': 'image/x-icon', '.webp': 'image/webp',
}

// ---------- контекст модели для system prompt ----------
let cachedCtx = null
async function modelContext() {
  if (cachedCtx) return cachedCtx
  const chunks = []
  try {
    const snap = JSON.parse(await readFile(join(ROOT, 'data/model-snapshot.json'), 'utf8'))
    chunks.push(
      'Рассчитанный снимок модели (KPI, годовые P&L, денежные потоки, чувствительность):\n' +
      JSON.stringify(snap).slice(0, 60000),
    )
  } catch { /* snapshot может отсутствовать в dev */ }
  try {
    const params = await readFile(join(ROOT, 'data/params.json'), 'utf8')
    chunks.push('Допущения модели (params.json):\n' + params.slice(0, 40000))
  } catch { }
  try {
    const scen = await readFile(join(ROOT, 'data/scenarios.json'), 'utf8')
    chunks.push('Сценарная матрица (scenarios.json):\n' + scen.slice(0, 30000))
  } catch { }
  try {
    const guide = await readFile(join(ROOT, 'docs/model-guide.md'), 'utf8')
    chunks.push('Руководство по модели (формулы, логика, справочник):\n' + guide.slice(0, 80000))
  } catch { }
  cachedCtx = chunks.join('\n\n')
  return cachedCtx
}

const SYSTEM =
  'Ты — финансовый консультант проекта AURA HILLS (банный/SPA/glamping/wellness-комплекс на Кипре). ' +
  'Отвечаешь по-русски, кратко и по делу, числа — из приведённого ниже контекста модели. ' +
  'Если данных нет — честно скажи и предложи, где в модели это посмотреть. ' +
  'Не выдумывай цифры. Форматирование markdown уместно, но без излишеств.\n\n'

// ---------- простые лимиты ----------
const RATE = new Map() // ip -> {count, reset}
const rateOk = (ip) => {
  const now = Date.now()
  const r = RATE.get(ip)
  if (!r || r.reset < now) { RATE.set(ip, { count: 1, reset: now + 60_000 }); return true }
  if (r.count >= 30) return false
  r.count++
  return true
}

const json = (res, code, obj) => {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

async function handleChat(req, res) {
  if (!API_KEY) return json(res, 503, { error: 'AI-консультант не настроен на сервере' })
  const ip = req.socket.remoteAddress || '?'
  if (!rateOk(ip)) return json(res, 429, { error: 'Слишком много запросов, подождите минуту' })

  let body = ''
  for await (const c of req) {
    body += c
    if (body.length > 64_000) return json(res, 413, { error: 'Запрос слишком большой' })
  }
  let messages
  try {
    const parsed = JSON.parse(body)
    messages = Array.isArray(parsed.messages) ? parsed.messages : null
  } catch { }
  if (!messages?.length) return json(res, 400, { error: 'Ожидался {messages: [...]}' })
  messages = messages
    .slice(-20)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))

  const upstream = await fetch(`${UPSTREAM}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM + (await modelContext()) },
        ...messages,
      ],
    }),
  })
  if (!upstream.ok || !upstream.body) {
    const err = await upstream.text().catch(() => '')
    return json(res, upstream.status === 401 ? 502 : upstream.status, {
      error: `LLM API ответил ${upstream.status}`,
      detail: err.slice(0, 300),
    })
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const reader = upstream.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
  } catch { /* клиент отвалился */ }
  res.end()
}

// ---------- статика ----------
async function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path === '/') path = '/index.html'
  let file = normalize(join(ROOT, path))
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end() }
  const st = await stat(file).catch(() => null)
  if (!st || !st.isFile()) file = join(ROOT, 'index.html') // SPA-fallback (hash-роутинг не требует, но пусть будет)
  const type = MIME[extname(file)] || 'application/octet-stream'
  const headers = { 'Content-Type': type }
  if (file.includes(`${'assets'}/`) || file.includes('assets\\')) headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  res.writeHead(200, headers)
  createReadStream(file).pipe(res)
}

const server = http.createServer((req, res) => {
  const url = req.url || '/'
  if (url === '/api/health') {
    return json(res, 200, { ok: true, configured: Boolean(API_KEY), model: MODEL })
  }
  if (url.startsWith('/api/chat')) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
    return void handleChat(req, res).catch((e) =>
      json(res, 502, { error: 'Ошибка прокси', detail: String(e).slice(0, 200) }))
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET only' })
  void serveStatic(req, res).catch(() => { res.writeHead(500); res.end() })
})

server.listen(PORT, HOST, () => {
  console.log(`[aura] http://${HOST}:${PORT} model=${MODEL} key=${API_KEY ? 'set' : 'MISSING'}`)
})
