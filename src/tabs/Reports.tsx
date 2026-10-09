import { Fragment, useState } from 'react'
import type { ModelResult, ModuleSpec, NomenclatureItem, Params } from '../model/types'
import { landedCost, activeModuleCount } from '../model/opex'
import { useModel } from '../store'
import { MonthTable, monthLabels, fmt, fmtEur, fmtPct, Hint } from '../components/ui'
import type { CellHint, RowDef } from '../components/ui'

// Расчётные вкладки: помесячные таблицы 1:1 листам Excel.
// hint(ci) → пояснялка клетки: смысл, формула словами и подстановка чисел.

const pc = (v: number, d = 1) => `${(v * 100).toFixed(d).replace(/\.0$/, '')}%`
const e0 = (v: number) => `€${fmt(v)}`
const e1 = (v: number) => `€${fmt(v, 1)}`
const growthAt = (g: number, k: number) => Math.pow(1 + g, Math.floor(k / 12))

// Активные модули в операционный месяц k (по launchDate, как в модели).
function modulesAt(params: Params, k: number): ModuleSpec[] {
  const [y0, m0] = params.meta.openingDate.slice(0, 7).split('-').map(Number)
  const t = y0 * 12 + (m0 - 1) + k
  const at = Math.floor(t / 12) * 100 + (t % 12) + 1 // YYYYMM для сравнения с launchDate
  return params.modules.filter(
    (m) => m.status === 'Активен' && Number(m.launchDate.replace('-', '')) <= at,
  )
}

function revenueHints(params: Params, r: ModelResult) {
  const sc = r.scenario
  const R = r.revenue
  const dm = params.service.demandMult
  const cap = sc.avgCapacity
  const up = sc.effectiveUptake
  const ld = params.service.serviceLoads
  const upLdTxt = (v: number, _i: number) =>
    ld ? `${pc(up)} × ${pc(Math.min(1, v))} (загрузка)` : pc(up)
  const wExtra = params.service.walletExtraShare
  const season = (m: (typeof R)[0]) => params.seasonality.baths[m.monthOfYear - 1]
  const gAt = (k: number) => growthAt(sc.priceGrowth, k)
  const sumLine = (m: (typeof R)[0]) =>
    `Аренда ${e0(m.rental)} + Парения ${e0(m.steamTotal)} + Массаж ${e0(m.massageTotal)} ` +
    `+ Доп.услуги ${e0(m.extraTotal)} + Глэмпинг ${e0(m.glamping)} + Членства ${e0(m.membershipTotal)} + F&B ${e0(m.fb)}`

  return {
    load: (i: number): CellHint => {
      const m = R[i]
      return {
        title: 'Загрузка бань',
        text: 'Доля проданных слотов: множитель спроса × целевая загрузка года (сценарий) × сезонность месяца × раскачка после открытия. Не выше 100%.',
        tex: String.raw`\mathrm{load}=\min(1,\ \mathrm{спрос}\cdot\mathrm{цель_{год}}\cdot\mathrm{сезон}\cdot\mathrm{ramp})`,
        calc: `min(100%, ${dm} × ${pc(sc.bathsLoad[m.yearIdx])} × ${season(m)} × ${pc(m.ramp)}) = ${pc(m.bathsLoad)}`,
      }
    },
    slots: (i: number): CellHint => {
      const m = R[i]
      const mods = modulesAt(params, i)
      const spd = mods.reduce((s, x) => s + x.slotsPerDay, 0)
      const upAvg = spd ? mods.reduce((s, x) => s + x.slotsPerDay * x.uptime, 0) / spd : 0
      return {
        title: 'Проданные слоты',
        text: `30 дней × слоты в день × аптайм × загрузка — по каждому из ${mods.length} активных модулей.`,
        tex: String.raw`\mathrm{slots}=\sum_{модулей} 30\cdot\mathrm{слоты/день}\cdot\mathrm{uptime}\cdot\mathrm{load}`,
        calc: `30 дн × ${fmt(spd)} слот/день × аптайм ~${pc(upAvg)} × загрузка ${pc(m.bathsLoad)} ≈ ${fmt(m.slots)}`,
      }
    },
    rental: (i: number): CellHint => {
      const m = R[i]
      const g = gAt(i)
      const avgPrice = m.slots ? m.rental / (m.slots * g) : 0
      return {
        title: 'Аренда бань',
        text: 'Проданные слоты × средняя цена слота (фикс-цена бани 250/500/750, доли бань равные) × годовой рост цен.',
        tex: String.raw`\mathrm{rental}=\mathrm{slots}\cdot\overline{\mathrm{цена}}_{\mathrm{микс}}\cdot(1+\mathrm{рост})^{\mathrm{год}}`,
        calc: `${fmt(m.slots)} слот × ${e1(avgPrice)} × рост ${g.toFixed(2)} = ${e0(m.rental)}`,
      }
    },
    steam: (i: number): CellHint => {
      const m = R[i]
      return {
        title: 'Парения',
        text: `Процедуры из депозитного кошелька по базе ${e0(params.deposit.steamBase)} + доплаты за апгрейд (${pc(params.service.upgradeShare)} гостей).`,
        tex: String.raw`\mathrm{слоты}\cdot\mathrm{гостей/слот}\cdot\mathrm{доля}\cdot\big[(1-w_{доп})\,P_{база}+u_{апгр}\,\overline{(P-P_{база})}\big]\cdot\mathrm{рост}`,
        calc: `${fmt(m.slots)} × ${fmt(cap, 1)} гостей × ${upLdTxt(sc.steamLoad[m.yearIdx], i)} × [${pc(1 - wExtra)}×${e0(params.deposit.steamBase)} + апгр.] × рост ${gAt(i).toFixed(2)} = ${e0(m.steamTotal)}`,
      }
    },
    massage: (i: number): CellHint => {
      const m = R[i]
      return {
        title: 'Массаж',
        text: `Та же схема, что у парений: база в кошельке ${e0(params.deposit.massageBase)} + доплаты за апгрейд.`,
        calc: `${fmt(m.slots)} × ${fmt(cap, 1)} гостей × ${upLdTxt(sc.massageLoad[m.yearIdx], i)} × [${pc(1 - wExtra)}×${e0(params.deposit.massageBase)} + апгр.] × рост ${gAt(i).toFixed(2)} = ${e0(m.massageTotal)}`,
      }
    },
    extra: (i: number): CellHint => {
      const m = R[i]
      return {
        title: 'Доп.услуги',
        text: `Доля кошелька на доп.услуги (${pc(wExtra)}) × депозит ${e0(params.deposit.base)} × распределение по услугам.`,
        calc: `${fmt(m.slots)} × ${fmt(cap, 1)} × ${upLdTxt(sc.extraLoad[m.yearIdx], i)} × ${pc(wExtra)} × ${e0(params.deposit.base)} × рост ${gAt(i).toFixed(2)} = ${e0(m.extraTotal)}`,
      }
    },
    glamping: (i: number): CellHint => {
      const m = R[i]
      const seasG = params.seasonality.glamping[m.monthOfYear - 1]
      const gl = Math.min(1, dm * sc.glampLoad[m.yearIdx] * seasG * m.ramp)
      return {
        title: 'Глэмпинг',
        text: '30 дней × (юниты × загрузка × цена) для малого и большого глэмпинга × рост цен.',
        calc: `30 дн × (${params.units.glampSmall} шт × ${pc(gl)} × ${e0(params.prices.glampSmall)} + ${params.units.glampBig} шт × ${pc(gl)} × ${e0(params.prices.glampBig)}) × ${gAt(i).toFixed(2)} = ${e0(m.glamping)}`,
      }
    },
    membership: (i: number): CellHint => {
      const m = R[i]
      const g = gAt(i)
      return {
        title: 'Членства + сертификаты',
        text: `Месячные (${e0(params.prices.membershipMonth)}), годовые (${e0(params.prices.membershipYear)}, план/год ÷ 12) и подарочные сертификаты (${e0(params.prices.certificate)}) — с раскачкой и ростом цен.`,
        calc: `месячные ${e0(m.membersMonth)} + годовые ${e0(m.membersYear)} + сертификаты ${e0(m.certificates)} = ${e0(m.membershipTotal)} (рост ${g.toFixed(2)})`,
      }
    },
    fb: (i: number): CellHint => {
      const m = R[i]
      return {
        title: 'F&B (чайная зона)',
        text: 'Представительские продажи: гости × средний чек на гостя × рост цен.',
        calc: `${fmt(m.guests)} гостей × ${e1(params.prices.fbPerGuest)} × рост ${gAt(i).toFixed(2)} = ${e0(m.fb)}`,
      }
    },
    total: (i: number): CellHint => {
      const m = R[i]
      return {
        title: 'Итого выручка',
        text: 'Сумма всех потоков выручки за месяц.',
        calc: `${sumLine(m)} = ${e0(m.total)}`,
      }
    },
  }
}

export function Revenue({ r, labels }: { r: ModelResult; labels: string[] }) {
  const { params } = useModel()
  const R = r.revenue
  const stream = (get: (m: (typeof R)[0]) => number) => R.map(get)
  const h = revenueHints(params, r)
  const rows: RowDef[] = [
    { label: 'Загрузка бань', values: stream((m) => m.bathsLoad), fmt: 'pct' as const, hint: h.load },
    { label: 'Слоты (шт)', values: stream((m) => m.slots), hint: h.slots },
    ...(params.members.consumeSlots
      ? [{
          label: '— в т.ч. слоты членов', values: stream((m) => m.memberSlots),
          tip: 'Члены клуба занимают ёмкость: активные члены × визитов/мес × гостей в визите ÷ средняя вместимость слота. В пиковые месяцы вытесняют платные слоты.',
          hint: (i: number): CellHint => ({
            title: 'Слоты членов',
            calc: `${fmt(R[i].memberSlots)} слот (${fmt(R[i].memberGuests)} гостей-членов в F&B)`,
          }),
        }]
      : []),
    { label: 'Аренда бань', values: stream((m) => m.rental), hint: h.rental },
    { label: 'Парения', values: stream((m) => m.steamTotal), hint: h.steam },
    { label: 'Массаж', values: stream((m) => m.massageTotal), hint: h.massage },
    { label: 'Доп.услуги', values: stream((m) => m.extraTotal), hint: h.extra },
    { label: 'Глэмпинг', values: stream((m) => m.glamping), hint: h.glamping },
    { label: 'Членства + сертификаты', values: stream((m) => m.membershipTotal), hint: h.membership },
    { label: 'F&B', values: stream((m) => m.fb), hint: h.fb },
    { label: 'ИТОГО ВЫРУЧКА', values: stream((m) => m.total), bold: true, hint: h.total },
  ]
  return <MonthTable rows={rows} labels={labels} withSum />
}

export function Opex({ r, labels }: { r: ModelResult; labels: string[] }) {
  const { params, items } = useModel()
  const O = r.opex
  const R = r.revenue
  const inflAt = (k: number) => Math.pow(1 + params.general.inflation, Math.floor(k / 12))
  const nModules = activeModuleCount(params)

  const fixedHint = (i: number) => (ci: number): CellHint | null => {
    const f = params.opexFixed[i]
    if (!f) return null
    const infl = inflAt(ci)
    return {
      title: f.name,
      text: f.perModule
        ? `Постоянная статья, зависящая от числа модулей: база × ${nModules} модулей × инфляция.`
        : 'Постоянная месячная статья с индексацией на инфляцию.',
      calc: `${e0(f.base)}/мес${f.perModule ? ` × ${nModules} мод.` : ''} × инфл ${infl.toFixed(2)} = ${e0(O[ci].fixed[i])}`,
    }
  }

  const byBase = (article: string, base: string, its: NomenclatureItem[]) =>
    its
      .filter((it) => it.use !== 'CAPEX' && it.opexArticle === article && it.normBase === base)
      .reduce((s, it) => s + it.norm * landedCost(it), 0)

  const variableHint = (article: string) => (ci: number): CellHint => {
    const m = R[ci]
    const infl = inflAt(ci)
    const sSlot = byBase(article, 'слот', items)
    const sGuest = byBase(article, 'гость', items)
    const sMonth = byBase(article, 'мес', items)
    const amount = O[ci].variable.find((x) => x.article === article)?.amount ?? 0
    return {
      title: article,
      text: 'Нормы расхода по справочнику номенклатуры: на слот, на гостя и в месяц — по landed-цене (цена + доставка), с индексацией на инфляцию.',
      tex: String.raw`\mathrm{слоты}\cdot\Sigma\mathrm{норма}_{слот}+\mathrm{гости}\cdot\Sigma\mathrm{норма}_{гость}+\Sigma\mathrm{норма}_{мес}`,
      calc: `${fmt(m.slots)}×${e1(sSlot)} + ${fmt(m.guests)}×${e1(sGuest)} + ${e1(sMonth)}/мес, × инфл ${infl.toFixed(2)} = ${e0(amount)}`,
    }
  }

  const pctHint = (name: string, key: 'acquiring' | 'maintenance') => (ci: number): CellHint => ({
    title: name,
    text: 'Процент от брутто-выручки месяца.',
    calc: `${pc(params.opexPct[key], 2)} × ${e0(R[ci].total)} = ${e0(O[ci].pct[key])}`,
  })

  const rows: RowDef[] = [
    { label: 'ПОСТОЯННЫЕ', values: [], section: true },
    ...params.opexFixed.map((f, i) => ({
      label: f.name, values: O.map((m) => m.fixed[i]), hint: fixedHint(i),
    })),
    ...(params.land.mode === 'lease'
      ? [{
          label: 'Аренда земли', values: O.map((m) => m.landRent),
          tip: 'Аренда участка: в операционке — здесь; в период стройки — строкой в Cash-Flow.',
          hint: (ci: number): CellHint => ({
            title: 'Аренда земли',
            calc: `${e0(params.land.rentMonthly)}/мес × инфл ${inflAt(ci).toFixed(2)} = ${e0(O[ci].landRent)}`,
          }),
        }]
      : []),
    {
      label: 'Итого постоянные', values: O.map((m) => m.fixedTotal + m.landRent), bold: true,
      tip: 'Сумма постоянных статей с индексацией на инфляцию.',
      hint: (ci) => ({ title: 'Итого постоянные', calc: `Σ постоянных ${e0(O[ci].fixedTotal)} + аренда земли ${e0(O[ci].landRent)} = ${e0(O[ci].fixedTotal + O[ci].landRent)}` }),
    },
    ...(params.it.enabled
      ? [
          { label: 'IT / АСУ (кастомный слой)', values: [], section: true },
          ...params.it.opex.map((x, i) => ({
            label: x.name,
            values: O.map((m) => m.it[i]?.amount ?? 0),
            hint: (ci: number): CellHint => ({
              title: x.name,
              text: 'Подписка/инфраструктура кастомного цифрового слоя — помесячно, с индексацией на инфляцию.',
              calc: `${e0(x.base)}/мес × инфл ${inflAt(ci).toFixed(2)} = ${e0(O[ci].it[i]?.amount ?? 0)}`,
            }),
          })),
          {
            label: 'Итого IT', values: O.map((m) => m.itTotal), bold: true,
            hint: (ci: number): CellHint => ({
              title: 'Итого IT',
              text: `IT-куратор (${e0(params.it.curator)}/мес оклад) сидит в ФОТ, не здесь. Внедрение — в CAPEX.`,
              calc: `Σ IT-статей = ${e0(O[ci].itTotal)}`,
            }),
          },
        ]
      : []),
    { label: 'ПЕРЕМЕННЫЕ (номенклатура)', values: [], section: true },
    ...O[0].variable.map((v) => ({
      label: v.article,
      values: O.map((m) => m.variable.find((x) => x.article === v.article)?.amount ?? 0),
      hint: variableHint(v.article),
    })),
    {
      label: 'Итого переменные', values: O.map((m) => m.variableTotal), bold: true,
      hint: (ci) => ({ title: 'Итого переменные', calc: `Σ переменных = ${e0(O[ci].variableTotal)}` }),
    },
    { label: '% ОТ ВЫРУЧКИ', values: [], section: true },
    { label: 'Эквайринг', values: O.map((m) => m.pct.acquiring), hint: pctHint('Эквайринг', 'acquiring') },
    { label: 'Ремонт/обслуживание', values: O.map((m) => m.pct.maintenance), hint: pctHint('Ремонт/обслуживание', 'maintenance') },
    {
      label: 'Себестоимость F&B', values: O.map((m) => m.pct.fbCost),
      tip: 'Продукты/расходники кухни — % от выручки F&B (не от общей). Повар — в ФОТ.',
      hint: (ci) => ({
        title: 'Себестоимость F&B',
        calc: `${pc(params.fb.foodCostPct, 2)} × ${e0(R[ci].fb)} = ${e0(O[ci].pct.fbCost)}`,
      }),
    },
    {
      label: 'OTA-комиссия глэмпинга', values: O.map((m) => m.pct.ota),
      tip: 'Доля ночей через Booking/Airbnb × комиссия канала — от выручки глэмпинга.',
      hint: (ci) => ({
        title: 'OTA-комиссия',
        calc: `${e0(R[ci].glamping)} × доля OTA ${pc(params.glampOta.share, 0)} × комиссия ${pc(params.glampOta.commissionPct, 0)} = ${e0(O[ci].pct.ota)}`,
      }),
    },
    {
      label: 'ИТОГО OPEX', values: O.map((m) => m.total), bold: true,
      hint: (ci) => ({
        title: 'Итого OPEX',
        calc: `${e0(O[ci].fixedTotal)} пост. + ${e0(O[ci].itTotal)} IT + ${e0(O[ci].landRent)} земля + ${e0(O[ci].variableTotal)} перем. + ${e0(O[ci].pctTotal)} % = ${e0(O[ci].total)}`,
      }),
    },
  ]
  return <MonthTable rows={rows} labels={labels} withSum />
}

export function Fot({ r, labels }: { r: ModelResult; labels: string[] }) {
  const { params } = useModel()
  const F = r.fot
  const R = r.revenue
  const inflAt = (k: number) => Math.pow(1 + params.general.inflation, Math.floor(k / 12))
  const baseSalaries = params.fot.count.reduce((s, c, i) => s + c * params.fot.salary[i], 0)
    + (params.it.enabled ? params.it.curator : 0)
    + (params.fb.enabled ? params.fb.cookCount * params.fb.cookSalary : 0)
  const rows: RowDef[] = [
    {
      label: 'Оклады (фикс.)', values: F.map((m) => m.salaries),
      tip: `Фонд окладов штата${params.it.enabled ? ` (включая IT-куратора ${e0(params.it.curator)}/мес)` : ''}${params.fb.enabled ? ` и повара (${params.fb.cookCount} × ${e0(params.fb.cookSalary)}/мес)` : ''}, индексируется на инфляцию ежегодно.`,
      hint: (ci) => ({
        title: 'Оклады',
        calc: `${e0(baseSalaries)}/мес × инфл ${inflAt(ci).toFixed(2)} = ${e0(F[ci].salaries)}`,
      }),
    },
    {
      label: 'KPI бонусы', values: F.map((m) => m.bonuses),
      tip: 'Переменная часть: Σ проданных услуг × прайс спецификации × % ролей в её составе (задаётся во вкладке «Спецификации»).',
      hint: (ci) => ({
        title: 'KPI бонусы',
        calc: F[ci].bonusDetail
          ? `${F[ci].bonusDetail} = ${e0(F[ci].bonuses)}`
          : `услуг не проведено → ${e0(F[ci].bonuses)}`,
      }),
    },
    {
      label: 'Итого ФОТ (gross)', values: F.map((m) => m.gross), bold: true,
      hint: (ci) => ({ title: 'ФОТ gross', calc: `${e0(F[ci].salaries)} + ${e0(F[ci].bonuses)} = ${e0(F[ci].gross)}` }),
    },
    {
      label: `Взносы ${pc(params.taxes.employerRate, 2)}`, values: F.map((m) => m.employerContrib),
      tip: 'Взносы работодателя (соцстрах и пр.) на фонд оплаты труда.',
      hint: (ci) => ({ title: 'Взносы работодателя', calc: `${e0(F[ci].gross)} × ${pc(params.taxes.employerRate, 2)} = ${e0(F[ci].employerContrib)}` }),
    },
    {
      label: 'ИТОГО ФОТ + взносы', values: F.map((m) => m.total), bold: true,
      hint: (ci) => ({ title: 'Итого ФОТ', calc: `${e0(F[ci].gross)} + ${e0(F[ci].employerContrib)} = ${e0(F[ci].total)}` }),
    },
  ]
  return <MonthTable rows={rows} labels={labels} withSum />
}

export function Capex({ r }: { r: ModelResult }) {
  const { params } = useModel()
  const { capex } = r
  const amortTex = String.raw`\mathrm{аморт}=\sum_{групп}\frac{\mathrm{CAPEX}\cdot\mathrm{доля}_{группы}}{\mathrm{срок}_{лет}\cdot 12}`
  // Разделы сметы: строки с одинаковой группой собираются в один блок
  // (порядок разделов = порядок первого появления в capexItems, IT и земля в конце)
  const groups: { name: string; items: typeof capex.items; total: number }[] = []
  const gidx = new Map<string, number>()
  for (const it of capex.items) {
    const g = it.group ?? 'Прочее'
    const ix = gidx.get(g)
    if (ix === undefined) {
      gidx.set(g, groups.length)
      groups.push({ name: g, items: [it], total: it.eur })
    } else {
      groups[ix].items.push(it)
      groups[ix].total += it.eur
    }
  }
  const qty2 = (v?: number) => (v == null ? '' : fmt(v, 2))
  const ItemRows = ({ it }: { it: (typeof capex.items)[number] }) => {
    // Наполнение: детали группируем по категориям номенклатуры
    const isNomenclature = it.detail?.some((d) => d.category)
    const catGroups: { name: string; rows: NonNullable<typeof it.detail>; total: number }[] = []
    if (isNomenclature) {
      const cix = new Map<string, number>()
      for (const d of it.detail!) {
        const c = d.category ?? 'Прочее'
        const ix = cix.get(c)
        if (ix === undefined) {
          cix.set(c, catGroups.length)
          catGroups.push({ name: c, rows: [d], total: d.eur })
        } else {
          catGroups[ix].rows.push(d)
          catGroups[ix].total += d.eur
        }
      }
    }
    return (
      <Fragment>
        <tr>
          <td className="sticky"><b>{it.name}</b></td>
          <td>{it.unit ?? ''}</td>
          <td>{qty2(it.qty)}</td>
          <td>{qty2(it.rate)}</td>
          <td><b>{fmt(it.eur)}</b></td>
        </tr>
        {it.wbs?.map((sec) => (
          <Fragment key={sec.code}>
            <tr className="wbs-sec">
              <td className="sticky">{sec.code} {sec.title}</td>
              <td /><td /><td />
              <td>{fmt(sec.total)}</td>
            </tr>
            {sec.items.map((l) => (
              <tr key={l.code} className="wbs-line">
                <td className="sticky">
                  {l.code} {l.name}
                  {l.tag && <span className="wbs-tag">{l.tag}</span>}
                </td>
                <td>{l.unit ?? ''}</td>
                <td>{qty2(l.qty)}</td>
                <td>{qty2(l.rate)}</td>
                <td>{fmt(l.eur)}</td>
              </tr>
            ))}
          </Fragment>
        ))}
        {!isNomenclature &&
          it.detail?.map((d) => (
            <tr key={`${it.name}-${d.code}`} className="sub-detail">
              <td className="sticky"><small>{d.code} · {d.name}</small></td>
              <td><small>{d.unit ?? ''}</small></td>
              <td><small>{qty2(d.qty)}</small></td>
              <td><small>{fmt(d.landed, 2)}</small></td>
              <td><small>{fmt(d.eur)}</small></td>
            </tr>
          ))}
        {catGroups.map((cg) => (
          <Fragment key={cg.name}>
            <tr className="wbs-sec">
              <td className="sticky">{cg.name}</td>
              <td /><td /><td />
              <td>{fmt(cg.total)}</td>
            </tr>
            {cg.rows.map((d) => (
              <tr key={d.code} className="wbs-line">
                <td className="sticky"><small>{d.code} {d.name}</small></td>
                <td><small>{d.unit ?? ''}</small></td>
                <td><small>{qty2(d.qty)}</small></td>
                <td><small>{fmt(d.landed, 2)}</small></td>
                <td><small>{fmt(d.eur)}</small></td>
              </tr>
            ))}
          </Fragment>
        ))}
      </Fragment>
    )
  }
  return (
    <div className="table-wrap">
      <table className="month-table scen capex-table">
        <thead>
          <tr>
            <th className="sticky">Статья затрат / элемент работ</th>
            <th>Ед.</th>
            <th>Кол-во</th>
            <th>Ставка, €</th>
            <th>Сумма, €</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, gi) => (
            <Fragment key={g.name}>
              <tr className="capex-group">
                <td className="sticky">Раздел {gi + 1}. {g.name}</td>
                <td /><td /><td />
                <td>{fmt(g.total)}</td>
              </tr>
              {g.items.map((it) => <ItemRows key={it.name} it={it} />)}
            </Fragment>
          ))}
          <tr className="bold">
            <td className="sticky">ИТОГО CAPEX</td>
            <td /><td /><td />
            <td><Hint hint={{ title: 'Итого CAPEX', text: 'Сумма всех инвестиционных позиций, включая наполнение из справочника номенклатуры (landed-цена × кол-во).' }}><span className="cellval">{fmt(capex.totalEur)}</span></Hint></td>
          </tr>
          <tr className="bold">
            <td className="sticky">С буфером сценария</td>
            <td /><td /><td />
            <td>
              <Hint hint={{
                title: 'CAPEX с буфером',
                text: 'Сценарная надбавка к стоимости строительства (риск удорожания).',
                calc: `${e0(capex.totalEur)} × ${1 + r.scenario.capexAdj} = ${e0(capex.adjustedEur)}`,
              }}>
                <span className="cellval">{fmt(capex.adjustedEur)}</span>
              </Hint>
            </td>
          </tr>
          <tr>
            <td className="sticky">Амортизация, €/мес</td>
            <td /><td /><td />
            <td>
              <Hint hint={{
                title: 'Амортизация',
                text: 'Линейная: для каждой группы CAPEX — сумма × доля группы ÷ (срок службы × 12 мес).',
                tex: amortTex,
                calc: params.amort.groups
                  .map((g, i) => `${g}: ${pc(params.amort.shares[i])} / ${params.amort.years[i]} лет`)
                  .join(' · ') + ` → ${e0(capex.monthlyAmort)}/мес`,
              }}>
                <span className="cellval">{fmt(capex.monthlyAmort)}</span>
              </Hint>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function Taxes({ r, labels }: { r: ModelResult; labels: string[] }) {
  const { params } = useModel()
  const T = r.taxes
  const R = r.revenue
  const t = params.taxes
  const reimb = params.meta.vatMode === 'С возмещением'
  const years = Math.ceil(params.meta.opsMonths / 12)
  const distShare = params.partners.shares.reduce((a, b) => a + b, 0) + params.partners.corporate.mgmt
  const sdcRate = params.partners.shares.reduce(
    (s, sh, i) => s + sh * (params.partners.statuses[i] === 'Резидент Кипра (17%)' ? t.sdc : 0), 0,
  ) / distShare
  const eff19 = t.vatStd / (1 + t.vatStd)

  const rows: RowDef[] = [
    {
      label: `НДС ${pc(t.vatStd)} (выходной)`, values: T.map((m) => m.vatOut19),
      tip: 'НДС, «сидящий» внутри выручки бань, процедур и членств (цены включают НДС).',
      tex: String.raw`\mathrm{НДС}=\mathrm{выручка}\cdot\frac{r}{1+r}`,
      hint: (ci) => {
        const m = R[ci]
        const base = m.rental + m.steamTotal + m.massageTotal + m.extraTotal + m.membershipTotal
        return {
          title: 'НДС выходной 19%',
          text: 'Выручка бань + услуг + членств × доля НДС в цене.',
          calc: `${e0(base)} × ${pc(eff19, 2)} = ${e0(T[ci].vatOut19)}`,
        }
      },
    },
    {
      label: `НДС ${pc(t.vatGlamp)} (глэмпинг+F&B)`, values: T.map((m) => m.vatOut9),
      tip: 'Пониженная ставка НДС на размещение и F&B.',
      hint: (ci) => {
        const m = R[ci]
        return {
          title: 'НДС выходной 9%',
          calc: `глэмпинг ${e0(m.glamping)}×${pc(t.vatGlamp / (1 + t.vatGlamp), 2)} + F&B ${e0(m.fb)}×${pc(t.vatFb / (1 + t.vatFb), 2)} = ${e0(T[ci].vatOut9)}`,
        }
      },
    },
    {
      label: 'Входной НДС', values: T.map((m) => m.inputVat),
      tip: reimb
        ? 'Режим «С возмещением»: НДС с OPEX помесячно и с CAPEX в первом месяце (земля не даёт входного НДС; отложенные модули — в месяц их ввода).'
        : 'Режим «Гросс»: входной НДС не возмещается и включён в расходы.',
      hint: (ci) => ({
        title: 'Входной НДС',
        text: reimb ? undefined : 'В режиме «Гросс» входной НДС не возмещается — всегда 0.',
        calc: reimb
          ? `(OPEX ${e0(r.opex[ci].fixedTotal + r.opex[ci].variableTotal)}${ci === 0 ? ` + CAPEX без земли ${e0(r.capex.amortizableEur)}` : ''}) × ${pc(eff19, 2)} = ${e0(T[ci].inputVat)}`
          : '—',
      }),
    },
    {
      label: 'НДС-кредит переходящий', values: T.map((m) => m.vatCredit),
      tip: 'Входной НДС сверх выходного переносится на следующие месяцы и уменьшает будущие платежи.',
      hint: (ci) => {
        const prev = ci > 0 ? T[ci - 1].vatCredit : 0
        const out = T[ci].vatOut19 + T[ci].vatOut9
        return {
          title: 'НДС-кредит',
          calc: `max(0, кредит ${e0(prev)} + входной ${e0(T[ci].inputVat)} − выходной ${e0(out)}) = ${e0(T[ci].vatCredit)}`,
        }
      },
    },
    {
      label: 'НДС к уплате', values: T.map((m) => m.vatPayable), bold: true,
      hint: (ci) => {
        const prev = ci > 0 ? T[ci - 1].vatCredit : 0
        const out = T[ci].vatOut19 + T[ci].vatOut9
        return {
          title: 'НДС к уплате',
          calc: `max(0, ${e0(out)} − ${e0(T[ci].inputVat)} − ${e0(prev)} кредит) = ${e0(T[ci].vatPayable)}`,
        }
      },
    },
    {
      label: 'CIT (июль/декабрь)', values: T.map((m) => m.cit),
      tip: 'Корпоративный налог на прибыль по календарным годам (перенос убытков). Провизиональный налог Кипра: авансы 31 июля и 31 декабря.',
      hint: (ci) => {
        const y = Math.min(years - 1, Math.floor(ci / 12))
        return {
          title: 'CIT',
          text: `Год ${y + 1}: CIT ${e0(r.citByYear[y] ?? 0)} (${pc(t.cit)} от налогооблагаемой базы с переносом убытков).`,
          calc: T[ci].cit
            ? `${e0(r.citByYear[y])} / число дат платежа года = ${e0(T[ci].cit)}`
            : 'Уплата только в июле и декабре',
        }
      },
    },
    {
      label: 'Дивиденды (лаг 12 мес)', values: T.map((m) => m.dividends),
      tip: 'Выплата партнёрам: чистая прибыль того же месяца годом ранее × доля распределения. Начинается с 13-го месяца.',
      hint: (ci) => {
        if (ci < 12) return { title: 'Дивиденды', text: 'Выплаты начинаются с 13-го месяца — распределяется прибыль с лагом в год.' }
        const np = r.pnl[ci - 12].netProfit
        return {
          title: 'Дивиденды',
          calc: `ЧП годом ранее ${e0(Math.max(0, np))} × доля партнёров ${pc(distShare)} = ${e0(T[ci].dividends)}`,
        }
      },
    },
    {
      label: 'Defence Tax (SDC)', values: T.map((m) => m.sdc),
      tip: 'Special Defence Contribution — налог на дивиденды резидентам Кипра; взвешен по долям партнёров.',
      hint: (ci) => ({
        title: 'SDC на дивиденды',
        calc: `${e0(T[ci].dividends)} × взвеш. ставка ${pc(sdcRate, 2)} = ${e0(T[ci].sdc)}`,
      }),
    },
    {
      label: 'GESY (здравоохранение)', values: T.map((m) => m.gesy),
      tip: 'Взнос GHS/GESY 2.65% на дивиденды резидентам Кипра — действует вместе с SDC; non-dom освобождены.',
      hint: (ci) => ({
        title: 'GESY на дивиденды',
        calc: `${e0(T[ci].dividends)} × взвеш. ставка ${pc(t.gesy * sdcRate / t.sdc || 0, 2)} = ${e0(T[ci].gesy)}`,
      }),
    },
    {
      label: 'ИТОГО НАЛОГИ', values: T.map((m) => m.total), bold: true,
      hint: (ci) => ({
        title: 'Итого налоги',
        calc: `НДС ${e0(T[ci].vatPayable)} + CIT ${e0(T[ci].cit)} + SDC ${e0(T[ci].sdc)} + GESY ${e0(T[ci].gesy)} = ${e0(T[ci].total)}`,
      }),
    },
  ]
  return (
    <div>
      <MonthTable rows={rows} labels={labels} withSum />
      <p className="note">CIT по годам: {r.citByYear.map((c, i) => `год${i + 1}: ${fmtEur(c)}`).join(' · ')}</p>
    </div>
  )
}

export function Pnl({ r, labels }: { r: ModelResult; labels: string[] }) {
  const P = r.pnl
  const arith = (title: string, text: string, parts: (ci: number) => string) => (ci: number): CellHint => ({
    title, text, calc: parts(ci),
  })
  const rows: RowDef[] = [
    {
      label: 'Выручка (брутто)', values: P.map((m) => m.revenueGross),
      tip: 'Вся выручка месяца, включая НДС внутри цен.',
      hint: (ci) => ({ title: 'Выручка брутто', calc: `Σ потоков выручки = ${e0(P[ci].revenueGross)}` }),
    },
    {
      label: 'НДС начисленный', values: P.map((m) => -m.revenueGross + m.revenueNet),
      tip: 'Выходной НДС, «сидящий» в брутто-выручке. Не путать с «НДС к уплате» из налогов: разница (входной кредит) проходит в Cash Flow строкой «ΔНДС».',
      hint: (ci) => ({ title: 'НДС начисленный', calc: `выходной ${e0(r.taxes[ci].vatOut)} (к уплате ${e0(r.taxes[ci].vatPayable)})` }),
    },
    {
      label: 'Выручка (нетто)', values: P.map((m) => m.revenueNet), bold: true,
      hint: (ci) => ({ title: 'Выручка нетто', calc: `${e0(P[ci].revenueGross)} − ${e0(r.taxes[ci].vatOut)} начисленный НДС = ${e0(P[ci].revenueNet)}` }),
    },
    {
      label: 'Переменные расходы', values: P.map((m) => m.variableOpex),
      tip: 'Расходники по справочнику номенклатуры (см. вкладку OPEX).',
      hint: arith('Переменные', 'Расходники по нормам на слот/гостя/месяц.', (ci) => `Σ статей = ${e0(P[ci].variableOpex)}`),
    },
    {
      label: '% от выручки', values: P.map((m) => m.pctOpex),
      tip: 'Эквайринг и ремонт — % от брутто-выручки; себестоимость F&B — % от выручки F&B.',
      hint: arith('% от выручки', '', (ci) => `${e0(r.opex[ci].pct.acquiring)} экв. + ${e0(r.opex[ci].pct.maintenance)} рем. + ${e0(r.opex[ci].pct.fbCost)} F&B + ${e0(r.opex[ci].pct.ota)} OTA = ${e0(P[ci].pctOpex)}`),
    },
    {
      label: 'Маржинальная прибыль', values: P.map((m) => m.marginalProfit), bold: true,
      tex: String.raw`\mathrm{MP}=\mathrm{выручка}_{нетто}-\mathrm{переменные}-\%\mathrm{расходы}`,
      hint: (ci) => ({ title: 'Маржинальная прибыль', calc: `${e0(P[ci].revenueNet)} − ${e0(P[ci].variableOpex)} − ${e0(P[ci].pctOpex)} = ${e0(P[ci].marginalProfit)}` }),
    },
    {
      label: 'Постоянные расходы', values: P.map((m) => m.fixedOpex),
      hint: arith('Постоянные', 'Фиксированные месячные статьи + IT/АСУ + аренда земли, с инфляцией.', (ci) => `Σ постоянных + IT + земля = ${e0(P[ci].fixedOpex)}`),
    },
    {
      label: 'ФОТ + взносы', values: P.map((m) => m.fot),
      hint: arith('ФОТ', 'Оклады + KPI-бонусы + взносы работодателя.', (ci) => `см. вкладку ФОТ = ${e0(P[ci].fot)}`),
    },
    {
      label: 'EBITDA', values: P.map((m) => m.ebitda), bold: true,
      tex: String.raw`\mathrm{EBITDA}=\mathrm{MP}-\mathrm{постоянные}-\mathrm{ФОТ}`,
      hint: (ci) => ({ title: 'EBITDA', calc: `${e0(P[ci].marginalProfit)} − ${e0(P[ci].fixedOpex)} − ${e0(P[ci].fot)} = ${e0(P[ci].ebitda)}` }),
    },
    {
      label: 'Маржа EBITDA', values: P.map((m) => (m.revenueNet ? m.ebitda / m.revenueNet : 0)), fmt: 'pct' as const,
      hint: (ci) => ({ title: 'Маржа EBITDA', calc: `${e0(P[ci].ebitda)} / ${e0(P[ci].revenueNet)} = ${pc(P[ci].revenueNet ? P[ci].ebitda / P[ci].revenueNet : 0)}` }),
    },
    {
      label: 'Амортизация', values: P.map((m) => m.amortization),
      hint: arith('Амортизация', 'Линейная по группам CAPEX — см. вкладку CAPEX.', () => `${e0(r.capex.monthlyAmort)}/мес`),
    },
    {
      label: 'EBIT', values: P.map((m) => m.ebit), bold: true,
      hint: (ci) => ({ title: 'EBIT', calc: `${e0(P[ci].ebitda)} − ${e0(P[ci].amortization)} = ${e0(P[ci].ebit)}` }),
    },
    {
      label: 'CIT', values: P.map((m) => m.cit),
      hint: arith('CIT', 'Корпоративный налог — авансы в июне и декабре.', (ci) => `${e0(P[ci].cit)}`),
    },
    {
      label: 'Чистая прибыль', values: P.map((m) => m.netProfit), bold: true,
      hint: (ci) => ({ title: 'Чистая прибыль', calc: `${e0(P[ci].ebit)} − ${e0(P[ci].cit)} = ${e0(P[ci].netProfit)}` }),
    },
    {
      label: 'Дивиденды', values: P.map((m) => m.dividends),
      hint: arith('Дивиденды', 'Чистая прибыль годом ранее × доля партнёров.', (ci) => `${e0(P[ci].dividends)}`),
    },
    {
      label: 'SDC + GESY', values: P.map((m) => m.sdc + m.gesy),
      hint: arith('SDC + GESY', 'Defence Tax 17% + здравоохранение 2.65% на дивиденды резидентов Кипра.', (ci) => `${e0(P[ci].sdc + P[ci].gesy)}`),
    },
    {
      label: 'ЧП после SDC', values: P.map((m) => m.netAfterSdc), bold: true,
      hint: (ci) => ({ title: 'ЧП после SDC', calc: `${e0(P[ci].netProfit)} − ${e0(P[ci].sdc)} = ${e0(P[ci].netAfterSdc)}` }),
    },
  ]
  return <MonthTable rows={rows} labels={labels} withSum />
}

export function CashFlow({ r }: { r: ModelResult }) {
  const { params } = useModel()
  const labels = r.cashflow.map((m) => m.label)
  const C = r.cashflow
  const sc = r.scenario
  const presaleStart = params.meta.capexMonths - params.units.presaleMonths + 1
  const ops = (ci: number, text: string) => (C[ci].isOps ? text : 'Период строительства — операций нет.')
  const rows: RowDef[] = [
    {
      label: 'Чистая прибыль', values: C.map((m) => m.netProfit),
      hint: (ci) => ({ title: 'Чистая прибыль', text: ops(ci, 'Из P&L соответствующего операционного месяца.'), calc: C[ci].isOps ? `${e0(C[ci].netProfit)}` : undefined }),
    },
    {
      label: '+ Амортизация', values: C.map((m) => m.amortization),
      hint: (ci) => ({ title: 'Амортизация', text: ops(ci, 'Неденежная статья — возвращается в поток.'), calc: C[ci].isOps ? `${e0(C[ci].amortization)}` : undefined }),
    },
    {
      label: '+ ΔНДС (начисл. − уплач.)', values: C.map((m) => m.vatTiming),
      tip: 'Кэш-корректировка НДС: P&L берёт начисленный выходной НДС, а уплачивается меньше на входной кредит — разница остаётся в деньгах. В режиме «Гросс» всегда 0.',
      hint: (ci) => ({
        title: 'ΔНДС',
        calc: C[ci].vatTiming ? `${e0(r.pnl[ci - params.meta.capexMonths]?.vatOut ?? 0)} − ${e0(r.pnl[ci - params.meta.capexMonths]?.vatPayable ?? 0)} = ${e0(C[ci].vatTiming)}` : '—',
      }),
    },
    {
      label: 'Операционный CF', values: C.map((m) => m.operatingCf), bold: true,
      hint: (ci) => ({ title: 'Операционный CF', calc: `${e0(C[ci].netProfit)} + ${e0(C[ci].amortization)} + (${e0(C[ci].vatTiming)}) ΔНДС = ${e0(C[ci].operatingCf)}` }),
    },
    {
      label: 'CAPEX', values: C.map((m) => m.capex),
      tip: `Инвестиции распределены равномерно по ${params.meta.capexMonths} мес строительства.`,
      hint: (ci) => ({
        title: 'CAPEX',
        calc: C[ci].capex ? `−${e0(r.capex.adjustedEur)} / ${params.meta.capexMonths} мес = ${e0(C[ci].capex)}` : '—',
      }),
    },
    ...(r.capex.deferred.length
      ? [{
          label: 'CAPEX модулей (отложенный)', values: C.map((m) => m.deferredCapex),
          tip: 'Real option: модуль со статусом «Активен» и вводом после открытия платит свою долю помодульного CAPEX в месяц запуска, а не в стройке.',
          hint: (ci: number): CellHint => ({ title: 'Отложенный CAPEX', calc: C[ci].deferredCapex ? e0(C[ci].deferredCapex) : '—' }),
        }]
      : []),
    {
      label: 'Пре-сейл', values: C.map((m) => m.presale),
      tip: `Продажа депозитов до открытия — месяцы ${presaleStart}–${params.meta.capexMonths} стройки.`,
      hint: (ci) => ({ title: 'Пре-сейл', calc: C[ci].presale ? `${e0(sc.presaleMonthly)}/мес` : '—' }),
    },
    {
      label: '− Прогорание пре-сейла', values: C.map((m) => m.presaleUnwind),
      tip: 'Deferred-режим: членства, проданные в пресейле, доходят в первые месяцы операционки без нового кэша.',
      hint: (ci) => ({ title: 'Прогорание пре-сейла', calc: C[ci].presaleUnwind ? e0(C[ci].presaleUnwind) : '—' }),
    },
    {
      label: 'Пул предоплат (обязат.)', values: C.map((m) => m.prepaidPool),
      tip: 'Deferred revenue: остаток обязательств перед гостями — принятый пресейл минус прогоревший. Депозиты гостей сгорают в день визита и пула не создают.',
      hint: (ci) => ({ title: 'Пул предоплат', text: 'Балансовое обязательство: деньги получены, услуга ещё не оказана.', calc: e0(C[ci].prepaidPool) }),
    },
    ...(params.preopen.enabled
      ? [{
          label: '− Pre-opening (ФОТ + фикс)', values: C.map((m) => m.preopen),
          tip: `Последние ${params.preopen.months} мес стройки: штат нанят, объект работает вхолостую — оклады с взносами + постоянные/IT расходы.`,
          hint: (ci: number): CellHint => ({ title: 'Pre-opening', calc: C[ci].preopen ? e0(C[ci].preopen) + '/мес' : '—' }),
        }]
      : []),
    ...(params.land.mode === 'lease'
      ? [{
          label: '− Аренда земли (стройка)', values: C.map((m) => m.landLease),
          tip: 'Участок арендуется до открытия: платежи в период стройки идут отдельным оттоком, в операционке — в OPEX.',
          hint: (ci: number): CellHint => ({ title: 'Аренда земли', calc: C[ci].landLease ? `${e0(params.land.rentMonthly)}/мес` : '—' }),
        }]
      : []),
    {
      label: 'FCFF', values: C.map((m) => m.fcff), bold: true,
      tex: String.raw`\mathrm{FCFF}=\mathrm{OCF}+\mathrm{CAPEX}+\mathrm{пресейл}+\mathrm{прогорание}+\mathrm{земля}+\mathrm{preopen}`, // OCF включает ΔНДС
      hint: (ci) => ({ title: 'FCFF', text: 'Свободный денежный поток фирмы до распределений.', calc: `${e0(C[ci].operatingCf)} + ${e0(C[ci].capex)} + (${e0(C[ci].deferredCapex)}) + ${e0(C[ci].presale)} + (${e0(C[ci].presaleUnwind)}) + (${e0(C[ci].landLease)}) + (${e0(C[ci].preopen)}) = ${e0(C[ci].fcff)}` }),
    },
    {
      label: 'Дивиденды и УК', values: C.map((m) => m.dividends),
      hint: (ci) => ({ title: 'Дивиденды', calc: C[ci].dividends ? `${e0(C[ci].dividends)}` : '—' }),
    },
    {
      label: 'Defence Tax + GESY', values: C.map((m) => m.sdc + m.gesy),
      hint: (ci) => ({ title: 'SDC + GESY', calc: C[ci].sdc || C[ci].gesy ? `${e0(C[ci].sdc + C[ci].gesy)}` : '—' }),
    },
    {
      label: 'CF после распределения', values: C.map((m) => m.totalCf), bold: true,
      hint: (ci) => ({ title: 'CF после распределения', calc: `${e0(C[ci].fcff)} + ${e0(C[ci].dividends)} + ${e0(C[ci].sdc + C[ci].gesy)} = ${e0(C[ci].totalCf)}` }),
    },
    {
      label: 'Остаток денег', values: C.map((m) => m.cumCash),
      tip: 'Накопленный остаток денежных средств на конец месяца.',
      hint: (ci) => ({ title: 'Остаток денег', calc: `Σ CF с начала = ${e0(C[ci].cumCash)}` }),
    },
    {
      label: 'Накопл. FCFF', values: C.map((m) => m.cumFcff),
      hint: (ci) => ({ title: 'Накопл. FCFF', calc: `Σ FCFF с начала = ${e0(C[ci].cumFcff)}` }),
    },
    {
      label: 'Дисконт. FCFF', values: C.map((m) => m.discountedFcff),
      tex: String.raw`\mathrm{DF}=\frac{1}{(1+\mathrm{WACC}/12)^{m}},\quad \mathrm{DCF}=\mathrm{FCFF}\cdot\mathrm{DF}`,
      tip: `FCFF, приведённый к текущему моменту по ставке WACC = ${pc(params.general.wacc)} годовых.`,
      hint: (ci) => ({
        title: 'Дисконтированный FCFF',
        calc: `${e0(C[ci].fcff)} × DF ${C[ci].discountFactor.toFixed(3)} = ${e0(C[ci].discountedFcff)}`,
      }),
    },
    {
      label: 'Накопл. DCF (NPV)', values: C.map((m) => m.cumDcf), bold: true,
      tip: 'Бегущий NPV проекта — в последней колонке равен NPV за весь горизонт.',
      hint: (ci) => ({ title: 'NPV накопительно', calc: `Σ дисконт. FCFF = ${e0(C[ci].cumDcf)}` }),
    },
  ]
  return <MonthTable rows={rows} labels={labels} withSum />
}

export { monthLabels }
