# AURA HILLS — финансовая модель (веб-приложение)

Банный/SPA/wellness-комплекс на Кипре. Финмодель перенесена из Excel в TypeScript:
ядро считается кодом, React-фронт — интерфейс, Excel — только экспортный артефакт.

## Стек

- **TypeScript** — ядро модели (`src/model/`), без зависимостей от UI
- **React + Vite** — интерфейс, статическая сборка
- **Vitest** — golden-master тесты против Excel-оракула (`formulas` engine)
- **exceljs** — экспорт .xlsx из рассчитанного состояния
- **KaTeX** — формулы в тултипах
- **Recharts** — графики/дашборды
- **zustand + localStorage** — состояние и персистентность

## Структура

```
src/
├── data/            # params.json, scenarios.json, nomenclature.json (источник истины)
├── model/           # ядро: types, scenario, revenue, opex, fot, capex, taxes, pnl,
│                    #   cashflow, balance, kpis, sensitivity, run (оркестратор)
├── tabs/            # вкладки UI = листы исходной книги
├── export/excel.ts  # генерация .xlsx из текущего состояния
└── store.ts         # состояние + localStorage + JSON import/export
tests/               # golden-master + audit-regressions + invariants + sensitivity
```

## Разработка

```bash
npm install
npm run dev     # http://localhost:5173/aura-hills-finmodel/
npm run test    # golden-master сверка с Excel-оракулом
npm run build   # статика в dist/
npm run deploy  # push main + VDS: pull → npm ci → build → pm2 restart (shared.metodoxia25.net)
```

## Горизонт модели

12 мес. стройка (янв–дек 2027) + 60 мес. операционки (янв 2028–дек 2032);
сценарная задержка стройки удлиняет горизонт. Выручка: 7 потоков (аренда
бань, парения, массаж, доп.услуги, глэмпинг, членства/сертификаты, F&B).
Два режима: пакетный депозит €110/гость vs uptake-раскрытие. НДС:
«С возмещением» (дефолт) / «Гросс», квартальная уплата. CIT 15% (реформа
Кипра 2026) с переносом убытков, дивиденды 90% ЧП с лагом 12 мес,
SDC 5% + GESY 2.65% (потолок €180k/год) удерживаются из дивиденд.
WACC — CAPM (≈17.4%) или ручной.

## Верификация

53 теста, 5 файлов: golden-master (ядро воспроизводит Excel-эталон **до евро**
при спинах входов эпохи оракула — `tests/_baseline.ts`), audit-regressions
(налоговые и CF-механики), invariants (баланс, ΣFCFF=NPV, WBS, монотонность),
sensitivity (100 точек реального пересчёта за ~1с). Excel-экспорт проверяется
скриптами `scripts/_gen-xlsx.ts` + `_check-xlsx.py` + `_verify-xlsx.py`:
2 623 формулы, 0 ошибок, 8/8 независимых Checks.
