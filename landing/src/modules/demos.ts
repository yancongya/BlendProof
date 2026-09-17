/**
 * Demo modules: outliner, review, upload, cred, copy, hero copy,
 * receiver browser, pain flip, legal modals.
 */

import { t, setNodeText } from '../i18n'
import { createMiniViewer } from '../hero3d'
import { prefersReducedMotion } from './cards'

const ORIGIN = 'https://blendproof.itycon.cn'

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

/** Receiver card: a mock browser. Paste/enter the demo link, the password
 * auto-fills, the pass appears, and the hero's own model loads inside. */
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

export function init(): void {
  initOutlinerDemo()
  initReviewDemo()
  initCredDemo()
  initCopyDemo()
  initHeroCopyDemo()
  initReceiverBrowser()
}