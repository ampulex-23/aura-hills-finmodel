import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

// Интерактивный 3D-вид генплана: site.glb из /genplan/ (тот же артефакт,
// что качается из «Файлов модели»). Узлы сцены названы `site/<slug>/<kind>`
// (emit_gltf) — по ним клик/ховер маппится на модули спецификации.

interface Props {
  url: string
  // slug → имя модуля, для подсказки при наведении
  names: Map<string, string>
  // slugs зданий с планировкой — по ним клик открывает чертежи
  planned: Set<string>
  onSelect: (slug: string) => void
  // что показать, если GLB не загрузился / нет WebGL
  fallback: React.ReactNode
}

const slugOf = (obj: THREE.Object3D | null): string | null => {
  for (let o = obj; o; o = o.parent) {
    const n = o.name
    if (n.startsWith('site/')) return n.split('/')[1] ?? null
  }
  return null
}

export function Genplan3D({ url, names, planned, onSelect, fallback }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const resetRef = useRef<() => void>(() => {})
  const [error, setError] = useState(false)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let dead = false

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0e1522)

    // мягкое окружение для PBR — убирает «пластилиновые» чёрные тени
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.4

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.49 // не уходить под землю
    controls.minDistance = 15
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
        const root = gltf.scene
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
      },
      undefined,
      () => setError(true),
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
      // поднимаемся до узла site/<slug>
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent)
        if (o.name.startsWith('site/')) return o
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
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerdown', onClick)
    renderer.domElement.addEventListener('pointerleave', onLeave)

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
      controls.update()
      renderer.render(scene, camera)
    })

    return () => {
      dead = true
      ro.disconnect()
      renderer.setAnimationLoop(null)
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerdown', onClick)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          m.geometry.dispose()
          for (const x of Array.isArray(m.material) ? m.material : [m.material])
            x?.dispose()
        }
      })
      renderer.dispose()
      pmrem.dispose()
      renderer.domElement.remove()
    }
  }, [url]) // names/planned/onSelect — стабильные в рамках страницы

  if (error) return <>{fallback}</>

  return (
    <div className="genplan-3d" ref={host}>
      <div ref={tip} className="genplan-3d-tip" style={{ display: 'none' }} />
      <button className="genplan-3d-reset" type="button"
              onClick={() => resetRef.current()}>⟲ обзор</button>
      <div className="genplan-3d-hint">drag — вращение · колесо — зум · клик по зданию с ⌗ — план</div>
    </div>
  )
}
