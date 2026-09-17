/**
 * Tarot Identity Portal — Atropos 2.0.2 multi-layer parallax
 *
 * State machine: html[data-identity-chosen="false/true"]
 *   CSS shows/hides portal and main content automatically.
 *   JS just flips the attribute.
 *
 * Parallax: Atropos JS (inlined in <head>) handles tilt.
 *   We additionally track mouse to drive --holo-x/--holo-y CSS vars
 *   for the holographic shine layer (tc-holo).
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

  // Lock scroll; always show portal on every page load/refresh
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  window.scrollTo(0, 0)
  root.dataset.identityChosen = 'false'

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
            rotateXMax: 16,
            rotateYMax: 16,
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

    unit.addEventListener('pointerenter', () => {
      if (!isLaunching) unit.classList.add('is-hovering')
    })
    unit.addEventListener('pointermove', (ev) => {
      if (isLaunching) return
      const e = ev as PointerEvent
      const r = atroposEl.getBoundingClientRect()
      unit.style.setProperty('--holo-x', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`)
      unit.style.setProperty('--holo-y', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`)
    })
    unit.addEventListener('pointerleave', () => {
      if (!isLaunching) unit.classList.remove('is-hovering')
    })
  })

  // Enter site
  const enter = (role: 'creator' | 'reviewer'): void => {
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
    root.dataset.identityChosen = 'true'
  })

  reopenBtn?.addEventListener('click', () => {
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
      root.dataset.identityChosen = 'true'
    }
  })

  // Initial selection state matches current perspective
  const view = root.dataset.view ?? 'creator'
  units.forEach((u) => u.classList.toggle('is-selected', u.dataset.role === view))
}

export function init(): void {
  initTarotPortal()
}