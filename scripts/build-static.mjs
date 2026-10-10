// Сборка статических артефактов для AI-агентов и краулеров (prebuild):
//   public/docs/*.md        — документы Data Room как сырой markdown
//   public/data/*.json      — допущения, сценарии, справочники
//   public/data/model-snapshot.json — рассчитанные таблицы (esbuild + snapshot.ts)
//   public/llms.txt         — индекс для LLM-агентов (llmstxt.org)
//   public/llms-full.txt    — вся документация одним файлом
//   public/robots.txt       — явное разрешение AI-краулерам
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const docsOut = join(root, 'public/docs')
const dataOut = join(root, 'public/data')
mkdirSync(docsOut, { recursive: true })
mkdirSync(dataOut, { recursive: true })

// 1. Документы, данные и слайды презентации — прямые копии
const docs = readdirSync(join(root, 'src/docs')).filter((f) => f.endsWith('.md'))
for (const f of docs) cpSync(join(root, 'src/docs', f), join(docsOut, f))
const deckSrc = join(root, 'src/docs/deck')
const deckOut = join(docsOut, 'deck')
mkdirSync(deckOut, { recursive: true })
for (const f of readdirSync(deckSrc).filter((f) => f.endsWith('.jpg')))
  cpSync(join(deckSrc, f), join(deckOut, f))
for (const f of readdirSync(join(root, 'src/data')).filter((f) => f.endsWith('.json')))
  cpSync(join(root, 'src/data', f), join(dataOut, f))

// 2. Расчётный снимок — собираем TS-модель esbuild'ом и выполняем
const bundle = join(root, 'scripts/.snapshot.bundle.mjs')
buildSync({
  entryPoints: [join(root, 'scripts/snapshot.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  logLevel: 'silent',
})
await import(pathToFileURL(bundle).href)
rmSync(bundle)

// 3. llms.txt — карта для агентов
const docLinks = docs
  .map((f) => {
    const src = readFileSync(join(root, 'src/docs', f), 'utf8')
    const title = src.match(/^#\s+(.+)/m)?.[1]?.trim() ?? f
    return `- [${title}](docs/${f})`
  })
  .join('\n')

writeFileSync(
  join(root, 'public/llms.txt'),
  `# AURA HILLS — финансовая модель

> Помесячная финансовая модель банного, SPA, wellness и глэмпинг-комплекса
> на Кипре в две очереди строительства: 12 месяцев стройки очереди 1 (2027),
> открытие 01.2028, 72 месяца эксплуатации (2028–2033); очередь 2
> (общественная баня на 40 чел, ресторан, 4 VIP-комплекса) строится в
> 2029–2030 и вводится 01.2031. Ядро расчёта — TypeScript, все допущения —
> типизированный JSON, результаты пересчитаны и лежат готовым снимком.
> Валюта — EUR. Три сценария: Conservative / Base / Aggressive.

## Документы

${docLinks} — принципы, формулы всех потоков, CAPEX двух очередей, налоги Кипра, KPI, карта полей и глоссарий
- [Презентация](docs/deck/slide-01.jpg) — инвестиционный питч-дек, 16 слайдов (docs/deck/slide-01.jpg … slide-16.jpg)
- [Вся документация одним файлом](llms-full.txt)

## Данные

- [Допущения](data/params.json) — все входные параметры: даты и горизонт (meta), налоги, цены, 7 банных модулей (3 оч. 1 + 4 VIP оч. 2), штат по фазам, смета CAPEX с WBS (capexItems, phase/object), очередь 2 (phase2, publicBath, restaurant)
- [Сценарии](data/scenarios.json) — матрица Conservative/Base/Aggressive по 5 годам: загрузки бань/услуг/глэмпинга/общественной бани/ресторана, члены, uptake, рост цен, буфер CAPEX, рампа, задержка стройки, энергия
- [Номенклатура](data/nomenclature.json) — 152 позиции закупок: режим учёта (OPEX/CAPEX/Спецификация), цены, доставка, нормы, стартовые запасы
- [Услуги](data/services.json) — 23 спецификации услуг: состав материалов и KPI-труд ролей, цена, себестоимость
- [Снимок результатов](data/model-snapshot.json) — по трём сценариям: KPI (NPV, IRR, окупаемость, MOIC, пиковая потребность, equity), годовые итоги, помесячные ряды (84 месяца), десять потоков выручки, CAPEX по очередям и разделам, чувствительность, tornado, break-even

## Ключевые факты

- Горизонт CF 84 месяца (плюс сценарная задержка стройки); метки «Янв 2027» … «Дек 2033».
- Налоги Кипра (реформа 2026): CIT 15%, НДС 19%/9%, SDC 5% и GESY 2.65% удерживаются из дивидендов резидентов, взносы работодателя 15.4%.
- WACC по CAPM 17.4% (эффективная годовая), IRR — эффективный годовой.
- CAPEX очереди 2 — €1.50M (с буфером 10% — €1.65M), отток помесячно 2029–2030.
`,
)

writeFileSync(
  join(root, 'public/llms-full.txt'),
  docs
    .map((f) => readFileSync(join(root, 'src/docs', f), 'utf8'))
    .join('\n\n---\n\n'),
)

// 4. robots.txt — явное разрешение известным AI-краулерам
writeFileSync(
  join(root, 'public/robots.txt'),
  `User-agent: *
Allow: /

User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: Claude-User
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: Google-Extended
Allow: /
`,
)

console.log(`static → ${docs.length} docs, data json, snapshot, llms.txt`)
