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

// 1. Документы и данные — прямые копии
const docs = readdirSync(join(root, 'src/docs')).filter((f) => f.endsWith('.md'))
for (const f of docs) cpSync(join(root, 'src/docs', f), join(docsOut, f))
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

> Помесячная финансовая модель банного, SPA и глэмпинг-комплекса на Кипре:
> 12 месяцев строительства + 60 месяцев эксплуатации. Все допущения — в JSON,
> результаты пересчитаны и лежат готовым снимком. Валюта — EUR.

## Документы

${docLinks}

## Данные

- [Допущения](data/params.json) — все входные параметры модели
- [Сценарии](data/scenarios.json) — матрица Conservative/Base/Aggressive
- [Номенклатура](data/nomenclature.json) — справочник норм расхода и цен
- [Услуги](data/services.json) — спецификации себестоимости услуг
- [Снимок результатов](data/model-snapshot.json) — KPI, годовые и помесячные P&L/FCFF, чувствительность по сценариям
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
