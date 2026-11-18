# AURA Hills Finmodel — agent guide

Финансовая модель банно-глэмпингового комплекса AURA HILLS (Кипр).
TypeScript-ядро расчёта — единственный источник истины (Excel НЕ является
источником, это только экспорт). React/Vite фронт, JSON-допущения, vitest.

## Команды

```bash
npm ci                    # установка
npx vitest run            # тесты (все должны быть зелёными)
npx tsc -b                # типизация
npm run build             # prebuild (build-static → public/) + vite build
node scripts/build-static.mjs   # только статика: снимок, docs, llms.txt
```

## Структура

- `src/model/` — движок: `run.ts` (оркестрация), `revenue/opex/fot/capex/taxes/pnl/cashflow/kpis.ts`, `scenario.ts`, `view.ts` (снимок для ИИ и статики), `types.ts`
- `src/model/methodology.ts` — **методики**: именованные наборы правил расчёта (см. раздел «Методики» ниже)
- `src/data/` — входы: `params.json` (дефолтные допущения), `scenarios.json` (3 сценария), `nomenclature.json`, `services.json`
- `src/tabs/` — UI-вкладки; `src/components/` — общие (MonthTable, AiChat, Hint)
- `src/docs/` — md-документы Data Room (автоматически в сайдбаре; нужны таблица + KaTeX — есть docrender-тест)
- `server/index.mjs` — PM2-сервер: статика + ИИ-консультант (инструменты get_kpis/get_monthly/get_capex…) + API версий
- `server/state.mjs` — версионирование состояния через git (см. «Версии модели» ниже)
- `src/api.ts`, `src/diff.ts`, `src/tabs/Versions.tsx` — клиент API, семантический diff, вкладка версий
- `scripts/build-static.mjs` — генерация public/: model-snapshot.json, docs, llms.txt
- `tests/` — `_baseline.ts` (клон дефолтов, откат к эпохе оракула), `golden`, `invariants`, `audit-regressions`, `phase2`, `sensitivity`, `docrender`, `methodology`, `investor-parity` (+ эталон `tests/oracle/`)
- `scenarios/<имя>/bundle.json` — готовые версии состояния модели (формат `POST /api/state`), собираются скриптом из `scripts/`

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
- После изменений: `npx vitest run`, `npx tsc -b`, при изменении модели —
  обновить model-guide.md / подсказки / промпт ИИ-консультанта (server/index.mjs)
  / llms.txt (scripts/build-static.mjs).

## Методики (правила расчёта отдельно от значений)

Результат = ядро × методика × параметры. Параметры — значения («сколько»),
методика — правила («как считать»): `daysBasis` (30 дн | календарные),
`priceIndex` (опер. год | календарный год | таблица), `bonusIndex`
(нет | инфляция | индекс цен), `tax` (годовой кипрский CIT с переносом убытков |
помесячный, с опциями отрицательного налога и условных процентов на дефицит).
Плюс флаг строки `opexFixed[].nonDeductible` (расход вне базы CIT).

- Пресеты — `METHODOLOGY_PRESETS` в `src/model/methodology.ts`: `cyprus`
  (дефолт; поведение ядра до слоя методик, его держат golden-тесты) и `investor`.
  `params.methodology = { id, ...переопределения }`; поля нет → `cyprus`.
- **Новое расхождение «в правилах» с чужой моделью — это новое значение правила
  в методике, а не флаг в params и не ветка git.** Дефолтная ветка расчёта при
  этом не меняется бит-в-бит. Правило добавляется вместе с тестом в
  `tests/methodology.test.ts`, строкой в `src/docs/methodology.md` и селектором
  в «Допущения → Методика расчёта».
- Версия «Инвестор — СПА Авдиму»: `scenarios/investor-avdimou/` (bundle + README
  с мостом расхождений), сборка `node scripts/build-investor-scenario.mjs` из
  эталона `tests/oracle/investor-avdimou.json` (снят
  `scripts/extract-investor-oracle.py`, нужен openpyxl). Сверка —
  `tests/investor-parity.test.ts`.

## Версии модели (git-версионирование параметров)

Состояние модели (params/matrix/items/services + активный сценарий) версионируется
в **отдельном git-репозитории** `DATA_DIR` (env, дефолт `<repo>/data`, gitignored —
НЕ внутри репо приложения: deploy делает `git pull --ff-only`, вложенный репо его сломает).
При первом старте сервер делает `git init` и сеет baseline из `src/data/`.

- Каждый коммит параметров несёт трейлеры `Core: <sha репо приложения>` и
  `Methodology: <id>` (ставит сервер; `CORE_SHA` env — для сборок без .git).
  `GET /api/versions` отдаёт их по каждой версии + текущий `core`; вкладка «Версии»
  подсвечивает версии, сохранённые на другом ядре. Версии старше привязки — `core: null`.
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

## Библиотека документов Data Room (git-репо)

Документы DR живут в **отдельном git-репозитории** `DOCS_DIR` (env, дефолт
`<repo>/docs-data`, gitignored). Файловая система = дерево:
`<категория>/<slug>.md|.typ`, оригиналы импортов и вложения — в `assets/`,
`manifest.json` — порядок/названия категорий и мета документов (title,
confidential). Каждая правка/удаление/перенос — коммит; история append-only
с `--follow`. `DOCS_REMOTE` (env) — remote для бэкапа: на проде пушит в приватный репо
`ampulex-23/aura-hills-docs-data` после каждого коммита (push не фатален).
Встроенные документы `src/docs/*.md` засеваются в `DOCS_DIR` при старте
(`SEED_CAT` в `docs.mjs`; фронт прячет статичный дубль по slug) — поэтому
«Руководство» и «Навигация» редактируются через API как все документы.
Редактор — `MdEditor` (MDXEditor, lazy-чанк, `dark-theme` + `mdeditor.css`);
документы с `$$`/mermaid/raw HTML открываются в режиме «Исходник».

- API: `GET /api/docs/tree|file|history|version|raw|deck`, `PUT /api/docs/file`,
  `POST /api/docs/create|move|asset|deck`, `DELETE /api/docs/file`,
  `PUT /api/docs/manifest`. `/api/health → docs: true/false`.
- **Презентация**: слайды живут в `DOCS_DIR/assets/deck/slide-NNN.(jpg|png|webp)`
  — при первом старте засеваются из бандла `src/docs/deck/`. `GET /api/docs/deck`
  отдаёт список, `POST /api/docs/deck` заменяет весь набор одним коммитом.
  `DeckView` берёт слайды из API (фолбэк — бандл), кнопка «Обновить» принимает
  pdf (рендерится в jpeg через pdfjs в браузере, `src/lib/slides.ts`) или
  пачку картинок (натуральная сортировка по имени).
- Клиент: `src/lib/docsApi.ts`; встроенные доки (`src/docs/*.md`, deck,
  генплан) + библиотека объединяются в дереве `docGroups()` (`src/docs.ts`),
  рендер — `DocPage` (просмотр DocView + правка + история + перенос + удаление),
  импорт — `DocUpload` → `src/lib/convert.ts` (docx/pdf/xlsx → markdown
  в браузере, сервер остаётся zero-dep).
- `.typ` принимаются и хранятся, typst-компиляция — следующий этап
  (сейчас показывается исходник).
- Тест: `tests/docs-api.test.mjs` (реальный git в tmp).

## Деплой (не делать из агента без запроса)

`deploy/deploy-vds.sh` — git pull → npm ci → VITE_BASE=/ build → pm2 restart aura.
Прод: https://shared.metodoxia25.net (PM2 `aura`).

## Генплан (bim-as-code)

Раздел «Генплан» в Data Room читает `/genplan/` — артефакты репозитория
`bim-as-code` (E:\projects\bim-as-code), собираемые post-receive хуком на VDS:
push в `/srv/bim.git` → `deploy/build-publish.sh` → `/srv/genplan/`
(plan.svg/iso.svg/site.ifc/site.glb/spec.json + manifest.json{commit,built_at}).
nginx: `location ^~ /genplan/ → alias` (deploy/nginx-shared.conf). Контракт —
только этот каталог; web не знает про Python, BIM не знает про web.
