// Модалка загрузки документа в Data Room: файл (md/typ/docx/pdf/xlsx)
// конвертируется в markdown в браузере, показывается превью-редактор,
// сохранение — в выбранный раздел DOCS_DIR (+ оригинал в assets/).
import { useRef, useState } from 'react'
import { Button, Checkbox, Group, Modal, Select, Text, TextInput, Textarea } from '@mantine/core'
import { IconFilePlus, IconUpload } from '@tabler/icons-react'
import { docsApi, fileToBase64 } from '../lib/docsApi'
import { importFile, docTitle } from '../lib/convert'

export function DocUpload({
  opened,
  onClose,
  author,
  categories,
  onSaved,
}: {
  opened: boolean
  onClose: () => void
  author: string
  categories: { id: string; title: string }[]
  onSaved: (path: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [md, setMd] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('inbox')
  const [newCat, setNewCat] = useState('')
  const [keepOriginal, setKeepOriginal] = useState(true)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [blank, setBlank] = useState(false)

  const reset = () => {
    setFile(null); setMd(''); setTitle(''); setNewCat('')
    setNote(''); setErr(''); setBlank(false); setKeepOriginal(true)
  }

  const pick = async (f: File) => {
    setErr(''); setNote('')
    setFile(f)
    setBlank(false)
    setTitle(docTitle(f.name))
    try {
      const c = await importFile(f)
      setMd(c.md)
      setNote(c.note ?? '')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось конвертировать')
      setMd('')
    }
  }

  const newBlank = () => {
    reset()
    setBlank(true)
    setMd('# Новый документ\n\n')
    setTitle('Новый документ')
  }

  const save = async () => {
    setBusy(true); setErr('')
    try {
      const cat = newCat.trim() ? '__new__' : category
      const { path } = await docsApi.create({
        category: cat === '__new__' ? newCat.trim() : cat,
        categoryTitle: newCat.trim() || undefined,
        title: title.trim() || 'Документ',
        source: md,
        author,
      })
      if (file && keepOriginal && !['md', 'typ'].includes(file.name.split('.').pop()?.toLowerCase() ?? '')) {
        try { await docsApi.saveAsset(file.name, await fileToBase64(file), { author }) }
        catch { /* оригинал не критичен */ }
      }
      reset()
      onClose()
      onSaved(path)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally { setBusy(false) }
  }

  const catData = [...categories.map((c) => ({ value: c.id, label: c.title }))]

  return (
    <Modal
      opened={opened}
      onClose={() => { reset(); onClose() }}
      title="Документ в Data Room"
      size="xl"
    >
      <Group gap="xs" mb="sm">
        <Button size="xs" variant="default" leftSection={<IconUpload size={14} />}
          onClick={() => fileRef.current?.click()}>
          {file ? file.name : 'Выбрать файл (md, docx, pdf, xlsx)'}
        </Button>
        <Button size="xs" variant="subtle" leftSection={<IconFilePlus size={14} />} onClick={newBlank}>
          Пустой документ
        </Button>
        <input
          ref={fileRef} type="file" hidden
          accept=".md,.typ,.docx,.pdf,.xlsx,.xlsm,.txt"
          onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])}
        />
      </Group>

      {err && <Text c="red" size="sm" mb="xs">{err}</Text>}
      {note && <Text c="dimmed" size="xs" mb="xs">{note}</Text>}

      {(file || blank) && (
        <>
          <Group gap="sm" mb="sm" grow>
            <TextInput label="Заголовок" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
            <Select
              label="Раздел"
              data={catData}
              value={newCat.trim() ? null : category}
              onChange={(v) => { setCategory(v ?? 'inbox'); setNewCat('') }}
              allowDeselect={false}
              disabled={Boolean(newCat.trim())}
            />
            <TextInput
              label="…или новый раздел"
              value={newCat}
              onChange={(e) => setNewCat(e.currentTarget.value)}
              placeholder="напр. Юридическое"
            />
          </Group>
          <Text size="xs" c="dimmed" mb={4}>Markdown-источник (можно править до сохранения):</Text>
          <Textarea
            value={md}
            onChange={(e) => setMd(e.currentTarget.value)}
            autosize minRows={12} maxRows={22}
            styles={{ input: { fontFamily: 'monospace', fontSize: 12, lineHeight: 1.45 } }}
          />
          {file && !file.name.endsWith('.md') && (
            <Checkbox
              mt="sm" size="xs"
              label="Сохранить оригинал файла в assets/ (для скачивания)"
              checked={keepOriginal}
              onChange={(e) => setKeepOriginal(e.currentTarget.checked)}
            />
          )}
          <Group mt="md" justify="flex-end">
            <Button variant="default" onClick={() => { reset(); onClose() }}>Отмена</Button>
            <Button loading={busy} disabled={!md.trim()} onClick={() => void save()}>
              Сохранить в Data Room
            </Button>
          </Group>
        </>
      )}
      {!file && !blank && (
        <Text size="sm" c="dimmed">
          docx и pdf конвертируются в текст/markdown прямо в браузере — вёрстка упрощается,
          таблицы становятся markdown-таблицами. Оригинал можно сохранить вложением.
        </Text>
      )}
    </Modal>
  )
}
