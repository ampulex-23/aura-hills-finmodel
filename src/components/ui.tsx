import { useEffect, useRef, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

export const fmt = (v: number, digits = 0) =>
  isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: digits }) : '—'
export const fmtEur = (v: number) => `€${fmt(v)}`
export const fmtPct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`

// Редактируемое числовое поле: value — текущее, onChange получает число.
export function NumField({
  value, onChange, step, pct, suffix,
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  pct?: boolean
  suffix?: string
}) {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const shown = pct ? (value * 100).toString() : String(value)
  return (
    <input
      className="num"
      type="number"
      step={step ?? (pct ? 1 : 0.01)}
      value={editing ? text : shown}
      onFocus={() => {
        setEditing(true)
        setText(shown)
      }}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        setText(e.target.value)
        const v = parseFloat(e.target.value)
        if (isFinite(v)) onChange(pct ? v / 100 : v)
      }}
      title={suffix}
    />
  )
}

// Тултип с формулой — LaTeX через KaTeX.
export function Formula({ tex, label }: { tex: string; label?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (open && ref.current) {
      try {
        katex.render(tex, ref.current, { throwOnError: false })
      } catch { /* noop */ }
    }
  }, [open, tex])
  return (
    <span className="formula" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      ⓘ{label ? ` ${label}` : ''}
      {open && (
        <span className="formula-tip">
          <span ref={ref} />
        </span>
      )}
    </span>
  )
}

const MONTHS_RU = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']
export function monthLabels(startIso: string, count: number): string[] {
  const [y0, m0] = startIso.slice(0, 7).split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const t = y0 * 12 + (m0 - 1) + i
    return `${MONTHS_RU[t % 12]} ${Math.floor(t / 12) % 100}`
  })
}

export interface RowDef {
  label: string
  values: (number | string)[]
  bold?: boolean
  section?: boolean
  fmt?: 'eur' | 'num' | 'pct'
  tex?: string
}

// Помесячная таблица (аналог строки листа) — горизонтальный скролл, итог справа.
export function MonthTable({ rows, labels, withSum }: { rows: RowDef[]; labels: string[]; withSum?: boolean }) {
  const f = (v: number | string, kind?: string) =>
    typeof v === 'string' ? v : kind === 'pct' ? fmtPct(v, 1) : fmt(v)
  return (
    <div className="table-wrap">
      <table className="month-table">
        <thead>
          <tr>
            <th className="sticky">Статья</th>
            {labels.map((l, i) => (
              <th key={i}>{l}</th>
            ))}
            {withSum && <th className="sum">Σ</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) =>
            r.section ? (
              <tr key={ri} className="section"><td className="sticky" colSpan={labels.length + 1}>{r.label}</td></tr>
            ) : (
              <tr key={ri} className={r.bold ? 'bold' : ''}>
                <td className="sticky">
                  {r.label}
                  {r.tex && <Formula tex={r.tex} />}
                </td>
                {r.values.map((v, ci) => (
                  <td key={ci}>{f(v, r.fmt)}</td>
                ))}
                {withSum && (
                  <td className="sum">
                    {f(typeof r.values[0] === 'number' ? (r.values as number[]).reduce((a, b) => a + b, 0) : '—', r.fmt)}
                  </td>
                )}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}
