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

import { t } from '../i18n'
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

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  window.scrollTo(0, 0)

  if (identitySeen) {
    root.dataset.identityChosen = 'true'
  } else {
    root.dataset.identityChosen = 'false'
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
      if (isLaunching) return

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
