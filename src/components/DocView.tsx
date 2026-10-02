import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { DocEntry } from '../docs'

// Рендер markdown-документа Data Room: GFM-таблицы + KaTeX-формулы +
// Mermaid-диаграммы + правая колонка-индекс по заголовкам h2/h3.
// Mermaid подгружается лениво — не раздувает основной бандл.
let mmdSeq = 0

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

function MermaidBlock({ chart }: { chart: string }) {
  const [svg, setSvg] = useState('')
  const failed = useRef(false)
  useEffect(() => {
    let live = true
    import('mermaid')
      .then(({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' })
        return mermaid.render(`doc-mmd-${++mmdSeq}`, chart.trim())
      })
      .then(({ svg }) => live && setSvg(svg))
      .catch(() => live && (failed.current = true))
    return () => {
      live = false
    }
  }, [chart])
  if (failed.current) return <pre>{chart}</pre>
  return <div className="doc-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
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

  // Scroll-spy: подсветка текущего раздела в содержании.
  const [activeId, setActiveId] = useState<string | null>(null)
  useEffect(() => {
    const onScroll = () => {
      let current: string | null = null
      for (const h of toc) {
        const el = document.getElementById(h.id)
        if (el && el.getBoundingClientRect().top <= 90) current = h.id
      }
      setActiveId(current ?? toc[0]?.id ?? null)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [toc])

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
          components={{
            h2: heading('h2'),
            h3: heading('h3'),
            pre({ children }) {
              const child = children as any
              const cls: string = child?.props?.className ?? ''
              if (cls.includes('language-mermaid'))
                return <MermaidBlock chart={textOf(child.props.children)} />
              return <pre>{children}</pre>
            },
          }}
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
              className={`doc-toc-item${h.depth === 3 ? ' sub' : ''}${h.id === activeId ? ' active' : ''}`}
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
