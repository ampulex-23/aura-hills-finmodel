import { useEffect, useMemo, useState } from 'react'
import { Anchor, Button, Checkbox, Text } from '@mantine/core'
import { fmt } from './ui'
import { Genplan3D } from './Genplan3D'

// Data Room «Генплан»: артефакты репозитория bim-as-code, собранные на сервере
// (post-receive → compiler build → /srv/genplan/ → nginx alias /genplan/).
// Контракт — manifest.json {commit, built_at, artifacts} + spec.json + превью.
// Если артефактов нет — раздел показывает заглушку, не падает.
//
// Кликабельный генплан: plan.svg встраивается инлайн, у зданий в нём
// группы <g data-slug="…" data-plan="1"> (emit_svg). Клик по зданию с
// планировкой открывает чертежи buildings/<slug>/{plan,facades}.svg.

const BASE = 'genplan'

interface Manifest {
  commit: string
  built_at: string
  artifacts: string[]
}
interface SpecSpace {
  name: string
  program: string
  area: number
  geom_area?: number
  outdoor?: boolean
}
interface SpecMepWater {
  points_cold: number
  points_hot: number
  pipe_m: Record<string, number>
  recirculation_m: number
  manifolds: number
  q_total_ls: number
}
interface SpecMepDrain {
  points: Record<string, number>
  pipe_m: Record<string, number>
  stacks: number
  vent_stacks: number
  traps: number
  max_drop_m: number
}
interface SpecMepEl {
  lights: number
  outlets: number
  switches: number
  lights_ip44: number
  lights_heat: number
  equipment: number
  groups: number
  groups_rcd: number
  cable_m: Record<string, number>
  installed_kw: number
  panel_modules: number
}
interface SpecModule {
  name: string
  slug?: string
  type: string
  queue: number
  footprint_m2: number
  storeys: number
  slots: number
  spaces?: SpecSpace[]
  spaces_area_m2?: number
  has_plan?: boolean
  mep?: { water?: SpecMepWater; drain?: SpecMepDrain; electrical?: SpecMepEl }
}
interface Spec {
  site: string
  modules: SpecModule[]
  totals: {
    modules: number
    parking_stalls: number
    pools: number
    footprint_total_m2: number
    spaces_area_by_program_m2: Record<string, number>
  }
}

const LANDSCAPE = /^(terrain|road|site)\//

const PROGRAM: Record<string, string> = {
  steam: 'парная', wash: 'мойка/душ', wc: 'санузел', rest: 'отдых',
  lobby: 'холл', massage: 'массаж', changing: 'раздевалка',
  terrace: 'терраса', tech: 'тех.', hall: 'зал', kitchen: 'кухня',
  bedroom: 'комната', dorm: 'спальня', cafe: 'кафе',
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })

const fmtSize = async (url: string) => {
  try {
    const r = await fetch(url, { method: 'HEAD' })
    const n = Number(r.headers.get('content-length'))
    return isFinite(n) && n > 0 ? `${(n / 1e6).toFixed(1)} МБ` : null
  } catch {
    return null
  }
}

function FileLink({ file, label }: { file: string; label: string }) {
  const [size, setSize] = useState<string | null>(null)
  useEffect(() => {
    fmtSize(`${BASE}/${file}`).then(setSize)
  }, [file])
  return (
    <Anchor href={`${BASE}/${file}`} download={file} size="sm">
      {label}
      {size && <Text span c="dimmed" size="xs"> · {size}</Text>}
    </Anchor>
  )
}

// Сводка инженерных сетей здания из spec.json → mep (компилируется
// из mep.yaml репозитория bim-as-code).
function MepSummary({ mep }: { mep: NonNullable<SpecModule['mep']> }) {
  const w = mep.water
  const d = mep.drain
  const e = mep.electrical
  const dn = (m: Record<string, number>, unit = 'м') =>
    Object.entries(m).map(([k, v]) => `Ø${k}: ${fmt(v, 1)} ${unit}`).join(' · ')
  const mm = (m: Record<string, number>) =>
    Object.entries(m).map(([k, v]) => `${k} мм²: ${fmt(v, 0)} м`).join(' · ')
  const drainPts = d ? Object.entries(d.points)
    .map(([k, v]) => `Ø${k} × ${v}`).join(' · ') : ''
  return (
    <>
      <h3>Инженерные сети</h3>
      <div className="table-wrap">
        <table className="month-table">
          <thead>
            <tr>
              <th className="sticky">Система</th>
              <th>Точки / приборы</th>
              <th>Трубопроводы / кабели</th>
              <th>Узлы и оборудование</th>
            </tr>
          </thead>
          <tbody>
            {w && (
              <tr>
                <td className="sticky">В1/Т3 — водопровод</td>
                <td>{w.points_cold} ХВС + {w.points_hot} ГВС
                  {' · '}q {fmt(w.q_total_ls, 2)} л/с</td>
                <td>{dn(w.pipe_m)}
                  {w.recirculation_m > 0 &&
                    ` · рецирк. ${fmt(w.recirculation_m, 1)} м`}</td>
                <td>{w.manifolds} коллектора</td>
              </tr>
            )}
            {d && (
              <tr>
                <td className="sticky">К1 — канализация</td>
                <td>{drainPts}</td>
                <td>{dn(d.pipe_m)}</td>
                <td>{d.stacks} стояков ({d.vent_stacks} вент.) · {d.traps} трапов
                  {' · '}падение ≤ {fmt(d.max_drop_m, 2)} м</td>
              </tr>
            )}
            {e && (
              <tr>
                <td className="sticky">ЭОМ — электрика</td>
                <td>{e.lights} свет. ({e.lights_ip44} IP44,
                  {' '}{e.lights_heat} термост.) · {e.outlets} роз. ·{' '}
                  {e.switches} выкл. · {e.equipment} оборуд.</td>
                <td>{mm(e.cable_m)}</td>
                <td>{e.groups} групп ({e.groups_rcd} под УЗО) ·{' '}
                  {fmt(e.installed_kw, 1)} кВт · ЩР {e.panel_modules} мод.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Text size="xs" c="dimmed" mt="xs" mb="md">
        Количества компилируются из mep.yaml: точки сетей следуют за
        санприборами и мебелью плана, трассы и метражи — по маршрутам
        коллекторов/стояков/групп. Детализация — docs/12 пресметы инженерки.
      </Text>
    </>
  )
}

// Детальный вид здания: план 1 этажа + фасады + экспликация помещений.
function BuildingDetail({ m, onBack }: { m: SpecModule; onBack: () => void }) {
  const rooms = m.spaces ?? []
  const [showWk, setShowWk] = useState(false)
  const [showEl, setShowEl] = useState(false)
  const hasWk = !!(m.mep?.water || m.mep?.drain)
  const hasEl = !!m.mep?.electrical
  return (
    <>
      <Button variant="subtle" size="sm" mb="xs" onClick={onBack}>
        ← К генплану
      </Button>
      <h2>
        {m.name} <Text span c="dimmed" size="sm"><code>{m.type}</code></Text>
      </h2>
      <Text size="sm" c="dimmed" mb="md">
        Пятно {fmt(m.footprint_m2, 0)} м²
        {m.spaces_area_m2 != null && ` · помещения ${fmt(m.spaces_area_m2, 0)} м²`}
        {' · этажей: '}{m.storeys}
      </Text>

      <h3>План 1 этажа</h3>
      {(hasWk || hasEl) && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center',
                      margin: '4px 0 8px' }}>
          {hasWk && (
            <Checkbox size="sm" label="ВК/К1 — вода и канализация"
                      checked={showWk}
                      onChange={(ev) => setShowWk(ev.currentTarget.checked)} />
          )}
          {hasEl && (
            <Checkbox size="sm" label="ЭОМ — электрика"
                      checked={showEl}
                      onChange={(ev) => setShowEl(ev.currentTarget.checked)} />
          )}
          {(showWk || showEl) && (
            <Text size="xs" c="dimmed">
              полные чертежи слоёв:{' '}
              {showWk && <Anchor href={`${BASE}/buildings/${m.slug}/plan-wk.svg`}
                                 target="_blank">ВК/К1</Anchor>}
              {showWk && showEl && ' · '}
              {showEl && <Anchor href={`${BASE}/buildings/${m.slug}/plan-el.svg`}
                                 target="_blank">ЭОМ</Anchor>}
            </Text>
          )}
        </div>
      )}
      <div className="genplan-canvas">
        <div className="genplan-layered">
          <img src={`${BASE}/buildings/${m.slug}/plan.svg`}
               alt={`План — ${m.name}`} />
          {showWk && (
            <img className="mep-layer"
                 src={`${BASE}/buildings/${m.slug}/layer-wk.svg`}
                 alt="Слой ВК/К1" />
          )}
          {showEl && (
            <img className="mep-layer"
                 src={`${BASE}/buildings/${m.slug}/layer-el.svg`}
                 alt="Слой ЭОМ" />
          )}
        </div>
      </div>

      <h3>Фасады</h3>
      <div className="genplan-canvas">
        <img src={`${BASE}/buildings/${m.slug}/facades.svg`}
             alt={`Фасады — ${m.name}`} />
      </div>

      {rooms.length > 0 && (
        <>
          <h3>Экспликация помещений</h3>
          <div className="table-wrap">
            <table className="month-table">
              <thead>
                <tr>
                  <th className="sticky">Помещение</th>
                  <th>Назначение</th>
                  <th>S, м²</th>
                  <th>S геом., м²</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.name}>
                    <td className="sticky">{r.name}</td>
                    <td>{PROGRAM[r.program] ?? r.program}</td>
                    <td>{r.area != null ? fmt(r.area, 2) : '—'}</td>
                    <td>{r.geom_area != null ? fmt(r.geom_area, 2) : '—'}</td>
                  </tr>
                ))}
                <tr className="bold">
                  <td className="sticky">Итого</td>
                  <td />
                  <td>{fmt(rooms.reduce((a, r) => a + (r.area ?? 0), 0), 2)}</td>
                  <td>{fmt(rooms.reduce((a, r) => a + (r.geom_area ?? 0), 0), 2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {m.mep && <MepSummary mep={m.mep} />}
    </>
  )
}

export function GenplanView() {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [spec, setSpec] = useState<Spec | null>(null)
  const [planSvg, setPlanSvg] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [sel, setSel] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([
      fetch(`${BASE}/manifest.json`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${BASE}/spec.json`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${BASE}/plan.svg`).then((r) => (r.ok ? r.text() : null)),
    ]).then(([m, s, svg]) => {
      if (!live) return
      if (!m && !s) setMissing(true)
      setManifest(m)
      setSpec(s)
      setPlanSvg(svg)
    })
    return () => {
      live = false
    }
  }, [])

  const buildings = spec?.modules.filter((m) => !LANDSCAPE.test(m.type)) ?? []
  // slug-модули: GLB-узлы называются site/<slug>/<kind>
  const moduleNames = useMemo(
    () => new Map((spec?.modules ?? []).filter((m) => m.slug)
      .map((m) => [m.slug!, m.name])),
    [spec],
  )
  const plannedSlugs = useMemo(
    () => new Set(buildings.filter((m) => m.has_plan && m.slug)
      .map((m) => m.slug!)),
    [spec],
  )

  if (missing)
    return (
      <div className="doc-body">
        <h1>Генплан</h1>
        <p>
          Артефакты BIM-модели ещё не собраны на сервере. Раздел наполняется
          пайплайном репозитория <code>bim-as-code</code>: push в main → сборка
          компилятором → публикация в <code>/genplan/</code>.
        </p>
      </div>
    )

  if (!manifest && !spec) return null

  const landscape = spec?.modules.filter((m) => LANDSCAPE.test(m.type)) ?? []
  const selected = sel ? buildings.find((m) => m.slug === sel) : null

  // делегирование клика по инлайн-SVG: ближайшая группа с data-slug;
  // открываем только здания с чертежами (data-plan="1")
  const onPlanClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const g = (e.target as Element).closest('g[data-slug]')
    const slug = g?.getAttribute('data-slug')
    if (g && slug && g.getAttribute('data-plan') === '1') setSel(slug)
  }

  return (
    <div className="doc-body genplan">
      <h1>Генплан участка</h1>
      <Text size="sm" c="dimmed" mb="md">
        Цифровая модель AURA HILLS — репозиторий <code>bim-as-code</code>, YAML-исходники →
        IFC4. Это «живые» артефакты: пересобираются из исходников при каждом push.
      </Text>

      {selected ? (
        <BuildingDetail m={selected} onBack={() => setSel(null)} />
      ) : (
        <>
          <h2>План</h2>
          {planSvg ? (
            <>
              <div className="genplan-canvas genplan-map"
                   onClick={onPlanClick}
                   dangerouslySetInnerHTML={{ __html: planSvg }} />
              {buildings.some((m) => m.has_plan) && (
                <Text size="xs" c="dimmed" mt={-8} mb="md">
                  Клик по зданию с планировкой — план помещений и фасады.
                </Text>
              )}
            </>
          ) : (
            <div className="genplan-canvas">
              <img src={`${BASE}/plan.svg`} alt="Генплан участка" />
            </div>
          )}

          <h2>3D-вид</h2>
          <Genplan3D
            url={`${BASE}/site.glb`}
            names={moduleNames}
            planned={plannedSlugs}
            onSelect={setSel}
            fallback={
              <div className="genplan-canvas">
                <img src={`${BASE}/iso.svg`} alt="Изометрия модели" />
              </div>
            }
          />

          {spec && (
            <>
              <h2>Здания и сооружения</h2>
              <div className="table-wrap">
                <table className="month-table">
                  <thead>
                    <tr>
                      <th className="sticky">Объект</th>
                      <th>Тип</th>
                      <th>Пятно, м²</th>
                      <th>Этажей</th>
                      <th>Очередь</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {buildings.map((m) => (
                      <tr key={m.name}
                          className={m.has_plan ? 'clickable' : undefined}
                          onClick={m.has_plan && m.slug
                            ? () => setSel(m.slug!) : undefined}>
                        <td className="sticky">{m.name}</td>
                        <td><code>{m.type}</code></td>
                        <td>{fmt(m.footprint_m2, 0)}</td>
                        <td>{m.storeys}</td>
                        <td>{m.queue}</td>
                        <td>{m.has_plan && '⌗ план'}</td>
                      </tr>
                    ))}
                    <tr className="bold">
                      <td className="sticky">Здания: {buildings.length}</td>
                      <td />
                      <td>{fmt(buildings.reduce((a, m) => a + m.footprint_m2, 0), 0)}</td>
                      <td colSpan={3} />
                    </tr>
                  </tbody>
                </table>
              </div>
              <Text size="sm" c="dimmed" mt="xs">
                Ландшафт и площадки: {landscape.length} объектов
                {spec.totals.parking_stalls > 0 && ` · парковочных мест: ${spec.totals.parking_stalls}`}
                {spec.totals.pools > 0 && ` · бассейнов: ${spec.totals.pools}`}
                {' · пятно застройки всего: '}
                {fmt(spec.totals.footprint_total_m2, 0)} м²
              </Text>
            </>
          )}
        </>
      )}

      <h2>Файлы модели</h2>
      <div className="genplan-files">
        <FileLink file="site.ifc" label="site.ifc — IFC4 (BIM-модель)" />
        <FileLink file="site.glb" label="site.glb — 3D-модель" />
        <FileLink file="plan.svg" label="plan.svg — генплан (вектор)" />
        <FileLink file="iso.svg" label="iso.svg — изометрия (вектор)" />
        <FileLink file="spec.json" label="spec.json — спецификация" />
      </div>

      {manifest && (
        <Text size="xs" c="dimmed" mt="lg">
          Собрано из bim-as-code @{' '}
          <Text span ff="monospace">{manifest.commit.slice(0, 7)}</Text>
          {' · '}{fmtDate(manifest.built_at)}
        </Text>
      )}
    </div>
  )
}
