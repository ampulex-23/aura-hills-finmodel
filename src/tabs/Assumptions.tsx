import { Select, SegmentedControl } from '@mantine/core'
import { useModel } from '../store'
import { NumField, TextCell, fmt, fmtPct } from '../components/ui'
import { capmWacc } from '../model/run'

// Форма «Допущения» — все входы модели, сгруппированные.
export function Assumptions() {
  const { params, setParam } = useModel()
  const P = params
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
  const SeasonCheck = ({ v, label }: { v: number[]; label: string }) => (
    <small className="note" style={{ color: Math.abs(mean(v) - 1) < 0.005 ? '#9fd3b4' : '#e07a7a' }}>
      {label}: среднее {mean(v).toFixed(3)} {Math.abs(mean(v) - 1) < 0.005 ? '✓' : '— должно быть 1.000'}
    </small>
  )

  const Row = ({ label, path, value, pct, step, suffix }: any) => (
    <label className="field">
      <span>{label}</span>
      <NumField value={value} onChange={(v) => setParam(path, v)} pct={pct} step={step} suffix={suffix} />
    </label>
  )

  return (
    <div className="form-rows">
      <div className="form-row">
      <fieldset>
        <legend>Общие</legend>
        <Row label="Инфляция" path="general.inflation" value={P.general.inflation} pct />
        <div className="field">
          <span>Ставка дисконтирования</span>
          <Select
            size="xs" w={190}
            data={[
              { value: 'capm', label: 'CAPM (расчёт ниже)' },
              { value: 'manual', label: 'Ручная' },
            ]}
            value={P.general.waccMode}
            onChange={(v) => v && setParam('general.waccMode', v)}
            allowDeselect={false}
          />
        </div>
        {P.general.waccMode === 'manual' ? (
          <Row label="WACC (ручная)" path="general.wacc" value={P.general.wacc} pct />
        ) : (
          <>
            <Row label="Безрисковая (rf, EUR 10Y)" path="general.capm.rf" value={P.general.capm.rf} pct step={0.001} />
            <Row label="Бета (leisure, unlevered)" path="general.capm.beta" value={P.general.capm.beta} step={0.05} />
            <Row label="Премия за риск (ERP)" path="general.capm.erp" value={P.general.capm.erp} pct step={0.005} />
            <Row label="Страновая премия (Кипр)" path="general.capm.countryPremium" value={P.general.capm.countryPremium} pct step={0.005} />
            <Row label="Size / startup премия" path="general.capm.sizePremium" value={P.general.capm.sizePremium} pct step={0.005} />
            <small className="note">
              ke = rf + β·ERP + страновая + size = <b>{fmtPct(capmWacc(P))}</b>. Долга нет → WACC = ke. Эффективная годовая; помесячно (1+WACC)^(1/12)−1.
            </small>
          </>
        )}
        <div className="field">
          <span>Terminal value</span>
          <Select
            size="xs" w={190}
            data={[
              { value: 'false', label: 'Выкл — консервативно' },
              { value: 'true', label: 'Вкл — Gordon growth' },
            ]}
            value={String(P.tv.enabled)}
            onChange={(v) => setParam('tv.enabled', v === 'true')}
            allowDeselect={false}
          />
        </div>
        <Row label="Рост после горизонта (g)" path="tv.growth" value={P.tv.growth} pct step={0.005} />
        <Row label="Exit-мультипликатор EV/EBITDA" path="tv.exitMultiple" value={P.tv.exitMultiple} step={0.5} suffix="×" />
        <small className="note">TV = FCFF 5-го года (после maintenance CAPEX) × (1+g) / (WACC−g); exit-multiple — cross-check (leisure 5–7×). «NPV с TV» — отдельная метрика, база без TV.</small>
      </fieldset>

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
        <label className="field">
          <span>Загрузка услуг по сценариям</span>
          <SegmentedControl
            size="xs"
            data={['Да', 'Нет']}
            value={P.service.serviceLoads ? 'Да' : 'Нет'}
            onChange={(v) => setParam('service.serviceLoads', v === 'Да')}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Налоги и взносы</legend>
        <Row label="CIT" path="taxes.cit" value={P.taxes.cit} pct />
        <Row label="НДС стандартный" path="taxes.vatStd" value={P.taxes.vatStd} pct />
        <Row label="НДС глэмпинг" path="taxes.vatGlamp" value={P.taxes.vatGlamp} pct />
        <Row label="НДС F&B" path="taxes.vatFb" value={P.taxes.vatFb} pct />
        <Row label="НДС входной" path="taxes.vatInput" value={P.taxes.vatInput} pct />
        <Row label="Взносы работодателя" path="taxes.employerRate" value={P.taxes.employerRate} pct step={0.001} />
        <Row label="SDC на дивиденды" path="taxes.sdc" value={P.taxes.sdc} pct />
        <Row label="GESY на дивиденды" path="taxes.gesy" value={P.taxes.gesy} pct step={0.001} />
        <Row label="Потолок базы GESY, €/год на лицо" path="taxes.gesyCap" value={P.taxes.gesyCap} step={10000} />
        <label className="field">
          <span>Уплата НДС</span>
          <SegmentedControl
            size="xs"
            data={[{ value: 'q', label: 'Квартально' }, { value: 'm', label: 'Помесячно' }]}
            value={P.taxes.vatQuarterly ? 'q' : 'm'}
            onChange={(v) => setParam('taxes.vatQuarterly', v === 'q')}
          />
        </label>
        <small className="note">
          Налоговая реформа Кипра (в силе с 01.01.2026): CIT 15%, SDC на дивиденды резидентам-домицилам 5% (17% — для прибыли до 2025).
          Взносы работодателя 2025: SI 8.8% + GESY 2.9% + Social Cohesion 2% + Redundancy 1.2% + HRDA 0.5% = 15.4%.
          НДС за квартал платится до 10-го числа 2-го месяца после квартала.
        </small>
      </fieldset>
      </div>

      <div className="form-row">
      <fieldset className="f2">
        <legend>Распределение прибыли</legend>
        <div className="table-wrap">
          <table className="month-table spec">
            <thead>
              <tr><th>Партнёр</th><th>Доля</th><th>Налоговый статус</th></tr>
            </thead>
            <tbody>
              {P.partners.names.map((n, i) => (
                <tr key={i}>
                  <td className="lft"><TextCell w={104} value={n} onChange={(v) => setParam(`partners.names.${i}`, v)} /></td>
                  <td><NumField value={P.partners.shares[i]} onChange={(v) => setParam(`partners.shares.${i}`, v)} pct step={0.005} /></td>
                  <td>
                    <Select
                      size="xs" w={170}
                      data={[
                        { value: 'Резидент Кипра (17%)', label: 'Резидент-домицил (SDC+GESY)' },
                        { value: 'Нерезидент / Non-Dom (0%)', label: 'Нерезидент / Non-Dom (0%)' },
                      ]}
                      value={P.partners.statuses[i]}
                      onChange={(v) => v && setParam(`partners.statuses.${i}`, v)}
                      allowDeselect={false}
                    />
                  </td>
                </tr>
              ))}
              <tr>
                <td className="lft">Управляющая компания</td>
                <td><NumField value={P.partners.corporate.mgmt} onChange={(v) => setParam('partners.corporate.mgmt', v)} pct step={0.005} /></td>
                <td><small className="note">получает дивиденды, без SDC/GESY</small></td>
              </tr>
              <tr>
                <td className="lft">Резервный фонд</td>
                <td><NumField value={P.partners.corporate.reserve} onChange={(v) => setParam('partners.corporate.reserve', v)} pct step={0.005} /></td>
                <td><small className="note">остаётся в компании — не распределяется</small></td>
              </tr>
            </tbody>
          </table>
        </div>
        <small className="note" style={{ marginTop: 6, display: 'block' }}>
          Дивиденды = ЧП × (Σдолей партнёров + УК); резерв остаётся в компании.
          Контроль баланса:{' '}
          <b style={{ color: Math.abs(P.partners.shares.reduce((a, b) => a + b, 0) + P.partners.corporate.mgmt + P.partners.corporate.reserve - 1) < 0.001 ? '#9fd3b4' : '#e07a7a' }}>
            Σ = {((P.partners.shares.reduce((a, b) => a + b, 0) + P.partners.corporate.mgmt + P.partners.corporate.reserve) * 100).toFixed(1)}%
          </b>
          . SDC {fmtPct(P.taxes.sdc)} и GESY {fmtPct(P.taxes.gesy, 2)} <b>удерживаются из дивидендов</b> резидентов (не доп. отток компании); Non-Dom освобождён от обоих.
        </small>
      </fieldset>

      <fieldset>
        <legend>Амортизация (доля / срок, лет)</legend>
        {P.amort.groups.map((g, i) => (
          <div className="field pair" key={g}>
            <span>{g}</span>
            <NumField value={P.amort.shares[i]} onChange={(v) => setParam(`amort.shares.${i}`, v)} pct />
            <NumField value={P.amort.years[i]} onChange={(v) => setParam(`amort.years.${i}`, v)} step={1} />
            <NumField value={P.taxDepr.years[i]} onChange={(v) => setParam(`taxDepr.years.${i}`, v)} step={1} />
          </div>
        ))}
        <small className="note">Третье число — налоговый срок (capital allowances для CIT): конструкции 25 лет (~4%), оборудование 7 лет (~14%), IT/прочее 5 лет (20%). Бухгалтерская амортизация в P&L — по второму числу.</small>
      </fieldset>
      </div>

      <div className="form-row">
      <fieldset>
        <legend>Прочие OPEX</legend>
        <Row label="Эквайринг, % выручки" path="opexPct.acquiring" value={P.opexPct.acquiring} pct />
        <Row label="Ремонт/обслуживание, %" path="opexPct.maintenance" value={P.opexPct.maintenance} pct />
        <Row label="Маркетинг, min €/мес" path="opexFixed.0.base" value={P.opexFixed[0]?.base ?? 0} step={250} />
        <Row label="Маркетинг, % выручки" path="opexFixed.0.pctOfRevenue" value={P.opexFixed[0]?.pctOfRevenue ?? 0} pct step={0.005} />
        <Row label="Страхование, €/мес" path="opexFixed.6.base" value={P.opexFixed[6]?.base ?? 0} step={50} />
        <Row label="Доля глэмпинга через OTA" path="glampOta.share" value={P.glampOta.share} pct step={0.05} />
        <Row label="Комиссия OTA" path="glampOta.commissionPct" value={P.glampOta.commissionPct} pct step={0.01} />
        <small className="note">Маркетинг = max(min €/мес × инфляция, % выручки месяца) — отрасль premium leisure 3–6%. FF&E-норма 3–4% выручки на ремонт; страхование €800–2,000/мес. OTA: Booking/Airbnb ~15–18%.</small>
      </fieldset>

      <fieldset>
        <legend>Членства, сертификаты и ёмкость</legend>
        <Row label="Визитов члена/мес" path="members.visitsPerMonth" value={P.members.visitsPerMonth} step={0.5} />
        <Row label="Гостей в визите" path="members.partySize" value={P.members.partySize} step={0.5} />
        <div className="field">
          <span>Члены занимают слоты</span>
          <Select
            data={[{ value: 'true', label: 'Да — вычитаются из ёмкости' }, { value: 'false', label: 'Нет — члены вне слотов' }]}
            value={P.members.consumeSlots ? 'true' : 'false'}
            onChange={(v) => setParam('members.consumeSlots', v === 'true')}
          />
        </div>
        <Row label="Доля визитов в пиковые слоты" path="members.peakShare" value={P.members.peakShare} pct step={0.05} />
        <Row label="Сервисный чек члена, €/визит" path="members.serviceSpendPerVisit" value={P.members.serviceSpendPerVisit} step={5} />
        <Row label="Сертификаты: доля погашения" path="units.certRedemptionRate" value={P.units.certRedemptionRate} pct step={0.05} />
        <Row label="Гостей на сертификат" path="units.certGuestsPerCert" value={P.units.certGuestsPerCert} step={0.5} />
        <small className="note">
          Платные слоты вытесняют только членские/сертификатные визиты в пик (доля выше) — остальные заполняют свободную ёмкость.
          Гости-члены покупают услуги на сервисный чек (распределяется по потокам в пропорции пакета → COGS спек и KPI).
          Погашённые сертификаты — гости, занимающие ёмкость и несущие COGS/F&B; непогашённые — чистая выручка (breakage).
        </small>
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
        <legend>F&B</legend>
        <Row label="Себестоимость F&B, % выручки" path="fb.foodCostPct" value={P.fb.foodCostPct} pct />
        <Row label="Оклад повара, €/мес gross" path="fb.cookSalary" value={P.fb.cookSalary} step={50} />
        <Row label="Поваров, ставок" path="fb.cookCount" value={P.fb.cookCount} step={0.5} />
        <small className="note">Рынок Кипр: повар €1,100–2,200 gross/мес. Себестоимость — доля выручки F&B (типично 30–35%). Ставка повара отображается во вкладке «Штат».</small>
      </fieldset>

      <fieldset>
        <legend>Прачечная</legend>
        <label className="field">
          <span>Режим стирки</span>
          <SegmentedControl
            size="xs"
            data={[{ value: 'off', label: 'Аутсорс' }, { value: 'on', label: 'Своя' }]}
            value={P.laundry?.enabled ? 'on' : 'off'}
            onChange={(v) => setParam('laundry.enabled', v === 'on')}
          />
        </label>
        <small className="note">
          <b>Аутсорс</b>: стирка комплектов по тарифу прачечной — списывается в OPEX
          спеками услуг (NC-159 €4.99/гостевой набор, NC-210 €1.5/процедурный).
          <b>Своя</b>: оборудование входит в CAPEX стройки (группа «Прачечная (своя)»,
          ~€8k, амортизируется), а комплекты списываются по расходникам цикла
          (ownPrice €0.9/€0.45 — порошок/гель; коммуналка не считается).
        </small>
      </fieldset>
      </div>

      <div className="form-row">
      <fieldset>
        <legend>Земля</legend>
        <label className="field">
          <span>Режим владения участком</span>
          <Select
            size="xs" w={210}
            data={[
              { value: 'owned', label: 'Своя (у основателей)' },
              { value: 'lease', label: 'Аренда' },
              { value: 'purchase', label: 'Покупка в CAPEX' },
            ]}
            value={P.land.mode}
            onChange={(v) => v && setParam('land.mode', v)}
            allowDeselect={false}
          />
        </label>
        <Row label="Стоимость участка, €" path="land.purchaseCost" value={P.land.purchaseCost} step={5000} />
        <Row label="Аренда земли, €/мес" path="land.rentMonthly" value={P.land.rentMonthly} step={50} />
        <small className="note">Своя — явное допущение, €0 в модели. Аренда платится с 1-го мес стройки (в CF) и в операционке (в OPEX, с инфляцией). Покупка — в CAPEX, без амортизации. Рынок: сельхоз €330–650/мес, «под глэмпинг» до €2,000/мес; покупка €40–200k.</small>
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
        <small className="note">
          «Предоплата» — те же членства: кэш приходит в стройке и прогорает без нового кэша в операционке
          (рекомендуется). «Доп. канал» — поведение исходного Excel: пресейл как отдельная выручка сверх плана;
          проданные так членства ёмкость не занимают — агрессивное допущение.
        </small>
        <Row
          label="Признание пре-сейла, мес" path="units.presaleRecognizeMonths"
          value={P.units.presaleRecognizeMonths} step={1}
        />
        <Row label="Pre-opening, мес до открытия" path="preopen.months" value={P.preopen.months} step={1} />
        <small className="note">Pre-opening: штат нанят и фикс-расходы идут до открытия — «мёртвый» отток в CF конца стройки (оклады+взносы+постоянные/IT, без переменных).</small>
      </fieldset>

      <fieldset>
        <legend>Maintenance CAPEX и стройка</legend>
        <label className="field">
          <span>Maintenance CAPEX</span>
          <SegmentedControl
            size="xs"
            data={[{ value: 'on', label: 'Вкл' }, { value: 'off', label: 'Выкл' }]}
            value={P.capexMaint.enabled ? 'on' : 'off'}
            onChange={(v) => setParam('capexMaint.enabled', v === 'on')}
          />
        </label>
        <Row label="% амортизируемого CAPEX в год" path="capexMaint.pctPerYear" value={P.capexMaint.pctPerYear} pct step={0.005} />
        <Row label="С операционного года" path="capexMaint.startYear" value={P.capexMaint.startYear} step={1} />
        <Row label="Капремонт в году" path="capexMaint.lumpYear" value={P.capexMaint.lumpYear} step={1} />
        <Row label="Капремонт, €" path="capexMaint.lumpEur" value={P.capexMaint.lumpEur} step={5000} />
        <small className="note">
          Замена печей/купелей/текстиля/IT-железа — reserve for replacement (отрасль 1.5–4% CAPEX в год) + разовый капремонт.
          S-кривая освоения стройки (12 весов, нормируются): {P.capexSCurve.map((w) => (w * 100).toFixed(0)).join(' · ')}%.
          Задержка стройки и энергетический стресс — в матрице сценариев.
        </small>
      </fieldset>
      </div>

      <div className="form-row">
      <fieldset className="f2">
        <legend>Сезонность (множители по месяцам, среднее = 1.000)</legend>
        <div className="table-wrap">
          <table className="month-table spec">
            <thead>
              <tr><th>Поток</th>{['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'].map((m) => <th key={m}>{m}</th>)}</tr>
            </thead>
            <tbody>
              {([['Бани', 'baths'], ['Глэмпинг', 'glamping'], ['Сертификаты', 'certificates']] as const).map(([label, key]) => (
                <tr key={key}>
                  <td className="lft">{label}</td>
                  {P.seasonality[key].map((v, i) => (
                    <td key={i}><NumField value={v} onChange={(nv) => setParam(`seasonality.${key}.${i}`, nv)} step={0.05} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="controls" style={{ marginTop: 6, gap: 16 }}>
          <SeasonCheck v={P.seasonality.baths} label="Бани" />
          <SeasonCheck v={P.seasonality.glamping} label="Глэмпинг" />
          <SeasonCheck v={P.seasonality.certificates} label="Сертификаты" />
        </div>
        <small className="note">Сценарные загрузки — среднегодовые, поэтому сезонность должна быть нормирована к 1.0: иначе «65% загрузки» на деле работает как другая цифра.</small>
      </fieldset>
      </div>

      <div className="form-row">
      <fieldset>
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
          Uptime 95% ≈ ~1.5 дня/мес на профилактику печей, водоёмов и чистки (реалистичный диапазон 92–97%).
          «Коэфф. загр.» — помодульный множитель заполняемости (1.0 = общая загрузка; опустите крупный модуль до 0.8–0.9, если он продаётся хуже).
          Доля доп.услуг задаётся сценарно (uptake) + глобально долей кошелька — помодульного % не было и в Excel.
          Цена слота фиксирована баней (250/500/750 €): доли спроса по времени суток влияют только на разложение
          слотов по колонкам, не на выручку. Доли между банями равные — следуют из одинаковых «слотов/день».
        </p>
      </fieldset>
      </div>
    </div>
  )
}
