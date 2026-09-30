import { useMemo } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { ModelResult } from '../model/types'
import { fmt, fmtEur, fmtPct } from '../components/ui'

const COLORS = ['#5b8dd9', '#9c6ade', '#4cc38a', '#f5a623', '#e5534b', '#50c8d8', '#d8b356']

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
  return (
    <div>
      <section className="kpis">
        <div className="kpi"><span>NPV (5 лет)</span><b>{fmtEur(k.npv)}</b></div>
        <div className="kpi"><span>IRR годовой</span><b>{fmtPct(k.irrAnnual)}</b></div>
        <div className="kpi"><span>Окупаемость</span><b>{k.paybackMonths} мес</b></div>
        <div className="kpi"><span>Диск. окупаемость</span><b>{k.discountedPaybackMonths} мес</b></div>
        <div className="kpi"><span>Пиковая потребность</span><b>{fmtEur(k.peakFundingNeed)}</b></div>
        <div className="kpi"><span>CAPEX (с буфером)</span><b>{fmtEur(r.capex.adjustedEur)}</b></div>
      </section>

      <div className="chart-card">
        <h3>Выручка по потокам, €/мес</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={revenueByStream}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3548" />
            <XAxis dataKey="m" interval={5} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmt(v)} />
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
            <Tooltip formatter={(v: number) => fmt(v)} />
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
            <Tooltip formatter={(v: number) => fmt(v)} />
            <Legend />
            <Bar dataKey="EBITDA" fill="#5b8dd9" />
            <Bar dataKey="Чистая прибыль" fill="#4cc38a" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
