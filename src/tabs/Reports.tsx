import { Fragment, useState } from 'react'
import { Button, TextInput } from '@mantine/core'
import type { ModelResult, ModuleSpec, NomenclatureItem, Params } from '../model/types'
import { landedCost, activeModuleCount } from '../model/opex'
import { baseSalariesMonthly, headcountAt } from '../model/fot'
import { capexWeights } from '../model/cashflow'
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
    `+ Доп.услуги ${e0(m.extraTotal)} + Глэмпинг ${e0(m.glamping)} + Членства ${e0(m.membershipTotal)} + F&B ${e0(m.fb)}` +
    (m.publicBath + m.restaurant > 0 ? ` + Общ.баня ${e0(m.publicBath)} + Ресторан ${e0(m.restaurant)}` : '')

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
        text: 'Проданные слоты × цена слота модуля (фиксирована баней: оч. 1 — 250/500/750, VIP оч. 2 — 500/500/350/750; доли бань равные) × годовой рост цен.',
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
      const fbGuests = m.guests - m.publicGuests
      return {
        title: 'F&B (чайная зона)',
        text: 'Представительские продажи: гости × средний чек на гостя × рост цен. Гости общественной бани сюда не входят — питаются в ресторане.',
        calc: `${fmt(fbGuests)} гостей × ${e1(params.prices.fbPerGuest)} × рост ${gAt(i).toFixed(2)} = ${e0(m.fb)}`,
      }
    },
    publicBath: (i: number): CellHint => {
      const m = R[i]
      const pb = params.publicBath
      return {
        title: 'Общественная баня (оч. 2)',
        text: `Посетители = 30 дн × пропускная ${pb?.capacity ?? 0} чел/день × загрузка сценария (% пропускной) × сезонность × рампа оч. 2. Билет = вход + все зоны.`,
        calc: `${fmt(m.publicGuests)} гостей × ${e0(pb?.ticketEur ?? 0)} × рост ${gAt(i).toFixed(2)} = ${e0(m.publicBath)}`,
      }
    },
    restaurant: (i: number): CellHint => {
      const m = R[i]
      const rest = params.restaurant
      return {
        title: 'Ресторан (оч. 2)',
        text: `Посадки = 30 дн × ${rest?.seats ?? 0} мест × ${rest?.turnsPerDay ?? 0} оборота × загрузка; чек индексируется инфляцией. Плейсхолдер-поток.`,
        calc: `${e0(m.restaurant)} (чек ${e0(rest?.avgCheck ?? 0)} × инфляция года)`,
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
    ...(R.some((m) => m.publicBath > 0)
      ? [{ label: 'Общественная баня (оч. 2)', values: stream((m) => m.publicBath), hint: h.publicBath }]
      : []),
    ...(R.some((m) => m.restaurant > 0)
      ? [{ label: 'Ресторан (оч. 2)', values: stream((m) => m.restaurant), hint: h.restaurant }]
      : []),
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
    ...O[0].variable.map((v) => {
      // Детализация статьи до позиций номенклатуры: нормы (слот/гость/мес)
      // и спековое списание — раскрывается кликом по статье.
      const codes = [...new Set(
        O.flatMap((m) => m.variableDetail.filter((d) => d.article === v.article).map((d) => d.code)),
      )]
      const children: RowDef[] = codes.map((code) => {
        const any = O.map((m) => m.variableDetail.find((d) => d.article === v.article && d.code === code)).find(Boolean)!
        return {
          label: `${code} · ${any.name}`,
          values: O.map((m) => m.variableDetail.find((d) => d.article === v.article && d.code === code)?.amount ?? 0),
          hint: (ci: number): CellHint | null => {
            const d = O[ci].variableDetail.find((x) => x.article === v.article && x.code === code)
            if (!d || d.qty <= 0) return null
            return {
              title: `${d.code} ${d.name}`,
              text: d.basis === 'спека'
                ? 'Списание через спеки услуг: Σ (кол-во в спеке × продано услуг месяца) × landed-цена (цена + доставка), с индексацией на инфляцию.'
                : `Нормативный расход: норма × база «${d.basis}» месяца × landed-цена (цена + доставка), с индексацией на инфляцию.`,
              calc: `${fmt(d.qty, 2)} ${d.unit} × ${e1(d.landed)} € × инфл ${inflAt(ci).toFixed(2)} = ${e0(d.amount)}`,
            }
          },
        }
      })
      return {
        label: v.article,
        values: O.map((m) => m.variable.find((x) => x.article === v.article)?.amount ?? 0),
        hint: variableHint(v.article),
        children,
      }
    }),
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
  return <MonthTable rows={rows} labels={labels} withSum searchable />
}

export function Fot({ r, labels }: { r: ModelResult; labels: string[] }) {
  const { params } = useModel()
  const F = r.fot
  const R = r.revenue
  const inflAt = (k: number) => Math.pow(1 + params.general.inflation, Math.floor(k / 12))
  const rows: RowDef[] = [
    {
      label: 'Оклады (фикс.)', values: F.map((m) => m.salaries),
      tip: `Фонд окладов штата${params.it.enabled ? ` (включая IT-куратора ${e0(params.it.curator)}/мес)` : ''}${params.fb.enabled ? ` и повара (${params.fb.cookCount} × ${e0(params.fb.cookSalary)}/мес)` : ''}, индексируется на инфляцию ежегодно.${params.fot.phases?.length ? ' Численность растёт ступенями по фазам (Штат → колонки по датам).' : ''}`,
      hint: (ci) => ({
        title: 'Оклады',
        text: `Штат месяца: ${fmt(headcountAt(params, ci, r.scenario.constructionDelayMonths).reduce((a, b) => a + b, 0))} ставок (без условных ролей).`,
        calc: `${e0(baseSalariesMonthly(params, ci, r.scenario.constructionDelayMonths))}/мес × инфл ${inflAt(ci).toFixed(2)} = ${e0(F[ci].salaries)}`,
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
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const qq = q.trim().toLowerCase()
  const filtering = qq.length > 0
  const hit = (...s: (string | undefined)[]) =>
    s.some((x) => x != null && x.toLowerCase().includes(qq))
  const toggle = (k: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  const isOpen = (k: string) => filtering || !collapsed.has(k)
  const amortTex = String.raw`\mathrm{аморт}=\sum_{групп}\frac{\mathrm{CAPEX}\cdot\mathrm{доля}_{группы}}{\mathrm{срок}_{лет}\cdot 12}`
  // Разделы сметы: строки с одинаковой группой собираются в один блок
  // (порядок разделов = порядок первого появления в capexItems, IT и земля в конце)
  const groups: { name: string; items: typeof capex.items; total: number }[] = []
  const gidx = new Map<string, number>()
  for (const it of capex.items) {
    const g = `${it.phase === 2 ? 'Оч.2 · ' : ''}${it.group ?? 'Прочее'}`
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
  // Отфильтрованная структура строки: совпадение ищем по названию позиции,
  // кодам/названиям WBS, категориям затрат и SKU наполнения
  const itemView = (it: (typeof capex.items)[number]) => {
    const itemHit = !filtering || hit(it.name, it.group)
    const isNomenclature = it.detail?.some((d) => d.category)
    const wbsOut = (it.wbs ?? [])
      .map((sec) => {
        const secHit = itemHit || hit(sec.code, sec.title)
        const lines = secHit ? sec.items : sec.items.filter((l) => hit(l.code, l.name, l.tag))
        return { sec, lines }
      })
      .filter((x) => x.lines.length > 0)
    const detailOut =
      itemHit || !filtering ? (it.detail ?? []) : (it.detail ?? []).filter((d) => hit(d.code, d.name, d.category))
    const catGroups: { name: string; rows: NonNullable<typeof it.detail>; total: number }[] = []
    if (isNomenclature) {
      const cix = new Map<string, number>()
      for (const d of detailOut) {
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
    const visible = itemHit || wbsOut.length > 0 || detailOut.length > 0
    return { it, itemHit, isNomenclature, wbsOut, detailOut, catGroups, visible }
  }
  const ItemRows = ({ v }: { v: ReturnType<typeof itemView> }) => {
    const { it, isNomenclature, wbsOut, detailOut, catGroups } = v
    return (
      <Fragment>
        <tr>
          <td className="sticky"><b>{it.name}</b></td>
          <td>{it.unit ?? ''}</td>
          <td>{qty2(it.qty)}</td>
          <td>{qty2(it.rate)}</td>
          <td><b>{fmt(it.eur)}</b></td>
        </tr>
        {wbsOut.map(({ sec, lines }) => {
          const k = `s:${it.name}:${sec.code}`
          const open = isOpen(k)
          return (
            <Fragment key={sec.code}>
              <tr className="wbs-sec spec-head" onClick={() => toggle(k)}>
                <td className="sticky">
                  <span className="spec-caret">{open ? '▾' : '▸'}</span>
                  {sec.code} {sec.title}
                </td>
                <td /><td /><td />
                <td>{fmt(lines.reduce((s, l) => s + l.eur, 0))}</td>
              </tr>
              {open &&
                lines.map((l) => (
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
          )
        })}
        {!isNomenclature &&
          detailOut.map((d) => (
            <tr key={`${it.name}-${d.code}`} className="sub-detail">
              <td className="sticky"><small>{d.code} · {d.name}</small></td>
              <td><small>{d.unit ?? ''}</small></td>
              <td><small>{qty2(d.qty)}</small></td>
              <td><small>{fmt(d.landed, 2)}</small></td>
              <td><small>{fmt(d.eur)}</small></td>
            </tr>
          ))}
        {catGroups.map((cg) => {
          const k = `c:${it.name}:${cg.name}`
          const open = isOpen(k)
          return (
            <Fragment key={cg.name}>
              <tr className="wbs-sec spec-head" onClick={() => toggle(k)}>
                <td className="sticky">
                  <span className="spec-caret">{open ? '▾' : '▸'}</span>
                  {cg.name}
                </td>
                <td /><td /><td />
                <td>{fmt(cg.total)}</td>
              </tr>
              {open &&
                cg.rows.map((d) => (
                  <tr key={d.code} className="wbs-line">
                    <td className="sticky"><small>{d.code} {d.name}</small></td>
                    <td><small>{d.unit ?? ''}</small></td>
                    <td><small>{qty2(d.qty)}</small></td>
                    <td><small>{fmt(d.landed, 2)}</small></td>
                    <td><small>{fmt(d.eur)}</small></td>
                  </tr>
                ))}
            </Fragment>
          )
        })}
      </Fragment>
    )
  }
  // Ключи всех сворачиваемых блоков — для «Свернуть всё»
  const allKeys: string[] = []
  for (const g of groups) {
    allKeys.push(`g:${g.name}`)
    for (const it of g.items) {
      for (const sec of it.wbs ?? []) allKeys.push(`s:${it.name}:${sec.code}`)
      if (it.detail?.some((d) => d.category))
        for (const c of new Set(it.detail.map((d) => d.category ?? 'Прочее'))) allKeys.push(`c:${it.name}:${c}`)
    }
  }
  const views = groups.map((g) => ({
    ...g,
    items: g.items.map(itemView).filter((v) => v.visible),
  }))
  return (
    <div>
      <div className="controls" style={{ marginBottom: 10 }}>
        <TextInput
          placeholder="Фильтр по статье, коду WBS, категории или SKU…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={400}
          size="sm"
        />
        {filtering && <span className="note">позиций: {views.reduce((s, g) => s + g.items.length, 0)}</span>}
        <Button size="sm" variant="light" onClick={() => setCollapsed(new Set(allKeys))}>Свернуть всё</Button>
        <Button size="sm" variant="light" onClick={() => setCollapsed(new Set())}>Развернуть всё</Button>
      </div>
      <div className="table-wrap">
        <table className="month-table scen capex-table">
          <thead>
            <tr>
              <th className="sticky"><Hint hint={{ text: 'Клик по разделу раскрывает строки сметы; у строк с WBS — детализацию работ и материалов.' }}><span>Статья затрат / элемент работ</span></Hint></th>
              <th><Hint hint={{ text: 'Единица измерения.' }}><span>Ед.</span></Hint></th>
              <th><Hint hint={{ text: 'Количество единиц (для помодульных строк — с учётом активных модулей).' }}><span>Кол-во</span></Hint></th>
              <th><Hint hint={{ text: 'Цена за единицу / ставка работ.' }}><span>Ставка, €</span></Hint></th>
              <th><Hint hint={{ text: 'Кол-во × ставка. Для WBS-строк — сумма позиций детализации.' }}><span>Сумма, €</span></Hint></th>
            </tr>
          </thead>
          <tbody>
            {views.map((g, gi) => {
              if (g.items.length === 0) return null
              const gk = `g:${g.name}`
              const gOpen = isOpen(gk)
              const gTotal = g.items.reduce((s, v) => s + v.it.eur, 0)
              return (
                <Fragment key={g.name}>
                  <tr className="capex-group spec-head" onClick={() => toggle(gk)}>
                    <td className="sticky">
                      <span className="spec-caret">{gOpen ? '▾' : '▸'}</span>
                      Раздел {gi + 1}. {g.name}
                    </td>
                    <td /><td /><td />
                    <td>{fmt(gTotal)}</td>
                  </tr>
                  {gOpen && g.items.map((v) => <ItemRows key={v.it.name} v={v} />)}
                </Fragment>
              )
            })}
          <tr className="bold">
            <td className="sticky">ИТОГО CAPEX — очередь 1</td>
            <td /><td /><td />
            <td><Hint hint={{ title: 'Итого CAPEX очереди 1', text: 'Сумма инвестиционных позиций стартового контура: смета стройки, наполнение (оборудование и мебель из номенклатуры), закуп стартовых запасов, IT-пакет и земля.' }}><span className="cellval">{fmt(capex.totalEur)}</span></Hint></td>
          </tr>
          {capex.phase2Eur > 0 && (
            <tr className="bold">
              <td className="sticky">ИТОГО CAPEX — очередь 2</td>
              <td /><td /><td />
              <td>
                <Hint hint={{
                  title: 'CAPEX очереди 2',
                  text: 'Сумма строк phase=2 включённых объектов (объектные + общие строки) и закупа стартовых запасов оч. 2. Отток растянут по окну стройки 2029–2030; свой буфер — из блока «Очередь 2» в Допущениях.',
                  calc: `смета ${e0(capex.phase2Eur)} × буфер ${1 + (params.phase2?.capexAdj ?? 0)} = ${e0(capex.phase2AdjEur)}`,
                }}>
                  <span className="cellval">{fmt(capex.phase2AdjEur)}</span>
                </Hint>
              </td>
            </tr>
          )}
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
        const base = m.rental + m.steamTotal + m.massageTotal + m.extraTotal + m.membershipTotal + m.publicBath
        return {
          title: 'НДС выходной 19%',
          text: 'Выручка бань + услуг + членств + общественной бани (оч. 2) × доля НДС в цене.',
          calc: `${e0(base)} × ${pc(eff19, 2)} = ${e0(T[ci].vatOut19)}`,
        }
      },
    },
    {
      label: `НДС ${pc(t.vatGlamp)} (глэмпинг+F&B+ресторан)`, values: T.map((m) => m.vatOut9),
      tip: 'Пониженная ставка НДС на размещение и F&B; ресторан оч. 2 идёт по ставке F&B.',
      hint: (ci) => {
        const m = R[ci]
        return {
          title: 'НДС выходной 9%',
          calc: `глэмпинг ${e0(m.glamping)}×${pc(t.vatGlamp / (1 + t.vatGlamp), 2)} + F&B+ресторан ${e0(m.fb + m.restaurant)}×${pc(t.vatFb / (1 + t.vatFb), 2)} = ${e0(T[ci].vatOut9)}`,
        }
      },
    },
    {
      label: 'Входной НДС', values: T.map((m) => m.inputVat),
      tip: reimb
        ? 'Режим «С возмещением»: НДС с OPEX помесячно; с CAPEX оч. 1 — в первом месяце операционки; модули оч. 1 с поздним вводом — в месяц ввода; стройка оч. 2 — помесячно в окне 2029–2030. Земля входного НДС не даёт.'
        : 'Режим «Гросс»: входной НДС не возмещается и включён в расходы.',
      hint: (ci) => ({
        title: 'Входной НДС',
        text: reimb ? undefined : 'В режиме «Гросс» входной НДС не возмещается — всегда 0.',
        calc: reimb
          ? `(OPEX ${e0(r.opex[ci].fixedTotal + r.opex[ci].variableTotal + r.opex[ci].itTotal)}${ci === 0 ? ` + CAPEX оч. 1 без земли и отложенного ${e0(r.capex.amortizableEur - r.capex.deferredPhase1Total)}` : ''}${r.capex.deferred.some((d) => d.month - params.meta.capexMonths - 1 === ci) ? ` + отложенный CAPEX месяца ${e0(r.capex.deferred.filter((d) => d.month - params.meta.capexMonths - 1 === ci).reduce((s, d) => s + d.eur, 0))}` : ''}) × ${pc(eff19, 2)} = ${e0(T[ci].inputVat)}`
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
  const { params } = useModel()
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
      tip: 'Расходники по справочнику номенклатуры: нормы на слот/гостя/месяц + материалы спецификаций по числу проведённых услуг (см. вкладку OPEX).',
      hint: arith('Переменные', 'Нормативное списание + спековые материалы, по landed-цене с инфляцией.', (ci) => `Σ статей = ${e0(P[ci].variableOpex)}`),
    },
    {
      label: '% от выручки', values: P.map((m) => m.pctOpex),
      tip: 'Эквайринг и ремонт — % от брутто-выручки; food-cost кафе-бара и ресторана оч. 2 — % от их выручки; OTA — от ночей глэмпинга через агрегаторы.',
      hint: arith('% от выручки', '', (ci) => `${e0(r.opex[ci].pct.acquiring)} экв. + ${e0(r.opex[ci].pct.maintenance)} рем. + ${e0(r.opex[ci].pct.fbCost)} F&B + ${e0(r.opex[ci].pct.ota)} OTA${r.opex[ci].pct.restCost ? ` + ${e0(r.opex[ci].pct.restCost)} ресторан` : ''} = ${e0(P[ci].pctOpex)}`),
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
      hint: arith('Амортизация', 'Линейная по группам CAPEX, помесячно по датам ввода: база оч. 1 с открытия, объекты оч. 2 — с их ввода (см. вкладку CAPEX).', (ci) => `${e0(P[ci].amortization)}/мес${P[ci].amortization > r.capex.monthlyAmort + 1 ? ` (оч. 1 ${e0(r.capex.monthlyAmort)} + оч. 2 / поздние модули ${e0(P[ci].amortization - r.capex.monthlyAmort)})` : ''}`),
    },
    {
      label: 'EBIT', values: P.map((m) => m.ebit), bold: true,
      hint: (ci) => ({ title: 'EBIT', calc: `${e0(P[ci].ebitda)} − ${e0(P[ci].amortization)} = ${e0(P[ci].ebit)}` }),
    },
    {
      label: 'CIT', values: P.map((m) => m.cit),
      hint: arith('CIT', `Корпоративный налог ${pc(params.taxes.cit)} по календарным годам с переносом убытков — провизиональные авансы в июле и декабре.`, (ci) => `${e0(P[ci].cit)}`),
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
      hint: arith('SDC + GESY', `Defence Tax ${pc(params.taxes.sdc)} + здравоохранение ${pc(params.taxes.gesy, 2)} — удерживаются из дивидендов резидентов-домицилов (Non-Dom освобождён); справочно, не отток компании.`, (ci) => `${e0(P[ci].sdc + P[ci].gesy)}`),
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
  // Фактическая длина стройки — с учётом сценарной задержки
  const capM = C.filter((m) => !m.isOps).length
  const presaleStart = capM - params.units.presaleMonths + 1
  const weights = capexWeights({ ...params, meta: { ...params.meta, capexMonths: capM } })
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
        calc: C[ci].vatTiming ? `${e0(r.pnl[ci - capM]?.vatOut ?? 0)} − уплачено ${e0(r.pnl[ci - capM]?.vatPaid ?? 0)} = ${e0(C[ci].vatTiming)}` : '—',
      }),
    },
    {
      label: 'Операционный CF', values: C.map((m) => m.operatingCf), bold: true,
      hint: (ci) => ({ title: 'Операционный CF', calc: `${e0(C[ci].netProfit)} + ${e0(C[ci].amortization)} + (${e0(C[ci].vatTiming)}) ΔНДС = ${e0(C[ci].operatingCf)}` }),
    },
    {
      label: 'CAPEX', values: C.map((m) => m.capex),
      tip: `Инвестиции по S-кривой освоения за ${capM} мес строительства${sc.constructionDelayMonths ? ` (включая задержку ${sc.constructionDelayMonths} мес)` : ''}: проект/разрешения → основной объём → импорт и монтаж.`,
      hint: (ci) => ({
        title: 'CAPEX',
        calc: C[ci].capex ? `−(${e0(r.capex.adjustedEur)} − отложенные оч.1 ${e0(r.capex.deferredPhase1Total)}) × вес ${pc(weights[ci] ?? 0)} = ${e0(C[ci].capex)}` : '—',
      }),
    },
    ...(r.capex.deferred.length
      ? [{
          label: 'CAPEX отложенный (оч.1/оч.2)', values: C.map((m) => m.deferredCapex),
          tip: 'Отложенные платежи: модули оч. 1 с вводом после открытия платят в месяц запуска; очередь 2 — помесячный отток по окну стройки (2029–2030), а не траншем при вводе.',
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
    ...(params.capexMaint.enabled
      ? [{
          label: '− Maintenance CAPEX', values: C.map((m) => m.maintCapex),
          tip: `Reserve for replacement ${pc(params.capexMaint.pctPerYear)} амортизируемого CAPEX в год с ${params.capexMaint.startYear}-го года операций + капремонт ${e0(params.capexMaint.lumpEur)} в году ${params.capexMaint.lumpYear}.`,
          hint: (ci: number): CellHint => ({ title: 'Maintenance CAPEX', calc: C[ci].maintCapex ? e0(C[ci].maintCapex) : '—' }),
        }]
      : []),
    {
      label: 'FCFF', values: C.map((m) => m.fcff), bold: true,
      tex: String.raw`\mathrm{FCFF}=\mathrm{OCF}+\mathrm{CAPEX}+\mathrm{пресейл}+\mathrm{прогорание}+\mathrm{земля}+\mathrm{preopen}+\mathrm{maint}`, // OCF включает ΔНДС
      hint: (ci) => ({ title: 'FCFF', text: 'Свободный денежный поток фирмы до распределений.', calc: `${e0(C[ci].operatingCf)} + ${e0(C[ci].capex)} + (${e0(C[ci].deferredCapex)}) + ${e0(C[ci].presale)} + (${e0(C[ci].presaleUnwind)}) + (${e0(C[ci].landLease)}) + (${e0(C[ci].preopen)}) + (${e0(C[ci].maintCapex)}) = ${e0(C[ci].fcff)}` }),
    },
    {
      label: 'Дивиденды брутто (вкл. УК)', values: C.map((m) => m.dividends),
      tip: 'Отток компании. SDC и GESY удерживаются ИЗ этой суммы при выплате резидентам — не дополнительный расход компании.',
      hint: (ci) => ({ title: 'Дивиденды брутто', calc: C[ci].dividends ? `${e0(C[ci].dividends)}, в т.ч. удержано SDC+GESY ${e0(C[ci].sdc + C[ci].gesy)}` : '—' }),
    },
    {
      label: '  в т.ч. удержано SDC + GESY', values: C.map((m) => -(m.sdc + m.gesy)),
      tip: 'Справочно: часть дивидендов, перечисляемая в бюджет вместо акционеров-резидентов (внутри строки выше).',
      hint: (ci) => ({ title: 'SDC + GESY (удержание)', calc: C[ci].sdc || C[ci].gesy ? `${e0(C[ci].sdc)} + ${e0(C[ci].gesy)}` : '—' }),
    },
    {
      label: 'CF после распределения', values: C.map((m) => m.totalCf), bold: true,
      hint: (ci) => ({ title: 'CF после распределения', calc: `${e0(C[ci].fcff)} + ${e0(C[ci].dividends)} = ${e0(C[ci].totalCf)}` }),
    },
    ...(r.cashflow.some((m) => m.phase2Equity > 0)
      ? [{
          label: '  в т.ч. транш оч. 2 (equity)', values: C.map((m) => m.phase2Equity),
          tip: 'Финансирование очереди 2 режимом «Отдельный транш»: акционеры вносят ровно отток стройки месяца — входит в строку equity-транша ниже, отдельно не суммируется.',
          hint: (ci: number): CellHint => ({ title: 'Транш очереди 2 (в составе equity)', calc: C[ci].phase2Equity ? e0(C[ci].phase2Equity) : '—' }),
        }]
      : []),
    {
      label: '+ Equity-транш акционеров', values: C.map((m) => m.equityIn),
      tip: 'Взнос, закрывающий кассовый разрыв месяца: касса не уходит в минус. Σ траншей — потребность в собственном капитале.',
      hint: (ci) => ({ title: 'Equity-транш', calc: C[ci].equityIn ? `max(0, −(касса_пред + CF)) = ${e0(C[ci].equityIn)}` : '—' }),
    },
    {
      label: 'Касса на конец месяца', values: C.map((m) => m.cash), bold: true,
      tip: 'Остаток денег с учётом equity-траншей (≥ 0). Без траншей накопленный CF — строкой ниже.',
      hint: (ci) => ({ title: 'Касса', calc: `${e0(ci ? C[ci - 1].cash : 0)} + ${e0(C[ci].totalCf)} + ${e0(C[ci].equityIn)} = ${e0(C[ci].cash)}` }),
    },
    {
      label: 'Накопл. CF (без траншей)', values: C.map((m) => m.cumCash),
      hint: (ci) => ({ title: 'Накопленный CF', calc: `Σ CF после распределения = ${e0(C[ci].cumCash)}` }),
    },
    {
      label: 'Накопл. FCFF', values: C.map((m) => m.cumFcff),
      hint: (ci) => ({ title: 'Накопл. FCFF', calc: `Σ FCFF с начала = ${e0(C[ci].cumFcff)}` }),
    },
    {
      label: 'Дисконт. FCFF', values: C.map((m) => m.discountedFcff),
      tex: String.raw`\mathrm{DF}=\frac{1}{(1+\mathrm{WACC})^{m/12}},\quad \mathrm{DCF}=\mathrm{FCFF}\cdot\mathrm{DF}`,
      tip: `FCFF, приведённый к текущему моменту по эффективной ставке WACC = ${pc(r.kpis.wacc)} годовых (месячная (1+WACC)^(1/12)−1).`,
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
  return (
    <>
      <MonthTable rows={rows} labels={labels} withSum />
      <SourcesUses r={r} />
      <Balance r={r} />
    </>
  )
}

// Источники и использование средств: куда ушли деньги и чем закрыты (аудит 14, I-2/I-11)
function SourcesUses({ r }: { r: ModelResult }) {
  const C = r.cashflow
  const sum = (f: (m: typeof C[number]) => number) => C.reduce((s, m) => s + f(m), 0)
  const build = C.filter((m) => !m.isOps)
  const uses: [string, number][] = [
    ['Строительный CAPEX (с буфером)', -sum((m) => m.capex)],
    ['CAPEX отложенный (оч.1/оч.2)', -sum((m) => m.deferredCapex)],
    ['Maintenance CAPEX и капремонт', -sum((m) => m.maintCapex)],
    ['Pre-opening и аренда земли в стройке', -sum((m) => m.preopen + m.landLease)],
    ['Операционные убытки (месяцы с OCF < 0)', -sum((m) => Math.min(0, m.operatingCf))],
    ['Дивиденды брутто', -sum((m) => m.dividends)],
    ['Остаток кассы на конец горизонта', C[C.length - 1].cash],
  ]
  const sources: [string, number][] = [
    ['Equity-транши акционеров', sum((m) => m.equityIn)],
    ['Пре-сейл (предоплаты)', sum((m) => m.presale)],
    ['Операционный CF (месяцы с OCF > 0)', sum((m) => Math.max(0, m.operatingCf))],
    ['Прогорание пресейла (неденежное)', sum((m) => m.presaleUnwind)],
  ]
  const tU = uses.reduce((s, [, v]) => s + v, 0)
  const tS = sources.reduce((s, [, v]) => s + v, 0)
  const tranches = C.map((m, i) => ({ m, i })).filter((x) => x.m.equityIn > 0)
  const byPeriod = { build: tranches.filter((x) => !x.m.isOps).reduce((s, x) => s + x.m.equityIn, 0), ops: tranches.filter((x) => x.m.isOps).reduce((s, x) => s + x.m.equityIn, 0) }
  return (
    <div className="chart-card" style={{ marginTop: 16 }}>
      <h3>Источники и использование средств (весь горизонт)</h3>
      <div className="cols-2">
        <table className="month-table spec">
          <thead><tr><th>Использование</th><th>€</th></tr></thead>
          <tbody>
            {uses.map(([l, v]) => <tr key={l}><td className="lft">{l}</td><td>{e0(v)}</td></tr>)}
            <tr className="total"><td className="lft"><b>Итого</b></td><td><b>{e0(tU)}</b></td></tr>
          </tbody>
        </table>
        <table className="month-table spec">
          <thead><tr><th>Источники</th><th>€</th></tr></thead>
          <tbody>
            {sources.map(([l, v]) => <tr key={l}><td className="lft">{l}</td><td>{e0(v)}</td></tr>)}
            <tr className="total"><td className="lft"><b>Итого</b></td><td><b>{e0(tS)}</b></td></tr>
          </tbody>
        </table>
      </div>
      <small className="note" style={{ display: 'block', marginTop: 6 }}>
        Equity-транши: стройка {e0(byPeriod.build)} за {build.length} мес ({tranches.filter((x) => !x.m.isOps).length} траншей)
        {byPeriod.ops > 0 ? `, операционка ${e0(byPeriod.ops)} (${tranches.filter((x) => x.m.isOps).length} мес с разрывом — разгон/капремонт)` : ', в операционке разрывов нет'}.
        Контроль: источники − использование = {e0(tS - tU)}.
      </small>
    </div>
  )
}

// Мини-баланс по годам (на конец операционного года + конец стройки)
function Balance({ r }: { r: ModelResult }) {
  const B = r.balance
  const C = r.cashflow
  const capM = C.filter((m) => !m.isOps).length
  const idx = [capM - 1, ...Array.from({ length: Math.floor((B.length - capM) / 12) }, (_, y) => capM + y * 12 + 11)].filter((i) => i < B.length)
  const rows: [string, (b: typeof B[number]) => number, boolean?][] = [
    ['Касса', (b) => b.cash],
    ['Основные средства (остаточная)', (b) => b.ppeNbv],
    ['АКТИВЫ', (b) => b.totalAssets, true],
    ['Предоплаты гостей (deferred revenue)', (b) => b.prepaidPool],
    ['НДС: нетто-расчёты с бюджетом', (b) => b.vatNet],
    ['Вклады акционеров (equity-транши)', (b) => b.equityIn],
    ['Нераспределённая прибыль', (b) => b.retained],
    ['ОБЯЗАТЕЛЬСТВА + КАПИТАЛ', (b) => b.totalLiabEq, true],
    ['Контроль (А − П)', (b) => b.check],
  ]
  return (
    <div className="chart-card" style={{ marginTop: 16 }}>
      <h3>Мини-баланс (на конец периода)</h3>
      <div className="table-wrap">
        <table className="month-table spec">
          <thead><tr><th>Статья</th>{idx.map((i) => <th key={i}>{B[i].label}</th>)}</tr></thead>
          <tbody>
            {rows.map(([l, f, bold]) => (
              <tr key={l} className={bold ? 'total' : ''}>
                <td className="lft">{bold ? <b>{l}</b> : l}</td>
                {idx.map((i) => <td key={i}>{bold ? <b>{e0(f(B[i]))}</b> : e0(f(B[i]))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small className="note" style={{ display: 'block', marginTop: 6 }}>
        Упрощённый баланс: без запасов, дебиторки/кредиторки и отложенных налогов. ОС = Σ CAPEX (стройка, модули, maintenance) − накопленная амортизация; земля в составе ОС без амортизации.
        Нераспределённая прибыль = Σ ЧП + расходы стройки (pre-opening, аренда) − дивиденды брутто. Сходится тождественно — контрольная строка должна быть 0.
      </small>
    </div>
  )
}

export { monthLabels }
