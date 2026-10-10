import type { Params, RevenueMonth, ResolvedScenario, ServiceSpec } from './types'

// Направление спецификации → вектор проданных услуг месяца, выровненный
// по порядку спек этого направления. Парения/массаж/доп. услуги — по ценовым
// ступеням; аренда — по баням: слоты модуля идут в наименьший тариф спеки,
// чей capacity вмещает вместимость бани (резервные бани попадают в ближайший
// больший тариф, а не теряются).
export function dirCounts(
  rev: RevenueMonth,
  direction: string,
  dirSpecs: ServiceSpec[],
  params: Params,
): number[] {
  if (direction === 'Аренда бани') {
    const caps = dirSpecs.map((s) => s.capacity ?? Infinity)
    const counts = dirSpecs.map(() => 0)
    params.modules.forEach((m, i) => {
      const s = rev.bathCounts[i] ?? 0
      if (s <= 0) return
      let t = caps.findIndex((c) => m.capacity <= c)
      if (t < 0) t = counts.length - 1
      counts[t] += s
    })
    return counts
  }
  if (direction === 'Парения') return rev.steamCounts
  if (direction === 'Массаж') return rev.massageCounts
  if (direction === 'Доп. услуги') return rev.extraCounts
  return []
}

// Выручка за операционный месяц k (0-based; k=0 — первый месяц работы).
// Порт листа «Выручка»: загрузка × сезонность × ramp-up × годовой индекс цен.
function addMonths(isoDate: string, months: number): { year: number; month: number } {
  const [y, m] = isoDate.slice(0, 7).split('-').map(Number)
  const t = (y * 12 + (m - 1)) + months
  return { year: Math.floor(t / 12), month: (t % 12) + 1 }
}

function moduleActive(params: Params, launch: string, at: { year: number; month: number }): boolean {
  const [ly, lm] = launch.slice(0, 7).split('-').map(Number)
  return at.year * 12 + at.month >= ly * 12 + lm
}

export function computeRevenueMonth(
  params: Params,
  sc: ResolvedScenario,
  k: number,
): RevenueMonth {
  const at = addMonths(params.meta.openingDate, k)
  const yearIdx = Math.min(4, Math.floor(k / 12))
  const ramp = Math.min(1, (k + 1) / sc.rampMonths)
  const growth = Math.pow(1 + sc.priceGrowth, Math.floor(k / 12))
  const dm = params.service.demandMult
  const seas = params.seasonality.baths[at.month - 1]
  const seasG = params.seasonality.glamping[at.month - 1]

  const bathsLoad = Math.min(1, dm * sc.bathsLoad[yearIdx] * seas * ramp)
  const glampLoad = Math.min(1, dm * sc.glampLoad[yearIdx] * seasG * ramp)

  // Рампа очереди 2: новые мощности раскачиваются со своей rampMonths от
  // собственной даты ввода, а не с открытия очереди 1.
  const ramp2 = Math.max(1, params.phase2?.rampMonths ?? 1)
  const monthsSince = (launch: string) => {
    const [ly, lm] = launch.slice(0, 7).split('-').map(Number)
    return at.year * 12 + at.month - (ly * 12 + lm) + 1
  }
  const moduleRamp = (m: (typeof params.modules)[0]) =>
    (m.phase ?? 1) === 2 ? Math.min(1, monthsSince(m.launchDate) / ramp2) : 1

  // Слоты и выручка по модулям (Выручка!C13/C14): 30 дн × слоты/день × uptime × загрузка
  let slots = 0
  let guests = 0
  let rental = 0
  let capSlots = 0 // ёмкость без фактора загрузки — для вычета слотов членов
  let capSum = 0 // ёмкость гостей активных ЭТОГО месяца модулей (не всех «Активен»)
  let capN = 0
  const slotCounts = params.slotMix.map(() => 0)
  const bathCounts = params.modules.map(() => 0) // слоты по баням — база спек аренды
  params.modules.forEach((m, i) => {
    if (m.status !== 'Активен' || !moduleActive(params, m.launchDate, at)) return
    capSum += m.capacity
    capN++
    capSlots += 30 * m.slotsPerDay * m.uptime * m.loadK * moduleRamp(m)
    const s = 30 * m.slotsPerDay * m.uptime * m.loadK * bathsLoad * moduleRamp(m)
    slots += s
    guests += s * m.capacity
    bathCounts[i] = s
    // Цена слота фиксирована баней — временной микс (slotMix) на деньги
    // не влияет, только на разложение slotCounts по слотам суток.
    const avgPrice = m.prices.reduce((acc, p, j) => acc + p * params.slotMix[j], 0)
    rental += s * avgPrice * growth
    params.slotMix.forEach((mix, j) => {
      slotCounts[j] += s * mix
    })
  })

  // Члены клуба. Год 1: когорта продана пресейлом до открытия (deferred-режим),
  // поэтому рампа к ней не применяется — иначе «продали всё в стройке, а в
  // месяц 1 активны 11%» (аудит 14, W-12). Со 2-го года — сценарный вектор.
  const presold = params.units.presaleMode === 'deferred' && params.units.presaleMonths > 0
  const memberRamp = yearIdx === 0 && presold ? 1 : ramp
  const membersMonthCount = dm * sc.membersMonth[yearIdx] * memberRamp
  const annualActive = dm * params.units.annualMembersPlan[yearIdx] * memberRamp
  const memberGuests = params.members.consumeSlots
    ? (membersMonthCount + annualActive) * params.members.visitsPerMonth * params.members.partySize
    : 0
  // Сертификаты: продажи с сезонностью (пик — декабрь); погашенная доля —
  // это гости, занимающие ёмкость и несущие COGS/F&B (аудит 14, W-8), выручка
  // сертификата и есть оплата их визита — отдельно аренда/услуги им не начисляются.
  const seasC = params.seasonality.certificates?.[at.month - 1] ?? 1
  const certsSold = params.units.certsPerMonth * dm * ramp * seasC
  const certGuests = certsSold * (params.units.certRedemptionRate ?? 0) * (params.units.certGuestsPerCert ?? 1)
  // Средняя вместимость слота — по модулям, запущенным к этому месяцу
  // (раньше считалась по всем активным статусам → будущие модули занижали
  // ёмкость членов и базу услуг до своего запуска).
  const cap = capN ? capSum / capN : sc.avgCapacity
  const memberSlots = memberGuests / cap
  const certSlots = certGuests / cap
  // Вытесняют платные продажи только визиты в пиковые слоты (peakShare) —
  // остальные заполняют свободную ёмкость (аудит 14, C-2: вытеснение 1:1
  // делало членскую программу убыточной и роняло аренду год к году).
  const peak = params.members.peakShare ?? 1
  const displacing = (memberSlots + certSlots) * peak
  let displacedSlots = 0
  if (displacing > 0 && capSlots > 0) {
    const paidSlots = Math.max(0, Math.min(slots, capSlots - displacing))
    displacedSlots = slots - paidSlots
    const scale = slots > 0 ? paidSlots / slots : 1
    slots = paidSlots
    rental *= scale
    for (let j = 0; j < slotCounts.length; j++) slotCounts[j] *= scale
    for (let j = 0; j < bathCounts.length; j++) bathCounts[j] *= scale
    guests *= scale
  }
  // Очередь 2 — общественный банный комплекс: НЕ слотовый поток.
  // Посетителей/мес = 30 дн × пропускная ёмкость × загрузка (% пропускной).
  // Билет = вход + все зоны (бассейн, купели, баня); прачка сюда не входит.
  const pb = params.publicBath
  const pbActive = !!pb?.enabled && moduleActive(params, pb.launchDate, at)
  const pbRamp = pbActive ? Math.min(1, monthsSince(pb!.launchDate) / ramp2) : 0
  const pubLoad = Math.min(1, dm * sc.publicBathLoad[yearIdx] * seas * pbRamp)
  const publicGuests = pbActive ? 30 * pb!.capacity * pubLoad : 0
  const publicBathRev = publicGuests * (pb?.ticketEur ?? 0) * growth

  guests += memberGuests + certGuests

  const up = sc.effectiveUptake
  // Векторы загрузки услуг из матрицы сценариев — множители доли реализации.
  // Отключаемы флагом service.serviceLoads (golden-master держит паритет с оракулом).
  const ld = params.service.serviceLoads
  const upSteam = up * (ld ? Math.min(1, sc.steamLoad[yearIdx]) : 1)
  const upMassage = up * (ld ? Math.min(1, sc.massageLoad[yearIdx]) : 1)
  const upExtra = up * (ld ? Math.min(1, sc.extraLoad[yearIdx]) : 1)
  // Услуги привязаны к слотам ТЕКУЩЕГО месяца (slots), а не первого:
  // исходный Excel баг — ссылка на C13 как константа — исправлен и здесь, и в книге.
  const svc = slots
  const swp = (set: { prices: number[]; weights: number[] }) =>
    set.prices.reduce((acc, p, j) => acc + p * set.weights[j], 0)

  // Парения: в кошельке (1−walletShare) по базе + апгрейды сверх депозита (upgradeShare)
  const steam = params.procedures.steam.prices.map((p, j) => {
    const w = params.procedures.steam.weights[j]
    return (
      svc * cap * upSteam *
      ((1 - params.service.walletExtraShare) * params.deposit.steamBase * w * p / swp(params.procedures.steam) +
        params.service.upgradeShare * w * (p - params.deposit.steamBase)) * growth
    )
  })
  const massage = params.procedures.massage.prices.map((p, j) => {
    const w = params.procedures.massage.weights[j]
    return (
      svc * cap * upMassage *
      ((1 - params.service.walletExtraShare) * params.deposit.massageBase * w * p / swp(params.procedures.massage) +
        params.service.upgradeShare * w * (p - params.deposit.massageBase)) * growth
    )
  })
  // Доп.услуги: доля кошелька walletExtraShare × депозит × доля услуги (w·p/Σw·p)
  const extra = params.procedures.extra.prices.map((p, j) => {
    const w = params.procedures.extra.weights[j]
    return (
      svc * cap * upExtra * params.service.walletExtraShare * params.deposit.base *
      (w * p) / swp(params.procedures.extra) * growth
    )
  })
  // Сервисный чек гостей-членов: распределяется по потокам в пропорции пакета
  // (парения : массаж : допы = steamBase : massageBase : кошелёк допов) и внутри
  // потока — по весам ступеней. Так members-гости несут COGS спек и KPI-бонусы.
  const memberSpend = memberGuests * (params.members.serviceSpendPerVisit ?? 0) * growth
  // Сервисный чек посетителей общественной бани сверх билета (парения/массаж/допы)
  // — разносится по потокам той же пропорцией, что членский чек, и попадает
  // в counts спецификаций (KPI-труд/COGS) через выручку ступеней.
  const publicSpend = publicGuests * (params.publicBath?.serviceSpendPerVisit ?? 0) * growth
  const streamSpend = memberSpend + publicSpend
  const wE = params.service.walletExtraShare
  const baseW = (1 - wE) * (params.deposit.steamBase + params.deposit.massageBase) + wE * params.deposit.base
  const addStream = (arr: number[], set: { prices: number[]; weights: number[] }, share: number) => {
    const tot = swp(set)
    if (tot <= 0) return
    set.prices.forEach((p, j) => { arr[j] += streamSpend * share * (set.weights[j] * p) / tot })
  }
  if (streamSpend > 0 && baseW > 0) {
    addStream(steam, params.procedures.steam, (1 - wE) * params.deposit.steamBase / baseW)
    addStream(massage, params.procedures.massage, (1 - wE) * params.deposit.massageBase / baseW)
    addStream(extra, params.procedures.extra, wE * params.deposit.base / baseW)
  }
  const steamTotal = steam.reduce((a, b) => a + b, 0)
  const massageTotal = massage.reduce((a, b) => a + b, 0)
  const extraTotal = extra.reduce((a, b) => a + b, 0)
  // Эквивалент проданных процедур по каждой ценовой ступени — база KPI
  // спецификаций: count = выручка ступени / (её цена × годовой индекс цен).
  const cnt = (stream: number[], set: { prices: number[] }) =>
    stream.map((r, j) => (set.prices[j] * growth > 0 ? r / (set.prices[j] * growth) : 0))
  const steamCounts = cnt(steam, params.procedures.steam)
  const massageCounts = cnt(massage, params.procedures.massage)
  const extraCounts = cnt(extra, params.procedures.extra)

  const glamping =
    30 *
    (params.units.glampSmall * glampLoad * params.prices.glampSmall +
      params.units.glampBig * glampLoad * params.prices.glampBig) * growth

  const membersMonth = membersMonthCount * params.prices.membershipMonth * growth
  const membersYearCount = (dm * params.units.annualMembersPlan[yearIdx] / 12) * memberRamp
  const membersYear = membersYearCount * params.prices.membershipYear * growth
  const certificates = certsSold * params.prices.certificate * growth
  const membershipTotal = membersMonth + membersYear + certificates

  // Очередь 2 — ресторан общественного комплекса (плейсхолдер):
  // посадки = 30 дн × места × оборотов; чек рыночный, индексируется инфляцией
  // (общая инфляция, не priceGrowth услуг — по решению из плана).
  const rest = params.restaurant
  const restActive =
    !!rest && rest.enabled !== false && pbActive && sc.restLoad[yearIdx] > 0
  const restInfl = Math.pow(1 + params.general.inflation, Math.floor(k / 12))
  const restCovers = restActive
    ? 30 * rest!.seats * rest!.turnsPerDay * Math.min(1, dm * sc.restLoad[yearIdx] * seas * pbRamp)
    : 0
  const restaurant = restCovers * (rest?.avgCheck ?? 0) * restInfl

  const fb = guests * params.prices.fbPerGuest * growth
  // Гости общественной бани входят в guests — несут нормативные COGS на гостя
  // (текстиль, расходники). В F&B-кафе очереди 1 не засчитываются: питаются
  // в ресторане, fb выше посчитан до добавления publicGuests.
  guests += publicGuests

  const total =
    rental + steamTotal + massageTotal + extraTotal + glamping + membershipTotal + fb +
    publicBathRev + restaurant

  return {
    yearIdx,
    monthOfYear: at.month,
    ramp,
    bathsLoad,
    slots,
    guests,
    slotCounts,
    bathCounts,
    rental,
    steam,
    steamTotal,
    steamCounts,
    massage,
    massageTotal,
    massageCounts,
    extra,
    extraTotal,
    extraCounts,
    glamping,
    membersMonthCount,
    membersMonth,
    membersYear,
    memberSlots,
    memberGuests,
    memberServices: memberSpend,
    certsSold,
    certGuests,
    displacedSlots,
    certificates,
    membershipTotal,
    fb,
    publicGuests,
    publicBath: publicBathRev,
    restaurant,
    restCovers,
    total,
  }
}

export function computeRevenue(
  params: Params,
  sc: ResolvedScenario,
): RevenueMonth[] {
  const out: RevenueMonth[] = []
  for (let k = 0; k < params.meta.opsMonths; k++)
    out.push(computeRevenueMonth(params, sc, k))
  return out
}
