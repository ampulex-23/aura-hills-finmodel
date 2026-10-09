// Разовый патч данных под правки аудита 14 (этапы A–C). Запуск: node scripts/_patch-audit-params.mjs
import { readFileSync, writeFileSync } from 'fs'

const P = 'src/data/params.json'
const S = 'src/data/scenarios.json'
const p = JSON.parse(readFileSync(P, 'utf8'))
const s = JSON.parse(readFileSync(S, 'utf8'))

// A. Налоги — реформа Кипра 2026 (CIT 15%, SDC 5%), взносы работодателя 15.4%, потолок GESY, квартальный НДС
p.taxes.cit = 0.15
p.taxes.sdc = 0.05
p.taxes.employerRate = 0.154
p.taxes.gesyCap = 180000
p.taxes.vatQuarterly = true
// A. НДС: базовый режим — с возмещением
p.meta.vatMode = 'С возмещением'
// A. Сезонность: нормировка к среднему 1.0; сертификаты — предновогодний пик
const norm = (v) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return v.map((x) => Math.round((x / m) * 10000) / 10000) }
p.seasonality.baths = norm(p.seasonality.baths)
p.seasonality.glamping = norm(p.seasonality.glamping)
p.seasonality.certificates = norm([0.9, 1.2, 1.0, 0.8, 0.8, 0.6, 0.6, 0.6, 0.8, 0.9, 1.3, 2.5])
// C. WACC — CAPM
p.general.waccMode = 'capm'
p.general.capm = { rf: 0.032, beta: 1.4, erp: 0.055, countryPremium: 0.015, sizePremium: 0.05 }
// B. Членства: пиковая доля и сервисный чек; сертификаты — спрос с ёмкостью
p.members.peakShare = 0.3
p.members.serviceSpendPerVisit = 50
p.units.certRedemptionRate = 0.85
p.units.certGuestsPerCert = 1
// B. Maintenance CAPEX + S-кривая стройки
p.capexMaint = { enabled: true, pctPerYear: 0.015, startYear: 2, lumpYear: 4, lumpEur: 60000 }
p.capexSCurve = [0.04, 0.05, 0.07, 0.09, 0.11, 0.12, 0.12, 0.11, 0.10, 0.08, 0.06, 0.05]
// B. Маркетинг как % выручки, энергетические статьи
for (const f of p.opexFixed) {
  if (f.name.startsWith('Маркетинг')) f.pctOfRevenue = 0.035
  if (f.name.startsWith('Электроэнергия') || f.name.startsWith('Отопление')) f.energy = true
}
// C. TV: exit multiple
p.tv.exitMultiple = 6

// B. Сценарии — полные 5-летние векторы (без интерполяции), contingency, стройка, энергия
const lerp = (a, b, t) => a + (b - a) * t
const full = (y1, y3, k4, k5) => ({
  y1, y2: y1.map((v, i) => Math.round(lerp(v, y3[i], 20 / 35) * 1000) / 1000), y3,
  y4: y3.map((v) => Math.round(Math.min(1, v + k4) * 1000) / 1000),
  y5: y3.map((v) => Math.round(Math.min(1, v + k5) * 1000) / 1000),
})
s.steam = full(s.steam.y1, s.steam.y3, 0.05, 0.05)
s.massage = full(s.massage.y1, s.massage.y3, 0.05, 0.10)
s.glamping = { ...full(s.glamping.y1, s.glamping.y3, 0.05, 0.10) }
s.glamping.y2 = s.glamping.y1.map((v, i) => Math.round(lerp(v, s.glamping.y3[i], 15 / 25) * 1000) / 1000)
s.extra = Object.fromEntries(Object.entries(s.steam).map(([k, v]) => [k, v.map((x) => Math.round(Math.max(0, x - 0.25) * 1000) / 1000)]))
const m1 = s.membersMonth.y1, m3 = s.membersMonth.y3
s.membersMonth = {
  y1: m1, y2: m1.map((v, i) => Math.round(lerp(v, m3[i], 30 / 70))), y3: m3,
  y4: m3.map((v) => Math.round(v * 1.25)), y5: m3.map((v) => Math.round(v * (170 / 120))),
}
s.capexAdj = [0.2, 0.1, 0.05]
s.constructionDelayMonths = [4, 1, 0]
s.energyCostMult = [1.3, 1.0, 0.9]
// порядок ключей
const ordered = { names: s.names, baths: s.baths, steam: s.steam, massage: s.massage, extra: s.extra, glamping: s.glamping, membersMonth: s.membersMonth, priceGrowth: s.priceGrowth, capexAdj: s.capexAdj, rampMonths: s.rampMonths, uptake: s.uptake, constructionDelayMonths: s.constructionDelayMonths, energyCostMult: s.energyCostMult }

writeFileSync(P, JSON.stringify(p, null, 2) + '\n')
writeFileSync(S, JSON.stringify(ordered, null, 2) + '\n')
console.log('seasonality means', ['baths', 'glamping', 'certificates'].map((k) => (p.seasonality[k].reduce((a, b) => a + b, 0) / 12).toFixed(4)))
console.log(JSON.stringify(ordered, null, 0).slice(0, 600))
