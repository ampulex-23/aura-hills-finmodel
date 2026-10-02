import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { DocView } from '../src/components/DocView'
import { DOCS } from '../src/docs'

it('all docs render without throwing', () => {
  for (const d of DOCS) {
    const html = renderToStaticMarkup(createElement(DocView, { doc: d }))
    expect(html).toContain('katex')
    expect(html).toContain('<table')
    expect(html).toContain('doc-toc-item')
  }
})
