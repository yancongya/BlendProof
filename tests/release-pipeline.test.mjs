import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('发布门禁必须先构建当前产物，再运行依赖静态资源的 Worker 路由测试', () => {
  const steps = read('scripts/verify-release.sh').split('\n').filter((line) => line.startsWith('run_step '))
  const build = steps.findIndex((line) => line.endsWith('npm run build'))
  const worker = steps.findIndex((line) => line.endsWith('npm run test:worker'))
  assert.ok(build >= 0 && worker > build, 'Worker 测试不得依赖旧 dist 或未构建的 checkout')
  const landing = steps.findIndex((line) => line.endsWith('npm run test:landing:built'))
  assert.ok(landing > build, '落地页测试应检查本次完整构建，避免重复构建')
  assert.equal(steps.length, 11)
  assert.ok(steps.at(-1).endsWith('npm run verify:release-assets'))
})

test('本地部署保留显式授权闸门，CI production job 显式提供授权', () => {
  const deploy = read('scripts/deploy-production.sh')
  assert.match(deploy, /BLENDPROOF_PRODUCTION_APPROVED:-/)
  assert.ok(deploy.indexOf('exit 2') < deploy.indexOf('npm run verify:release'))
  assert.match(deploy, /env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID npm run verify:release/)
  assert.match(deploy, /npx wrangler deploy --keep-vars/)
  const workflow = read('.github/workflows/deploy.yml')
  assert.match(workflow, /environment: production/)
  assert.match(workflow, /workflow_dispatch:[\s\S]*approve_production:[\s\S]*type: choice/)
  assert.match(workflow, /BLENDPROOF_PRODUCTION_APPROVED: \$\{\{ inputs\.approve_production \}\}/)
  assert.doesNotMatch(workflow, /push:\s*\n\s+branches: \[main\]/)
  assert.match(workflow, /\[ -z "\$CLOUDFLARE_API_TOKEN" \] \|\| \[ -z "\$CLOUDFLARE_ACCOUNT_ID" \]/)
  assert.doesNotMatch(workflow, /name: Verify and build/)
  assert.match(workflow, /npm run deploy:production/)
  assert.match(workflow, /Production deployment requires the explicit YES input/)
})

test('部署脚本缺少授权时拒绝运行门禁与 Wrangler；已授权时门禁读不到凭据', () => {
  const bin = mkdtempSync(join(tmpdir(), 'blendproof-deploy-test-'))
  const calls = join(bin, 'calls.log')
  const npm = join(bin, 'npm')
  const npx = join(bin, 'npx')
  writeFileSync(npm, `#!/bin/sh\nprintf 'npm:%s:token=%s:account=%s\\n' "$*" "\${CLOUDFLARE_API_TOKEN-unset}" "\${CLOUDFLARE_ACCOUNT_ID-unset}" >> "$CALL_LOG"\nexit "\${MOCK_NPM_EXIT:-0}"\n`)
  writeFileSync(npx, `#!/bin/sh\nprintf 'npx:%s:token=%s:account=%s\\n' "$*" "\${CLOUDFLARE_API_TOKEN-unset}" "\${CLOUDFLARE_ACCOUNT_ID-unset}" >> "$CALL_LOG"\n`)
  chmodSync(npm, 0o755)
  chmodSync(npx, 0o755)
  try {
    const baseEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: calls, BLENDPROOF_PRODUCTION_APPROVED: '', MOCK_NPM_EXIT: '0', CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' }
    const denied = spawnSync('bash', ['scripts/deploy-production.sh'], { cwd: process.cwd(), env: baseEnv, encoding: 'utf8' })
    assert.equal(denied.status, 2)
    assert.equal(existsSync(calls), false, 'unauthorized deployment must not invoke npm or Wrangler')

    const authorized = spawnSync('bash', ['scripts/deploy-production.sh'], {
      cwd: process.cwd(),
      env: { ...baseEnv, BLENDPROOF_PRODUCTION_APPROVED: 'YES', CLOUDFLARE_API_TOKEN: 'test-token', CLOUDFLARE_ACCOUNT_ID: 'test-account' },
      encoding: 'utf8',
    })
    assert.equal(authorized.status, 0, authorized.stderr)
    assert.match(readFileSync(calls, 'utf8'), /npm:run verify:release:token=unset:account=unset/)
    assert.match(readFileSync(calls, 'utf8'), /npx:wrangler deploy --keep-vars:token=test-token:account=test-account/)
    assert.match(readFileSync(calls, 'utf8'), /npm:run verify:production -- --settle-ms 8000:token=unset:account=unset/)

    writeFileSync(calls, '')
    const gateFailure = spawnSync('bash', ['scripts/deploy-production.sh'], {
      cwd: process.cwd(),
      env: { ...baseEnv, BLENDPROOF_PRODUCTION_APPROVED: 'YES', CLOUDFLARE_API_TOKEN: 'test-token', CLOUDFLARE_ACCOUNT_ID: 'test-account', MOCK_NPM_EXIT: '42' },
      encoding: 'utf8',
    })
    assert.equal(gateFailure.status, 42)
    assert.equal(readFileSync(calls, 'utf8'), 'npm:run verify:release:token=unset:account=unset\n')
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
})

test('官方与自托管示例必须复用相同的静态入口契约', () => {
  const assets = (file) => {
    const parsed = ts.parseConfigFileTextToJson(file, read(file))
    assert.equal(parsed.error, undefined)
    return parsed.config.assets
  }
  assert.deepEqual(assets('wrangler.self-host.example.jsonc'), assets('wrangler.jsonc'))
})

test('app-only public 刷新在新目录可用，覆盖只读文件但不删除 landing', async () => {
  const fs = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { createRequire } = await import('node:module')
  const { runInNewContext } = await import('node:vm')
  const root = fs.mkdtempSync(join(tmpdir(), 'blendproof-app-build-'))
  try {
    fs.mkdirSync(join(root, 'public'))
    fs.mkdirSync(join(root, 'dist/landing'), { recursive: true })
    fs.writeFileSync(join(root, 'public/intro.mp4'), 'first video')
    fs.chmodSync(join(root, 'public/intro.mp4'), 0o444)
    fs.writeFileSync(join(root, 'dist/landing/index.html'), 'keep landing')
    const source = ts.transpileModule(read('vite.config.ts'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText
    const module = { exports: {} }
    const require = createRequire(import.meta.url)
    runInNewContext(source, {
      module, exports: module.exports,
      process: { cwd: () => root, env: { BLENDPROOF_PRESERVE_DIST: '1' } },
      require: (id) => id === 'vite' ? { defineConfig: (config) => config }
        : id === '@vitejs/plugin-react' ? () => ({ name: 'react-test-stub' }) : require(id),
    })
    const config = module.exports.default
    assert.equal(config.build.emptyOutDir, false)
    const plugin = config.plugins.find((entry) => entry.name === 'blendproof:refresh-public-on-app-build')
    assert.ok(plugin, 'preserved app builds must still refresh public assets')
    plugin.closeBundle()
    assert.equal(fs.readFileSync(join(root, 'dist/intro.mp4'), 'utf8'), 'first video')
    fs.chmodSync(join(root, 'public/intro.mp4'), 0o644)
    fs.writeFileSync(join(root, 'public/intro.mp4'), 'new video')
    fs.chmodSync(join(root, 'public/intro.mp4'), 0o444)
    plugin.closeBundle()
    assert.equal(fs.readFileSync(join(root, 'dist/intro.mp4'), 'utf8'), 'new video')
    assert.equal(fs.readFileSync(join(root, 'dist/landing/index.html'), 'utf8'), 'keep landing')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function releaseBin(t) {
  const bin = mkdtempSync(join(tmpdir(), 'blendproof-actions-release-'))
  t.after(() => rmSync(bin, { recursive: true, force: true }))
  const calls = join(bin, 'calls.log')
  writeFileSync(join(bin, 'git'), `#!/bin/sh
printf 'git:%s\n' "$*" >> "$CALL_LOG"
case "$1 $2" in
  "rev-parse --abbrev-ref") printf '%s\n' "$FAKE_BRANCH" ;;
  "rev-parse HEAD") printf '%s\n' "$FAKE_LOCAL" ;;
  "status --porcelain") printf '%s' "$FAKE_DIRTY" ;;
  "ls-remote origin") printf '%s\trefs/heads/%s\n' "$FAKE_REMOTE" "$FAKE_BRANCH" ;;
esac
`)
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
printf 'gh:%s\n' "$*" >> "$CALL_LOG"
case "$*" in
  *"--log-failed"*) printf 'fake failed log\n' ;;
  *"run list"*"--limit 1"*) printf '%s\n' "$FAKE_BEFORE" ;;
  *"run list"*) printf '%s\n' "$FAKE_RUN_ID" ;;
  *"run view"*"conclusion"*) printf '%s\n' "$FAKE_CONCLUSION" ;;
  *"run view"*) printf '%s\n' "$FAKE_STATUS" ;;
esac
`)
  writeFileSync(join(bin, 'npm'), `#!/bin/sh
printf 'npm:%s\n' "$*" >> "$CALL_LOG"
exit "$MOCK_NPM_EXIT"
`)
  for (const name of ['git', 'gh', 'npm']) chmodSync(join(bin, name), 0o755)
  const sha = (c) => c.repeat(40)
  return {
    calls,
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: calls, MOCK_NPM_EXIT: '0',
      BLENDPROOF_ACTIONS_POLL_SECONDS: '0', FAKE_BEFORE: '111', FAKE_RUN_ID: '222',
      FAKE_STATUS: 'completed', FAKE_CONCLUSION: 'completed:success',
      FAKE_BRANCH: 'codex/release-test', FAKE_LOCAL: sha('a'), FAKE_REMOTE: sha('a'), FAKE_DIRTY: '',
    },
  }
}

function runActionsRelease(env, args = []) {
  return spawnSync('bash', ['scripts/deploy-via-actions.sh', ...args], { cwd: process.cwd(), env, encoding: 'utf8' })
}

test('Actions 发布脚本未授权或授权值错误时不触发 CI', (t) => {
  for (const approved of ['', 'NO', 'yes']) {
    const { calls, env } = releaseBin(t)
    const result = runActionsRelease({ ...env, BLENDPROOF_PRODUCTION_APPROVED: approved })
    assert.equal(result.status, 2, approved)
    assert.equal(existsSync(calls), false, 'unauthorized Actions release must not invoke git or gh')
  }
})

test('Actions 发布脚本在工作区脏或远端不同步时拒绝触发', (t) => {
  const dirty = releaseBin(t)
  const dirtyRun = runActionsRelease({ ...dirty.env, BLENDPROOF_PRODUCTION_APPROVED: 'YES', FAKE_DIRTY: ' M README.md' })
  assert.equal(dirtyRun.status, 2)
  assert.equal(readFileSync(dirty.calls, 'utf8').includes('gh:'), false, 'dirty worktree must not trigger CI')

  const stale = releaseBin(t)
  const staleRun = runActionsRelease({ ...stale.env, BLENDPROOF_PRODUCTION_APPROVED: 'YES', FAKE_REMOTE: 'b'.repeat(40) })
  assert.equal(staleRun.status, 2)
  assert.match(staleRun.stderr, /不一致/)
  assert.equal(readFileSync(stale.calls, 'utf8').includes('gh:'), false, 'unpushed HEAD must not trigger CI')

  const missing = releaseBin(t)
  const missingRun = runActionsRelease({ ...missing.env, BLENDPROOF_PRODUCTION_APPROVED: 'YES', FAKE_REMOTE: '' })
  assert.equal(missingRun.status, 2)
  assert.equal(readFileSync(missing.calls, 'utf8').includes('gh:'), false)
})

test('Actions 发布脚本授权且同步时只触发一次并做只读线上验收', (t) => {
  const { calls, env } = releaseBin(t)
  const result = runActionsRelease({ ...env, BLENDPROOF_PRODUCTION_APPROVED: 'YES' })
  assert.equal(result.status, 0, result.stderr)
  const log = readFileSync(calls, 'utf8')
  const triggers = log.split('\n').filter((line) => line.startsWith('gh:workflow run'))
  assert.deepEqual(triggers, ['gh:workflow run deploy.yml --ref codex/release-test -f approve_production=YES'])
  assert.match(log, /npm:run verify:production -- --routes-only/)
  assert.equal(log.includes('npm:run verify:release'), false, 'CI already runs the gate; the wrapper must not repeat it')
})

test('Actions 发布脚本在 CI 失败或等待审批时传播状态且不做验收', (t) => {
  const failed = releaseBin(t)
  const failedRun = runActionsRelease({ ...failed.env, BLENDPROOF_PRODUCTION_APPROVED: 'YES', FAKE_CONCLUSION: 'completed:failure' })
  assert.equal(failedRun.status, 4)
  assert.equal(readFileSync(failed.calls, 'utf8').includes('npm:run verify:production'), false)

  const waiting = releaseBin(t)
  const waitingRun = runActionsRelease({ ...waiting.env, BLENDPROOF_PRODUCTION_APPROVED: 'YES', FAKE_STATUS: 'waiting' })
  assert.equal(waitingRun.status, 3)
  assert.match(waitingRun.stderr, /required reviewers/)
  assert.equal(readFileSync(waiting.calls, 'utf8').includes('npm:run verify:production'), false)
})

// A fixture that mimics the live route contract. Tests must await child
// processes: spawnSync would block this event loop, so an in-process server
// could never answer (that showed up as a 45s timeout, not a product bug).
async function startLiveFixture(t, { failTimes = 0 } = {}) {
  const { createServer } = await import('node:http')
  const html = (res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<html>landing</html>') }
  const js = (res, body) => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(body) }
  const json = (res, data) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
  const notFound = (res) => { res.writeHead(404).end('nope') }
  let flakyHits = 0
  const routes = {
    '/': html, '/landing/': html, '/dev': html, '/dev/': html,
    '/does-not-exist': notFound, '/landing/assets/missing-release-check.webp': notFound,
    '/api/health': (res) => json(res, { runtime: 'cloudflare-worker', database: { bound: true }, objectStorage: { bound: true } }),
    '/api/public/stats': (res) => json(res, { capacityBytes: 5368709120, usedBytes: 1 }),
    '/landing/app.js': (res) => js(res, 'import("./assets/hero3d-live9f3.js")'),
    '/landing/assets/blendproof-splash.webp': (res) => { res.writeHead(200, { 'content-type': 'image/webp' }); res.end('webp') },
    '/landing/assets/hero3d-live9f3.js': (res) => js(res, 'three'),
    // Stands in for edge propagation: transient failures, then a healthy route.
    '/s/suzanne': (res) => {
      flakyHits += 1
      if (flakyHits <= failTimes) { res.writeHead(503, { 'content-type': 'text/plain' }); res.end('propagating'); return }
      html(res)
    },
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/landing' && url.search === '?utm_source=release') {
      res.writeHead(308, { location: '/landing/?utm_source=release' }).end()
      return
    }
    const handler = routes[url.pathname]
    if (handler) handler(res)
    else notFound(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  return { origin: `http://127.0.0.1:${server.address().port}`, hits: () => flakyHits }
}

async function runVerify(cwd, args) {
  const script = fileURLToPath(new URL('../scripts/verify-production.mjs', import.meta.url))
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  try {
    const { stdout, stderr } = await promisify(execFile)('node', [script, ...args], { cwd, timeout: 90000, maxBuffer: 8 * 1024 * 1024 })
    return { status: 0, stdout, stderr }
  } catch (error) {
    return { status: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error) }
  }
}

test('verify:production 的 routes-only 模式无需本地 dist 即可完成 13 项线上验收', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'blendproof-verify-routes-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const { origin } = await startLiveFixture(t)

  // No dist in this cwd: hash-compare must refuse, routes-only must still pass.
  const strict = await runVerify(cwd, ['--origin', origin])
  assert.notEqual(strict.status, 0)
  assert.match(strict.stderr, /Build the current release before verification/)

  const routesRun = await runVerify(cwd, ['--routes-only', '--origin', origin])
  assert.equal(routesRun.status, 0, routesRun.stderr)
  assert.match(routesRun.stdout, /HTTP verification: 13\/13/)
  assert.equal(routesRun.stdout.split('\n').filter((line) => line.startsWith('FAIL')).length, 0)

  const reportFile = readdirSync(join(cwd, 'output/releases')).map((f) => join(cwd, 'output/releases', f))[0]
  const report = JSON.parse(readFileSync(reportFile, 'utf8'))
  assert.equal(report.mode, 'routes-only')
  assert.equal(report.ok, true)
  // Hashes are recorded for live artifacts but never compared to a build.
  assert.equal(report.results.every((r) => r.expectedHash === undefined), true)
  assert.equal(report.results.find((r) => r.path.endsWith('hero3d-live9f3.js')).attempts[0].sha256.length, 64)

  const unreachable = await runVerify(cwd, ['--routes-only', '--origin', 'http://127.0.0.1:65500'])
  assert.notEqual(unreachable.status, 0)
  assert.match(unreachable.stderr, /Cannot reach http:\/\/127.0.0.1:65500\/landing\/app\.js/)
})

test('边缘传播期的瞬时失败由有界退避恢复，不把健康发布判为失败', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'blendproof-verify-flaky-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const { origin, hits } = await startLiveFixture(t, { failTimes: 2 })

  const result = await runVerify(cwd, ['--routes-only', '--origin', origin, '--backoff-ms', '10,20,30'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /HTTP verification: 13\/13/)
  assert.match(result.stdout, /PASS \/s\/suzanne \(3 attempt/)
  assert.equal(hits(), 3, 'recovery must stop retrying once the route is healthy')

  const report = JSON.parse(readFileSync(readdirSync(join(cwd, 'output/releases')).map((f) => join(cwd, 'output/releases', f))[0], 'utf8'))
  const suzanne = report.results.find((r) => r.path === '/s/suzanne')
  assert.equal(suzanne.ok, true)
  assert.deepEqual(suzanne.attempts.map((a) => a.ok), [false, false, true])
  assert.deepEqual(suzanne.attempts.map((a) => a.status), [503, 503, 200])
  assert.deepEqual(report.backoffMs, [10, 20, 30])
  assert.equal(report.attemptsAllowed, 4)
})

test('持续失败按上限耗尽尝试并如实失败，不无限重试', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'blendproof-verify-persistent-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const { origin, hits } = await startLiveFixture(t, { failTimes: 99 })

  const result = await runVerify(cwd, ['--routes-only', '--origin', origin, '--backoff-ms', '5,5'])
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /FAIL \/s\/suzanne \(3 attempt/)
  assert.match(result.stdout, /HTTP verification: 12\/13/)
  assert.equal(hits(), 3, 'attempts must equal backoff entries + 1, then stop')
})

test('拒绝无效的退避与等待参数', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'blendproof-verify-args-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  for (const args of [['--settle-ms', 'abc'], ['--settle-ms', '-1'], ['--backoff-ms', '1,x'], ['--backoff-ms', '999999']]) {
    const result = await runVerify(cwd, ['--routes-only', '--origin', 'http://127.0.0.1:65500', ...args])
    assert.notEqual(result.status, 0, args.join(' '))
    assert.match(result.stderr, /requires/, args.join(' '))
  }
})

test('Actions 发布入口在 package.json 与协作文档中登记', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts['deploy:actions'], 'bash scripts/deploy-via-actions.sh')
  assert.match(read('AGENTS.md'), /deploy:actions/)
  assert.match(read('docs/PERFORMANCE_RELEASE_WORKFLOW.md'), /deploy:actions/)
  assert.match(read('README.md'), /deploy:actions/)
  assert.match(read('README.zh.md'), /deploy:actions/)
})
