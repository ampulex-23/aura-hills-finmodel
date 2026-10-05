import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { IconSparkles, IconX, IconSend, IconTrash, IconPin } from '@tabler/icons-react'

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

const cellText = (el: Element | null) => (el?.textContent || '').replace(/ⓘ|\s+/g, ' ').trim()

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
  const idx = cell.cellIndex

  // заголовок строки (sticky) → вся строка
  if (cell.classList.contains('sticky') && cell.tagName === 'TD' && tr.parentElement?.tagName === 'TBODY') {
    if (tr.classList.contains('section')) return null
    const row = cellText(cell)
    const tds = [...tr.querySelectorAll('td')]
    const vals = tds.slice(1).map(cellText)
    const cols = ths.slice(1)
    const pairs = cols.map((c, i) => `${c}=${vals[i] ?? '—'}`).join('; ')
    return { id: '', label: `ряд «${row}»`, text: `«${sheet}», строка «${row}» по периодам: ${pairs}`, els: tds }
  }
  // заголовок колонки (thead) → вся колонка
  if (cell.tagName === 'TH' && !cell.classList.contains('sticky')) {
    const col = cellText(cell)
    const bodyRows = [...table.querySelectorAll('tbody tr')].filter((r) => !r.classList.contains('section'))
    const rows = bodyRows.map((r) => {
      const tds = r.querySelectorAll('td')
      return `«${cellText(tds[0])}»=${cellText(tds[idx]) ?? '—'}`
    })
    const els = [cell, ...bodyRows.map((r) => r.querySelectorAll('td')[idx]).filter(Boolean)] as Element[]
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
      if ((e.target as Element).closest('input, button, select, textarea, [role="combobox"], .mantine-Select-dropdown, .mantine-Autocomplete-dropdown'))
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
    const shown = text + (pins.length ? `\n\n*📌 ${pins.map((p) => p.label).join(' · ')}*` : '')
    const next = [...msgs, { role: 'user' as const, content: shown }]
    setMsgs([...next, { role: 'assistant', content: '' }])
    setInput('')
    clearPins()
    setBusy(true)
    try {
      const res = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // сообщения для API без декоративного 📌-суффикса
        body: JSON.stringify({ messages: [...msgs, { role: 'user', content: text }], pins: snapshot }),
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
      <button className="ai-fab" onClick={toggle} title="ИИ-консультант">
        {open ? <IconX size={20} /> : <IconSparkles size={20} />}
      </button>

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
