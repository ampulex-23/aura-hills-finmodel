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
  /** Начальный запас — разовая закупка в стройке (строка «Закуп: стартовые запасы» CAPEX) поверх
   *  обычного учёта позиции: для OPEX/Спецификации это стартовый комплект,
   *  который потом пополняется помесячной нормой. */
  initialQty?: number
  /** Себестоимость единицы при своей прачечной (params.laundry.enabled):
   *  расходники на цикл стирки вместо аутсорс-тарифа в `price`. Только для
   *  спековых позиций категории «Прачечная / текстиль». */
  ownPrice?: number
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
  priceEur: number | null
  row: number
  /** Раздел сметы для группировки в отчёте CAPEX */
  group?: string
  /** WBS-детализация (сумма строк = эталонной стоимости позиции; для помодульных — на текущий контур модулей) */
  wbs?: WbsSection[]
  /** Условная строка: включается в CAPEX только при своей прачечной (params.laundry.enabled) */
  ifLaundry?: boolean
}

/** CAPM-блок стоимости собственного капитала: ke = rf + β·ERP + страновая + size/startup премии */
export interface CapmInputs {
  rf: number
  beta: number
  erp: number
  countryPremium: number
  sizePremium: number
}

export interface Params {
  meta: ModelMeta
  general: {
    inflation: number
    /** Ставка дисконтирования (эффективная годовая). При waccMode='capm' перезаписывается расчётом */
    wacc: number
    waccMode: 'manual' | 'capm'
    capm: CapmInputs
  }
  taxes: {
    cit: number; vatStd: number; vatGlamp: number; vatFb: number
    vatInput: number; employerRate: number; sdc: number; gesy: number
    /** Потолок базы GESY на физлицо в календарный год (Кипр: €180 000) */
    gesyCap: number
    /** НДС к уплате уходит в кэш раз в квартал (10-е число 2-го месяца после квартала) */
    vatQuarterly: boolean
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
    /** Доля сертификатов, которые погашаются визитом (остальное — breakage, чистая выручка) */
    certRedemptionRate: number
    /** Гостей на один погашенный сертификат — они занимают ёмкость и несут COGS/F&B */
    certGuestsPerCert: number
  }
  /** Maintenance CAPEX: ежегодный % от амортизируемого CAPEX (с года startYear) + разовый капремонт */
  capexMaint: { enabled: boolean; pctPerYear: number; startYear: number; lumpYear: number; lumpEur: number }
  /** S-кривая освоения строительного CAPEX по месяцам стройки (нормируется; длина ≠ capexMonths → равномерно) */
  capexSCurve: number[]
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
  members: {
    consumeSlots: boolean; visitsPerMonth: number; partySize: number
    /** Доля членских визитов в пиковые слоты — только она вытесняет платные продажи */
    peakShare: number
    /** Средний сервисный чек гостя-члена за визит (парения/массаж/допы), € */
    serviceSpendPerVisit: number
  }
  // Налоговая амортизация (кипрские capital allowances) — отдельный график для CIT:
  // конструкции ~4%/год (25 лет), оборудование ~14% (7 лет), прочее/IT ~20% (5 лет).
  // Доли берутся из amort.shares, здесь только сроки. В Excel-оракуле нет.
  taxDepr: { enabled: boolean; years: number[] }
  // OTA-канал глэмпинга: доля ночей через Booking/Airbnb × комиссия.
  // Комиссия — расход от выручки глэмпинга (pct-блок OPEX). В Excel-оракуле нет.
  glampOta: { enabled: boolean; share: number; commissionPct: number }
  // Terminal value: опциональный «хвост» стоимости после горизонта (Gordon growth).
  // enabled=false — база консервативна, TV только как sensitivity-кейс. В Excel нет.
  tv: { enabled: boolean; growth: number; exitMultiple: number }
  deposit: { base: number; steamBase: number; massageBase: number; policy: string }
  kpi?: { steamShare: number; massageShare: number; revenueShare: number } // legacy: игнорируется, KPI задаётся в спецификациях
  service: {
    upgradeShare: number
    walletExtraShare: number
    demandMult: number
    /** Векторы загрузки услуг из матрицы сценариев как множители uptake */
    serviceLoads: boolean
  }
  seasonality: { baths: number[]; glamping: number[]; certificates: number[] }
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
  opexFixed: {
    name: string; base: number; perModule?: boolean
    /** Статья = max(base × инфляция, pct × выручка месяца) — маркетинг как % выручки */
    pctOfRevenue?: number
    /** Энергетическая статья — масштабируется сценарным energyCostMult */
    energy?: boolean
  }[]
  // IT / АСУ: кастомный слой — подписки и инфраструктура помесячно, внедрение в CAPEX.
  // enabled=false возвращает модель к поведению исходного Excel (нужно golden-тестам).
  it: {
    enabled: boolean
    curator: number // оклад IT-куратора €/мес gross, добавляется в ФОТ
    opex: { name: string; base: number }[]
    capex: { name: string; eur: number }[]
  }
  // Прачечная — переключатель режима. enabled=false (база): стирка на аутсорсе —
  // спековые позиции NC-159/NC-210 списываются по тарифу прачечной (price).
  // enabled=true (своя): в CAPEX включаются строки capexItems с флагом ifLaundry
  // (оборудование, амортизируется в общем графике), а спековые позиции списываются
  // по собственной себестоимости цикла (ownPrice — порошок/гель, без коммуналки).
  laundry?: { enabled: boolean }
  fot: {
    roles: string[]
    count: number[]
    salary: number[]
    /** Ступени штата по очередям: с месяца `from` ('YYYY-MM') count заменяется
     *  полным вектором фазы (не дельта). Фазы применяются в порядке дат. */
    phases?: { from: string; label?: string; count: number[] }[]
  }
  capexItems: CapexItem[]
}

export interface ProcedureSet {
  names: string[]
  prices: number[]
  weights: number[]
}

// Матрица сценариев (лист «Сценарии»): три колонки — Conservative/Base/Aggressive
/** Пятилетний вектор по сценариям: y1..y5 → [Conservative, Base, Aggressive] */
export type YearVectors = { y1: number[]; y2: number[]; y3: number[]; y4: number[]; y5: number[] }
export const YEAR_KEYS = ['y1', 'y2', 'y3', 'y4', 'y5'] as const

// Все потоки задаются явно по пяти годам — интерполяций и «магических» коэффициентов нет.
export interface ScenarioMatrix {
  names: ScenarioName[]
  baths: YearVectors
  steam: YearVectors
  massage: YearVectors
  extra: YearVectors
  glamping: YearVectors
  membersMonth: YearVectors
  priceGrowth: number[]
  capexAdj: number[]
  rampMonths: number[]
  uptake: number[]
  /** Задержка стройки, мес: сдвигает открытие, продлевает стройку/pre-opening/аренду */
  constructionDelayMonths: number[]
  /** Множитель энергетических статей OPEX (электроэнергия, отопление) */
  energyCostMult: number[]
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
  constructionDelayMonths: number
  energyCostMult: number
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
  memberSlots: number   // слоты-эквивалент всех членских визитов
  memberGuests: number  // гости-члены (участвуют в F&B и норм. COGS)
  memberServices: number // сервисная выручка гостей-членов (внутри steam/massage/extra)
  certsSold: number      // проданных сертификатов за месяц
  certGuests: number     // гости по погашенным сертификатам (занимают ёмкость)
  displacedSlots: number // платные слоты, вытесненные членами/сертификатами в пике
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
  /** Детализация переменных статей до позиций номенклатуры — для раскрытия
   *  статей в отчёте OPEX. Σ amount по статье ≡ variable[].amount. */
  variableDetail: {
    article: string
    code: string
    name: string
    unit: string
    /** 'слот' | 'гость' | 'мес' — нормативный расход; 'спека' — через спеки услуг */
    basis: string
    /** Физическое списание за месяц: норма × драйвер или Σ qty × услуги */
    qty: number
    landed: number
    amount: number
  }[]
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
  /** НДС, фактически уплаченный в этом месяце (квартальный график) */
  vatPaid: number
  cit: number
  /** Дивиденды брутто (до удержания SDC/GESY) — это и есть отток компании */
  dividends: number
  /** Удержано из дивидендов в пользу бюджета (не доп. отток компании) */
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
  vatPaid: number
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
  maintCapex: number // maintenance CAPEX / капремонт в операционке (≤0)
  fcff: number
  /** Дивиденды брутто (отток компании); SDC/GESY — удержание внутри них */
  dividends: number
  sdc: number
  gesy: number
  totalCf: number
  /** Взнос акционеров, закрывающий кассовый разрыв месяца (≥0) */
  equityIn: number
  /** Остаток денег на счёте (≥0) — с учётом equity-траншей */
  cash: number
  cumCash: number // накопленный totalCf без траншей (= cash − Σ equityIn)
  cumFcff: number
  discountFactor: number
  discountedFcff: number
  cumDcf: number
}

/** Мини-баланс на конец месяца: Активы = Обязательства + Капитал (сходится по построению) */
export interface BalanceMonth {
  label: string
  cash: number
  ppeNbv: number
  totalAssets: number
  prepaidPool: number
  vatNet: number
  equityIn: number
  retained: number
  totalLiabEq: number
  check: number
}

export interface Kpis {
  /** Фактически применённая ставка дисконтирования (эффективная годовая) */
  wacc: number
  npv: number
  irrMonthly: number
  /** Годовой эффективный IRR = (1+r_мес)^12 − 1; сопоставим с WACC */
  irrAnnual: number
  paybackMonths: number
  discountedPaybackMonths: number
  peakFundingNeed: number
  /** Σ equity-траншей, закрывающих кассовые разрывы (включая стройку) */
  equityTotal: number
  /** MOIC = Σ положительных FCFF / Σ вложенного (отрицательного) FCFF */
  moic: number
  /** Cash-on-cash: годовой FCFF 3-го операционного года / вложенный капитал */
  cashOnCash: number
  /** Всего вложено (Σ отрицательных FCFF) */
  investedTotal: number
  /** Дисконтированная терминальная стоимость, Gordon (0, если tv.enabled=false) */
  tvValue: number
  /** TV по exit-multiple: EBITDA года 5 × мультипликатор, дисконтировано */
  tvExitValue: number
  /** Подразумеваемый EV/EBITDA терминальной стоимости Gordon — cross-check */
  tvEvEbitda: number
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
  balance: BalanceMonth[]
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
