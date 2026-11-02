/**
 * 落地页冒烟测试
 * 前置：npm run optimize:landing-images
 * 执行：npm run test:landing
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import sharp from 'sharp'

const cwd = process.cwd()
const DIST = join(cwd, 'dist/landing')
const ENTRY_BUDGET_BYTES = 96 * 1024
const CARD_OUTPUT_BUDGETS = new Map([[512, 700_000], [768, 1_300_000]])
const SPLASH_OUTPUT_BUDGET = 100_000

let fail = 0
const check = (name, ok, detail) => {
  if (ok) { console.log(`  ✓ ${name}`) }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++ }
}

console.log('=== 落地页冒烟测试 ===\n')

const htmlPath = join(DIST, 'index.html')
if (!existsSync(htmlPath)) { console.error(`✗ 找不到 ${htmlPath}`); process.exit(1) }
const html = readFileSync(htmlPath, 'utf-8')
const appPath = join(DIST, 'app.js')
const appCode = existsSync(appPath) ? readFileSync(appPath, 'utf-8') : ''
const tarotSource = readFileSync(join(cwd, 'landing/src/modules/tarot.ts'), 'utf-8')
const landingMainSource = readFileSync(join(cwd, 'landing/src/main.ts'), 'utf-8')

// 读取所有 JS
const jsFiles = []
if (existsSync(DIST)) {
  for (const f of readdirSync(DIST)) if (f.endsWith('.js')) jsFiles.push(readFileSync(join(DIST, f), 'utf-8'))
  if (existsSync(join(DIST, 'assets')))
    for (const f of readdirSync(join(DIST, 'assets'))) if (f.endsWith('.js')) jsFiles.push(readFileSync(join(DIST, 'assets', f), 'utf-8'))
}
const js = jsFiles.join('\n')

const localWebpRefs = new Set()
for (const [, attribute, value] of html.matchAll(/(?:^|\s)(src|srcset)\s*=\s*["']([^"']+)["']/gi)) {
  const candidates = attribute.toLowerCase() === 'srcset'
    ? value.split(',').map((item) => item.trim().split(/\s+/)[0])
    : [value]
  for (const candidate of candidates) {
    if (/\.webp(?:[?#]|$)/i.test(candidate) && !/^(?:[a-z]+:|\/\/)/i.test(candidate)) {
      localWebpRefs.add(candidate)
    }
  }
}

const optimizedCardRefs = [...localWebpRefs]
  .map((url) => ({ url, match: url.split(/[?#]/, 1)[0].match(/(?:^|\/)([^/]+)-(512|768)\.webp$/i) }))
  .filter((item) => item.match)
const optimizedCardTags = [...html.matchAll(/<img\b[^>]*>/gi)]
  .map(([tag]) => tag)
  .filter((tag) => /(?:^|\s)srcset\s*=\s*["'][^"']*\.\/assets\/(?:optimized\/cards\/)?[^/]+-(?:512|768)\.webp/i.test(tag))

function getAttribute(tag, name) {
  return tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? ''
}

function parseSrcset(value) {
  return value.split(',').map((candidate) => {
    const [url, descriptor] = candidate.trim().split(/\s+/)
    return { url, descriptor }
  }).filter(({ url }) => url)
}

const cardTagDetails = optimizedCardTags.map((tag) => ({
  src: getAttribute(tag, 'src'),
  variants: parseSrcset(getAttribute(tag, 'srcset')),
}))

function resolveDistAsset(url) {
  const pathname = decodeURIComponent(url.split(/[?#]/, 1)[0])
  if (!pathname.startsWith('./')) return null
  const filePath = resolve(DIST, pathname)
  const fromDist = relative(DIST, filePath)
  return fromDist.startsWith('..') || fromDist.startsWith('/') ? null : filePath
}

function findCardSource(basename) {
  for (const directory of ['public/landing', 'landing/assets/cards']) {
    for (const extension of ['png', 'jpg', 'jpeg']) {
      const filePath = join(cwd, directory, `${basename}.${extension}`)
      if (existsSync(filePath)) return filePath
    }
  }
  return null
}

console.log('1. perspective-toggle 隐藏')
check('有 hidden 属性', html.includes('perspective-toggle" role="group" aria-label="切换视角" hidden'))
check('CSS 有 [hidden] display:none', html.includes('perspective-toggle[hidden]'))

console.log('\n2. 胶囊标签')
check('创作者侧有 hero__tags', html.includes('data-perspective="creator">\n          <span class="hero-tag">纯免费</span>'))
check('客户侧有 hero__tags', html.includes('data-perspective="reviewer">\n          <span class="hero-tag">纯免费</span>'))

console.log('\n3. CTA 文案')
check('"立即登录注册"按钮 ≥ 2 个', (html.match(/>立即登录注册<\/a>/g) || []).length >= 2)

console.log('\n4. 分享面板')
check('标题"分享信息"', html.includes('<span>分享信息</span>'))
check('"可批注"标签', html.includes('>可批注</button>'))
check('"仅查看"标签', html.includes('>仅查看</button>'))

console.log('\n5. 复制按钮')
check('按钮"复制分享文本"', html.includes('mk-copy-hero">复制分享文本</button>'))

console.log('\n6. 旧文案清理')
check('无"预览客户看到的画面"', !html.includes('预览客户看到的画面'))
check('无"5 GB</b>私有空间"', !html.includes('5 GB</b>私有空间'))
check('无"¥0</b>注册"', !html.includes('¥0</b>注册'))

console.log('\n7. mockup 高度一致')
check('mockup 有 border+radius+background', html.includes('quickstart__mockup') && html.includes('border: 1px solid var(--border)') && html.includes('border-radius: var(--radius)'))

console.log('\n8. JS 交互逻辑')
// initQuickstart 被混淆，用 CSS 类名检查：quickstart__step + is-active
check('quickstart__step 事件绑定', js.includes('quickstart__step'))
check('is-active 类切换', js.includes('is-active'))
check('复制文本含"BlendProof 分享"', js.includes('BlendProof 分享') && js.includes('提取码'))

console.log('\n9. 分包与入口预算')
const entryScripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
  .map((match) => match[1])
const dynamicChunkRefs = [...appCode.matchAll(/\bimport\(\s*(["'])([^"']+\.js(?:[?#][^"']*)?)\1\s*\)/g)]
  .map((match) => match[2])
const resolvedDynamicChunks = dynamicChunkRefs.map((url) => ({ url, filePath: resolveDistAsset(url) }))
const forbiddenLinkRels = new Set(['stylesheet', 'preload', 'modulepreload'])
const linkRels = [...html.matchAll(/<link\b[^>]*\brel\s*=\s*["']([^"']+)["'][^>]*>/gi)]
  .flatMap((match) => match[1].toLowerCase().split(/\s+/))
check('HTML 使用相对 ./app.js 入口', entryScripts.includes('./app.js') && existsSync(appPath))
check('根路由资源基准固定为 /landing/', html.includes('<base href="/landing/">'))
check('HTML 无 stylesheet/preload/modulepreload 链接', linkRels.every((rel) => !forbiddenLinkRels.has(rel)))
check('app.js 含至少一个相对动态 chunk 且文件存在',
  resolvedDynamicChunks.length > 0 && resolvedDynamicChunks.every(({ url, filePath }) => url.startsWith('./') && filePath && existsSync(filePath)),
  dynamicChunkRefs.join(', ') || '未找到 import("./...js")')
const entryBytes = existsSync(appPath) ? statSync(appPath).size : 0
check(`app.js 未压缩体积 ≤ ${ENTRY_BUDGET_BYTES / 1024} KiB`, entryBytes > 0 && entryBytes <= ENTRY_BUDGET_BYTES, `${entryBytes} B`)

console.log('\n10. WebP 优化素材与可重复脚本')
let packageScripts = {}
try { packageScripts = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')).scripts || {} } catch { /* reported by the check below */ }
check('图片优化命令登记且脚本存在',
  packageScripts['optimize:landing-images'] === 'node scripts/optimize-landing-images.mjs' &&
  existsSync(join(cwd, 'scripts/optimize-landing-images.mjs')))

const cardVariants = new Map()
for (const { match } of optimizedCardRefs) {
  const [, basename, width] = match
  if (!cardVariants.has(basename)) cardVariants.set(basename, new Set())
  cardVariants.get(basename).add(width)
}
const pairedCardVariants = [...cardVariants].filter(([, widths]) => widths.has('512') && widths.has('768'))
check('页面包含 19 个卡面引用、17 个唯一源素材', optimizedCardTags.length === 19 && cardVariants.size === 17,
  `${optimizedCardTags.length} references / ${cardVariants.size} sources`)
const eachCardHas512FallbackAndPairedSrcset = cardTagDetails.length === 19 && cardTagDetails.every(({ src, variants }) => {
  const fallback = src.match(/^(\.\/assets\/(?:optimized\/cards\/)?)([^/?#]+)-(512|768)\.webp$/i)
  const byWidth = new Map(variants.map(({ url, descriptor }) => [descriptor, url]))
  return fallback?.[3] === '512' && variants.length === 2 && byWidth.size === 2 &&
    byWidth.get('512w') === src &&
    byWidth.get('768w') === `${fallback[1]}${fallback[2]}-768.webp`
})
check('每个卡面均以 512w WebP 作 fallback，且 srcset 配对 512/768w',
  pairedCardVariants.length === 17 && pairedCardVariants.length === cardVariants.size && eachCardHas512FallbackAndPairedSrcset)
check('卡面 src 未回退到原始大图',
  optimizedCardTags.length === 19 && cardTagDetails.every(({ src }) => /^\.\/assets\/(?:optimized\/cards\/)?[^/]+-512\.webp$/i.test(src)))

let cardFilesValid = optimizedCardRefs.length > 0
let alphaChannelsExact = optimizedCardRefs.length > 0
let alphaSourceCount = 0
for (const { url, match } of optimizedCardRefs) {
  const [, basename, widthText] = match
  const width = Number(widthText)
  const outputPath = resolveDistAsset(url)
  const sourcePath = findCardSource(basename)
  if (!outputPath || !existsSync(outputPath) || !sourcePath) {
    cardFilesValid = false
    alphaChannelsExact = false
    continue
  }

  try {
    const [sourceMeta, outputMeta] = await Promise.all([
      sharp(sourcePath).metadata(),
      sharp(outputPath).metadata(),
    ])
    const formatAndSizeValid = outputMeta.format === 'webp' && outputMeta.width === width &&
      outputMeta.height === Math.round(sourceMeta.height * width / sourceMeta.width) &&
      Boolean(sourceMeta.hasAlpha) === Boolean(outputMeta.hasAlpha) &&
      statSync(outputPath).size < statSync(sourcePath).size
    if (!formatAndSizeValid) cardFilesValid = false

    if (sourceMeta.hasAlpha) {
      alphaSourceCount++
      const [expectedAlpha, outputAlpha] = await Promise.all([
        sharp(sourcePath).resize({ width }).ensureAlpha().extractChannel(3).raw().toBuffer(),
        sharp(outputPath).ensureAlpha().extractChannel(3).raw().toBuffer(),
      ])
      if (!expectedAlpha.equals(outputAlpha)) alphaChannelsExact = false
    }
  } catch {
    cardFilesValid = false
    alphaChannelsExact = false
  }
}
check('引用的卡面 WebP 存在、尺寸正确且小于原图', cardFilesValid)
check('透明卡面的 alpha 通道逐像素无损', alphaChannelsExact && alphaSourceCount > 0)
const cardBytesByWidth = new Map([512, 768].map((width) => [width,
  optimizedCardRefs
    .filter(({ match }) => Number(match?.[2]) === width)
    .reduce((total, { url }) => {
      const outputPath = resolveDistAsset(url)
      return total + (outputPath && existsSync(outputPath) ? statSync(outputPath).size : 0)
    }, 0),
]))
for (const [width, budget] of CARD_OUTPUT_BUDGETS) {
  check(`${width}w 卡面总传输素材 ≤ ${budget} B`, cardBytesByWidth.get(width) <= budget,
    `${cardBytesByWidth.get(width)} B`)
}

const splashRef = [...localWebpRefs].find((url) => /(?:^|\/)blendproof-splash\.webp(?:[?#]|$)/i.test(url))
let splashValid = false
if (splashRef) {
  const splashOutput = resolveDistAsset(splashRef)
  const splashSource = join(cwd, 'public/blendproof-splash-v2.jpg')
  if (splashOutput && existsSync(splashOutput) && existsSync(splashSource)) {
    try {
      const [sourceMeta, outputMeta] = await Promise.all([
        sharp(splashSource).metadata(),
        sharp(splashOutput).metadata(),
      ])
      splashValid = outputMeta.format === 'webp' &&
        outputMeta.width === sourceMeta.width && outputMeta.height === sourceMeta.height &&
        Boolean(outputMeta.hasAlpha) === Boolean(sourceMeta.hasAlpha) &&
        statSync(splashOutput).size < statSync(splashSource).size &&
        statSync(splashOutput).size <= SPLASH_OUTPUT_BUDGET
    } catch { /* reported by the check below */ }
  }
}
check('首屏 WebP 存在、尺寸不变且小于 JPEG 原图', splashValid)

console.log('\n11. 懒加载与卡片加载态')
const cardImagesUseLazyDecode = optimizedCardTags.length === 19 &&
  optimizedCardTags.every((tag) => /(?:^|\s)loading\s*=\s*["']lazy["']/i.test(tag) && /(?:^|\s)decoding\s*=\s*["']async["']/i.test(tag))
const tarotDeckTag = html.match(/<div\b[^>]*\bid\s*=\s*["']tarot-deck["'][^>]*>/i)?.[0] || ''
const tarotLoadingTag = html.match(/<div\b[^>]*\bid\s*=\s*["']tarot-loading["'][^>]*>/i)?.[0] || ''
check('19 个卡面图均使用原生 lazy loading 与 async decoding', cardImagesUseLazyDecode)
const intendedSizes = '(min-width: 1240px) 260px, (min-width: 810px) 21vw, 170px'
check('卡面 sizes 与桌面/平板/移动端显示宽度匹配',
  cardTagDetails.length === 19 && optimizedCardTags.every((tag) => getAttribute(tag, 'sizes') === intendedSizes))
check('首次身份面板并行提升卡面加载优先级', /\.loading=["']eager["']/.test(js))
check('卡组初始 aria-busy 且有 live loading 状态',
  /\baria-busy\s*=\s*["']true["']/i.test(tarotDeckTag) &&
  /\brole\s*=\s*["']status["']/i.test(tarotLoadingTag) &&
  /\baria-live\s*=\s*["']polite["']/i.test(tarotLoadingTag))
check('卡片 loading 样式与图像 decode 完成处理存在',
  html.includes('.tarot-unit.is-loading') && js.includes('aria-busy') && js.includes('aria-disabled') && js.includes('decode'))
check('卡面加载失败时保持入口禁用并提供重试路径',
  tarotSource.includes('cardsReady = failedCount === 0') &&
  tarotSource.includes('button.disabled = !cardsReady') &&
  html.includes('id="tarot-retry"'))
check('Hero 3D 状态按钮仅在 3D 初始化成功后显示',
  /class\s*=\s*["']hero3d__states["'][^>]*\bhidden\b/i.test(html) &&
  html.includes('.hero3d__states[hidden]') && /removeAttribute\(["']hidden["']\)/.test(js))
check('Hero 3D 延迟初始化具备 API fallback 与有限重试',
  landingMainSource.includes("typeof IntersectionObserver === 'function'") &&
  landingMainSource.includes("typeof MutationObserver === 'function'") &&
  landingMainSource.includes('attempts >= 2'))

console.log(`\n${fail === 0 ? '✓ 全部通过' : `✗ ${fail} 项失败`}`)
process.exit(fail)
