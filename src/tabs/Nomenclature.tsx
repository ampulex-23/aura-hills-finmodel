import { useMemo, useState } from 'react'
import {
  ActionIcon, Autocomplete, Button, Group, Modal, NumberInput,
  SegmentedControl, Select, TextInput,
} from '@mantine/core'
import { useModel, nextCode } from '../store'
import { Hint, NumField, TextCell, fmt } from '../components/ui'
import { landedCost, nomenclatureCapexEur } from '../model/opex'
import type { NomenclatureItem } from '../model/types'

// Пояснения колонок — тот же стиль Hint-балунов, что в отчётах
const COL = {
  code: 'Уникальный код позиции (NC-XXX). По коду она привязывается к спецификациям услуг и отчётным строкам.',
  name: 'Свободное название — только для чтения, на расчёт не влияет.',
  type: 'Справочный тип (Расходник / ОС / прочее) — для группировки, на расчёт не влияет.',
  unit: 'Единица измерения — справочно.',
  price: 'Закупочная цена поставщика за единицу, без доставки.',
  dfix: 'Фиксированная доставка за единицу. Сравнивается с процентной — в landed идёт большее из двух.',
  dpct: 'Доставка в процентах от цены. Сравнивается с фиксом — берётся большее. Для чисто процентной доставки поставьте «Дост. €/ед» = 0 (и наоборот).',
  landed: 'Полная себестоимость единицы: цена + max(дост. €/ед, цена × дост. %). Все суммы в модели считаются от landed.',
  article: 'Статья переменных расходов, в которую позиция списывается помесячно. Пусто → не списывается (только справочник).',
  norm: 'Расход единиц позиции на единицу базы: 0.25 веника на слот, 0.1 л масла на гостя, 2 баллона в месяц.',
  base: 'На что умножается норма: оплаченные слоты месяца, гости (включая членов), или просто месяц.',
  qty: 'Единиц, закупаемых в стройке: landed × кол-во → строка «Наполнение» CAPEX.',
  initial: 'Стартовый комплект на открытие — правится на вкладке «Смета закупа».',
  use: 'Режим учёта — переносит позицию между вкладками. OPEX — списание по норме; CAPEX — разовая закупка «Кол-во»; Спецификация — материал себестоимости услуг: расход задаётся в спеке услуги, поле «Норма» здесь НЕ применяется (иначе двойное списание).',
}

const emptyItem = (code: string): NomenclatureItem => ({
  code, name: '', category: 'Прочее', type: 'Расходник', unit: 'шт',
  price: 0, deliveryFix: 0, deliveryPct: 0, use: 'OPEX',
  opexArticle: null, norm: 0, normBase: 'слот', qty: 0, note: null,
})

// Справочник номенклатуры — редактируемый грид, сгруппированный по категориям.
export function Nomenclature() {
  const {
    items, services, setItem, addItem, removeItem,
  } = useModel()
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState<NomenclatureItem | null>(null)
  const [deleteAsk, setDeleteAsk] = useState<NomenclatureItem | null>(null)
  const [tab, setTab] = useState<'OPEX' | 'CAPEX' | 'Спецификация'>('OPEX')

  const opexItems = items.filter((i) => i.use === 'OPEX').length
  const specItems = items.filter((i) => i.use === 'Спецификация').length
  const capexItems = items.filter((i) => i.use === 'CAPEX').length
  const capexEur = nomenclatureCapexEur(items)

  const categories = [...new Set(items.map((i) => i.category))]
  const articles = [...new Set(items.map((i) => i.opexArticle).filter(Boolean))] as string[]
  const units = [...new Set(items.map((i) => i.unit))]
  const types = [...new Set(items.map((i) => i.type))]

  // {item, index} — index нужен для setItem (позиционное обновление в store)
  const groups = useMemo(() => {
    const query = q.trim().toLowerCase()
    const filtered = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.use === tab)
      .filter(({ item }) =>
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.code.toLowerCase().includes(query) ||
        (item.opexArticle ?? '').toLowerCase().includes(query),
      )
    const map = new Map<string, { item: (typeof items)[number]; index: number }[]>()
    for (const f of filtered) {
      const arr = map.get(f.item.category) ?? []
      arr.push(f)
      map.set(f.item.category, arr)
    }
    return [...map.entries()]
  }, [items, q, tab])

  const toggle = (cat: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })

  const filtering = q.trim().length > 0

  const openAdd = () => {
    setDraft(emptyItem(nextCode('NC-', items.map((i) => i.code))))
    setAddOpen(true)
  }
  const saveDraft = () => {
    if (!draft || !draft.name.trim()) return
    addItem({ ...draft, name: draft.name.trim() })
    setAddOpen(false)
    setDraft(null)
    setExpanded((prev) => new Set(prev).add(draft.category))
  }

  // Где позиция используется в спецификациях — для предупреждения при удалении
  const specUsage = (code: string) =>
    services.filter((s) => s.items.some((e) => e.kind === 'material' && e.code === code))

  const setD = (patch: Partial<NomenclatureItem>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d))

  return (
    <div>
      <p className="note">
        {items.length} позиций · закупка в CAPEX (оборудование + запасы): €{fmt(capexEur)} ·
        landed cost = цена + max(доставка €/ед, цена × доставка %).
        Стартовый запас расходников на открытие правится на вкладке «Смета закупа». У CAPEX-позиций «Кол-во» само является закупкой на открытие.
      </p>
      <div className="controls" style={{ marginBottom: 10 }}>
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          data={[
            { label: `OPEX · ${opexItems}`, value: 'OPEX' },
            { label: `CAPEX · ${capexItems}`, value: 'CAPEX' },
            { label: `Спецификация · ${specItems}`, value: 'Спецификация' },
          ]}
        />
        <TextInput
          placeholder="Фильтр по наименованию, коду или статье OPEX…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={380}
          size="sm"
        />
        {filtering && (
          <span className="note">
            найдено: {groups.reduce((s, [, arr]) => s + arr.length, 0)}
          </span>
        )}
        <Button size="sm" variant="light" onClick={openAdd}>+ Позиция</Button>
      </div>
      <div className="table-wrap">
        <table className="month-table nom">
          <thead>
            <tr>
              <th className="sticky"><Hint hint={{ text: COL.code }}><span>Код</span></Hint></th>
              <th><Hint hint={{ text: COL.name }}><span>Наименование</span></Hint></th>
              <th><Hint hint={{ text: COL.type }}><span>Тип</span></Hint></th>
              <th><Hint hint={{ text: COL.unit }}><span>Ед.</span></Hint></th>
              <th><Hint hint={{ text: COL.price }}><span>Цена €</span></Hint></th>
              <th><Hint hint={{ text: COL.dfix }}><span>Дост. €/ед</span></Hint></th>
              <th><Hint hint={{ text: COL.dpct }}><span>Дост. %</span></Hint></th>
              <th><Hint hint={{ text: COL.landed }}><span>Landed €</span></Hint></th>
              {tab === 'CAPEX' ? (
                <th><Hint hint={{ text: COL.qty }}><span>Кол-во</span></Hint></th>
              ) : (
                <>
                  <th><Hint hint={{ text: COL.article }}><span>Статья OPEX</span></Hint></th>
                  <th><Hint hint={{ text: COL.norm }}><span>Норма</span></Hint></th>
                  <th><Hint hint={{ text: COL.base }}><span>База</span></Hint></th>
                </>
              )}
              <th><Hint hint={{ text: COL.use }}><span>Учёт</span></Hint></th><th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([cat, arr]) => {
              const open = filtering || expanded.has(cat)
              return [
                <tr
                  key={`cat-${cat}`}
                  className="section spec-head"
                  onClick={() => toggle(cat)}
                >
                  <td colSpan={tab === 'CAPEX' ? 11 : 13} className="sticky">
                    <span className="spec-caret">{open ? '▾' : '▸'}</span>
                    {cat} <small>· {arr.length} поз.</small>
                  </td>
                </tr>,
                ...(open
                  ? arr.map(({ item: it, index: i }) => (
                      <tr key={it.code}>
                        <td className="sticky">{it.code}</td>
                        <td className="lft">
                          <TextCell w={220} value={it.name} onChange={(v) => setItem(i, { name: v })} />
                        </td>
                        <td>
                          <Autocomplete
                            size="xs" w={92} data={types}
                            filter={({ options }) => options}
                            value={it.type} onChange={(v) => setItem(i, { type: v })}
                          />
                        </td>
                        <td>
                          <Autocomplete
                            size="xs" w={48} data={units}
                            filter={({ options }) => options}
                            value={it.unit} onChange={(v) => setItem(i, { unit: v || 'шт' })}
                          />
                        </td>
                        <td><NumField value={it.price} onChange={(v) => setItem(i, { price: v })} /></td>
                        <td><NumField value={it.deliveryFix} onChange={(v) => setItem(i, { deliveryFix: v })} /></td>
                        <td><NumField value={it.deliveryPct} onChange={(v) => setItem(i, { deliveryPct: v })} pct /></td>
                        <td><b>{fmt(landedCost(it), 2)}</b></td>
                        {tab === 'CAPEX' ? (
                          <td><NumField value={it.qty} onChange={(v) => setItem(i, { qty: v })} step={1} /></td>
                        ) : (
                          <>
                            <td className="lft">
                              <Autocomplete
                                size="xs" w={132} data={articles}
                                filter={({ options }) => options}
                                placeholder="—"
                                value={it.opexArticle ?? ''} onChange={(v) => setItem(i, { opexArticle: v || null })}
                              />
                            </td>
                            <td><NumField value={it.norm} onChange={(v) => setItem(i, { norm: v })} step={0.01} /></td>
                            <td>
                              <Select
                                size="xs" w={58}
                                data={it.use === 'Спецификация' ? ['слот', 'гость'] : ['слот', 'гость', 'мес']}
                                value={it.normBase} placeholder="—" clearable
                                onChange={(v) => setItem(i, { normBase: v as NomenclatureItem['normBase'] })}
                              />
                            </td>
                          </>
                        )}
                        <td>
                          <Select
                            size="xs" w={105}
                            data={['OPEX', 'CAPEX', 'Спецификация']}
                            value={it.use}
                            onChange={(v) => v && setItem(i, { use: v })}
                            allowDeselect={false}
                          />
                        </td>
                        <td>
                          <Hint hint={{ text: 'Удалить позицию из справочника' }}>
                            <span><ActionIcon size="sm" variant="subtle" color="red" onClick={() => setDeleteAsk(it)}>✕</ActionIcon></span>
                          </Hint>
                        </td>
                      </tr>
                    ))
                  : []),
              ]
            })}
          </tbody>
        </table>
      </div>

      <Modal
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        title="Новая позиция номенклатуры"
        size="lg"
        centered
      >
        {draft && (
          <div className="crud-form">
            <Group grow>
              <TextInput label="Код (авто)" value={draft.code} readOnly />
              <Autocomplete
                label="Категория" data={categories}
                filter={({ options }) => options}
                value={draft.category} onChange={(v) => setD({ category: v || 'Прочее' })}
              />
            </Group>
            <TextInput label="Наименование" required value={draft.name} onChange={(e) => setD({ name: e.currentTarget.value })} />
            <Group grow>
              <Select label="Тип" data={types} value={draft.type} onChange={(v) => v && setD({ type: v })} allowDeselect={false} />
              <Autocomplete label="Единица" data={units} filter={({ options }) => options} value={draft.unit} onChange={(v) => setD({ unit: v || 'шт' })} />
              <Select label="Учёт" data={['OPEX', 'CAPEX', 'Спецификация']} value={draft.use} onChange={(v) => v && setD({ use: v })} allowDeselect={false} />
            </Group>
            <Group grow>
              <NumberInput label="Цена €" value={draft.price} min={0} decimalScale={2} onChange={(v) => setD({ price: Number(v) || 0 })} />
              <NumberInput label="Доставка €/ед" value={draft.deliveryFix} min={0} decimalScale={2} onChange={(v) => setD({ deliveryFix: Number(v) || 0 })} />
              <NumberInput label="Доставка %" value={draft.deliveryPct * 100} min={0} suffix="%" decimalScale={1} onChange={(v) => setD({ deliveryPct: (Number(v) || 0) / 100 })} />
            </Group>
            <Group grow>
              <Autocomplete label="Статья OPEX" data={articles} filter={({ options }) => options} disabled={draft.use === 'CAPEX'} value={draft.opexArticle ?? ''} onChange={(v) => setD({ opexArticle: v || null })} />
              <NumberInput label="Норма расхода" value={draft.norm} min={0} decimalScale={3} disabled={draft.use === 'CAPEX'} onChange={(v) => setD({ norm: Number(v) || 0 })} />
              <Select label="База нормы" data={draft.use === 'Спецификация' ? ['слот', 'гость'] : ['слот', 'гость', 'мес']} value={draft.normBase} disabled={draft.use === 'CAPEX'} onChange={(v) => setD({ normBase: (v as NomenclatureItem['normBase']) ?? null })} />
            </Group>
            <Group grow>
              <NumberInput label="Кол-во (CAPEX)" value={draft.qty} min={0} disabled={draft.use !== 'CAPEX'} onChange={(v) => setD({ qty: Number(v) || 0 })} />
              <TextInput label="Примечание" value={draft.note ?? ''} onChange={(e) => setD({ note: e.currentTarget.value || null })} />
            </Group>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setAddOpen(false)}>Отмена</Button>
              <Button onClick={saveDraft} disabled={!draft.name.trim()}>Добавить</Button>
            </Group>
          </div>
        )}
      </Modal>

      <Modal
        opened={!!deleteAsk}
        onClose={() => setDeleteAsk(null)}
        title="Удалить позицию?"
        size="sm"
        centered
      >
        {deleteAsk && (
          <div>
            <p>
              «{deleteAsk.name}» ({deleteAsk.code}) будет удалена из справочника.
            </p>
            {specUsage(deleteAsk.code).length > 0 && (
              <p className="note">
                ⚠ Используется в спецификациях: {specUsage(deleteAsk.code).map((s) => s.name).join(', ')}.
                Себестоимость этих услуг пересчитается без этой позиции.
              </p>
            )}
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setDeleteAsk(null)}>Отмена</Button>
              <Button color="red" onClick={() => { removeItem(deleteAsk.code); setDeleteAsk(null) }}>Удалить</Button>
            </Group>
          </div>
        )}
      </Modal>
    </div>
  )
}
