// Генерация выгрузки в файл для проверки: npx tsx scripts/_gen-xlsx.ts
import { readFileSync, writeFileSync } from 'fs'
import ExcelJS from 'exceljs'
import { exportWorkbook } from '../src/export/excel'

const params = JSON.parse(readFileSync('src/data/params.json', 'utf8'))
const matrix = JSON.parse(readFileSync('src/data/scenarios.json', 'utf8'))
const items = JSON.parse(readFileSync('src/data/nomenclature.json', 'utf8'))
const services = JSON.parse(readFileSync('src/data/services.json', 'utf8')).services

const blob = await exportWorkbook(params, matrix, items, services)
const buf = Buffer.from(await blob.arrayBuffer())
writeFileSync('out/model.xlsx', buf)
console.log('written', buf.length, 'bytes')

// читаем обратно — структура и формулы
const wb = new ExcelJS.Workbook()
await wb.xlsx.load(buf as unknown as ArrayBuffer)
for (const ws of wb.worksheets) {
  let formulas = 0
  ws.eachRow((row) => row.eachCell((c) => { if (typeof c.value === 'object' && c.value?.formula) formulas++ }))
  console.log(`${ws.name}: ${ws.rowCount} rows × ${ws.columnCount} cols, ${formulas} formulas`)
}
// спот-чеки ключевых ячеек
const spot = (sheet: string, addr: string) => {
  const c = wb.getWorksheet(sheet)!.getCell(addr)
  console.log(`${sheet}!${addr} =`, JSON.stringify(c.value))
}
spot('CAPEX', 'E2')
spot('PnL', 'B4') // EBITDA первого месяца
spot('Cash-Flow', 'B6')
spot('Cash-Flow', 'B12')
spot('KPI', 'B13')
spot('Checks', 'B2')
