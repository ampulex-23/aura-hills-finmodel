import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconMaximize, IconMinimize, IconUpload } from '@tabler/icons-react'
import { DECK_SLIDES } from '../docs'
import { docsApi, fileToBase64 } from '../lib/docsApi'
import { pdfToSlideBlobs, filesToSlideBlobs } from '../lib/slides'

// Просмотрщик презентации: слайды — картинки из DOCS_DIR (assets/deck,
// редактируются кнопкой «Обновить»: pdf или пачка картинок);
// при недоступной библиотеке — fallback на слайды из бандла.
export function DeckView() {
  const [idx, setIdx] = useState(0)
  const [fs, setFs] = useState(false)
  const [slides, setSlides] = useState<string[]>(DECK_SLIDES)
  const [server, setServer] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const tocRef = useRef<HTMLElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const total = slides.length

  const refresh = useCallback(async () => {
    try {
      const d = await docsApi.deck()
      if (d.slides.length) {
        setSlides(d.slides.map((p) => docsApi.rawUrl(p)))
        setServer(true)
      }
    } catch {
      setServer(false) // библиотека недоступна — остаёмся на бандле
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const go = useCallback(
    (d: number) => setIdx((i) => Math.min(total - 1, Math.max(0, i + d))),
    [total],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else stageRef.current?.requestFullscreen()
  }

  // Предзагрузка соседних слайдов — листание без фризов
  useEffect(() => {
    for (const i of [idx - 1, idx + 1])
      if (i >= 0 && i < total) new Image().src = slides[i]
  }, [idx, total, slides])

  // Лента превью догоняет активный слайд (стрелки/клавиши)
  useEffect(() => {
    tocRef.current
      ?.querySelector('.doc-toc-item.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [idx])

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return
    const list = [...files]
    try {
      const isPdf = list.length === 1 && /\.pdf$/i.test(list[0].name)
      const blobs = isPdf
        ? await pdfToSlideBlobs(list[0], (d, t) => setBusy(`Рендер pdf: ${d} / ${t}`))
        : filesToSlideBlobs(list)
      if (!blobs.length) { setBusy(null); return }
      setBusy(`Загрузка ${blobs.length} слайдов…`)
      const slides = await Promise.all(
        blobs.map(async (s) => ({ ext: s.ext, dataBase64: await fileToBase64(s.blob) })),
      )
      const res = await docsApi.saveDeck(slides)
      setIdx(0)
      setSlides(res.slides.map((p) => docsApi.rawUrl(p)))
      setServer(true)
    } catch (e) {
      console.error('deck update failed:', e)
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!total) return null

  return (
    <div className="deck">
      <div className="deck-main">
        <div className="deck-stage" ref={stageRef}>
          <img className="deck-slide" src={slides[idx]} alt={`Слайд ${idx + 1}`} />
          <div className="deck-hit left" onClick={() => go(-1)} />
          <div className="deck-hit right" onClick={() => go(1)} />
        </div>
        <div className="deck-bar">
        <Tooltip label="Назад (←)" openDelay={300}>
          <ActionIcon
            variant="subtle" color="gray" size="lg"
            disabled={idx === 0} onClick={() => go(-1)}
          >
            <IconChevronLeft size={20} />
          </ActionIcon>
        </Tooltip>
        <span className="deck-counter">{busy ?? `${idx + 1} / ${total}`}</span>
        <Tooltip label="Вперёд (→)" openDelay={300}>
          <ActionIcon
            variant="subtle" color="gray" size="lg"
            disabled={idx === total - 1} onClick={() => go(1)}
          >
            <IconChevronRight size={20} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={fs ? 'Выйти из полноэкранного' : 'На весь экран'} openDelay={300}>
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={toggleFs}>
            {fs ? <IconMinimize size={20} /> : <IconMaximize size={20} />}
          </ActionIcon>
        </Tooltip>
        {server && (
          <>
            <Tooltip label="Обновить презентацию (pdf или картинки)" openDelay={300}>
              <ActionIcon
                variant="subtle" color="gray" size="lg"
                disabled={!!busy} onClick={() => fileRef.current?.click()}
              >
                <IconUpload size={20} />
              </ActionIcon>
            </Tooltip>
            <input
              ref={fileRef} type="file" hidden multiple
              accept=".pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => void onPick(e.target.files)}
            />
          </>
        )}
        </div>
      </div>
      <aside className="deck-toc" ref={tocRef}>
        <div className="doc-toc-title">Слайды</div>
        {slides.map((s, i) => (
          <button
            key={s}
            className={`doc-toc-item deck-toc-item${i === idx ? ' active' : ''}`}
            onClick={() => setIdx(i)}
          >
            <img src={s} alt={`Слайд ${i + 1}`} loading="lazy" />
            <span>{i + 1}</span>
          </button>
        ))}
      </aside>
    </div>
  )
}
