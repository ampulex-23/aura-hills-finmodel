// AURA HILLS — backend: статика dist/ + /api/chat агент-прокси к polza.ai.
// Ключ живёт только здесь (env), браузер его никогда не видит.
// Агент: компактный system prompt + tool-calling — модель сама дотягивает
// нужные данные (KPI, params, сценарии, секции руководства) вместо
// полного дампа в контекст. Экономия токенов и точнее ответы.
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
const MODEL = process.env.AI_MODEL || 'anthropic/claude-haiku-4.5'
const UPSTREAM = process.env.AI_BASE_URL || 'https://api.polza.ai/api/v1'
const MAX_TOOL_ITERS = 6

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.ico': 'image/x-icon', '.webp': 'image/webp',
}

// ---------- ленивая загрузка данных модели ----------
const DATA = {}
async function load(key, rel, parse = JSON.parse) {
  if (!(key in DATA)) {
    try { DATA[key] = parse(await readFile(join(ROOT, rel), 'utf8')) }
    catch { DATA[key] = null }
  }
  return DATA[key]
}

// Руководство режем на секции по заголовкам ##/### для точечной выдачи
async function guideSections() {
  if (DATA.guideSecs) return DATA.guideSecs
  const md = (await load('guide', 'docs/model-guide.md', (s) => s)) || ''
  const secs = []
  let cur = { head: 'Введение', body: '' }
  for (const line of md.split('\n')) {
    if (/^#{1,3}\s/.test(line)) {
      if (cur.body.trim()) secs.push(cur)
      cur = { head: line.replace(/^#+\s*/, '').trim(), body: '' }
    } else cur.body += line + '\n'
  }
  if (cur.body.trim()) secs.push(cur)
  DATA.guideSecs = secs
  return secs
}

const dig = (obj, path) =>
  path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)

// ---------- инструменты агента ----------
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_kpis',
      description: 'KPI всех сценариев (NPV, IRR, payback, MOIC) + годовые итоги revenue/EBITDA/FCFF. Дешёвый первый шаг для большинства вопросов.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_monthly',
      description: 'Помесячная таблица сценария: месяц, revenue, ebitda, fcff, cumFcff (72 строки).',
      parameters: {
        type: 'object',
        properties: { scenario: { type: 'string', description: 'Conservative | Base | Aggressive' } },
        required: ['scenario'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_revenue_streams',
      description: 'Выручка по потокам за весь горизонт (аренда/парения/массаж/допы/глэмпинг/членства/F&B).',
      parameters: {
        type: 'object',
        properties: { scenario: { type: 'string' } },
        required: ['scenario'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_params',
      description: 'Допущения модели. Без path — карта верхнего уровня; с path — поддерево (напр. "taxes", "service", "units", "fot", "fb", "glampOta").',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'dot-path, напр. taxes.cit' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_scenarios',
      description: 'Сценарная матрица: загрузки бань/парений/массажа/глэмпинга, члены, uptake, рост цен по годам для 3 сценариев.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_guide',
      description: 'Поиск по Руководству модели — возвращает релевантные секции с формулами и логикой. Для «как считается X» зови это первым.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'ключевые слова, напр. "пресейл", "налоги", "выручка"' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sensitivity',
      description: 'Чувствительность: матрицы NPV (спрос×WACC, рост×CAPEX, цены), tornado, break-even.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_catalog',
      description: 'Справочники: "nomenclature" (статьи OPEX с ценами) или "services" (спецификации услуг: состав, труд, себестоимость).',
      parameters: {
        type: 'object',
        properties: { which: { type: 'string', enum: ['nomenclature', 'services'] } },
        required: ['which'],
      },
    },
  },
]

async function runTool(name, args) {
  const snap = await load('snap', 'data/model-snapshot.json')
  switch (name) {
    case 'get_kpis': {
      if (!snap) return 'snapshot недоступен'
      const out = {}
      for (const [sc, d] of Object.entries(snap.scenarios))
        out[sc] = { kpis: d.kpis, yearly: d.yearly }
      return JSON.stringify(out)
    }
    case 'get_monthly': {
      const d = snap?.scenarios?.[args.scenario]
      return d ? JSON.stringify(d.monthly) : `нет сценария "${args.scenario}"`
    }
    case 'get_revenue_streams': {
      const d = snap?.scenarios?.[args.scenario]
      return d ? JSON.stringify(d.revenueStreamsTotal) : `нет сценария "${args.scenario}"`
    }
    case 'get_params': {
      const p = await load('params', 'data/params.json')
      if (!p) return 'params недоступны'
      if (!args.path) return JSON.stringify(Object.keys(p))
      const v = dig(p, args.path)
      return v === undefined ? `нет ключа "${args.path}". Верхний уровень: ${Object.keys(p).join(', ')}` : JSON.stringify(v)
    }
    case 'get_scenarios': {
      const s = await load('scen', 'data/scenarios.json')
      return s ? JSON.stringify(s).slice(0, 30000) : 'scenarios недоступны'
    }
    case 'search_guide': {
      const secs = await guideSections()
      const words = args.query.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 2)
      const hit = secs
        .map((s) => ({ s, score: words.reduce((n, w) => n + (s.head.toLowerCase().includes(w) ? 3 : 0) + (s.body.toLowerCase().split(w).length - 1), 0) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
      if (!hit.length)
        return `ничего не найдено. Заголовки секций: ${secs.map((s) => s.head).join(' | ')}`
      return hit.map((x) => `## ${x.s.head}\n${x.s.body}`).join('\n---\n').slice(0, 36000)
    }
    case 'get_sensitivity': {
      if (!snap) return 'snapshot недоступен'
      return JSON.stringify(snap.sensitivity).slice(0, 40000)
    }
    case 'get_catalog': {
      const d = await load(args.which, `data/${args.which}.json`)
      return d ? JSON.stringify(d).slice(0, 40000) : `${args.which} недоступен`
    }
    default:
      return `неизвестный инструмент ${name}`
  }
}

// ---------- system prompt: компактный, данные по требованию ----------
async function systemPrompt() {
  const snap = await load('snap', 'data/model-snapshot.json')
  const secs = await guideSections()
  let digest = ''
  if (snap) {
    digest = 'KPI по сценариям (снимок от ' + String(snap.generatedAt).slice(0, 10) + '):\n' +
      Object.entries(snap.scenarios)
        .map(([n, s]) => `- ${n}: NPV ${Math.round(s.kpis.npv).toLocaleString('ru')} €, IRR ${(s.kpis.irr * 100).toFixed(1)}%, payback ${s.kpis.paybackMonths} мес, MOIC ${s.kpis.moic?.toFixed(2)}x`)
        .join('\n')
  }
  return (
    'Ты — финансовый аналитик-консультант модели AURA HILLS (банный/SPA/glamping/wellness-комплекс, Кипр, валюта EUR). ' +
    'Горизонт: 12 мес стройки + 60 мес операций. Помесячные метки вида "Янв 27".\n\n' +
    'ПРАВИЛА:\n' +
    '1. Цифры бери ТОЛЬКО из инструментов — ничего не выдумывай. Нет данных — скажи прямо.\n' +
    '2. Не гадай: не хватает данных — вызови инструмент. Для "как считается X" и расшифровок терминов — search_guide.\n' +
    '3. Отвечай по-русски, структурировано и по делу. Rich text приветствуется: **жирный**, таблицы markdown, формулы LaTeX ($...$, $$...$$) для выкладок.\n' +
    '4. Отвечая про конкретные числа, называй показатель и период.\n' +
    '5. Прикреплённые пользователем данные (📌-пины) — готовые значения: объясняй строку/показатель по ним, ' +
    'а при необходимости контекста вызывай инструменты (search_guide — «что это за строка», get_monthly — проверить ряд).\n\n' +
    'ГЛОССАРИЙ МОДЕЛИ:\n' +
    '- SDC — Special Defence Contribution: кипрский взнос 17% на дивиденды резидентов (non-dom не платит).\n' +
    '- GESY — General Healthcare System: кипрский взнос в здравоохранение 2.65% (в модели — с дивидендов резидентов и в составе соцвзносов работодателя).\n' +
    '- CIT — Corporate Income Tax Кипра, 12.5%. НДС: 19% общая, 9% глэмпинг/F&B.\n' +
    '- FCFF — свободный денежный поток; MOIC — multiple on invested capital; ramp — месяцы выхода на план; uptime — доступность мощности.\n' +
    '- Номенклатура, колонка «Учёт»: OPEX — помесячное списание по норме; CAPEX — разовая закупка (landed × кол-во) в «Наполнение»; ' +
    'Спецификация — материал для себестоимости услуг, НО если у неё заданы статья OPEX и норма — она тоже списывается в OPEX помесячно.\n\n' +
    digest + '\n\n' +
    'Секции руководства (для search_guide): ' + secs.map((s) => s.head).join(' | ')
  )
}

// ---------- лимиты ----------
const RATE = new Map()
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

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

async function callLLM(messages, { tools = true } = {}) {
  const r = await fetch(`${UPSTREAM}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL, temperature: 0.3, messages,
      ...(tools ? { tools: TOOLS, tool_choice: 'auto' } : {}),
    }),
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    const e = new Error(`LLM API ${r.status}`)
    e.status = r.status; e.detail = t.slice(0, 300)
    throw e
  }
  return r.json()
}

async function handleChat(req, res) {
  if (!API_KEY) return json(res, 503, { error: 'AI-консультант не настроен на сервере' })
  const ip = req.socket.remoteAddress || '?'
  if (!rateOk(ip)) return json(res, 429, { error: 'Слишком много запросов, подождите минуту' })

  let body = ''
  for await (const c of req) {
    body += c
    if (body.length > 96_000) return json(res, 413, { error: 'Запрос слишком большой' })
  }
  let messages, pins
  try {
    const parsed = JSON.parse(body)
    messages = Array.isArray(parsed.messages) ? parsed.messages : null
    pins = Array.isArray(parsed.pins) ? parsed.pins : []
  } catch { }
  if (!messages?.length) return json(res, 400, { error: 'Ожидался {messages: [...]}' })
  messages = messages
    .slice(-20)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })

  try {
    const convo = [{ role: 'system', content: await systemPrompt() }, ...messages]
    if (pins.length) {
      // Пины вшиваем в последний user-месседж, а не вторым system:
      // адаптеры OpenAI→Anthropic могут отбрасывать лишние system-сообщения.
      const pinText = 'Пользователь прикрепил (📌) точные данные из таблиц отчётов. ' +
        'Вопрос относится к ним напрямую: «что это за число/строка» — это всегда про прикреплённое. ' +
        'Отвечай сразу по существу, БЕЗ уточняющих вопросов и без «какое число вы имеете в виду»:\n' +
        pins.slice(0, 12).map((p) => `- ${String(p.text || '').slice(0, 4000)}`).join('\n')
      const last = convo[convo.length - 1]
      convo[convo.length - 1] = { ...last, content: `[${pinText}]\n\n${last.content}` }
    }

    let answer = null
    for (let i = 0; i <= MAX_TOOL_ITERS; i++) {
      let resp
      try {
        resp = await callLLM(convo)
      } catch (e) {
        // fallback: провайдер/модель без tool-calling — один проход без инструментов
        if (i === 0 && e.status === 400) resp = await callLLM(convo, { tools: false })
        else throw e
      }
      const msg = resp.choices?.[0]?.message
      if (!msg) throw new Error('пустой ответ LLM')
      const calls = msg.tool_calls || []
      convo.push(msg)
      if (!calls.length || i === MAX_TOOL_ITERS) { answer = msg.content; break }
      for (const c of calls.slice(0, 4)) {
        let args = {}
        try { args = JSON.parse(c.function?.arguments || '{}') } catch { }
        sse(res, { aura_status: `${c.function.name}(${(c.function.arguments || '').slice(0, 60)})` })
        const out = await runTool(c.function.name, args)
        convo.push({ role: 'tool', tool_call_id: c.id, content: String(out).slice(0, 45000) })
      }
    }

    // Отдаём финальный ответ единым SSE-чном потоком, совместимым с клиентом
    sse(res, { choices: [{ delta: { content: answer || '(пустой ответ)' } }] })
    res.write('data: [DONE]\n\n')
  } catch (e) {
    sse(res, { aura_error: `${e.message || 'Ошибка'} ${e.detail || ''}`.trim() })
  }
  res.end()
}

// ---------- статика ----------
async function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path === '/') path = '/index.html'
  let file = normalize(join(ROOT, path))
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end() }
  const st = await stat(file).catch(() => null)
  if (!st || !st.isFile()) file = join(ROOT, 'index.html')
  const headers = { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' }
  if (file.includes('assets')) headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  res.writeHead(200, headers)
  createReadStream(file).pipe(res)
}

const server = http.createServer((req, res) => {
  const url = req.url || '/'
  if (url === '/api/health') {
    return json(res, 200, { ok: true, configured: Boolean(API_KEY), model: MODEL, agent: true })
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
  console.log(`[aura] http://${HOST}:${PORT} model=${MODEL} key=${API_KEY ? 'set' : 'MISSING'} agent-tools=${TOOLS.length}`)
})
