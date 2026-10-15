import { ActionIcon, Button, SegmentedControl } from '@mantine/core'
import { useModel } from '../store'
import { Hint, NumField, TextCell } from '../components/ui'

// Вкладка «IT»: кастомный цифровой слой — подписки/инфраструктура помесячно,
// внедрение разово в CAPEX, IT-куратор в ФОТ.
export function It() {
  const { params, setParam } = useModel()
  const it = params.it

  return (
    <div>
      <p className="note" style={{ maxWidth: 720 }}>
        Кастомный цифровой слой: единый контур букинг + CRM + учёт + сайт. CAPEX — разовая
        разработка и внедрение в период стройки; OPEX — содержание помесячно с индексацией
        на инфляцию; IT-куратор добавляется в ФОТ.
      </p>
      <div className="form-grid">
        <fieldset>
          <legend>Режим</legend>
          <label className="field">
            <Hint hint={{ text: 'Выключает весь цифровой слой разом: CAPEX внедрения, помесячное содержание и ставку IT-куратора в ФОТ.' }}>
              <span>Учитывать IT в модели</span>
            </Hint>
            <SegmentedControl
              size="xs"
              data={['Да', 'Нет']}
              value={it.enabled ? 'Да' : 'Нет'}
              onChange={(v) => setParam('it.enabled', v === 'Да')}
            />
          </label>
          <label className="field">
            <span>IT-куратор, оклад €/мес</span>
            <NumField value={it.curator} onChange={(v) => setParam('it.curator', v)} step={100} disabled={!it.enabled} />
          </label>
          <small className="note">Оклад задаётся здесь и добавляется в ФОТ; во вкладке «Штат» куратор виден read-only строкой.</small>
        </fieldset>

        <fieldset>
          <legend>Содержание, €/мес</legend>
          {it.opex.map((x, i) => (
            <label className="field" key={i}>
              <TextCell w={170} value={x.name} onChange={(v) => setParam(`it.opex.${i}.name`, v)} />
              <NumField value={x.base} onChange={(v) => setParam(`it.opex.${i}.base`, v)} step={10} disabled={!it.enabled} />
              <ActionIcon size="sm" variant="subtle" color="red" disabled={!it.enabled}
                onClick={() => setParam('it.opex', it.opex.filter((_, j) => j !== i))}>✕</ActionIcon>
            </label>
          ))}
          <label className="field">
            <span><b>Итого</b></span>
            <span><b>€{it.opex.reduce((s, x) => s + x.base, 0).toLocaleString('ru-RU')}</b></span>
          </label>
          <Button size="xs" variant="default" disabled={!it.enabled}
            onClick={() => setParam('it.opex', [...it.opex, { name: 'Новая подписка', base: 0 }])}>
            + Строка
          </Button>
        </fieldset>

        <fieldset>
          <legend>Внедрение (CAPEX, €)</legend>
          {it.capex.map((x, i) => (
            <label className="field" key={i}>
              <TextCell w={170} value={x.name} onChange={(v) => setParam(`it.capex.${i}.name`, v)} />
              <NumField value={x.eur} onChange={(v) => setParam(`it.capex.${i}.eur`, v)} step={500} disabled={!it.enabled} />
              <ActionIcon size="sm" variant="subtle" color="red" disabled={!it.enabled}
                onClick={() => setParam('it.capex', it.capex.filter((_, j) => j !== i))}>✕</ActionIcon>
            </label>
          ))}
          <label className="field">
            <span><b>Итого</b></span>
            <span><b>€{it.capex.reduce((s, x) => s + x.eur, 0).toLocaleString('ru-RU')}</b></span>
          </label>
          <Button size="xs" variant="default" disabled={!it.enabled}
            onClick={() => setParam('it.capex', [...it.capex, { name: 'Новая строка', eur: 0 }])}>
            + Строка
          </Button>
        </fieldset>
      </div>
    </div>
  )
}
