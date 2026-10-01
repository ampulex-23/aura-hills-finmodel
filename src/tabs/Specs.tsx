import { Fragment, useMemo, useState } from 'react'
import {
  ActionIcon, Autocomplete, Badge, Button, Group, Modal,
  NumberInput, Select, TextInput, Tooltip,
} from '@mantine/core'
import { useModel, nextCode } from '../store'
import { NumField, TextCell, fmt } from '../components/ui'
import { costAllServices } from '../model/spec'
import { landedCost } from '../model/opex'
import type { SpecItem } from '../model/types'

// Спецификации услуг: себестоимость = материалы (номенклатура) + труд (ставки-заглушки).
export function Specs() {
  const {
    items, services, labor, setServicePrice, setSpecQty, setLaborRate,
    addService, removeService, updateService, addSpecEntry, removeSpecEntry,
    addLaborRole, removeLaborRole, renameLaborRole,
  } = useModel()
  const byCode = useMemo(() => new Map(items.map((i) => [i.code, i])), [items])
  const costs = useMemo(() => costAllServices(services, items, labor), [services, items, labor])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [deleteAsk, setDeleteAsk] = useState<string | null>(null)
  const [draft, setDraft] = useState({ code: '', direction: 'Доп. услуги', name: '', price: 0 })
  // Черновик новой строки состава: для каждой раскрытой услуги своё состояние
  const [entryKind, setEntryKind] = useState<Record<string, 'material' | 'labor'>>({})
  const [entryRef, setEntryRef] = useState<Record<string, string>>({})
  const [entryQty, setEntryQty] = useState<Record<string, number>>({})

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })

  const directions = [...new Set(services.map((s) => s.direction))]
  // Коды услуг разбиты по направлениям (SVC-P# парения, SVC-M# массаж…) —
  // префикс новой услуги наследуем от первой услуги того же направления.
  const dirPrefix = (dir: string) =>
    services.find((x) => x.direction === dir)?.code.replace(/\d+$/, '') ?? 'SVC-'
  const codeFor = (dir: string) => nextCode(dirPrefix(dir), services.map((s) => s.code))
  const materialOptions = items
    .filter((i) => i.use === 'Спецификация' || i.use === 'OPEX')
    .map((i) => ({ value: i.code, label: `${i.code} — ${i.name}` }))
  const roleOptions = labor.map((l) => ({ value: l.role, label: `${l.role} (€${fmt(l.rateHour)}/ч)` }))

  const openAdd = () => {
    const direction = 'Доп. услуги'
    setDraft({ code: codeFor(direction), direction, name: '', price: 0 })
    setAddOpen(true)
  }
  const saveService = () => {
    if (!draft.name.trim()) return
    addService({ code: draft.code, direction: draft.direction.trim() || 'Доп. услуги', name: draft.name.trim(), price: draft.price, items: [] })
    setAddOpen(false)
    setExpanded((prev) => new Set(prev).add(draft.code))
  }

  const addEntry = (svcCode: string) => {
    const kind = entryKind[svcCode] ?? 'material'
    const ref = entryRef[svcCode]
    const qty = entryQty[svcCode] ?? 0
    if (!ref || qty <= 0) return
    const entry: SpecItem =
      kind === 'material' ? { kind, code: ref, qty } : { kind, role: ref, minutes: qty }
    addSpecEntry(svcCode, entry)
    setEntryQty((p) => ({ ...p, [svcCode]: 0 }))
  }

  return (
    <div>
      <div className="controls" style={{ justifyContent: 'space-between', marginTop: 4 }}>
        <h3 style={{ margin: 0 }}>Ставки труда (заглушки до листа ФОТ)</h3>
        <Button size="sm" variant="light" onClick={openAdd}>+ Услуга</Button>
      </div>
      <div className="table-wrap">
        <table className="month-table spec">
          <thead>
            <tr><th className="sticky">Роль</th><th className="lft">€/час с взносами</th><th className="lft">Комментарий</th><th></th></tr>
          </thead>
          <tbody>
            {labor.map((l, li) => (
              <tr key={li}>
                <td className="sticky">
                  <TextCell w={180} value={l.role} onChange={(v) => renameLaborRole(l.role, v)} />
                </td>
                <td><NumField value={l.rateHour} onChange={(v) => setLaborRate(l.role, v)} step={0.5} /></td>
                <td className="lft"><small>{l.note}</small></td>
                <td>
                  <Tooltip label="Удалить роль" openDelay={300}>
                    <ActionIcon size="sm" variant="subtle" color="red" onClick={() => removeLaborRole(l.role)}>✕</ActionIcon>
                  </Tooltip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Group mt="xs">
        <Button
          size="xs" variant="subtle" color="gray"
          onClick={() => addLaborRole({ role: `Роль ${labor.length + 1}`, rateHour: 10, note: 'новая' })}
        >
          + Ставка труда
        </Button>
      </Group>

      {directions.map((dir) => (
        <div key={dir}>
          <h3>{dir}</h3>
          <div className="table-wrap">
            <table className="month-table spec">
              <thead>
                <tr>
                  <th className="sticky">Услуга</th>
                  <th className="lft">Цена €</th><th>Материалы €</th><th>Труд €</th>
                  <th>Себес €</th><th>Маржа €</th><th>Марж. %</th><th></th>
                </tr>
              </thead>
              <tbody>
                {costs.filter((c) => c.spec.direction === dir).map((c) => (
                  <Fragment key={c.spec.code}>
                    <tr className="spec-head" onClick={() => toggle(c.spec.code)}>
                      <td className="sticky">
                        <Group gap={4} wrap="nowrap">
                          <span className="spec-caret">{expanded.has(c.spec.code) ? '▾' : '▸'}</span>
                          <span onClick={(e) => e.stopPropagation()} style={{ flex: 1 }}>
                            <TextCell w="100%" value={c.spec.name} onChange={(v) => updateService(c.spec.code, { name: v })} />
                          </span>
                        </Group>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <NumField value={c.spec.price} onChange={(v) => setServicePrice(c.spec.code, v)} step={5} />
                      </td>
                      <td>{fmt(c.materialsCost, 2)}</td>
                      <td>{fmt(c.laborCost, 2)}</td>
                      <td><b>{fmt(c.cost, 2)}</b></td>
                      <td className={c.margin < 0 ? 'neg' : ''}>{fmt(c.margin, 2)}</td>
                      <td>
                        <Badge
                          size="sm" variant="light"
                          color={c.marginPct >= 0.6 ? 'green' : c.marginPct >= 0.3 ? 'yellow' : 'red'}
                        >
                          {(c.marginPct * 100).toFixed(0)}%
                        </Badge>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Tooltip label="Удалить услугу" openDelay={300}>
                          <ActionIcon size="sm" variant="subtle" color="red" onClick={() => setDeleteAsk(c.spec.code)}>✕</ActionIcon>
                        </Tooltip>
                      </td>
                    </tr>
                    {expanded.has(c.spec.code) && c.spec.items.map((it, ii) => (
                      <tr key={`${c.spec.code}-${ii}`} className="spec-item">
                        <td className={`sticky lft spec-leaf${ii === c.spec.items.length - 1 ? ' last' : ''}`}>
                          <small>
                            {it.kind === 'material'
                              ? byCode.get(it.code ?? '')?.name ?? it.code
                              : `${it.role} (${it.minutes} мин)`}
                          </small>
                        </td>
                        <td>
                          <NumField
                            value={it.kind === 'labor' ? (it.minutes ?? 0) : (it.qty ?? 0)}
                            onChange={(v) => setSpecQty(c.spec.code, ii, v)}
                            step={it.kind === 'labor' ? 5 : 0.01}
                          />
                        </td>
                        <td colSpan={2} className="lft">
                          <small>
                            {it.kind === 'material' && byCode.get(it.code ?? '')
                              ? `× €${fmt(landedCost(byCode.get(it.code ?? '')!), 2)}/${byCode.get(it.code ?? '')!.unit}`
                              : it.kind === 'labor'
                                ? `× €${fmt(labor.find((l) => l.role === it.role)?.rateHour ?? 0, 2)}/ч`
                                : ''}
                          </small>
                        </td>
                        <td>
                          <small>
                            {it.kind === 'material' && byCode.get(it.code ?? '')
                              ? fmt(landedCost(byCode.get(it.code ?? '')!) * (it.qty ?? 0), 2)
                              : it.kind === 'labor'
                                ? fmt(((it.minutes ?? 0) / 60) * (labor.find((l) => l.role === it.role)?.rateHour ?? 0), 2)
                                : '—'}
                          </small>
                        </td>
                        <td colSpan={2} />
                        <td>
                          <Tooltip label="Удалить из состава" openDelay={300}>
                            <ActionIcon size="xs" variant="subtle" color="red" onClick={() => removeSpecEntry(c.spec.code, ii)}>✕</ActionIcon>
                          </Tooltip>
                        </td>
                      </tr>
                    ))}
                    {expanded.has(c.spec.code) && (
                      <tr className="spec-add">
                        <td className="sticky lft spec-leaf last"><small>＋</small></td>
                        <td colSpan={5} className="lft">
                          <Group gap={6} wrap="nowrap">
                            <Select
                              size="xs" w={110}
                              data={[
                                { value: 'material', label: 'Материал' },
                                { value: 'labor', label: 'Труд' },
                              ]}
                              value={entryKind[c.spec.code] ?? 'material'}
                              onChange={(v) => {
                                setEntryKind((p) => ({ ...p, [c.spec.code]: (v as 'material' | 'labor') ?? 'material' }))
                                setEntryRef((p) => ({ ...p, [c.spec.code]: '' }))
                              }}
                              allowDeselect={false}
                            />
                            <Select
                              size="xs" w={280} searchable
                              placeholder={(entryKind[c.spec.code] ?? 'material') === 'material' ? 'Позиция номенклатуры…' : 'Роль…'}
                              data={(entryKind[c.spec.code] ?? 'material') === 'material' ? materialOptions : roleOptions}
                              value={entryRef[c.spec.code] ?? null}
                              onChange={(v) => setEntryRef((p) => ({ ...p, [c.spec.code]: v ?? '' }))}
                            />
                            <NumField
                              value={entryQty[c.spec.code] ?? 0}
                              onChange={(v) => setEntryQty((p) => ({ ...p, [c.spec.code]: v }))}
                              step={(entryKind[c.spec.code] ?? 'material') === 'labor' ? 5 : 0.01}
                            />
                            <small>{(entryKind[c.spec.code] ?? 'material') === 'labor' ? 'минут' : 'единиц'}</small>
                          </Group>
                        </td>
                        <td colSpan={2}>
                          <Button
                            size="xs" variant="light"
                            disabled={!entryRef[c.spec.code] || !(entryQty[c.spec.code] > 0)}
                            onClick={() => addEntry(c.spec.code)}
                          >
                            + Добавить
                          </Button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <p className="note">
        Себестоимость = Σ(норма × landed cost материала) + Σ(минуты/60 × ставка роли).
        Аналитический блок — в P&amp;L пока не входит: выручка услуг уже учтена через депозит/uptake,
        спецификации нужны для проверки прайса и подготовки листа ФОТ (переменная часть).
      </p>

      <Modal opened={addOpen} onClose={() => setAddOpen(false)} title="Новая услуга" size="md" centered>
        <div className="crud-form">
          <Group grow>
            <TextInput label="Код (авто)" value={draft.code} readOnly />
            <Autocomplete
              label="Направление" data={directions}
              filter={({ options }) => options}
              value={draft.direction} onChange={(v) => setDraft((d) => ({ ...d, direction: v, code: codeFor(v || 'Доп. услуги') }))}
            />
          </Group>
          <TextInput
            label="Название" required
            value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.currentTarget.value }))}
          />
          <NumberInput
            label="Цена €" min={0} value={draft.price}
            onChange={(v) => setDraft((d) => ({ ...d, price: Number(v) || 0 }))}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setAddOpen(false)}>Отмена</Button>
            <Button onClick={saveService} disabled={!draft.name.trim()}>Создать</Button>
          </Group>
        </div>
      </Modal>

      <Modal opened={!!deleteAsk} onClose={() => setDeleteAsk(null)} title="Удалить услугу?" size="sm" centered>
        {deleteAsk && (
          <div>
            <p>«{services.find((s) => s.code === deleteAsk)?.name}» ({deleteAsk}) будет удалена вместе со спецификацией.</p>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setDeleteAsk(null)}>Отмена</Button>
              <Button color="red" onClick={() => { removeService(deleteAsk); setDeleteAsk(null) }}>Удалить</Button>
            </Group>
          </div>
        )}
      </Modal>
    </div>
  )
}
