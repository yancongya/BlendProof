/**
 * Fixed-window limits for mutation endpoints that can be abused anonymously.
 * Keys are scoped before hashing, so D1 never stores a client IP, capability,
 * share token, or their reversible concatenation.
 */
export const rateLimitRules = {
  projectCreate: { scope: 'project-create-ip', limit: 5, windowSeconds: 60 * 60, includeNetwork: true },
  uploadIntent: { scope: 'upload-intent-owner', limit: 10, windowSeconds: 10 * 60, includeNetwork: false },
  passwordAttempt: { scope: 'share-password-ip', limit: 5, windowSeconds: 15 * 60, includeNetwork: true },
  guestComment: { scope: 'share-comment-ip', limit: 10, windowSeconds: 60, includeNetwork: true },
} as const

type RateLimitRule = (typeof rateLimitRules)[keyof typeof rateLimitRules]
type RateLimitEnv = { DB: D1Database; UPLOAD_SIGNING_SECRET: string }

export async function enforceRateLimit(
  request: Request,
  env: RateLimitEnv,
  rule: RateLimitRule,
  subject = '',
): Promise<Response | null> {
  if (typeof env.UPLOAD_SIGNING_SECRET !== 'string' || env.UPLOAD_SIGNING_SECRET.length < 32) {
    return Response.json({ error: '限流服务未配置。' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
  }
  const nowSeconds = Math.floor(Date.now() / 1000)
  const windowStart = Math.floor(nowSeconds / rule.windowSeconds) * rule.windowSeconds
  const windowEnd = windowStart + rule.windowSeconds
  const network = rule.includeNetwork ? clientNetwork(request) : ''
  const keyHash = await hmacSha256(env.UPLOAD_SIGNING_SECRET, `${rule.scope}\n${subject}\n${network}`)
  const updatedAt = new Date().toISOString()
  const result = await env.DB.prepare(`INSERT INTO rate_limit_windows
    (scope, key_hash, window_start, count, expires_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(scope, key_hash, window_start) DO UPDATE SET
      count = rate_limit_windows.count + 1,
      updated_at = excluded.updated_at
    WHERE rate_limit_windows.count < ?
    RETURNING count`)
    .bind(rule.scope, keyHash, windowStart, windowEnd, updatedAt, rule.limit)
    .first<{ count: number }>()
  if (result) return null

  const retryAfter = Math.max(1, windowEnd - nowSeconds)
  return Response.json(
    { error: '请求过于频繁，请稍后重试。' },
    { status: 429, headers: {
      'Retry-After': String(retryAfter),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } },
  )
}

/**
 * Cloudflare supplies CF-Connecting-IP at the edge. Do not trust forwarded
 * headers here: they are client-controlled unless a deployment explicitly
 * strips and replaces them before the Worker. Local/test requests share a
 * bounded anonymous bucket when that header is absent.
 */
function clientNetwork(request: Request) {
  const value = request.headers.get('CF-Connecting-IP')?.trim()
  return value && value.length <= 128 ? value : 'unavailable'
}

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('')
}
