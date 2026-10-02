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
  note: string | null
}

// Спецификация услуги: материалы по кодам номенклатуры + труд по ролям штата.
export interface SpecItem {
  kind: 'material' | 'labor'
  code?: string   // для material — код номенклатуры
  role?: string   // для labor — роль из штатного расписания (params.fot.roles)
  qty?: number    // для material — кол-во единиц
  minutes?: number // для labor — минуты работы
}
export interface ServiceSpec {
  code: string
  direction: string // Аренда бани / Парения / Массаж / Доп. услуги
  name: string
  price: number
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

export interface CapexItem {
  name: string
  unit: string
  qty: number | 'MODULES_COUNT'
  priceRub: number | null
  row: number
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
  kpi: { steamShare: number; massageShare: number; revenueShare: number }
  service: { upgradeShare: number; walletExtraShare: number; demandMult: number }
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
  slotCounts: number[] // по типам слотов
  rental: number
  steam: number[]
  steamTotal: number
  massage: number[]
  massageTotal: number
  extra: number[]
  extraTotal: number
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
  gross: number
  employerContrib: number
  total: number
}

export interface TaxMonth {
  vatOut19: number
  vatOut9: number
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
    items: { name: string; eur: number }[]
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
