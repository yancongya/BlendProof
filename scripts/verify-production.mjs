import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const numberArg = (flag, fallback, max) => {
  const i = process.argv.indexOf(flag)
  if (i < 0) return fallback
  const value = Number(process.argv[i + 1])
  if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`${flag} requires a number between 0 and ${max}`)
  return value
}
// Edge propagation is not instant: probing immediately after `wrangler deploy`
// produced a false 12/13 on a healthy release. Settle first, then retry with a
// bounded backoff so a propagating edge is not reported as a failed release.
const DEFAULT_BACKOFF_MS = [3000, 8000, 15000]
const settleMs = numberArg('--settle-ms', 0, 120000)
const backoffArg = process.argv.indexOf('--backoff-ms')
const backoffMs = backoffArg < 0
  ? DEFAULT_BACKOFF_MS
  : String(process.argv[backoffArg + 1]).split(',').map((part) => {
      const value = Number(part)
      if (!Number.isFinite(value) || value < 0 || value > 120000) throw new Error('--backoff-ms requires comma-separated numbers between 0 and 120000')
      return value
    })
const originArg = process.argv.indexOf('--origin')
const origin = new URL(originArg < 0 ? (process.env.BLENDPROOF_PRODUCTION_ORIGIN ?? 'https://blendproof.itycon.cn') : process.argv[originArg + 1])
if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Supply an origin without credentials, path, query or fragment')
if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) throw new Error('Remote verification requires HTTPS')
// A GitHub Actions build runs on another platform, so its bytes need not match a
// local build. --routes-only verifies live routes, redirects, 404s and health
// fields while still recording artifact hashes/sizes, without requiring dist.
const routesOnly = process.argv.includes('--routes-only')
const dist = resolve('dist')
const hash = (body) => createHash('sha256').update(body).digest('hex')
let hero
if (routesOnly) {
  // Discover the deployed chunk name from the live bundle instead of local dist.
  let live
  try {
    live = await fetch(new URL('/landing/app.js', origin), { signal: AbortSignal.timeout(45000), headers: { 'Cache-Control': 'no-cache' } })
  } catch (error) {
    throw new Error(`Cannot reach ${origin.origin}/landing/app.js to discover the live Hero chunk (${error.name}: ${error.cause?.message ?? 'no detail'})`)
  }
  hero = (await live.text()).match(/hero3d-[\w.-]+\.js/)?.[0]
  if (!hero) throw new Error(`Cannot discover the live Hero chunk from /landing/app.js (HTTP ${live.status})`)
} else {
  // Report a missing or stale build as an actionable message, not a raw ENOENT.
  const assetRoot = resolve(dist, 'landing/assets')
  hero = existsSync(assetRoot) ? readdirSync(assetRoot).find((name) => /^hero3d-.*\.js$/.test(name)) : undefined
  if (!hero) throw new Error('Build the current release before verification')
}
const cases = [
  { path: '/', status: 200, file: 'landing/index.html', type: 'text/html' },
  { path: '/landing/', status: 200, file: 'landing/index.html', type: 'text/html' },
  { path: '/landing?utm_source=release', status: 308, location: '/landing/?utm_source=release' },
  ...['/dev', '/dev/', '/s/suzanne'].map((path) => ({ path, status: 200, file: 'index.html', type: 'text/html' })),
  { path: '/does-not-exist', status: 404 },
  { path: '/landing/assets/missing-release-check.webp', status: 404 },
  { path: '/api/health', status: 200, type: 'application/json', json: true },
  { path: '/api/public/stats', status: 200, type: 'application/json', json: true },
  { path: '/landing/app.js', status: 200, file: 'landing/app.js', type: 'javascript' },
  { path: '/landing/assets/blendproof-splash.webp', status: 200, file: 'landing/assets/blendproof-splash.webp', type: 'image/webp' },
  { path: `/landing/assets/${hero}`, status: 200, file: `landing/assets/${hero}`, type: 'javascript' },
]
async function verify(check) {
  const expectedHash = !routesOnly && check.file ? hash(readFileSync(resolve(dist, check.file))) : undefined
  const attempts = []
  // Bounded retries cover propagation/network transients; every result is retained.
  for (let n = 0; n <= backoffMs.length; n++) {
    if (n > 0) await new Promise((resolve) => setTimeout(resolve, backoffMs[n - 1]))
    const started = performance.now()
    try {
      const response = await fetch(new URL(check.path, origin), { redirect: 'manual', signal: AbortSignal.timeout(45000), headers: { 'Cache-Control': 'no-cache' } })
      const body = Buffer.from(await response.arrayBuffer())
      const actualHash = hash(body)
      const type = response.headers.get('content-type') ?? ''
      const location = response.headers.get('location')
      let ok = response.status === check.status && (!check.type || type.includes(check.type)) && (!expectedHash || actualHash === expectedHash)
      if (check.location) ok &&= new URL(location ?? '', origin).href === new URL(check.location, origin).href
      if (check.json) {
        const data = JSON.parse(body.toString())
        ok &&= check.path === '/api/health' ? data.database?.bound === true && data.objectStorage?.bound === true : Number.isFinite(data.capacityBytes)
      }
      attempts.push({ ok, status: response.status, contentType: type, location, decodedBodyBytes: body.length, sha256: actualHash, milliseconds: Math.round(performance.now() - started) })
      if (ok) return { path: check.path, expectedHash, ok: true, attempts }
    } catch (error) {
      attempts.push({ ok: false, error: error.name, milliseconds: Math.round(performance.now() - started) })
    }
  }
  return { path: check.path, expectedHash, ok: false, attempts }
}
if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs))
const results = []
for (let i = 0; i < cases.length; i += 4) results.push(...await Promise.all(cases.slice(i, i + 4).map(verify)))
const report = {
  timestamp: new Date().toISOString(),
  origin: origin.origin,
  mode: routesOnly ? 'routes-only' : 'hash-compare',
  settleMs,
  backoffMs,
  attemptsAllowed: backoffMs.length + 1,
  evidence: routesOnly
    ? 'Live HTTP routes, redirects, 404s, health fields and recorded artifact hashes; hashes are NOT compared against a local build, and this is not browser performance or business E2E'
    : 'HTTP responses and local build hashes; not browser performance or business E2E',
  ok: results.every((r) => r.ok),
  results,
}
const output = resolve('output/releases', `http-${Date.now()}.json`)
mkdirSync(resolve('output/releases'), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.path} (${result.attempts.length} attempt(s))`)
console.log(`HTTP verification: ${results.filter((r) => r.ok).length}/${results.length}; report: ${output}`)
process.exitCode = report.ok ? 0 : 1
