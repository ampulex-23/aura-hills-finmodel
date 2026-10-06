import type { Params, RevenueMonth, ResolvedScenario } from './types'

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
  for (const m of params.modules) {
    if (m.status !== 'Активен' || !moduleActive(params, m.launchDate, at)) continue
    capSum += m.capacity
    capN++
    capSlots += 30 * m.slotsPerDay * m.uptime * m.loadK
    const s = 30 * m.slotsPerDay * m.uptime * m.loadK * bathsLoad
    slots += s
    guests += s * m.capacity
    const avgPrice = m.prices.reduce((acc, p, j) => acc + p * params.slotMix[j], 0)
    rental += s * avgPrice * growth
    params.slotMix.forEach((mix, j) => {
      slotCounts[j] += s * mix
    })
  }

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
    rental,
    steam,
    steamTotal,
    massage,
    massageTotal,
    extra,
    extraTotal,
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
