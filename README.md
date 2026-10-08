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
│                    #   cashflow, kpis, sensitivity, run (оркестратор)
├── tabs/            # вкладки UI = листы исходной книги
├── export/excel.ts  # генерация .xlsx из текущего состояния
└── store.ts         # состояние + localStorage + JSON import/export
tests/               # golden-master + sensitivity
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

12 мес. стройка (янв–дек 2027) + 60 мес. операционки (янв 2028–дек 2032).
Выручка: 7 потоков (аренда бань, парения, массаж, доп.услуги, глэмпинг,
членства/сертификаты, F&B). Два режима: пакетный депозит €110/гость vs
uptake-раскрытие. НДС: Гросс / С возмещением. CIT с переносом убытков,
дивиденды 90% ЧП с лагом 12 мес, SDC на дивиденды.

## Верификация

Ядро сверено с Excel-моделью через `formulas`-оракул по 3 сценариям:
NPV Δ<0.01%, IRR/payback/пиковая потребность — точное совпадение.
Sensitivity — 57 точек реального пересчёта за ~0.3с (в Python-версии было ~20 мин).
