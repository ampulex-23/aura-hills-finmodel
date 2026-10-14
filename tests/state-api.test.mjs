// Тест серверного версионирования: реальный git-репо в tmp-каталоге.
// state.mjs читает DATA_DIR при импорте — ставим env до динамического import.
import { test, expect, beforeAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'ah-state-'))
process.env.DATA_DIR = dir
const { stateApi } = await import('../server/state.mjs')

test('bootstrap: репо инициализируется и сеет baseline из src/data', async () => {
  expect(await stateApi.isReady()).toBe(true)
  const { head, state } = await stateApi.getState()
  expect(head).toMatch(/^[0-9a-f]{40}$/)
  expect(state.params.meta.openingDate).toBeTruthy()
  const versions = await stateApi.listVersions()
  expect(versions).toHaveLength(1)
  expect(versions[0].message).toContain('baseline')
})

test('saveState: коммит + конфликт по устаревшему base', async () => {
  const { head, state } = await stateApi.getState()
  state.params.general.inflation = 0.099
  const r = await stateApi.saveState({ ...state, message: 't', author: 'tester', base: head })
  expect(r.sha).not.toBe(head)
  await expect(stateApi.saveState({ ...state, message: 'stale', base: head }))
    .rejects.toMatchObject({ status: 409 })
})

test('getVersion / restoreVersion: история читается, откат — новым коммитом', async () => {
  const versions = await stateApi.listVersions()
  const base = versions.find((v) => v.message.includes('baseline'))
  const old = await stateApi.getVersion(base.sha)
  expect(old.state.params.general.inflation).not.toBe(0.099)
  const r = await stateApi.restoreVersion(base.sha, 'tester')
  expect(r.state.params.general.inflation).toBe(old.state.params.general.inflation)
  const after = await stateApi.listVersions()
  expect(after[0].message).toContain('restore')
  expect(after.length).toBe(versions.length + 1)
})

test('saveState: валидация отклоняет мусор', async () => {
  await expect(stateApi.saveState({ params: {}, matrix: {}, items: [], services: [] }))
    .rejects.toMatchObject({ status: 400 })
})

test('cleanup', () => { rmSync(dir, { recursive: true, force: true }) })
