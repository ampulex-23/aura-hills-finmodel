import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconMaximize, IconMinimize } from '@tabler/icons-react'
import { DECK_SLIDES } from '../docs'

// Просмотрщик презентации: слайды — картинки из src/docs/deck/,
// навигация стрелками, клавишами ←/→ и лентой превью.
export function DeckView() {
  const [idx, setIdx] = useState(0)
  const [fs, setFs] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const total = DECK_SLIDES.length
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
      if (i >= 0 && i < total) new Image().src = DECK_SLIDES[i]
  }, [idx, total])

  if (!total) return null

  return (
    <div className="deck">
      <div className="deck-main">
        <div className="deck-stage" ref={stageRef}>
          <img className="deck-slide" src={DECK_SLIDES[idx]} alt={`Слайд ${idx + 1}`} />
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
        <span className="deck-counter">{idx + 1} / {total}</span>
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
        </div>
      </div>
      <aside className="deck-toc">
        <div className="doc-toc-title">Слайды</div>
        {DECK_SLIDES.map((s, i) => (
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
