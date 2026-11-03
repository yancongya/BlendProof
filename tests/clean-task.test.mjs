import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TARGETS, planCleanup, quarantine, processGuard } from '../scripts/clean-task.mjs'

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'blendproof-clean-test-')))
  t.after(() => rmSync(base, { recursive: true, force: true })) // This test's synthetic fixtures only.
  const root = join(base, 'repo')
  mkdirSync(root)
  execFileSync('git', ['init', '-q', root])
  writeFileSync(join(root, '.gitignore'), 'dist/\ndist-worker/\nnode_modules/\ntsconfig.tsbuildinfo\noutput/\n')
  const put = (name, body = 'generated') => {
    mkdirSync(join(root, name, '..'), { recursive: true })
    writeFileSync(join(root, name), body)
  }
  put('dist/index.html')
  put('dist-worker/index.js')
  put('node_modules/.vite-temp/config.mjs')
  put('tsconfig.tsbuildinfo')
  return { base, root, put, trash: join(base, 'trash') }
}
const idle = () => null

function processFixture(root, command, extra = '') {
  return (bin, args) => {
    if (bin === 'ps') return { status: 0, stdout: `900001 1 ${command}\n${extra}`, stderr: '' }
    if (args.includes('cwd')) return { status: 0, stdout: `p900001\nn${root}\n`, stderr: '' }
    return { status: 1, stdout: '', stderr: '' }
  }
}

test('源码 Vite 与其 esbuild 不阻止闲置 dist 清理，但保留临时缓存', t => {
  const { root } = fixture(t)
  const guard = processGuard(root, processFixture(root, `node ${root}/node_modules/vite/bin/vite.js`, `900002 900001 ${root}/node_modules/@esbuild/bin/esbuild --service\n`))
  assert.equal(guard('dist'), null)
  assert.match(guard('node_modules/.vite-temp'), /Vite dev active/)
})

test('preview、build 和相对路径启动的 Worker 均阻止清理', t => {
  const { root } = fixture(t)
  for (const command of [`node ${root}/node_modules/vite/bin/vite.js preview`, `node ${root}/node_modules/vite/bin/vite.js build`, 'node node_modules/wrangler/bin/wrangler.js dev']) {
    assert.match(processGuard(root, processFixture(root, command))('dist'), /active/)
  }
})

test('进程检查权限不足时失败关闭', t => {
  const { root } = fixture(t)
  assert.throws(() => processGuard(root, () => ({ status: 1, stdout: '', stderr: 'Operation not permitted' })), /blocked/)
})

test('继承 cwd 的已知桌面工具不是项目服务，但仍检查候选打开文件', t => {
  const { root } = fixture(t)
  for (const command of ['node /external/cua-repl/bin/cua-repl.mjs', 'npm exec xcodebuildmcp@latest mcp', 'node /external/node_modules/.bin/xcodebuildmcp mcp']) {
    const run = processFixture(root, command)
    assert.equal(processGuard(root, run)('dist'), null)
    assert.equal(processGuard(root, (bin, args, options) => args.includes('+D')
      ? { status: 0, stdout: 'node has open file', stderr: '' } : run(bin, args, options))('dist'), 'Open files detected')
  }
})

test('清理白名单固定，dry-run 不修改文件', t => {
  const { root, put } = fixture(t)
  for (const path of ['storage/db', '.wrangler/state/db', 'output/report.json', 'node_modules/vite/index.js', 'public/model.glb', 'landing/assets/optimized/a.webp']) put(path)
  assert.deepEqual(planCleanup(root, idle).filter(x => x.state === 'ready').map(x => x.name), TARGETS)
  assert.ok(existsSync(join(root, 'dist/index.html')))
  assert.equal(existsSync(join(root, 'output/cleanup')), false)
})

test('移动到可恢复隔离目录并保留数据、依赖与验收报告', t => {
  const { root, put, trash } = fixture(t)
  for (const path of ['storage/db', '.wrangler/state/db', 'output/report.json', 'node_modules/vite/index.js', 'landing/assets/optimized/a.webp']) put(path)
  const report = quarantine(root, planCleanup(root, idle), trash, idle)
  assert.equal(report.entries.length, 4)
  assert.ok(report.movedBytes > 0)
  assert.ok(report.entries.every(x => x.state === 'moved' && existsSync(x.destination) && !existsSync(x.original)))
  assert.equal(JSON.parse(readFileSync(report.reportPath)).entries.length, 4)
  for (const path of ['storage/db', '.wrangler/state/db', 'output/report.json', 'node_modules/vite/index.js', 'landing/assets/optimized/a.webp']) assert.ok(existsSync(join(root, path)))
  assert.ok(planCleanup(root, idle).every(x => x.state === 'absent'))
})

test('受 Git 跟踪或不在 ignore 内的产物不会清理', t => {
  const { root } = fixture(t)
  execFileSync('git', ['add', '-f', 'dist/index.html'], { cwd: root })
  writeFileSync(join(root, '.gitignore'), 'dist/\nnode_modules/\ntsconfig.tsbuildinfo\n')
  const plan = planCleanup(root, idle)
  assert.match(plan.find(x => x.name === 'dist').reason, /tracked/)
  assert.match(plan.find(x => x.name === 'dist-worker').reason, /ignored/)
})

test('运行中目标跳过，清理前重新检查占用', t => {
  const { root, trash } = fixture(t)
  const plan = planCleanup(root, idle)
  const report = quarantine(root, plan, trash, () => 'active build')
  assert.equal(report.movedBytes, 0)
  assert.equal(report.skipped.length, 4)
  assert.ok(existsSync(join(root, 'dist/index.html')))
})

test('拒绝嵌套软链接和目标祖先软链接', t => {
  const { root, base } = fixture(t)
  symlinkSync(base, join(root, 'dist/external'))
  renameSync(join(root, 'node_modules'), join(base, 'modules'))
  symlinkSync(join(base, 'modules'), join(root, 'node_modules'))
  const plan = planCleanup(root, idle)
  assert.equal(plan.find(x => x.name === 'dist').state, 'skipped')
  assert.equal(plan.find(x => x.name === 'node_modules/.vite-temp').state, 'skipped')
})

test('旧扫描的 inode 改变时不移动替代目录', t => {
  const { root, put } = fixture(t)
  const plan = planCleanup(root, idle)
  renameSync(join(root, 'dist'), join(root, 'old-dist'))
  put('dist/new.html', 'replacement')
  const report = quarantine(root, plan, join(root, 'trash'), idle)
  assert.ok(!report.entries.some(x => x.name === 'dist'))
  assert.ok(existsSync(join(root, 'dist/new.html')))
})

test('拒绝软链接形式的废纸篓或报告目录', t => {
  const { root, base, trash } = fixture(t)
  symlinkSync(base, trash)
  assert.throws(() => quarantine(root, planCleanup(root, idle), trash, idle), /Symlink/)
  symlinkSync(base, join(root, 'output'))
  assert.throws(() => quarantine(root, planCleanup(root, idle), join(base, 'safe-trash'), idle), /Symlink/)
  assert.ok(existsSync(join(root, 'dist/index.html')))
})
