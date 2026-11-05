import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

// Интерактивный 3D-вид генплана: site.glb из /genplan/ (тот же артефакт,
// что качается из «Файлов модели»). Узлы glTF названы `site/<slug>/<kind>`
// (emit_gltf) — по ним клик/ховер маппится на модули спецификации.
// ВАЖНО: GLTFLoader санитизирует Object3D.name (PropertyBinding.
// sanitizeNodeName вырезает [].:/ и пробелы) — 'site/a/wall' становится
// 'siteawall'. Поэтому слуг модуля берём из ИСХОДНОГО имени узла через
// parser.associations → json.nodes[i].name и кладём в userData.slug.

interface Props {
  url: string
  // slug → имя модуля, для подсказки при наведении
  names: Map<string, string>
  // slugs зданий с планировкой — по ним клик открывает чертежи
  planned: Set<string>
  onSelect: (slug: string) => void
  // режим «одно здание» (страница модуля): оставить только узлы
  // site/<slug>/… и подогнать камеру под него; клик/подсказки off
  slug?: string
  // что показать, если GLB не загрузился / нет WebGL
  fallback: React.ReactNode
}

const slugOf = (obj: THREE.Object3D | null): string | null => {
  for (let o = obj; o; o = o.parent) {
    const s = o.userData.slug as string | undefined
    if (s) return s
  }
  return null
}

// семейство узлов «крыши» для режима без кровли: сама мембрана,
// борта, ФЭП и аэраторы (печная труба detail-chimney остаётся —
// она часть печи внутри парной)
const ROOF_KINDS = new Set([
  'roof', 'rooftop', 'parapet', 'parapet_in', 'solar_panel', 'aerator'])
const kindOf = (raw: string | undefined): string | undefined =>
  raw?.split('/')[2]?.replace(/_\d+$/, '')

export function Genplan3D({ url, names, planned, onSelect, slug,
                           fallback }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const resetRef = useRef<() => void>(() => {})
  const modelRef = useRef<THREE.Object3D | null>(null)
  const roofOffRef = useRef(false)          // в эффекте — актуальное
  const [failed, setFailed] = useState(false)
  const [roofOff, setRoofOff] = useState(false)
  const setRoof = (v: boolean) => { roofOffRef.current = v; setRoofOff(v) }

  useEffect(() => {
    const el = host.current
    if (!el) return
    let dead = false   // эффект отменён (unmount/смена deps/ошибка)
    let torn = false   // teardown уже выполнен (идемпотентность)
    setFailed(false)

    // Полная остановка: rAF-цикл, слушатели, сцена, контекст.
    // ВАЖНО: вызывается и при unmount, и при любой ошибке — иначе
    // animation loop продолжает крутиться на отсоединённом canvas
    // вечно (зомби-рендер), держит GL-контекст и всю сцену в памяти.
    function teardown() {
      if (torn) return
      torn = true
      ro.disconnect()
      renderer.setAnimationLoop(null)
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerdown', onClick)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      controls.dispose()
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          m.geometry.dispose()
          for (const x of Array.isArray(m.material) ? m.material : [m.material])
            x?.dispose()
        }
      })
      renderer.dispose()
      // отдаём GL-контекст сразу — иначе при переходах генплан↔здание
      // контексты копятся до лимита браузера и создание новых падает
      renderer.forceContextLoss()
      pmrem?.dispose()
      renderer.domElement.remove()
    }

    // Ошибка = teardown + fallback-оверлей (host-div остаётся смонтирован,
    // так что canvas и цикл не превращаются в зомби)
    const fail = (why: string, e?: unknown) => {
      if (dead) return
      dead = true
      teardown()
      console.error('[Genplan3D]', why, e)
      setFailed(true)
    }

    // WebGL может быть недоступен (лимит контекстов, отключённый GPU) —
    // падаем в fallback, а не в error boundary всей страницы
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch (e) {
      console.error('[Genplan3D] webgl-context', e)
      setFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0e1522)

    // мягкое окружение для PBR — убирает «пластилиновые» чёрные тени;
    // fromScene — GPU-операция, может бросить на умирающем контексте —
    // тогда teardown минимальный (остальное ещё не создано, ro/controls
    // в TDZ — полный teardown() вызывать нельзя)
    let pmrem: THREE.PMREMGenerator | undefined
    try {
      pmrem = new THREE.PMREMGenerator(renderer)
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      scene.environmentIntensity = 0.4
    } catch (e) {
      dead = true
      console.error('[Genplan3D] env-map', e)
      pmrem?.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      setFailed(true)
      return
    }

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.49 // не уходить под землю
    controls.minDistance = slug ? 3 : 15   // одно здание — ближе к деталям
    controls.maxDistance = 600

    // свет: небо + солнце с тенями
    scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x8a8070, 0.9))
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.9)
    sun.castShadow = true
    sun.shadow.mapSize.set(4096, 4096)
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.5
    scene.add(sun)
    scene.add(sun.target)

    const ray = new THREE.Raycaster()
    const ptr = new THREE.Vector2()
    let hovered: THREE.Object3D | null = null

    const setEmissive = (root: THREE.Object3D, on: boolean) => {
      root.traverse((o) => {
        const m = o as THREE.Mesh
        const mat = m.material as THREE.MeshStandardMaterial | undefined
        if (m.isMesh && mat?.emissive) mat.emissive.setHex(on ? 0x223344 : 0x0)
      })
    }

    // стартовый вид — для кнопки «обзор»
    const home = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() }

    const fit = (box: THREE.Box3) => {
      const c = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.z)
      // радиус по плану + высота — плоский участок не раздувает обзор
      const radius = Math.hypot(size.x, size.z) / 2 + size.y / 2
      const fovH = THREE.MathUtils.degToRad(camera.fov) / 2
      const dist = Math.max(radius / Math.sin(fovH),
                            radius / Math.sin(fovH) / camera.aspect) * 1.08
      // aerial 3/4 с юго-запада (мир Y-up: юг = +Z, запад = -X)
      const dir = new THREE.Vector3(-0.55, 0.68, 0.8).normalize()
      camera.position.copy(c).addScaledVector(dir, dist)
      camera.near = Math.max(dist / 200, 0.1)
      camera.far = dist * 8
      camera.updateProjectionMatrix()
      controls.target.set(c.x, box.min.y + size.y * 0.15, c.z)
      controls.maxDistance = dist * 3
      home.pos.copy(camera.position)
      home.tgt.copy(controls.target)
      // глубина: лёгкий туман в цвет фона
      scene.fog = new THREE.Fog(0x0e1522, dist * 1.6, dist * 4.5)
      // тень покрывает участок
      sun.position.copy(c).addScaledVector(new THREE.Vector3(-0.5, 1, -0.55), maxDim)
      sun.target.position.copy(c)
      const sc = sun.shadow.camera
      sc.left = sc.bottom = -maxDim
      sc.right = sc.top = maxDim
      sc.near = 1
      sc.far = maxDim * 4
      sc.updateProjectionMatrix()
      // «земля» под участком — ловит тени и убирает ощущение парящего острова
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 2.2, 72),
        new THREE.MeshStandardMaterial({ color: 0x141c2c, roughness: 1 }))
      ground.rotation.x = -Math.PI / 2
      ground.position.set(c.x, box.min.y - 0.4, c.z)
      ground.receiveShadow = true
      scene.add(ground)
    }

    new GLTFLoader().load(
      url,
      (gltf) => {
        if (dead) return
        try {
          const root = gltf.scene
          // Аннотируем узлы slug'ом модуля по ИСХОДНЫМ именам glTF:
          // associations: Object3D → {nodes: idx} → json.nodes[idx].name.
          // Дети узла без собственной ассоциации (мультипримитивные меши)
          // наследуют slug родителя — traverse идёт сверху вниз.
          const assoc = gltf.parser.associations as
            Map<THREE.Object3D, { nodes?: number }> | undefined
          const gNodes = (gltf.parser.json.nodes ?? []) as { name?: string }[]
          root.traverse((o) => {
            const idx = assoc?.get(o)?.nodes
            const raw = idx != null ? gNodes[idx]?.name : undefined
            const parts = typeof raw === 'string' ? raw.split('/') : []
            o.userData.slug =
              parts[0] === 'site' && parts[1] ? parts[1]
              : (o.parent?.userData.slug as string | undefined)
            // «крыша» — для переключателя без кровли (страница здания);
            // дети мультипримитивных мешей наследуют метку родителя
            const kind = kindOf(raw)
            o.userData.roofish = kind !== undefined
              ? ROOF_KINDS.has(kind)
              : (o.parent?.userData.roofish as boolean | undefined) ?? false
          })
          modelRef.current = root
          if (roofOffRef.current)
            root.traverse((o) => { if (o.userData.roofish) o.visible = false })
          // режим «одно здание»: удаляем узлы других модулей
          if (slug) {
            let found = false
            const junk: THREE.Object3D[] = []
            root.traverse((o) => {
              const s = o.userData.slug as string | undefined
              if (s === undefined) return
              if (s === slug) found = true
              else junk.push(o)
            })
            if (!found) { fail('no-nodes', slug); return }
            for (const o of junk) o.parent?.remove(o)
          }
          // GLB из компилятора — Z-up (участок в XY, высоты по Z);
          // three.js мир Y-up → кладём участок горизонтально
          root.rotation.x = -Math.PI / 2
          root.traverse((o) => {
            const m = o as THREE.Mesh
            if (!m.isMesh) return
            m.castShadow = m.receiveShadow = true
            // материалы могут шариться между узлами — клонируем,
            // чтобы подсветка ховера не красила чужие модули
            if (Array.isArray(m.material))
              m.material = m.material.map((x) => x.clone())
            else if (m.material) m.material = m.material.clone()
          })
          scene.add(root)
          root.updateMatrixWorld(true)
          fit(new THREE.Box3().setFromObject(root))
        } catch (e) { fail('scene-build', e) }
      },
      undefined,
      (e) => fail('glb-load', e),
    )

    resetRef.current = () => {
      if (!home.pos.lengthSq()) return   // модель ещё не загрузилась
      camera.position.copy(home.pos)
      controls.target.copy(home.tgt)
      controls.update()
    }

    const pick = (e: PointerEvent): THREE.Object3D | null => {
      const r = renderer.domElement.getBoundingClientRect()
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1,
              -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ptr, camera)
      const hit = ray.intersectObjects(scene.children, true)[0]
      if (!hit) return null
      // поднимаемся до узла модуля (userData.slug проставлен при загрузке)
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent)
        if (o.userData.slug) return o
      return null
    }

    const onMove = (e: PointerEvent) => {
      const root = pick(e)
      const slug = slugOf(root)
      if (root !== hovered) {
        if (hovered) setEmissive(hovered, false)
        hovered = root
        if (hovered) setEmissive(hovered, true)
      }
      renderer.domElement.style.cursor =
        slug && planned.has(slug) ? 'pointer' : 'grab'
      if (tip.current) {
        if (slug && names.has(slug)) {
          tip.current.style.display = 'block'
          tip.current.style.left = `${e.clientX + 12}px`
          tip.current.style.top = `${e.clientY + 12}px`
          tip.current.textContent =
            names.get(slug)! + (planned.has(slug) ? ' — ⌗ план' : '')
        } else {
          tip.current.style.display = 'none'
        }
      }
    }
    const onClick = (e: PointerEvent) => {
      const slug = slugOf(pick(e))
      if (slug && planned.has(slug)) onSelect(slug)
    }
    const onLeave = () => {
      if (hovered) setEmissive(hovered, false)
      hovered = null
      if (tip.current) tip.current.style.display = 'none'
    }
    // в режиме одного здания клик/ховер-подсветка не нужны —
    // на странице уже и так выбранный модуль
    if (!slug) {
      renderer.domElement.addEventListener('pointermove', onMove)
      renderer.domElement.addEventListener('pointerdown', onClick)
      renderer.domElement.addEventListener('pointerleave', onLeave)
    }

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    renderer.setAnimationLoop(() => {
      if (dead) return
      controls.update()
      renderer.render(scene, camera)
    })

    return () => {
      dead = true
      teardown()
    }
  }, [url, slug]) // names/planned/onSelect — стабильные в рамках страницы

  // переключатель «без кровли»: видимость узлов семейства roof
  // (мембрана, борта, ФЭП, аэраторы) — геометрия не трогается
  useEffect(() => {
    modelRef.current?.traverse((o) => {
      if (o.userData.roofish) o.visible = !roofOff
    })
  }, [roofOff])

  // host-div монтирован всегда — иначе при ошибке canvas уходил бы в
  // отсоединённый DOM, а animation loop продолжал работать на зомби
  return (
    <div className="genplan-3d" ref={host}>
      {failed ? fallback : (
        <>
          <div ref={tip} className="genplan-3d-tip" style={{ display: 'none' }} />
          {slug && (
            <button className="genplan-3d-roof" type="button"
                    onClick={() => setRoof(!roofOff)}>
              {roofOff ? 'С кровлей' : 'Без кровли'}</button>
          )}
          <button className="genplan-3d-reset" type="button"
                  onClick={() => resetRef.current()}>⟲ обзор</button>
          <div className="genplan-3d-hint">drag — вращение · колесо — зум
            {slug ? '' : ' · клик по зданию с ⌗ — план'}</div>
        </>
      )}
    </div>
  )
}
