// Разовый конвертер стейджинга data/ → markdown для импорта в Data Room.
// Использование: node scripts/convert-staging.mjs <файл> [<файл>...]
// Пишет <имя>.md рядом с исходником (в data/converted/).
import mammoth from 'mammoth'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import ExcelJS from 'exceljs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../../data/converted/', import.meta.url))

async function docxToMd(path) {
  const { value: html, messages } = await mammoth.convertToHtml({ path })
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  td.use(gfm)
  const md = td.turndown(html).replace(/\n{3,}/g, '\n\n').trim()
  const warns = messages.filter((m) => m.type === 'warning')
  return { md, note: warns.length ? `${warns.length} warnings` : '' }
}

async function pdfToMd(path) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await readFile(path)) }).promise
  const parts = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    const lines = new Map()
    for (const it of tc.items) {
      const y = Math.round(it.transform[5] / 3) * 3
      const arr = lines.get(y) ?? []
      arr.push({ x: it.transform[4], t: it.str })
      lines.set(y, arr)
    }
    parts.push([...lines.values()]
      .map((l) => l.sort((a, b) => a.x - b.x).map((s) => s.t).join('').trim())
      .filter(Boolean).join('\n'))
  }
  return { md: parts.join('\n\n').trim(), note: `${doc.numPages} стр.` }
}

async function xlsxToMd(path) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const sheets = []
  wb.eachSheet((ws) => {
    const rows = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = []
      for (let c = 1; c <= row.cellCount; c++) {
        const v = row.getCell(c).value
        const s = v == null ? '' :
          typeof v === 'object' && 'result' in v ? String(v.result ?? '') :
          typeof v === 'object' && 'richText' in v ? v.richText.map((t) => t.text).join('') :
          v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
        vals.push(s.replace(/\|/g, '\\|').replace(/\n+/g, ' '))
      }
      rows.push(vals)
    })
    if (!rows.length) return
    const w = Math.max(...rows.map((r) => r.length))
    const pad = (r) => [...r, ...Array(w - r.length).fill('')]
    sheets.push([`## ${ws.name}`, '',
      `| ${pad(rows[0]).join(' | ')} |`,
      `| ${pad(rows[0]).map(() => '---').join(' | ')} |`,
      ...rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`)].join('\n'))
  })
  return { md: sheets.join('\n\n').trim(), note: `${wb.worksheets.length} листов` }
}

await mkdir(OUT, { recursive: true })
for (const path of process.argv.slice(2)) {
  const ext = extname(path).toLowerCase()
  const fn = { '.docx': docxToMd, '.pdf': pdfToMd, '.xlsx': xlsxToMd }[ext]
  if (!fn) { console.log(`skip ${basename(path)} (.${ext.slice(1)})`); continue }
  try {
    const { md, note } = await fn(path)
    const out = join(OUT, basename(path).replace(ext, '.md'))
    await writeFile(out, md)
    console.log(`ok  ${basename(path)} → ${basename(out)} (${md.length} ch) ${note}`)
  } catch (e) {
    console.log(`ERR ${basename(path)}: ${e.message}`)
  }
}
