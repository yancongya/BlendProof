/**
 * Hero 3D — a deliberately small WebGL stage, now with review states.
 *
 * Simplified monkey head, flat-shaded, minimal lights, NO postprocessing.
 * Performance discipline that keeps this from becoming the v7 lag again:
 *   - 30 fps frame cap (the eye cannot tell, the GPU certainly can)
 *   - rendering pauses when the hero scrolls offscreen or the tab hides
 *   - reduced-motion visitors keep the static splash image, WebGL never boots
 *   - any WebGL failure leaves the splash image in place, page still works
 *
 * Three demo states (switched from the viewport chrome):
 *   solid    — the model as uploaded
 *   review   — wireframe + open review pins (批注中)
 *   resolved — solid again + all pins seated, two of them resolved (已批示)
 *
 * Also exports createMiniViewer() — the same model in a tiny window, used by
 * the "读取分享" card so the receiver demo can reuse the hero's asset.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import modelUrl from '../../public/default-monkey.glb?url'

const FRAME_MS = 1000 / 30

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

type HeroState = 'solid' | 'review' | 'resolved'

/** Hand-placed pin anchors on the normalised Suzanne surface. Last two resolved. */
const PIN_POSITIONS: Array<[number, number, number]> = [
  [0.58, 0.42, 0.52],
  [-0.52, 0.28, 0.6],
  [0.12, -0.48, 0.72],
  [-0.34, 0.6, 0.42],
  [0.48, -0.12, 0.68],
  [-0.58, -0.28, 0.48],
  [0.06, 0.66, 0.4],
]

const ACCENT = 0xe87d0d
const BLUE_INK = 0x5b9ee0

export function initHero3D(): void {
  const host = document.getElementById('hero3d')
  if (!host || host.dataset.mounted === 'true') return

  const fallback = host.querySelector<HTMLElement>('.hero3d__fallback')

  // Reduced motion or no WebGL: the static splash remains, nothing boots.
  if (prefersReducedMotion() || !webglAvailable()) return
  host.dataset.mounted = 'true'

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  } catch {
    return
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.domElement.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity .6s ease'
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50)
  camera.position.set(2.6, 1.3, 3.3)

  scene.add(new THREE.HemisphereLight(0x3a3f46, 0x141414, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.position.set(3, 4, 2.5)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x5b9ee0, 0.7)
  rim.position.set(-4, 1, -3)
  scene.add(rim)

  const grid = new THREE.GridHelper(8, 16, 0x333333, 0x222222)
  grid.position.y = -1.08
  scene.add(grid)

  const solidMat = new THREE.MeshStandardMaterial({
    color: 0xd6d6d6,
    metalness: 0.45,
    roughness: 0.38,
    flatShading: true,
    transparent: true,
  })
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xf39a35,
    wireframe: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })

  const loader = new GLTFLoader()
  loader.load(
    modelUrl,
    (gltf) => {
      const root = gltf.scene
      const box = new THREE.Box3().setFromObject(root)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      root.position.sub(center)
      root.scale.setScalar(2.0 / Math.max(size.x, size.y, size.z))
      root.updateMatrixWorld(true)

      let geometry: THREE.BufferGeometry | null = null
      root.traverse((child) => {
        if (child instanceof THREE.Mesh && geometry === null) {
          geometry = child.geometry.clone().applyMatrix4(child.matrixWorld)
        }
      })
      if (!geometry) return

      const solid = new THREE.Mesh(geometry, solidMat)
      const wire = new THREE.Mesh(geometry, wireMat)
      scene.add(solid, wire)

      // Review pins (orange = open, blue = resolved)
      const pins = PIN_POSITIONS.map((position, index) => {
        const group = new THREE.Group()
        const color = index >= 5 ? BLUE_INK : ACCENT
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 20, 20),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.3 }),
        )
        const stem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.006, 0.006, 0.09, 8),
          new THREE.MeshBasicMaterial({ color: index >= 5 ? BLUE_INK : 0xf39a35, transparent: true, opacity: 0.85 }),
        )
        stem.position.y = -0.055
        group.add(head, stem)
        group.position.set(position[0], position[1] + 0.02, position[2])
        group.scale.setScalar(0.0001)
        scene.add(group)
        return group
      })

      renderer.domElement.style.opacity = '1'
      fallback?.classList.add('is-hidden')
      running = true

      // --- State switching (chrome buttons) ---
      let state: HeroState = 'solid'
      let stateChangedAt = 0
      const clock = new THREE.Clock()

      const setState = (next: HeroState): void => {
        if (state === next) return
        state = next
        stateChangedAt = clock.getElapsedTime()
      }

      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.hero3d__state'))
      buttons.forEach((button) => {
        button.addEventListener('click', () => {
          buttons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)))
          setState((button.dataset.state ?? 'solid') as HeroState)
        })
      })

      // Per-frame state interpolation
      const updateState = (now: number): void => {
        const since = now - stateChangedAt
        const wireTarget = state === 'review' ? 0.5 : 0
        wireMat.opacity += (wireTarget - wireMat.opacity) * 0.12
        wire.visible = wireMat.opacity > 0.02

        pins.forEach((pin, index) => {
          const shown =
            (state === 'review' && index < 5 && since > index * 0.09) ||
            (state === 'resolved' && since > index * 0.07)
          const target = shown ? 1 : 0.0001
          const current = pin.scale.x
          pin.scale.setScalar(THREE.MathUtils.lerp(current, target, 0.16))
        })
      }

      const originalTick = tick
      tick = (time: number): void => {
        originalTick(time)
        if (running && visible && !document.hidden) updateState(clock.getElapsedTime())
      }
    },
    undefined,
    () => {
      stop()
    },
  )

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.minDistance = 2.2
  controls.maxDistance = 7
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.7

  // --- Size handling ---
  const resize = (): void => {
    const { clientWidth: w, clientHeight: h } = host
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host)
  resize()

  // --- Render loop: 30 fps cap, paused offscreen / hidden / until model ready ---
  let running = false
  let visible = true
  let raf = 0
  let lastFrame = 0

  let tick = (time: number): void => {
    raf = requestAnimationFrame(tick)
    if (!running || !visible || document.hidden) return
    if (time - lastFrame < FRAME_MS) return
    lastFrame = time
    controls.update()
    renderer.render(scene, camera)
  }
  raf = requestAnimationFrame(tick)

  const visibilityObserver = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting
    },
    { threshold: 0.05 },
  )
  visibilityObserver.observe(host)

  function stop(): void {
    cancelAnimationFrame(raf)
    resizeObserver.disconnect()
    visibilityObserver.disconnect()
    controls.dispose()
    solidMat.dispose()
    wireMat.dispose()
    renderer.dispose()
  }

  window.addEventListener('pagehide', stop, { once: true })
}

/**
 * Mini viewer for the "读取分享" card — reuses the same GLB (browser cache)
 * and the same flat-shaded look, but lazily initialises only when the demo
 * link is "opened", and only renders while visible.
 */
export function createMiniViewer(host: HTMLElement): { dispose: () => void } | null {
  if (!webglAvailable() || prefersReducedMotion()) return null

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50)
  camera.position.set(2.4, 1.2, 3.1)

  scene.add(new THREE.HemisphereLight(0x3a3f46, 0x141414, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.position.set(3, 4, 2.5)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x5b9ee0, 0.6)
  rim.position.set(-4, 1, -3)
  scene.add(rim)

  const material = new THREE.MeshStandardMaterial({
    color: 0xd6d6d6,
    metalness: 0.45,
    roughness: 0.38,
    flatShading: true,
  })

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.minDistance = 2.2
  controls.maxDistance = 7
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.8

  let running = false
  let raf = 0

  new GLTFLoader().load(
    modelUrl,
    (gltf) => {
      const root = gltf.scene
      const box = new THREE.Box3().setFromObject(root)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      root.position.sub(center)
      root.scale.setScalar(2.0 / Math.max(size.x, size.y, size.z))
      root.traverse((child) => {
        if (child instanceof THREE.Mesh) child.material = material
      })
      scene.add(root)
      running = true
    },
    undefined,
    () => stop(),
  )

  const resize = (): void => {
    const { clientWidth: w, clientHeight: h } = host
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host)
  resize()

  let visible = true
  const visibilityObserver = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting
    },
    { threshold: 0.05 },
  )
  visibilityObserver.observe(host)

  let lastFrame = 0
  const tick = (time: number): void => {
    raf = requestAnimationFrame(tick)
    if (!running || !visible || document.hidden) return
    if (time - lastFrame < FRAME_MS) return
    lastFrame = time
    controls.update()
    renderer.render(scene, camera)
  }
  raf = requestAnimationFrame(tick)

  function stop(): void {
    cancelAnimationFrame(raf)
    resizeObserver.disconnect()
    visibilityObserver.disconnect()
    controls.dispose()
    material.dispose()
    renderer.dispose()
  }

  window.addEventListener('pagehide', stop, { once: true })
  return { dispose: stop }
}
