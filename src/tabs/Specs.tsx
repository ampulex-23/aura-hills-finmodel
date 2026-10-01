import { Fragment, useMemo, useState } from 'react'
import { Badge } from '@mantine/core'
import { useModel } from '../store'
import { NumField, fmt } from '../components/ui'
import { costAllServices } from '../model/spec'
import { landedCost } from '../model/opex'

// Спецификации услуг: себестоимость = материалы (номенклатура) + труд (ставки-заглушки).
export function Specs() {
  const { items, services, labor, setServicePrice, setSpecQty, setLaborRate } = useModel()
  const byCode = useMemo(() => new Map(items.map((i) => [i.code, i])), [items])
  const costs = useMemo(() => costAllServices(services, items, labor), [services, items, labor])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })

  const directions = [...new Set(services.map((s) => s.direction))]

  return (
    <div>
      <h3>Ставки труда (заглушки до листа ФОТ)</h3>
      <div className="table-wrap">
        <table className="month-table spec">
          <thead>
            <tr><th className="sticky">Роль</th><th className="lft">€/час с взносами</th><th className="lft">Комментарий</th></tr>
          </thead>
          <tbody>
            {labor.map((l) => (
              <tr key={l.role}>
                <td className="sticky">{l.role}</td>
                <td><NumField value={l.rateHour} onChange={(v) => setLaborRate(l.role, v)} step={0.5} /></td>
                <td className="lft"><small>{l.note}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {directions.map((dir) => (
        <div key={dir}>
          <h3>{dir}</h3>
          <div className="table-wrap">
            <table className="month-table spec">
              <thead>
                <tr>
                  <th className="sticky">Услуга</th>
                  <th className="lft">Цена €</th><th>Материалы €</th><th>Труд €</th>
                  <th>Себес €</th><th>Маржа €</th><th>Марж. %</th>
                </tr>
              </thead>
              <tbody>
                {costs.filter((c) => c.spec.direction === dir).map((c) => (
                  <Fragment key={c.spec.code}>
                    <tr className="spec-head" onClick={() => toggle(c.spec.code)}>
                      <td className="sticky">
                        <span className="spec-caret">{expanded.has(c.spec.code) ? '▾' : '▸'}</span>
                        {c.spec.name}
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
                      </tr>
                    ))}
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
    </div>
  )
}
