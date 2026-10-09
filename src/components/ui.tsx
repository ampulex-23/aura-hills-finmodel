import { useMemo, useState } from 'react'
import { HoverCard, NumberInput, TextInput } from '@mantine/core'
import katex from 'katex'
import 'katex/dist/katex.min.css'

export const fmt = (v: number, digits = 0) =>
  isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: digits }) : '—'
export const fmtEur = (v: number) => `€${fmt(v)}`
export const fmtPct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`

// Редактируемое текстовое поле в гриде: видимый бордер + hover/focus-подсветка
// (класс .tcell в index.css) — сразу считывается как «кликни и правь».
export function TextCell({
  value, onChange, w, placeholder,
}: {
  value: string
  onChange: (v: string) => void
  w?: number | string
  placeholder?: string
}) {
  return (
    <TextInput
      className="tcell"
      size="xs"
      w={w}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  )
}

// Редактируемое числовое поле: value — текущее, onChange получает число.
export function NumField({
  value, onChange, step, pct, suffix, disabled,
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  pct?: boolean
  suffix?: string
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  // Округление — иначе 0.55 * 100 показывается как 55.00000000000001
  const shown = Number((pct ? value * 100 : value).toFixed(6))
  return (
    <NumberInput
      className="num"
      size="xs"
      hideControls
      thousandSeparator=" "
      disabled={disabled}
      step={step ?? (pct ? 1 : 0.01)}
      suffix={suffix ? ` ${suffix}` : undefined}
      value={editing ? text : shown}
      onFocus={() => {
        setEditing(true)
        setText(String(shown))
      }}
      onBlur={() => setEditing(false)}
      onChange={(v) => {
        setText(String(v))
        const n = typeof v === 'number' ? v : parseFloat(String(v))
        if (isFinite(n)) onChange(pct ? n / 100 : n)
      }}
    />
  )
}

// Всплывающая пояснялка: заголовок, текст, LaTeX-формула и подстановка чисел.
export interface CellHint {
  title?: string
  text?: string
  tex?: string
  calc?: string
}

const renderTex = (tex: string) => {
  try {
    return katex.renderToString(tex, { throwOnError: false })
  } catch {
    return tex
  }
}

function HintBody({ hint }: { hint: CellHint }) {
  const html = useMemo(() => (hint.tex ? renderTex(hint.tex) : null), [hint.tex])
  return (
    <div className="hint">
      {hint.title && <div className="hint-title">{hint.title}</div>}
      {hint.text && <div className="hint-text">{hint.text}</div>}
      {html && <div className="hint-tex" dangerouslySetInnerHTML={{ __html: html }} />}
      {hint.calc && <div className="hint-calc">{hint.calc}</div>}
    </div>
  )
}

// Обёртка: вешает балун-подсказку на произвольный элемент (клетку, число, KPI).
// openDelay по умолчанию — чтобы балуны не спамили при движении мыши по таблице.
export function Hint({
  hint, delay = 450, children,
}: {
  hint: CellHint | null | undefined
  delay?: number
  children: React.ReactElement
}) {
  if (!hint) return children
  return (
    <HoverCard
      position="top" openDelay={delay} closeDelay={90}
      withArrow shadow="lg" withinPortal width={340}
    >
      <HoverCard.Target>{children}</HoverCard.Target>
      <HoverCard.Dropdown>
        <HintBody hint={hint} />
      </HoverCard.Dropdown>
    </HoverCard>
  )
}

// Иконка ⓘ у заголовка строки — общая формула строки.
export function Formula({ tex, label, text }: { tex?: string; label?: string; text?: string }) {
  return (
    <HoverCard position="bottom-start" openDelay={250} closeDelay={90} withArrow shadow="lg" withinPortal width={340}>
      <HoverCard.Target>
        <span className="formula">ⓘ{label ? ` ${label}` : ''}</span>
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <HintBody hint={{ text, tex }} />
      </HoverCard.Dropdown>
    </HoverCard>
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
  tip?: string // человекочитаемое пояснение строки (иконка ⓘ)
  hint?: (ci: number, v: number | string) => CellHint | null // пояснение клетки
  children?: RowDef[] // раскрываемые позиции внутри статьи (свернуты по умолчанию)
}

// Помесячная таблица (аналог строки листа) — горизонтальный скролл, итог справа.
// searchable: поле поиска по названиям строк и вложенных позиций — совпадения
// раскрываются автоматически. Строки с children разворачиваются по клику.
export function MonthTable({ rows, labels, withSum, searchable }: { rows: RowDef[]; labels: string[]; withSum?: boolean; searchable?: boolean }) {
  const [q, setQ] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const f = (v: number | string, kind?: string) =>
    typeof v === 'string' ? v : kind === 'pct' ? fmtPct(v, 1) : fmt(v)
  const query = q.trim().toLowerCase()
  const filtering = query.length > 0
  const match = (s: string) => s.toLowerCase().includes(query)

  const nCols = labels.length + (withSum ? 1 : 0)

  const renderRow = (r: RowDef, key: string, child = false, lastChild = false) => (
    <tr key={key} className={`${r.bold ? 'bold' : ''} ${child ? 'spec-item' : ''}`}>
      <td className={`sticky${child ? ' spec-leaf' : ''}${child && lastChild ? ' last' : ''}`}
        onClick={r.children?.length ? () => setClosed((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n }) : undefined}
        style={r.children?.length ? { cursor: 'pointer' } : undefined}
      >
        {r.children?.length ? (
          <span className="spec-caret">{filtering || !closed.has(key) ? '▾' : '▸'}</span>
        ) : null}
        {r.label}
        {(r.tex || r.tip) && <Formula tex={r.tex} text={r.tip} />}
      </td>
      {r.values.map((v, ci) => {
        let h: CellHint | null = null
        try { h = r.hint?.(ci, v) ?? null } catch { /* хинт не должен ронять таблицу */ }
        return (
          <td key={ci}>
            {h ? <Hint hint={h}><span className="cellval">{f(v, r.fmt)}</span></Hint> : f(v, r.fmt)}
          </td>
        )
      })}
      {withSum && (() => {
        const sumV = typeof r.values[0] === 'number' ? (r.values as number[]).reduce((a, b) => a + b, 0) : '—'
        const h = (r.hint || r.tip || r.tex)
          ? { title: r.label, text: r.tip ?? 'Сумма по строке за весь период.', tex: r.tex, calc: `Σ ${labels.length} мес = ${f(sumV, r.fmt)}` }
          : null
        return (
          <td className="sum">
            {h ? <Hint hint={h}><span className="cellval">{f(sumV, r.fmt)}</span></Hint> : f(sumV, r.fmt)}
          </td>
        )
      })()}
    </tr>
  )

  return (
    <div>
      {searchable && (
        <TextInput
          size="xs" w={320} mb={6}
          placeholder="Поиск по статьям и позициям…"
          value={q} onChange={(e) => setQ(e.currentTarget.value)}
        />
      )}
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
            {rows.map((r, ri) => {
              if (r.section) {
                // При фильтрации секция видна, только если под ней есть совпадения
                if (filtering) {
                  let any = false
                  for (let j = ri + 1; j < rows.length && !rows[j].section; j++) {
                    const rr = rows[j]
                    if (match(rr.label) || rr.children?.some((c) => match(c.label))) { any = true; break }
                  }
                  if (!any) return null
                }
                return <tr key={ri} className="section"><td className="sticky" colSpan={nCols + 1}>{r.label}</td></tr>
              }
              const kids = r.children ?? []
              const parentHit = match(r.label)
              const kidsHit = kids.map((c) => match(c.label))
              if (filtering && !parentHit && !kidsHit.some(Boolean)) return null
              const kidsOpen = filtering ? true : !closed.has(String(ri))
              const visKids = filtering
                ? kids.map((c, i) => (parentHit || kidsHit[i] ? c : null)).filter(Boolean) as RowDef[]
                : kids
              return [
                renderRow(r, String(ri)),
                ...(kidsOpen
                  ? visKids.map((c, ci2) => renderRow(c, `${ri}-${ci2}`, true, ci2 === visKids.length - 1))
                  : []),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
