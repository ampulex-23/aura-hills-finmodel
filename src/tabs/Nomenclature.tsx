import { useMemo, useState } from 'react'
import { Select, TextInput } from '@mantine/core'
import { useModel } from '../store'
import { NumField, fmt } from '../components/ui'
import { landedCost } from '../model/opex'

// Справочник номенклатуры — редактируемый грид, сгруппированный по категориям.
export function Nomenclature() {
  const { items, setItem } = useModel()
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const opexItems = items.filter((i) => i.use === 'OPEX').length
  const specItems = items.filter((i) => i.use === 'Спецификация').length
  const capexEur = items
    .filter((i) => i.use === 'CAPEX')
    .reduce((s, i) => s + landedCost(i) * i.qty, 0)

  // {item, index} — index нужен для setItem (позиционное обновление в store)
  const groups = useMemo(() => {
    const query = q.trim().toLowerCase()
    const filtered = items
      .map((item, index) => ({ item, index }))
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
  }, [items, q])

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
        {items.length} позиций · OPEX: {opexItems} · Спецификация: {specItems} · наполнение CAPEX: €{fmt(capexEur)} ·
        landed cost = цена + max(доставка €/ед, цена × доставка %)
      </p>
      <div className="controls" style={{ marginBottom: 10 }}>
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
      </div>
      <div className="table-wrap">
        <table className="month-table nom">
          <thead>
            <tr>
              <th className="sticky">Код</th><th>Наименование</th><th>Тип</th>
              <th>Ед.</th><th>Цена €</th><th>Дост. €/ед</th><th>Дост. %</th><th>Landed €</th>
              <th>Учёт</th><th>Статья OPEX</th><th>Норма</th><th>База</th><th>Кол-во CAPEX</th>
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
                  <td colSpan={13} className="sticky">
                    <span className="spec-caret">{open ? '▾' : '▸'}</span>
                    {cat} <small>· {arr.length} поз.</small>
                  </td>
                </tr>,
                ...(open
                  ? arr.map(({ item: it, index: i }) => (
                      <tr key={it.code}>
                        <td className="sticky">{it.code}</td>
                        <td className="lft">{it.name}</td>
                        <td>{it.type}</td>
                        <td>{it.unit}</td>
                        <td><NumField value={it.price} onChange={(v) => setItem(i, { price: v })} /></td>
                        <td><NumField value={it.deliveryFix} onChange={(v) => setItem(i, { deliveryFix: v })} /></td>
                        <td><NumField value={it.deliveryPct} onChange={(v) => setItem(i, { deliveryPct: v })} pct /></td>
                        <td><b>{fmt(landedCost(it), 2)}</b></td>
                        <td>
                          <Select
                            size="xs" w={120}
                            data={['OPEX', 'CAPEX', 'Спецификация']}
                            value={it.use}
                            onChange={(v) => v && setItem(i, { use: v })}
                            allowDeselect={false}
                          />
                        </td>
                        <td className="lft">{it.opexArticle ?? '—'}</td>
                        <td><NumField value={it.norm} onChange={(v) => setItem(i, { norm: v })} step={0.01} /></td>
                        <td>{it.normBase ?? '—'}</td>
                        <td><NumField value={it.qty} onChange={(v) => setItem(i, { qty: v })} step={1} /></td>
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
