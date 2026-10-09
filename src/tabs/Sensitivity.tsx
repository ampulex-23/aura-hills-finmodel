import { useMemo } from 'react'
import { useModel } from '../store'
import type { ModelResult } from '../model/types'
import { computeSensitivity, computeTornado, T2_CAPEX } from '../model/sensitivity'
import { fmt } from '../components/ui'

// Пять таблиц чувствительности — реальный пересчёт (~100 точек).
export function Sensitivity({ r }: { r: ModelResult }) {
  const { params, matrix, items, services, scenario } = useModel()
  const s = useMemo(
    () => computeSensitivity(params, matrix, items, services),
    [params, matrix, items, services],
  )
  const baseNpv = r.kpis.npv
  const tornado = useMemo(
    () => computeTornado(params, matrix, items, services, baseNpv),
    [params, matrix, items, services, baseNpv],
  )
  const torMax = Math.max(
    ...tornado.flatMap((d) => [Math.abs(d.npvHi - baseNpv), Math.abs(d.npvLo - baseNpv)]),
    1,
  )
  const heat = (v: number, min: number, max: number) => {
    const t = max === min ? 0.5 : (v - min) / (max - min)
    return { background: `rgba(76,195,138,${0.05 + t * 0.35})` }
  }
  const allNpv = s.t1.rows.flatMap((r) => r.cells.map((c) => c.npv))
  const lo = Math.min(...allNpv)
  const hi = Math.max(...allNpv)

  return (
    <div>
      <p className="note">
        Пересчёт модели по {25 + 25 + 5 + 25 + 20} точкам · сценарий «{scenario}» · {s.computedInMs.toFixed(0)} мс
      </p>

      <div className="chart-card">
        <h3>Tornado — топ-драйверы NPV (реальный пересчёт)</h3>
        <div className="tornado">
          {tornado.map((d) => {
            const loW = (Math.abs(d.npvLo - baseNpv) / torMax) * 50
            const hiW = (Math.abs(d.npvHi - baseNpv) / torMax) * 50
            return (
              <div className="tor-row" key={d.label}>
                <span className="tor-label">{d.label}</span>
                <div className="tor-track">
                  <div className="tor-axis" />
                  <div
                    className="tor-bar neg"
                    style={{ right: '50%', width: `${loW}%` }}
                    title={`${d.loLabel}: NPV ${fmt(d.npvLo / 1e6, 2)}M`}
                  />
                  <div
                    className="tor-bar pos"
                    style={{ left: '50%', width: `${hiW}%` }}
                    title={`${d.hiLabel}: NPV ${fmt(d.npvHi / 1e6, 2)}M`}
                  />
                </div>
                <span className="tor-vals">
                  <small className="neg">{d.loLabel} {fmt((d.npvLo - baseNpv) / 1e3, 0)}k</small>
                  {' · '}
                  <small className="pos">{d.hiLabel} +{fmt((d.npvHi - baseNpv) / 1e3, 0)}k</small>
                </span>
              </div>
            )
          })}
        </div>
        <small className="note">
          Однофакторный анализ: каждый драйвер двигается отдельно, остальные — на базе.
          Ось — базовый NPV {fmt(baseNpv / 1e6, 2)}M; в скобках — изменение NPV, €k.
        </small>
      </div>

      <div className="cols-2">
        <div>
          <h3>Спрос × WACC → NPV (диск. окупаемость, мес)</h3>
          <div className="table-wrap">
            <table className="month-table sens">
              <thead>
                <tr><th className="sticky">Спрос \ WACC</th>{s.t1.waccAxis.map((w) => <th key={w}>{(w * 100).toFixed(1)}%</th>)}</tr>
              </thead>
              <tbody>
                {s.t1.rows.map((row) => (
                  <tr key={row.demand}>
                    <td className="sticky">×{row.demand}</td>
                    {row.cells.map((c) => (
                      <td key={c.wacc} style={heat(c.npv, lo, hi)}>
                        {fmt(c.npv / 1e6, 2)}M <small>({c.discPayback})</small>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3>Рост цен × буфер CAPEX → NPV (IRR)</h3>
          <div className="table-wrap">
            <table className="month-table sens">
              <thead>
                <tr><th className="sticky">Рост цен \ CAPEX</th>{T2_CAPEX.map((c) => <th key={c}>+{(c * 100).toFixed(0)}%</th>)}</tr>
              </thead>
              <tbody>
                {s.t2.rows.map((row) => (
                  <tr key={row.priceGrowth}>
                    <td className="sticky">{(row.priceGrowth * 100).toFixed(0)}%</td>
                    {row.cells.map((c) => (
                      <td key={c.capexAdj}>
                        {fmt(c.npv / 1e6, 2)}M <small>({fmt(c.irr * 100)}%)</small>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="cols-2">
        <div>
          <h3>Доля гостей с пакетом × загрузка → NPV (IRR)</h3>
          <div className="table-wrap">
            <table className="month-table sens">
              <thead>
                <tr><th className="sticky">Пакет \ Загрузка</th>{s.t4.loadAxis.map((l) => <th key={l}>×{l}</th>)}</tr>
              </thead>
              <tbody>
                {s.t4.rows.map((row) => (
                  <tr key={row.uptake}>
                    <td className="sticky">{(row.uptake * 100).toFixed(0)}%</td>
                    {row.cells.map((c) => (
                      <td key={c.loadMult}>
                        {fmt(c.npv / 1e6, 2)}M <small>({fmt(c.irr * 100)}%)</small>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small className="note">
            Ключевой коммерческий риск: Base предполагает обязательный пакет €{params.deposit.base}/гость (100%).
            Строка 100% ≡ пакетный режим; ниже — если пакет станет опцией и его купит лишь часть гостей.
          </small>
        </div>

        <div>
          <h3>Курс RUB/EUR × буфер CAPEX → NPV (IRR)</h3>
          <div className="table-wrap">
            <table className="month-table sens">
              <thead>
                <tr><th className="sticky">Курс \ CAPEX</th>{s.t5.capexAxis.map((c) => <th key={c}>+{(c * 100).toFixed(0)}%</th>)}</tr>
              </thead>
              <tbody>
                {s.t5.rows.map((row) => (
                  <tr key={row.rubEur}>
                    <td className="sticky">{row.rubEur} ₽/€</td>
                    {row.cells.map((c) => (
                      <td key={c.capexAdj}>
                        {fmt(c.npv / 1e6, 2)}M <small>({fmt(c.irr * 100)}%)</small>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small className="note">
            Смета модулей и СМР хранится в рублях (курс {params.general.rubEurRate} ₽/€ в Допущениях) — валютный риск контрактов с РФ-подрядчиками.
          </small>
        </div>
      </div>

      <h3>Уровень всех цен → NPV (IRR)</h3>
      <div className="table-wrap" style={{ display: 'inline-block' }}>
      <table className="month-table sens">
        <thead><tr><th className="sticky">Цены</th>{s.t3.map((r) => <th key={r.priceMult}>×{r.priceMult}</th>)}</tr></thead>
        <tbody>
          <tr>
            <td className="sticky">NPV</td>
            {s.t3.map((r) => <td key={r.priceMult}>{fmt(r.npv / 1e6, 2)}M</td>)}
          </tr>
          <tr>
            <td className="sticky">IRR</td>
            {s.t3.map((r) => <td key={r.priceMult}>{fmt(r.irr * 100)}%</td>)}
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  )
}
