import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { DocView } from '../src/components/DocView'
import { DOCS } from '../src/docs'

it('all docs render without throwing', () => {
  for (const d of DOCS.filter((d) => d.kind === 'md')) {
    const html = renderToStaticMarkup(createElement(DocView, { doc: d }))
    expect(html).toContain('katex')
    expect(html).toContain('<table')
    expect(html).toContain('doc-toc-item')
    expect(html).not.toContain('katex-error')
    expect(html).not.toContain('##')
  }
})
