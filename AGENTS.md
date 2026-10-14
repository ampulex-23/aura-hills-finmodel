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
- `server/index.mjs` — PM2-сервер: статика + ИИ-консультант (инструменты get_kpis/get_monthly/get_capex…) + API версий
- `server/state.mjs` — версионирование состояния через git (см. «Версии модели» ниже)
- `src/api.ts`, `src/diff.ts`, `src/tabs/Versions.tsx` — клиент API, семантический diff, вкладка версий
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
- **Спеки — источник выручки услуг**: выручка и объёмы направлений
  «Парения/Массаж/Доп. услуги» считаются по спецификациям — `price` и `weight`
  (доля в меню) живут в `services.json`, дубля `params.procedures` нет.
  Объёмы привязаны к `service.code` (`rev.serviceCounts`), удаление услуги
  полностью убирает её из распределения. Депозитный пул направления фиксирован
  (деньги уже собраны) — удалённая позиция перераспределяет свою долю по весам
  оставшихся, но теряет свой COGS и KPI.
- **Таймлайн**: `meta.constructionStart` + `meta.capexMonths` = дата открытия
  `meta.openingDate`; операционный горизонт `meta.opsMonths` (72). CF-массив =
  capexMonths + opsMonths; ops-месяц k → CF-индекс k + capexMonths. Налоги и
  сезонность — по КАЛЕНДАРНЫМ месяцам (`revenue[k].monthOfYear`), годовые
  векторы — по операционным годам (yearIdx).
- Метки месяцев — «Янв 2027» (полный год); месячная арифметика — `y*12 + (m-1)`.
- После изменений: `npx vitest run` (71/71), `npx tsc -b`, при изменении модели —
  обновить model-guide.md / подсказки / промпт ИИ-консультанта (server/index.mjs)
  / llms.txt (scripts/build-static.mjs).

## Версии модели (git-версионирование параметров)

Состояние модели (params/matrix/items/services + активный сценарий) версионируется
в **отдельном git-репозитории** `DATA_DIR` (env, дефолт `<repo>/data`, gitignored —
НЕ внутри репо приложения: deploy делает `git pull --ff-only`, вложенный репо его сломает).
При первом старте сервер делает `git init` и сеет baseline из `src/data/`.

- Каждое сохранение из UI («Сохранить версию») = один коммит с автором и сообщением.
  История append-only: «Откатить» создаёт новый коммит `restore <sha>`, не переписывает историю.
- `DATA_REMOTE` (env) — опциональный remote (приватный репо): push после каждого коммита,
  ошибки push не фатальны (нужны креды на сервере: ssh-ключ или токен в URL).
- API: `GET /api/state` (состояние+head), `POST /api/state` {bundle, message, author, base}
  (409 при устаревшем base — оптимистичная блокировка от гонок), `GET /api/versions`,
  `GET /api/versions/:sha`, `POST /api/versions/:sha/restore` {author}.
  `GET /api/health` отдаёт `versioning: true/false` — без git фронт деградирует к localStorage+JSON.
- `src/store.ts`: `baseSha` (база черновика), `dirty`, `previewSha` (read-only просмотр
  версии — черновик прячется в localStorage `aura-hills-draft-stash`), `serverPending`
  (сервер ≠ локальный черновик при старте), `savedState` (для счётчика изменений).
- Записи на сервере сериализуются очередью; файлы пишутся атомарно (tmp+rename);
  сервер валидирует минимальную структуру перед коммитом.
- `src/diff.ts` — семантический diff: params по пути, номенклатура/спеки по `code`,
  матрица по ячейке. Используется вкладкой «Версии» и счётчиком в шапке.
- `src/data/*.json` остаются дефолтами/схемой в репо кода — НЕ заменяются данными
  из DATA_DIR. Поменять дефолт = правка в коде через git/PR как раньше.
- Тест: `tests/state-api.test.mjs` (vitest, реальный git в tmp).

## Деплой (не делать из агента без запроса)

`deploy/deploy-vds.sh` — git pull → npm ci → VITE_BASE=/ build → pm2 restart aura.
Прод: https://shared.metodoxia25.net (PM2 `aura`).
