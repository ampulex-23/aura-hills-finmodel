import { useEffect, useState } from 'react'
import { Anchor, Text } from '@mantine/core'
import { fmt } from './ui'

// Data Room «Генплан»: артефакты репозитория bim-as-code, собранные на сервере
// (post-receive → compiler build → /srv/genplan/ → nginx alias /genplan/).
// Контракт — manifest.json {commit, built_at, artifacts} + spec.json + превью.
// Если артефактов нет — раздел показывает заглушку, не падает.

const BASE = 'genplan'

interface Manifest {
  commit: string
  built_at: string
  artifacts: string[]
}
interface SpecModule {
  name: string
  type: string
  queue: number
  footprint_m2: number
  storeys: number
  slots: number
  spaces_area_m2?: number
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

export function GenplanView() {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [spec, setSpec] = useState<Spec | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let live = true
    Promise.all([
      fetch(`${BASE}/manifest.json`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${BASE}/spec.json`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([m, s]) => {
      if (!live) return
      if (!m && !s) setMissing(true)
      setManifest(m)
      setSpec(s)
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

  return (
    <div className="doc-body genplan">
      <h1>Генплан участка</h1>
      <Text size="sm" c="dimmed" mb="md">
        Цифровая модель AURA HILLS — репозиторий <code>bim-as-code</code>, YAML-исходники →
        IFC4. Это «живые» артефакты: пересобираются из исходников при каждом push.
      </Text>

      <h2>План</h2>
      <div className="genplan-canvas">
        <img src={`${BASE}/plan.svg`} alt="Генплан участка" />
      </div>

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
                </tr>
              </thead>
              <tbody>
                {buildings.map((m) => (
                  <tr key={m.name}>
                    <td className="sticky">{m.name}</td>
                    <td><code>{m.type}</code></td>
                    <td>{fmt(m.footprint_m2, 0)}</td>
                    <td>{m.storeys}</td>
                    <td>{m.queue}</td>
                  </tr>
                ))}
                <tr className="bold">
                  <td className="sticky">Здания: {buildings.length}</td>
                  <td />
                  <td>{fmt(buildings.reduce((a, m) => a + m.footprint_m2, 0), 0)}</td>
                  <td colSpan={2} />
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
