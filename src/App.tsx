import { useMemo, useRef, useState } from 'react'
import { useModel } from './store'
import { runModel } from './model/run'
import { exportWorkbook } from './export/excel'
import { monthLabels } from './components/ui'
import { Dashboard } from './tabs/Dashboard'
import { Assumptions } from './tabs/Assumptions'
import { Scenarios } from './tabs/Scenarios'
import { CashFlow, Capex, Fot, Opex, Pnl, Revenue, Taxes } from './tabs/Reports'
import { Nomenclature } from './tabs/Nomenclature'
import { Sensitivity } from './tabs/Sensitivity'

const TABS = [
  'Дашборд', 'Допущения', 'Сценарии', 'Выручка', 'OPEX', 'ФОТ',
  'CAPEX', 'Налоги', 'P&L', 'Cash-Flow', 'Номенклатура', 'Sensitivity',
] as const

export default function App() {
  const { params, matrix, items, scenario, setScenario, resetAll, exportJson, importJson } = useModel()
  const [tab, setTab] = useState<(typeof TABS)[number]>('Дашборд')
  const fileRef = useRef<HTMLInputElement>(null)

  const result = useMemo(
    () => runModel(params, matrix, items, scenario),
    [params, matrix, items, scenario],
  )
  const opsLabels = useMemo(
    () => monthLabels(params.meta.openingDate, params.meta.opsMonths),
    [params.meta.openingDate, params.meta.opsMonths],
  )

  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'aura-hills-model.json'
    a.click()
  }
  const upload = (f: File) => f.text().then(importJson)

  return (
    <div className="app">
      <header>
        <h1>AURA HILLS — финансовая модель</h1>
        <div className="controls">
          <label>
            Сценарий{' '}
            <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
              {matrix.names.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <button onClick={download}>Сохранить JSON</button>
          <button
            onClick={async () => {
              const blob = await exportWorkbook(params, matrix, items)
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = 'aura-hills-model.xlsx'
              a.click()
            }}
          >
            Экспорт Excel
          </button>
          <button onClick={() => fileRef.current?.click()}>Загрузить JSON</button>
          <input
            ref={fileRef} type="file" accept=".json" hidden
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <button className="ghost" onClick={() => confirm('Сбросить все параметры к значениям по умолчанию?') && resetAll()}>
            Сбросить
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'Дашборд' && <Dashboard r={result} />}
        {tab === 'Допущения' && <Assumptions />}
        {tab === 'Сценарии' && <Scenarios />}
        {tab === 'Выручка' && <Revenue r={result} labels={opsLabels} />}
        {tab === 'OPEX' && <Opex r={result} labels={opsLabels} />}
        {tab === 'ФОТ' && <Fot r={result} labels={opsLabels} />}
        {tab === 'CAPEX' && <Capex r={result} />}
        {tab === 'Налоги' && <Taxes r={result} labels={opsLabels} />}
        {tab === 'P&L' && <Pnl r={result} labels={opsLabels} />}
        {tab === 'Cash-Flow' && <CashFlow r={result} />}
        {tab === 'Номенклатура' && <Nomenclature />}
        {tab === 'Sensitivity' && <Sensitivity />}
      </main>
    </div>
  )
}
