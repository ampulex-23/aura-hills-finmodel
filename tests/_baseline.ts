import paramsJson from '../src/data/params.json'
import scenariosJson from '../src/data/scenarios.json'
import nomenclatureJson from '../src/data/nomenclature.json'
import servicesJson from '../src/data/services.json'
import type { NomenclatureItem, Params, ScenarioMatrix, ServiceSpec } from '../src/model/types'

// Общая подготовка данных для golden/sensitivity-baseline: слои, добавленные
// сверх исходного Excel-оракула и аудитов 13–14, выключаются, чтобы эталоны
// фиксировали ядро расчёта, а не бизнес-допущения.
export function baselineParams(): Params {
  const p = JSON.parse(JSON.stringify(paramsJson)) as Params
  p.it.enabled = false // IT/АСУ нет в оракуле
  p.units.presaleMode = 'incremental' // deferred-пресейл — расширение
  p.fb.enabled = false // F&B-слой
  p.preopen.enabled = false // pre-opening
  p.members.consumeSlots = false // ёмкость членов
  p.members.serviceSpendPerVisit = 0 // сервисный чек членов (аудит 14)
  p.units.certRedemptionRate = 0 // сертификаты без потребления ёмкости (аудит 14)
  p.taxes.gesy = 0 // GESY
  p.taxes.vatQuarterly = false // квартальная уплата НДС (аудит 14)
  p.taxDepr.enabled = false // налоговый график CIT
  p.glampOta.enabled = false // OTA-комиссия
  p.service.serviceLoads = false // векторы загрузки услуг
  p.meta.vatMode = 'Гросс' // оракул считал без зачёта входного НДС
  p.general.waccMode = 'manual' // CAPM — аудит 14; оракул на ручных 14%
  p.capexMaint.enabled = false // maintenance CAPEX — аудит 14
  p.capexSCurve = [] // равномерная стройка, как в оракуле
  for (const f of p.opexFixed) delete f.pctOfRevenue // маркетинг фикс, как в оракуле

  // Данные эпохи оракула — фиксируем входы, чтобы golden/sensitivity проверяли
  // идентичность ДВИЖКА, а не изменившиеся бизнес-допущения (аудит 14).
  p.taxes.cit = 0.125 // CIT 15% — реформа Кипра с 2026
  p.taxes.employerRate = 0.1515 // взносы работодателя уточнены до 15.4%
  p.seasonality.baths = [1.25, 1.2, 1.1, 1.05, 0.9, 0.7, 1, 0.65, 0.9, 1.2, 1.25, 1]
  p.seasonality.glamping = [0.3, 0.4, 0.7, 1.1, 1.2, 1.1, 0.8, 0.8, 1.1, 1.2, 0.6, 0.3]
  p.seasonality.certificates = Array(12).fill(1) // сезонности сертификатов не было
  // Эмуляция старого плоского дисконта wacc/12: (1+w)^(1/12)−1 = 0.14/12.
  // Новый код дисконтирует по эффективной ставке (аудит 14, W-4) — верно,
  // но оракул посчитан по-старому, поэтому ставку эквивалентно поднимаем.
  p.general.wacc = Math.pow(1 + 0.14 / 12, 12) - 1 // ≈0.14934 → monthly 0.011667
  // Штат и даты очередей эпохи оракула: поэтапный ФОТ (phases) и перенос
  // очереди 2 на 2031-01 появились после эталонов.
  p.fot.count = [6, 4, 2, 2, 1, 1, 2, 1, 2]
  p.fot.phases = []
  for (const m of p.modules) if (m.status !== 'Активен') m.launchDate = '2029-01-01'
  // Строки CAPEX, добавленные после эталонов (здание персонала, пожарка; прачечная выкл.)
  p.capexItems = p.capexItems.filter((it) => ![32, 33].includes(it.row ?? -1))
  return p
}

export function baselineMatrix(): ScenarioMatrix {
  const m = JSON.parse(JSON.stringify(scenariosJson)) as ScenarioMatrix
  m.constructionDelayMonths = m.names.map(() => 0) // стрессы стройки — аудит 14
  m.energyCostMult = m.names.map(() => 1)
  m.capexAdj = [0.15, 0, 0] // contingency в Base/Aggressive — аудит 14, W-6
  return m
}

export const items = nomenclatureJson as NomenclatureItem[]
export const services = servicesJson.services as unknown as ServiceSpec[]
