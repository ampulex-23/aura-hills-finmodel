import { useMemo, useState } from 'react'
import { Checkbox, SegmentedControl, TextInput } from '@mantine/core'
import { useModel } from '../store'
import { Hint, NumField, fmt } from '../components/ui'
import { landedCost, nomenclatureStockEur } from '../model/opex'

const COL = {
  code: 'Уникальный код позиции из справочника номенклатуры.',
  name: 'Наименование позиции — правится в Номенклатуре.',
  unit: 'Единица измерения — справочно.',
  qty: 'Стартовый запас на открытие: landed × кол-во уходит разово в CAPEX («Закуп: стартовые запасы»). Дальше запас пополняется нормой OPEX.',
  qty2: 'Стартовый запас под очередь 2: вторая партия закупа к вводу объектов оч. 2 — уходит в их CAPEX-отток окна 2029–2030 («Закуп: стартовые запасы очереди 2»).',
  landed: 'Полная себестоимость единицы: цена + max(дост. €/ед, цена × дост. %). Правится в Номенклатуре.',
  eur: 'Сумма закупа в евро: кол-во × landed.',
}

// Смета закупа: стартовые запасы расходников на открытие (initialQty
// OPEX/Спецификация-позиций). Оборудование и мебель — «Наполнение» в смете
// стройки; цены и доставка правятся в Номенклатуре.
export function Zakup() {
  const { items, setItem } = useModel()
  const [q, setQ] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [phaseTab, setPhaseTab] = useState<string>('all')
  const q1Cols = phaseTab !== '2'
  const q2Cols = phaseTab !== '1'

  const stockEur = nomenclatureStockEur(items)
  const stock2Eur = items.reduce((s, i) => s + landedCost(i) * (i.initialQtyP2 ?? 0), 0)
  const stockCount = items.filter((i) => i.use !== 'CAPEX' && (i.initialQty ?? 0) > 0).length

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase()
    const filtered = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.use !== 'CAPEX')
      // Позиции с ownPrice — «цикл стирки» (NC-159/210): не складируемый
      // материал, списывается в спеках. Стартовый запас им не нужен.
      .filter(({ item }) => item.ownPrice == null)
      .filter(({ item }) => showAll || (item.initialQty ?? 0) > 0)
      .filter(({ item }) =>
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.code.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query),
      )
    const map = new Map<string, { item: (typeof items)[number]; index: number }[]>()
    for (const f of filtered) {
      const arr = map.get(f.item.category) ?? []
      arr.push(f)
      map.set(f.item.category, arr)
    }
    return [...map.entries()]
  }, [items, q, showAll])

  const toggle = (cat: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })

  const filtering = q.trim().length > 0

  return (
    <div>
      <p className="note">
        {stockCount} позиций с запасом · закуп на открытие: <b>€{fmt(stockEur)}</b> — идёт в CAPEX строкой «Закуп: стартовые запасы»
        {stock2Eur > 0 && <> · закуп оч. 2: <b>€{fmt(stock2Eur)}</b> — в отток окна стройки 2029–2030</>}.
        Оборудование и мебель — «Наполнение» в смете стройки; цены и доставка правятся в Номенклатуре.
      </p>
      <div className="controls" style={{ marginBottom: 10 }}>
        <SegmentedControl
          size="sm"
          value={phaseTab}
          onChange={setPhaseTab}
          data={[
            { value: '1', label: `Очередь 1 · €${fmt(stockEur)}` },
            { value: '2', label: `Очередь 2 · €${fmt(stock2Eur)}` },
            { value: 'all', label: 'Обе очереди' },
          ]}
        />
        <TextInput
          placeholder="Фильтр по наименованию, коду или категории…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={360}
          size="sm"
        />
        <Hint hint={{ text: 'Показывает все позиции каталога, включая те, у которых запас сейчас 0 — задайте количество, чтобы добавить позицию в закуп.' }}>
          <span>
            <Checkbox
              label="показать все позиции (чтобы добавить запас)"
              checked={showAll}
              onChange={(e) => setShowAll(e.currentTarget.checked)}
            />
          </span>
        </Hint>
        {filtering && (
          <span className="note">
            найдено: {groups.reduce((s, [, arr]) => s + arr.length, 0)}
          </span>
        )}
      </div>
      <div className="table-wrap">
        <table className="month-table nom">
          <thead>
            <tr>
              <th className="sticky"><Hint hint={{ text: COL.code }}><span>Код</span></Hint></th>
              <th><Hint hint={{ text: COL.name }}><span>Наименование</span></Hint></th>
              <th><Hint hint={{ text: COL.unit }}><span>Ед.</span></Hint></th>
              {q1Cols && <th><Hint hint={{ text: COL.qty }}><span>Закуп оч. 1</span></Hint></th>}
              {q2Cols && <th><Hint hint={{ text: COL.qty2 }}><span>Закуп оч. 2</span></Hint></th>}
              <th><Hint hint={{ text: COL.landed }}><span>Landed €</span></Hint></th>
              {q1Cols && <th><Hint hint={{ text: COL.eur }}><span>Сумма оч.1 €</span></Hint></th>}
              {q2Cols && <th><Hint hint={{ text: COL.eur }}><span>Сумма оч.2 €</span></Hint></th>}
            </tr>
          </thead>
          <tbody>
            {groups.map(([cat, arr]) => {
              const open = filtering || expanded.has(cat)
              const catSum = arr.reduce((s, { item }) => s + landedCost(item) * (item.initialQty ?? 0), 0)
              const catSum2 = arr.reduce((s, { item }) => s + landedCost(item) * (item.initialQtyP2 ?? 0), 0)
              return [
                <tr
                  key={`cat-${cat}`}
                  className="section spec-head"
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggle(cat)}
                >
                  <td colSpan={3} className="sticky">
                    <span className="spec-caret">{open ? '▾' : '▸'}</span>
                    {cat} <small>· {arr.length} поз.</small>
                  </td>
                  {q1Cols && <td></td>}
                  {q2Cols && <td></td>}
                  <td></td>
                  {q1Cols && <td><b>{fmt(catSum)}</b></td>}
                  {q2Cols && <td><b>{fmt(catSum2)}</b></td>}
                </tr>,
                ...(open
                  ? arr.map(({ item: it, index: i }) => (
                      <tr key={it.code} className={(it.initialQty ?? 0) === 0 ? 'row-muted' : undefined}>
                        <td className="sticky">{it.code}</td>
                        <td className="lft">{it.name}</td>
                        <td>{it.unit}</td>
                        {q1Cols && <td><NumField value={it.initialQty ?? 0} onChange={(v) => setItem(i, { initialQty: v })} step={1} /></td>}
                        {q2Cols && <td><NumField value={it.initialQtyP2 ?? 0} onChange={(v) => setItem(i, { initialQtyP2: v || undefined })} step={1} /></td>}
                        <td>{fmt(landedCost(it), 2)}</td>
                        {q1Cols && <td><b>{fmt(landedCost(it) * (it.initialQty ?? 0))}</b></td>}
                        {q2Cols && <td><b>{fmt(landedCost(it) * (it.initialQtyP2 ?? 0))}</b></td>}
                      </tr>
                    ))
                  : []),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
