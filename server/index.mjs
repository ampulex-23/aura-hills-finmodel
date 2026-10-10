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
      description: 'KPI всех сценариев (NPV, IRR годовой эфф., payback, диск. payback, MOIC, cash-on-cash, пиковая потребность, equity-транши, TV) + годовые итоги (revenue, opex, fot, ebitda, cit, netProfit, capexOutflow, dividends, equityIn, fcff, cumFcff) + временная структура (horizon). Дешёвый первый шаг для большинства вопросов.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_monthly',
      description: 'Помесячная таблица сценария за весь горизонт (84 строки: 12 стройки + 72 операций; сценарная задержка стройки добавляет строки — в Base 85): month, revenue, ebitda, fot, capex (отток месяца, включая стройку оч. 2), fcff, cumFcff, cash, equityIn.',
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
      description: 'Выручка по десяти потокам за весь горизонт: rental (аренда модулей, вкл. VIP оч. 2), steam, massage, extra, glamping, membership (членства+сертификаты), fb (кафе-бар оч. 1), publicBath (общественная баня оч. 2), restaurant (ресторан оч. 2).',
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
      name: 'get_capex',
      description: 'Смета CAPEX сценария: итоги очереди 1 (totalEur, буфер, adjustedEur, амортизация) и очереди 2 (totalEur, свой буфер, adjustedEur, окно оттока, какие объекты включены), плюс группы сметы со строками (name, object, eur) по обеим очередям. Для вопросов «сколько стоит стройка / что входит в CAPEX / сколько стоит VIP-3».',
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
      description: 'Допущения модели (с правками пользователя, если есть). Без path — список ключей верхнего уровня; с path — поддерево. Ключи: meta (даты, горизонт, режимы), general (инфляция, WACC/CAPM), taxes, prices, units (глэмпинг, сертификаты, пресейл), deposit, service, members, fb, land, laundry, preopen, capexMaint, tv, glampOta, partners, amort, taxDepr, opexFixed, opexPct, it, fot (штат и фазы), modules (7 модулей: 3 оч.1 + 4 VIP оч.2), slotMix, procedures (меню услуг), seasonality, phase2 (стройка оч.2), publicBath, restaurant, capexItems (смета, 56 строк с WBS).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'dot-path, напр. taxes.cit, modules.3, phase2, capexItems.40.wbs' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_scenarios',
      description: 'Сценарная матрица по 5 годам для 3 сценариев: baths, steam, massage, extra, glamping, publicBath, restaurant (загрузки), membersMonth, priceGrowth, capexAdj, rampMonths, uptake, constructionDelayMonths, energyCostMult. Год 6 = год 5.',
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
      description: 'Справочники: "nomenclature" (152 позиции закупок: code, name, category, use = OPEX|CAPEX|Спецификация, price, delivery, landed, opexArticle, norm/normBase, qty, initialQty/initialQtyP2, ownPrice) или "services" (23 спецификации услуг: direction, name, price, capacity, items = материалы по коду с qty и труд ролей с pct).',
      parameters: {
        type: 'object',
        properties: { which: { type: 'string', enum: ['nomenclature', 'services'] } },
        required: ['which'],
      },
    },
  },
]

// live — живой прогон модели из браузера пользователя (с его localStorage-правками).
// Для текущего сценария живые данные приоритетнее статичного build-снимка.
async function runTool(name, args, live) {
  const snap = await load('snap', 'data/model-snapshot.json')
  const liveSc = live && live.scenario ? live : null
  const preferLive = (sc) => liveSc && (!sc || sc === liveSc.scenario)
  switch (name) {
    case 'get_kpis': {
      const out = {}
      for (const [sc, d] of Object.entries(snap?.scenarios ?? {}))
        out[sc] = { kpis: d.kpis, yearly: d.yearly, horizon: d.horizon, source: 'snapshot' }
      if (liveSc) out[liveSc.scenario] = { kpis: liveSc.kpis, yearly: liveSc.yearly, horizon: liveSc.horizon, source: 'live (текущие правки пользователя)' }
      return Object.keys(out).length ? JSON.stringify(out) : 'snapshot недоступен'
    }
    case 'get_monthly': {
      if (preferLive(args.scenario)) return JSON.stringify(liveSc.monthly)
      const d = snap?.scenarios?.[args.scenario]
      return d ? JSON.stringify(d.monthly) : `нет сценария "${args.scenario}"`
    }
    case 'get_revenue_streams': {
      if (preferLive(args.scenario)) return JSON.stringify(liveSc.revenueStreamsTotal)
      const d = snap?.scenarios?.[args.scenario]
      return d ? JSON.stringify(d.revenueStreamsTotal) : `нет сценария "${args.scenario}"`
    }
    case 'get_capex': {
      if (preferLive(args.scenario) && liveSc.capex) return JSON.stringify(liveSc.capex).slice(0, 45000)
      const d = snap?.scenarios?.[args.scenario]
      return d?.capex ? JSON.stringify(d.capex).slice(0, 45000) : `нет сценария "${args.scenario}" или снимок без capex`
    }
    case 'get_params': {
      const p = liveSc?.params ?? (await load('params', 'data/params.json'))
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
async function systemPrompt(live) {
  const snap = await load('snap', 'data/model-snapshot.json')
  const secs = await guideSections()
  const fmtK = (s) =>
    `NPV ${Math.round(s.kpis.npv).toLocaleString('ru')} €, IRR ${((s.kpis.irrAnnual ?? 0) * 100).toFixed(1)}%, ` +
    `payback ${s.kpis.paybackMonths} мес, MOIC ${(s.kpis.moic ?? 0).toFixed(2)}x, пик. потребность ${Math.round(s.kpis.peakFundingNeed ?? 0).toLocaleString('ru')} €`
  let digest = ''
  if (snap) {
    digest += 'KPI по сценариям (снимок от ' + String(snap.generatedAt).slice(0, 10) + ', дефолтные допущения):\n' +
      Object.entries(snap.scenarios).map(([n, s]) => `- ${n}: ${fmtK(s)}`).join('\n') + '\n'
  }
  if (live?.kpis) {
    digest += `ТЕКУЩИЙ СЦЕНАРИЙ ПОЛЬЗОВАТЕЛЯ (live, с его правками в браузере — приоритетнее снимка): ${live.scenario}: ${fmtK(live)}.\n`
    const h = live.horizon
    if (h) digest += `Live-горизонт: стройка ${h.constructionMonths} мес с ${h.constructionStart}, открытие ${h.openingDate}, операций ${h.opsMonths} мес, всего ${h.totalMonths} строк CF.\n`
    const p2 = live.capex?.phase2
    if (p2) {
      const on = Object.entries(p2.objects ?? {}).filter(([, v]) => v).map(([k]) => k)
      digest += `Очередь 2 (live): включены объекты [${on.join(', ') || 'нет'}], CAPEX ${Math.round(p2.totalEur ?? 0).toLocaleString('ru')} € (+${Math.round((p2.capexAdj ?? 0) * 100)}% буфер = ${Math.round(p2.adjustedEur ?? 0).toLocaleString('ru')} €), отток ${p2.outflowMonths} мес ${p2.firstMonth ?? ''}–${p2.lastMonth ?? ''}.\n`
    }
  }
  return (
    'Ты — финансовый аналитик-консультант модели AURA HILLS: банный, SPA, wellness и глэмпинг-комплекс на Кипре, валюта EUR, две очереди строительства. ' +
    'Ядро модели — код (TypeScript), допущения — JSON; Excel — только выгрузка для проверки.\n\n' +

    'ВРЕМЕННАЯ СТРУКТУРА: стройка оч. 1 — 12 мес с 01.2027; открытие 01.2028; операционка 72 мес (01.2028–12.2033) → 84 строки Cash-Flow (при задержке стройки в сценарии — больше). ' +
    'Метки месяцев вида "Янв 2027". Операционный год 1 = 2028 … год 6 = 2033; сценарные векторы заданы на 5 лет, год 6 повторяет год 5 (цены и инфляция продолжают индексироваться). ' +
    'Очередь 2 строится 24 мес в 2029–2030 (месяцы CF 25–48) на фоне работы оч. 1, ввод всех объектов единый 01.2031.\n\n' +

    'СОСТАВ: 7 банных модулей — оч. 1: №1 (4 гостя, €250/слот), №2 (8, €500), №3 (12, €750), ввод 01.2028; оч. 2 VIP-1 №4 (6, €500), VIP-2 №5 (6, €500), VIP-3 №6 (4, €350), VIP-4 №7 (10, €750), ввод 01.2031. ' +
    'По умолчанию ВСЕ активны. У каждого модуля 3 слота в день (утро/день/вечер; второй дневной убран), uptime 95%, цена слота фиксирована баней и не зависит от времени суток (slotMix 15/45/40% — только разложение). ' +
    'Плюс оч. 2: общественная баня на 40 чел/день (билет €35, 9–23, без слотов — поток посетителей, сервисный чек €15) и ресторан в её здании (40 мест × 1.5 оборота, чек €28 с инфляцией, плейсхолдер). ' +
    'Глэмпинг 3 юнита (2×€165, 1×€235), членства €200/мес и €1500/год, сертификаты €150 (65/мес, погашение 85%), кафе-бар €10/гость.\n\n' +

    'ОЧЕРЕДЬ 2: каждый объект включается отдельным тоглом (VIP — статус «Активен», баня — «Включён в план»); состав един для всех сценариев. ' +
    'Строки сметы оч. 2 несут object (public, vip1–vip4) — платятся при включённом объекте; общие строки — если включён ≥1 объект. ' +
    'CAPEX оч. 2 по умолчанию 1 502 950 € (общ. комплекс 617 550 + VIP 628 200 + общие 257 200), буфер свой 10% → 1 653 245 €; отток равномерно по 24 месяцам окна; амортизация объектов с их ввода. ' +
    'Рампа оч. 2 своя — 9 мес от ввода. Финансирование: ops (из операционного CF, разрывы закрывает общий equity-механизм) или equity (отдельный транш = отток месяца). ' +
    'Выручка VIP идёт в обычные потоки аренды/услуг/F&B; общ. баня и ресторан — отдельные потоки 9 и 10 с загрузками publicBath/restaurant из матрицы.\n\n' +

    'ПРАВИЛА:\n' +
    '1. Цифры бери ТОЛЬКО из инструментов — ничего не выдумывай. Нет данных — скажи прямо.\n' +
    '2. Не гадай: не хватает данных — вызови инструмент. Для "как считается X" и расшифровок терминов — search_guide (руководство актуально и подробно). Для инвестиций и сметы — get_capex. Для допущений — get_params с path.\n' +
    '3. Отвечай по-русски, структурировано и по делу. Rich text приветствуется: **жирный**, таблицы markdown, формулы LaTeX ($...$, $$...$$) для выкладок.\n' +
    '4. Отвечая про конкретные числа, называй показатель, сценарий и период; если есть live-данные — отвечай по ним и упоминай, что это с правками пользователя.\n' +
    '5. Прикреплённые пользователем данные (📌-пины) — готовые значения из таблиц: объясняй строку/показатель по ним (смысл, формула, из чего сложилось), ' +
    'при необходимости контекста вызывай инструменты (search_guide — «что это за строка», get_monthly — проверить ряд).\n\n' +

    'ГЛОССАРИЙ И ПРАВИЛА МОДЕЛИ:\n' +
    '- Налоги Кипра (реформа 2026): CIT 15% по календарным годам с переносом убытков, база — EBIT с налоговой амортизацией (capital allowances: конструкции 25 лет, оборудование 7, прочее 5; бухгалтерская 10/7/5); авансы 31 июля и 31 декабря. ' +
    'SDC 5% и GESY 2.65% (потолок базы €180k/год на лицо) УДЕРЖИВАЮТСЯ ИЗ дивидендов резидентов-домицилов — не отток компании; Non-Dom освобождён. Взносы работодателя 15.4% на оклады и KPI.\n' +
    '- НДС: 19% (аренда, услуги, членства, сертификаты, общ. баня), 9% (глэмпинг, F&B, ресторан), входной 19%. Режим по умолчанию «С возмещением», уплата квартальная (через 2 мес после квартала). ' +
    'В P&L из выручки вычитается НАЧИСЛЕННЫЙ НДС; к уплате — выходной − входной − перенос; разница видна в Cash-Flow строкой «ΔНДС». Входной НДС CAPEX оч. 1 — в 1-й месяц операционки, оч. 2 — помесячно в окне стройки; земля кредита не создаёт.\n' +
    '- Дивиденды = max(0, ЧП того же месяца годом ранее) × (доли партнёров 80% + УК 10%), с 13-го операционного месяца; резерв 10% остаётся в компании.\n' +
    '- WACC по умолчанию CAPM: 3.2% + 1.4×5.5% + 1.5% + 5% = 17.4% (ручной режим — 14%). Эффективная годовая; дисконт помесячно по (1+WACC)^(1/12)−1. ' +
    'IRR публикуется ОДИН — эффективный годовой (1+r_m)^12−1, напрямую сопоставим с WACC. NPV — за весь горизонт без TV; «NPV с TV» — отдельная метрика (Гордон от FCFF последнего года, выкл по умолчанию).\n' +
    '- FCFF = ЧП + амортизация + ΔНДС − CAPEX стройки (S-кривая) − отложенный CAPEX (модули оч. 1 траншем, оч. 2 помесячно) + пресейл − прогорание − аренда земли − pre-opening − maintenance CAPEX. ' +
    'Дивиденды вычитаются после FCFF. Equity-транши закрывают кассовый разрыв месяца → касса ≥ 0; Σ траншей — KPI. Пиковая потребность = min накопленного FCFF. ' +
    'MOIC = Σ FCFF⁺ / Σ |FCFF⁻|; cash-on-cash = FCFF 3-го операционного года / вложено; break-even — множитель спроса, при котором EBITDA года 3 = 0.\n' +
    '- Мини-баланс сходится тождественно: касса + ОС по остаточной = пул предоплат + нетто-НДС + equity + нераспределённая прибыль.\n' +
    '- Пресейл: 3 мес до открытия, режим deferred (по умолчанию) — предоплата тех же членств/сертификатов, пул прогорает 12 мес без двойного счёта; incremental — доп. канал сверх плана (наследие Excel, завышает).\n' +
    '- Пакетный режим «Да» (по умолчанию): депозит €110/гость, uptake = 100%; услуги = гости × загрузка услуги из сценария × база (парение €50, массаж €60, допы 20% депозита) по меню с весами. Сервисный чек членов (€40) и посетителей общ. бани (€15) добавляется в те же потоки.\n' +
    '- Члены клуба занимают ёмкость (2 визита × 2 гостя), но вытесняют платные слоты только в пик (30%); год 1 продан пресейлом без рампы; годовые члены по плану 30/50/80/120/120.\n' +
    '- Модули с поздним вводом (оч. 1): до launchDate не дают слотов, не размывают лимит членов и не несут помодульный OPEX/CAPEX; при вводе платят помодульный CAPEX ' +
    '(строки с qty MODULES_COUNT — по 1 на модуль своей очереди, MODULES_COUNT:N — по N) траншем в месяц запуска, НДС зачитывается там же.\n' +
    '- Смета стройки (capexItems, 56 строк): phase 1/2, object для оч. 2, группы-разделы, у 27 строк WBS-детализация (секции → позиции кол-во × ставка); цена WBS-строки = ΣWBS ÷ wbsQty (эталонный объём; у банных модулей 3). ' +
    'CAPEX оч. 1 = смета + наполнение (номенклатура use=CAPEX) + закуп стартовых запасов (initialQty) + IT (€95k) + земля (режим покупки), × (1 + буфер сценария 20/10/5%). ' +
    'Maintenance CAPEX 1.5% базы в год со 2-го года + капремонт €60k в году 4. Прачечная: «Аутсорс» — цикл стирки NC-159 €4.99 / NC-210 €1.5 в спеках; «Своя» — оборудование ~€8k в CAPEX и цикл по ownPrice €0.9/€0.45; текстиль-актив закупается в любом режиме.\n' +
    '- Номенклатура (152 позиции): режим «Учёт» — OPEX (норма × база слот/гость/мес × landed × инфляция, по статье; пусто → не списывается), CAPEX (landed × Кол-во → «Наполнение»), Спецификация (материал услуг; норма игнорируется — антидубль). ' +
    'Landed = цена + max(дост. €/ед, цена × дост. %) — максимум, не сумма. initialQty / initialQtyP2 — стартовый запас к открытию оч. 1 / к вводу оч. 2 (вкладка «Смета закупа»).\n' +
    '- Спецификации (23 услуги): себес = Σ(кол-во × landed материала) + цена × Σ% ролей; труд = KPI-бонус в ФОТ (пармастер 30% парений и 3% аренды, массажист 30% массажей). ' +
    'Проведено услуг: аренда — слоты модулей по тарифу вместимости (до 4/8/12), услуги — выручка ступени ÷ прайс. Оклад платится всегда; роли без строки в спеке KPI не получают. Цена спеки НЕ двигает выручку — цены потоков в Допущениях.\n' +
    '- Штат по фазам (календарь): старт 12 ставок (2028), 17 с 2029-01, 29 с 2031-01 (оч. 2), 32 с 2032-01; повар и IT-куратор — условные роли слоёв F&B и IT.\n' +
    '- Постоянные OPEX ~€11.5k/мес + IT ~€1.5k: маркетинг max(€5k, 3.5% выручки), электро €3k и отопление €300 (× множитель энергии сценария), «Обслуживание модулей» €100 × запущенных модулей; всё с инфляцией 2.5%/год. %-блок: эквайринг 2%, ремонт 3% выручки, food-cost 35% F&B и ресторана, OTA 17% от 30% ночей глэмпинга.\n' +
    '- Сценарии: Base по умолчанию; Conservative/Base/Aggressive различаются загрузками, членами, uptake 20/30/40%, ростом цен 3/3/5%, буфером CAPEX 20/10/5%, рампой 12/9/6 мес, задержкой стройки 4/1/0 мес, энергией ×1.3/1/0.9. Sensitivity — честный пересчёт модели (5 таблиц, tornado 11 драйверов, break-even).\n' +
    '- Приложение: группы Data Room / Параметры / Отчёты; правки сохраняются в браузере; «Сбросить» возвращает дефолты репозитория; Excel-выгрузка с живыми формулами (15 листов, включая Баланс и Checks); публичный Data Room: /llms.txt, /data/*.json, /data/model-snapshot.json.\n\n' +
    digest + '\n' +
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
    if (body.length > 400_000) return json(res, 413, { error: 'Запрос слишком большой' })
  }
  let messages, pins, live
  try {
    const parsed = JSON.parse(body)
    messages = Array.isArray(parsed.messages) ? parsed.messages : null
    pins = Array.isArray(parsed.pins) ? parsed.pins : []
    live = parsed.live && typeof parsed.live === 'object' ? parsed.live : null
  } catch { }
  if (!messages?.length) return json(res, 400, { error: 'Ожидался {messages: [...]}' })
  messages = messages
    .slice(-20)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })

  try {
    const convo = [{ role: 'system', content: await systemPrompt(live) }, ...messages]
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
        const out = await runTool(c.function.name, args, live)
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
