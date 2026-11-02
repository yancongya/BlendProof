/**
 * Landing page entry — boot sequence.
 *
 * Imports and initialises all feature modules.
 * All logic lives in ./modules/*; this file only orchestrates.
 */

import { applyStaticI18n } from './i18n'
import { init as initToggles } from './modules/toggles'
import { init as initDemos } from './modules/demos'
import { init as initCards } from './modules/cards'
import { init as initTarot } from './modules/tarot'
import { init as initStats } from './modules/stats'

function initHero3DWhenNeeded(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const host = document.getElementById('hero3d')
  if (!host) return

  const root = document.documentElement
  let nearViewport = false
  let loading = false
  let started = false
  let hero3D: typeof import('./hero3d') | null = null
  let attempts = 0
  let viewportObserver: IntersectionObserver | null = null
  let perspectiveObserver: MutationObserver | null = null

  const maybeInit = (): void => {
    if (started || !nearViewport || root.dataset.view !== 'reviewer') return
    if (!hero3D) {
      if (loading) return
      loading = true
      void import('./hero3d')
        .then((module) => {
          hero3D = module
          loading = false
          attempts = 0
          maybeInit()
        })
        .catch(() => {
          loading = false
          if (attempts >= 2) return
          attempts += 1
          window.setTimeout(maybeInit, 500 * attempts)
        })
      return
    }

    started = true
    viewportObserver?.disconnect()
    perspectiveObserver?.disconnect()
    hero3D.initHero3D()
  }

  if (typeof IntersectionObserver === 'function') {
    viewportObserver = new IntersectionObserver(([entry]) => {
      nearViewport = entry.isIntersecting
      maybeInit()
    }, { rootMargin: '300px 0px' })
    viewportObserver.observe(host)
  } else {
    nearViewport = true
  }
  if (typeof MutationObserver === 'function') {
    perspectiveObserver = new MutationObserver(maybeInit)
    perspectiveObserver.observe(root, { attributes: true, attributeFilter: ['data-view'] })
  } else {
    document.querySelectorAll<HTMLButtonElement>('.perspective-btn').forEach((button) => {
      button.addEventListener('click', maybeInit)
    })
  }
  maybeInit()
}

applyStaticI18n()
initToggles()
initTarot()
initHero3DWhenNeeded()
initDemos()
initCards()
void initStats()
