import { useModel } from '../store'
import { NumField, fmt } from '../components/ui'
import { landedCost } from '../model/opex'

// Справочник номенклатуры — редактируемый грид (лист «Номенклатура»).
export function Nomenclature() {
  const { items, setItem } = useModel()
  const opexItems = items.filter((i) => i.use === 'OPEX').length
  const capexEur = items
    .filter((i) => i.use === 'CAPEX')
    .reduce((s, i) => s + landedCost(i) * i.qty, 0)

  return (
    <div>
      <p className="note">
        {items.length} позиций · OPEX: {opexItems} · наполнение CAPEX: €{fmt(capexEur)} ·
        landed cost = цена + max(доставка €/ед, цена × доставка %)
      </p>
      <div className="table-wrap">
        <table className="month-table nom">
          <thead>
            <tr>
              <th className="sticky">Код</th><th>Наименование</th><th>Категория</th><th>Тип</th>
              <th>Ед.</th><th>Цена €</th><th>Дост. €/ед</th><th>Дост. %</th><th>Landed €</th>
              <th>Учёт</th><th>Статья OPEX</th><th>Норма</th><th>База</th><th>Кол-во CAPEX</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.code}>
                <td className="sticky">{it.code}</td>
                <td className="lft">{it.name}</td>
                <td className="lft">{it.category}</td>
                <td>{it.type}</td>
                <td>{it.unit}</td>
                <td><NumField value={it.price} onChange={(v) => setItem(i, { price: v })} /></td>
                <td><NumField value={it.deliveryFix} onChange={(v) => setItem(i, { deliveryFix: v })} /></td>
                <td><NumField value={it.deliveryPct} onChange={(v) => setItem(i, { deliveryPct: v })} pct /></td>
                <td><b>{fmt(landedCost(it), 2)}</b></td>
                <td>
                  <select value={it.use} onChange={(e) => setItem(i, { use: e.target.value })}>
                    <option>OPEX</option><option>CAPEX</option><option>Спецификация</option>
                  </select>
                </td>
                <td className="lft">{it.opexArticle ?? '—'}</td>
                <td><NumField value={it.norm} onChange={(v) => setItem(i, { norm: v })} step={0.01} /></td>
                <td>{it.normBase ?? '—'}</td>
                <td><NumField value={it.qty} onChange={(v) => setItem(i, { qty: v })} step={1} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
