// Импорт внешних документов в markdown для библиотеки Data Room.
// Конвертация целиком в браузере — сервер остаётся zero-dependency:
// docx → mammoth → html → turndown(gfm), pdf → pdfjs-dist (текст по страницам),
// xlsx → exceljs → GFM-таблицы по листам. md/typ отдаются как есть.
import mammoth from 'mammoth'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import ExcelJS from 'exceljs'

export interface Converted {
  md: string
  note?: string
}

const titleOf = (name: string) =>
  name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()

async function docxToMd(file: File): Promise<Converted> {
  const buf = await file.arrayBuffer()
  const { value: html, messages } = await mammoth.convertToHtml({ arrayBuffer: buf })
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  td.use(gfm)
  const md = td.turndown(html).replace(/\n{3,}/g, '\n\n').trim()
  const warns = messages.filter((m) => m.type === 'warning').length
  return {
    md,
    note: warns ? `mammoth: ${warns} предупреждений при конвертации` : undefined,
  }
}

async function pdfToMd(file: File): Promise<Converted> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const parts: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    // Группируем текстовые фрагменты в строки по Y-координате
    const lines = new Map<number, { x: number; t: string }[]>()
    for (const item of tc.items as { str: string; transform: number[] }[]) {
      const y = Math.round(item.transform[5] / 3) * 3
      const arr = lines.get(y) ?? []
      arr.push({ x: item.transform[4], t: item.str })
      lines.set(y, arr)
    }
    const text = [...lines.values()]
      .map((l) => l.sort((a, b) => a.x - b.x).map((s) => s.t).join('').trim())
      .filter(Boolean)
      .join('\n')
    parts.push(text)
  }
  return {
    md: parts.join('\n\n').trim(),
    note: `Извлечён текст ${doc.numPages} стр.; таблицы и вёрстка pdf не сохраняются — при необходимости поправьте вручную`,
  }
}

async function xlsxToMd(file: File): Promise<Converted> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const sheets: string[] = []
  wb.eachSheet((ws) => {
    const rows: string[][] = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals: string[] = []
      for (let c = 1; c <= row.cellCount; c++) {
        const v = row.getCell(c).value
        const s = v == null ? '' :
          typeof v === 'object' && 'result' in v ? String((v as { result: unknown }).result ?? '') :
          typeof v === 'object' && 'richText' in v ? (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('') :
          v instanceof Date ? v.toISOString().slice(0, 10) :
          String(v)
        vals.push(s.replace(/\|/g, '\\|').replace(/\n+/g, ' '))
      }
      rows.push(vals)
    })
    if (!rows.length) return
    const w = Math.max(...rows.map((r) => r.length))
    const pad = (r: string[]) => [...r, ...Array(w - r.length).fill('')]
    const head = pad(rows[0])
    const md = [
      `## ${ws.name}`, '',
      `| ${head.join(' | ')} |`,
      `| ${head.map(() => '---').join(' | ')} |`,
      ...rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`),
    ].join('\n')
    sheets.push(md)
  })
  return { md: sheets.join('\n\n').trim() }
}

export async function importFile(file: File): Promise<Converted> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md' || ext === 'typ') {
    const md = await file.text()
    return { md }
  }
  if (ext === 'docx') return docxToMd(file)
  if (ext === 'pdf') return pdfToMd(file)
  if (ext === 'xlsx' || ext === 'xlsm') return xlsxToMd(file)
  throw new Error(`Формат .${ext} не поддерживается (md, typ, docx, pdf, xlsx)`)
}

export const docTitle = titleOf
