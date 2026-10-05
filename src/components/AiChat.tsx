import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { IconSparkles, IconX, IconSend, IconTrash } from '@tabler/icons-react'

type Msg = { role: 'user' | 'assistant'; content: string }

const API = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, '/')

export function AiChat() {
  const [open, setOpen] = useState(false)
  const [avail, setAvail] = useState<'unknown' | 'ok' | 'off'>('unknown')
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try { return JSON.parse(sessionStorage.getItem('ah-chat') ?? '[]') } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch(`${API}/health`, { signal: AbortSignal.timeout(4000) })
      .then((r) => r.json())
      .then((h) => setAvail(h.configured ? 'ok' : 'off'))
      .catch(() => setAvail('off'))
  }, [])

  useEffect(() => {
    sessionStorage.setItem('ah-chat', JSON.stringify(msgs.slice(-40)))
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [msgs])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    const next = [...msgs, { role: 'user' as const, content: text }]
    setMsgs([...next, { role: 'assistant', content: '' }])
    setInput('')
    setBusy(true)
    abortRef.current = new AbortController()
    try {
      const res = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
        signal: abortRef.current.signal,
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
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content
            if (delta) setMsgs((m) => {
              const copy = [...m]
              const last = copy[copy.length - 1]
              copy[copy.length - 1] = { role: 'assistant', content: last.content + delta }
              return copy
            })
          } catch { /* keep-alive / неполный json */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setMsgs((m) => {
          const copy = [...m]
          copy[copy.length - 1] = {
            role: 'assistant',
            content: `⚠ ${(e as Error).message || 'Ошибка соединения'}`,
          }
          return copy
        })
      } else {
        setMsgs((m) => m.slice(0, -1))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        className={`ai-fab${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="ИИ-консультант"
      >
        {open ? <IconX size={20} /> : <IconSparkles size={20} />}
      </button>

      {open && (
        <div className="ai-panel">
          <div className="ai-head">
            <IconSparkles size={16} />
            <b>ИИ-консультант</b>
            <span className="ai-sub">знает допущения и расчёты модели</span>
            <button
              className="ai-icon-btn" title="Очистить диалог"
              onClick={() => { setMsgs([]); sessionStorage.removeItem('ah-chat') }}
            >
              <IconTrash size={15} />
            </button>
          </div>

          <div className="ai-list" ref={listRef}>
            {avail === 'off' && (
              <div className="ai-note">
                Консультант недоступен на этом деплое — работает на
                shared.metodoxia25.net, где поднят backend-прокси.
              </div>
            )}
            {msgs.length === 0 && avail !== 'off' && (
              <div className="ai-note">
                Спросите про модель: «какой NPV в Base», «что включено в CAPEX»,
                «объясни пресейл» — отвечу по реальным данным расчёта.
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}`}>
                {m.role === 'assistant'
                  ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || '…'}</ReactMarkdown>
                  : m.content}
              </div>
            ))}
          </div>

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
      )}
    </>
  )
}
