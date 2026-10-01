import { useModel } from '../store'
import { NumField, fmtPct } from '../components/ui'

// Редактор матрицы сценариев — лист «Сценарии» в виде формы.
// Два блока (Загрузка / Экономика) размещены горизонтально, чтобы не растягивать таблицу.
export function Scenarios() {
  const { matrix, setMatrixCell, scenario, params } = useModel()
  const packageMode = params.meta.mode === 'Да'

  const Row = ({ label, path, pct, locked }: { label: string; path: string; pct?: boolean; locked?: boolean }) => {
    const vals = path.split('.').reduce((o: any, k) => o[k], matrix as any) as number[]
    return (
      <tr>
        <td className="sticky">{label}</td>
        {vals.map((v, i) => (
          <td key={i}>
            <NumField
              value={locked ? 1 : v}
              onChange={(nv) => setMatrixCell(path, i, nv)}
              pct={pct} step={pct ? 1 : 0.05}
              disabled={locked}
            />
          </td>
        ))}
      </tr>
    )
  }

  const Head = () => (
    <thead>
      <tr><th className="sticky">Параметр</th>{matrix.names.map((n) => <th key={n}>{n}</th>)}</tr>
    </thead>
  )

  return (
    <div>
      <p className="note">
        Активный сценарий выбирается в шапке — сейчас «{scenario}».
      </p>
      <div className="cols-2">
        <div className="table-wrap">
          <table className="month-table scen">
            <Head />
            <tbody>
              <tr className="section"><td className="sticky" colSpan={4}>ЗАГРУЗКА БАНЬ</td></tr>
              {(['y1','y2','y3','y4','y5'] as const).map((y, i) => (
                <Row key={y} label={`Бани — Год ${i + 1}`} path={`baths.${y}`} pct />
              ))}
              <Row label="Парения — Год 1" path="steam.y1" pct />
              <Row label="Парения — Год 3+" path="steam.y3" pct />
              <Row label="Массаж — Год 1" path="massage.y1" pct />
              <Row label="Массаж — Год 3+" path="massage.y3" pct />
              <Row label="Глэмпинг — Год 1" path="glamping.y1" pct />
              <Row label="Глэмпинг — Год 3+" path="glamping.y3" pct />
              <Row label="Месячные членства — Год 1" path="membersMonth.y1" />
              <Row label="Месячные членства — Год 3+" path="membersMonth.y3" />
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table className="month-table scen">
            <Head />
            <tbody>
              <tr className="section"><td className="sticky" colSpan={4}>ЭКОНОМИКА</td></tr>
              <Row label="Рост цен, годовой" path="priceGrowth" pct />
              <Row label="Корректировка CAPEX" path="capexAdj" pct />
              <Row label="Период выхода на план, мес." path="rampMonths" />
              <Row
                label={packageMode ? 'Доля реализации услуг (=100% в пакетном режиме)' : 'Доля реализации услуг (непакетная)'}
                path="uptake" pct locked={packageMode}
              />
            </tbody>
          </table>
        </div>
      </div>
      <p className="note">
        Промежуточные годы интерполируются: y2 = y1 + (y3 − y1) × 20/35 (банные услуги),
        × 15/25 (глэмпинг), × 30/70 с округлением (членства). Доп.услуги = парения − 25 п.п.
        Текущий сценарий «{scenario}»: рост цен {fmtPct(matrix.priceGrowth[matrix.names.indexOf(scenario)])},
        буфер CAPEX {fmtPct(matrix.capexAdj[matrix.names.indexOf(scenario)])}.
      </p>
    </div>
  )
}
