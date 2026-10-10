import { Fragment } from 'react'
import { useModel } from '../store'
import { Hint, NumField, fmtPct } from '../components/ui'
import { YEAR_KEYS } from '../model/types'

// Редактор матрицы сценариев — лист «Сценарии» в виде формы.
// Два блока (Загрузка / Экономика) размещены горизонтально, чтобы не растягивать таблицу.
export function Scenarios() {
  const { matrix, setMatrixCell, scenario, params } = useModel()
  const packageMode = params.meta.mode === 'Да'

  const Row = ({ label, path, pct, locked, hint }: { label: string; path: string; pct?: boolean; locked?: boolean; hint?: string }) => {
    const vals = path.split('.').reduce((o: any, k) => o[k], matrix as any) as number[]
    return (
      <tr>
        <td className="sticky">{hint ? <Hint hint={{ text: hint }}><span>{label}</span></Hint> : label}</td>
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
              {([
                ['ЗАГРУЗКА БАНЬ', 'baths', 'Бани', true],
                ['ПАРЕНИЯ', 'steam', 'Парения', true],
                ['МАССАЖ', 'massage', 'Массаж', true],
                ['ДОП. УСЛУГИ', 'extra', 'Допы', true],
                ['ГЛЭМПИНГ', 'glamping', 'Глэмпинг', true],
                ['МЕСЯЧНЫЕ ЧЛЕНСТВА, чел', 'membersMonth', 'Членов', false],
              ] as const).map(([title, key, label, pct]) => (
                <Fragment key={key}>
                  <tr className="section"><td className="sticky" colSpan={4}>{title}</td></tr>
                  {YEAR_KEYS.map((y, i) => (
                    <Row key={y} label={`${label} — Год ${i + 1}`} path={`${key}.${y}`} pct={pct}
                      hint={pct
                        ? `Среднегодовая загрузка потока в год ${i + 1} — доля максимальной ёмкости.`
                        : `Число активных месячных членов в год ${i + 1}, в человеках.`
                      }
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table className="month-table scen">
            <Head />
            <tbody>
              <tr className="section"><td className="sticky" colSpan={4}>ЭКОНОМИКА</td></tr>
              <Row label="Рост цен, годовой" path="priceGrowth" pct
                hint="Годовая индексация всех прайсов сверх инфляции — реальный рост цен." />
              <Row label="Корректировка CAPEX" path="capexAdj" pct
                hint="Буфер к стоимости стройки и закупа — сценарное удорожание CAPEX целиком." />
              <Row label="Период выхода на план, мес." path="rampMonths"
                hint="Месяцев от открытия до выхода загрузки на сценарный уровень (линейная рампа)." />
              <Row
                label={packageMode ? 'Доля реализации услуг (=100% в пакетном режиме)' : 'Доля реализации услуг (непакетная)'}
                path="uptake" pct locked={packageMode}
                hint="Доля гостей, реально покупающих услуги. В пакетном режиме депозит обязателен — uptake зафиксирован на 100%."
              />
              <tr className="section"><td className="sticky" colSpan={4}>СТРЕССЫ СТРОЙКИ И ЗАТРАТ</td></tr>
              <Row label="Задержка стройки, мес." path="constructionDelayMonths"
                hint="Сдвигает дату открытия и удлиняет стройку: +N мес CAPEX-графика, аренды земли и pre-opening до первой выручки." />
              <Row label="Множитель энергозатрат" path="energyCostMult"
                hint="Масштабирует электроэнергию и отопление — стресс тарифов или потребления." />
            </tbody>
          </table>
        </div>
      </div>
      <p className="note">
        Все потоки заданы явно по пяти годам — интерполяций и унаследованных
        коэффициентов нет. Векторы услуг — множители доли реализации: в пакетном
        режиме услуга включена в слот (uptake = 100%, ручка заблокирована), но
        реально ей пользуется доля гостей = загрузка услуги; в непакетном режиме
        дополнительно умножается на «Долю реализации услуг».
        Задержка стройки сдвигает открытие и удлиняет стройку (CAPEX растягивается,
        аренда земли и pre-opening — дольше); множитель энергозатрат масштабирует
        электроэнергию и отопление.
        Текущий сценарий «{scenario}»: рост цен {fmtPct(matrix.priceGrowth[matrix.names.indexOf(scenario)])},
        буфер CAPEX {fmtPct(matrix.capexAdj[matrix.names.indexOf(scenario)])},
        задержка {matrix.constructionDelayMonths[matrix.names.indexOf(scenario)]} мес.
      </p>
    </div>
  )
}
