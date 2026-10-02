import { Select, SegmentedControl } from '@mantine/core'
import { useModel } from '../store'
import { NumField, TextCell, fmt } from '../components/ui'

// Форма «Допущения» — все входы модели, сгруппированные.
export function Assumptions() {
  const { params, setParam } = useModel()
  const P = params

  const Row = ({ label, path, value, pct, step, suffix }: any) => (
    <label className="field">
      <span>{label}</span>
      <NumField value={value} onChange={(v) => setParam(path, v)} pct={pct} step={step} suffix={suffix} />
    </label>
  )

  return (
    <div className="form-grid">
      <fieldset>
        <legend>Режимы</legend>
        <label className="field">
          <span>Пакетный режим (депозит)</span>
          <SegmentedControl
            size="xs"
            data={['Да', 'Нет']}
            value={P.meta.mode}
            onChange={(v) => setParam('meta.mode', v)}
          />
        </label>
        <label className="field">
          <span>Режим НДС</span>
          <Select
            size="xs" w={150}
            data={['Гросс', 'С возмещением']}
            value={P.meta.vatMode}
            onChange={(v) => v && setParam('meta.vatMode', v)}
            allowDeselect={false}
          />
        </label>
        <Row label="Мультипликатор спроса" path="service.demandMult" value={P.service.demandMult} step={0.05} />
      </fieldset>

      <fieldset>
        <legend>Общие</legend>
        <Row label="Курс RUB/EUR" path="general.rubEurRate" value={P.general.rubEurRate} />
        <Row label="Инфляция" path="general.inflation" value={P.general.inflation} pct />
        <Row label="WACC" path="general.wacc" value={P.general.wacc} pct />
      </fieldset>

      <fieldset>
        <legend>Налоги и взносы</legend>
        <Row label="CIT" path="taxes.cit" value={P.taxes.cit} pct />
        <Row label="НДС стандартный" path="taxes.vatStd" value={P.taxes.vatStd} pct />
        <Row label="НДС глэмпинг" path="taxes.vatGlamp" value={P.taxes.vatGlamp} pct />
        <Row label="НДС F&B" path="taxes.vatFb" value={P.taxes.vatFb} pct />
        <Row label="НДС входной" path="taxes.vatInput" value={P.taxes.vatInput} pct />
        <Row label="Взносы работодателя" path="taxes.employerRate" value={P.taxes.employerRate} pct />
        <Row label="SDC (Defence Tax)" path="taxes.sdc" value={P.taxes.sdc} pct />
      </fieldset>

      <fieldset>
        <legend>Цены</legend>
        <Row label="Месячное членство, €" path="prices.membershipMonth" value={P.prices.membershipMonth} />
        <Row label="Годовое членство, €" path="prices.membershipYear" value={P.prices.membershipYear} />
        <Row label="Сертификат, €" path="prices.certificate" value={P.prices.certificate} />
        <Row label="F&B на гостя, €" path="prices.fbPerGuest" value={P.prices.fbPerGuest} />
        <Row label="Глэмпинг малый, €/ночь" path="prices.glampSmall" value={P.prices.glampSmall} />
        <Row label="Глэмпинг большой, €/ночь" path="prices.glampBig" value={P.prices.glampBig} />
      </fieldset>

      <fieldset>
        <legend>Депозит и кошелёк услуг</legend>
        <Row label="Депозит на гостя, €" path="deposit.base" value={P.deposit.base} />
        <Row label="База парения, €" path="deposit.steamBase" value={P.deposit.steamBase} />
        <Row label="База массажа, €" path="deposit.massageBase" value={P.deposit.massageBase} />
        <Row label="Доля кошелька на доп.услуги" path="service.walletExtraShare" value={P.service.walletExtraShare} pct />
        <Row label="Доля апгрейдов сверх депозита" path="service.upgradeShare" value={P.service.upgradeShare} pct />
      </fieldset>

      <fieldset>
        <legend>Мощности и объёмы</legend>
        <Row label="Глэмпинг малых" path="units.glampSmall" value={P.units.glampSmall} step={1} />
        <Row label="Глэмпинг больших" path="units.glampBig" value={P.units.glampBig} step={1} />
        <Row label="Сертификатов/мес" path="units.certsPerMonth" value={P.units.certsPerMonth} step={1} />
        <Row label="Пре-сейл, мес до открытия" path="units.presaleMonths" value={P.units.presaleMonths} step={1} />
        <label className="field">
          <span>Режим пре-сейла</span>
          <Select
            size="xs" w={210}
            data={[
              { value: 'deferred', label: 'Предоплата (без двойного счёта)' },
              { value: 'incremental', label: 'Доп. канал сверх плана' },
            ]}
            value={P.units.presaleMode}
            onChange={(v) => v && setParam('units.presaleMode', v)}
            allowDeselect={false}
          />
        </label>
        <Row
          label="Признание пре-сейла, мес" path="units.presaleRecognizeMonths"
          value={P.units.presaleRecognizeMonths} step={1}
        />
      </fieldset>

      <fieldset>
        <legend>Амортизация (доля / срок, лет)</legend>
        {P.amort.groups.map((g, i) => (
          <div className="field pair" key={g}>
            <span>{g}</span>
            <NumField value={P.amort.shares[i]} onChange={(v) => setParam(`amort.shares.${i}`, v)} pct />
            <NumField value={P.amort.years[i]} onChange={(v) => setParam(`amort.years.${i}`, v)} step={1} />
          </div>
        ))}
      </fieldset>

      <fieldset className="wide">
        <legend>Модули бань</legend>
        <div className="table-wrap">
          <table className="month-table spec">
            <thead>
              <tr>
                <th>Модуль</th><th>Статус</th><th>Ввод с</th><th>Uptime</th>
                <th>Слотов/д</th><th>Мест</th><th>Коэфф. загр.</th>
                <th>Утро €</th><th>День 1 €</th><th>День 2 €</th><th>Вечер €</th>
                <th>Ср.-взв. €</th>
              </tr>
            </thead>
            <tbody>
              {P.modules.map((m, i) => {
                const avg = m.prices.reduce((s, p, j) => s + p * P.slotMix[j], 0)
                return (
                  <tr key={m.id}>
                    <td className="lft"><b>№{m.id}</b> <small>({m.capacity} гостей)</small></td>
                    <td>
                      <SegmentedControl
                        size="xs"
                        data={['Активен', 'В резерве']}
                        value={m.status}
                        onChange={(v) => setParam(`modules.${i}.status`, v)}
                      />
                    </td>
                    <td>
                      <TextCell w={84} value={m.launchDate.slice(0, 7)} placeholder="ГГГГ-ММ"
                        onChange={(v) => setParam(`modules.${i}.launchDate`, `${v}-01`)} />
                    </td>
                    <td><NumField value={m.uptime} onChange={(v) => setParam(`modules.${i}.uptime`, v)} pct step={0.01} /></td>
                    <td><NumField value={m.slotsPerDay} onChange={(v) => setParam(`modules.${i}.slotsPerDay`, v)} step={1} /></td>
                    <td><NumField value={m.capacity} onChange={(v) => setParam(`modules.${i}.capacity`, v)} step={1} /></td>
                    <td><NumField value={m.loadK} onChange={(v) => setParam(`modules.${i}.loadK`, v)} pct step={0.05} /></td>
                    {m.prices.map((p, j) => (
                      <td key={j}>
                        <NumField value={p} onChange={(v) => setParam(`modules.${i}.prices.${j}`, v)} step={25} />
                      </td>
                    ))}
                    <td><b>{fmt(avg)}</b></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="controls" style={{ marginTop: 8 }}>
          <small className="note" style={{ marginRight: 8 }}>Доли спроса по слотам:</small>
          {P.slotNames.map((n, j) => (
            <label key={j} className="field" style={{ gap: 4 }}>
              <small className="note">{n.replace('Доля спроса — ', '')}</small>
              <NumField value={P.slotMix[j]} onChange={(v) => setParam(`slotMix.${j}`, v)} pct step={0.01} />
            </label>
          ))}
          <small className="note" style={{ color: Math.abs(P.slotMix.reduce((s, v) => s + v, 0) - 1) < 0.001 ? '#9fd3b4' : '#e07a7a' }}>
            Σ = {(P.slotMix.reduce((s, v) => s + v, 0) * 100).toFixed(0)}%
          </small>
        </div>
        <p className="note" style={{ marginTop: 6 }}>
          Эфф. слотов/мес = 30 × слотов/день × uptime × коэфф. загр. модуля × загрузка сценария.
          «Коэфф. загр.» — помодульный множитель заполняемости (1.0 = общая загрузка; опустите крупный модуль до 0.8–0.9, если он продаётся хуже).
          Доля доп.услуг задаётся сценарно (uptake) + глобально долей кошелька — помодульного % не было и в Excel.
        </p>
      </fieldset>
    </div>
  )
}
