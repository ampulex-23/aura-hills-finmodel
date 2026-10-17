import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

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
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0e1522)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.49 // не уходить под землю
    controls.minDistance = 15
    controls.maxDistance = 600

    // свет: небо + солнце с тенями
    scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x8a8070, 1.1))
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2)
    sun.castShadow = true
    sun.shadow.mapSize.set(4096, 4096)
    sun.shadow.bias = -0.0004
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

    const fit = (box: THREE.Box3) => {
      const c = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y)
      // изометрия с юго-запада, как векторный вид
      const dir = new THREE.Vector3(-0.7, -1, 0.75).normalize()
      camera.position.copy(c).addScaledVector(dir, maxDim * 1.35)
      camera.near = maxDim / 100
      camera.far = maxDim * 10
      camera.updateProjectionMatrix()
      controls.target.set(c.x, c.y, 0)
      // тень покрывает участок
      sun.position.copy(c).addScaledVector(new THREE.Vector3(-0.5, -0.6, 1), maxDim)
      sun.target.position.copy(c)
      const sc = sun.shadow.camera
      sc.left = sc.bottom = -maxDim
      sc.right = sc.top = maxDim
      sc.near = 1
      sc.far = maxDim * 4
      sc.updateProjectionMatrix()
    }

    new GLTFLoader().load(
      url,
      (gltf) => {
        if (dead) return
        const root = gltf.scene
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
        fit(new THREE.Box3().setFromObject(root))
      },
      undefined,
      () => setError(true),
    )

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
      renderer.domElement.remove()
    }
  }, [url]) // names/planned/onSelect — стабильные в рамках страницы

  if (error) return <>{fallback}</>

  return (
    <div className="genplan-3d" ref={host}>
      <div ref={tip} className="genplan-3d-tip" style={{ display: 'none' }} />
      <div className="genplan-3d-hint">drag — вращение · колесо — зум · клик по зданию с ⌗ — план</div>
    </div>
  )
}
