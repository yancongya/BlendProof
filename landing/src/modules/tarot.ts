/**
 * Tarot Identity Portal — Atropos 2.0.2 multi-layer parallax
 *
 * State machine: html[data-identity-chosen="false/true"]
 *   CSS shows/hides portal and main content automatically.
 *   JS just flips the attribute.
 *
 * Parallax: Atropos JS (inlined in <head>) handles tilt.
 *   The lightweight tc-holo layer tracks the pointer through CSS variables;
 *   Atropos handles card tilt and the creator's image-authored parallax.
 *
 * Entrance: Clicking a card initiates an immersive rush center-zoom
 *   animation before transitioning cleanly into the landing page.
 */

import { ifEn, t } from '../i18n'
import { prefersReducedMotion } from './cards'

function initTarotPortal(): void {
  const root = document.documentElement
  const skipBtn = document.getElementById('tarot-skip')
  const reopenBtn = document.getElementById('tarot-reopen')
  const units = Array.from(document.querySelectorAll<HTMLElement>('.tarot-unit'))
  if (units.length === 0) return

  let isLaunching = false

  // C1: 只在首次访问时展示塔罗门；回访直接进正文。
  // 用 localStorage 记住选择，保留"重新选择"入口供主动重置。
  let identitySeen = false
  try { identitySeen = localStorage.getItem('bp-identity-seen') === '1' } catch { /* ignore */ }

  const deck = document.getElementById('tarot-deck')
  const loadingNote = document.getElementById('tarot-loading')
  const retryBtn = document.getElementById('tarot-retry')
  type ImageTask = { state: 'loading' | 'ready' | 'failed'; dispose: () => void }
  const unitImages = new Map(units.map((unit) => [unit, Array.from(unit.querySelectorAll('img'))]))
  const imageTasks = new Map<HTMLImageElement, ImageTask>()
  const preparedUnits = new Set<HTMLElement>()
  let retrySequence = 0
  let imageObserver: IntersectionObserver | undefined

  const isUnitReady = (unit: HTMLElement): boolean => {
    const images = unitImages.get(unit) ?? []
    return preparedUnits.has(unit) && images.length > 0 &&
      images.every((image) => imageTasks.get(image)?.state === 'ready')
  }

  const updateCardState = (): void => {
    let loading = false
    let failed = false
    let readyCount = 0
    units.forEach((unit) => {
      const tasks = (unitImages.get(unit) ?? []).map((image) => imageTasks.get(image))
      const ready = isUnitReady(unit)
      if (ready) readyCount++
      if (preparedUnits.has(unit)) {
        loading ||= tasks.some((task) => !task || task.state === 'loading')
        failed ||= tasks.some((task) => task?.state === 'failed')
      }
      unit.classList.toggle('is-loading', !ready)
      unit.setAttribute('aria-disabled', String(!ready))
      unit.querySelectorAll<HTMLButtonElement>('.tarot-cta').forEach((button) => {
        button.disabled = !ready
      })
    })
    deck?.setAttribute('aria-busy', String(loading))
    retryBtn?.toggleAttribute('hidden', !failed)
    loadingNote?.toggleAttribute('hidden', !failed && (readyCount > 0 || !loading))
    loadingNote?.classList.toggle('is-error', failed)
    if (loadingNote) {
      loadingNote.textContent = failed
        ? ifEn('Some card artwork failed to load. Retry or choose a ready role.', '部分卡面未能加载，可重试或选择已就绪的身份。')
        : ifEn('Preparing card artwork…', '正在准备卡面…')
    }
  }

  const startImageTask = (image: HTMLImageElement, retry: boolean): void => {
    imageTasks.get(image)?.dispose()
    let decoding = false
    let timer: number | undefined
    const task: ImageTask = {
      state: 'loading',
      dispose: () => {
        window.clearTimeout(timer)
        image.removeEventListener('load', loaded)
        image.removeEventListener('error', failed)
      },
    }
    imageTasks.set(image, task)
    const isCurrent = (): boolean => imageTasks.get(image) === task
    const failed = (): void => {
      if (!isCurrent()) return
      window.clearTimeout(timer)
      task.state = 'failed'
      updateCardState()
      // Keep load listening after timeout: a slow request can still recover.
    }
    const loaded = async (): Promise<void> => {
      if (!isCurrent() || decoding) return
      decoding = true
      try {
        if (image.naturalWidth === 0) throw new Error('Empty card image')
        if (typeof image.decode === 'function') await image.decode()
        if (!isCurrent()) return
        task.state = 'ready'
        task.dispose()
        updateCardState()
      } catch {
        failed()
      } finally {
        decoding = false
      }
    }
    image.addEventListener('load', loaded)
    image.addEventListener('error', failed)
    timer = window.setTimeout(failed, 15000)
    image.loading = 'eager'

    if (retry) {
      // Retry both responsive candidates as well as the fallback, not the page.
      const retryId = `${Date.now()}-${++retrySequence}`
      const retryUrl = (source: string): string => {
        const url = new URL(source, document.baseURI)
        url.searchParams.set('bp-retry', retryId)
        return url.href
      }
      const src = image.getAttribute('src')
      const srcset = image.getAttribute('srcset')
      if (srcset) image.srcset = srcset.split(',').map((candidate) => {
        const [source, descriptor] = candidate.trim().split(/\s+/)
        return `${retryUrl(source)} ${descriptor}`
      }).join(', ')
      if (src) image.src = retryUrl(src)
    }
    if (image.complete) void loaded()
  }

  const prepareUnitImages = (unit: HTMLElement, retryFailed = false): void => {
    preparedUnits.add(unit)
    ;(unitImages.get(unit) ?? []).forEach((image) => {
      const task = imageTasks.get(image)
      if (!task || (retryFailed && task.state === 'failed')) startImageTask(image, Boolean(task))
    })
    updateCardState()
  }

  const observePortalCards = (): void => {
    imageObserver?.disconnect()
    const pending = units.filter((unit) => !preparedUnits.has(unit))
    if (pending.length === 0) return
    if (typeof IntersectionObserver === 'undefined') {
      pending.forEach((unit) => prepareUnitImages(unit))
      return
    }
    imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const unit = entry.target as HTMLElement
        observer.unobserve(unit)
        prepareUnitImages(unit)
      })
    }, { rootMargin: '180px 0px' })
    pending.forEach((unit) => imageObserver?.observe(unit))
  }

  retryBtn?.addEventListener('click', () => {
    preparedUnits.forEach((unit) => prepareUnitImages(unit, true))
  })
  window.addEventListener('pagehide', () => {
    imageObserver?.disconnect()
    imageTasks.forEach((task) => task.dispose())
    imageTasks.clear()
    updateCardState()
  })
  window.addEventListener('pageshow', (event) => {
    // BFCache retains the DOM, but pagehide invalidates its load/decode tasks.
    // Reattach on every restoration; cached complete images are decoded again.
    if (event.persisted) {
      preparedUnits.forEach((unit) => prepareUnitImages(unit))
      // pagehide can precede the first intersection, leaving no prepared units.
      if (root.dataset.identityChosen === 'false') observePortalCards()
    }
  })

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  window.scrollTo(0, 0)

  if (identitySeen) {
    root.dataset.identityChosen = 'true'
  } else {
    root.dataset.identityChosen = 'false'
    observePortalCards()
  }

  const noMotion = prefersReducedMotion()

  // Initialise Atropos on both cards (Atropos JS is inlined in <head>)
  if (!noMotion) {
    const win = window as unknown as Record<string, unknown>
    const Atropos = typeof win['Atropos'] === 'function'
      ? (win['Atropos'] as (opts: Record<string, unknown>) => void)
      : null
    if (Atropos) {
      ;['atropos-creator', 'atropos-reviewer'].forEach((id) => {
        const el = document.getElementById(id)
        if (el) {
          Atropos({
            el,
            shadow: true,
            highlight: true,
            rotateXMax: id === 'atropos-creator' ? 12 : 16,
            rotateYMax: id === 'atropos-creator' ? 12 : 16,
            rotateTouch: 'scroll-y',
          })
        }
      })
    }
  }

  // Mouse move → update --holo-x/--holo-y for the holographic shine layer
  units.forEach((unit) => {
    const atroposEl = unit.querySelector<HTMLElement>('.tarot-atropos')
    if (!atroposEl) return
    const localRotateLayers = Array.from(
      unit.querySelectorAll<HTMLElement>('[data-local-rotate]'),
    )
    const creatorTrail = unit.querySelector<SVGPathElement>('[data-creator-trail]')
    const trailPoints: Array<{ x: number; y: number }> = []
    let scanLockTimer: number | undefined

    const updateLocalRotation = (pointerX: number, pointerY: number): void => {
      localRotateLayers.forEach((layer) => {
        const rotateX = pointerY * Number(layer.dataset.rx ?? 0)
        const rotateY = pointerX * Number(layer.dataset.ry ?? 0)
        const rotateZ = (pointerX * Number(layer.dataset.rz ?? 0))
          + (pointerY * Number(layer.dataset.rzy ?? 0))
        layer.style.transform = `translateZ(0) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) rotateZ(${rotateZ.toFixed(2)}deg)`
      })
    }

    unit.addEventListener('pointerenter', () => {
      if (isLaunching) return
      unit.classList.add('is-hovering', 'is-copy-revealed')
      if (!noMotion && unit.dataset.role === 'reviewer') {
        window.clearTimeout(scanLockTimer)
        scanLockTimer = window.setTimeout(() => unit.classList.add('is-scan-locked'), 380)
      }
    })
    unit.addEventListener('pointermove', (ev) => {
      if (isLaunching) return
      const e = ev as PointerEvent
      const r = atroposEl.getBoundingClientRect()
      const pointerX = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1))
      const pointerY = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1))
      unit.style.setProperty('--holo-x', `${((pointerX + 1) * 50).toFixed(1)}%`)
      unit.style.setProperty('--holo-y', `${((pointerY + 1) * 50).toFixed(1)}%`)
      unit.style.setProperty('--scan-x', `${((pointerX + 1) * 50).toFixed(1)}%`)
      unit.style.setProperty('--scan-y', `${((pointerY + 1) * 50).toFixed(1)}%`)
      updateLocalRotation(pointerX, pointerY)

      if (!noMotion && creatorTrail) {
        trailPoints.push({
          x: ((e.clientX - r.left) / r.width) * 1024,
          y: ((e.clientY - r.top) / r.height) * 1536,
        })
        if (trailPoints.length > 11) trailPoints.shift()
        creatorTrail.setAttribute('d', trailPoints
          .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
          .join(' '))
      }
    })
    unit.addEventListener('pointerleave', () => {
      if (!isLaunching) {
        window.clearTimeout(scanLockTimer)
        unit.classList.remove('is-hovering', 'is-scan-locked')
        updateLocalRotation(0, 0)
        trailPoints.length = 0
        creatorTrail?.removeAttribute('d')
      }
    })
  })

  // Enter site
  const enter = (role: 'creator' | 'reviewer'): void => {
    // C1: 记住用户已选择过身份，下次直接进正文
    try { localStorage.setItem('bp-identity-seen', '1') } catch { /* ignore */ }
    root.dataset.identityChosen = 'true'
    const btn = document.querySelector<HTMLButtonElement>(`.perspective-btn[data-view="${role}"]`)
    if (btn) {
      btn.click()
    } else {
      root.dataset.view = role
      try { localStorage.setItem('bp-perspective', role) } catch { /* ignore */ }
    }
    setTimeout(() => {
      const target = role === 'creator'
        ? document.getElementById('quickstart')
        : (document.getElementById('hero3d') ?? document.getElementById('quickstart'))
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 460)
  }

  // Click / keyboard on each card unit: trigger cinematic rush entrance
  units.forEach((unit) => {
    const role = unit.dataset.role as 'creator' | 'reviewer'
    const go = () => {
      if (isLaunching || !isUnitReady(unit)) return

      imageObserver?.disconnect()

      units.forEach((u) => u.classList.toggle('is-selected', u === unit))

      if (noMotion) {
        enter(role)
        return
      }

      isLaunching = true
      const portal = document.getElementById('tarot-portal')
      portal?.classList.add('is-launching')

      // Calculate exact offset from current card position to viewport center
      const rect = unit.getBoundingClientRect()
      const deltaX = (window.innerWidth / 2) - (rect.left + rect.width / 2)
      const deltaY = (window.innerHeight / 2) - (rect.top + rect.height / 2)
      unit.style.setProperty('--rush-x', `${deltaX.toFixed(1)}px`)
      unit.style.setProperty('--rush-y', `${deltaY.toFixed(1)}px`)

      // Selected card rushes forward, non-selected dismisses
      units.forEach((u) => {
        if (u === unit) {
          u.classList.add('is-rushing')
        } else {
          u.classList.add('is-dismissing')
        }
      })

      // At peak burst of the rush animation (~620ms), switch into landing page
      setTimeout(() => {
        enter(role)

        // Clean up animation classes after portal fades
        setTimeout(() => {
          portal?.classList.remove('is-launching')
          units.forEach((u) => {
            u.classList.remove('is-rushing', 'is-dismissing')
            u.style.removeProperty('--rush-x')
            u.style.removeProperty('--rush-y')
          })
          isLaunching = false
        }, 400)
      }, 620)
    }

    unit.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName !== 'BUTTON') go()
    })
    unit.querySelector<HTMLElement>('.tarot-cta')?.addEventListener('click', go)
    unit.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() }
    })
  })

  skipBtn?.addEventListener('click', () => {
    if (isLaunching) return
    try { localStorage.setItem('bp-identity-seen', '1') } catch { /* ignore */ }
    root.dataset.identityChosen = 'true'
  })

  reopenBtn?.addEventListener('click', () => {
    try { localStorage.removeItem('bp-identity-seen') } catch { /* ignore */ }
    isLaunching = false
    const portal = document.getElementById('tarot-portal')
    portal?.classList.remove('is-launching')
    units.forEach((u) => {
      u.classList.remove('is-rushing', 'is-dismissing')
      u.style.removeProperty('--rush-x')
      u.style.removeProperty('--rush-y')
    })
    window.scrollTo(0, 0)
    observePortalCards()
    root.dataset.identityChosen = 'false'
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.dataset.identityChosen === 'false' && !isLaunching) {
      try { localStorage.setItem('bp-identity-seen', '1') } catch { /* ignore */ }
      root.dataset.identityChosen = 'true'
    }
  })

  // Initial selection state matches current perspective
  const view = root.dataset.view ?? 'creator'
  units.forEach((u) => u.classList.toggle('is-selected', u.dataset.role === view))

  // 动态更新 reopen 按钮：图标 + 文字反映当前身份
  const reopenIcon = document.getElementById('tarot-reopen-icon')
  const reopenLabel = document.getElementById('tarot-reopen-label')
  const roleLabels: Record<string, { icon: string; label: string }> = {
    creator: { icon: '✦', label: t('造物者') },
    reviewer: { icon: '◈', label: t('审视者') },
  }
  const updateReopen = (): void => {
    const current = root.dataset.view ?? 'creator'
    const info = roleLabels[current] ?? roleLabels.creator
    if (reopenIcon) reopenIcon.textContent = info.icon
    if (reopenLabel) reopenLabel.textContent = info.label
  }
  updateReopen()

  // 观察视角切换时更新
  const observer = new MutationObserver(updateReopen)
  observer.observe(root, { attributes: true, attributeFilter: ['data-view'] })
}

export function init(): void {
  initTarotPortal()
}
