import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as THREE from 'three'

// Execute the real entry points; only browser/network/3D boundaries are faked.
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
class Element extends EventTarget {
  attributes = new Map()
  dataset = {}
  style = { setProperty() {}, removeProperty() {} }
  hidden = false
  disabled = false
  isConnected = true
  textContent = ''
  value = ''
  children = []
  queries = new Map()
  classes = new Set()
  classList = {
    add: (...names) => names.forEach((name) => this.classes.add(name)),
    remove: (...names) => names.forEach((name) => this.classes.delete(name)),
    toggle: (name, force = !this.classes.has(name)) => {
      force ? this.classes.add(name) : this.classes.delete(name)
      return force
    },
  }
  querySelectorAll(selector) { return this.queries.get(selector) ?? [] }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name) }
  toggleAttribute(name, force) { force ? this.setAttribute(name, '') : this.removeAttribute(name) }
  click() { this.dispatchEvent(new Event('click')) }
  appendChild(child) { this.children.push(child); child.parent = this }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this) }
}
class Image extends Element {
  complete = false
  naturalWidth = 0
  requests = 0
  constructor(name) {
    super()
    this.attributes.set('src', `./${name}-512.webp`)
    this.attributes.set('srcset', `./${name}-512.webp 512w, ./${name}-768.webp 768w`)
  }
  get src() { return this.getAttribute('src') }
  set src(value) { this.setAttribute('src', value) }
  get srcset() { return this.getAttribute('srcset') }
  set srcset(value) { this.setAttribute('srcset', value) }
  setAttribute(name, value) {
    super.setAttribute(name, value)
    if (name === 'src' || name === 'srcset') {
      this.requests++
      this.complete = false
      this.naturalWidth = 0
    }
  }
  decode = async () => {}
  load() { this.complete = true; this.naturalWidth = 512; this.dispatchEvent(new Event('load')) }
  fail() { this.complete = true; this.naturalWidth = 0; this.dispatchEvent(new Event('error')) }
}
function browser() {
  let now = 0, sequence = 0
  const jobs = new Map()
  const observers = []
  const timeout = (callback, delay = 0, interval = false) => {
    const id = ++sequence
    jobs.set(id, { callback, at: now + Math.max(1, delay), interval: interval ? Math.max(1, delay) : 0 })
    return id
  }
  const elements = new Map()
  const document = {
    baseURI: 'https://blendproof.test/landing/',
    documentElement: new Element(),
    getElementById: (id) => elements.get(id) ?? null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => Object.assign(new Element(), { getContext: () => ({}) }),
  }
  const window = Object.assign(new EventTarget(), {
    setTimeout: (fn, delay) => timeout(fn, delay),
    clearTimeout: (id) => jobs.delete(id),
    setInterval: (fn, delay) => timeout(fn, delay, true),
    clearInterval: (id) => jobs.delete(id),
    scrollTo() {},
    location: { origin: 'https://blendproof.test', reload() { throw new Error('must not reload') } },
    matchMedia: () => ({ matches: false }),
    innerWidth: 1280,
    devicePixelRatio: 1,
  })
  class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this) }
    observe(target) { this.targets.add(target) }
    unobserve(target) { this.targets.delete(target) }
    disconnect() { this.targets.clear() }
    trigger(target) {
      if (this.targets.has(target)) this.callback([{ target, isIntersecting: true }], this)
    }
  }
  const globals = {
    window, document, URL, console,
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    history: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: FakeIntersectionObserver,
  }
  return {
    globals, window, document, elements, jobs,
    intersect(target) { observers.forEach((observer) => observer.trigger(target)) },
    async advance(ms) {
      const end = now + ms
      await flush()
      while (true) {
        const next = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        const [id, job] = next
        now = job.at
        jobs.delete(id)
        if (job.interval) jobs.set(id, { ...job, at: now + job.interval })
        job.callback()
        await flush()
      }
      now = end
      await flush()
    },
  }
}
function moduleAt(path, runtime, mocks = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  const i18n = { t: (text) => text, ifEn: (_en, zh) => zh, setNodeText: (node, text) => { node.textContent = text } }
  vm.runInNewContext(outputText, {
    ...runtime.globals, exports,
    require: (name) => {
      if (name in mocks) return mocks[name]
      if (name === '../i18n' || name === './i18n') return i18n
      if (name === './cards') return { prefersReducedMotion: () => false }
      throw new Error(`Unexpected import: ${name}`)
    },
  }, { filename: path })
  return exports
}
function portal({ intersectFirst = true, identitySeen = false } = {}) {
  const runtime = browser()
  runtime.globals.localStorage.getItem = () => identitySeen ? '1' : null
  const images = [new Image('creator'), new Image('reviewer')]
  const buttons = [new Element(), new Element()]
  buttons.forEach((button) => { button.disabled = true })
  const units = images.map((image, index) => {
    const unit = new Element()
    unit.dataset.role = index === 0 ? 'creator' : 'reviewer'
    unit.queries.set('img', [image])
    unit.queries.set('.tarot-cta', [buttons[index]])
    return unit
  })
  const deck = new Element(), note = new Element(), retry = new Element(), reopen = new Element()
  runtime.elements.set('tarot-deck', deck)
  runtime.elements.set('tarot-loading', note)
  runtime.elements.set('tarot-retry', retry)
  runtime.elements.set('tarot-reopen', reopen)
  runtime.document.querySelectorAll = (selector) => selector === '.tarot-unit' ? units : []
  moduleAt('landing/src/modules/tarot.ts', runtime).init()
  if (intersectFirst) runtime.intersect(units[0])
  return { ...runtime, images, buttons, units, deck, note, retry, reopen }
}

test('首屏只启动接近视口的身份卡，已就绪卡片不等待屏外卡片', async () => {
  const page = portal()
  assert.equal(page.images[0].loading, 'eager')
  assert.notEqual(page.images[1].loading, 'eager')
  page.images[0].load()
  await flush()
  assert.equal(page.buttons[0].disabled, false)
  assert.equal(page.buttons[1].disabled, true)
  assert.equal(page.deck.getAttribute('aria-busy'), 'false')

  page.intersect(page.units[1])
  assert.equal(page.images[1].loading, 'eager')
  assert.equal(page.buttons[1].disabled, true)
})

test('卡面超时后迟到的 load + decode 会自动恢复身份入口', async () => {
  const page = portal()
  await page.advance(15_001)
  assert.equal(page.buttons[0].disabled, true)
  assert.equal(page.retry.getAttribute('hidden'), null)
  page.images[0].load()
  await flush()
  assert.equal(page.buttons[0].disabled, false)
  assert.equal(page.buttons[1].disabled, true)
  assert.equal(page.deck.getAttribute('aria-busy'), 'false')
  assert.equal(page.note.getAttribute('hidden'), '')
})

test('卡面重试只重建失败图片的 responsive 请求，不刷新页面或重载成功卡面', async () => {
  const page = portal()
  page.images[0].load()
  page.intersect(page.units[1])
  page.images[1].fail()
  await flush()
  page.retry.click()
  assert.equal(page.images[0].requests, 0)
  assert.ok(page.images[1].requests > 0)
  assert.match(page.images[1].srcset, /bp-retry=.*512w, .*bp-retry=.*768w/)
  assert.equal(page.deck.getAttribute('aria-busy'), 'true')
  page.images[1].load()
  await flush()
  assert.equal(page.buttons.every((button) => !button.disabled), true)
  await page.advance(30_000)
  assert.equal(page.buttons[0].disabled, false, 'a cleared old timeout must not disable a successful retry')
})

test('旧 decode 迟到成功不能解锁仍在加载的新重试任务', async () => {
  const page = portal()
  const oldDecode = deferred()
  page.images[0].load()
  page.intersect(page.units[1])
  page.images[1].decode = () => oldDecode.promise
  page.images[1].load()
  await page.advance(15_001)
  page.retry.click()
  oldDecode.resolve()
  await flush()
  assert.equal(page.buttons[1].disabled, true)
  page.images[1].decode = async () => {}
  page.images[1].load()
  await flush()
  assert.equal(page.buttons[1].disabled, false)
})

function pageTransition(page, type, persisted = true) {
  const event = new Event(type)
  Object.defineProperty(event, 'persisted', { value: persisted })
  page.window.dispatchEvent(event)
}

test('BFCache：首次相交前离开，preparedUnits 为空时仍恢复观察并按卡解锁', async () => {
  const page = portal({ intersectFirst: false })
  assert.equal(page.jobs.size, 0)
  assert.equal(page.images.every((image) => image.loading !== 'eager'), true)
  for (let trip = 0; trip < 2; trip++) {
    pageTransition(page, 'pagehide')
    page.intersect(page.units[0])
    assert.equal(page.images[0].loading, undefined, 'pagehide must disconnect the old observer')
    pageTransition(page, 'pageshow')
  }
  assert.equal(page.jobs.size, 0, 'restoration alone must not start offscreen images')
  page.intersect(page.units[0])
  assert.equal(page.images[0].loading, 'eager')
  assert.equal(page.images[1].loading, undefined)
  page.images[0].load()
  await flush()
  assert.equal(page.buttons[0].disabled, false)
  assert.equal(page.buttons[1].disabled, true)
  page.intersect(page.units[1])
  page.images[1].load()
  await flush()
  assert.equal(page.buttons.every((button) => !button.disabled), true)
  assert.equal(page.jobs.size, 0)
})

test('BFCache：已跳过身份门时保持懒加载，重新选择后观察未准备卡片', async () => {
  const page = portal({ intersectFirst: false, identitySeen: true })
  pageTransition(page, 'pagehide')
  pageTransition(page, 'pageshow')
  page.intersect(page.units[0])
  assert.equal(page.images[0].loading, undefined)
  page.reopen.click()
  page.intersect(page.units[0])
  assert.equal(page.images[0].loading, 'eager')
  page.images[0].load()
  await flush()
  assert.equal(page.buttons[0].disabled, false)
})

test('BFCache：首次卡面未就绪时离开，缓存期间完成的图片在恢复时重新 decode 并解锁', async () => {
  const page = portal()
  page.images[0].load()
  await flush()
  pageTransition(page, 'pagehide')
  assert.equal(page.jobs.size, 0)
  page.images[1].load()
  await flush()
  assert.equal(page.buttons[0].disabled, true, 'hidden pages must not receive stale load updates')
  pageTransition(page, 'pageshow')
  await flush()
  assert.equal(page.buttons[0].disabled, false)
  assert.equal(page.buttons[1].disabled, true)
  assert.equal(page.deck.getAttribute('aria-busy'), 'false')
  assert.equal(page.note.getAttribute('hidden'), '')
  assert.equal(page.images.every((image) => image.requests === 0), true, 'reuse successful cached images')
})

test('BFCache：多次 pagehide/pageshow 都清理并重建未完成任务，恢复后仍可超时和重试', async () => {
  const page = portal()
  page.intersect(page.units[1])
  page.images[0].load()
  page.images[1].load()
  await flush()
  page.images[1].complete = false
  page.images[1].naturalWidth = 0
  for (let trip = 0; trip < 3; trip++) {
    pageTransition(page, 'pagehide')
    assert.equal(page.jobs.size, 0, `round ${trip}: no old timeout may survive pagehide`)
    pageTransition(page, 'pageshow')
    await flush()
    assert.equal(page.deck.getAttribute('aria-busy'), 'true')
    assert.equal(page.buttons[1].disabled, true)
  }
  await page.advance(15_001)
  assert.equal(page.retry.getAttribute('hidden'), null)
  page.retry.click()
  page.images[1].load()
  await flush()
  assert.equal(page.buttons.every((button) => !button.disabled), true)
  pageTransition(page, 'pagehide')
  assert.equal(page.jobs.size, 0)
})

for (const outcome of ['resolve', 'reject']) {
  test(`BFCache：恢复前旧 decode ${outcome} 不得覆盖新任务`, async () => {
    const page = portal()
    const oldDecode = deferred(), newDecode = deferred()
    page.images[0].load()
    page.intersect(page.units[1])
    page.images[1].decode = () => oldDecode.promise
    page.images[1].load()
    await flush()
    pageTransition(page, 'pagehide')
    page.images[1].decode = () => newDecode.promise
    pageTransition(page, 'pageshow')
    await flush()
    assert.equal(page.buttons[1].disabled, true)
    oldDecode[outcome](outcome === 'reject' ? new Error('old decode failed') : undefined)
    await flush()
    assert.equal(page.buttons[1].disabled, true)
    assert.equal(page.deck.getAttribute('aria-busy'), 'true')
    assert.equal(page.retry.getAttribute('hidden'), '', 'old failure cannot replace loading with retry')
    newDecode.resolve()
    await flush()
    assert.equal(page.buttons.every((button) => !button.disabled), true)
    assert.equal(page.deck.getAttribute('aria-busy'), 'false')
    assert.equal(page.jobs.size, 0)
  })
}

function receiver(hero) {
  const runtime = browser()
  for (const id of ['mk-browser-url', 'mk-browser-go', 'mk-browser-fill', 'mk-browser-empty',
    'mk-browser-view', 'mk-browser-pwd', 'mk-browser-status', 'mk-rx-model']) runtime.elements.set(id, new Element())
  const go = runtime.elements.get('mk-browser-go')
  const status = runtime.elements.get('mk-browser-status')
  runtime.elements.get('mk-browser-view').hidden = true
  status.hidden = true
  runtime.elements.get('mk-browser-url').value = '/s/suzanne'
  moduleAt('landing/src/modules/demos.ts', runtime, { '../hero3d': hero }).init()
  return { ...runtime, go, status }
}
function viewerTask() {
  const result = deferred()
  return { ...result, disposed: 0, ready: result.promise, dispose() { this.disposed++ } }
}

function quickstart(hero, runtime = browser(), host = new Element()) {
  const panel = new Element()
  const steps = Array.from({ length: 3 }, () => new Element())
  const states = Array.from({ length: 3 }, () => new Element())
  panel.queries.set('.quickstart__step', steps)
  panel.queries.set('.quickstart__mock', [new Element()])
  panel.queries.set('.qs-browser__state', states)
  panel.queries.set('#qs-mini-viewer', [host])
  runtime.document.querySelectorAll = (selector) => selector === '.quickstart' ? [panel] : []
  moduleAt('landing/src/modules/cards.ts', runtime, {
    get '../hero3d'() { return typeof hero === 'function' ? hero() : hero },
  }).init()
  const feedback = () => host.children.find((child) => child.className === 'qs-mini-viewer-status')
  return {
    ...runtime, host, steps, states, feedback,
    retry() {
      const button = feedback()?.children.find((child) => child.type === 'button')
      assert.ok(button && !button.hidden, 'a visible native retry button must be available')
      button.click()
    },
  }
}

test('Quickstart：ready=false 释放缓存并显示重试，重试成功后保留可复用 viewer', async () => {
  const first = viewerTask(), second = viewerTask()
  let calls = 0
  const page = quickstart({ createMiniViewer: () => ++calls === 1 ? first : second })
  page.steps[2].click()
  await page.advance(120)
  first.resolve(false)
  await flush()
  assert.equal(first.disposed, 1)
  assert.equal(page.host.getAttribute('aria-busy'), 'false')
  assert.equal(page.feedback()?.dataset.kind, 'error')
  assert.match(page.feedback().children[0].textContent, /失败.*重试/)
  page.retry()
  await page.advance(120)
  assert.equal(calls, 2)
  assert.equal(page.host.getAttribute('aria-busy'), 'true')
  second.resolve(true)
  await flush()
  assert.equal(page.feedback(), undefined)
  page.steps[0].click()
  page.steps[2].click()
  await page.advance(30_000)
  assert.equal(calls, 2, 'a successful cached viewer is reused across steps')
  assert.equal(second.disposed, 0)
  assert.equal(page.jobs.size, 0)
})

test('Quickstart：实际模型请求超过 16 秒后不留下空白死缓存，可重新进入第三步', async () => {
  const runtime = miniViewer()
  const page = quickstart({ createMiniViewer: () => runtime.create() }, runtime, runtime.host)
  page.steps[2].click()
  await page.advance(16_000)
  assert.equal(runtime.requests.length, 1)
  assert.equal(runtime.renderers[0].disposed, 1)
  assert.equal(page.feedback()?.dataset.kind, 'error')
  const late = model()
  runtime.requests[0].loaded(late)
  assert.deepEqual(late.disposed, { geometry: 1, material: 1, texture: 1 })
  page.steps[0].click()
  page.steps[2].click()
  await page.advance(120)
  assert.equal(runtime.requests.length, 2)
  runtime.requests[1].loaded(model())
  await flush()
  assert.equal(page.feedback(), undefined)
  assert.equal(page.host.children.length, 1, 'only the successful new canvas remains')
  pageTransition(page, 'pagehide')
  assert.equal(page.host.children.length, 0)
  assert.equal(page.jobs.size, 0)
})

test('Quickstart：动态 import 超时后可重试，旧模块迟到不创建或覆盖新 viewer', async () => {
  const oldModule = deferred(), nextModule = deferred(), current = viewerTask()
  let imports = 0, obsolete = 0, created = 0
  const page = quickstart(() => ++imports === 1 ? oldModule.promise : nextModule.promise)
  page.steps[2].click()
  await page.advance(16_000)
  assert.equal(page.feedback()?.dataset.kind, 'error')
  assert.equal(page.jobs.size, 0)
  page.retry()
  await page.advance(120)
  oldModule.resolve({ createMiniViewer: () => { obsolete++; return viewerTask() } })
  await flush()
  assert.equal(obsolete, 0)
  assert.equal(page.feedback()?.dataset.kind, 'loading')
  nextModule.resolve({ createMiniViewer: () => { created++; return current } })
  current.resolve(true)
  await flush()
  assert.equal(created, 1)
  assert.equal(page.feedback(), undefined)
  assert.equal(page.jobs.size, 0)
})

for (const outcome of ['resolve', 'reject']) {
  test(`Quickstart：ready 悬挂超时可重试，旧 ready ${outcome} 不影响新任务`, async () => {
    const first = viewerTask(), second = viewerTask()
    let calls = 0
    const page = quickstart({ createMiniViewer: () => ++calls === 1 ? first : second })
    page.steps[2].click()
    await page.advance(16_000)
    assert.equal(first.disposed, 1)
    assert.equal(page.feedback()?.dataset.kind, 'error')
    page.retry()
    await page.advance(120)
    first[outcome](outcome === 'resolve' ? true : new Error('old request failed'))
    await flush()
    assert.equal(page.feedback()?.dataset.kind, 'loading')
    assert.equal(second.disposed, 0)
    second.resolve(true)
    await flush()
    assert.equal(page.feedback(), undefined)
    assert.equal(page.jobs.size, 0)
  })
}

for (const failure of ['import', 'create', 'null', 'ready']) {
  test(`Quickstart：${failure} 失败有明确重试入口`, async () => {
    let attempts = 0
    const first = viewerTask(), second = viewerTask()
    const page = quickstart(() => {
      if (++attempts > 1) return { createMiniViewer: () => second }
      if (failure === 'import') throw new Error('chunk failed')
      return { createMiniViewer: () => {
        if (failure === 'create') throw new Error('WebGL failed')
        return failure === 'null' ? null : first
      } }
    })
    page.steps[2].click()
    await page.advance(120)
    if (failure === 'ready') first.reject(new Error('GLB failed'))
    await flush()
    assert.equal(page.feedback()?.dataset.kind, 'error')
    assert.equal(page.jobs.size, 0)
    page.retry()
    await page.advance(120)
    second.resolve(true)
    await flush()
    assert.equal(attempts, 2)
    assert.equal(page.feedback(), undefined)
  })
}

for (const stage of ['delay', 'import', 'ready', 'loaded']) {
  test(`Quickstart：${stage} 阶段往返 BFCache 清理旧任务并恢复第三步`, async () => {
    const first = viewerTask(), restored = viewerTask(), oldModule = deferred()
    let imports = 0, created = 0, obsolete = 0
    const page = quickstart(() => {
      imports++
      if (stage === 'import' && imports === 1) return oldModule.promise
      return { createMiniViewer: () => { created++; return imports === 1 ? first : restored } }
    })
    page.steps[2].click()
    if (stage !== 'delay') await page.advance(120)
    if (stage === 'loaded') { first.resolve(true); await flush() }
    pageTransition(page, 'pagehide')
    assert.equal(page.jobs.size, 0)
    assert.equal(first.disposed, ['ready', 'loaded'].includes(stage) ? 1 : 0)
    pageTransition(page, 'pageshow')
    await page.advance(120)
    oldModule.resolve({ createMiniViewer: () => { obsolete++; return viewerTask() } })
    if (stage === 'ready') first.reject(new Error('obsolete ready'))
    await flush()
    assert.equal(obsolete, 0)
    assert.equal(page.feedback()?.dataset.kind, 'loading')
    const active = stage === 'delay' ? first : restored
    active.resolve(true)
    await flush()
    assert.equal(created, ['ready', 'loaded'].includes(stage) ? 2 : 1)
    assert.equal(page.feedback(), undefined)
    pageTransition(page, 'pagehide')
    assert.equal(active.disposed, 1)
    assert.equal(page.jobs.size, 0)
  })
}

test('Quickstart：切离第三步会取消延时及 import，离页后不恢复隐藏步骤', async () => {
  const module = deferred()
  let imports = 0, created = 0
  const page = quickstart(() => { imports++; return module.promise })
  page.steps[2].click()
  page.steps[0].click()
  await page.advance(120)
  assert.equal(imports, 0)
  page.steps[2].click()
  await page.advance(120)
  page.steps[0].click()
  assert.equal(page.jobs.size, 0)
  module.resolve({ createMiniViewer: () => { created++; return viewerTask() } })
  await flush()
  assert.equal(created, 0)
  pageTransition(page, 'pagehide')
  pageTransition(page, 'pageshow')
  await page.advance(16_000)
  assert.equal(imports, 1)
  assert.equal(page.feedback(), undefined)
})

test('接收端 ready 悬挂会超时解除 busy，销毁旧 viewer，并允许成功重试', async () => {
  const first = viewerTask(), second = viewerTask()
  let calls = 0
  const page = receiver({ createMiniViewer: () => ++calls === 1 ? first : second })
  page.go.click()
  await page.advance(20_000)
  assert.equal(page.go.disabled, false)
  assert.notEqual(page.status.dataset.kind, 'busy')
  assert.equal(first.disposed, 1)
  page.go.click()
  await page.advance(1_000)
  assert.equal(calls, 2)
  first.resolve(true)
  await flush()
  assert.equal(page.status.dataset.kind, 'busy', 'a stale completion must not mark the new attempt ready')
  second.resolve(true)
  await flush()
  assert.equal(page.status.dataset.kind, 'ok')
  assert.equal(page.go.disabled, false)
})

test('接收端 ready 拒绝后可重试，离开页面会销毁 viewer 且迟到结果不更新 UI', async () => {
  const first = viewerTask(), second = viewerTask()
  let calls = 0
  const page = receiver({ createMiniViewer: () => ++calls === 1 ? first : second })
  page.go.click()
  await page.advance(1_000)
  first.reject(new Error('network failure'))
  await flush()
  assert.equal(first.disposed, 1)
  assert.equal(page.go.disabled, false)
  page.go.click()
  await page.advance(1_000)
  page.window.dispatchEvent(new Event('pagehide'))
  const statusAtExit = page.status.textContent
  second.resolve(true)
  await flush()
  assert.equal(second.disposed, 1)
  assert.equal(page.status.textContent, statusAtExit)
  assert.equal(page.jobs.size, 0)
})

test('接收端无效分享链接显示可见错误状态', () => {
  const page = receiver({ createMiniViewer: () => viewerTask() })
  page.elements.get('mk-browser-url').value = 'not-a-share'
  page.go.click()
  assert.equal(page.status.hidden, false)
  assert.equal(page.status.dataset.kind, 'error')
  assert.match(page.status.textContent, /未找到该分享/)
})

test('接收端演示在 BFCache 恢复后重建已销毁的 Viewer', async () => {
  const first = viewerTask(), restored = viewerTask()
  let calls = 0
  const page = receiver({ createMiniViewer: () => (++calls === 1 ? first : restored) })
  page.go.click()
  await page.advance(1_000)
  assert.equal(calls, 1)
  assert.equal(page.status.dataset.kind, 'busy')

  pageTransition(page, 'pagehide', true)
  assert.equal(first.disposed, 1)
  pageTransition(page, 'pageshow', true)
  await page.advance(1)
  assert.equal(calls, 2)
  assert.equal(page.go.disabled, true)

  restored.resolve(true)
  await flush()
  assert.equal(page.status.dataset.kind, 'ok')
  assert.equal(page.go.disabled, false)
})

test('接收端动态 import 悬挂同样有限超时，超时后迟到模块不创建 viewer', async () => {
  const module = deferred()
  let created = 0
  const page = receiver(module.promise)
  page.go.click()
  await page.advance(20_000)
  assert.equal(page.go.disabled, false)
  module.resolve({ createMiniViewer: () => { created++; return viewerTask() } })
  await flush()
  assert.equal(created, 0)
})

function miniViewer() {
  const runtime = browser()
  const requests = [], renderers = []
  class Renderer {
    domElement = new Element()
    disposed = 0
    constructor() { renderers.push(this) }
    setPixelRatio() {}
    setClearColor() {}
    setSize() {}
    dispose() { this.disposed++ }
  }
  class Controls extends THREE.EventDispatcher { dispose() {} }
  class Loader { load(_url, loaded, _progress, failed) { requests.push({ loaded, failed }) } }
  const host = new Element()
  host.clientWidth = 320
  host.clientHeight = 200
  const api = moduleAt('landing/src/hero3d.ts', runtime, {
    three: { ...THREE, WebGLRenderer: Renderer },
    'three/examples/jsm/loaders/GLTFLoader.js': { GLTFLoader: Loader },
    'three/examples/jsm/controls/OrbitControls.js': { OrbitControls: Controls },
    '../../public/default-monkey.glb?url': { default: '/default-monkey.glb' },
  })
  return { ...runtime, requests, renderers, host, create: () => api.createMiniViewer(host) }
}
function model() {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const texture = new THREE.Texture()
  const material = new THREE.MeshStandardMaterial({ map: texture })
  const disposed = { geometry: 0, material: 0, texture: 0 }
  for (const [key, resource] of Object.entries({ geometry, material, texture })) {
    resource.addEventListener('dispose', () => disposed[key]++)
  }
  return { scene: new THREE.Mesh(geometry, material), disposed }
}

test('mini viewer 自身 ready 有限超时；超时后 canvas 和迟到 GLB 资源均释放', async () => {
  const page = miniViewer()
  const viewer = page.create()
  let ready
  viewer.ready.then((value) => { ready = value })
  await page.advance(15_001)
  assert.equal(ready, false)
  assert.equal(page.host.children.length, 0)
  assert.equal(page.renderers[0].disposed, 1)
  const late = model()
  page.requests[0].loaded(late)
  assert.deepEqual(late.disposed, { geometry: 1, material: 1, texture: 1 })
  viewer.dispose()
  assert.equal(page.renderers[0].disposed, 1)
  assert.equal(page.jobs.size, 0)
})

test('mini viewer 成功后取消超时；手动销毁幂等并清理 geometry/material/texture/canvas', async () => {
  const page = miniViewer()
  const viewer = page.create()
  const loaded = model()
  page.requests[0].loaded(loaded)
  assert.equal(await viewer.ready, true)
  await page.advance(30_000)
  assert.equal(page.renderers[0].disposed, 0)
  viewer.dispose()
  viewer.dispose()
  assert.deepEqual(loaded.disposed, { geometry: 1, material: 1, texture: 1 })
  assert.equal(page.renderers[0].disposed, 1)
  assert.equal(page.host.children.length, 0)
  assert.equal(page.jobs.size, 0)
})

test('mini viewer GLB 报错或 pagehide 会结束 ready 并清理旧画布，可创建新 viewer', async () => {
  const page = miniViewer()
  const first = page.create()
  page.requests[0].failed(new Error('404'))
  assert.equal(await first.ready, false)
  assert.equal(page.host.children.length, 0)
  const second = page.create()
  page.window.dispatchEvent(new Event('pagehide'))
  assert.equal(await second.ready, false)
  assert.equal(page.host.children.length, 0)
  assert.equal(page.renderers.every((renderer) => renderer.disposed === 1), true)
  assert.equal(page.jobs.size, 0)
})
