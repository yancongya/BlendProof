/**
 * Landing page entry.
 *
 * The page is progressive enhancement: every word of copy, the hero 3D
 * viewport and the product mockup panels exist in the static HTML, so crawlers
 * and no-JS visitors get the complete document. This module only wires up
 * behaviour and reads the live platform figures — it bails out quietly
 * whenever something is missing.
 */

import { initHero3D, createMiniViewer } from './hero3d'
import { t, ifEn, applyStaticI18n, getLang, setNodeText } from './i18n'

const ORIGIN = 'https://blendproof.itycon.cn'

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ------------------------------------------------------------------ *
 * Theme (dark default, light optional, persisted)
 * ------------------------------------------------------------------ */

/** Perspective toggle: switch between creator and reviewer views. */
function initPerspectiveToggle(): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.perspective-btn'))
  if (buttons.length === 0) return

  const root = document.documentElement

  // Default to creator perspective
  root.dataset.view = 'creator'

  const apply = (view: 'creator' | 'reviewer'): void => {
    root.dataset.view = view
    buttons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.view === view))
    })

    // Re-trigger card animations for newly visible cards
    document.querySelectorAll<HTMLElement>('[data-anim]').forEach((card) => {
      const perspective = card.dataset.perspective
      if (!perspective || perspective === view) {
        card.classList.remove('pre')
        card.classList.add('in')
      }
    })
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view as 'creator' | 'reviewer'
      apply(view)
      try {
        localStorage.setItem('bp-perspective', view)
      } catch {
        /* private mode */
      }
    })
  })

  // Restore persisted perspective
  let stored: string | null = null
  try {
    stored = localStorage.getItem('bp-perspective')
  } catch {
    /* ignore */
  }
  if (stored === 'creator' || stored === 'reviewer') {
    apply(stored)
  }
}

function initTheme(): void {
  const button = document.getElementById('theme-toggle')
  if (!button) return
  const root = document.documentElement

  const apply = (theme: 'dark' | 'light'): void => {
    root.dataset.theme = theme
    button.setAttribute('aria-pressed', String(theme === 'light'))
    button.textContent = theme === 'light' ? t('☾ 暗色') : t('☀ 亮色')
    try {
      localStorage.setItem('bp-theme', theme)
    } catch {
      /* private mode: theme just won't persist */
    }
  }

  let stored: string | null = null
  try {
    stored = localStorage.getItem('bp-theme')
  } catch {
    /* ignore */
  }
  apply(stored === 'light' ? 'light' : 'dark')

  button.addEventListener('click', () => {
    apply(root.dataset.theme === 'light' ? 'dark' : 'light')
  })
}

/** Language toggle: persist the choice and re-localize in place — no reload. */
function initLangToggle(): void {
  const button = document.getElementById('lang-toggle')
  if (!button) return
  button.addEventListener('click', () => {
    const next = getLang() === 'en' ? 'zh' : 'en'
    try {
      localStorage.setItem('bp-lang', next)
    } catch {
      /* private mode: language just won't persist */
    }
    applyStaticI18n()
  })
}

/* ------------------------------------------------------------------ *
 * Mockup panels — each one is a small playable demo of a real feature
 * ------------------------------------------------------------------ */

function initMockups(): void {
  initOutlinerDemo()
  initReviewDemo()
  initUploadDemo()
  initCredDemo()
  initCopyDemo()
  initPainFlip()
  initLegalModals()
  initReceiverBrowser()
}

/** Outliner: working search, working eye toggles, live meta line, collapsible root. */
function initOutlinerDemo(): void {
  const root = document.getElementById('mk-outliner')
  if (!root) return

  const rows = Array.from(root.querySelectorAll<HTMLElement>('.mk-tree-row'))
  const metaName = document.getElementById('mk-meta-name')
  const metaInfo = document.getElementById('mk-meta-info')

  const select = (row: HTMLElement): void => {
    rows.forEach((other) => {
      other.classList.remove('selected')
      other.setAttribute('aria-selected', 'false')
    })
    row.classList.add('selected')
    row.setAttribute('aria-selected', 'true')
    if (metaName && metaInfo) {
      metaName.textContent = row.dataset.name ?? '—'
      metaInfo.textContent = row.dataset.meta ?? ''
    }
  }

  rows.forEach((row) => {
    row.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.mk-eye')) return
      select(row)
    })
  })

  root.querySelectorAll<HTMLButtonElement>('.mk-eye').forEach((eye) => {
    eye.addEventListener('click', (event) => {
      event.stopPropagation()
      const row = eye.closest<HTMLElement>('.mk-tree-row')
      if (!row) return
      const hidden = row.classList.toggle('is-hidden')
      eye.classList.toggle('off', hidden)
      eye.textContent = hidden ? '◌' : '◉'
    })
  })

  const search = root.querySelector<HTMLInputElement>('.mk-search-input')
  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase()
    rows.forEach((row) => {
      const hit = !q || (row.dataset.name ?? '').toLowerCase().includes(q)
      row.style.display = hit ? '' : 'none'
    })
  })

  document.getElementById('mk-tree-root')?.addEventListener('click', () => {
    root.classList.toggle('collapsed')
  })
}

/** Review list: status toggle updates the chrome counter; composer adds real items. */
function initReviewDemo(): void {
  const root = document.getElementById('mk-review')
  if (!root) return
  const counter = document.getElementById('mk-review-count')
  const items = () => Array.from(root.querySelectorAll<HTMLElement>('.mk-review-item'))

  const updateCounter = (): void => {
    if (!counter) return
    let open = 0
    let resolved = 0
    items().forEach((item) => (item.querySelector('i')?.classList.contains('resolved') ? resolved++ : open++))
    counter.textContent = `${open} open · ${resolved} resolved`
  }

  items().forEach((item) => {
    item.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.mk-review-status')) return
      items().forEach((other) => other.classList.remove('selected'))
      item.classList.add('selected')
    })
    const status = item.querySelector<HTMLButtonElement>('.mk-review-status')
    const badge = item.querySelector('i')
    status?.addEventListener('click', () => {
      const resolved = badge?.classList.toggle('resolved') ?? false
      setNodeText(status, resolved ? '重开' : '解决')
      updateCounter()
    })
  })

  const input = document.getElementById('mk-compose-input') as HTMLInputElement | null
  const add = document.getElementById('mk-compose-add')
  const submit = (): void => {
    const text = input?.value.trim()
    if (!text || !input) return
    const number = items().length + 1
    const item = document.createElement('div')
    item.className = 'mk-review-item is-new'
    item.innerHTML =
      `<i>${number}</i><div><strong></strong><small>Monkey_Head · 我</small></div>` +
      '<button type="button" class="mk-review-status">解决</button>'
    ;(item.querySelector('strong') as HTMLElement).textContent = text
    const composeSmall = item.querySelector('small') as HTMLElement | null
    if (composeSmall) setNodeText(composeSmall, 'Monkey_Head · 我')
    const composeStatus = item.querySelector<HTMLButtonElement>('.mk-review-status')
    if (composeStatus) setNodeText(composeStatus, '解决')
    root.insertBefore(item, root.querySelector('.mk-compose'))
    input.value = ''
    bindReviewItem(item)
    updateCounter()
  }
  add?.addEventListener('click', submit)
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit()
  })
}

/** Credential card: permission / expiry / password chips rewrite the summary line. */
function initCredDemo(): void {
  document.querySelectorAll<HTMLButtonElement>('.mk-chip[data-k]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const group = chip.dataset.k
      document
        .querySelectorAll<HTMLButtonElement>(`.mk-chip[data-k="${group}"]`)
        .forEach((other) => other.setAttribute('aria-pressed', String(other === chip)))

      if (group === 'perm') {
        const zh = chip.dataset.v === 'comment' ? '可评论' : '只读'
        const ddPerm = document.getElementById('mk-dd-perm')
        if (ddPerm) setNodeText(ddPerm, zh)
        const ddPermHero = document.getElementById('mk-dd-perm-hero')
        if (ddPermHero) setNodeText(ddPermHero, zh)
      } else if (group === 'exp') {
        const zh = `${chip.dataset.v ?? '24'} 小时后`
        const ddExp = document.getElementById('mk-dd-exp')
        if (ddExp) setNodeText(ddExp, zh)
        const ddExpHero = document.getElementById('mk-dd-exp-hero')
        if (ddExpHero) setNodeText(ddExpHero, zh)
      } else if (group === 'pwd') {
        const pressed = chip.getAttribute('aria-pressed') === 'true'
        const ddPwd = document.getElementById('mk-dd-pwd')
        if (ddPwd) setNodeText(ddPwd, pressed ? '已设置' : '无')
        const ddPwdHero = document.getElementById('mk-dd-pwd-hero')
        if (ddPwdHero) setNodeText(ddPwdHero, pressed ? '已设置' : '无')
      }
    })
  })
}

/** Credential card: copy button + stamp on sender, live reaction on receiver. */
function initCopyDemo(): void {
  const copyButton = document.getElementById('mk-copy')
  if (!copyButton) return

  copyButton.addEventListener('click', () => {
    const link = 'https://blendproof.itycon.cn/s/suzanne'
    const cred = copyButton.closest<HTMLElement>('.mk-cred')

    const stamp = (): void => {
      setNodeText(copyButton, '已复制')
      cred?.classList.add('stamped')
      window.setTimeout(() => {
        setNodeText(copyButton, '复制链接')
        cred?.classList.remove('stamped')
      }, 1600)
    }
    void navigator.clipboard?.writeText(link).then(stamp).catch(() => {
      window.prompt(t('复制这条演示链接：'), link)
    })

    // 接收方联动：右卡收到链接（脉冲 + 浏览器状态行提示）
    const receiverCard = document.getElementById('mk-receiver-card')
    const browserStatus = document.getElementById('mk-browser-status')
    const browserUrl = document.getElementById('mk-browser-url') as HTMLInputElement | null
    if (!receiverCard) return
    receiverCard.classList.remove('receiving')
    void receiverCard.offsetWidth
    receiverCard.classList.add('receiving')
    if (browserUrl && browserStatus && !browserUrl.value) {
      browserUrl.value = 'blendproof.itycon.cn/s/suzanne'
      setNodeText(browserStatus, '已收到链接 · 点「前往」打开')
      browserStatus.dataset.kind = 'busy'
    }
  })
}

/** Hero credential card: copy button for hero perspective. */
function initHeroCopyDemo(): void {
  const copyButton = document.getElementById('mk-copy-hero')
  if (!copyButton) return

  copyButton.addEventListener('click', () => {
    const link = 'https://blendproof.itycon.cn/s/suzanne'
    const cred = copyButton.closest<HTMLElement>('.mk-cred')

    const stamp = (): void => {
      setNodeText(copyButton, '已复制')
      cred?.classList.add('stamped')
      window.setTimeout(() => {
        setNodeText(copyButton, '复制链接')
        cred?.classList.remove('stamped')
      }, 1600)
    }
    void navigator.clipboard?.writeText(link).then(stamp).catch(() => {
      window.prompt(t('复制这条演示链接：'), link)
    })
  })
}

/** Quick start panel: click steps to show corresponding mockup. No auto-play. */
function initQuickstart(): void {
  const panels = Array.from(document.querySelectorAll<HTMLElement>('.quickstart'))
  if (panels.length === 0) return

  panels.forEach((panel) => {
    const steps = Array.from(panel.querySelectorAll<HTMLElement>('.quickstart__step'))
    const mocks = Array.from(panel.querySelectorAll<HTMLElement>('.quickstart__mock'))
    const browser = panel.querySelector<HTMLElement>('.quickstart__browser')
    const states = browser ? Array.from(browser.querySelectorAll<HTMLElement>('.qs-browser__state')) : []

    let currentStep = -1 // No step selected by default

    const showStep = (index: number): void => {
      currentStep = index
      steps.forEach((step, i) => step.classList.toggle('is-active', i === index))

      // For creator perspective: show/hide mockups
      mocks.forEach((mock, i) => {
        mock.hidden = i !== index
      })

      // For reviewer perspective: show browser states
      states.forEach((state, i) => {
        state.hidden = i !== index
      })
    }

    // Click on step card: show that step
    steps.forEach((step, index) => {
      step.addEventListener('click', () => {
        // Toggle: clicking the same step again hides it
        if (index === currentStep) {
          currentStep = -1
          steps.forEach((s) => s.classList.remove('is-active'))
          mocks.forEach((m) => { m.hidden = true })
          states.forEach((s) => { s.hidden = true })
          return
        }
        showStep(index)
      })
    })

    // Interactive chips in mockup (creator perspective)
    panel.querySelectorAll<HTMLElement>('.quickstart__mock .mk-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const group = chip.closest('.mk-cred-chips')
        if (!group) return
        group.querySelectorAll<HTMLElement>('.mk-chip').forEach((other) => {
          const otherText = other.textContent?.trim()
          const chipText = chip.textContent?.trim()
          if (otherText !== chipText) {
            other.setAttribute('aria-pressed', 'false')
          }
        })
        chip.setAttribute('aria-pressed', 'true')
      })
    })

    // Reviewer perspective: browser interactions
    if (browser) {
      const urlInput = browser.querySelector<HTMLInputElement>('#qs-browser-url')
      const goBtn = browser.querySelector<HTMLButtonElement>('#qs-browser-go')
      const fillBtn = browser.querySelector('.qs-browser__fill')

      // Step 1: Fill demo link and go to step 2
      fillBtn?.addEventListener('click', () => {
        if (urlInput) urlInput.value = 'blendproof.itycon.cn/s/suzanne'
        showStep(1) // Go to step 2 (password)
      })

      goBtn?.addEventListener('click', () => {
        if (urlInput?.value.includes('suzanne')) {
          showStep(1) // Go to step 2 (password)
        }
      })

      // Step 2: "Open" button (simulated) goes to step 3
      const passState = browser.querySelector('[data-state="2"]')
      passState?.addEventListener('click', () => {
        showStep(2) // Go to step 3 (3D view)
        // Initialize mini viewer if not already
        initQsMiniViewer()
      })
    }
  })
}

/** Initialize mini 3D viewer in quick start panel */
let qsMiniViewerInitialized = false
function initQsMiniViewer(): void {
  if (qsMiniViewerInitialized) return
  const host = document.getElementById('qs-mini-viewer')
  if (!host) return

  // Dynamic import three.js
  import('three').then((THREE) => {
    import('three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      import('three/examples/jsm/controls/OrbitControls.js').then(({ OrbitControls }) => {
        qsMiniViewerInitialized = true

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setClearColor(0x000000, 0)
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
        host.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(40, host.clientWidth / host.clientHeight, 0.1, 50)
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

        // Load model - use path relative to landing page
        // The model is in projectRoot/public/, accessible via fs.allow
        new GLTFLoader().load('../public/default-monkey.glb', (gltf) => {
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
        }, undefined, (error) => {
          console.error('Failed to load model:', error)
        })

        // Resize handler
        const resize = (): void => {
          const w = host.clientWidth
          const h = host.clientHeight
          if (w === 0 || h === 0) return
          renderer.setSize(w, h, false)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
        }

        const resizeObserver = new ResizeObserver(resize)
        resizeObserver.observe(host)
        resize()

        // Render loop
        let raf = 0
        const tick = (): void => {
          raf = requestAnimationFrame(tick)
          controls.update()
          renderer.render(scene, camera)
        }
        raf = requestAnimationFrame(tick)

        // Cleanup on page hide
        window.addEventListener('pagehide', () => {
          cancelAnimationFrame(raf)
          resizeObserver.disconnect()
          controls.dispose()
          material.dispose()
          renderer.dispose()
        }, { once: true })
      })
    })
  })
}

/** Pain cards: click flips front (旧做法) to back (BlendProof 的解法). Hover handles desktop. */
function initPainFlip(): void {
  document.querySelectorAll<HTMLElement>('.pain').forEach((card) => {
    card.addEventListener('click', () => card.classList.toggle('flipped'))
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        card.classList.toggle('flipped')
      }
    })
  })
}

/** Legal: native <dialog> modals with backdrop + close-button dismissal. */
function initLegalModals(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-legal-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.legalOpen ?? '') as HTMLDialogElement | null
      dialog?.showModal()
    })
  })
  document.querySelectorAll<HTMLDialogElement>('dialog.legal-modal').forEach((dialog) => {
    dialog.querySelector('.legal-modal__close')?.addEventListener('click', () => dialog.close())
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close()
    })
  })
}

/**
 * Receiver card: a mock browser. Paste/enter the demo link, the password
 * auto-fills, the pass appears, and the hero's own model loads inside.
 */
function initReceiverBrowser(): void {
  const urlInput = document.getElementById('mk-browser-url') as HTMLInputElement | null
  const go = document.getElementById('mk-browser-go') as HTMLButtonElement | null
  const fill = document.getElementById('mk-browser-fill')
  const empty = document.getElementById('mk-browser-empty')
  const view = document.getElementById('mk-browser-view')
  const pwd = document.getElementById('mk-browser-pwd') as HTMLInputElement | null
  const status = document.getElementById('mk-browser-status')
  const modelHost = document.getElementById('mk-rx-model')
  if (!urlInput || !go || !fill || !empty || !view || !pwd || !status || !modelHost) return

  const reduced = prefersReducedMotion()
  let viewer: { dispose: () => void } | null = null
  let opened = false
  let timers: number[] = []

  const setStatus = (zh: string, kind: '' | 'busy' | 'ok'): void => {
    setNodeText(status, zh)
    status.dataset.kind = kind
  }

  const typePassword = (done: () => void): void => {
    const chars = 'tycon'
    let index = 0
    pwd.value = ''
    const timer = window.setInterval(() => {
      index += 1
      pwd.value = '•'.repeat(index)
      if (index >= chars.length) {
        window.clearInterval(timer)
        window.setTimeout(done, reduced ? 0 : 420)
      }
    }, reduced ? 0 : 110)
    timers.push(timer)
  }

  const open = (): void => {
    const value = urlInput.value.trim()
    if (!/s\/suzanne|suzanne/i.test(value)) {
      setStatus('未找到该分享——试试下面的演示链接。', 'busy')
      return
    }
    if (opened) return
    opened = true
    go.disabled = true
    empty.hidden = true
    view.hidden = false

    setStatus('正在验证口令…', 'busy')
    typePassword(() => {
      setStatus('口令通过 · 正在载入模型…', 'busy')
      viewer = viewer ?? createMiniViewer(modelHost)
      timers.push(window.setTimeout(() => {
        setStatus('模型已载入 · 拖拽旋转，滚轮缩放', 'ok')
        go.disabled = false
      }, reduced ? 0 : 1100))
    })
  }

  fill.addEventListener('click', () => {
    urlInput.value = 'blendproof.itycon.cn/s/suzanne'
    open()
  })
  go.addEventListener('click', open)
  urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') open()
  })
}

/** Bind behaviour to a programmatically created review item. */
function bindReviewItem(item: HTMLElement): void {
  item.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('.mk-review-status')) return
    item.parentElement?.querySelectorAll('.mk-review-item').forEach((other) => other.classList.remove('selected'))
    item.classList.add('selected')
  })
  const status = item.querySelector<HTMLButtonElement>('.mk-review-status')
  const badge = item.querySelector('i')
  status?.addEventListener('click', () => {
    const resolved = badge?.classList.toggle('resolved') ?? false
    setNodeText(status, resolved ? '重开' : '解决')
  })
}

/* ------------------------------------------------------------------ *
 * Card micro-interactions — spotlight, chrome dots, typewriter
 * ------------------------------------------------------------------ */

const finePointer = (): boolean =>
  window.matchMedia('(hover: hover) and (pointer: fine)').matches

/** Chrome "traffic dots" are decoration only — injected so no-JS stays clean. */
function initChromeDots(): void {
  document.querySelectorAll<HTMLElement>('.card__chrome').forEach((chrome) => {
    const dots = document.createElement('span')
    dots.className = 'card__dots'
    dots.setAttribute('aria-hidden', 'true')
    dots.innerHTML = '<i></i><i></i><i></i>'
    chrome.prepend(dots)
  })
}

/** Spotlight follows the pointer across each card. rAF-throttled, transform-free. */
function initCardInteractions(): void {
  if (prefersReducedMotion() || !finePointer()) return

  document.querySelectorAll<HTMLElement>('.card[data-anim]').forEach((card) => {
    let frame = 0

    card.addEventListener('pointermove', (event) => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const rect = card.getBoundingClientRect()
        card.style.setProperty('--mx', `${event.clientX - rect.left}px`)
        card.style.setProperty('--my', `${event.clientY - rect.top}px`)
      })
    })
  })
}

/**
 * Upload workbench demo: pick a file, run the local-conversion pipeline,
 * watch the three-stage progress land with the product's own state colors.
 */
function initUploadDemo(): void {
  const dropzone = document.getElementById('mk-dropzone')
  const fileRow = document.getElementById('mk-file')
  const convertButton = document.getElementById('mk-convert') as HTMLButtonElement | null
  const removeButton = document.getElementById('mk-remove')
  const progressList = document.getElementById('mk-progress')
  const steps = Array.from(document.querySelectorAll<HTMLElement>('.mk-step'))
  if (!dropzone || !fileRow || !convertButton || !removeButton || !progressList || steps.length === 0) return

  const reduced = prefersReducedMotion()
  let timers: number[] = []

  const reset = (): void => {
    timers.forEach((t) => window.clearTimeout(t))
    timers = []
    fileRow.hidden = true
    dropzone.hidden = false
    convertButton.disabled = true
    setNodeText(convertButton, '由本机 Blender 转换')
    progressList.hidden = true
    steps.forEach((step) => step.classList.remove('active', 'done'))
    // 重置后保留"可再次选择"的能力：拖放区还在，逻辑回到初始态
  }

  const runPipeline = (): void => {
    const pace = reduced ? 0 : 950
    progressList.hidden = false
    convertButton.disabled = true
    setNodeText(convertButton, '处理中…')

    steps.forEach((step, index) => {
      if (index > 0) {
        timers.push(window.setTimeout(() => {
          steps[index - 1].classList.remove('active')
          steps[index - 1].classList.add('done')
        }, pace * index))
      }
      timers.push(window.setTimeout(() => step.classList.add('active'), pace * index))
    })

    timers.push(window.setTimeout(() => {
      steps.forEach((step) => {
        step.classList.remove('active')
        step.classList.add('done')
      })
      setNodeText(convertButton, '已发布 · 审稿凭证已生成')
    }, pace * steps.length))
  }

  dropzone.addEventListener('click', () => {
    dropzone.hidden = true
    fileRow.hidden = false
    // 选中即上传：稍作停顿让文件行先出现，然后自动跑完整流程
    convertButton.disabled = true
    if (reduced) {
      runPipeline()
    } else {
      timers.push(window.setTimeout(runPipeline, 420))
    }
  })

  removeButton.addEventListener('click', (event) => {
    event.stopPropagation()
    reset()
  })

  convertButton.addEventListener('click', runPipeline)
}

/* ------------------------------------------------------------------ *
 * Card enter / exit choreography
 *
 * Hidden states exist only under classes this module adds, so the document
 * is fully visible without JS. Entering: the card lands, inner blocks
 * stagger in. Leaving: the card exits toward the direction it left.
 * ------------------------------------------------------------------ */

function initCards(): void {
  document.documentElement.classList.add('js')

  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-anim]'))
  if (cards.length === 0) return

  if (prefersReducedMotion()) {
    cards.forEach((card) => card.classList.add('in'))
    return
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const card = entry.target as HTMLElement
        if (entry.isIntersecting) {
          card.querySelectorAll<HTMLElement>('.reveal').forEach((el, index) => {
            el.style.transitionDelay = `${(0.1 + index * 0.08).toFixed(2)}s`
          })
          card.classList.remove('pre')
          card.classList.add('in')
        } else {
          card.dataset.exit = entry.boundingClientRect.top < 0 ? 'up' : 'down'
          card.querySelectorAll<HTMLElement>('.reveal').forEach((el) => {
            el.style.transitionDelay = '0s'
          })
          card.classList.add('pre')
          card.classList.remove('in')
        }
      }
    },
    { threshold: 0.14, rootMargin: '0px 0px -6% 0px' },
  )

  cards.forEach((card) => {
    card.classList.add('pre')
    io.observe(card)
  })
}

/* ------------------------------------------------------------------ *
 * Live platform status
 * ------------------------------------------------------------------ */

type PublicStats = {
  capacityBytes: number
  usedBytes: number
  projectCount: number
  activeShareCount: number
  retentionHours: number
  recommendedShareHours: number
  launchedAt: string
  processedFileCount: number
  processedBytes: number
  cleanedFileCount: number
  cleanedBytes: number
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

function formatUptime(launchedAt: string): string {
  const started = Date.parse(launchedAt)
  if (Number.isNaN(started)) return '—'
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return ifEn(`${days} d ${hours} h`, `${days} 天 ${hours} 小时`)
  if (hours > 0) return ifEn(`${hours} h ${minutes % 60} m`, `${hours} 小时 ${minutes % 60} 分`)
  return ifEn(`${minutes} min`, `${minutes} 分钟`)
}

function setStat(key: string, value: string, note?: string): void {
  const node = document.querySelector<HTMLElement>(`[data-stat="${key}"]`)
  if (!node) return
  const noteNode = node.querySelector('small')
  if (noteNode && note !== undefined) noteNode.textContent = note
  node.textContent = value
  if (noteNode) node.appendChild(noteNode)
}

async function initLiveStatus(): Promise<void> {
  const note = document.querySelector<HTMLElement>('[data-stat="note"]')
  if (!note) return

  const offline = (reason: string) => {
    note.dataset.state = 'offline'
    note.textContent = reason
    setStat('health', t('未读取'), t('跨域或网络受限'))
  }

  try {
    const [healthResponse, statsResponse] = await Promise.all([
      fetch(`${ORIGIN}/api/health`, { cache: 'no-store' }),
      fetch(`${ORIGIN}/api/public/stats`, { cache: 'no-store' }),
    ])

    if (healthResponse.ok) {
      const health = (await healthResponse.json()) as { runtime?: string; d1?: boolean; r2?: boolean }
      const parts = [
        health.runtime === 'cloudflare-worker' ? 'Worker' : health.runtime,
        health.d1 ? 'D1' : null,
        health.r2 ? 'R2' : null,
      ]
      setStat('health', health.d1 && health.r2 ? t('运行中') : t('部分可用'), parts.filter(Boolean).join(' · ') || undefined)
    }

    if (!statsResponse.ok) {
      offline(ifEn(`Live API returned ${statsResponse.status}; platform data is temporarily unavailable.`, `实时接口返回 ${statsResponse.status}，暂时无法读取平台数据。`))
      return
    }

    const stats = (await statsResponse.json()) as PublicStats

    setStat('uptime', formatUptime(stats.launchedAt), t('自 2026-09-12 上线'))
    setStat('capacity', formatBytes(stats.capacityBytes), ifEn(`${formatBytes(stats.usedBytes)} used`, `已用 ${formatBytes(stats.usedBytes)}`))
    setStat('projects', String(stats.projectCount), ifEn(`${stats.activeShareCount} active shares`, `${stats.activeShareCount} 条活跃分享`))
    setStat('processed', String(stats.processedFileCount), ifEn(`${formatBytes(stats.processedBytes)} total`, `累计 ${formatBytes(stats.processedBytes)}`))
    setStat('cleaned', String(stats.cleanedFileCount), ifEn(`${formatBytes(stats.cleanedBytes)} freed`, `释放 ${formatBytes(stats.cleanedBytes)}`))

    const meter = document.querySelector<HTMLElement>('[data-stat="meter"]')
    if (meter && stats.capacityBytes > 0) {
      meter.style.width = `${Math.min(100, (stats.usedBytes / stats.capacityBytes) * 100)}%`
    }

    note.dataset.state = 'online'
    note.textContent = ifEn(
      `Live data loaded. Projects are retained up to ${stats.retentionHours} hours, ` +
      `shares default to ${stats.recommendedShareHours} hours, and cleanup runs hourly.`,
      `实时数据读取成功。项目最长保留 ${stats.retentionHours} 小时，` +
      `分享默认 ${stats.recommendedShareHours} 小时，每小时定时清理。`,
    )
  } catch {
    offline(t('无法连接生产接口（跨域或网络受限），实时数据仅在线上站点可见。'))
  }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

applyStaticI18n()
initTheme()
initLangToggle()
initPerspectiveToggle()
initChromeDots()
initHero3D()
initMockups()
initHeroCopyDemo()
initQuickstart()
initCardInteractions()
initCards()
void initLiveStatus()
