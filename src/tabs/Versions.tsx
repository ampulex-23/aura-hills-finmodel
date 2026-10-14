// Вкладка «Версии»: история коммитов модели (git на сервере),
// семантический diff выбранной версии против сохранённой, откат/просмотр/экспорт.
import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Badge, Button, Group, ScrollArea, Stack, Table, Text,
} from '@mantine/core'
import { api, type ModelBundle, type VersionInfo } from '../api'
import { diffBundles, fmtVal, type DiffEntry } from '../diff'
import { useModel } from '../store'

const rel = (iso: string) => {
  const d = new Date(iso)
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  if (min < 60 * 24) return `${Math.round(min / 60)} ч назад`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

const fmtCell = (v: unknown) => {
  const s = fmtVal(v)
  return s.length > 60 ? s.slice(0, 57) + '…' : s
}

function DiffTable({ diff }: { diff: DiffEntry[] }) {
  if (!diff.length) return <Text size="sm" c="dimmed">Изменений нет — состояния идентичны.</Text>
  const sections = [...new Set(diff.map((d) => d.section))]
  return (
    <Table striped highlightOnHover withTableBorder fz="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Параметр</Table.Th>
          <Table.Th w={180}>Было</Table.Th>
          <Table.Th w={180}>Стало</Table.Th>
        </Table.Tr>
      </Table.Thead>
      {sections.map((sec) => (
        <Table.Tbody key={sec}>
          <Table.Tr>
            <Table.Td colSpan={3} style={{ background: 'var(--mantine-color-gray-0)' }}>
              <Badge size="sm" variant="light" color="dark">{sec}</Badge>
            </Table.Td>
          </Table.Tr>
          {diff.filter((d) => d.section === sec).map((d, i) => (
            <Table.Tr key={d.key + i}>
              <Table.Td>
                <Text size="xs" ff="monospace">{d.label}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs" c={d.kind === 'add' ? 'dimmed' : 'red'} td={d.kind === 'remove' ? 'line-through' : undefined}>
                  {d.kind === 'add' ? '·' : fmtCell(d.before)}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs" c={d.kind === 'remove' ? 'dimmed' : 'green'}>
                  {d.kind === 'remove' ? '·' : fmtCell(d.after)}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      ))}
    </Table>
  )
}

export function Versions() {
  const { versioned, baseSha, dirty, savedState, author, previewSha, loadVersion, restoreVersion, syncVersions } = useModel()
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [selState, setSelState] = useState<ModelBundle | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => api.listVersions().then((r) => setVersions(r.versions)).catch(() => {})
  useEffect(() => { void refresh() }, [baseSha])

  useEffect(() => {
    if (!sel) return setSelState(null)
    if (sel === baseSha && savedState) return setSelState(savedState)
    api.getVersion(sel).then((r) => setSelState(r.state)).catch(() => setSelState(null))
  }, [sel, baseSha, savedState])

  const diff = useMemo(
    () => (selState && savedState ? diffBundles(savedState, selState) : []),
    [selState, savedState],
  )
  // diff считается «сохранённая → выбранная»: чтобы показать «что принесла версия»,
  // при просмотре старой версии стрелки инвертированы — подпись столбцов это отражает.

  const download = async (sha: string) => {
    const { state } = await api.getVersion(sha)
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `aura-hills-model-${sha.slice(0, 7)}.json`
    a.click()
  }

  if (versioned === false)
    return <Alert color="gray">Сервер без версионирования — изменения хранятся только в этом браузере. Используйте выгрузку JSON.</Alert>
  if (versioned === null)
    return <Text c="dimmed" size="sm">Проверка сервера версий…</Text>

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Text fw={600}>История версий</Text>
          {dirty && <Badge color="yellow" variant="light">есть несохранённые изменения</Badge>}
          {baseSha && <Badge color="gray" variant="outline" ff="monospace">{baseSha.slice(0, 7)}</Badge>}
        </Group>
        <Button size="xs" variant="default" onClick={() => { void syncVersions(); void refresh() }}>Обновить</Button>
      </Group>

      <ScrollArea mah={280}>
        <Table highlightOnHover withTableBorder fz="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Версия</Table.Th><Table.Th>Комментарий</Table.Th>
              <Table.Th>Автор</Table.Th><Table.Th>Когда</Table.Th><Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {versions.map((v, i) => (
              <Table.Tr
                key={v.sha}
                onClick={() => setSel(v.sha)}
                style={{ cursor: 'pointer', background: sel === v.sha ? 'var(--mantine-color-blue-0)' : undefined }}
              >
                <Table.Td>
                  <Group gap={6}>
                    <Text ff="monospace" size="xs">{v.sha.slice(0, 7)}</Text>
                    {v.sha === baseSha && <Badge size="xs" color="green">текущая</Badge>}
                    {v.sha === previewSha && <Badge size="xs" color="violet">просмотр</Badge>}
                    {i === 0 && <Badge size="xs" color="blue" variant="light">последняя</Badge>}
                  </Group>
                </Table.Td>
                <Table.Td><Text size="xs">{v.message}</Text></Table.Td>
                <Table.Td><Text size="xs" c="dimmed">{v.author}</Text></Table.Td>
                <Table.Td><Text size="xs" c="dimmed">{rel(v.date)}</Text></Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap" justify="flex-end" onClick={(e) => e.stopPropagation()}>
                    <Button size="compact-xs" variant="subtle" onClick={() => void loadVersion(v.sha)}>Открыть</Button>
                    <Button size="compact-xs" variant="subtle" onClick={() => void download(v.sha)}>JSON</Button>
                    {i > 0 && (
                      <Button
                        size="compact-xs" variant="subtle" color="red" loading={busy}
                        onClick={() => {
                          if (!confirm(`Откатить модель к версии ${v.sha.slice(0, 7)}?\n«${v.message}»\n\nТекущее состояние останется в истории — откат создаёт новый коммит.`)) return
                          setBusy(true)
                          void restoreVersion(v.sha).finally(() => setBusy(false))
                        }}
                      >
                        Откатить
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      {sel && selState && savedState && (
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            {sel === baseSha
              ? 'Текущая сохранённая версия'
              : `Версия ${sel.slice(0, 7)} — сравнение с текущей сохранённой`}
          </Text>
          {sel !== baseSha && (
            <Text size="xs" c="dimmed">«Было» — текущая сохранённая, «Стало» — версия {sel.slice(0, 7)}</Text>
          )}
          <DiffTable diff={diff} />
        </Stack>
      )}
      {author === '' && (
        <Text size="xs" c="dimmed">Совет: укажите своё имя в диалоге «Сохранить версию» — оно попадёт в историю.</Text>
      )}
    </Stack>
  )
}
