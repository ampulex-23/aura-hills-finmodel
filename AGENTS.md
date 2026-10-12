# AURA Hills Finmodel — agent guide

Финансовая модель банно-глэмпингового комплекса AURA HILLS (Кипр).
TypeScript-ядро расчёта — единственный источник истины (Excel НЕ является
источником, это только экспорт). React/Vite фронт, JSON-допущения, vitest.

## Команды

```bash
npm ci                    # установка
npx vitest run            # тесты (71 шт, все должны быть зелёными)
npx tsc -b                # типизация
npm run build             # prebuild (build-static → public/) + vite build
node scripts/build-static.mjs   # только статика: снимок, docs, llms.txt
```

## Структура

- `src/model/` — движок: `run.ts` (оркестрация), `revenue/opex/fot/capex/taxes/pnl/cashflow/kpis.ts`, `scenario.ts`, `view.ts` (снимок для ИИ и статики), `types.ts`
- `src/data/` — входы: `params.json` (дефолтные допущения), `scenarios.json` (3 сценария), `nomenclature.json`, `services.json`
- `src/tabs/` — UI-вкладки; `src/components/` — общие (MonthTable, AiChat, Hint)
- `src/docs/` — md-документы Data Room (автоматически в сайдбаре; нужны таблица + KaTeX — есть docrender-тест)
- `server/index.mjs` — PM2-сервер: статика + ИИ-консультант (инструменты get_kpis/get_monthly/get_capex…)
- `scripts/build-static.mjs` — генерация public/: model-snapshot.json, docs, llms.txt
- `tests/` — `_baseline.ts` (клон дефолтов, откат к эпохе оракула), `golden`, `invariants`, `audit-regressions`, `phase2`, `sensitivity`, `docrender`

## Правила работы

- **Не менять движок под эталоны.** Golden/инвариант-тесты сверяют ядро с оракулом
  старой эпохи: при изменении ДЕФОЛТОВ бизнес-входов (цены, даты, флаги) —
  фиксируй старые значения в `tests/_baseline.ts`, а не подгоняй эталоны.
  phase2/audit/invariants используют `baselineParams()` или явные клоны.
- **Дефолты** живут в `params.json`; сохранённое состояние пользователя мёржится
  в store.ts (недостающие поля добираются из дефолтов).
- **Опциональные слои** (members/certs/fb/glamping, прачечная, preopen, оч. 2) —
  гейтятся флагами enabled/status; выключенный слой не участвует в расчётах.
- **Таймлайн**: `meta.constructionStart` + `meta.capexMonths` = дата открытия
  `meta.openingDate`; операционный горизонт `meta.opsMonths` (72). CF-массив =
  capexMonths + opsMonths; ops-месяц k → CF-индекс k + capexMonths. Налоги и
  сезонность — по КАЛЕНДАРНЫМ месяцам (`revenue[k].monthOfYear`), годовые
  векторы — по операционным годам (yearIdx).
- Метки месяцев — «Янв 2027» (полный год); месячная арифметика — `y*12 + (m-1)`.
- После изменений: `npx vitest run` (71/71), `npx tsc -b`, при изменении модели —
  обновить model-guide.md / подсказки / промпт ИИ-консультанта (server/index.mjs)
  / llms.txt (scripts/build-static.mjs).

## Деплой (не делать из агента без запроса)

`deploy/deploy-vds.sh` — git pull → npm ci → VITE_BASE=/ build → pm2 restart aura.
Прод: https://shared.metodoxia25.net (PM2 `aura`).
