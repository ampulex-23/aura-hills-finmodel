import { useMemo } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { ModelResult } from '../model/types'
import { fmt, fmtEur, fmtPct, Hint } from '../components/ui'
import type { CellHint } from '../components/ui'

const COLORS = ['#5b8dd9', '#9c6ade', '#4cc38a', '#f5a623', '#e5534b', '#50c8d8', '#d8b356']
const tooltipStyle = {
  contentStyle: { background: '#1b2432', border: '1px solid #32415c', borderRadius: 8, fontSize: 12.5 },
  labelStyle: { color: '#aab6c8', fontWeight: 600 },
  itemStyle: { color: '#e8ecf1', padding: 0 },
} as const

export function Dashboard({ r }: { r: ModelResult }) {
  const revenueByStream = useMemo(
    () =>
      r.revenue.map((m, i) => ({
        m: r.cashflow[12 + i]?.label ?? `M${i + 1}`,
        Аренда: Math.round(m.rental),
        Парения: Math.round(m.steamTotal),
        Массаж: Math.round(m.massageTotal),
        'Доп.услуги': Math.round(m.extraTotal),
        Глэмпинг: Math.round(m.glamping),
        Членства: Math.round(m.membershipTotal),
        'F&B': Math.round(m.fb),
      })),
    [r],
  )
  const cfSeries = useMemo(
    () =>
      r.cashflow.map((m) => ({
        m: m.label,
        FCFF: Math.round(m.fcff),
        'Накопл. CF': Math.round(m.cumCash),
        'Накопл. FCFF': Math.round(m.cumFcff),
      })),
    [r],
  )
  const k = r.kpis
  const last = r.cashflow[r.cashflow.length - 1]
  const kpis: { label: string; value: string; hint: CellHint }[] = [
    {
      label: 'NPV (5 лет)', value: fmtEur(k.npv),
      hint: {
        title: 'Чистая приведённая стоимость',
        text: 'Сумма всех дисконтированных свободных потоков (FCFF) за 72 месяца: стройка + 5 лет операций.',
        tex: String.raw`\mathrm{NPV}=\sum_{m}\frac{\mathrm{FCFF}_m}{(1+\mathrm{WACC}/12)^{m}}`,
        calc: `Σ дисконт. FCFF = ${fmtEur(last.cumDcf)}`,
      },
    },
    {
      label: 'IRR годовой', value: fmtPct(k.irrAnnual),
      hint: {
        title: 'Внутренняя норма доходности',
        text: 'Ставка, при которой NPV = 0. Считается по помесячным FCFF, переведена в годовую.',
        calc: `IRR мес ${fmtPct(k.irrMonthly, 2)} → годовая ${fmtPct(k.irrAnnual)}`,
      },
    },
    {
      label: 'Окупаемость', value: `${k.paybackMonths} мес`,
      hint: {
        title: 'Окупаемость',
        text: 'Первый месяц (от начала стройки), когда накопленный FCFF стал положительным.',
      },
    },
    {
      label: 'Диск. окупаемость', value: `${k.discountedPaybackMonths} мес`,
      hint: {
        title: 'Дисконтированная окупаемость',
        text: 'То же, но по накопленному DCF (FCFF × дисконт-фактор WACC).',
      },
    },
    {
      label: 'MOIC', value: `×${k.moic.toFixed(2)}`,
      hint: {
        title: 'Мультипликатор вложенного капитала',
        text: 'Сколько евро вернул проект на каждый вложенный: Σ положительных FCFF ÷ Σ вложений (стройка + убытки разгона). Без дисконтирования.',
        calc: `Σ притоков ${fmtEur(r.cashflow.reduce((s, m) => s + Math.max(0, m.fcff), 0))} ÷ Σ вложений ${fmtEur(k.investedTotal)} = ×${k.moic.toFixed(2)}`,
      },
    },
    {
      label: 'Cash-on-cash (г.3)', value: fmtPct(k.cashOnCash),
      hint: {
        title: 'Денежная доходность',
        text: 'Годовой FCFF устаканенного 3-го года эксплуатации к сумме вложенного капитала — сколько «живых» процентов годовых генерирует проект.',
        calc: `FCFF г.3 ${fmtEur(r.cashflow.slice(r.cashflow.findIndex(m=>m.isOps)+24, r.cashflow.findIndex(m=>m.isOps)+36).reduce((s,m)=>s+m.fcff,0))} ÷ вложено ${fmtEur(k.investedTotal)} = ${fmtPct(k.cashOnCash)}`,
      },
    },
    {
      label: 'Пиковая потребность', value: fmtEur(k.peakFundingNeed),
      hint: {
        title: 'Пиковая потребность в финансировании',
        text: 'Максимальный отрицательный накопленный CF — сколько денег нужно в проект в самой глубокой точке.',
      },
    },
    {
      label: 'CAPEX (с буфером)', value: fmtEur(r.capex.adjustedEur),
      hint: {
        title: 'Инвестиции',
        text: 'Смета строительства + сценарный буфер на удорожание.',
        calc: `${fmtEur(r.capex.totalEur)} × ${1 + r.scenario.capexAdj} = ${fmtEur(r.capex.adjustedEur)}`,
      },
    },
  ]
  return (
    <div>
      <section className="kpis">
        {kpis.map((kpi) => (
          <Hint key={kpi.label} hint={kpi.hint}>
            <div className="kpi"><span>{kpi.label}</span><b>{kpi.value}</b></div>
          </Hint>
        ))}
      </section>

      <div className="chart-card">
        <h3>Выручка по потокам, €/мес</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={revenueByStream}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3548" />
            <XAxis dataKey="m" interval={5} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmt(v)} {...tooltipStyle} />
            <Legend />
            {['Аренда', 'Парения', 'Массаж', 'Доп.услуги', 'Глэмпинг', 'Членства', 'F&B'].map(
              (s, i) => (
                <Area key={s} dataKey={s} stackId="1" fill={COLORS[i]} stroke={COLORS[i]} fillOpacity={0.7} />
              ),
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>Денежный поток и окупаемость</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={cfSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3548" />
            <XAxis dataKey="m" interval={5} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
            <Tooltip formatter={(v: number) => fmt(v)} {...tooltipStyle} />
            <Legend />
            <Line dataKey="FCFF" stroke="#5b8dd9" dot={false} />
            <Line dataKey="Накопл. FCFF" stroke="#4cc38a" dot={false} strokeWidth={2} />
            <Line dataKey="Накопл. CF" stroke="#f5a623" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>EBITDA и чистая прибыль, €/мес</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={r.pnl.map((p, i) => ({
            m: r.cashflow[12 + i]?.label, EBITDA: Math.round(p.ebitda), 'Чистая прибыль': Math.round(p.netProfit),
          }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3548" />
            <XAxis dataKey="m" interval={5} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmt(v)} {...tooltipStyle} />
            <Legend />
            <Bar dataKey="EBITDA" fill="#5b8dd9" />
            <Bar dataKey="Чистая прибыль" fill="#4cc38a" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
