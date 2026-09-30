import { useMemo, useState } from 'react'
import paramsJson from './data/params.json'
import scenariosJson from './data/scenarios.json'
import nomenclatureJson from './data/nomenclature.json'
import type { NomenclatureItem, Params, ScenarioMatrix } from './model/types'
import { runModel } from './model/run'

const params = paramsJson as Params
const matrix = scenariosJson as ScenarioMatrix
const items = nomenclatureJson as NomenclatureItem[]

const fmt = (v: number) =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })

export default function App() {
  const [scenario, setScenario] = useState(params.meta.scenario)
  const result = useMemo(
    () => runModel(params, matrix, items, scenario),
    [scenario],
  )
  const { kpis } = result

  return (
    <div className="app">
      <header>
        <h1>AURA HILLS — финансовая модель</h1>
        <div className="controls">
          <label>
            Сценарий{' '}
            <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
              {matrix.names.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <section className="kpis">
        <div className="kpi"><span>NPV (5 лет)</span><b>€{fmt(kpis.npv)}</b></div>
        <div className="kpi"><span>IRR годовой</span><b>{(kpis.irrAnnual * 100).toFixed(0)}%</b></div>
        <div className="kpi"><span>Окупаемость</span><b>{kpis.paybackMonths} мес</b></div>
        <div className="kpi"><span>Диск. окупаемость</span><b>{kpis.discountedPaybackMonths} мес</b></div>
        <div className="kpi"><span>Пиковая потребность</span><b>€{fmt(kpis.peakFundingNeed)}</b></div>
      </section>
      <p className="note">Ядро TS · {params.meta.opsMonths} операционных месяцев · сценарий «{scenario}»</p>
    </div>
  )
}
