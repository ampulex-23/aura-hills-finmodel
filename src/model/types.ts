// Доменные типы модели AURA HILLS.
// Источник истины: TypeScript-ядро. Excel-файл — только экспорт/верификация.

export type ScenarioName = string
export type VatMode = 'Гросс' | 'С возмещением'
export type PackageMode = 'Да' | 'Нет'
export type NormBase = 'слот' | 'гость' | 'мес'

export interface ModelMeta {
  currency: string
  constructionStart: string
  openingDate: string
  capexMonths: number
  opsMonths: number
  mode: PackageMode
  scenario: ScenarioName
  vatMode: VatMode
}

export interface ModuleSpec {
  id: number
  status: string
  launchDate: string
  uptime: number
  loadK: number
  slotsPerDay: number
  capacity: number
  prices: number[] // цены слотов [утро, день1, день2, вечер]
  avgPrice: number | null // вычисляется через slotMix
}

export interface NomenclatureItem {
  code: string
  name: string
  category: string
  type: string // 'Расходник' | 'Не-расходник (ОС)'
  unit: string
  price: number
  deliveryFix: number
  deliveryPct: number
  use: 'OPEX' | 'CAPEX' | string
  opexArticle: string | null
  norm: number
  normBase: NormBase | null
  qty: number
  /** Начальный запас — разовая закупка в стройке (в «Наполнение» CAPEX) поверх
   *  обычного учёта позиции: для OPEX/Спецификации это стартовый комплект,
   *  который потом пополняется помесячной нормой. */
  initialQty?: number
  note: string | null
}

// Спецификация услуги: материалы по кодам номенклатуры + KPI-доли ролей.
export interface SpecItem {
  kind: 'material' | 'labor'
  code?: string    // для material — код номенклатуры
  role?: string    // для labor — роль из штатного расписания (params.fot.roles)
  qty?: number     // для material — кол-во единиц
  pct?: number     // для labor — доля цены услуги, уходящая роли в KPI (0.3 = 30%)
  minutes?: number // legacy: минуты → конвертируется в эквивалентный pct при загрузке
}
export interface ServiceSpec {
  code: string
  direction: string // Аренда бани / Парения / Массаж / Доп. услуги
  name: string
  price: number
  /** Для направления «Аренда бани»: вместимость бани (гостей). Спека
   *  сопоставляется модулю по capacity — модуль попадает в наименьший
   *  тариф, который его вмещает (резервные бани тоже покрываются). */
  capacity?: number
  items: SpecItem[]
}
export interface ServiceCost {
  spec: ServiceSpec
  materialsCost: number
  laborCost: number
  cost: number
  margin: number
  marginPct: number
}

/** Строка WBS-детализации CAPEX-статьи (все суммы в EUR, эталонная смета заказчика) */
export interface WbsLine {
  code: string
  name: string
  unit?: string
  qty?: number
  rate?: number
  eur: number
  /** Категория затрат из сметы («Материалы + Монтаж», «Подрядные услуги»…) */
  tag?: string
}
export interface WbsSection {
  code: string
  title: string
  items: WbsLine[]
}
export interface CapexItem {
  name: string
  unit: string
  // qty: число | 'MODULES_COUNT' (1 шт на активный модуль) | 'MODULES_COUNT:N' (N шт на модуль)
  qty: number | string
  priceRub: number | null
  row: number
  /** Раздел сметы для группировки в отчёте CAPEX */
  group?: string
  /** WBS-детализация (сумма строк = эталонной стоимости позиции; для помодульных — на текущий контур модулей) */
  wbs?: WbsSection[]
}

export interface Params {
  meta: ModelMeta
  general: { rubEurRate: number; inflation: number; wacc: number }
  taxes: {
    cit: number; vatStd: number; vatGlamp: number; vatFb: number
    vatInput: number; employerRate: number; sdc: number; gesy: number
  }
  prices: {
    membershipMonth: number; membershipYear: number; certificate: number
    fbPerGuest: number; glampSmall: number; glampBig: number
  }
  units: {
    glampSmall: number; glampBig: number
    annualMembersPlan: number[]; certsPerMonth: number; presaleMonths: number
    // deferred: пресейл-члены прогорают без нового кэша в первые месяцы операционки;
    // incremental: пресейл — дополнительный канал сверх плана (поведение Excel).
    presaleMode: 'deferred' | 'incremental'
    presaleRecognizeMonths: number // окно признания prepaid-пула в CF (deferred)
  }
  amort: { shares: number[]; years: number[]; groups: string[] }
  opexPct: { acquiring: number; maintenance: number }
  // F&B-экономика: себестоимость продуктов (% выручки F&B) + повар в ФОТ.
  // В Excel-оракуле этого слоя нет — тесты выключают enabled для паритета.
  fb: { enabled: boolean; foodCostPct: number; cookSalary: number; cookCount: number }
  // Земля: owned — допущение «у основателей» (€0); lease — аренда с 1-го мес стройки;
  // purchase — участок в CAPEX без амортизации. В Excel-оракуле нет → дефолт owned.
  land: { mode: 'owned' | 'lease' | 'purchase'; purchaseCost: number; rentMonthly: number }
  // Pre-opening: штат нанят и фикс-расходы капают за N мес до открытия — «мёртвый» период
  // в CF (оклады+взносы + постоянные+IT, без переменных). В Excel-оракуле нет.
  preopen: { enabled: boolean; months: number }
  // Члены клуба занимают ёмкость бань: активные члены × визитов/мес × гостей
  // визита → слоты, вычитаемые из доступной ёмкости до платных продаж.
  members: { consumeSlots: boolean; visitsPerMonth: number; partySize: number }
  // Налоговая амортизация (кипрские capital allowances) — отдельный график для CIT:
  // конструкции ~4%/год (25 лет), оборудование ~14% (7 лет), прочее/IT ~20% (5 лет).
  // Доли берутся из amort.shares, здесь только сроки. В Excel-оракуле нет.
  taxDepr: { enabled: boolean; years: number[] }
  // OTA-канал глэмпинга: доля ночей через Booking/Airbnb × комиссия.
  // Комиссия — расход от выручки глэмпинга (pct-блок OPEX). В Excel-оракуле нет.
  glampOta: { enabled: boolean; share: number; commissionPct: number }
  // Terminal value: опциональный «хвост» стоимости после горизонта (Gordon growth).
  // enabled=false — база консервативна, TV только как sensitivity-кейс. В Excel нет.
  tv: { enabled: boolean; growth: number }
  deposit: { base: number; steamBase: number; massageBase: number; policy: string }
  kpi?: { steamShare: number; massageShare: number; revenueShare: number } // legacy: игнорируется, KPI задаётся в спецификациях
  service: {
    upgradeShare: number
    walletExtraShare: number
    demandMult: number
    /** Векторы загрузки услуг из матрицы сценариев как множители uptake */
    serviceLoads: boolean
  }
  seasonality: { baths: number[]; glamping: number[] }
  procedures: {
    steam: ProcedureSet; massage: ProcedureSet; extra: ProcedureSet
  }
  partners: {
    names: string[]; shares: number[]; statuses: string[]
    corporate: { mgmt: number; reserve: number }
  }
  modules: ModuleSpec[]
  slotMix: number[]
  slotNames: string[]
  opexFixed: { name: string; base: number; perModule?: boolean }[]
  // IT / АСУ: кастомный слой — подписки и инфраструктура помесячно, внедрение в CAPEX.
  // enabled=false возвращает модель к поведению исходного Excel (нужно golden-тестам).
  it: {
    enabled: boolean
    curator: number // оклад IT-куратора €/мес gross, добавляется в ФОТ
    opex: { name: string; base: number }[]
    capex: { name: string; eur: number }[]
  }
  fot: { roles: string[]; count: number[]; salary: number[] }
  capexItems: CapexItem[]
}

export interface ProcedureSet {
  names: string[]
  prices: number[]
  weights: number[]
}

// Матрица сценариев (лист «Сценарии»): три колонки — Conservative/Base/Aggressive
export interface ScenarioMatrix {
  names: ScenarioName[]
  baths: { y1: number[]; y2: number[]; y3: number[]; y4: number[]; y5: number[] }
  steam: { y1: number[]; y3: number[] }
  massage: { y1: number[]; y3: number[] }
  glamping: { y1: number[]; y3: number[] }
  membersMonth: { y1: number[]; y3: number[] }
  priceGrowth: number[]
  capexAdj: number[]
  rampMonths: number[]
  uptake: number[]
}

// Резолвленный сценарий: все годовые векторы раскрыты на 5 лет
export interface ResolvedScenario {
  name: ScenarioName
  bathsLoad: number[]
  steamLoad: number[]
  massageLoad: number[]
  extraLoad: number[]
  glampLoad: number[]
  membersMonth: number[]
  priceGrowth: number
  capexAdj: number
  rampMonths: number
  uptake: number
  effectiveUptake: number // пакетный режим форсит 100%
  presaleMonthly: number
  activeModules: number
  avgCapacity: number
}

export interface RevenueMonth {
  yearIdx: number
  monthOfYear: number // 1..12
  ramp: number
  bathsLoad: number
  slots: number
  guests: number
  slotCounts: number[] // по типам слотов (время суток — аналитика, цена одинакова в бане)
  bathCounts: number[] // проданные слоты по каждой бане-модулю (индекс = params.modules)
  rental: number
  steam: number[]
  steamTotal: number
  steamCounts: number[]    // проданных процедур по ценовым ступеням — для KPI спецификаций
  massage: number[]
  massageTotal: number
  massageCounts: number[]
  extra: number[]
  extraTotal: number
  extraCounts: number[]
  glamping: number
  membersMonthCount: number
  membersMonth: number
  membersYear: number
  memberSlots: number   // слоты, занятые членами клуба
  memberGuests: number  // гости-члены (участвуют в F&B)
  certificates: number
  membershipTotal: number
  fb: number
  total: number
}

export interface OpexMonth {
  fixed: number[]
  fixedTotal: number
  it: { name: string; amount: number }[]
  itTotal: number
  landRent: number // аренда земли в операционке (mode='lease'), с инфляцией
  variable: { article: string; amount: number }[]
  variableTotal: number
  pct: { acquiring: number; maintenance: number; fbCost: number; ota: number }
  pctTotal: number
  total: number
}

export interface FotMonth {
  salaries: number
  bonuses: number
  bonusDetail: string // разложение KPI по направлениям для подсказок отчётов
  gross: number
  employerContrib: number
  total: number
}

export interface TaxMonth {
  vatOut19: number
  vatOut9: number
  /** Начисленный выходной НДС (19% + 9%) — база нетто-выручки P&L */
  vatOut: number
  inputVat: number
  vatCredit: number
  vatPayable: number
  cit: number
  dividends: number
  sdc: number
  gesy: number
  total: number
}

export interface PnlMonth {
  revenueNet: number
  revenueGross: number
  /** Начисленный НДС (в P&L) и уплаченный (в CF) — разница = Δ обязательства по НДС */
  vatOut: number
  vatPayable: number
  variableOpex: number
  pctOpex: number
  marginalProfit: number
  fixedOpex: number
  fot: number
  ebitda: number
  amortization: number
  ebit: number
  cit: number
  netProfit: number
  dividends: number
  sdc: number
  gesy: number
  netAfterSdc: number // ЧП минус SDC и GESY
}

export interface CashFlowMonth {
  label: string
  isOps: boolean
  netProfit: number
  amortization: number
  /** ΔНДС: начисленный − уплаченный (кредит CAPEX «зажимает» кэш-платёж) */
  vatTiming: number
  operatingCf: number
  capex: number
  deferredCapex: number // CAPEX модулей, запускаемых после открытия (real option)
  presale: number
  presaleUnwind: number // отток «деньги уже получены» в deferred-режиме (≤0)
  prepaidPool: number // остаток обязательств по предоплатам (deferred revenue)
  landLease: number // аренда земли в период стройки (≤0)
  preopen: number // pre-opening burn в конце стройки (≤0)
  fcff: number
  dividends: number
  sdc: number
  gesy: number
  totalCf: number
  cumCash: number
  cumFcff: number
  discountFactor: number
  discountedFcff: number
  cumDcf: number
}

export interface Kpis {
  npv: number
  irrMonthly: number
  irrAnnual: number
  /** IRR × 12 — номинальная годовая; сопоставима с WACC, который в NPV
   *  трактуется как номинальная ставка с помесячным начислением */
  irrNominal: number
  paybackMonths: number
  discountedPaybackMonths: number
  peakFundingNeed: number
  /** MOIC = Σ положительных FCFF / Σ вложенного (отрицательного) FCFF */
  moic: number
  /** Cash-on-cash: годовой FCFF 3-го операционного года / вложенный капитал */
  cashOnCash: number
  /** Всего вложено (Σ отрицательных FCFF) */
  investedTotal: number
  /** Дисконтированная терминальная стоимость (0, если tv.enabled=false) */
  tvValue: number
  /** NPV + TV — показывается отдельно, база остаётся консервативной */
  npvWithTv: number
}

export interface ModelResult {
  scenario: ResolvedScenario
  revenue: RevenueMonth[]
  opex: OpexMonth[]
  fot: FotMonth[]
  taxes: TaxMonth[]
  pnl: PnlMonth[]
  cashflow: CashFlowMonth[]
  capex: {
    items: {
      name: string
      eur: number
      /** Раздел сметы (группировка в отчёте) */
      group?: string
      /** Расчёт строки: единица/кол-во/ставка в EUR для показа в смете */
      unit?: string
      qty?: number
      rate?: number
      /** WBS-детализация, масштабированная до eur строки */
      wbs?: (WbsSection & { total: number })[]
      /** Дрилл-даун строки: из чего складывается сумма (номенклатура / модули) */
      detail?: { code: string; name: string; qty: number; landed: number; eur: number; category?: string; unit?: string }[]
    }[]
    totalEur: number
    adjustedEur: number
    monthlyAmort: number
    amortizableEur: number
    monthlyTaxDepr: number
    /** Отложенный CAPEX резервных модулей: {month — 1-based месяц CF, eur} */
    deferred: { month: number; eur: number }[]
  }
  citByYear: number[]
  kpis: Kpis
}
