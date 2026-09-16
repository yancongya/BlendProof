#!/usr/bin/env node
/**
 * 架构规则校验（零依赖）。
 *
 * 校验 docs/ARCHITECTURE_RULES.md 的强制约定：
 *   1. 依赖方向 app → pages → features → shared，禁止反向
 *   2. feature 之间禁止互相 import
 *   3. 跨 feature 引用必须走 features/<name>/index.ts
 *   4. 文件行数不超过硬上限（存量例外见 EXCEPTIONS）
 *
 * 用法：npm run check:arch
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()

/** 目标目录（新架构），按业务域自治 */
const FEATURES_DIR = 'src/features'
const SHARED_DIR = 'src/shared'
const APP_DIR = 'src/app'
const PAGES_DIR = 'src/pages'
/** 待迁移的存量目录：不参与行数校验，但参与依赖方向校验 */
const LEGACY_DIRS = ['src/components', 'src/start', 'src/workspace', 'src/review', 'src/api', 'src/i18n']
/** 额外扫描的源目录（仅行数校验） */
const EXTRA_SCAN_DIRS = ['landing/src']

/**
 * 存量超预算文件：只减不增。与 docs/ARCHITECTURE_RULES.md §6 保持同步。
 * 仅需登记「已纳入行数校验且当前超预算」的文件；存量目录（LEGACY_DIRS）在校验范围外，无需登记。
 */
const SIZE_EXCEPTIONS = new Set([
  'src/pages/WorkspacePage.tsx',
  'src/pages/SharePage.tsx',
  'landing/src/main.ts',
  'landing/src/i18n.ts',
  'landing/src/hero3d.ts',
])

/** 行数硬上限，按文件路径模式匹配（先匹配到的生效） */
const BUDGETS = [
  { test: /(^|\/)index\.tsx?$/, max: 60, label: '桶文件' },
  { test: /^src\/features\/[^/]+\/hooks\/use[^/]*\.tsx?$/, max: 150, label: 'hook' },
  { test: /^src\/features\/[^/]+\/components\/[^/]+\.tsx?$/, max: 200, label: 'feature 组件' },
  { test: /^src\/features\/[^/]+\/.+\.tsx?$/, max: 300, label: 'feature 模块' },
  { test: /^src\/pages\/[^/]+\.tsx?$/, max: 250, label: '页面' },
  { test: /^src\/(app|shared)\/.+\.tsx?$/, max: 300, label: 'app/shared' },
  { test: /^landing\/src\/[^/]+\.ts$/, max: 250, label: '落地页模块' },
]

const IMPORT_PATTERNS = [
  /(?:^|\n)\s*import\s[^;'"]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*export\s[^;'"]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const errors = []
const warnings = []

/** 把绝对路径转成仓库相对路径（POSIX 分隔符） */
function toRel(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/')
}

/** 解析一个仓库相对路径所属的「域」 */
function zoneOf(rel) {
  if (rel === APP_DIR || rel.startsWith(`${APP_DIR}/`)) return { kind: 'app' }
  if (rel === PAGES_DIR || rel.startsWith(`${PAGES_DIR}/`)) return { kind: 'pages' }
  if (rel === SHARED_DIR || rel.startsWith(`${SHARED_DIR}/`)) return { kind: 'shared' }
  if (rel.startsWith(`${FEATURES_DIR}/`)) {
    const name = rel.slice(FEATURES_DIR.length + 1).split('/')[0]
    return name ? { kind: 'feature', name } : { kind: 'legacy', dir: 'src' }
  }
  for (const dir of LEGACY_DIRS) {
    if (rel === dir || rel.startsWith(`${dir}/`)) return { kind: 'legacy', dir }
  }
  return { kind: 'legacy', dir: rel.split('/')[0] }
}

/** 该文件是否位于新架构目录内（决定是否做行数校验） */
function inNewArchitecture(rel) {
  return (
    rel.startsWith(`${FEATURES_DIR}/`) ||
    rel.startsWith(`${SHARED_DIR}/`) ||
    rel.startsWith(`${APP_DIR}/`) ||
    rel.startsWith(`${PAGES_DIR}/`)
  )
}

/** 递归收集源文件 */
async function collect(dir, out = []) {
  let entries
  try {
    entries = await readdir(path.join(ROOT, dir), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) await collect(rel, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(rel)
  }
  return out
}

/** 从源码文本中提取 import / export-from 的模块说明符 */
function extractSpecifiers(text) {
  const found = new Set()
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) found.add(match[1])
  }
  return [...found]
}

/**
 * 把相对说明符按 bundler 语义解析为「磁盘上真实存在的」仓库相对路径。
 * 非相对（裸包名）或解析不到实际文件时返回 null —— 宁可漏报也不误报。
 */
async function resolveSpecifier(fromRel, spec) {
  if (!spec.startsWith('.')) return null
  const baseDir = path.posix.dirname(fromRel)
  const base = path.posix.normalize(path.posix.join(baseDir, spec))
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]
  for (const candidate of candidates) {
    try {
      const info = await stat(path.join(ROOT, candidate))
      if (info.isFile()) return candidate
    } catch {
      // 继续尝试下一个候选
    }
  }
  return null
}

async function checkImportDirection(fromRel, spec) {
  const targetRel = await resolveSpecifier(fromRel, spec)
  if (!targetRel) return

  const fromZone = zoneOf(fromRel)
  const targetZone = zoneOf(targetRel)
  const targetLabel =
    targetZone.kind === 'feature' ? `features/${targetZone.name}` : `${targetZone.kind}/`

  // 规则 1：shared 是最底层，不得依赖任何上层
  if (fromZone.kind === 'shared' && ['feature', 'pages', 'app'].includes(targetZone.kind)) {
    errors.push(`[依赖方向] ${fromRel}\n    shared/ 不得依赖 ${targetLabel}：${spec}`)
  }
  // 规则 1：features 不得依赖页面与装配层
  if (fromZone.kind === 'feature' && ['pages', 'app'].includes(targetZone.kind)) {
    errors.push(`[依赖方向] ${fromRel}\n    features/ 不得依赖 ${targetLabel}：${spec}`)
  }

  // 规则 2：feature 之间禁止直接互引
  if (
    fromZone.kind === 'feature' &&
    targetZone.kind === 'feature' &&
    fromZone.name !== targetZone.name
  ) {
    errors.push(
      `[跨域引用] ${fromRel}\n    features/${fromZone.name} 不得直接 import ${targetLabel}：${spec}\n    协作方式：无业务语义的能力提到 shared/，有业务语义的由 pages/ 编排`,
    )
  }

  // 规则 3：从 feature 外部引用，必须走该 feature 的 index 出口
  if (targetZone.kind === 'feature') {
    const insideSameFeature = fromZone.kind === 'feature' && fromZone.name === targetZone.name
    const indexFiles = [
      `${FEATURES_DIR}/${targetZone.name}/index.ts`,
      `${FEATURES_DIR}/${targetZone.name}/index.tsx`,
    ]
    if (!insideSameFeature && !indexFiles.includes(targetRel)) {
      const alias = path.posix.relative(
        path.posix.dirname(fromRel),
        `${FEATURES_DIR}/${targetZone.name}`,
      )
      errors.push(
        `[深引用] ${fromRel}\n    必须通过 features/${targetZone.name} 的 index 出口引用，当前为：${spec}\n    建议写法：from '${alias.startsWith('.') ? alias : `./${alias}`}'`,
      )
    }
  }
}

function checkSize(rel, lineCount) {
  const inScope =
    inNewArchitecture(rel) || EXTRA_SCAN_DIRS.some((dir) => rel.startsWith(`${dir}/`))
  if (!inScope) return

  const budget = BUDGETS.find((entry) => entry.test.test(rel))
  if (!budget) return
  if (lineCount <= budget.max) return

  if (SIZE_EXCEPTIONS.has(rel)) {
    warnings.push(`${rel} — ${lineCount} 行（超 ${budget.label} 上限 ${budget.max}，待拆解）`)
    return
  }
  errors.push(`[行数超限] ${rel} — ${lineCount} 行 > ${budget.max}（${budget.label}）`)
}

async function main() {
  const files = [
    ...(await collect('src')),
    ...(await Promise.all(EXTRA_SCAN_DIRS.map((dir) => collect(dir)))).flat(),
  ]

  for (const rel of files) {
    let text
    try {
      text = await readFile(path.join(ROOT, rel), 'utf8')
    } catch {
      continue
    }
    const lineCount = text.split('\n').length
    checkSize(rel, lineCount)

    for (const spec of extractSpecifiers(text)) {
      await checkImportDirection(rel, spec)
    }
  }

  if (warnings.length > 0) {
    console.log('\n存量例外（计划内，非违规）：')
    for (const w of warnings) console.log(`  · ${w}`)
  }

  if (errors.length > 0) {
    console.error(`\n架构校验失败：${errors.length} 项\n`)
    for (const e of errors) console.error(`  ${e}\n`)
    console.error('规则详见 docs/ARCHITECTURE_RULES.md\n')
    process.exit(1)
  }

  console.log(`\n架构校验通过（扫描 ${files.length} 个文件）\n`)
}

main().catch((reason) => {
  console.error(reason)
  process.exit(1)
})
