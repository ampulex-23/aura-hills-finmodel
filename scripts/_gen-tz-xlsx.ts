// Разовая выгрузка «новой модели» по ТЗ Veles: те же ядро и экспортер,
// другой бандл входов. Ничего в src/data не меняет — клоним и оверрайдим.
// Запуск: npx tsx scripts/_gen-tz-xlsx.ts → out/aura-hills-tz.xlsx
import { readFileSync, writeFileSync } from 'fs'
import { exportWorkbook } from '../src/export/excel'

const params = JSON.parse(readFileSync('src/data/params.json', 'utf8'))
const matrix = JSON.parse(readFileSync('src/data/scenarios.json', 'utf8'))
const items = JSON.parse(readFileSync('src/data/nomenclature.json', 'utf8'))
const services0 = JSON.parse(readFileSync('src/data/services.json', 'utf8')).services

const p = structuredClone(params)
const mx = structuredClone(matrix)

// ─── 1. Исключённые слои ТЗ §2.2 ───
p.preopen.enabled = false
p.capexMaint.enabled = false
p.members.enabled = false
p.units.certsEnabled = false
p.fb.enabled = false
p.glamping.enabled = false
p.laundry.enabled = false

// ─── 2. Аренда 100 €/гость: цена слота = вместимость × 100 ───
for (const m of p.modules) {
  if ((m.phase ?? 1) !== 1) continue // очередь 2 — сохраняем настройки ТЗ §2.1
  m.prices = m.prices.map(() => m.capacity * 100)
}

// ─── 3. Кошелёк услуг ТЗ §6: парение 100, массаж 120, допов нет ───
p.deposit.steamBase = 100
p.deposit.massageBase = 120
p.deposit.base = 0
p.service.walletExtraShare = 0
p.service.upgradeShare = 0

// ─── 4. Спеки ТЗ §5: «Аренда-12чел» (по вместимости — все три),
//         парение = «Парение Дубль», массаж = «Массаж 2, глубокий» ───
const services = services0
  .filter((s: any) => s.direction !== 'Доп. услуги')
  .map((s: any) => ({
    ...s,
    weight:
      s.direction === 'Парения' ? (s.code === 'SVC-P2' ? 1 : 0)
      : s.direction === 'Массаж' ? (s.code === 'SVC-M2' ? 1 : 0)
      : s.weight,
  }))

// ─── 5. Посещаемость ТЗ §7: гостей/день → bathsLoad ───
// Гостей/день = Σ модулей (3 слота × 0.95 uptime × capacity) × load
//           = 3×0.95×(4+8+12) × load = 68.4 × load
const CAP_DAY = 3 * 0.95 * (4 + 8 + 12)
const tzGuests = [12, 16, 20, 30, 35]
const tzBaths = tzGuests.map((g) => g / CAP_DAY)
// ТЗ — одна модель: Base = точные вводные; боковые колонки — стресс ±15%
// по спросу (бaths). Парение 1.0/гость и массаж 0.5/гость фиксированы ТЗ.
const SCALE = [0.85, 1, 1.15]
const vec = (arr: number[], k: number) => arr.map((v) => Math.min(1, +(v * k).toFixed(6)))
mx.baths = {
  y1: vec([tzBaths[0]], 1).flatMap((v) => SCALE.map((s) => Math.min(1, v * s))),
  y2: vec([tzBaths[1]], 1).flatMap((v) => SCALE.map((s) => Math.min(1, v * s))),
  y3: vec([tzBaths[2]], 1).flatMap((v) => SCALE.map((s) => Math.min(1, v * s))),
  y4: vec([tzBaths[3]], 1).flatMap((v) => SCALE.map((s) => Math.min(1, v * s))),
  y5: vec([tzBaths[4]], 1).flatMap((v) => SCALE.map((s) => Math.min(1, v * s))),
}
for (const y of ['y1', 'y2', 'y3', 'y4', 'y5']) {
  mx.steam[y] = [1, 1, 1]
  mx.massage[y] = [0.5, 0.5, 0.5]
  mx.extra[y] = [0, 0, 0]
  mx.membersMonth[y] = [0, 0, 0]
  mx.glamping[y] = [0, 0, 0]
  mx.restaurant[y] = [0, 0, 0]
}
// ТЗ §6: контрольная выручка при неизменных ценах → рост цен = 0.
// ТЗ: посещаемость задана напрямую → выход на план мгновенный (ramp=1);
// параметр остаётся редактируемым входом в книге (ТЗ §3).
for (const k of ['priceGrowth', 'rampMonths']) {
  if (Array.isArray(mx[k])) mx[k] = mx[k].map(() => (k === 'priceGrowth' ? 0 : 1))
}
// ТЗ §1: расчёт первого этапа до запуска второй очереди.
// Открытие Nov-27 (capexMonths 9 + delay 1) + 38 мес → последний месяц
// Dec-30; k=38 = Jan-31 — уже месяц запуска оч.2, в горизонт не входит.
// Настройки оч.2 (модули, стройка, public bath) остаются входами книги.
p.meta.opsMonths = 38
p.meta.scenario = 'Base'

const blob = await exportWorkbook(p, mx, items, services, 'Base')
const buf = Buffer.from(await blob.arrayBuffer())
writeFileSync('out/aura-hills-tz.xlsx', buf)
console.log('written out/aura-hills-tz.xlsx', buf.length, 'bytes')
