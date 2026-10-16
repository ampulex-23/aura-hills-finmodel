import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Group, Modal, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { useHotkeys, useMediaQuery } from '@mantine/hooks'
import {
  IconAdjustmentsHorizontal, IconArrowsExchange, IconBook2, IconChartLine,
  IconChevronLeft, IconChevronRight, IconClipboardList, IconCoins, IconCpu,
  IconDeviceFloppy, IconFlask2, IconHistory, IconLayoutDashboard, IconListDetails, IconMenu2,
  IconPercentage, IconReceipt2, IconReportMoney, IconShoppingCart, IconSparkles, IconUserCog, IconUsers, IconVersions,
} from '@tabler/icons-react'
import { useModel } from './store'
import { runModel } from './model/run'
import { diffBundles } from './diff'
import { Versions } from './tabs/Versions'
import { exportWorkbook } from './export/excel'
import { monthLabels } from './components/ui'
import { Dashboard } from './tabs/Dashboard'
import { Assumptions } from './tabs/Assumptions'
import { Scenarios } from './tabs/Scenarios'
import { CashFlow, Capex, Fot, Opex, Pnl, Revenue, Taxes } from './tabs/Reports'
import { Nomenclature } from './tabs/Nomenclature'
import { Smeta } from './tabs/Smeta'
import { Zakup } from './tabs/Zakup'
import { Specs } from './tabs/Specs'
import { It } from './tabs/It'
import { Staff } from './tabs/Staff'
import { Sensitivity } from './tabs/Sensitivity'
import { DocView } from './components/DocView'
import { DeckView } from './components/DeckView'
import { GenplanView } from './components/GenplanView'
import { AiChat, useChat } from './components/AiChat'
import { DOCS, getDoc } from './docs'

type Tab =
  | 'Дашборд' | 'Допущения' | 'Сценарии' | 'Версии' | 'Штат' | 'Номенклатура' | 'Смета стройки' | 'Смета закупа' | 'Спецификации' | 'IT'
  | 'Выручка' | 'OPEX' | 'ФОТ' | 'CAPEX' | 'Налоги' | 'P&L' | 'Cash-Flow' | 'Sensitivity'

// Hash-роутинг: #/dashboard … #/sensitivity — вкладка переживает F5, ссылки шарятся.
const TAB_SLUGS: Record<Tab, string> = {
  'Дашборд': 'dashboard', 'Допущения': 'assumptions', 'Сценарии': 'scenarios',
  'Версии': 'versions',
  'Штат': 'staff',
  'Номенклатура': 'nomenclature', 'Смета стройки': 'smeta', 'Смета закупа': 'zakup', 'Спецификации': 'specs', 'IT': 'it',
  'Выручка': 'revenue', 'OPEX': 'opex', 'ФОТ': 'fot', 'CAPEX': 'capex',
  'Налоги': 'taxes', 'P&L': 'pnl', 'Cash-Flow': 'cashflow', 'Sensitivity': 'sensitivity',
}
const SLUG_TABS = new Map(Object.entries(TAB_SLUGS).map(([t, s]) => [s, t as Tab]))
const DOC_IDS = new Set(DOCS.map((d) => d.id))
type Route = Tab | `doc:${string}`
const routeFromHash = (): Route | null => {
  const h = location.hash.replace(/^#\//, '')
  if (h.startsWith('doc/') && DOC_IDS.has(h.slice(4))) return `doc:${h.slice(4)}`
  return SLUG_TABS.get(h) ?? null
}
const slugOf = (r: Route) => (r.startsWith('doc:') ? `doc/${r.slice(4)}` : TAB_SLUGS[r as Tab])

type NavItem = { id: Route; label: string; icon: typeof IconCpu }
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Data Room',
    items: DOCS.map((d) => ({ id: `doc:${d.id}` as Route, label: d.navTitle, icon: IconBook2 })),
  },
  {
    group: 'Параметры',
    items: [
      { id: 'Допущения', label: 'Допущения', icon: IconAdjustmentsHorizontal },
      { id: 'Сценарии', label: 'Сценарии', icon: IconVersions },
      { id: 'Штат', label: 'Штат', icon: IconUserCog },
      { id: 'Номенклатура', label: 'Номенклатура', icon: IconListDetails },
      { id: 'Смета стройки', label: 'Смета стройки', icon: IconCoins },
      { id: 'Смета закупа', label: 'Смета закупа', icon: IconShoppingCart },
      { id: 'Спецификации', label: 'Спецификации', icon: IconClipboardList },
      { id: 'IT', label: 'IT', icon: IconCpu },
    ],
  },
  {
    group: 'Отчёты',
    items: [
      { id: 'Дашборд', label: 'Дашборд', icon: IconLayoutDashboard },
      { id: 'Выручка', label: 'Выручка', icon: IconChartLine },
      { id: 'OPEX', label: 'OPEX', icon: IconReceipt2 },
      { id: 'ФОТ', label: 'ФОТ', icon: IconUsers },
      { id: 'CAPEX', label: 'CAPEX', icon: IconCoins },
      { id: 'Налоги', label: 'Налоги', icon: IconPercentage },
      { id: 'P&L', label: 'P&L', icon: IconReportMoney },
      { id: 'Cash-Flow', label: 'Cash-Flow', icon: IconArrowsExchange },
      { id: 'Sensitivity', label: 'Sensitivity', icon: IconFlask2 },
    ],
  },
]

export default function App() {
  const {
    params, matrix, items, services, scenario, setScenario, resetAll, exportJson, importJson,
    versioned, baseSha, dirty, previewSha, savedState, serverPending, stashInfo, author,
    setAuthor, syncVersions, keepDraft, applyServer, restoreStash, saveVersion, exitPreview, restoreVersion,
  } = useModel()
  const { open: aiOpen, pins: aiPins, toggle: aiToggle } = useChat()
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [saveErr, setSaveErr] = useState(false)
  const [tab, setTabState] = useState<Route>(() => routeFromHash() ?? 'Дашборд')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ah-side') === '1')
  const [closedGroups, setClosedGroups] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem('ah-nav-groups') ?? '[]')),
  )
  const [mobileOpen, setMobileOpen] = useState(false)
  const isMobile = useMediaQuery('(max-width: 900px)')
  const fileRef = useRef<HTMLInputElement>(null)

  const setTab = (t: Route) => {
    setTabState(t)
    setMobileOpen(false)
    const hash = `#/${slugOf(t)}`
    if (location.hash !== hash) location.hash = hash
  }
  useEffect(() => {
    const onHash = () => { const t = routeFromHash(); if (t) setTabState(t) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Старт: подхватываем сохранённое состояние и версии с сервера (если он есть).
  // Если сервер недоступен/без git — приложение работает по-старому на localStorage.
  useEffect(() => { void syncVersions() }, [syncVersions])

  const currentBundle = useMemo(
    () => ({ params, matrix, items, services, scenario }),
    [params, matrix, items, services, scenario],
  )
  const dirtyCount = useMemo(
    () => (dirty && savedState ? diffBundles(savedState, currentBundle).length : dirty ? 1 : 0),
    [dirty, savedState, currentBundle],
  )

  const doSave = async (force = false) => {
    if (!saveMsg.trim()) return
    setSaveBusy(true)
    const r = await saveVersion(saveMsg.trim(), force)
    setSaveBusy(false)
    if (r === 'ok') { setSaveOpen(false); setConflict(false); setSaveMsg(''); setSaveErr(false) }
    else if (r === 'conflict') setConflict(true)
    else setSaveErr(true)
  }

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem('ah-side', c ? '0' : '1')
      return !c
    })
  }
  useHotkeys([['mod+B', () => (isMobile ? setMobileOpen((o) => !o) : toggleCollapsed())]])

  const toggleGroup = (g: string) =>
    setClosedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      localStorage.setItem('ah-nav-groups', JSON.stringify([...next]))
      return next
    })

  const result = useMemo(
    () => runModel(params, matrix, items, services, scenario),
    [params, matrix, items, services, scenario],
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
    const blob = await exportWorkbook(params, matrix, items, services, scenario)
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
          {NAV.map((g) => {
            const closed = !rail && closedGroups.has(g.group)
            return (
            <div key={g.group} className="nav-group">
              {rail ? (
                <div className="nav-sep" />
              ) : (
                <button className="nav-label" onClick={() => toggleGroup(g.group)}>
                  <span>{g.group}</span>
                  <IconChevronLeft size={13} stroke={2} className={`nav-caret${closed ? ' closed' : ''}`} />
                </button>
              )}
              {!closed && g.items.map(({ id, label, icon: Icon }) => {
                const btn = (
                  <button
                    key={id}
                    className={`nav-item${tab === id ? ' active' : ''}`}
                    onClick={() => setTab(id)}
                  >
                    <Icon size={17} stroke={1.7} />
                    {!rail && <span>{label}</span>}
                  </button>
                )
                return rail ? (
                  <Tooltip key={id} label={label} position="right" withArrow offset={8}>
                    {btn}
                  </Tooltip>
                ) : (
                  btn
                )
              })}
            </div>
            )
          })}
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
            <Text fw={600} size="sm" className="page-title">
              {tab.startsWith('doc:') ? (getDoc(tab.slice(4))?.navTitle ?? tab) : tab}
            </Text>
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
            {versioned && (
              <Tooltip label={dirty ? `${dirtyCount} изменений не сохранено` : 'Все изменения сохранены в версии'}>
                <Button
                  size="xs" variant={dirty ? 'filled' : 'default'} color={dirty ? 'green' : 'gray'}
                  leftSection={<IconDeviceFloppy size={14} />}
                  disabled={!dirty}
                  onClick={() => setSaveOpen(true)}
                >
                  Сохранить версию{dirty ? ` · ${dirtyCount}` : ''}
                </Button>
              </Tooltip>
            )}
            {versioned && (
              <Button
                size="xs" variant="default" leftSection={<IconHistory size={14} />}
                onClick={() => setTab('Версии')}
              >
                Версии
              </Button>
            )}
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
            <Button
              size="xs" variant={aiOpen ? 'filled' : 'light'}
              leftSection={<IconSparkles size={14} />}
              onClick={aiToggle}
              title="ИИ-консультант по модели"
            >
              ИИ{aiPins.length > 0 ? ` · ${aiPins.length}` : ''}
            </Button>
          </Group>
        </header>

        <main className="content">
          {serverPending && (
            <Alert color="yellow" mb="sm" title="На сервере другая версия">
              <Text size="sm" mb="xs">
                Сохранённая версия {serverPending.sha.slice(0, 7)} отличается от ваших локальных изменений.
              </Text>
              <Group gap="xs">
                <Button size="compact-xs" variant="filled" onClick={keepDraft}>Оставить мои изменения</Button>
                <Button size="compact-xs" variant="default" onClick={applyServer}>Взять серверную версию</Button>
              </Group>
            </Alert>
          )}
          {stashInfo && !serverPending && !previewSha && (
            <Alert color="blue" mb="sm" title="Есть отложенный черновик">
              <Text size="sm" mb="xs">
                При просмотре версии был сохранён черновик от {new Date(stashInfo.savedAt).toLocaleString('ru-RU')}.
              </Text>
              <Group gap="xs">
                <Button size="compact-xs" variant="filled" onClick={restoreStash}>Восстановить черновик</Button>
                <Button
                  size="compact-xs" variant="default"
                  onClick={() => { localStorage.removeItem('aura-hills-draft-stash'); useModel.setState({ stashInfo: null }) }}
                >
                  Удалить
                </Button>
              </Group>
            </Alert>
          )}
          {previewSha && (
            <Alert color="violet" mb="sm" title={`Просмотр версии ${previewSha.slice(0, 7)}`}>
              <Text size="sm" mb="xs">Редактирование отключено. Ваш черновик сохранён и будет возвращён при выходе.</Text>
              <Group gap="xs">
                <Button size="compact-xs" variant="filled" onClick={exitPreview}>Вернуться к черновику</Button>
                <Button
                  size="compact-xs" variant="light" color="violet"
                  onClick={() => void restoreVersion(previewSha)}
                >
                  Сделать этой версией основной
                </Button>
              </Group>
            </Alert>
          )}
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
          {tab === 'Смета стройки' && <Smeta />}
          {tab === 'Смета закупа' && <Zakup />}
          {tab === 'Спецификации' && <Specs />}
          {tab === 'IT' && <It />}
          {tab === 'Sensitivity' && <Sensitivity r={result} />}
          {tab === 'Версии' && <Versions />}
          {tab.startsWith('doc:') && (() => {
            const d = getDoc(tab.slice(4))
            if (!d) return null
            if (d.kind === 'genplan') return <GenplanView key={d.id} />
            return d.kind === 'deck' ? <DeckView key={d.id} /> : <DocView key={d.id} doc={d} />
          })()}
        </main>
      </div>

      <Modal
        opened={saveOpen} onClose={() => { setSaveOpen(false); setConflict(false) }}
        title="Сохранить версию модели" centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Текущие параметры ({dirtyCount} изм.) будут зафиксированы как новая версия в истории.
            {baseSha && <> База: <Text span ff="monospace" size="xs">{baseSha.slice(0, 7)}</Text></>}
          </Text>
          <TextInput
            label="Что изменилось?" placeholder="например: поднял цену сауны до 50€"
            value={saveMsg} onChange={(e) => setSaveMsg(e.currentTarget.value)}
            required data-autofocus
          />
          <TextInput
            label="Автор" placeholder="Ваше имя"
            value={author} onChange={(e) => setAuthor(e.currentTarget.value)}
          />
          {conflict && (
            <Alert color="orange" title="Конфликт версий">
              Пока вы редактировали, на сервере появилась новая версия.
              Сравнить можно на вкладке «Версии».
            </Alert>
          )}
          {saveErr && <Alert color="red">Не удалось сохранить — проверьте сервер.</Alert>}
          <Group justify="flex-end">
            {conflict && (
              <Button size="sm" color="orange" variant="light" loading={saveBusy} onClick={() => void doSave(true)}>
                Сохранить поверх
              </Button>
            )}
            <Button size="sm" variant="default" onClick={() => { setSaveOpen(false); setConflict(false) }}>Отмена</Button>
            <Button size="sm" color="green" loading={saveBusy} disabled={!saveMsg.trim()} onClick={() => void doSave()}>
              Сохранить
            </Button>
          </Group>
        </Stack>
      </Modal>

      <AiChat />
    </div>
  )
}
