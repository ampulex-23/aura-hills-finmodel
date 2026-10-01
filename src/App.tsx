import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Group, Select, Tabs, Text, Title } from '@mantine/core'
import { useModel } from './store'
import { runModel } from './model/run'
import { exportWorkbook } from './export/excel'
import { monthLabels } from './components/ui'
import { Dashboard } from './tabs/Dashboard'
import { Assumptions } from './tabs/Assumptions'
import { Scenarios } from './tabs/Scenarios'
import { CashFlow, Capex, Fot, Opex, Pnl, Revenue, Taxes } from './tabs/Reports'
import { Nomenclature } from './tabs/Nomenclature'
import { Specs } from './tabs/Specs'
import { It } from './tabs/It'
import { Sensitivity } from './tabs/Sensitivity'

// Вкладки-ввод сгруппированы слева, отчётные — справа.
const INPUT_TABS = ['Допущения', 'Сценарии', 'Номенклатура', 'Спецификации', 'IT'] as const
const REPORT_TABS = [
  'Дашборд', 'Выручка', 'OPEX', 'ФОТ', 'CAPEX', 'Налоги', 'P&L', 'Cash-Flow', 'Sensitivity',
] as const
const TABS = [...INPUT_TABS, ...REPORT_TABS] as const
type Tab = (typeof TABS)[number]

// Hash-роутинг: #/dashboard … #/sensitivity — вкладка переживает F5, ссылки шарятся.
const TAB_SLUGS: Record<Tab, string> = {
  'Дашборд': 'dashboard', 'Допущения': 'assumptions', 'Сценарии': 'scenarios',
  'Номенклатура': 'nomenclature', 'Спецификации': 'specs', 'IT': 'it',
  'Выручка': 'revenue', 'OPEX': 'opex', 'ФОТ': 'fot', 'CAPEX': 'capex',
  'Налоги': 'taxes', 'P&L': 'pnl', 'Cash-Flow': 'cashflow', 'Sensitivity': 'sensitivity',
}
const SLUG_TABS = new Map(Object.entries(TAB_SLUGS).map(([t, s]) => [s, t as Tab]))
const tabFromHash = (): Tab | null => SLUG_TABS.get(location.hash.replace(/^#\//, '')) ?? null

export default function App() {
  const { params, matrix, items, scenario, setScenario, resetAll, exportJson, importJson } = useModel()
  const [tab, setTabState] = useState<Tab>(() => tabFromHash() ?? 'Дашборд')
  const fileRef = useRef<HTMLInputElement>(null)

  const setTab = (t: Tab) => {
    setTabState(t)
    const hash = `#/${TAB_SLUGS[t]}`
    if (location.hash !== hash) location.hash = hash
  }
  useEffect(() => {
    const onHash = () => { const t = tabFromHash(); if (t) setTabState(t) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

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

  const exportExcel = async () => {
    const blob = await exportWorkbook(params, matrix, items)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'aura-hills-model.xlsx'
    a.click()
  }

  return (
    <div className="app">
      <header>
        <Title order={3}>AURA HILLS — финансовая модель</Title>
        <Group gap="xs" wrap="wrap" align="center">
          <Text size="xs" c="dimmed">Сценарий</Text>
          <Select
            size="xs" w={160}
            data={[...matrix.names]}
            value={scenario}
            onChange={(v) => v && setScenario(v)}
            allowDeselect={false}
          />
          <Button size="xs" variant="default" onClick={download}>Сохранить JSON</Button>
          <Button size="xs" onClick={exportExcel}>Экспорт Excel</Button>
          <Button size="xs" variant="default" onClick={() => fileRef.current?.click()}>Загрузить JSON</Button>
          <input
            ref={fileRef} type="file" accept=".json" hidden
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <Button
            size="xs" variant="subtle" color="gray"
            onClick={() => confirm('Сбросить все параметры к значениям по умолчанию?') && resetAll()}
          >
            Сбросить
          </Button>
        </Group>
      </header>

      <Tabs
        value={tab}
        onChange={(v) => v && setTab(v as Tab)}
        variant="outline"
        className="tabs"
      >
        <Tabs.List className="tabs-list" style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
          <span className="tab-group-label">Параметры</span>
          {INPUT_TABS.map((t) => (
            <Tabs.Tab key={t} value={t} leftSection={<span className="dot-input" />}>
              {t}
            </Tabs.Tab>
          ))}
          <span className="tab-group-label">Отчёты</span>
          {REPORT_TABS.map((t) => (
            <Tabs.Tab key={t} value={t}>{t}</Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

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
        {tab === 'Спецификации' && <Specs />}
        {tab === 'IT' && <It />}
        {tab === 'Sensitivity' && <Sensitivity />}
      </main>
    </div>
  )
}
