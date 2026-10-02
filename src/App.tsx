import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Group, Select, Text, Tooltip } from '@mantine/core'
import { useHotkeys, useMediaQuery } from '@mantine/hooks'
import {
  IconAdjustmentsHorizontal, IconArrowsExchange, IconChartLine,
  IconChevronLeft, IconChevronRight, IconClipboardList, IconCoins, IconCpu,
  IconFlask2, IconLayoutDashboard, IconListDetails, IconMenu2,
  IconPercentage, IconReceipt2, IconReportMoney, IconUserCog, IconUsers, IconVersions,
} from '@tabler/icons-react'
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
import { Staff } from './tabs/Staff'
import { Sensitivity } from './tabs/Sensitivity'

type Tab =
  | 'Дашборд' | 'Допущения' | 'Сценарии' | 'Штат' | 'Номенклатура' | 'Спецификации' | 'IT'
  | 'Выручка' | 'OPEX' | 'ФОТ' | 'CAPEX' | 'Налоги' | 'P&L' | 'Cash-Flow' | 'Sensitivity'

// Hash-роутинг: #/dashboard … #/sensitivity — вкладка переживает F5, ссылки шарятся.
const TAB_SLUGS: Record<Tab, string> = {
  'Дашборд': 'dashboard', 'Допущения': 'assumptions', 'Сценарии': 'scenarios',
  'Штат': 'staff',
  'Номенклатура': 'nomenclature', 'Спецификации': 'specs', 'IT': 'it',
  'Выручка': 'revenue', 'OPEX': 'opex', 'ФОТ': 'fot', 'CAPEX': 'capex',
  'Налоги': 'taxes', 'P&L': 'pnl', 'Cash-Flow': 'cashflow', 'Sensitivity': 'sensitivity',
}
const SLUG_TABS = new Map(Object.entries(TAB_SLUGS).map(([t, s]) => [s, t as Tab]))
const tabFromHash = (): Tab | null => SLUG_TABS.get(location.hash.replace(/^#\//, '')) ?? null

const NAV: { group: string; items: { tab: Tab; icon: typeof IconCpu }[] }[] = [
  {
    group: 'Отчёты',
    items: [
      { tab: 'Дашборд', icon: IconLayoutDashboard },
      { tab: 'Выручка', icon: IconChartLine },
      { tab: 'OPEX', icon: IconReceipt2 },
      { tab: 'ФОТ', icon: IconUsers },
      { tab: 'CAPEX', icon: IconCoins },
      { tab: 'Налоги', icon: IconPercentage },
      { tab: 'P&L', icon: IconReportMoney },
      { tab: 'Cash-Flow', icon: IconArrowsExchange },
      { tab: 'Sensitivity', icon: IconFlask2 },
    ],
  },
  {
    group: 'Параметры',
    items: [
      { tab: 'Допущения', icon: IconAdjustmentsHorizontal },
      { tab: 'Сценарии', icon: IconVersions },
      { tab: 'Штат', icon: IconUserCog },
      { tab: 'Номенклатура', icon: IconListDetails },
      { tab: 'Спецификации', icon: IconClipboardList },
      { tab: 'IT', icon: IconCpu },
    ],
  },
]

export default function App() {
  const { params, matrix, items, scenario, setScenario, resetAll, exportJson, importJson } = useModel()
  const [tab, setTabState] = useState<Tab>(() => tabFromHash() ?? 'Дашборд')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ah-side') === '1')
  const [mobileOpen, setMobileOpen] = useState(false)
  const isMobile = useMediaQuery('(max-width: 900px)')
  const fileRef = useRef<HTMLInputElement>(null)

  const setTab = (t: Tab) => {
    setTabState(t)
    setMobileOpen(false)
    const hash = `#/${TAB_SLUGS[t]}`
    if (location.hash !== hash) location.hash = hash
  }
  useEffect(() => {
    const onHash = () => { const t = tabFromHash(); if (t) setTabState(t) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem('ah-side', c ? '0' : '1')
      return !c
    })
  }
  useHotkeys([['mod+B', () => (isMobile ? setMobileOpen((o) => !o) : toggleCollapsed())]])

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

  const rail = collapsed && !isMobile

  return (
    <div className={`shell${rail ? ' rail' : ''}`}>
      {isMobile && mobileOpen && <div className="backdrop" onClick={() => setMobileOpen(false)} />}

      <aside className={`sidebar${isMobile ? (mobileOpen ? ' mobile open' : ' mobile') : ''}`}>
        <div className="side-head">
          <div className="logo-mark">A</div>
          {!rail && (
            <div className="logo-text">
              <b>AURA HILLS</b>
              <span>финансовая модель</span>
            </div>
          )}
        </div>

        <nav className="side-nav">
          {NAV.map((g) => (
            <div key={g.group} className="nav-group">
              {rail ? <div className="nav-sep" /> : <div className="nav-label">{g.group}</div>}
              {g.items.map(({ tab: t, icon: Icon }) => {
                const btn = (
                  <button
                    key={t}
                    className={`nav-item${tab === t ? ' active' : ''}`}
                    onClick={() => setTab(t)}
                  >
                    <Icon size={17} stroke={1.7} />
                    {!rail && <span>{t}</span>}
                  </button>
                )
                return rail ? (
                  <Tooltip key={t} label={t} position="right" withArrow offset={8}>
                    {btn}
                  </Tooltip>
                ) : (
                  btn
                )
              })}
            </div>
          ))}
        </nav>

        {!isMobile && (
          <div className="side-foot">
            <Tooltip
              label={rail ? 'Развернуть (Ctrl+B)' : 'Свернуть (Ctrl+B)'}
              position="right" withArrow offset={8} disabled={!rail}
            >
              <button className="nav-item collapse-btn" onClick={toggleCollapsed}>
                {rail ? <IconChevronRight size={17} stroke={1.7} /> : <IconChevronLeft size={17} stroke={1.7} />}
                {!rail && <span>Свернуть</span>}
              </button>
            </Tooltip>
          </div>
        )}
      </aside>

      <div className="page">
        <header className="topbar">
          <Group gap="sm" wrap="nowrap">
            {isMobile && (
              <button className="burger" onClick={() => setMobileOpen(true)} aria-label="Меню">
                <IconMenu2 size={20} stroke={1.7} />
              </button>
            )}
            <Text fw={600} size="sm" className="page-title">{tab}</Text>
          </Group>
          <Group gap="xs" wrap="wrap" align="center" justify="flex-end">
            <Text size="xs" c="dimmed">Сценарий</Text>
            <Select
              size="xs" w={150}
              data={[...matrix.names]}
              value={scenario}
              onChange={(v) => v && setScenario(v)}
              allowDeselect={false}
            />
            <Button size="xs" variant="default" onClick={download}>JSON</Button>
            <Button size="xs" onClick={exportExcel}>Excel</Button>
            <Button size="xs" variant="default" onClick={() => fileRef.current?.click()}>Загрузить</Button>
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

        <main className="content">
          {tab === 'Дашборд' && <Dashboard r={result} />}
          {tab === 'Допущения' && <Assumptions />}
          {tab === 'Сценарии' && <Scenarios />}
          {tab === 'Штат' && <Staff />}
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
          {tab === 'Sensitivity' && <Sensitivity r={result} />}
        </main>
      </div>
    </div>
  )
}
