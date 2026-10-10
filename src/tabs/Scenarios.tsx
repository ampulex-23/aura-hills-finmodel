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
        Активный сценарий выбирается в шапке — сейчас «{scenario}». Векторы заданы на пять операционных
        лет (2028–2032); шестой год горизонта (2033) повторяет год 5, индексация цен и инфляция продолжают расти.
        Состав объектов очереди 2 — не сценарный параметр: он задаётся тоглами в Допущениях и един для всех сценариев.
      </p>
      <div className="cols-2">
        <div className="table-wrap">
          <table className="month-table scen">
            <Head />
            <tbody>
              {([
                ['ЗАГРУЗКА БАНЬ', 'baths', 'Бани', true,
                  'Доля проданных слотов всех активных модулей (оч. 1 и VIP оч. 2) до сезонности и рампы. Умножается на сезонность месяца и обрезается по 100%.'],
                ['ПАРЕНИЯ', 'steam', 'Парения', true,
                  'Доля гостей слотов, берущих парение (множитель к uptake). Распределяется по меню из 4 позиций по весам; к потоку добавляется сервисный чек членов и посетителей общ. бани.'],
                ['МАССАЖ', 'massage', 'Массаж', true,
                  'Доля гостей слотов, берущих массаж (множитель к uptake). Меню из 8 позиций по весам.'],
                ['ДОП. УСЛУГИ', 'extra', 'Допы', true,
                  'Доля гостей, тратящих кошелёк допов (20% депозита) на купели, чаны, ванны и настилы — 7 позиций по весам.'],
                ['ГЛЭМПИНГ', 'glamping', 'Глэмпинг', true,
                  'Загрузка ночей трёх юнитов до летней сезонности и рампы; 30% ночей идёт через OTA с комиссией.'],
                ['ОБЩЕСТВЕННАЯ БАНЯ (ОЧ. 2)', 'publicBath', 'Билеты', true,
                  'Доля пропускной ёмкости общественной бани (40 чел/день, визит ≈ весь день 9–23). Поток с даты ввода очереди 2; до неё вектор не влияет.'],
                ['РЕСТОРАН (ОЧ. 2)', 'restaurant', 'Посадки', true,
                  'Доля занятости ресторана: % от мест × оборотов посадки в день. Плейсхолдер-поток с даты ввода общественной бани.'],
                ['МЕСЯЧНЫЕ ЧЛЕНСТВА, чел', 'membersMonth', 'Членов', false,
                  'Число активных месячных членов клуба по годам (×€200). Их визиты занимают ёмкость (2 визита × 2 гостя) и несут сервисный чек. Год 1 продаётся пресейлом без рампы.'],
              ] as const).map(([title, key, label, pct, sectHint]) => (
                <Fragment key={key}>
                  <tr className="section"><td className="sticky" colSpan={4}>
                    {sectHint ? <Hint hint={{ text: sectHint }}><span>{title}</span></Hint> : title}
                  </td></tr>
                  {YEAR_KEYS.map((y, i) => (
                    <Row key={y} label={`${label} — Год ${i + 1}`} path={`${key}.${y}`} pct={pct}
                      hint={sectHint ?? (pct
                        ? `Среднегодовая загрузка потока в год ${i + 1} — доля максимальной ёмкости.`
                        : `Число активных месячных членов в год ${i + 1}, в человеках.`)
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
                hint="Буфер к стоимости стройки оч. 1 (смета, наполнение, закуп, IT, земля) — сценарное удорожание. У очереди 2 свой буфер в Допущениях (phase2.capexAdj)." />
              <Row label="Период выхода на план, мес." path="rampMonths"
                hint="Месяцев от открытия оч. 1 до выхода загрузки на сценарный уровень (линейная рампа). Очередь 2 раскачивается своей рампой от даты ввода (Допущения → Очередь 2)." />
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
        коэффициентов нет; год 6 = год 5. Загрузки общественной бани и ресторана действуют
        только с ввода очереди 2 (2031) — до этого потоки нулевые при любых значениях. Векторы услуг — множители доли реализации: в пакетном
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
