// Страница документа библиотеки Data Room: просмотр (DocView),
// редактирование markdown-источника, история версий (git log файла),
// переименование/перемещение и удаление — всё через /api/docs/*.
import { useCallback, useEffect, useState } from 'react'
import { Button, Group, Modal, Select, Text, TextInput, Textarea } from '@mantine/core'
import {
  IconDeviceFloppy, IconDownload, IconEdit, IconHistory,
  IconPencil, IconTrash, IconX,
} from '@tabler/icons-react'
import { DocView } from './DocView'
import type { DocEntry } from '../docs'
import { docsApi, type DocFile, type DocVersion } from '../lib/docsApi'

export function DocPage({
  entry,
  author,
  categories,
  onRefresh,
  onDeleted,
}: {
  entry: DocEntry
  author: string
  categories: { id: string; title: string }[]
  onRefresh: () => Promise<void>
  onDeleted: () => void
}) {
  const [file, setFile] = useState<DocFile | null>(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [title, setTitle] = useState(entry.title)
  const [busy, setBusy] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [showHist, setShowHist] = useState(false)
  const [history, setHistory] = useState<DocVersion[]>([])
  const [verSrc, setVerSrc] = useState<{ sha: string; source: string } | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveCat, setMoveCat] = useState(entry.category)

  const load = useCallback(async () => {
    if (!entry.path) return
    setErr('')
    try {
      const f = await docsApi.get(entry.path)
      setFile(f)
      setDraft(f.source)
      setTitle(f.meta.title || entry.title)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка загрузки')
    }
  }, [entry.path, entry.title])

  useEffect(() => {
    setFile(null); setEditing(false); setVerSrc(null); setShowHist(false)
    void load()
  }, [load])

  if (entry.kind !== 'lib') return null

  const save = async () => {
    if (!entry.path || !file) return
    setBusy(true); setSaveErr('')
    try {
      await docsApi.save(entry.path, draft, {
        title, author,
        base: file.head,
        message: `правка ${entry.path}`,
      })
      setEditing(false)
      await Promise.all([load(), onRefresh()])
    } catch (e) {
      setSaveErr(e instanceof Error && e.message === 'conflict'
        ? 'Документ изменён кем-то ещё — перезагрузите и повторите'
        : `Ошибка сохранения: ${e instanceof Error ? e.message : e}`)
    } finally { setBusy(false) }
  }

  const openHistory = async () => {
    if (!entry.path) return
    setShowHist(true)
    try { setHistory((await docsApi.history(entry.path)).history) } catch { setHistory([]) }
  }

  const viewVersion = async (sha: string) => {
    if (!entry.path) return
    try { setVerSrc(await docsApi.version(entry.path, sha)) } catch { /* нет файла в ревизии */ }
  }

  const doMove = async () => {
    if (!entry.path || !moveCat) return
    const name = entry.path.split('/').pop()
    const to = `${moveCat}/${name}`
    if (to === entry.path) { setMoveOpen(false); return }
    setBusy(true)
    try {
      await docsApi.move(entry.path, to, author)
      setMoveOpen(false)
      await onRefresh()
      onDeleted() // уйти со старого маршрута — дерево откроет новый
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Ошибка перемещения')
    } finally { setBusy(false) }
  }

  const doDelete = async () => {
    if (!entry.path) return
    if (!confirm(`Удалить «${entry.title}»? Файл останется в истории git.`)) return
    setBusy(true)
    try {
      await docsApi.remove(entry.path, { author })
      await onRefresh()
      onDeleted()
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Ошибка удаления')
    } finally { setBusy(false) }
  }

  const shown: DocEntry = verSrc
    ? { ...entry, source: verSrc.source, kind: 'md' }
    : { ...entry, source: file?.source ?? '', kind: entry.ext === 'typ' ? 'lib' : 'md' }

  return (
    <div>
      <Group gap="xs" mb="sm" wrap="wrap" className="doc-toolbar">
        <Text fw={600} size="sm">{verSrc ? `${entry.title} · версия ${verSrc.sha.slice(0, 7)}` : entry.title}</Text>
        {entry.ext === 'typ' && <Text size="xs" c="dimmed">.typ · typst-превью скоро</Text>}
        <div style={{ flex: 1 }} />
        {verSrc ? (
          <Button size="compact-xs" variant="default" leftSection={<IconX size={13} />} onClick={() => setVerSrc(null)}>
            К текущей
          </Button>
        ) : (
          <>
            {editing ? (
              <>
                <Button size="compact-xs" color="green" leftSection={<IconDeviceFloppy size={13} />}
                  loading={busy} onClick={() => void save()}>Сохранить</Button>
                <Button size="compact-xs" variant="default" leftSection={<IconX size={13} />}
                  onClick={() => { setEditing(false); setDraft(file?.source ?? '') }}>Отмена</Button>
              </>
            ) : (
              <Button size="compact-xs" variant="default" leftSection={<IconEdit size={13} />}
                onClick={() => { setDraft(file?.source ?? ''); setEditing(true) }}>Править</Button>
            )}
            <Button size="compact-xs" variant="default" leftSection={<IconHistory size={13} />}
              onClick={() => void openHistory()}>История</Button>
            <Button size="compact-xs" variant="default" leftSection={<IconPencil size={13} />}
              onClick={() => setMoveOpen(true)}>Раздел</Button>
            <a href={docsApi.rawUrl(entry.path ?? '')} download={entry.path?.split('/').pop()}>
              <Button component="span" size="compact-xs" variant="default" leftSection={<IconDownload size={13} />}>
                Скачать
              </Button>
            </a>
            <Button size="compact-xs" variant="subtle" color="red" leftSection={<IconTrash size={13} />}
              loading={busy} onClick={() => void doDelete()} />
          </>
        )}
      </Group>

      {err && <Text c="red" size="sm">{err}</Text>}
      {saveErr && <Text c="red" size="sm" mb="xs">{saveErr}</Text>}

      {showHist && !verSrc && (
        <div className="doc-history">
          <Text size="xs" c="dimmed" mb={4}>Версии документа (git):</Text>
          {history.length === 0 && <Text size="xs" c="dimmed">история пуста</Text>}
          {history.map((v) => (
            <button key={v.sha} className="doc-hist-item" onClick={() => void viewVersion(v.sha)}>
              <code>{v.sha.slice(0, 7)}</code> {v.message}
              <span className="doc-hist-date">{new Date(v.date).toLocaleString('ru-RU')} · {v.author}</span>
            </button>
          ))}
        </div>
      )}

      {!file && !err && <Text size="sm" c="dimmed">Загрузка…</Text>}

      {file && !editing && entry.ext !== 'typ' && <DocView doc={shown} />}
      {file && !editing && entry.ext === 'typ' && (
        <pre className="doc-typ-src">{file.source}</pre>
      )}

      {editing && (
        <div className="doc-editor">
          <TextInput size="xs" label="Заголовок" value={title}
            onChange={(e) => setTitle(e.currentTarget.value)} mb="xs" />
          <Textarea
            className="doc-editor-area"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            autosize minRows={24} maxRows={60}
            styles={{ input: { fontFamily: 'monospace', fontSize: 12.5, lineHeight: 1.5 } }}
          />
        </div>
      )}

      <Modal opened={moveOpen} onClose={() => setMoveOpen(false)} title="Переместить в раздел" size="sm">
        <Select
          label="Раздел"
          data={categories.map((c) => ({ value: c.id, label: c.title }))}
          value={moveCat}
          onChange={(v) => v && setMoveCat(v)}
          allowDeselect={false}
        />
        <Group mt="md" justify="flex-end">
          <Button variant="default" onClick={() => setMoveOpen(false)}>Отмена</Button>
          <Button loading={busy} onClick={() => void doMove()}>Переместить</Button>
        </Group>
      </Modal>
    </div>
  )
}
