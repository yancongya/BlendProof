/**
 * Toggle modules: perspective, theme, and language.
 */

import { t, ifEn, applyStaticI18n, getLang } from '../i18n'

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

export function init(): void {
  initPerspectiveToggle()
  initTheme()
  initLangToggle()
}