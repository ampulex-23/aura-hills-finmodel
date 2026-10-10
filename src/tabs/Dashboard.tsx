import { useMemo } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { ModelResult } from '../model/types'
import { useModel } from '../store'
import { computeBreakEven } from '../model/sensitivity'
import { fmt, fmtEur, fmtPct, Hint } from '../components/ui'
import type { CellHint } from '../components/ui'

const COLORS = ['#5b8dd9', '#9c6ade', '#4cc38a', '#f5a623', '#e5534b', '#50c8d8', '#d8b356', '#e07aa8', '#8fbf7f']
const tooltipStyle = {
  contentStyle: { background: '#1b2432', border: '1px solid #32415c', borderRadius: 8, fontSize: 12.5 },
  labelStyle: { color: '#aab6c8', fontWeight: 600 },
  itemStyle: { color: '#e8ecf1', padding: 0 },
} as const

export function Dashboard({ r }: { r: ModelResult }) {
  const { params, matrix, items, services } = useModel()
  const be = useMemo(
    () => computeBreakEven(params, matrix, items, services),
    [params, matrix, items, services],
  )
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
        'Общ. баня': Math.round(m.publicBath),
        Ресторан: Math.round(m.restaurant),
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
      label: `NPV (${Math.round(params.meta.opsMonths / 12)} лет)`, value: fmtEur(k.npv),
      hint: {
        title: 'Чистая приведённая стоимость',
        text: `Сумма дисконтированных FCFF за стройку (${params.meta.capexMonths} мес) + ${params.meta.opsMonths} мес операций, включая стройку и работу очереди 2. Ставка ${fmtPct(k.wacc)} годовых (${params.general.waccMode === 'capm' ? 'CAPM' : 'ручная'}), помесячно по эффективной ставке (1+WACC)^(1/12)−1. Без терминальной стоимости.`,
        tex: String.raw`\mathrm{NPV}=\sum_{m}\frac{\mathrm{FCFF}_m}{(1+\mathrm{WACC})^{m/12}}`,
        calc: `Σ дисконт. FCFF = ${fmtEur(last.cumDcf)}`,
      },
    },
    {
      label: 'IRR годовой', value: fmtPct(k.irrAnnual),
      hint: {
        title: 'Внутренняя норма доходности',
        text: 'Ставка, при которой NPV = 0. Считается по помесячным FCFF и переведена в годовую эффективную — напрямую сопоставима с WACC.',
        calc: `IRR мес ${fmtPct(k.irrMonthly, 2)} → (1+r)^12−1 = ${fmtPct(k.irrAnnual)} vs WACC ${fmtPct(k.wacc)}`,
      },
    },
    {
      label: 'Окупаемость', value: `${k.paybackMonths} мес`,
      hint: {
        title: 'Окупаемость',
        text: 'Первый месяц (от начала стройки, месяц 1 = январь 2027), когда накопленный FCFF стал положительным. Стройка очереди 2 в 2029–2030 может отодвинуть эту точку — это честный эффект реинвестирования.',
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
        text: 'Сколько евро вернул проект на каждый вложенный: Σ положительных FCFF ÷ Σ отрицательных месяцев FCFF (стройка оч. 1, убытки разгона, месяцы стройки оч. 2 с отрицательным потоком). Без дисконтирования.',
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
        text: 'Максимальный отрицательный накопленный FCFF — сколько денег нужно в проект в самой глубокой точке.',
      },
    },
    {
      label: 'Equity-транши', value: fmtEur(k.equityTotal),
      hint: {
        title: 'Взносы акционеров',
        text: `Σ взносов акционеров, закрывающих кассовые разрывы по месяцам (касса ≥ 0): стройка оч. 1, месяцы после начала дивидендов${params.phase2?.funding === 'equity' ? ', плюс выделенный транш под стройку оч. 2 (режим «Отдельный транш»)' : '; стройка оч. 2 в режиме «Из операционного CF» финансируется кэшем бизнеса'}. Разложение по месяцам — в Отчётах → Cash-Flow.`,
      },
    },
    {
      label: 'Break-even загрузка',
      value: Number.isFinite(be.loadMult) ? `~${(be.loadMult * 100).toFixed(0)}% плана` : '—',
      hint: {
        title: 'Точка безубыточности',
        text: 'Доля планового спроса (все загрузки и членства × один коэффициент), при которой среднемесячная EBITDA 3-го года = 0. Бинарный поиск, реальный пересчёт модели.',
        calc: Number.isFinite(be.loadMult)
          ? `EBITDA мес г.3: план ${fmtEur(be.ebitdaBase)}/мес → 0 при ×${be.loadMult.toFixed(3)}`
          : 'EBITDA года 3 уже отрицательна либо покрывается даже при нулевом спросе',
      },
    },
    ...(params.tv?.enabled
      ? [{
          label: 'NPV с TV', value: fmtEur(k.npvWithTv),
          hint: {
            title: 'NPV + терминальная стоимость',
            text: 'Gordon growth: TV = FCFF последнего операционного года (за вычетом maintenance CAPEX) × (1+g) / (WACC − g), дисконтированная на конец горизонта. Cross-check — exit-multiple по EBITDA. Показывается отдельно — база консервативна без TV.',
            tex: String.raw`\mathrm{TV}=\frac{\mathrm{FCFF}_{посл}\cdot(1+g)}{\mathrm{WACC}-g},\quad g=${(params.tv.growth * 100).toFixed(1)}\%`,
            calc: `TV диск. = ${fmtEur(k.tvValue)} (EV/EBITDA ${Number.isFinite(k.tvEvEbitda) ? k.tvEvEbitda.toFixed(1) : '—'}×) · exit ${params.tv.exitMultiple}× EBITDA = ${fmtEur(k.tvExitValue)} → NPV + TV = ${fmtEur(k.npvWithTv)}`,
          },
        }]
      : []),
    {
      label: 'CAPEX оч. 1 (с буфером)', value: fmtEur(r.capex.adjustedEur),
      hint: {
        title: 'Инвестиции очереди 1',
        text: 'Смета стройки оч. 1 + наполнение + закуп + IT + земля, умноженные на сценарный буфер. Платится в 12 месяцев стройки по S-кривой.',
        calc: `${fmtEur(r.capex.totalEur)} × ${1 + r.scenario.capexAdj} = ${fmtEur(r.capex.adjustedEur)}`,
      },
    },
    ...(r.capex.phase2Eur > 0
      ? [{
          label: 'CAPEX оч. 2 (с буфером)', value: fmtEur(r.capex.phase2AdjEur),
          hint: {
            title: 'Инвестиции очереди 2',
            text: `Строки сметы включённых объектов оч. 2 (общественная баня, VIP) + общие работы + закуп оч. 2, умноженные на свой буфер ${fmtPct(params.phase2?.capexAdj ?? 0)}. Платится помесячно в окне стройки ${params.phase2?.constructionStart ?? ''} + ${params.phase2?.months ?? 0} мес из операционного потока${params.phase2?.funding === 'equity' ? ' отдельным траншем акционеров' : ''}.`,
            calc: `${fmtEur(r.capex.phase2Eur)} × ${1 + (params.phase2?.capexAdj ?? 0)} = ${fmtEur(r.capex.phase2AdjEur)}`,
          },
        }]
      : []),
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
            {['Аренда', 'Парения', 'Массаж', 'Доп.услуги', 'Глэмпинг', 'Членства', 'F&B', 'Общ. баня', 'Ресторан'].map(
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
