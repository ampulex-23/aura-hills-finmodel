import { Select, SegmentedControl } from '@mantine/core'
import { useModel } from '../store'
import { NumField } from '../components/ui'

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

      <fieldset>
        <legend>Модули бань</legend>
        {P.modules.map((m, i) => (
          <div className="field pair" key={m.id}>
            <span>Модуль {m.id} ({m.capacity} гостей)</span>
            <SegmentedControl
              size="xs"
              data={['Активен', 'В резерве']}
              value={m.status}
              onChange={(v) => setParam(`modules.${i}.status`, v)}
            />
            <NumField value={m.slotsPerDay} onChange={(v) => setParam(`modules.${i}.slotsPerDay`, v)} step={1} />
          </div>
        ))}
      </fieldset>
    </div>
  )
}
