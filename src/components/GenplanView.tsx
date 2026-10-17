import { useEffect, useState } from 'react'
import { Anchor, Button, Text } from '@mantine/core'
import { fmt } from './ui'

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

// Детальный вид здания: план 1 этажа + фасады + экспликация помещений.
function BuildingDetail({ m, onBack }: { m: SpecModule; onBack: () => void }) {
  const rooms = m.spaces ?? []
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
      <div className="genplan-canvas">
        <img src={`${BASE}/buildings/${m.slug}/plan.svg`}
             alt={`План — ${m.name}`} />
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

  const buildings = spec?.modules.filter((m) => !LANDSCAPE.test(m.type)) ?? []
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

          <h2>Изометрия</h2>
          <div className="genplan-canvas">
            <img src={`${BASE}/iso.svg`} alt="Изометрия модели" />
          </div>

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
