import { useMemo, useState } from 'react'
import {
  ActionIcon, Autocomplete, Button, Checkbox, Group, Modal, NumberInput,
  SegmentedControl, Select, TextInput,
} from '@mantine/core'
import { useModel } from '../store'
import { Hint, NumField, TextCell, fmt } from '../components/ui'
import { activeModuleCount, nomenclatureEquipEur } from '../model/opex'
import type { CapexItem, WbsLine, WbsSection } from '../model/types'

const COL = {
  name: 'Наименование строки сметы — справочно.',
  unit: 'Единица измерения — справочно (шт, компл, мес, общ).',
  perModule: 'Помодульная строка: количество умножается на число активных модулей СВОЕЙ очереди ' +
    '(оч. 1 — модули №1–3, оч. 2 — VIP №4–7). Так оборудование считается по фактическому составу, ' +
    'а не захардкожено под стартовый контур; у строк с WBS цена = ΣWBS ÷ эталонный объём.',
  qty: 'Количество единиц. Для помодульной строки — единиц НА каждый модуль.',
  price: 'Цена за единицу в евро — смета хранится в EUR.',
  eur: 'Сумма в евро: кол-во × цена €. Помодульные строки — по текущему числу активных модулей.',
  group: 'Раздел сметы для группировки в отчёте CAPEX.',
  phase: 'Очередь стройки: 1 — стартовый контур (строится в период стройки); 2 — объекты второй очереди, отток в окне 2029–2030, ввод по launchDate объектов.',
  object: 'Привязка строки очереди 2 к объекту: платится только при включённом объекте (тоглы в Допущениях). «Общая» — платится, если включён хотя бы один объект очереди 2.',
  cond: 'Условная строка: входит в CAPEX только при включённой опции «Прачечная: своя» (Допущения).',
  wbs: 'WBS-детализация строки: секции и позиции сметы (кол-во × ставка = сумма). Цена строки выводится из ΣWBS — нажмите для редактирования.',
  wbsCode: 'Код позиции WBS — справочно, для связи со сметой подрядчика.',
  wbsName: 'Наименование работы или материала.',
  wbsUnit: 'Единица измерения позиции — справочно.',
  wbsQty: 'Количество. Если заданы кол-во и ставка — сумма позиции пересчитывается как кол-во × ставка.',
  wbsRate: 'Цена за единицу. Изменение пересчитывает сумму позиции (кол-во × ставка).',
  wbsEur: 'Сумма позиции в евро. Можно править напрямую — тогда кол-во и ставка становятся справочными. Σ позиций задаёт цену строки сметы (для эталонной детали — через wbsQty).',
  wbsTag: 'Категория затрат — группировка детализации в отчёте CAPEX и Excel-экспорте.',
}

// Строка 30 — «Наполнение»: сумма считается из справочника номенклатуры,
// у неё нет собственных цены/количества.
const FILLER_ROW = 30

const PER_MODULE = /^MODULES_COUNT(?::(\d+))?$/
const perModuleN = (qty: CapexItem['qty']): number | null => {
  const m = PER_MODULE.exec(String(qty ?? ''))
  return m ? Number(m[1] ?? 1) : null
}
const qtyFor = (perModule: boolean, n: number): number | string =>
  perModule ? (n > 1 ? `MODULES_COUNT:${n}` : 'MODULES_COUNT') : n

const emptyRow = (row: number): CapexItem => ({
  name: '', unit: 'общ', qty: 1, priceEur: 0, row, group: 'Прочее',
})

// Смета строительного CAPEX — редактируемый грид, сгруппированный по разделам.
// Помимо этих строк в CAPEX входят: IT-пакет (вкладка IT), земля (режим
// покупки), наполнение из номенклатуры (строка 30).
export function Smeta() {
  const { params, items, setParam } = useModel()
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [wbsOpen, setWbsOpen] = useState<Set<number>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState<(CapexItem & { _perModule?: boolean }) | null>(null)
  const [deleteAsk, setDeleteAsk] = useState<{ it: CapexItem; index: number } | null>(null)
  const [phaseTab, setPhaseTab] = useState<string>('all')

  const rows = params.capexItems
  const fillerEur = nomenclatureEquipEur(items)
  const laundryOn = !!params.laundry?.enabled

  // Активность объектов очереди 2: vipN = N-й модуль phase=2 со статусом «Активен»,
  // public = флаг общественной бани. Общие строки (без object) — если есть ≥1 объект.
  const mods2 = params.modules
    .filter((m) => (m.phase ?? 1) === 2)
    .sort((a, b) => a.id - b.id)
  const objectEnabled = (object?: string): boolean => {
    if (!object) return true
    if (object === 'public') return !!params.publicBath?.enabled
    const m = /^vip(\d+)$/.exec(object)
    if (m) {
      const mod = mods2[+m[1] - 1]
      return !!mod && mod.status === 'Активен'
    }
    return true
  }
  const anyP2 = !!params.publicBath?.enabled || mods2.some((m) => m.status === 'Активен')
  // Помодульные строки масштабируются активными модулями СВОЕЙ очереди
  const modulesNow = (phase: 1 | 2) =>
    phase === 2
      ? mods2.filter((m) => m.status === 'Активен').length
      : activeModuleCount(params) - mods2.filter((m) => m.status === 'Активен').length

  const rowEur = (it: CapexItem): number => {
    if (it.row === FILLER_ROW) return fillerEur
    const n = perModuleN(it.qty)
    const qty = n !== null ? n * modulesNow(it.phase ?? 1) : Number(it.qty ?? 0)
    return qty * Number(it.priceEur ?? 0)
  }

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase()
    const filtered = rows
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => phaseTab === 'all' || (it.phase ?? 1) === Number(phaseTab))
      .filter(({ it }) =>
        !query || it.name.toLowerCase().includes(query) || (it.group ?? '').toLowerCase().includes(query),
      )
    const map = new Map<string, { it: CapexItem; index: number }[]>()
    for (const f of filtered) {
      const arr = map.get(f.it.group ?? 'Прочее') ?? []
      arr.push(f)
      map.set(f.it.group ?? 'Прочее', arr)
    }
    return [...map.entries()]
  }, [rows, q])

  const groupNames = [...new Set(rows.map((i) => i.group ?? 'Прочее'))]
  const unitNames = [...new Set([...rows.map((i) => i.unit), 'шт', 'компл', 'мес', 'общ', 'шт/модуль'])]
  const wbsUnits = [...new Set([
    ...unitNames, 'м²', 'м.п.', 'кг', 'л',
    ...rows.flatMap((r) => r.wbs?.flatMap((s) => s.items.map((l) => l.unit)) ?? []),
  ])].filter((u): u is string => !!u)
  const wbsTags = [...new Set(
    rows.flatMap((r) => r.wbs?.flatMap((s) => s.items.map((l) => l.tag)) ?? []),
  )].filter((t): t is string => !!t)
  const filtering = q.trim().length > 0

  const toggle = (g: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })

  // Строка активна: не условная по прачечной и (очередь 1 | объект оч.2 включён |
  // общая строка оч.2 при хотя бы одном включённом объекте)
  const isActive = (it: CapexItem) =>
    (!it.ifLaundry || laundryOn) &&
    ((it.phase ?? 1) === 1 || (anyP2 && objectEnabled(it.object)))
  const p1Eur = rows.filter((it) => isActive(it) && (it.phase ?? 1) === 1).reduce((s, it) => s + rowEur(it), 0)
  const p2Eur = rows.filter((it) => isActive(it) && it.phase === 2).reduce((s, it) => s + rowEur(it), 0)
  const totalEur = p1Eur + p2Eur
  const condEur = rows.filter((it) => !isActive(it)).reduce((s, it) => s + rowEur(it), 0)

  const set = (index: number, patch: Partial<CapexItem>) => {
    const next = rows.map((it, i) => (i === index ? { ...it, ...patch } : it))
    setParam('capexItems', next)
  }

  // WBS — источник цены строки: priceEur = ΣWBS / wbsQty (wbsQty = эталонный
  // объём, на который составлена детализация: у банных модулей — 3 модуля).
  const wbsSum = (wbs?: WbsSection[]) =>
    (wbs ?? []).reduce((s, sec) => s + sec.items.reduce((x, l) => x + (l.eur || 0), 0), 0)

  const setWbs = (index: number, wbs: WbsSection[] | undefined) => {
    const patch: Partial<CapexItem> = { wbs: wbs?.length ? wbs : undefined }
    if (wbs?.length) patch.priceEur = Math.round(wbsSum(wbs) / (rows[index].wbsQty ?? 1))
    set(index, patch)
  }

  const setWbsLine = (index: number, si: number, li: number, patch: Partial<WbsLine>) => {
    const wbs = (rows[index].wbs ?? []).map((s, j) =>
      j !== si ? s : ({
        ...s,
        items: s.items.map((l, k) => {
          if (k !== li) return l
          const nl = { ...l, ...patch }
          if (('qty' in patch || 'rate' in patch) && nl.qty != null && nl.rate != null)
            nl.eur = Math.round(nl.qty * nl.rate)
          return nl
        }),
      }),
    )
    setWbs(index, wbs)
  }

  const setWbsSection = (index: number, si: number, patch: Partial<WbsSection>) =>
    setWbs(index, (rows[index].wbs ?? []).map((s, j) => (j === si ? { ...s, ...patch } : s)))

  const addWbsLine = (index: number, si: number) =>
    setWbs(index, (rows[index].wbs ?? []).map((s, j) =>
      j === si ? { ...s, items: [...s.items, { code: '', name: 'Новая позиция', unit: 'общ', qty: 1, rate: 0, eur: 0 }] } : s,
    ))

  const removeWbsLine = (index: number, si: number, li: number) =>
    setWbs(index, (rows[index].wbs ?? []).map((s, j) =>
      j === si ? { ...s, items: s.items.filter((_, k) => k !== li) } : s,
    ))

  const addWbsSection = (index: number) => {
    const it = rows[index]
    const code = `${it.row}.${(it.wbs?.length ?? 0) + 1}`
    setWbs(index, [...(it.wbs ?? []), { code, title: 'Новый раздел', items: [] }])
  }

  const removeWbsSection = (index: number, si: number) =>
    setWbs(index, (rows[index].wbs ?? []).filter((_, j) => j !== si))

  const addWbs = (index: number) => {
    const it = rows[index]
    setWbs(index, [{
      code: `${it.row}.1`, title: it.name,
      items: [{ code: `${it.row}.1.1`, name: it.name, unit: it.unit, qty: 1, rate: Number(it.priceEur ?? 0), eur: Number(it.priceEur ?? 0) }],
    }])
    setWbsOpen((prev) => new Set(prev).add(index))
  }

  const toggleWbs = (index: number) =>
    setWbsOpen((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  const setQty = (it: CapexItem, index: number, v: number) => {
    const n = perModuleN(it.qty)
    set(index, { qty: qtyFor(n !== null, v) })
  }

  const openAdd = () => {
    setDraft({ ...emptyRow(Math.max(0, ...rows.map((r) => r.row)) + 1) })
    setAddOpen(true)
  }
  const saveDraft = () => {
    if (!draft || !draft.name.trim()) return
    const { _perModule, ...rest } = draft
    setParam('capexItems', [...rows, { ...rest, name: rest.name.trim(), qty: qtyFor(!!_perModule, Number(rest.qty) || 0) }])
    setAddOpen(false)
    setDraft(null)
    setExpanded((prev) => new Set(prev).add(rest.group ?? 'Прочее'))
  }
  const setD = (patch: Partial<CapexItem & { _perModule?: boolean }>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d))

  const removeRow = (index: number) => setParam('capexItems', rows.filter((_, i) => i !== index))

  return (
    <div>
      <p className="note">
        {rows.length} строк · смета: <b>€{fmt(totalEur)}</b>
        {' '}(оч. 1: €{fmt(p1Eur)} · оч. 2: €{fmt(p2Eur)})
        {condEur > 0 && <> (+ €{fmt(condEur)} выключенных строк — условные/объекты оч. 2 вне плана)</>}
        {' '}· итог отчёта = смета × (1 + буфер CAPEX).
        IT-пакет, земля и наполнение номенклатуры правятся на своих вкладках.
      </p>
      <div className="controls" style={{ marginBottom: 10 }}>
        <SegmentedControl
          size="sm"
          value={phaseTab}
          onChange={setPhaseTab}
          data={[
            { value: '1', label: `Очередь 1 · €${fmt(p1Eur)}` },
            { value: '2', label: `Очередь 2 · €${fmt(p2Eur)}` },
            { value: 'all', label: 'Вся смета' },
          ]}
        />
        <TextInput
          placeholder="Фильтр по наименованию или разделу…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={360}
          size="sm"
        />
        <Button size="sm" variant="light" onClick={openAdd}>+ Строка</Button>
      </div>
      <div className="table-wrap">
        <table className="month-table nom smeta">
          <thead>
            <tr>
              <th className="sticky"><Hint hint={{ text: COL.name }}><span>Наименование</span></Hint></th>
              <th><Hint hint={{ text: COL.unit }}><span>Ед.</span></Hint></th>
              <th><Hint hint={{ text: COL.perModule }}><span>на мод.</span></Hint></th>
              <th><Hint hint={{ text: COL.qty }}><span>Кол-во</span></Hint></th>
              <th><Hint hint={{ text: COL.price }}><span>Цена €</span></Hint></th>
              <th><Hint hint={{ text: COL.eur }}><span>Сумма €</span></Hint></th>
              <th><Hint hint={{ text: COL.group }}><span>Раздел</span></Hint></th>
              <th><Hint hint={{ text: COL.phase }}><span>Оч.</span></Hint></th>
              <th><Hint hint={{ text: COL.object }}><span>Объект</span></Hint></th>
              <th><Hint hint={{ text: COL.cond }}><span>Усл.</span></Hint></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([g, arr]) => {
              const open = filtering || expanded.has(g)
              const sub = arr.filter(({ it }) => isActive(it)).reduce((s, { it }) => s + rowEur(it), 0)
              return [
                <tr key={`g-${g}`} className="section spec-head" onClick={() => toggle(g)}>
                  <td colSpan={11} className="sticky">
                    <span className="spec-caret">{open ? '▾' : '▸'}</span>
                    {g} <small>· {arr.length} стр. · €{fmt(sub)}</small>
                  </td>
                </tr>,
                ...(open
                  ? arr.map(({ it, index: i }) => {
                      const n = perModuleN(it.qty)
                      const off = !isActive(it)
                      const hasWbs = !!it.wbs?.length
                      return [
                        <tr key={`${it.row}-${i}`} style={off ? { opacity: 0.45 } : undefined}>
                          <td className="sticky lft">
                            <TextCell w={300} value={it.name} onChange={(v) => set(i, { name: v })} />
                            {hasWbs ? (
                              <Hint hint={{ text: COL.wbs }}>
                                <small
                                  className="note"
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => toggleWbs(i)}
                                > {wbsOpen.has(i) ? '▾' : '▸'} WBS·{it.wbs!.length}</small>
                              </Hint>
                            ) : it.row !== FILLER_ROW ? (
                              <Hint hint={{ text: 'Создать WBS-детализацию: цена строки станет суммой позиций WBS' }}>
                                <small className="note" style={{ cursor: 'pointer' }} onClick={() => addWbs(i)}> +WBS</small>
                              </Hint>
                            ) : null}
                          </td>
                          <td>
                            <Select
                              size="xs" w={88} data={unitNames}
                              value={it.unit} allowDeselect={false}
                              onChange={(v) => v && set(i, { unit: v })}
                            />
                          </td>
                          <td>
                            <Checkbox
                              size="xs"
                              disabled={it.row === FILLER_ROW}
                              checked={n !== null}
                              onChange={(e) => set(i, { qty: qtyFor(e.currentTarget.checked, n ?? (Number(it.qty) || 1)) })}
                            />
                          </td>
                          <td className="qty">
                            {it.row === FILLER_ROW ? (
                              <span className="note">справ.</span>
                            ) : (
                              <NumField
                                value={n ?? Number(it.qty ?? 0)}
                                onChange={(v) => setQty(it, i, v)}
                                step={1}
                              />
                            )}
                          </td>
                          <td className="price">
                            {it.row === FILLER_ROW ? (
                              <span className="note">—</span>
                            ) : hasWbs ? (
                              <Hint hint={{ text: `Цена = ΣWBS${(it.wbsQty ?? 1) > 1 ? ` / ${it.wbsQty} (эталон на ${it.wbsQty} ед.)` : ''}` }}>
                                <span className="note">{fmt(Number(it.priceEur ?? 0))}</span>
                              </Hint>
                            ) : (
                              <NumField value={Number(it.priceEur ?? 0)} onChange={(v) => set(i, { priceEur: v })} step={500} />
                            )}
                          </td>
                          <td><b>€{fmt(rowEur(it))}</b></td>
                          <td className="lft">
                            <Autocomplete
                              size="xs" w={170} data={groupNames}
                              filter={({ options }) => options}
                              value={it.group ?? ''} onChange={(v) => set(i, { group: v || 'Прочее' })}
                            />
                          </td>
                          <td>
                            <Select
                              size="xs" w={62}
                              data={['1', '2']}
                              value={String(it.phase ?? 1)} allowDeselect={false}
                              onChange={(v) => set(i, { phase: v === '2' ? 2 : 1, ...(v !== '2' ? { object: undefined } : {}) })}
                            />
                          </td>
                          <td>
                            {(it.phase ?? 1) === 2 ? (
                              <Select
                                size="xs" w={104}
                                data={[
                                  { value: '', label: 'общая' },
                                  { value: 'public', label: 'Общ. баня' },
                                  { value: 'vip1', label: 'VIP-1' },
                                  { value: 'vip2', label: 'VIP-2' },
                                  { value: 'vip3', label: 'VIP-3' },
                                  { value: 'vip4', label: 'VIP-4' },
                                ]}
                                value={it.object ?? ''} allowDeselect={false}
                                onChange={(v) => set(i, { object: v || undefined })}
                              />
                            ) : <span className="note">—</span>}
                          </td>
                          <td>
                            <Checkbox
                              size="xs"
                              checked={!!it.ifLaundry}
                              onChange={(e) => set(i, { ifLaundry: e.currentTarget.checked || undefined })}
                            />
                          </td>
                          <td>
                            <Hint hint={{ text: 'Удалить строку из сметы' }}>
                              <span><ActionIcon size="sm" variant="subtle" color="red" onClick={() => setDeleteAsk({ it, index: i })}>✕</ActionIcon></span>
                            </Hint>
                          </td>
                        </tr>,
                        wbsOpen.has(i) && hasWbs ? (
                          <tr key={`wbs-${i}`}>
                            <td colSpan={11} className="wbs-cell">
                              <div className="wbs-editor">
                                <p className="note">
                                  WBS «{it.name}» · Σ = €{fmt(wbsSum(it.wbs))}
                                  {' '}· цена строки выводится из WBS, отдельно не редактируется.
                                </p>
                                <label className="field" style={{ marginBottom: 6 }}>
                                  <Hint hint={{ text: 'Эталонный объём детализации: ΣWBS делится на это число, чтобы получить цену за единицу строки сметы. Пример: детализация банного модуля составлена на 3 модуля → wbsQty = 3, цена = Σ/3.' }}>
                                    <span>Эталонный объём (wbsQty)</span>
                                  </Hint>
                                  <NumField
                                    value={it.wbsQty ?? 1}
                                    onChange={(v) => set(i, {
                                      wbsQty: v > 1 ? v : undefined,
                                      priceEur: Math.round(wbsSum(it.wbs) / (v || 1)),
                                    })}
                                    step={1}
                                  />
                                </label>
                                {it.wbs!.map((sec, si) => (
                                  <div key={`${sec.code}-${si}`} className="wbs-sec">
                                    <div className="wbs-sec-head">
                                      <TextCell w={360} value={sec.title} onChange={(v) => setWbsSection(i, si, { title: v })} />
                                      <span className="note">{sec.code} · €{fmt(sec.items.reduce((s, l) => s + l.eur, 0))}</span>
                                      <Button size="xs" variant="subtle" onClick={() => addWbsLine(i, si)}>+ строка</Button>
                                      <Hint hint={{ text: 'Удалить раздел WBS со всеми позициями' }}>
                                        <span><ActionIcon size="sm" variant="subtle" color="red" onClick={() => removeWbsSection(i, si)}>✕</ActionIcon></span>
                                      </Hint>
                                    </div>
                                    <table className="month-table nom wbs">
                                      <thead>
                                        <tr>
                                          <th><Hint hint={{ text: COL.wbsCode }}><span>Код</span></Hint></th>
                                          <th><Hint hint={{ text: COL.wbsName }}><span>Позиция</span></Hint></th>
                                          <th><Hint hint={{ text: COL.wbsUnit }}><span>Ед.</span></Hint></th>
                                          <th><Hint hint={{ text: COL.wbsQty }}><span>Кол-во</span></Hint></th>
                                          <th><Hint hint={{ text: COL.wbsRate }}><span>Ставка €</span></Hint></th>
                                          <th><Hint hint={{ text: COL.wbsEur }}><span>Сумма €</span></Hint></th>
                                          <th><Hint hint={{ text: COL.wbsTag }}><span>Категория</span></Hint></th>
                                          <th></th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {sec.items.map((l, li) => (
                                          <tr key={li}>
                                            <td><TextCell w={56} value={l.code} onChange={(v) => setWbsLine(i, si, li, { code: v })} /></td>
                                            <td className="lft"><TextCell w={340} value={l.name} onChange={(v) => setWbsLine(i, si, li, { name: v })} /></td>
                                            <td>
                                              <Select
                                                size="xs" w={88} data={wbsUnits}
                                                value={l.unit ?? 'общ'} allowDeselect={false}
                                                onChange={(v) => v && setWbsLine(i, si, li, { unit: v })}
                                              />
                                            </td>
                                            <td><NumField value={l.qty ?? 0} onChange={(v) => setWbsLine(i, si, li, { qty: v })} step={1} /></td>
                                            <td><NumField value={l.rate ?? 0} onChange={(v) => setWbsLine(i, si, li, { rate: v })} step={10} /></td>
                                            <td><NumField value={l.eur} onChange={(v) => setWbsLine(i, si, li, { eur: v })} step={100} /></td>
                                            <td>
                                              <Autocomplete
                                                size="xs" w={150} data={wbsTags}
                                                filter={({ options }) => options}
                                                value={l.tag ?? ''} onChange={(v) => setWbsLine(i, si, li, { tag: v || undefined })}
                                              />
                                            </td>
                                            <td>
                                              <ActionIcon size="sm" variant="subtle" color="red" onClick={() => removeWbsLine(i, si, li)}>✕</ActionIcon>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ))}
                                <Group gap="xs" mt={6}>
                                  <Button size="xs" variant="light" onClick={() => addWbsSection(i)}>+ раздел WBS</Button>
                                  <Hint hint={{ text: 'Убрать детализацию — цена строки снова задаётся вручную' }}>
                                    <span>
                                      <Button size="xs" variant="subtle" color="red" onClick={() => setWbs(i, undefined)}>убрать WBS</Button>
                                    </span>
                                  </Hint>
                                </Group>
                              </div>
                            </td>
                          </tr>
                        ) : null,
                      ]
                    })
                  : []),
              ]
            })}
          </tbody>
        </table>
      </div>

      <Modal opened={addOpen} onClose={() => setAddOpen(false)} title="Новая строка сметы" size="lg" centered>
        {draft && (
          <div className="crud-form">
            <TextInput label="Наименование" required value={draft.name} onChange={(e) => setD({ name: e.currentTarget.value })} />
            <Group grow>
              <Select
                label="Единица" data={unitNames}
                value={draft.unit} allowDeselect={false}
                onChange={(v) => v && setD({ unit: v })}
              />
              <Autocomplete
                label="Раздел" data={groupNames}
                filter={({ options }) => options}
                value={draft.group ?? ''} onChange={(v) => setD({ group: v || 'Прочее' })}
              />
            </Group>
            <Group grow>
              <NumberInput label="Кол-во" value={Number(draft.qty) || 0} min={0} onChange={(v) => setD({ qty: Number(v) || 0 })} />
              <NumberInput label="Цена €" value={Number(draft.priceEur) || 0} min={0} step={500} onChange={(v) => setD({ priceEur: Number(v) || 0 })} />
            </Group>
            <Group grow>
              <Select
                label="Очередь" data={[{ value: '1', label: 'Очередь 1' }, { value: '2', label: 'Очередь 2' }]}
                value={String(draft.phase ?? 1)} allowDeselect={false}
                onChange={(v) => setD({ phase: v === '2' ? 2 : 1, ...(v !== '2' ? { object: undefined } : {}) })}
              />
              {(draft.phase ?? 1) === 2 ? (
                <Select
                  label="Объект очереди 2" data={[
                    { value: '', label: 'общая строка' },
                    { value: 'public', label: 'Общественная баня' },
                    { value: 'vip1', label: 'VIP-1' },
                    { value: 'vip2', label: 'VIP-2' },
                    { value: 'vip3', label: 'VIP-3' },
                    { value: 'vip4', label: 'VIP-4' },
                  ]}
                  value={draft.object ?? ''} allowDeselect={false}
                  onChange={(v) => setD({ object: v || undefined })}
                />
              ) : <div />}
            </Group>
            <Group grow>
              <Checkbox label="Помодульная (кол-во на каждый активный модуль)" checked={!!draft._perModule} onChange={(e) => setD({ _perModule: e.currentTarget.checked })} />
              <Checkbox label="Условная — только при своей прачечной" checked={!!draft.ifLaundry} onChange={(e) => setD({ ifLaundry: e.currentTarget.checked || undefined })} />
            </Group>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setAddOpen(false)}>Отмена</Button>
              <Button onClick={saveDraft} disabled={!draft.name.trim()}>Добавить</Button>
            </Group>
          </div>
        )}
      </Modal>

      <Modal opened={!!deleteAsk} onClose={() => setDeleteAsk(null)} title="Удалить строку сметы?" size="sm" centered>
        {deleteAsk && (
          <div>
            <p>«{deleteAsk.it.name}» (€{fmt(rowEur(deleteAsk.it))}) будет удалена из сметы CAPEX.</p>
            {deleteAsk.it.wbs?.length ? (
              <p className="note">⚠ У строки есть WBS-детализация ({deleteAsk.it.wbs.length} разделов) — она будет потеряна вместе со строкой.</p>
            ) : null}
            {perModuleN(deleteAsk.it.qty) !== null && (
              <p className="note">⚠ Помодульная строка — её сумма масштабируется числом активных модулей.</p>
            )}
            {deleteAsk.it.row === FILLER_ROW && (
              <p className="note">⚠ Это строка «Наполнение» — без неё оборудование и мебель из Номенклатуры не попадут в смету. Стартовые запасы — на вкладке «Смета закупа».</p>
            )}
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setDeleteAsk(null)}>Отмена</Button>
              <Button color="red" onClick={() => { removeRow(deleteAsk.index); setDeleteAsk(null) }}>Удалить</Button>
            </Group>
          </div>
        )}
      </Modal>
    </div>
  )
}
