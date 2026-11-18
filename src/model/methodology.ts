import type { Methodology, Params } from './types'

// Методика — именованный набор ПРАВИЛ расчёта (в отличие от параметров —
// значений). Сценарий ссылается на методику через params.methodology.id и
// может переопределить отдельные правила. Дефолт — 'cyprus': поведение ядра
// до появления слоя методик, бит-в-бит (его держат golden-тесты).
export const METHODOLOGY_PRESETS: Record<string, Methodology> = {
  cyprus: {
    id: 'cyprus',
    label: 'Кипр — полная',
    daysBasis: 'fixed30',
    priceIndex: 'opsYear',
    bonusIndex: 'none',
    tax: { cit: 'annualLossCarry', allowNegative: false, notionalInterestRate: 0 },
  },
  investor: {
    id: 'investor',
    label: 'Инвестор — упрощённая',
    daysBasis: 'calendar',
    priceIndex: 'calendarYear',
    bonusIndex: 'inflation',
    tax: { cit: 'monthly', allowNegative: true, notionalInterestRate: 0.09 },
  },
}

export const DEFAULT_METHODOLOGY_ID = 'cyprus'

/** Действующая методика: пресет по id + явные переопределения из params. */
export function resolveMethodology(params: Params): Methodology {
  const m = params.methodology
  const preset = METHODOLOGY_PRESETS[m?.id ?? DEFAULT_METHODOLOGY_ID] ?? METHODOLOGY_PRESETS[DEFAULT_METHODOLOGY_ID]
  if (!m) return preset
  return {
    ...preset,
    ...m,
    id: m.id ?? preset.id,
    label: m.label ?? preset.label,
    tax: { ...preset.tax, ...(m.tax ?? {}) },
  }
}

/** Дней в месяце по правилу методики (month — 1..12). */
export function daysInMonth(meth: Methodology, year: number, month: number): number {
  return meth.daysBasis === 'calendar' ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 30
}

/** Индекс цен услуг месяца: k — операционный месяц (0-based), year — календарный год месяца. */
export function priceIndexAt(
  meth: Methodology,
  priceGrowth: number,
  k: number,
  year: number,
  openingYear: number,
): number {
  if (meth.priceIndex === 'calendarYear') return Math.pow(1 + priceGrowth, year - openingYear)
  if (meth.priceIndex === 'table') {
    // Явная таблица по календарным годам; года нет — действует последний заданный до него
    const t = meth.priceIndexTable ?? {}
    const known = Object.keys(t).map(Number).filter((y) => y <= year).sort((a, b) => a - b)
    return known.length ? t[String(known[known.length - 1])] : 1
  }
  return Math.pow(1 + priceGrowth, Math.floor(k / 12))
}
