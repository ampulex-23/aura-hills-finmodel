import ExcelJS from 'exceljs'
import type { ModelResult, NomenclatureItem, Params, ScenarioMatrix } from '../model/types'
import { runModel } from '../model/run'
import { computeSensitivity, T1_WACC, T2_CAPEX } from '../model/sensitivity'
import { landedCost } from '../model/opex'

// Экспорт модели в .xlsx — сгенерированный артефакт (значения, не исходник).
// Состав листов повторяет структуру исходной книги.

const HEADER = { font: { bold: true, color: { argb: 'FF93A3BC' } }, fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1A2334' } } }
const EUR = '#,##0'
const PCT = '0.0%'

function sheetOfMonths(wb: ExcelJS.Workbook, name: string, labels: string[], rows: { label: string; values: number[]; bold?: boolean; pct?: boolean }[]) {
  const ws = wb.addWorksheet(name)
  ws.addRow(['Статья', ...labels])
  ws.getRow(1).eachCell((c) => Object.assign(c, HEADER))
  ws.getColumn(1).width = 34
  for (const r of rows) {
    const row = ws.addRow([r.label, ...r.values])
    if (r.bold) row.font = { bold: true }
    row.eachCell((c, i) => {
      if (i > 1) c.numFmt = r.pct ? PCT : EUR
    })
  }
  return ws
}

export async function exportWorkbook(
  params: Params,
  matrix: ScenarioMatrix,
  items: NomenclatureItem[],
): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AURA HILLS Model'
  const labels = Array.from({ length: params.meta.opsMonths }, (_, i) => {
    const [y, m] = params.meta.openingDate.slice(0, 7).split('-').map(Number)
    const t = y * 12 + (m - 1) + i
    return `${String((t % 12) + 1).padStart(2, '0')}.${Math.floor(t / 12)}`
  })

  // Результаты по всем сценариям — лист «Сценарии» получает живой снимок.
  const results = matrix.names.map((n) => runModel(params, matrix, items, n))
  const r = results[matrix.names.indexOf(params.meta.scenario)] ?? results[1]

  // Допущения
  {
    const ws = wb.addWorksheet('Допущения')
    ws.addRows([
      ['Параметр', 'Значение'],
      ['Активный сценарий', params.meta.scenario],
      ['Пакетный режим', params.meta.mode],
      ['Режим НДС', params.meta.vatMode],
      ['Курс RUB/EUR', params.general.rubEurRate],
      ['Инфляция', params.general.inflation],
      ['WACC', params.general.wacc],
      ['CIT', params.taxes.cit],
      ['НДС стандартный', params.taxes.vatStd],
      ['Мультипликатор спроса', params.service.demandMult],
      ['Депозит на гостя, €', params.deposit.base],
    ])
    ws.getRow(1).eachCell((c) => Object.assign(c, HEADER))
    ws.getColumn(1).width = 30
  }

  // Сценарии: матрица + снимок результатов
  {
    const ws = wb.addWorksheet('Сценарии')
    ws.addRow(['Параметр', ...matrix.names])
    ws.getRow(1).eachCell((c) => Object.assign(c, HEADER))
    const put = (label: string, vals: number[]) => ws.addRow([label, ...vals])
    ;(['y1', 'y2', 'y3', 'y4', 'y5'] as const).forEach((y, i) =>
      put(`Бани — Год ${i + 1}`, matrix.baths[y]),
    )
    put('Парения — Год 1', matrix.steam.y1)
    put('Парения — Год 3+', matrix.steam.y3)
    put('Рост цен', matrix.priceGrowth)
    put('Корректировка CAPEX', matrix.capexAdj)
    put('Uptake (непакетный)', matrix.uptake)
    ws.addRow([])
    ws.addRow(['РЕЗУЛЬТАТЫ', ...matrix.names])
    ws.getRow(ws.rowCount).eachCell((c) => Object.assign(c, HEADER))
    put('NPV (5 лет), EUR', results.map((x) => Math.round(x.kpis.npv)))
    put('IRR годовой', results.map((x) => x.kpis.irrAnnual))
    put('Окупаемость, мес', results.map((x) => x.kpis.paybackMonths))
    put('Диск. окупаемость, мес', results.map((x) => x.kpis.discountedPaybackMonths))
    put('Пиковая потребность, EUR', results.map((x) => Math.round(x.kpis.peakFundingNeed)))
    ws.getColumn(1).width = 30
  }

  // Выручка
  sheetOfMonths(wb, 'Выручка', labels, [
    { label: 'Загрузка', values: r.revenue.map((m) => m.bathsLoad), pct: true },
    { label: 'Слоты', values: r.revenue.map((m) => m.slots) },
    { label: 'Аренда бань', values: r.revenue.map((m) => m.rental) },
    { label: 'Парения', values: r.revenue.map((m) => m.steamTotal) },
    { label: 'Массаж', values: r.revenue.map((m) => m.massageTotal) },
    { label: 'Доп.услуги', values: r.revenue.map((m) => m.extraTotal) },
    { label: 'Глэмпинг', values: r.revenue.map((m) => m.glamping) },
    { label: 'Членства + сертификаты', values: r.revenue.map((m) => m.membershipTotal) },
    { label: 'F&B', values: r.revenue.map((m) => m.fb) },
    { label: 'ИТОГО ВЫРУЧКА', values: r.revenue.map((m) => m.total), bold: true },
  ])

  // OPEX
  sheetOfMonths(wb, 'OPEX', labels, [
    { label: 'Постоянные', values: r.opex.map((m) => m.fixedTotal) },
    { label: 'IT / АСУ', values: r.opex.map((m) => m.itTotal) },
    { label: 'Аренда земли', values: r.opex.map((m) => m.landRent) },
    { label: 'Переменные (номенклатура)', values: r.opex.map((m) => m.variableTotal) },
    { label: '% от выручки', values: r.opex.map((m) => m.pctTotal) },
    { label: 'ИТОГО OPEX', values: r.opex.map((m) => m.total), bold: true },
  ])

  // ФОТ
  sheetOfMonths(wb, 'ФОТ', labels, [
    { label: 'Оклады', values: r.fot.map((m) => m.salaries) },
    { label: 'KPI бонусы', values: r.fot.map((m) => m.bonuses) },
    { label: 'Взносы', values: r.fot.map((m) => m.employerContrib) },
    { label: 'ИТОГО ФОТ', values: r.fot.map((m) => m.total), bold: true },
  ])

  // CAPEX
  {
    const ws = wb.addWorksheet('CAPEX')
    ws.addRow(['Позиция', 'Сумма, EUR'])
    ws.getRow(1).eachCell((c) => Object.assign(c, HEADER))
    r.capex.items.forEach((i) => ws.addRow([i.name, i.eur]))
    ws.addRow(['ИТОГО CAPEX', r.capex.totalEur]).font = { bold: true }
    ws.addRow(['С буфером сценария', r.capex.adjustedEur]).font = { bold: true }
    ws.addRow(['Амортизация, EUR/мес', r.capex.monthlyAmort])
    ws.getColumn(1).width = 44
    ws.getColumn(2).numFmt = EUR
  }

  // Налоги
  sheetOfMonths(wb, 'Налоги', labels, [
    { label: 'НДС 19%', values: r.taxes.map((m) => m.vatOut19) },
    { label: 'НДС 9%', values: r.taxes.map((m) => m.vatOut9) },
    { label: 'Входной НДС', values: r.taxes.map((m) => m.inputVat) },
    { label: 'НДС-кредит', values: r.taxes.map((m) => m.vatCredit) },
    { label: 'НДС к уплате', values: r.taxes.map((m) => m.vatPayable), bold: true },
    { label: 'CIT', values: r.taxes.map((m) => m.cit) },
    { label: 'Дивиденды', values: r.taxes.map((m) => m.dividends) },
    { label: 'SDC', values: r.taxes.map((m) => m.sdc) },
    { label: 'ИТОГО НАЛОГИ', values: r.taxes.map((m) => m.total), bold: true },
  ])

  // P&L
  sheetOfMonths(wb, 'PnL', labels, [
    { label: 'Выручка нетто', values: r.pnl.map((m) => m.revenueNet) },
    { label: 'Маржинальная прибыль', values: r.pnl.map((m) => m.marginalProfit) },
    { label: 'Постоянные', values: r.pnl.map((m) => m.fixedOpex) },
    { label: 'ФОТ', values: r.pnl.map((m) => m.fot) },
    { label: 'EBITDA', values: r.pnl.map((m) => m.ebitda), bold: true },
    { label: 'Амортизация', values: r.pnl.map((m) => m.amortization) },
    { label: 'EBIT', values: r.pnl.map((m) => m.ebit), bold: true },
    { label: 'CIT', values: r.pnl.map((m) => m.cit) },
    { label: 'Чистая прибыль', values: r.pnl.map((m) => m.netProfit), bold: true },
    { label: 'Дивиденды', values: r.pnl.map((m) => m.dividends) },
    { label: 'SDC', values: r.pnl.map((m) => m.sdc) },
    { label: 'ЧП после SDC', values: r.pnl.map((m) => m.netAfterSdc), bold: true },
  ])

  // Cash-Flow (72 мес)
  {
    const cfLabels = r.cashflow.map((m) => m.label)
    sheetOfMonths(wb, 'Cash-Flow', cfLabels, [
      { label: 'Чистая прибыль', values: r.cashflow.map((m) => m.netProfit) },
      { label: 'Амортизация', values: r.cashflow.map((m) => m.amortization) },
      { label: 'Операционный CF', values: r.cashflow.map((m) => m.operatingCf) },
      { label: 'CAPEX', values: r.cashflow.map((m) => m.capex) },
      { label: 'Пре-сейл', values: r.cashflow.map((m) => m.presale) },
      { label: 'FCFF', values: r.cashflow.map((m) => m.fcff), bold: true },
      { label: 'Дивиденды', values: r.cashflow.map((m) => m.dividends) },
      { label: 'SDC', values: r.cashflow.map((m) => m.sdc) },
      { label: 'CF после распределения', values: r.cashflow.map((m) => m.totalCf), bold: true },
      { label: 'Накопл. FCFF', values: r.cashflow.map((m) => m.cumFcff) },
      { label: 'Накопл. DCF', values: r.cashflow.map((m) => m.cumDcf), bold: true },
    ])
  }

  // Номенклатура
  {
    const ws = wb.addWorksheet('Номенклатура')
    ws.addRow(['Код', 'Наименование', 'Категория', 'Тип', 'Ед.', 'Цена €', 'Дост.€/ед', 'Дост.%', 'Landed €', 'Учёт', 'Статья OPEX', 'Норма', 'База', 'Кол-во'])
    ws.getRow(1).eachCell((c) => Object.assign(c, HEADER))
    for (const it of items)
      ws.addRow([it.code, it.name, it.category, it.type, it.unit, it.price, it.deliveryFix, it.deliveryPct,
        landedCost(it), it.use, it.opexArticle, it.norm, it.normBase, it.qty])
    ws.getColumn(2).width = 30
  }

  // Sensitivity
  {
    const ws = wb.addWorksheet('Sensitivity')
    const s = computeSensitivity(params, matrix, items)
    ws.addRow([`Спрос \\ WACC`, ...T1_WACC.map((w) => `${w * 100}%`)])
    ws.getRow(1).eachCell((c) => Object.assign(c, HEADER))
    for (const row of s.t1.rows)
      ws.addRow([`×${row.demand}`, ...row.cells.map((c) => Math.round(c.npv))])
    ws.addRow([])
    ws.addRow(['Рост цен \\ CAPEX', ...T2_CAPEX.map((c) => `+${c * 100}%`)])
    for (const row of s.t2.rows)
      ws.addRow([`${row.priceGrowth * 100}%`, ...row.cells.map((c) => Math.round(c.npv))])
    ws.addRow([])
    ws.addRow(['Цены ×', ...s.t3.map((t) => `×${t.priceMult}`)])
    ws.addRow(['NPV', ...s.t3.map((t) => Math.round(t.npv))])
    ws.addRow(['IRR', ...s.t3.map((t) => t.irr)])
  }

  // KPI-Dashboard
  {
    const ws = wb.addWorksheet('KPI')
    ws.addRow(['Метрика', ...matrix.names])
    ws.getRow(1).eachCell((c) => Object.assign(c, HEADER))
    const put = (l: string, f: (x: ModelResult) => number, pct = false) => {
      const row = ws.addRow([l, ...results.map(f)])
      row.eachCell((c, i) => { if (i > 1) c.numFmt = pct ? PCT : EUR })
    }
    put('NPV (5 лет), EUR', (x) => Math.round(x.kpis.npv))
    put('IRR годовой', (x) => x.kpis.irrAnnual, true)
    put('Окупаемость, мес', (x) => x.kpis.paybackMonths)
    put('Диск. окупаемость, мес', (x) => x.kpis.discountedPaybackMonths)
    put('Пиковая потребность, EUR', (x) => Math.round(x.kpis.peakFundingNeed))
    put('Выручка год 1, EUR', (x) => Math.round(x.revenue.slice(0, 12).reduce((s2, m) => s2 + m.total, 0)))
    put('EBITDA год 1, EUR', (x) => Math.round(x.pnl.slice(0, 12).reduce((s2, m) => s2 + m.ebitda, 0)))
    ws.getColumn(1).width = 30
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
