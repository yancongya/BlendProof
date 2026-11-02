/**
 * Card modules: pain flip, legal modals, chrome dots, card interactions, cards.
 */

import { ifEn, t, setNodeText } from '../i18n'

export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const finePointer = (): boolean =>
  window.matchMedia('(hover: hover) and (pointer: fine)').matches

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

/** Upload workbench demo: pick a file, run the local-conversion pipeline,
 * watch the three-stage progress land with the product's own state colors. */
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

function initQuickstart(): void {
  const panels = Array.from(document.querySelectorAll<HTMLElement>('.quickstart'))
  if (panels.length === 0) return

  panels.forEach((panel) => {
    const steps = Array.from(panel.querySelectorAll<HTMLElement>('.quickstart__step'))
    const mocks = Array.from(panel.querySelectorAll<HTMLElement>('.quickstart__mock'))
    // 客户视角的状态现在也在 quickstart__mock 内的 mk-browser 里
    const states = Array.from(panel.querySelectorAll<HTMLElement>('.qs-browser__state'))
    const host = panel.querySelector<HTMLElement>('#qs-mini-viewer')

    let currentStep = -1
    let miniViewer: { dispose: () => void; ready: Promise<boolean> } | null = null
    let cancelMiniViewerLoad: (() => void) | null = null
    let miniViewerFeedback: HTMLElement | null = null
    let pageHidden = false

    const setMiniViewerState = (state: 'loading' | 'error' | null): void => {
      miniViewerFeedback?.remove()
      miniViewerFeedback = null
      if (!host) return
      // Its centered flex parent must still give the absolute canvas/status a width.
      host.style.alignSelf = 'stretch'
      host.setAttribute('aria-busy', String(state === 'loading'))
      if (!state) return

      const feedback = document.createElement('div')
      feedback.className = 'qs-mini-viewer-status'
      feedback.dataset.kind = state
      feedback.style.cssText = 'position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px 16px 36px;text-align:center;font-size:12px;background:var(--view-g1);color:var(--ink)'
      const message = document.createElement('span')
      message.setAttribute('role', 'status')
      message.textContent = state === 'loading'
        ? ifEn('Loading model…', '正在加载模型…')
        : ifEn('Model failed to load. Please retry.', '模型加载失败，请重试。')
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.className = 'qs-browser__open'
      retry.textContent = ifEn('Retry', '重试')
      retry.hidden = state !== 'error'
      retry.addEventListener('click', ensureMiniViewer)
      feedback.appendChild(message)
      feedback.appendChild(retry)
      host.appendChild(feedback)
      miniViewerFeedback = feedback
    }

    const disposeMiniViewer = (): void => {
      miniViewer?.dispose()
      miniViewer = null
    }

    const ensureMiniViewer = (): void => {
      if (prefersReducedMotion() || pageHidden || currentStep !== 2) return
      if (!host?.isConnected || miniViewer || cancelMiniViewerLoad) return

      let settled = false
      let startTimer: number | undefined
      const finish = (ready: boolean, showFailure = true): void => {
        if (settled) return
        settled = true
        window.clearTimeout(startTimer)
        window.clearTimeout(timeout)
        cancelMiniViewerLoad = null
        if (!ready) disposeMiniViewer()
        setMiniViewerState(!ready && showFailure ? 'error' : null)
      }
      // Bound the entire attempt, including the delay, chunk import and GLB load.
      const timeout = window.setTimeout(() => finish(false), 15000)
      cancelMiniViewerLoad = () => finish(false, false)
      setMiniViewerState('loading')
      startTimer = window.setTimeout(() => {
        if (pageHidden || !host.isConnected || currentStep !== 2) return finish(false, false)
        void import('../hero3d')
          .then(({ createMiniViewer }) => {
            // Imports cannot be aborted; ignore completions from expired attempts.
            if (settled) return
            if (pageHidden || !host.isConnected || currentStep !== 2) return finish(false, false)
            miniViewer = createMiniViewer(host)
            if (!miniViewer) return finish(false)
            void miniViewer.ready.then((ready) => {
              if (pageHidden || !host.isConnected || currentStep !== 2) return finish(false, false)
              finish(ready)
            }, () => finish(false))
          })
          .catch(() => finish(false))
      }, 120)
    }

    if (host) {
      window.addEventListener('pagehide', () => {
        pageHidden = true
        cancelMiniViewerLoad?.()
        disposeMiniViewer()
        setMiniViewerState(null)
      })
      window.addEventListener('pageshow', (event) => {
        if (!event.persisted) return
        pageHidden = false
        ensureMiniViewer()
      })
    }

    const showStep = (index: number): void => {
      currentStep = index
      if (index !== 2) cancelMiniViewerLoad?.()
      steps.forEach((step, i) => step.classList.toggle('is-active', i === index))
      // mockup：多个 mock 时按 index 切换；单个 mock（客户视角）时始终显示
      if (mocks.length > 1) {
        mocks.forEach((mock, i) => {
          mock.classList.toggle('is-visible', i === index)
          mock.setAttribute('aria-hidden', String(i !== index))
        })
      } else {
        // 客户视角：只有一个 mock，始终可见，通过 states 切换内部内容
        mocks[0]?.classList.add('is-visible')
      }
      // states（qs-browser__state）：按 index 切换 hidden
      states.forEach((state, i) => { state.hidden = i !== index })
      if (index === 2) ensureMiniViewer()
    }

    steps.forEach((step, index) => {
      step.addEventListener('click', () => {
        if (index === currentStep) return // 同一步骤不重复切换
        showStep(index)
      })
    })

    panel.querySelectorAll<HTMLElement>('.quickstart__mock .mk-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const group = chip.closest('.mk-cred-chips')
        if (!group) return
        group.querySelectorAll<HTMLElement>('.mk-chip').forEach((other) => {
          const otherText = other.textContent?.trim()
          const chipText = chip.textContent?.trim()
          if (otherText !== chipText) other.setAttribute('aria-pressed', 'false')
        })
        chip.setAttribute('aria-pressed', 'true')
      })
    })

    // 创作者视角 mockup 交互
    // 步骤1：dropzone 点击 → 模拟进度条动画
    const dropzone = panel.querySelector<HTMLElement>('#qs-dropzone')
    const progress1 = panel.querySelector<HTMLElement>('#qs-progress-1')
    if (dropzone && progress1) {
      dropzone.addEventListener('click', () => {
        dropzone.hidden = true
        progress1.hidden = false
        const fill = progress1.querySelector<HTMLElement>('.qs-progress__fill')
        const label = progress1.querySelector<HTMLElement>('.qs-progress__label')
        if (fill) { fill.style.width = '100%'; fill.classList.add('is-animating') }
        if (label) label.textContent = '转换中…'
        // 1.8s 后停止动画 + 显示完成提示 + 跳到步骤2
        window.setTimeout(() => {
          if (fill) fill.classList.remove('is-animating')
          if (label) label.textContent = '已转换 · 点击步骤②配置凭证'
        }, 1400)
        window.setTimeout(() => { showStep(1) }, 2000)
      })
    }

    // 步骤2：生成按钮 → 跳到步骤3
    const genBtn = panel.querySelector<HTMLElement>('#qs-gen-btn')
    if (genBtn) {
      genBtn.addEventListener('click', () => { showStep(2) })
    }

    // 步骤3：点击分享文本 → 复制到剪贴板 + flash 动画 + toast
    const shareText = panel.querySelector<HTMLElement>('#qs-share-text')
    const toast = panel.querySelector<HTMLElement>('#qs-share-toast')
    if (shareText) {
      shareText.addEventListener('click', () => {
        const text = '【BlendProof 分享】3D 审稿链接\n\n链接：https://blendproof.itycon.cn/s/suzanne\n提取码：tycon\n\n复制以上内容到浏览器打开，即可查看 3D 模型并添加批注。'
        shareText.classList.add('is-copied')
        window.setTimeout(() => shareText.classList.remove('is-copied'), 500)
        void navigator.clipboard?.writeText(text).then(() => {
          if (toast) {
            toast.hidden = false
            toast.style.opacity = '1'
            toast.style.transform = 'translateY(0)'
            window.setTimeout(() => {
              toast.style.opacity = '0'
              toast.style.transform = 'translateY(4px)'
              window.setTimeout(() => { toast.hidden = true }, 300)
            }, 1600)
          }
        }).catch(() => { /* ignore */ })
      })
    }

    // 客户视角浏览器 mockup 交互（现在也在 panel 内）
    const urlInput = panel.querySelector<HTMLInputElement>('#qs-browser-url')
    const pwdInput = panel.querySelector<HTMLInputElement>('#qs-browser-pwd')
    const goBtn = panel.querySelector<HTMLButtonElement>('#qs-browser-go')
    const fillBtn = panel.querySelector<HTMLButtonElement>('.qs-browser__fill')
    const openBtn = panel.querySelector<HTMLButtonElement>('.qs-browser__open')

    const typeText = (input: HTMLInputElement, text: string, done: () => void): void => {
        input.value = ''
        let i = 0
        const timer = window.setInterval(() => {
          i += 1
          input.value = text.slice(0, i)
          if (i >= text.length) { window.clearInterval(timer); done() }
        }, 45)
      }

      const DEMO_URL = 'blendproof.itycon.cn/s/suzanne'

      fillBtn?.addEventListener('click', () => {
        if (!urlInput || fillBtn.disabled) return
        fillBtn.disabled = true
        typeText(urlInput, DEMO_URL, () => { window.setTimeout(() => showStep(1), 450) })
      })

      goBtn?.addEventListener('click', () => { if (urlInput?.value === DEMO_URL) showStep(1) })

      const fillPassphrase = (): void => {
        if (!pwdInput || pwdInput.value.length > 0) return
        typeText(pwdInput, 'tycon', () => { if (openBtn) openBtn.disabled = false })
      }
      const passObserver = new MutationObserver(() => {
        const state = panel.querySelector<HTMLElement>('[data-state="2"]')
        if (state && !state.hidden) fillPassphrase()
      })
      states.forEach((state) => passObserver.observe(state, { attributes: true, attributeFilter: ['hidden'] }))

      openBtn?.addEventListener('click', () => { if (openBtn.disabled) return; showStep(2) })
  })
}

export function init(): void {
  initPainFlip()
  initQuickstart()
  initLegalModals()
  initChromeDots()
  initCardInteractions()
  initUploadDemo()
  initCards()
}
