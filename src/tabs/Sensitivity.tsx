import { useMemo } from 'react'
import { useModel } from '../store'
import { computeSensitivity, T1_WACC, T2_CAPEX } from '../model/sensitivity'
import { fmt } from '../components/ui'

// Три таблицы чувствительности — реальный пересчёт (57 точек, ~0.3с).
export function Sensitivity() {
  const { params, matrix, items, scenario } = useModel()
  const s = useMemo(
    () => computeSensitivity(params, matrix, items),
    [params, matrix, items],
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
        Пересчёт модели по 57 точкам · сценарий «{scenario}» · {s.computedInMs.toFixed(0)} мс
      </p>

      <h3>Спрос × WACC → NPV (диск. окупаемость, мес)</h3>
      <table className="month-table sens">
        <thead>
          <tr><th className="sticky">Спрос \ WACC</th>{T1_WACC.map((w) => <th key={w}>{(w * 100).toFixed(0)}%</th>)}</tr>
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

      <h3>Рост цен × буфер CAPEX → NPV (IRR)</h3>
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

      <h3>Уровень всех цен → NPV (IRR)</h3>
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
  )
}
