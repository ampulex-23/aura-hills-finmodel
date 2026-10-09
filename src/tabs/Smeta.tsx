import { useMemo, useState } from 'react'
import {
  ActionIcon, Autocomplete, Button, Checkbox, Group, Modal, NumberInput,
  TextInput,
} from '@mantine/core'
import { useModel } from '../store'
import { Hint, NumField, TextCell, fmt } from '../components/ui'
import { activeModuleCount, nomenclatureCapexEur } from '../model/opex'
import type { CapexItem } from '../model/types'

const COL = {
  name: 'Наименование строки сметы — справочно.',
  unit: 'Единица измерения — справочно (шт, компл, мес, общ).',
  perModule: 'Помодульная строка: количество умножается на число активных модулей. ' +
    'Так оборудование резервных модулей попадает в смету при их активации, ' +
    'а не остаётся захардкоженным под стартовый контур.',
  qty: 'Количество единиц. Для помодульной строки — единиц НА каждый модуль.',
  price: 'Цена за единицу в рублях — смета подрядчиков хранится в ₽ и конвертируется по курсу из Допущений (валютный риск курса отдельно в Sensitivity).',
  eur: 'Сумма в евро: кол-во × цена ₽ / курс. Помодульные строки — по текущему числу активных модулей.',
  group: 'Раздел сметы для группировки в отчёте CAPEX.',
  cond: 'Условная строка: входит в CAPEX только при включённой опции «Прачечная: своя» (Допущения).',
  wbs: 'У строки есть WBS-детализация сметчика (эталон в €). При изменении суммы строки детали масштабируются коэффициентом автоматически.',
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
  name: '', unit: 'общ', qty: 1, priceRub: 0, row, group: 'Прочее',
})

// Смета строительного CAPEX — редактируемый грид, сгруппированный по разделам.
// Помимо этих строк в CAPEX входят: IT-пакет (вкладка IT), земля (режим
// покупки), наполнение из номенклатуры (строка 30).
export function Smeta() {
  const { params, items, setParam } = useModel()
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState<(CapexItem & { _perModule?: boolean }) | null>(null)
  const [deleteAsk, setDeleteAsk] = useState<{ it: CapexItem; index: number } | null>(null)

  const rows = params.capexItems
  const rate = params.general.rubEurRate
  const modulesNow = activeModuleCount(params)
  const fillerEur = nomenclatureCapexEur(items)
  const laundryOn = !!params.laundry?.enabled

  const rowEur = (it: CapexItem): number => {
    if (it.row === FILLER_ROW) return fillerEur
    const n = perModuleN(it.qty)
    const qty = n !== null ? n * modulesNow : Number(it.qty ?? 0)
    return (qty * Number(it.priceRub ?? 0)) / rate
  }

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase()
    const filtered = rows
      .map((it, index) => ({ it, index }))
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
  const filtering = q.trim().length > 0

  const toggle = (g: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })

  const isActive = (it: CapexItem) => !it.ifLaundry || laundryOn
  const totalEur = rows.filter(isActive).reduce((s, it) => s + rowEur(it), 0)
  const condEur = rows.filter((it) => !isActive(it)).reduce((s, it) => s + rowEur(it), 0)

  const set = (index: number, patch: Partial<CapexItem>) => {
    const next = rows.map((it, i) => (i === index ? { ...it, ...patch } : it))
    setParam('capexItems', next)
  }

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
        {condEur > 0 && <> (+ €{fmt(condEur)} условных строк — «Прачечная: своя» выключена)</>}
        {' '}· курс {fmt(rate)} ₽/€ · итог отчёта = смета × (1 + буфер CAPEX сценария).
        IT-пакет, земля и наполнение номенклатуры правятся на своих вкладках.
      </p>
      <div className="controls" style={{ marginBottom: 10 }}>
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
              <th><Hint hint={{ text: COL.price }}><span>Цена ₽</span></Hint></th>
              <th><Hint hint={{ text: COL.eur }}><span>Сумма €</span></Hint></th>
              <th><Hint hint={{ text: COL.group }}><span>Раздел</span></Hint></th>
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
                  <td colSpan={9} className="sticky">
                    <span className="spec-caret">{open ? '▾' : '▸'}</span>
                    {g} <small>· {arr.length} стр. · €{fmt(sub)}</small>
                  </td>
                </tr>,
                ...(open
                  ? arr.map(({ it, index: i }) => {
                      const n = perModuleN(it.qty)
                      const off = !isActive(it)
                      return (
                        <tr key={`${it.row}-${i}`} style={off ? { opacity: 0.45 } : undefined}>
                          <td className="sticky lft">
                            <TextCell w={300} value={it.name} onChange={(v) => set(i, { name: v })} />
                            {it.wbs?.length ? (
                              <Hint hint={{ text: COL.wbs }}>
                                <small className="note"> WBS·{it.wbs.length}</small>
                              </Hint>
                            ) : null}
                          </td>
                          <td>
                            <TextCell w={52} value={it.unit} onChange={(v) => set(i, { unit: v || 'общ' })} />
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
                            ) : (
                              <NumField value={Number(it.priceRub ?? 0)} onChange={(v) => set(i, { priceRub: v })} step={50000} />
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
                        </tr>
                      )
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
              <TextInput label="Единица" value={draft.unit} onChange={(e) => setD({ unit: e.currentTarget.value || 'общ' })} />
              <Autocomplete
                label="Раздел" data={groupNames}
                filter={({ options }) => options}
                value={draft.group ?? ''} onChange={(v) => setD({ group: v || 'Прочее' })}
              />
            </Group>
            <Group grow>
              <NumberInput label="Кол-во" value={Number(draft.qty) || 0} min={0} onChange={(v) => setD({ qty: Number(v) || 0 })} />
              <NumberInput label="Цена ₽" value={Number(draft.priceRub) || 0} min={0} step={50000} onChange={(v) => setD({ priceRub: Number(v) || 0 })} />
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
              <p className="note">⚠ У строки есть WBS-детализация ({deleteAsk.it.wbs.length} разделов) — эталон сметчика будет потерян.</p>
            ) : null}
            {perModuleN(deleteAsk.it.qty) !== null && (
              <p className="note">⚠ Помодульная строка — её сумма масштабируется числом активных модулей.</p>
            )}
            {deleteAsk.it.row === FILLER_ROW && (
              <p className="note">⚠ Это строка «Наполнение» — без неё CAPEX-позиции номенклатуры не попадут в смету.</p>
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
