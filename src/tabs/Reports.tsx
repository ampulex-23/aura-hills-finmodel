import type { ModelResult } from '../model/types'
import { MonthTable, monthLabels, fmt, fmtEur } from '../components/ui'

// Расчётные вкладки: помесячные таблицы 1:1 листам Excel.

export function Revenue({ r, labels }: { r: ModelResult; labels: string[] }) {
  const R = r.revenue
  const stream = (get: (m: (typeof R)[0]) => number) => R.map(get)
  const rows = [
    { label: 'Загрузка бань', values: stream((m) => m.bathsLoad), fmt: 'pct' as const,
      tex: String.raw`\min(1,\ demand \times load_{year} \times season_{month} \times ramp)` },
    { label: 'Слоты (шт)', values: stream((m) => m.slots), tex: String.raw`30 \times slots_{day} \times uptime \times load` },
    { label: 'Аренда бань', values: stream((m) => m.rental), tex: String.raw`\sum_{mod} slots \times \overline{price}_{mod} \times (1+g)^{year}` },
    { label: 'Парения', values: stream((m) => m.steamTotal), tex: String.raw`slots_{m1} \times \overline{cap} \times uptake \times base` },
    { label: 'Массаж', values: stream((m) => m.massageTotal) },
    { label: 'Доп.услуги', values: stream((m) => m.extraTotal), tex: String.raw`svc \times cap \times uptake \times wallet_{share} \times deposit` },
    { label: 'Глэмпинг', values: stream((m) => m.glamping) },
    { label: 'Членства + сертификаты', values: stream((m) => m.membershipTotal) },
    { label: 'F&B', values: stream((m) => m.fb), tex: String.raw`guests \times price_{fb}` },
    { label: 'ИТОГО ВЫРУЧКА', values: stream((m) => m.total), bold: true },
  ]
  return <MonthTable rows={rows} labels={labels} withSum />
}

export function Opex({ r, labels }: { r: ModelResult; labels: string[] }) {
  const O = r.opex
  const fixedNames = r.opex[0].fixed.map((_, i) => r.opex[0].fixed[i])
  void fixedNames
  const fixedLabels = ['Маркетинг','Электроэнергия','Водоснабжение','Отопление','Транспорт','Прочие','Страхование','Бухгалтерия','Обслуживание модулей']
  const rows: any[] = [
    { label: 'ПОСТОЯННЫЕ', values: [], section: true },
    ...fixedLabels.map((n, i) => ({ label: n, values: O.map((m) => m.fixed[i]) })),
    { label: 'Итого постоянные', values: O.map((m) => m.fixedTotal), bold: true,
      tex: String.raw`base \times (1+infl)^{year}` },
    { label: 'ПЕРЕМЕННЫЕ (номенклатура)', values: [], section: true },
    ...O[0].variable.map((v) => ({
      label: v.article, values: O.map((m) => m.variable.find((x) => x.article === v.article)?.amount ?? 0),
      tex: String.raw`(slots \times \sum norm_{slot} + guests \times \sum norm_{guest} + \sum norm_{month}) \times infl`,
    })),
    { label: 'Итого переменные', values: O.map((m) => m.variableTotal), bold: true },
    { label: '% ОТ ВЫРУЧКИ', values: [], section: true },
    { label: 'Эквайринг', values: O.map((m) => m.pct.acquiring), tex: String.raw`2\% \times revenue` },
    { label: 'Ремонт/обслуживание', values: O.map((m) => m.pct.maintenance) },
    { label: 'ИТОГО OPEX', values: O.map((m) => m.total), bold: true },
  ]
  return <MonthTable rows={rows} labels={labels} withSum />
}

export function Fot({ r, labels }: { r: ModelResult; labels: string[] }) {
  const F = r.fot
  const rows = [
    { label: 'Оклады (фикс.)', values: F.map((m) => m.salaries), tex: String.raw`\sum(count \times salary) \times (1+infl)^{year}` },
    { label: 'KPI бонусы', values: F.map((m) => m.bonuses), tex: String.raw`30\%\,steam + 30\%\,massage + 1\%\,revenue` },
    { label: 'Итого ФОТ (gross)', values: F.map((m) => m.gross), bold: true },
    { label: 'Взносы 15.15%', values: F.map((m) => m.employerContrib) },
    { label: 'ИТОГО ФОТ + взносы', values: F.map((m) => m.total), bold: true },
  ]
  return <MonthTable rows={rows} labels={labels} withSum />
}

export function Capex({ r }: { r: ModelResult }) {
  const { capex } = r
  return (
    <div>
      <table className="month-table">
        <thead><tr><th className="sticky">Позиция</th><th>Сумма, €</th></tr></thead>
        <tbody>
          {capex.items.map((i) => (
            <tr key={i.name}><td className="sticky">{i.name}</td><td>{fmt(i.eur)}</td></tr>
          ))}
          <tr className="bold"><td className="sticky">ИТОГО CAPEX</td><td>{fmt(capex.totalEur)}</td></tr>
          <tr className="bold"><td className="sticky">С буфером сценария</td><td>{fmt(capex.adjustedEur)}</td></tr>
          <tr><td className="sticky">Амортизация, €/мес</td><td>{fmt(capex.monthlyAmort)}</td></tr>
        </tbody>
      </table>
      <p className="note">Амортизация линейная: Σ (CAPEX × доля группы) / (срок × 12 мес).</p>
    </div>
  )
}

export function Taxes({ r, labels }: { r: ModelResult; labels: string[] }) {
  const T = r.taxes
  const rows = [
    { label: 'НДС 19% (выходной)', values: T.map((m) => m.vatOut19) },
    { label: 'НДС 9% (глэмпинг+F&B)', values: T.map((m) => m.vatOut9), tex: String.raw`rev \times \frac{r}{1+r}` },
    { label: 'Входной НДС', values: T.map((m) => m.inputVat) },
    { label: 'НДС-кредит переходящий', values: T.map((m) => m.vatCredit) },
    { label: 'НДС к уплате', values: T.map((m) => m.vatPayable), bold: true,
      tex: String.raw`\max(0,\ out - in - credit_{prev})` },
    { label: 'CIT (июнь/декабрь)', values: T.map((m) => m.cit) },
    { label: 'Дивиденды (лаг 12 мес)', values: T.map((m) => m.dividends) },
    { label: 'Defence Tax (SDC)', values: T.map((m) => m.sdc) },
    { label: 'ИТОГО НАЛОГИ', values: T.map((m) => m.total), bold: true },
  ]
  return (
    <div>
      <MonthTable rows={rows} labels={labels} withSum />
      <p className="note">CIT по годам: {r.citByYear.map((c, i) => `год${i + 1}: ${fmtEur(c)}`).join(' · ')}</p>
    </div>
  )
}

export function Pnl({ r, labels }: { r: ModelResult; labels: string[] }) {
  const P = r.pnl
  const rows = [
    { label: 'Выручка (брутто)', values: P.map((m) => m.revenueGross) },
    { label: 'НДС к уплате', values: P.map((m) => -m.revenueGross + m.revenueNet) },
    { label: 'Выручка (нетто)', values: P.map((m) => m.revenueNet), bold: true },
    { label: 'Переменные расходы', values: P.map((m) => m.variableOpex) },
    { label: '% от выручки', values: P.map((m) => m.pctOpex) },
    { label: 'Маржинальная прибыль', values: P.map((m) => m.marginalProfit), bold: true },
    { label: 'Постоянные расходы', values: P.map((m) => m.fixedOpex) },
    { label: 'ФОТ + взносы', values: P.map((m) => m.fot) },
    { label: 'EBITDA', values: P.map((m) => m.ebitda), bold: true },
    { label: 'Маржа EBITDA', values: P.map((m) => m.revenueNet ? m.ebitda / m.revenueNet : 0), fmt: 'pct' as const },
    { label: 'Амортизация', values: P.map((m) => m.amortization) },
    { label: 'EBIT', values: P.map((m) => m.ebit), bold: true },
    { label: 'CIT', values: P.map((m) => m.cit) },
    { label: 'Чистая прибыль', values: P.map((m) => m.netProfit), bold: true },
    { label: 'Дивиденды', values: P.map((m) => m.dividends) },
    { label: 'SDC', values: P.map((m) => m.sdc) },
    { label: 'ЧП после SDC', values: P.map((m) => m.netAfterSdc), bold: true },
  ]
  return <MonthTable rows={rows} labels={labels} withSum />
}

export function CashFlow({ r }: { r: ModelResult }) {
  const labels = r.cashflow.map((m) => m.label)
  const C = r.cashflow
  const rows = [
    { label: 'Чистая прибыль', values: C.map((m) => m.netProfit) },
    { label: '+ Амортизация', values: C.map((m) => m.amortization) },
    { label: 'Операционный CF', values: C.map((m) => m.operatingCf), bold: true },
    { label: 'CAPEX', values: C.map((m) => m.capex) },
    { label: 'Пре-сейл', values: C.map((m) => m.presale) },
    { label: 'FCFF', values: C.map((m) => m.fcff), bold: true },
    { label: 'Дивиденды и УК', values: C.map((m) => m.dividends) },
    { label: 'Defence Tax', values: C.map((m) => m.sdc) },
    { label: 'CF после распределения', values: C.map((m) => m.totalCf), bold: true },
    { label: 'Остаток денег', values: C.map((m) => m.cumCash) },
    { label: 'Накопл. FCFF', values: C.map((m) => m.cumFcff) },
    { label: 'Дисконт. FCFF', values: C.map((m) => m.discountedFcff) },
    { label: 'Накопл. DCF (NPV)', values: C.map((m) => m.cumDcf), bold: true },
  ]
  return <MonthTable rows={rows} labels={labels} withSum />
}

export { monthLabels }
