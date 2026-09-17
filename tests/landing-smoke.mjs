/**
 * 落地页冒烟测试
 * 用法：npm run build:landing && node /tmp/landing-smoke.mjs
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const cwd = process.cwd()
const DIST = join(cwd, 'dist/landing')

let fail = 0
const check = (name, ok, detail) => {
  if (ok) { console.log(`  ✓ ${name}`) }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++ }
}

console.log('=== 落地页冒烟测试 ===\n')

const htmlPath = join(DIST, 'index.html')
if (!existsSync(htmlPath)) { console.error(`✗ 找不到 ${htmlPath}`); process.exit(1) }
const html = readFileSync(htmlPath, 'utf-8')

// 读取所有 JS
const jsFiles = []
if (existsSync(DIST)) {
  for (const f of readdirSync(DIST)) if (f.endsWith('.js')) jsFiles.push(readFileSync(join(DIST, f), 'utf-8'))
  if (existsSync(join(DIST, 'assets')))
    for (const f of readdirSync(join(DIST, 'assets'))) if (f.endsWith('.js')) jsFiles.push(readFileSync(join(DIST, 'assets', f), 'utf-8'))
}
const js = jsFiles.join('\n')

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
check('browser height:200px', html.includes('quickstart__browser') && html.includes('height: 200px'))

console.log('\n8. JS 交互逻辑')
// initQuickstart 被混淆，用 CSS 类名检查：quickstart__step + is-active
check('quickstart__step 事件绑定', js.includes('quickstart__step'))
check('is-active 类切换', js.includes('is-active'))
check('复制文本含"BlendProof 分享"', js.includes('BlendProof 分享') && js.includes('提取码'))

console.log(`\n${fail === 0 ? '✓ 全部通过' : `✗ ${fail} 项失败`}`)
process.exit(fail)
