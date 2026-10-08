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
    capSlots += 30 * m.slotsPerDay * m.uptime * m.loadK
    const s = 30 * m.slotsPerDay * m.uptime * m.loadK * bathsLoad
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

  // Члены клуба занимают ёмкость: активные члены × визиты/мес × гостей/визит.
  // Слоты членов вычитаются из доступной ёмкости до платных продаж —
  // в пиковые месяцы они вытесняют платные слоты (консервативно).
  const membersMonthCount = dm * sc.membersMonth[yearIdx] * ramp
  const annualActive = dm * params.units.annualMembersPlan[yearIdx] * ramp
  const memberGuests = params.members.consumeSlots
    ? (membersMonthCount + annualActive) * params.members.visitsPerMonth * params.members.partySize
    : 0
  // Средняя вместимость слота — по модулям, запущенным к этому месяцу
  // (раньше считалась по всем активным статусам → будущие модули занижали
  // ёмкость членов и базу услуг до своего запуска).
  const cap = capN ? capSum / capN : sc.avgCapacity
  const memberSlots = memberGuests / cap
  if (memberSlots > 0 && capSlots > 0) {
    const paidSlots = Math.max(0, Math.min(slots, capSlots - memberSlots))
    const scale = slots > 0 ? paidSlots / slots : 1
    slots = paidSlots
    guests = guests * scale + memberGuests
    rental *= scale
    for (let j = 0; j < slotCounts.length; j++) slotCounts[j] *= scale
    for (let j = 0; j < bathCounts.length; j++) bathCounts[j] *= scale
  }

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
  const membersYearCount = (dm * params.units.annualMembersPlan[yearIdx] / 12) * ramp
  const membersYear = membersYearCount * params.prices.membershipYear * growth
  const certsCount = params.units.certsPerMonth * dm * ramp
  const certificates = certsCount * params.prices.certificate * growth
  const membershipTotal = membersMonth + membersYear + certificates

  const fb = guests * params.prices.fbPerGuest * growth

  const total =
    rental + steamTotal + massageTotal + extraTotal + glamping + membershipTotal + fb

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
    certificates,
    membershipTotal,
    fb,
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
