import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { IconSparkles, IconX, IconSend, IconTrash, IconPin } from '@tabler/icons-react'
import { useModel } from '../store'
import { runModel } from '../model/run'
import { scenarioView } from '../model/view'

type Msg = { role: 'user' | 'assistant'; content: string }
export type Pin = { id: string; label: string; text: string; els: Element[] }

const API = `${import.meta.env.BASE_URL}api`.replace(/\/{2,}/g, '/')

// Пины (прикреплённые клетки/строки/колонки) + состояние дровера —
// в модуле, чтобы таблицы отчётов могли пинить из любого места.
export const useChat = create<{
  open: boolean
  pins: Pin[]
  toggle: () => void
  pin: (p: Omit<Pin, 'id'>) => void
  unpin: (id: string) => void
  unpinEl: (el: Element) => void
  clearPins: () => void
}>((set, get) => ({
  open: false,
  pins: [],
  toggle: () => set((s) => ({ open: !s.open })),
  pin: (p) => {
    if (get().pins.some((x) => x.text === p.text)) return
    p.els.forEach((e) => e.classList.add('ai-pinned'))
    set((s) => ({ pins: [...s.pins, { ...p, id: `${Date.now()}-${s.pins.length}` }] }))
  },
  unpin: (id) => {
    const p = get().pins.find((x) => x.id === id)
    p?.els.forEach((e) => e.classList.remove('ai-pinned'))
    set((s) => ({ pins: s.pins.filter((x) => x.id !== id) }))
  },
  unpinEl: (el) => {
    const p = get().pins.find((x) => x.els.includes(el))
    if (p) get().unpin(p.id)
  },
  clearPins: () => {
    get().pins.forEach((p) => p.els.forEach((e) => e.classList.remove('ai-pinned')))
    set({ pins: [] })
  },
}))

// Текст клетки: обычный textContent + значение вложенного инпута
// (в таблицах-параметрах ячейки — это NumField/TextCell, их значение не входит в textContent).
const cellText = (el: Element | null) => {
  if (!el) return ''
  const inp = el.querySelector('input, textarea') as HTMLInputElement | null
  return ((el.textContent || '') + (inp ? ` ${inp.value}` : ''))
    .replace(/ⓘ|▸|▾|\s+/g, ' ')
    .trim()
}

// Индекс колонки с учётом colSpan (строки состава в «Спецификациях» иначе съезжают).
const colIndexOf = (cell: HTMLTableCellElement) => {
  const tr = cell.closest('tr')
  if (!tr) return cell.cellIndex
  let i = 0
  for (const c of Array.from(tr.cells)) {
    if (c === cell) return i
    i += c.colSpan || 1
  }
  return cell.cellIndex
}

// Клетка строки, накрывающая колонку idx (учитывает colSpan).
const cellAtCol = (tr: HTMLTableRowElement, idx: number) => {
  let i = 0
  for (const c of Array.from(tr.cells)) {
    const span = c.colSpan || 1
    if (idx >= i && idx < i + span) return c
    i += span
  }
  return undefined
}

// Делегированный клик по .month-table: клетка / строка / колонка → pin
function pinFromClick(e: MouseEvent): Pin | null {
  const cell = (e.target as Element).closest('td, th') as HTMLTableCellElement | null
  if (!cell) return null
  const table = cell.closest('table.month-table')
  if (!table) return null
  const sheet = document.querySelector('.page-title')?.textContent?.trim() || 'Отчёт'
  const tr = cell.closest('tr')
  if (!tr) return null
  const ths = [...table.querySelectorAll('thead th')].map(cellText)
  const idx = colIndexOf(cell)

  // заголовок строки (sticky) → вся строка
  if (cell.classList.contains('sticky') && cell.tagName === 'TD' && tr.parentElement?.tagName === 'TBODY') {
    if (tr.classList.contains('section')) return null
    const row = cellText(cell)
    const tds = [...tr.querySelectorAll('td')]
    const pairs = tds.slice(1).map((td) => `${ths[colIndexOf(td)] ?? '?'}=${cellText(td) || '—'}`).join('; ')
    return { id: '', label: `ряд «${row}»`, text: `«${sheet}», строка «${row}» по периодам: ${pairs}`, els: tds }
  }
  // заголовок колонки (thead) → вся колонка
  if (cell.tagName === 'TH' && !cell.classList.contains('sticky')) {
    const col = cellText(cell)
    const bodyRows = [...table.querySelectorAll('tbody tr')]
      .filter((r) => !r.classList.contains('section')) as HTMLTableRowElement[]
    const rows = bodyRows.map((r) => `«${cellText(r.cells[0])}»=${cellText(cellAtCol(r, idx) ?? null) || '—'}`)
    const els = [cell, ...bodyRows.map((r) => cellAtCol(r, idx)).filter(Boolean)] as Element[]
    return { id: '', label: `колонка ${col}`, text: `«${sheet}», колонка «${col}»: ${rows.join('; ')}`, els }
  }
  // обычная клетка
  if (cell.tagName === 'TD' && !cell.classList.contains('sticky')) {
    const row = cellText(tr.querySelector('td.sticky') ?? tr.cells[0])
    const col = ths[idx] ?? `колонка ${idx}`
    return { id: '', label: `${row} · ${col}`, text: `«${sheet}», «${row}» за «${col}»: ${cellText(cell)}`, els: [cell] }
  }
  return null
}

export function AiChat() {
  const { open, pins, toggle, unpin, clearPins, pin } = useChat()
  const [avail, setAvail] = useState<'unknown' | 'ok' | 'off'>('unknown')
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try { return JSON.parse(sessionStorage.getItem('ah-chat') ?? '[]') } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`${API}/health`, { signal: AbortSignal.timeout(4000) })
      .then((r) => r.json())
      .then((h) => setAvail(h.configured ? 'ok' : 'off'))
      .catch(() => setAvail('off'))
  }, [])

  // Пины собираются кликом по таблицам — только когда дровер открыт.
  // Повторный клик по уже подсвеченной клетке снимает пин.
  const { unpinEl } = useChat()
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      const cell = (e.target as Element).closest('td, th')
      if ((e.target as Element).closest('.ai-drawer, .ai-fab')) return
      // Клики по редактируемым ячейкам (инпуты, селекты, кнопки) — не пины:
      // не мешаем фокусу и вводу, пинятся только ячейки с данными.
      if ((e.target as Element).closest('input, button, select, textarea, [role="combobox"], .mantine-Select-dropdown, .mantine-Autocomplete-dropdown, .spec-caret'))
        return
      if (cell?.classList.contains('ai-pinned')) { e.preventDefault(); unpinEl(cell); return }
      const p = pinFromClick(e)
      if (p) { e.preventDefault(); pin(p) }
    }
    document.addEventListener('click', h, true)
    return () => document.removeEventListener('click', h, true)
  }, [open, pin, unpinEl])

  useEffect(() => {
    sessionStorage.setItem('ah-chat', JSON.stringify(msgs.slice(-40)))
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [msgs, status])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    const snapshot = pins.map((p) => ({ text: p.text }))
    // Живой прогон модели с текущими правками пользователя (localStorage):
    // без него инструменты агента отвечали бы по статичному build-снимку.
    let live: unknown = null
    try {
      const { params, matrix, items, scenario } = useModel.getState()
      live = {
        scenario,
        ...scenarioView(runModel(params, matrix, items, scenario), params),
        params,
      }
    } catch { /* если прогон упал — агент работает по серверному снимку */ }
    const shown = text + (pins.length ? `\n\n*📌 ${pins.map((p) => p.label).join(' · ')}*` : '')
    const next = [...msgs, { role: 'user' as const, content: shown }]
    setMsgs([...next, { role: 'assistant', content: '' }])
    setInput('')
    // Пины и подсветка ячеек намеренно НЕ сбрасываются: выбранное остаётся
    // видимым после отправки — снять можно крестиком на чипе или повторным кликом.
    setBusy(true)
    try {
      const res = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // сообщения для API без декоративного 📌-суффикса
        body: JSON.stringify({ messages: [...msgs, { role: 'user', content: text }], pins: snapshot, live }),
      })
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || `HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const p of parts) {
          const line = p.split('\n').find((l) => l.startsWith('data:'))
          if (!line) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          let j: Record<string, unknown> | null = null
          try { j = JSON.parse(data) } catch { continue }
          if (!j) continue
          if (j.aura_status) { setStatus(String(j.aura_status)); continue }
          if (j.aura_error) throw new Error(String(j.aura_error))
          const delta = (j.choices as { delta?: { content?: string } }[] | undefined)?.[0]?.delta?.content
          if (delta) {
            setStatus('')
            setMsgs((m) => {
              const copy = [...m]
              const last = copy[copy.length - 1]
              copy[copy.length - 1] = { role: 'assistant', content: last.content + delta }
              return copy
            })
          }
        }
      }
    } catch (e) {
      setMsgs((m) => {
        const copy = [...m]
        copy[copy.length - 1] = { role: 'assistant', content: `⚠ ${(e as Error).message || 'Ошибка соединения'}` }
        return copy
      })
    } finally {
      setBusy(false)
      setStatus('')
    }
  }

  return (
    <>
      <div className={`ai-drawer${open ? ' open' : ''}`}>
        <div className="ai-head">
          <IconSparkles size={16} />
          <b>ИИ-консультант</b>
          <span className="ai-sub">читает модель через инструменты · кликните по клетке таблицы, чтобы прикрепить</span>
          <button
            className="ai-icon-btn" title="Очистить диалог"
            onClick={() => { setMsgs([]); sessionStorage.removeItem('ah-chat') }}
          >
            <IconTrash size={15} />
          </button>
          <button className="ai-icon-btn" title="Свернуть" onClick={toggle}>
            <IconX size={16} />
          </button>
        </div>

        <div className="ai-list" ref={listRef}>
          {avail === 'off' && (
            <div className="ai-note">
              Консультант недоступен на этом деплое — работает на shared.metodoxia25.net,
              где поднят backend-прокси.
            </div>
          )}
          {msgs.length === 0 && avail !== 'off' && (
            <div className="ai-note">
              Спросите про модель: «какой NPV в Base», «как считается пресейл»,
              «сравни сценарии по IRR». Клик по клетке / строке / колонке таблицы
              прикрепляет данные к вопросу.
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`ai-msg ${m.role}`}>
              {m.role === 'assistant' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {m.content || (busy && i === msgs.length - 1 ? '' : '…')}
                </ReactMarkdown>
              ) : (
                m.content
              )}
            </div>
          ))}
          {busy && status && <div className="ai-status">⏳ {status}</div>}
          {busy && !status && msgs[msgs.length - 1]?.content === '' && <div className="ai-status">⏳ думаю…</div>}
        </div>

        {pins.length > 0 && (
          <div className="ai-pins">
            {pins.map((p) => (
              <span key={p.id} className="ai-pin" title={p.text}>
                <IconPin size={12} /> {p.label}
                <button onClick={() => unpin(p.id)}><IconX size={11} /></button>
              </span>
            ))}
            {pins.length > 1 && (
              <span className="ai-pin ai-pin-clear" title="Снять все пины">
                <button onClick={clearPins}><IconX size={11} /> все</button>
              </span>
            )}
          </div>
        )}

        <div className="ai-input">
          <textarea
            value={input}
            placeholder="Вопрос по модели…"
            rows={2}
            disabled={busy || avail === 'off'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
            }}
          />
          <button className="ai-send" disabled={busy || avail === 'off' || !input.trim()} onClick={() => void send()}>
            <IconSend size={16} />
          </button>
        </div>
      </div>
    </>
  )
}
