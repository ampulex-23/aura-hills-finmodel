import { Select, SegmentedControl, Tabs } from '@mantine/core'
import { useModel } from '../store'
import { Hint, NumField, TextCell, fmt, fmtPct } from '../components/ui'
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

  const Row = ({ label, path, value, pct, step, suffix, hint }: any) => (
    <label className="field">
      {hint ? <Hint hint={{ text: hint }}><span>{label}</span></Hint> : <span>{label}</span>}
      <NumField value={value} onChange={(v) => setParam(path, v)} pct={pct} step={step} suffix={suffix} />
    </label>
  )

  return (
    <div className="form-rows">
      <div className="form-row">
      <fieldset>
        <legend>Общие</legend>
        <Row label="Инфляция" path="general.inflation" value={P.general.inflation} pct
          hint="Годовая индексация затрат: оклады, постоянные OPEX, нормы расходников, IT-подписки, аренда земли и чек ресторана оч. 2 умножаются на (1+i)^год — ступенькой раз в 12 месяцев. Цены услуг индексируются отдельно — «ростом цен» сценария." />
        <div className="field">
          <Hint hint={{ text: 'CAPM — ставка собирается из rf + β·ERP + страновая и size-премии (поля ниже). Ручная — фиксированный WACC.' }}>
            <span>Ставка дисконтирования</span>
          </Hint>
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
          <Row label="WACC (ручная)" path="general.wacc" value={P.general.wacc} pct
            hint="Фиксированная эффективная годовая ставка дисконтирования. Помесячно применяется (1+WACC)^(1/12)−1. CAPM-поля игнорируются." />
        ) : (
          <>
            <Row label="Безрисковая (rf, EUR 10Y)" path="general.capm.rf" value={P.general.capm.rf} pct step={0.001}
              hint="Доходность 10-летних гособлигаций в евро — первое слагаемое CAPM: ke = rf + β·ERP + страновая + size." />
            <Row label="Бета (leisure, unlevered)" path="general.capm.beta" value={P.general.capm.beta} step={0.05}
              hint="Чувствительность отрасли leisure/hospitality к рынку. β>1 — проект волатильнее рынка; умножает премию ERP." />
            <Row label="Премия за риск (ERP)" path="general.capm.erp" value={P.general.capm.erp} pct step={0.005}
              hint="Equity risk premium зрелого рынка — надбавка акций над безрисковой ставкой; умножается на бету." />
            <Row label="Страновая премия (Кипр)" path="general.capm.countryPremium" value={P.general.capm.countryPremium} pct step={0.005}
              hint="Спред риска Кипра над развитым рынком — прибавляется к стоимости капитала как есть." />
            <Row label="Size / startup премия" path="general.capm.sizePremium" value={P.general.capm.sizePremium} pct step={0.005}
              hint="Премия за малый размер и стадию запуска — крупнейший «мягкий» компонент ставки. Снижайте по мере выхода проекта на устойчивую работу." />
            <small className="note">
              ke = rf + β·ERP + страновая + size = <b>{fmtPct(capmWacc(P))}</b>. Долга нет → WACC = ke. Эффективная годовая; помесячно (1+WACC)^(1/12)−1.
            </small>
          </>
        )}
        <div className="field">
          <Hint hint={{ text: 'Вкл — терминальная стоимость по модели Гордона от FCFF последнего (6-го) операционного года, показывается отдельной метрикой «NPV с TV»; выкл — консервативно, только явный горизонт 72 мес.' }}>
            <span>Terminal value</span>
          </Hint>
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
        <Row label="Рост после горизонта (g)" path="tv.growth" value={P.tv.growth} pct step={0.005}
          hint="Вечный темп роста FCFF в формуле Гордона. Должен быть заметно ниже WACC, иначе TV «взрывается»; обычно ≈ инфляция." />
        <Row label="Exit-мультипликатор EV/EBITDA" path="tv.exitMultiple" value={P.tv.exitMultiple} step={0.5} suffix="×"
          hint="Отраслевой мультипликатор продажи бизнеса (leisure 5–7×) — cross-check гордоновской TV: EBITDA последнего года × множитель, дисконтированная на конец горизонта." />
        <small className="note">TV = FCFF последнего года (после maintenance CAPEX) × (1+g) / (WACC−g); exit-multiple — cross-check (leisure 5–7×). «NPV с TV» — отдельная метрика, база без TV.</small>
      </fieldset>

      <fieldset>
        <legend>Режимы</legend>
        <label className="field">
          <Hint hint={{ text: '«Да» — каждый гость бани платит депозит: пакет услуг включён в слот (uptake = 100%). «Нет» — депозита нет, услуги продаются отдельно по доле реализации сценария.' }}>
            <span>Пакетный режим (депозит)</span>
          </Hint>
          <SegmentedControl
            size="xs"
            data={['Да', 'Нет']}
            value={P.meta.mode}
            onChange={(v) => setParam('meta.mode', v)}
          />
        </label>
        <label className="field">
          <Hint hint={{ text: '«Гросс» — входной НДС не возмещается и идёт в расходы. «С возмещением» — входной НДС зачитывается/возмещается с поквартальной уплатой нетто.' }}>
            <span>Режим НДС</span>
          </Hint>
          <Select
            size="xs" w={150}
            data={['Гросс', 'С возмещением']}
            value={P.meta.vatMode}
            onChange={(v) => v && setParam('meta.vatMode', v)}
            allowDeselect={false}
          />
        </label>
        <Row label="Мультипликатор спроса" path="service.demandMult" value={P.service.demandMult} step={0.05}
          hint="Глобальный множитель спроса поверх сценарных загрузок — единая ручка стресса/апсайда для всей модели." />
        <label className="field">
          <Hint hint={{ text: '«Да» — у каждого потока услуг своя загрузка из матрицы сценариев (парения, массаж, допы). «Нет» — все услуги следуют загрузке бань.' }}>
            <span>Загрузка услуг по сценариям</span>
          </Hint>
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
        <Row label="CIT" path="taxes.cit" value={P.taxes.cit} pct
          hint="Налог на прибыль Кипра (15% с реформы 2026). База — EBIT с налоговой амортизацией (capital allowances) и переносом убытков по календарным годам; платится авансами 31 июля и 31 декабря." />
        <Row label="НДС стандартный" path="taxes.vatStd" value={P.taxes.vatStd} pct
          hint="Ставка внутри цен бань, услуг, членств, сертификатов и билета общественной бани. Начисленный НДС изымается из выручки в P&L: нетто = брутто × 1/(1+r)." />
        <Row label="НДС глэмпинг" path="taxes.vatGlamp" value={P.taxes.vatGlamp} pct
          hint="Пониженная ставка размещения — применяется к выручке глэмпинга." />
        <Row label="НДС F&B" path="taxes.vatFb" value={P.taxes.vatFb} pct
          hint="Пониженная ставка общепита — кафе-бар оч. 1 и ресторан оч. 2." />
        <Row label="НДС входной" path="taxes.vatInput" value={P.taxes.vatInput} pct
          hint="Ставка входного НДС на OPEX и CAPEX. В режиме «С возмещением» зачитывается против выходного; излишек переносится кредитом. CAPEX оч. 1 — в 1-й месяц операционки, оч. 2 — помесячно в окне стройки; земля входного НДС не даёт." />
        <Row label="Взносы работодателя" path="taxes.employerRate" value={P.taxes.employerRate} pct step={0.001}
          hint="Начисляются сверху на оклады И KPI-бонусы: SI 8.8% + GESY 2.9% + Social Cohesion 2% + Redundancy 1.2% + HRDA 0.5% = 15.4%." />
        <Row label="SDC на дивиденды" path="taxes.sdc" value={P.taxes.sdc} pct
          hint="Special Defence Contribution — удерживается ИЗ дивидендов партнёров-резидентов-домицилов (не отток компании). 5% с 2026; Non-Dom освобождён." />
        <Row label="GESY на дивиденды" path="taxes.gesy" value={P.taxes.gesy} pct step={0.001}
          hint="Взнос в систему здравоохранения с дивидендов резидентов — вместе с SDC, с годовым потолком базы на человека (поле ниже)." />
        <Row label="Потолок базы GESY, €/год на лицо" path="taxes.gesyCap" value={P.taxes.gesyCap} step={10000}
          hint="Максимальная годовая база взноса GESY на человека (€180k с 2025) — свыше потолка взнос не берётся." />
        <label className="field">
          <Hint hint={{ text: 'По закону Кипра НДС платится поквартально — до 10-го числа 2-го месяца после квартала. «Помесячно» — упрощённое списание сразу.' }}>
            <span>Уплата НДС</span>
          </Hint>
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
              <tr>
                <th><Hint hint={{ text: 'Имя партнёра — справочно.' }}><span>Партнёр</span></Hint></th>
                <th><Hint hint={{ text: 'Доля распределяемой прибыли. Контроль: Σ долей + УК + резерв = 100%.' }}><span>Доля</span></Hint></th>
                <th><Hint hint={{ text: 'Резидент-домицил: из дивидендов удерживаются SDC и GESY. Нерезидент / Non-Dom освобождён от обоих.' }}><span>Налоговый статус</span></Hint></th>
              </tr>
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
        <Row label="Эквайринг, % выручки" path="opexPct.acquiring" value={P.opexPct.acquiring} pct
          hint="Комиссия платёжного шлюза — % от всей брутто-выручки месяца (все десять потоков)." />
        <Row label="Ремонт/обслуживание, %" path="opexPct.maintenance" value={P.opexPct.maintenance} pct
          hint="FF&E-норма на текущий ремонт — % от выручки (отрасль premium leisure 3–4%). Не путать с maintenance CAPEX — тот идёт отдельным оттоком в CF." />
        <Row label="Маркетинг, min €/мес" path="opexFixed.0.base" value={P.opexFixed[0]?.base ?? 0} step={250}
          hint="Фиксированная база маркетинга (индексируется инфляцией). Статья = max(база, % выручки месяца)." />
        <Row label="Маркетинг, % выручки" path="opexFixed.0.pctOfRevenue" value={P.opexFixed[0]?.pctOfRevenue ?? 0} pct step={0.005}
          hint="Переменная часть маркетинга — растёт вместе с продажами, когда превышает базу. Отрасль 3–6%." />
        <Row label="Страхование, €/мес" path="opexFixed.6.base" value={P.opexFixed[6]?.base ?? 0} step={50}
          hint="Полисы комплекса — постоянная статья с индексацией инфляцией. Рынок €800–2 000/мес." />
        <Row label="Доля глэмпинга через OTA" path="glampOta.share" value={P.glampOta.share} pct step={0.05}
          hint="Доля ночей, проданных через Booking/Airbnb. Только эти ночи облагаются комиссией; 0% = «только прямые продажи»." />
        <Row label="Комиссия OTA" path="glampOta.commissionPct" value={P.glampOta.commissionPct} pct step={0.01}
          hint="Тариф агрегатора: OPEX = выручка глэмпинга × доля OTA × комиссия. Цена ночи не уменьшается — комиссия идёт расходом." />
        <small className="note">Маркетинг = max(min €/мес × инфляция, % выручки месяца) — отрасль premium leisure 3–6%. FF&E-норма 3–4% выручки на ремонт; страхование €800–2,000/мес. OTA: Booking/Airbnb ~15–18%.</small>
      </fieldset>

      <fieldset>
        <legend>Членства, сертификаты и ёмкость</legend>
        <Row label="Визитов члена/мес" path="members.visitsPerMonth" value={P.members.visitsPerMonth} step={0.5}
          hint="Сколько раз в месяц приходит один член клуба (месячный или годовой). Визиты × гостей в визите = гости-члены месяца → ёмкость, сервисный чек, F&B и нормы «на гостя»." />
        <Row label="Гостей в визите" path="members.partySize" value={P.members.partySize} step={0.5}
          hint="Сколько гостей приводит член за один визит (включая себя)." />
        <div className="field">
          <Hint hint={{ text: '«Да» — членские и сертификатные визиты расходуют слоты ёмкости (вытесняют платных гостей в пик). «Нет» — идут сверх ёмкости, агрессивное допущение.' }}>
            <span>Члены занимают слоты</span>
          </Hint>
          <Select
            data={[{ value: 'true', label: 'Да — вычитаются из ёмкости' }, { value: 'false', label: 'Нет — члены вне слотов' }]}
            value={P.members.consumeSlots ? 'true' : 'false'}
            onChange={(v) => setParam('members.consumeSlots', v === 'true')}
          />
        </div>
        <Row label="Доля визитов в пиковые слоты" path="members.peakShare" value={P.members.peakShare} pct step={0.05}
          hint="Какая часть членских и сертификатных визитов приходится на пиковое время. Только она вытесняет платные слоты; остальные визиты занимают свободную ёмкость." />
        <Row label="Сервисный чек члена, €/визит" path="members.serviceSpendPerVisit" value={P.members.serviceSpendPerVisit} step={5}
          hint="Средние траты гостя-члена на услуги за визит. Разносятся по потокам парений/массажа/допов в пропорции пакета (50:60:22) → COGS спек и KPI-бонусы мастеров." />
        <Row label="Сертификаты: доля погашения" path="units.certRedemptionRate" value={P.units.certRedemptionRate} pct step={0.05}
          hint="Доля проданных сертификатов, которую реально используют. Погашённые — гости с ёмкостью, COGS и F&B; непогашённые — чистая выручка (breakage)." />
        <Row label="Гостей на сертификат" path="units.certGuestsPerCert" value={P.units.certGuestsPerCert} step={0.5}
          hint="Сколько гостей приходит по одному сертификату — масштабирует ёмкостную и F&B-нагрузку погашений." />
        <small className="note">
          Платные слоты вытесняют только членские/сертификатные визиты в пик (доля выше) — остальные заполняют свободную ёмкость.
          Гости-члены покупают услуги на сервисный чек (распределяется по потокам в пропорции пакета → COGS спек и KPI).
          Погашённые сертификаты — гости, занимающие ёмкость и несущие COGS/F&B; непогашённые — чистая выручка (breakage).
        </small>
      </fieldset>

      <fieldset>
        <legend>Цены</legend>
        <Row label="Месячное членство, €" path="prices.membershipMonth" value={P.prices.membershipMonth}
          hint="Абонемент на месяц. Выручка = число месячных членов (вектор сценария по годам) × цена × рост цен." />
        <Row label="Годовое членство, €" path="prices.membershipYear" value={P.prices.membershipYear}
          hint="Годовой абонемент. План активных годовых членов 30/50/80/120/120 по годам; каждый даёт цена/12 в месяц. Год 1 продаётся пресейлом." />
        <Row label="Сертификат, €" path="prices.certificate" value={P.prices.certificate}
          hint="Подарочный сертификат: 65 шт/мес × сезонность сертификатов (пик декабрь) × рампа × цена. Погашается на 85%." />
        <Row label="F&B на гостя, €" path="prices.fbPerGuest" value={P.prices.fbPerGuest}
          hint="Средний чек кафе-бара очереди 1 на одного гостя (слоты, члены, сертификаты, VIP). Посетители общественной бани едят в ресторане оч. 2 и сюда не входят." />
        <Row label="Глэмпинг малый, €/ночь" path="prices.glampSmall" value={P.prices.glampSmall}
          hint="Тариф малого юнита: 30 ночей × 2 юнита × загрузка × летняя сезонность × цена × рост цен." />
        <Row label="Глэмпинг большой, €/ночь" path="prices.glampBig" value={P.prices.glampBig}
          hint="Тариф большого юнита (1 шт), та же формула. Все цены блока индексируются «ростом цен» сценария." />
      </fieldset>

      <fieldset>
        <legend>F&B</legend>
        <Row label="Себестоимость F&B, % выручки" path="fb.foodCostPct" value={P.fb.foodCostPct} pct
          hint="Food-cost кафе-бара оч. 1 — продукты и расходники кухни как доля выручки F&B (не общей). Ресторан оч. 2 имеет свой food-cost в блоке ниже." />
        <Row label="Оклад повара, €/мес gross" path="fb.cookSalary" value={P.fb.cookSalary} step={50}
          hint="Условная роль: входит в ФОТ (с взносами и инфляцией), пока включён слой F&B. Во вкладке «Штат» показана read-only." />
        <Row label="Поваров, ставок" path="fb.cookCount" value={P.fb.cookCount} step={0.5}
          hint="Число ставок повара — множитель оклада." />
        <small className="note">Рынок Кипр: повар €1,100–2,200 gross/мес. Себестоимость — доля выручки F&B (типично 30–35%). Ставка повара отображается во вкладке «Штат».</small>
      </fieldset>

      <fieldset>
        <legend>Прачечная</legend>
        <label className="field">
          <Hint hint={{ text: 'Аутсорс — стирка комплектов списывается в OPEX по тарифу прачечной. Своя — оборудование уходит в CAPEX стройки (амортизируется), в OPEX остаются только расходники цикла.' }}>
            <span>Режим стирки</span>
          </Hint>
          <SegmentedControl
            size="xs"
            data={[{ value: 'off', label: 'Аутсорс' }, { value: 'on', label: 'Своя' }]}
            value={P.laundry?.enabled ? 'on' : 'off'}
            onChange={(v) => setParam('laundry.enabled', v === 'on')}
          />
        </label>
        <small className="note">
          <b>Аутсорс</b>: каждая стирка комплекта списывается в OPEX спеками услуг по тарифу прачечной
          (NC-159 «Стирка гостевого набора — цикл» €4.99, NC-210 «Стирка процедурного набора — цикл» €1.5).
          <b>Своя</b>: оборудование входит в CAPEX стройки (группа «Прачечная (своя)»,
          ~€8k, амортизируется), а цикл стирки списывается по себестоимости
          (ownPrice €0.9/€0.45 — порошок, вода, электричество; коммуналка отдельно не считается).
          Сам текстиль (халаты, полотенца — позиции CAPEX) закупается в любом режиме.
        </small>
      </fieldset>
      </div>

      <div className="form-row">
      <fieldset>
        <legend>Земля</legend>
        <label className="field">
          <Hint hint={{ text: 'Своя — €0 и без потоков в модели. Аренда — €/мес в CF стройки и в OPEX операционки. Покупка — стоимость уходит в CAPEX (без амортизации).' }}>
            <span>Режим владения участком</span>
          </Hint>
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
        <Row label="Стоимость участка, €" path="land.purchaseCost" value={P.land.purchaseCost} step={5000}
          hint="Действует в режиме «Покупка»: разовый CAPEX в стройке оч. 1, без амортизации и без входного НДС." />
        <Row label="Аренда земли, €/мес" path="land.rentMonthly" value={P.land.rentMonthly} step={50}
          hint="Действует в режиме «Аренда»: с 1-го месяца стройки — строка в Cash-Flow; в операционке — постоянная статья OPEX с инфляцией." />
        <small className="note">Своя — явное допущение, €0 в модели. Аренда платится с 1-го мес стройки (в CF) и в операционке (в OPEX, с инфляцией). Покупка — в CAPEX, без амортизации. Рынок: сельхоз €330–650/мес, «под глэмпинг» до €2,000/мес; покупка €40–200k.</small>
      </fieldset>

      <fieldset>
        <legend>Депозит и кошелёк услуг</legend>
        <Row label="Депозит на гостя, €" path="deposit.base" value={P.deposit.base}
          hint="Пакетный депозит за гостя слота — не отдельная выручка, а база кошелька услуг: доля ниже от него уходит на купели/чаны/ванны." />
        <Row label="База парения, €" path="deposit.steamBase" value={P.deposit.steamBase}
          hint="Стоимость парения, зашитая в депозит. Выручка парений = гости × uptake × загрузка × (1−доля допов) × база, распределённая по меню пропорционально вес×цена." />
        <Row label="База массажа, €" path="deposit.massageBase" value={P.deposit.massageBase}
          hint="Аналогично парению — базовая стоимость массажа внутри депозита." />
        <Row label="Доля кошелька на доп.услуги" path="service.walletExtraShare" value={P.service.walletExtraShare} pct
          hint="Часть депозита, уходящая на доп. услуги: доля × депозит распределяется по семи позициям прайса допов пропорционально вес×цена. Та же доля вычитается из баз парения/массажа." />
        <Row label="Доля апгрейдов сверх депозита" path="service.upgradeShare" value={P.service.upgradeShare} pct
          hint="Доля гостей, доплачивающих за услугу дороже базы (цена позиции − база). 0 = консервативно: выручка услуг не выходит за рамки депозита." />
      </fieldset>

      <fieldset>
        <legend>Мощности и объёмы</legend>
        <Row label="Глэмпинг малых" path="units.glampSmall" value={P.units.glampSmall} step={1}
          hint="Число малых юнитов размещения — ёмкость ночей по тарифу «малый»." />
        <Row label="Глэмпинг больших" path="units.glampBig" value={P.units.glampBig} step={1}
          hint="Число больших юнитов — ёмкость ночей по тарифу «большой»." />
        <Row label="Сертификатов/мес" path="units.certsPerMonth" value={P.units.certsPerMonth} step={1}
          hint="Плановые продажи сертификатов в месяц (до сезонности, рампы и мультипликатора спроса). Также входит в месячную сумму пресейла." />
        <Row label="Пре-сейл, мес до открытия" path="units.presaleMonths" value={P.units.presaleMonths} step={1}
          hint="Длина окна предпродаж в конце стройки: каждый месяц приходит кэш = сертификаты + месячные члены года 1 + годовые/12 по плановым ценам." />
        <label className="field">
          <Hint hint={{ text: '«Предоплата» — те же членства: кэш приходит в стройке и прогорает без нового кэша в операционке. «Доп. канал» — пресейл как отдельная выручка сверх плана (агрессивно).' }}>
            <span>Режим пре-сейла</span>
          </Hint>
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
          hint="Число месяцев, за которые равномерно признаётся выручка проданных в пресейле членств — разнесение предоплаты в P&L операционки."
        />
        <Row label="Pre-opening, мес до открытия" path="preopen.months" value={P.preopen.months} step={1}
          hint="Сколько последних месяцев стройки штат уже нанят, а коммуналка и подписки платятся: оклады старта × (1+взносы) + постоянные + IT OPEX — отдельная строка CF." />
        <small className="note">Pre-opening: штат нанят и фикс-расходы идут до открытия — «мёртвый» отток в CF конца стройки (оклады+взносы+постоянные/IT, без переменных).</small>
      </fieldset>

      <fieldset>
        <legend>Maintenance CAPEX и стройка</legend>
        <label className="field">
          <Hint hint={{ text: 'Годовой reserve for replacement: % амортизируемого CAPEX на замену печей, текстиля и IT-железа + разовый капремонт в заданном году.' }}>
            <span>Maintenance CAPEX</span>
          </Hint>
          <SegmentedControl
            size="xs"
            data={[{ value: 'on', label: 'Вкл' }, { value: 'off', label: 'Выкл' }]}
            value={P.capexMaint.enabled ? 'on' : 'off'}
            onChange={(v) => setParam('capexMaint.enabled', v === 'on')}
          />
        </label>
        <Row label="% амортизируемого CAPEX в год" path="capexMaint.pctPerYear" value={P.capexMaint.pctPerYear} pct step={0.005}
          hint="Reserve for replacement: доля амортизируемой базы оч. 1 в год, списывается в CF помесячно (÷12). Отрасль 1.5–4%." />
        <Row label="С операционного года" path="capexMaint.startYear" value={P.capexMaint.startYear} step={1}
          hint="С какого операционного года начинаются отчисления — год 1 обычно замен не требует, техника новая." />
        <Row label="Капремонт в году" path="capexMaint.lumpYear" value={P.capexMaint.lumpYear} step={1}
          hint="Операционный год разового капитального ремонта — отток в его первом месяце." />
        <Row label="Капремонт, €" path="capexMaint.lumpEur" value={P.capexMaint.lumpEur} step={5000}
          hint="Сумма разового капремонта (печи, купели, кровля) — единоразовый отток CF." />
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
        <Tabs defaultValue="q1" variant="outline">
          <Tabs.List>
            <Tabs.Tab value="q1">Очередь 1 — комплексы №1–3</Tabs.Tab>
            <Tabs.Tab value="q2">
              <Hint hint={{ text: 'Вторая очередь: VIP-комплексы №4–7, ввод 2031. «Активен» = объект включён в план стройки — его CAPEX платится в окне 2029–2030; «В резерве» = частичная реализация без этого объекта.' }}>
                <span>Очередь 2 — VIP-комплексы</span>
              </Hint>
            </Tabs.Tab>
          </Tabs.List>
          {([1, 2] as const).map((phase) => (
            <Tabs.Panel key={phase} value={`q${phase}`} pt="xs">
              <div className="table-wrap">
                <table className="month-table spec">
                  <thead>
                    <tr>
                      <th>Модуль</th>
                      <th><Hint hint={{ text: phase === 1 ? 'Активен — модуль продаёт слоты и считается в ёмкости; помодульные строки сметы CAPEX зависят от числа активных. «В резерве» — вне модели до активации.' : '«Активен» — объект включён в план стройки очереди 2: платит свой CAPEX в окне стройки и продаёт слоты с launchDate. «В резерве» — выключен (частичная реализация).' }}><span>Статус</span></Hint></th>
                      <th><Hint hint={{ text: 'Месяц ввода в эксплуатацию (ГГГГ-ММ). До этой даты модуль не генерирует выручку.' }}><span>Ввод с</span></Hint></th>
                      <th><Hint hint={{ text: 'Доля дней в работе: ~95% ≈ 1.5 дня/мес на профилактику печей и водоёмов.' }}><span>Uptime</span></Hint></th>
                      <th><Hint hint={{ text: 'Слотов в день: утро, день, вечер (3). Ёмкость = 30 × слоты × uptime слотов/мес.' }}><span>Слотов/д</span></Hint></th>
                      <th><Hint hint={{ text: 'Гостей в одном слоте — ёмкость в гостях, база услуг, F&B и норм «на гостя». Для аренды определяет тариф спецификации (до 4 / до 8 / до 12).' }}><span>Мест</span></Hint></th>
                      <th><Hint hint={{ text: 'Помодульный множитель заполняемости: 1.0 = общая загрузка сценария; ниже — если модуль продаётся хуже.' }}><span>Коэфф. загр.</span></Hint></th>
                      <th colSpan={P.slotMix.length}><Hint hint={{ text: 'Цена слота, € — фиксирована баней и не зависит от времени суток (три поля на случай дифференциации). Выручка аренды = слоты × средневзвешенная цена × рост цен.' }}><span>Цены слотов € (утро / день / вечер)</span></Hint></th>
                      <th><Hint hint={{ text: 'Средневзвешенная цена слота по долям спроса (slotMix ниже).' }}><span>Ср.-взв. €</span></Hint></th>
                    </tr>
                  </thead>
                  <tbody>
                    {P.modules.map((m, i) => ({ m, i })).filter(({ m }) => (m.phase ?? 1) === phase).map(({ m, i }) => {
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
            </Tabs.Panel>
          ))}
        </Tabs>
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
          Цена слота фиксирована баней (оч. 1: 250/500/750 €; VIP-1…4: 500/500/350/750 €): доли спроса по времени суток влияют только на разложение
          слотов по колонкам, не на выручку. Доли между банями равные — следуют из одинаковых «слотов/день».
          Все семь модулей активны по умолчанию — модель считает полную двухочередную конфигурацию.
        </p>
      </fieldset>
      </div>

      <div className="form-row">
      <fieldset>
        <legend>Очередь 2 — стройка и финансирование</legend>
        <label className="field">
          <Hint hint={{ text: 'Месяц старта стройки очереди 2 (ГГГГ-ММ). CAPEX растянут помесячно по окну.' }}><span>Старт стройки</span></Hint>
          <TextCell w={84} value={P.phase2?.constructionStart ?? ''} placeholder="ГГГГ-ММ"
            onChange={(v) => setParam('phase2.constructionStart', v)} />
        </label>
        <Row label="Длительность, мес" path="phase2.months" value={P.phase2?.months ?? 0} step={1}
          hint="Окно освоения CAPEX очереди 2 — отток делится равномерно на столько месяцев от даты старта." />
        <Row label="Буфер CAPEX оч. 2" path="phase2.capexAdj" value={P.phase2?.capexAdj ?? 0} pct step={0.05}
          hint="Свой буфер непредвиденных для строк phase=2 — применяется к сумме включённых объектов, а не к общему capexAdj сценария." />
        <Row label="Рампа оч. 2, мес" path="phase2.rampMonths" value={P.phase2?.rampMonths ?? 1} step={1}
          hint="Раскачка новых мощностей (VIP, общественная баня, ресторан) от их даты ввода — независимо от общей rampMonths сценария." />
        <div className="field">
          <Hint hint={{ text: '«Операционный CF» — стройка гасится кэшем бизнеса, equityIn закрывает только разрывы. «Отдельный транш» — акционеры вносят ровно отток стройки каждый месяц окна.' }}>
            <span>Финансирование оч. 2</span>
          </Hint>
          <Select
            size="xs" w={220}
            data={[
              { value: 'ops', label: 'Из операционного CF' },
              { value: 'equity', label: 'Отдельный транш акционеров' },
            ]}
            value={P.phase2?.funding ?? 'ops'}
            onChange={(v) => v && setParam('phase2.funding', v)}
            allowDeselect={false}
          />
        </div>
        <small className="note">Ввод объектов — единый (launchDate у VIP и общественной бани). Частичная реализация — помодульными тоглами: общие строки сметы оч. 2 платятся, если включён ≥1 объект.</small>
      </fieldset>

      <fieldset>
        <legend>Общественный банный комплекс (оч. 2)</legend>
        <div className="field">
          <Hint hint={{ text: 'Вкл — объект в плане стройки: платит свои строки CAPEX и генерирует поток посетителей. Выкл — частичная реализация без него.' }}>
            <span>Включён в план</span>
          </Hint>
          <SegmentedControl
            size="xs"
            data={[{ value: 'true', label: 'Активен' }, { value: 'false', label: 'В резерве' }]}
            value={String(P.publicBath?.enabled ?? false)}
            onChange={(v) => setParam('publicBath.enabled', v === 'true')}
          />
        </div>
        <Row label="Билет, €" path="publicBath.ticketEur" value={P.publicBath?.ticketEur ?? 0} step={1}
          hint="Цена входа на гостя: вход + пользование всеми зонами комплекса (бассейн, купели, баня, терраса). Прачка сюда не входит." />
        <Row label="Пропускная, чел/день" path="publicBath.capacity" value={P.publicBath?.capacity ?? 0} step={5}
          hint="Потолок посетителей в день: визит ≈ весь рабочий день 9–23, поэтому это и есть дневная ёмкость. Загрузка (% пропускной) задаётся в матрице сценариев." />
        <label className="field">
          <Hint hint={{ text: 'Месяц ввода в эксплуатацию (ГГГГ-ММ). До этой даты потока нет; с неё стартует рампа очереди 2 и амортизация объекта.' }}><span>Ввод с</span></Hint>
          <TextCell w={84} value={P.publicBath?.launchDate ?? ''} placeholder="ГГГГ-ММ"
            onChange={(v) => setParam('publicBath.launchDate', v)} />
        </label>
        <Row label="Сервисный чек, €/визит" path="publicBath.serviceSpendPerVisit" value={P.publicBath?.serviceSpendPerVisit ?? 0} step={1}
          hint="Средний чек сверх билета (парения, массаж, допы) — разносится по потокам услуг в пропорции пакета, как членский чек." />
        <small className="note">Посетителей/мес = 30 дн × пропускная × загрузка сценария × сезонность × рампа. НЕ слотовая система. Гости несут нормативные COGS на гостя, в F&B-кафе очереди 1 не засчитываются.</small>
      </fieldset>

      <fieldset>
        <legend>Ресторан (оч. 2, плейсхолдер)</legend>
        <Row label="Посадочных мест" path="restaurant.seats" value={P.restaurant?.seats ?? 0} step={5}
          hint="Мест в зале ресторана общественного комплекса." />
        <Row label="Средний чек, €" path="restaurant.avgCheck" value={P.restaurant?.avgCheck ?? 0} step={1}
          hint="Чек на гостя — оценка по Кипру; индексируется общей инфляцией, не priceGrowth услуг. Детальная экономика ресторана — отдельной итерацией." />
        <Row label="Оборотов посадки/день" path="restaurant.turnsPerDay" value={P.restaurant?.turnsPerDay ?? 0} step={0.25}
          hint="Сколько раз за день занимается одно посадочное место (внешние гости + гости бани суммарно). Загрузка — % ёмкости в матрице сценариев." />
        <Row label="Food-cost" path="restaurant.foodCostPct" value={P.restaurant?.foodCostPct ?? 0} pct step={0.05}
          hint="Себестоимость продуктов и расходников кухни — доля выручки ресторана." />
        <small className="note">Выручка/мес = 30 × места × обороты × загрузка × чек. Работает при включённой общественной бане (в её здании). Плейсхолдер: поток заменят детальной моделью позже.</small>
      </fieldset>
      </div>
    </div>
  )
}
