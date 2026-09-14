/**
 * Hero 3D — a deliberately small WebGL stage with Blender-style navigation
 * and playable review pins.
 *
 * Simplified monkey head, flat-shaded, minimal lights, NO postprocessing.
 * Performance discipline that keeps this from becoming the v7 lag again:
 *   - 30 fps frame cap (the eye cannot tell, the GPU certainly can)
 *   - rendering pauses when the hero scrolls offscreen or the tab hides
 *   - reduced-motion visitors keep the static splash image, WebGL never boots
 *   - any WebGL failure leaves the splash image in place, page still works
 *
 * Navigation mirrors the product's own viewer (src/App.tsx:2226):
 *   MMB orbit · Shift+MMB pan · RMB pan · wheel zoom · LMB reserved for pins
 *
 * Review pins are DOM elements projected from 3D anchors each frame, so the
 * annotation text always faces the viewer. Clicking a pin flies the camera to
 * that annotation's stored viewpoint and shows its note.
 *
 * Also exports createMiniViewer() — the same model in a tiny window, used by
 * the "读取分享" card so the receiver demo can reuse the hero's asset.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js'
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

interface PinData {
  position: [number, number, number]
  title: string
  body: string
  author: string
  status: 'open' | 'resolved'
}

/** Review pins with hand-written (slightly cheeky) annotations. 1–5 open, 6–7 resolved. */
const PIN_DATA: PinData[] = [
  {
    position: [0.58, 0.42, 0.52],
    title: '耳朵这圈布线，比我的周报还乱',
    body: '减两段再发，别让拓扑背锅。',
    author: '王工', status: 'open',
  },
  {
    position: [-0.52, 0.28, 0.6],
    title: '眼睛瞪这么大，看见 Deadline 了？',
    body: '换 3 号灰模，帮它先冷静一下。',
    author: '李监制', status: 'open',
  },
  {
    position: [0.12, -0.48, 0.72],
    title: '这个下巴弧度，天生的表情包圣体',
    body: '建议原样保留，谁都别动它。',
    author: '阿烟', status: 'open',
  },
  {
    position: [0.48, -0.12, 0.68],
    title: '地面反光差点晃瞎甲方',
    body: '粗糙度拉满，反射压一半。',
    author: '王工', status: 'open',
  },
  {
    position: [-0.58, -0.28, 0.48],
    title: '耳朵后面穿模了',
    body: '小键盘 . 过来看——就这，一模一眼。',
    author: '王工', status: 'open',
  },
  {
    position: [-0.34, 0.6, 0.42],
    title: '主光已按 01 号批注调整 ✓',
    body: '现在照的是颧骨，不是天灵盖。',
    author: '阿烟', status: 'resolved',
  },
  {
    position: [0.06, 0.66, 0.4],
    title: '已按 02 号批注换灰模 ✓',
    body: '这回的眼睛终于不像欠薪的。',
    author: '李监制', status: 'resolved',
  },
]

const ACCENT = 0xe87d0d
const BLUE_INK = 0x5b9ee0

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/**
 * Blender-style mouse mapping, mirroring the product's own viewer
 * (src/App.tsx:2226-2258): MMB orbit, Shift+MMB pan (via OrbitControls'
 * modifier-branch inversion), Ctrl/Cmd+MMB plain orbit, RMB pan, LMB free
 * for the annotation pins. Returns a cleanup function.
 */
function applyBlenderNavigation(controls: OrbitControlsImpl, domElement: HTMLElement): () => void {
  controls.enablePan = true
  controls.mouseButtons = { LEFT: undefined, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }

  const chooseMiddleAction = (event: PointerEvent): void => {
    if (event.button !== 1) return
    controls.mouseButtons.MIDDLE = !event.shiftKey && (event.ctrlKey || event.metaKey)
      ? THREE.MOUSE.PAN
      : THREE.MOUSE.ROTATE
  }
  const restoreMiddleAction = (): void => {
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE
  }
  domElement.addEventListener('pointerdown', chooseMiddleAction, true)
  window.addEventListener('pointerup', restoreMiddleAction)
  return () => {
    domElement.removeEventListener('pointerdown', chooseMiddleAction, true)
    window.removeEventListener('pointerup', restoreMiddleAction)
  }
}

/** Auto-rotate that yields to the user and comes back after a short idle. */
function attachIdleAutoRotate(controls: OrbitControlsImpl): () => void {
  let resumeTimer = 0
  const stop = (): void => {
    controls.autoRotate = false
    window.clearTimeout(resumeTimer)
  }
  const resume = (): void => {
    resumeTimer = window.setTimeout(() => {
      controls.autoRotate = true
    }, 4000)
  }
  controls.addEventListener('start', stop)
  controls.addEventListener('end', resume)
  return () => {
    window.clearTimeout(resumeTimer)
    controls.removeEventListener('start', stop)
    controls.removeEventListener('end', resume)
  }
}

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

  // DOM overlay: annotation pins + one note bubble, projected every frame.
  const labelsHost = document.createElement('div')
  labelsHost.className = 'h3d-labels'
  labelsHost.setAttribute('aria-hidden', 'true')
  host.appendChild(labelsHost)

  const bubble = document.createElement('div')
  bubble.className = 'h3d-bubble'
  bubble.hidden = true
  labelsHost.appendChild(bubble)

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

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 2.2
  controls.maxDistance = 7
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.7
  const disposeBlenderNav = applyBlenderNavigation(controls, renderer.domElement)
  const disposeAutoRotate = attachIdleAutoRotate(controls)

  // --- Annotation pins (DOM) ---
  const pins3d: THREE.Group[] = []
  const pinEls: HTMLButtonElement[] = []
  const pinAnchors = PIN_DATA.map((d) => {
    const v = new THREE.Vector3(...d.position)
    // Camera viewpoint for "click to inspect": from outside the anchor toward
    // the camera side, target pulled slightly toward the model centre.
    const viewPos = v.clone().normalize().multiplyScalar(2.9).add(new THREE.Vector3(0, 0.45, 0))
    return { anchor: v, viewPos, viewTarget: v.clone().multiplyScalar(0.35) }
  })

  let activePin = -1
  const openBubble = (index: number): void => {
    const d = PIN_DATA[index]
    bubble.innerHTML =
      `<div class="h3d-bubble__head"><i>#${index + 1}</i>` +
      `<b>${d.title}</b>` +
      `<em class="${d.status}">${d.status === 'resolved' ? '已解决' : '待处理'}</em></div>` +
      `<p>${d.body}</p>` +
      `<small>Monkey_Head · ${d.author}</small>`
    bubble.hidden = false
    activePin = index
  }
  const closeBubble = (): void => {
    bubble.hidden = true
    activePin = -1
  }

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
      if (!visible) closeBubble()
    },
    { threshold: 0.05 },
  )
  visibilityObserver.observe(host)

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

      // 3D pin markers (orange = open, blue = resolved)
      pins3d.push(
        ...PIN_DATA.map((d, index) => {
          const group = new THREE.Group()
          const color = d.status === 'resolved' ? BLUE_INK : ACCENT
          const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 20, 20),
            new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.3 }),
          )
          const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.006, 0.006, 0.09, 8),
            new THREE.MeshBasicMaterial({
              color: d.status === 'resolved' ? BLUE_INK : 0xf39a35,
              transparent: true,
              opacity: 0.85,
            }),
          )
          stem.position.y = -0.055
          group.add(head, stem)
          group.position.set(d.position[0], d.position[1] + 0.02, d.position[2])
          group.scale.setScalar(0.0001)
          scene.add(group)
          return group
        }),
      )

      // DOM pin buttons, projected onto the anchor every frame.
      PIN_DATA.forEach((d, index) => {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = `h3d-pin${d.status === 'resolved' ? ' is-resolved' : ''}`
        el.textContent = String(index + 1)
        el.hidden = true
        el.addEventListener('click', (event) => {
          event.stopPropagation()
          if (activePin === index) {
            closeBubble()
            return
          }
          openBubble(index)
          flyTo(index)
        })
        labelsHost.appendChild(el)
        pinEls.push(el)
      })

      // Clicking empty viewport closes the note.
      renderer.domElement.addEventListener('pointerdown', (event) => {
        if (event.button === 0) closeBubble()
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
        closeBubble()
      }

      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.hero3d__state'))
      buttons.forEach((button) => {
        button.addEventListener('click', () => {
          buttons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)))
          setState((button.dataset.state ?? 'solid') as HeroState)
        })
      })

      // --- Camera flight to a pin's stored viewpoint ---
      interface Flight {
        p0: THREE.Vector3
        p1: THREE.Vector3
        t0: THREE.Vector3
        t1: THREE.Vector3
        start: number
        dur: number
      }
      let flight: Flight | null = null

      const flyTo = (index: number): void => {
        const { viewPos, viewTarget } = pinAnchors[index]
        controls.autoRotate = false
        controls.enabled = false
        flight = {
          p0: camera.position.clone(),
          p1: viewPos.clone(),
          t0: controls.target.clone(),
          t1: viewTarget.clone(),
          start: performance.now(),
          dur: prefersReducedMotion() ? 0 : 900,
        }
      }

      const updateFlight = (now: number): void => {
        if (!flight) return
        const raw = flight.dur === 0 ? 1 : Math.min((now - flight.start) / flight.dur, 1)
        const k = easeInOutCubic(raw)
        camera.position.lerpVectors(flight.p0, flight.p1, k)
        controls.target.lerpVectors(flight.t0, flight.t1, k)
        if (raw >= 1) {
          flight = null
          controls.enabled = true
        }
      }

      // --- Per-frame state interpolation + overlay projection ---
      const projected = new THREE.Vector3()
      const raycaster = new THREE.Raycaster()
      const rayDir = new THREE.Vector3()

      const pinVisible = (index: number, since: number): boolean =>
        (state === 'review' && index < 5 && since > index * 0.09) ||
        (state === 'resolved' && since > index * 0.07)

      const originalTick = tick
      tick = (time: number): void => {
        originalTick(time)
        if (!running || !visible || document.hidden) return
        const now = clock.getElapsedTime()
        updateFlight(performance.now())

        const since = now - stateChangedAt
        const wireTarget = state === 'review' ? 0.5 : 0
        wireMat.opacity += (wireTarget - wireMat.opacity) * 0.12
        wire.visible = wireMat.opacity > 0.02

        const w = host.clientWidth
        const h = host.clientHeight

        pins3d.forEach((pin, index) => {
          const shown = pinVisible(index, since)
          const target = shown ? 1 : 0.0001
          pin.scale.setScalar(THREE.MathUtils.lerp(pin.scale.x, target, 0.16))

          const el = pinEls[index]
          if (!shown || pin.scale.x < 0.5) {
            el.hidden = true
            return
          }
          el.hidden = false

          // Project the anchor to screen space.
          projected.copy(pinAnchors[index].anchor).project(camera)
          el.style.left = `${((projected.x * 0.5 + 0.5) * w).toFixed(1)}px`
          el.style.top = `${((-projected.y * 0.5 + 0.5) * h).toFixed(1)}px`

          // Cheap occlusion: dim pins hidden behind the model.
          rayDir.copy(pinAnchors[index].anchor).sub(camera.position)
          const dist = rayDir.length()
          raycaster.set(camera.position, rayDir.normalize())
          const hit = raycaster.intersectObject(solid, false)[0]
          el.classList.toggle('is-behind', Boolean(hit && hit.distance < dist - 0.08))
        })

        // Keep the open bubble glued to its pin.
        if (activePin >= 0 && !bubble.hidden && pinEls[activePin] && !pinEls[activePin].hidden) {
          const el = pinEls[activePin]
          const x = Math.min(Math.max(parseFloat(el.style.left), 118), w - 118)
          const y = Math.max(parseFloat(el.style.top) - 54, 64)
          bubble.style.left = `${x.toFixed(1)}px`
          bubble.style.top = `${y.toFixed(1)}px`
        }
      }
    },
    undefined,
    () => {
      stop()
    },
  )

  function stop(): void {
    cancelAnimationFrame(raf)
    resizeObserver.disconnect()
    visibilityObserver.disconnect()
    disposeBlenderNav()
    disposeAutoRotate()
    controls.dispose()
    solidMat.dispose()
    wireMat.dispose()
    renderer.dispose()
  }

  window.addEventListener('pagehide', stop, { once: true })
}

/**
 * Mini viewer for the "读取分享" card — reuses the same GLB (browser cache)
 * and the same flat-shaded look with Blender-style navigation, but lazily
 * initialises only when the demo link is "opened", and only renders while
 * visible.
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
  controls.minDistance = 2.2
  controls.maxDistance = 7
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.8
  const disposeBlenderNav = applyBlenderNavigation(controls, renderer.domElement)
  const disposeAutoRotate = attachIdleAutoRotate(controls)

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
    disposeBlenderNav()
    disposeAutoRotate()
    controls.dispose()
    material.dispose()
    renderer.dispose()
  }

  window.addEventListener('pagehide', stop, { once: true })
  return { dispose: stop }
}
