// BIM→смета синк (Фаза 3): draft-версия состояния + DIFF-отчёт.
//
//   node scripts/sync_smeta.mjs --offline            dry-run: diff на stdout + MD
//   node scripts/sync_smeta.mjs --api http://127.0.0.1:8090   из живого состояния
//   node scripts/sync_smeta.mjs --apply              + POST /api/state (draft-коммит)
//
// Читает smeta.json (результат tools/smeta.py --json в bim-as-code) и
// состояние модели (API /api/state или --offline из src/data/).
//
// Семантика строго review-first: qty НИГДЕ не перезаписываются —
// draft вносит только idempotent-аннотацию [BIM@<sha>…] в note
// сопоставленных NC-позиций. Численные предложения живут в DIFF-отчёте:
// scope несовпадает (реестр — по модулю, модель — по всему объекту),
// автозапись была бы ложью (PLAN-bim-smeta-link §7).

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const arg = (k, d = '') => {
  const i = process.argv.indexOf('--' + k)
  return i > 0 ? process.argv[i + 1] : d
}
const has = (k) => process.argv.includes('--' + k)

const SMETA = resolve(ROOT, arg('smeta', '../../bim-as-code/dist/smeta.json'))
const API = arg('api', process.env.AURA_API || '')
const OUT = resolve(ROOT,
  arg('out', '../SYNC-DIFF-bim-smeta.md'))
const AUTHOR = arg('author', 'bim-sync')

const loadJson = async (p) => JSON.parse(await readFile(p, 'utf8'))

async function getState() {
  if (has('offline') || !API) {
    const d = join(ROOT, 'src', 'data')
    const [params, matrix, items, services] = await Promise.all(
      ['params.json', 'scenarios.json', 'nomenclature.json', 'services.json']
        .map((f) => loadJson(join(d, f))))
    return { head: 'offline:src/data', state: { params, matrix, items, services: services.services ?? services, scenario: params.meta?.scenario ?? 'Base' } }
  }
  const r = await fetch(API + '/api/state')
  if (!r.ok) throw new Error(`GET /api/state → HTTP ${r.status}`)
  return r.json()
}

const eur = (n) => n == null ? '—' : '€' + Math.round(n).toLocaleString('ru-RU')
const num = (n) => n == null ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 1 })
const delta = (a, b) => b ? `${a / b > 1 ? '+' : ''}${Math.round((a / b - 1) * 100)}%` : '—'

// сметные WBS-строки из params.capexItems (code → line)
// NB: коды 1.x/2.x переиспользуются в разных строках capexItems
// («Банные модуля», «Строительные работы», «Печь-каменка», «Котлован»…)
// — индекс хранит ВСЕ строки по коду, отображается каждая.
function wbsIndex(params) {
  const idx = new Map()
  for (const row of params.capexItems ?? [])
    for (const sec of row.wbs ?? [])
      for (const l of sec.items ?? [])
        if (l.code) {
          if (!idx.has(l.code)) idx.set(l.code, [])
          idx.get(l.code).push({ ...l, row: row.name })
        }
  return idx
}

const smeta = await loadJson(SMETA)
const { head, state } = await getState()
const wbs = wbsIndex(state.params)
const itemsByCode = new Map((state.items ?? []).map((i) => [i.code, i]))

// — агрегация BIM по всем модулям реестра: code → [{module, qty}]
const bimBy = new Map()
for (const m of smeta.modules)
  for (const r of m.rows) {
    if (!bimBy.has(r.code)) bimBy.set(r.code, [])
    bimBy.get(r.code).push({ module: m.name, qty: r.qty_bim, derived: r.derived, notes: r.notes })
  }

const lines = []
const out = (s = '') => lines.push(s)
const today = new Date().toISOString().slice(0, 10)

out(`# SYNC-DIFF: BIM объёмы → состояние модели`)
out(``)
out(`Дата: ${today}. Источники:`)
out(`- **BIM**: smeta.json (bim-as-code@${smeta.bim_commit || '?'}, ${smeta.modules.length} модулей)`)
out(`- **Модель**: состояние @${String(head).slice(0, 8)}`)
out(``)
out(`Синк — draft + review: qty в состоянии НЕ перезаписаны (scope реестра — модуль,`)
out(`модель — весь объект). NC-позиции получили аннотацию BIM-количества в note.`)
out(``)

// ---------- WBS ----------
out(`## 1. WBS-работы (строительные)`)
out(``)
out(`| Код | Позиция (смета) | qty модели | qty BIM по модулям | Комментарий |`)
out(`|---|---|---|---|---|`)
const wbsRows = []
for (const [code, parts] of bimBy) {
  if (!/^\d+\./.test(code)) continue
  const refs = wbs.get(code) ?? []
  const cells = parts.map((p) =>
    `${p.module.match(/\d+/)?.[0] ?? p.module}: ${num(p.qty)}${p.derived ? '≈' : ''}`).join('<br>')
  wbsRows.push([code, refs, parts])
  if (!refs.length) {
    out(`| ${code} | — нет строки в модели — | | ${cells} | |`)
    continue
  }
  for (const ref of refs)
    out(`| ${code} | ${ref.row}: ${ref.name.slice(0, 48)} | ${num(ref.qty)} ${ref.unit ?? ''} | ${cells} | ${ref.rate ? '@ ' + eur(ref.rate) + '/ед' : ''} |`)
}
out(``)

// ---------- NC ----------
out(`## 2. Оснащение (номенклатура)`)
out(``)
out(`| Код | Позиция | qty модели | qty BIM по модулям | Δ |`)
out(`|---|---|---|---|---|`)
const ncRows = []
for (const [code, parts] of bimBy) {
  if (!code.startsWith('NC-')) continue
  const it = itemsByCode.get(code)
  const cells = parts.map((p) =>
    `${p.module.match(/\d+/)?.[0] ?? p.module}: ${num(p.qty)}`).join('<br>')
  const sum = parts.reduce((s, p) => s + p.qty, 0)
  ncRows.push([code, it, parts, sum])
  out(`| ${code} | ${it ? it.name.slice(0, 50) : '— нет в номенклатуре'} | ${num(it?.qty)} | ${cells} | ${delta(sum, it?.qty)} |`)
}
out(``)

// ---------- Reverse-report ----------
out(`## 3. Reverse-report`)
out(``)
// (a) CAPEX-позиции номенклатуры без BIM-покрытия
const mappedNc = new Set([...bimBy.keys()].filter((c) => c.startsWith('NC-')))
const uncovered = (state.items ?? []).filter((i) => i.use === 'CAPEX' && !mappedNc.has(i.code))
out(`### 3.1 CAPEX-позиции номенклатуры без BIM-покрытия (${uncovered.length})`)
out(``)
out(`| Код | Позиция | qty | € landed |`)
out(`|---|---|---|---|`)
for (const i of uncovered.slice(0, 40))
  out(`| ${i.code} | ${i.name.slice(0, 55)} | ${num(i.qty)} ${i.unit ?? ''} | ${eur((i.price ?? 0) * (i.qty ?? 0))} |`)
if (uncovered.length > 40) out(`| … | +${uncovered.length - 40} позиций | | |`)
out(``)
// (b) BIM-ключи без сметного покрытия
out(`### 3.2 BIM-ключи ведомости без сметной позиции`)
out(``)
out(`| Модуль | Ключи без покрытия |`)
out(`|---|---|`)
for (const m of smeta.modules) {
  const miss = m.all_keys.filter((k) => !m.covered_keys.includes(k))
  if (miss.length)
    out(`| ${m.name} | ${miss.join(', ')} |`)
}
out(``)
out(`_Связка версий: bim-as-code@${smeta.bim_commit || '?'} ↔ model@${String(head).slice(0, 8)}_`)

// ---------- draft bundle: аннотации note (idempotent) ----------
const tag = (code) => {
  const parts = (bimBy.get(code) ?? []).map((p) =>
    `${p.module.match(/\d+/)?.[0] ?? p.module}=${num(p.qty)}`).join(' ')
  return `[BIM@${smeta.bim_commit || '?'} qty: ${parts}]`
}
const stripTag = (s) => {
  if (s == null) return s
  const t = String(s).replace(/\s*\[BIM@[^\]]*\]/g, '').trim()
  return t || null
}
const draftItems = (state.items ?? []).map((i) => {
  if (!bimBy.has(i.code))
    return /\[BIM@/.test(String(i.note ?? ''))
      ? { ...i, note: stripTag(i.note) } : i
  const clean = stripTag(i.note) || ''
  return { ...i, note: `${clean} ${tag(i.code)}`.trim() || null }
})
const annotated = draftItems.filter((i, k) => i.note !== state.items[k].note).length

const draft = { ...state, items: draftItems }

// ---------- вывод ----------
await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, lines.join('\n'), 'utf8')

const consoleRows = [...wbsRows.slice(0, 20), ...ncRows]
console.log(`smeta: ${smeta.modules.length} модулей, ${bimBy.size} позиций реестра`)
console.log(`wbs: ${wbsRows.length} строк, nc: ${ncRows.length} строк, ` +
  `capex без покрытия: ${uncovered.length}`)
console.log(`аннотировано note: ${annotated} NC-позиций`)
console.log(`diff → ${OUT}`)

if (has('apply')) {
  if (!API) { console.error('--apply требует --api (или AURA_API)'); process.exit(1) }
  const r = await fetch(API + '/api/state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...draft, author: AUTHOR, base: head === 'offline:src/data' ? undefined : head,
      message: `BIM@${smeta.bim_commit || '?'} smeta-sync: аннотации NC + DIFF (review)`,
    }),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) { console.error(`POST /api/state → HTTP ${r.status}: ${body.error || ''}`); process.exit(1) }
  console.log(`draft-коммит: ${String(body.sha || body.head).slice(0, 8)}${body.unchanged ? ' (без изменений)' : ''}`)
}
