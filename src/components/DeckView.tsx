import { useCallback, useEffect, useState } from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { DECK_SLIDES } from '../docs'

// Просмотрщик презентации: слайды — картинки из src/docs/deck/,
// навигация стрелками, клавишами ←/→ и лентой превью.
export function DeckView() {
  const [idx, setIdx] = useState(0)
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

  // Предзагрузка соседних слайдов — листание без фризов
  useEffect(() => {
    for (const i of [idx - 1, idx + 1])
      if (i >= 0 && i < total) new Image().src = DECK_SLIDES[i]
  }, [idx, total])

  if (!total) return null

  return (
    <div className="deck">
      <div className="deck-stage">
        <img className="deck-slide" src={DECK_SLIDES[idx]} alt={`Слайд ${idx + 1}`} />
        <div className="deck-hit left" onClick={() => go(-1)} />
        <div className="deck-hit right" onClick={() => go(1)} />
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
        </div>
      </div>
      <div className="deck-thumbs">
        {DECK_SLIDES.map((s, i) => (
          <img
            key={s}
            src={s}
            alt={`Слайд ${i + 1}`}
            className={`deck-thumb${i === idx ? ' active' : ''}`}
            onClick={() => setIdx(i)}
            loading="lazy"
          />
        ))}
      </div>
    </div>
  )
}
