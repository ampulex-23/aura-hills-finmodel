import { useMemo, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { DocEntry } from '../docs'

// Рендер markdown-документа Data Room: GFM-таблицы + KaTeX-формулы
// + правая колонка-индекс по заголовкам h2/h3.
const slugify = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')

const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in (node as any))
    return textOf((node as any).props.children)
  return ''
}

export function DocView({ doc }: { doc: DocEntry }) {
  const toc = useMemo(
    () =>
      doc.source
        .split('\n')
        .map((l) => l.match(/^(#{2,3})\s+(.+)/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => ({
          depth: m[1].length,
          text: m[2].replace(/[*`]/g, '').trim(),
          id: slugify(m[2]),
        })),
    [doc.source],
  )

  const heading = (Tag: 'h2' | 'h3') =>
    function Heading({ children }: { children?: ReactNode }) {
      const id = slugify(textOf(children))
      return <Tag id={id}>{children}</Tag>
    }

  const jump = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="doc-layout">
      <article className="doc-body">
        <Markdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{ h2: heading('h2'), h3: heading('h3') }}
        >
          {doc.source}
        </Markdown>
      </article>
      {toc.length > 0 && (
        <aside className="doc-toc">
          <div className="doc-toc-title">Содержание</div>
          {toc.map((h) => (
            <button
              key={h.id}
              className={`doc-toc-item${h.depth === 3 ? ' sub' : ''}`}
              onClick={() => jump(h.id)}
            >
              {h.text}
            </button>
          ))}
        </aside>
      )}
    </div>
  )
}
