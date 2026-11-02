import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'

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
    assert.match(readFileSync(calls, 'utf8'), /npm:run verify:production:token=unset:account=unset/)

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
