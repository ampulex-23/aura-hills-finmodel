// Тест библиотеки документов Data Room: реальный git-репо в tmp-каталоге.
// docs.mjs читает DOCS_DIR при импорте — ставим env до динамического import.
import { test, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'ah-docs-'))
process.env.DOCS_DIR = dir
const { docsApi, slugify } = await import('../server/docs.mjs')

test('bootstrap: репо + manifest с категориями по умолчанию', async () => {
  expect(await docsApi.isReady()).toBe(true)
  const t = await docsApi.tree()
  expect(t.head).toMatch(/^[0-9a-f]{40}$/)
  expect(t.categories.map((c) => c.id)).toContain('legal')
  expect(t.categories.map((c) => c.id)).toContain('inbox')
})

test('create: кириллический заголовок → латинский slug в категории', async () => {
  const r = await docsApi.create({
    category: 'concept', title: 'Текстовое описание', source: 'Тело документа', author: 'tester',
  })
  expect(r.path).toBe('concept/tekstovoe-opisanie.md')
  const f = await docsApi.get(r.path)
  expect(f.source).toContain('# Текстовое описание')
  const t = await docsApi.tree()
  expect(t.categories.find((c) => c.id === 'concept').docs.map((d) => d.path)).toContain(r.path)
})

test('save: правка = коммит, конфликт по устаревшему base', async () => {
  const f = await docsApi.get('concept/tekstovoe-opisanie.md')
  const r = await docsApi.save({
    path: f.path, source: f.source + '\nПравка.', author: 'tester', base: f.head,
  })
  expect(r.sha).not.toBe(f.head)
  await expect(docsApi.save({ path: f.path, source: 'x', base: f.head }))
    .rejects.toMatchObject({ status: 409 })
})

test('move: перенос между разделами обновляет дерево', async () => {
  const r = await docsApi.move({ from: 'concept/tekstovoe-opisanie.md', to: 'legal/dogovor.md', author: 'tester' })
  expect(r.path).toBe('legal/dogovor.md')
  const t = await docsApi.tree()
  expect(t.categories.find((c) => c.id === 'legal').docs.map((d) => d.path)).toContain('legal/dogovor.md')
})

test('history/version: правки видны в git-истории файла', async () => {
  const history = await docsApi.history('legal/dogovor.md')
  expect(history.length).toBeGreaterThanOrEqual(3)
  const v = await docsApi.version('legal/dogovor.md', history[0].sha)
  expect(v.source).toContain('# Текстовое описание')
})

test('remove: файл удаляется, но остаётся в истории', async () => {
  await docsApi.remove({ path: 'legal/dogovor.md', author: 'tester' })
  await expect(docsApi.get('legal/dogovor.md')).rejects.toMatchObject({ status: 404 })
  const history = await docsApi.history('legal/dogovor.md')
  expect(history[0].message).toContain('-legal/dogovor.md')
})

test('assets: бинарник кладётся в assets/ и отдаётся raw', async () => {
  const b64 = Buffer.from('fake-pdf').toString('base64')
  const r = await docsApi.saveAsset({ name: 'Референсы.pdf', dataBase64: b64, author: 'tester' })
  expect(r.path).toBe('assets/referensy.pdf')
  const raw = await docsApi.raw(r.path)
  expect(raw.data.toString()).toBe('fake-pdf')
  expect(raw.mime).toBe('application/pdf')
})

test('безопасность: path traversal и неверные расширения отклоняются', async () => {
  await expect(docsApi.get('../etc/passwd')).rejects.toMatchObject({ status: 400 })
  await expect(docsApi.save({ path: 'concept/evil.exe', source: 'x' })).rejects.toMatchObject({ status: 400 })
  await expect(docsApi.save({ path: 'concept/ok.md', source: 'x' })).resolves.toBeTruthy()
  await expect(docsApi.raw('../manifest.json')).rejects.toMatchObject({ status: 400 })
})

test('slugify: кириллица в латиницу', () => {
  expect(slugify('Договор подряда № 1')).toBe('dogovor-podryada-1')
})

test('cleanup', () => { rmSync(dir, { recursive: true, force: true }) })
