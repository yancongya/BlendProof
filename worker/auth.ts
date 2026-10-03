import { enforceRateLimit, rateLimitRules } from './rate-limit.js'
import type { UploadEnv } from './uploads.js'
import { universalProfile } from './universal-profile.js'

export type AuthEnv = UploadEnv & {
  BOOTSTRAP_ADMIN_EMAIL?: string
  BOOTSTRAP_ADMIN_NAME?: string
  BOOTSTRAP_ADMIN_TOKEN?: string
  UNIVERSAL_AUTH_MODE?: string
  UNIVERSAL_OIDC_ISSUER?: string
  UNIVERSAL_OIDC_CLIENT_ID?: string
  UNIVERSAL_SESSION_SECRET?: string
  UNIVERSAL_OIDC_SERVICE?: Fetcher
  UNIVERSAL_AUTH_GRACE_SECONDS?: string
}

export type AuthUser = {
  id: string
  email: string
  displayName: string
  role: 'user' | 'admin'
  createdAt: string
}

type UserRow = {
  id: string
  email: string
  password_hash: string
  display_name: string
  role: 'user' | 'admin'
  created_at: string
  auth_source?: 'local' | 'universal'
}

const SESSION_COOKIE = 'bp_session'
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
const UNIVERSAL_RECHECK_MS = 5 * 60_000
const DEFAULT_UNIVERSAL_GRACE_SECONDS = 30 * 60

/** Handles only account endpoints; null lets the Worker continue routing. */
export async function handleAuthRequest(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  const mode = identityMode(env)
  if (request.method === 'POST' && url.pathname === '/api/auth/bootstrap-admin') return mode === 'off' ? bootstrapAdmin(request, env) : retiredAccountEndpoint()
  if (request.method === 'POST' && url.pathname === '/api/auth/register') return mode === 'off' ? register(request, env) : retiredAccountEndpoint()
  if (request.method === 'POST' && url.pathname === '/api/auth/login') return login(request, env, mode === 'required')
  if (request.method === 'POST' && url.pathname === '/api/auth/logout') return logout(request, env)
  if (request.method === 'GET' && url.pathname === '/api/me') {
    const user = await currentUser(request, env)
    // Anonymous identity lookup is a normal launcher state, not an auth error.
    return Response.json({ user }, { headers: privateHeaders() })
  }
  if (request.method === 'GET' && url.pathname === '/api/me/stats') return ownStats(request, env)
  if (request.method === 'POST' && url.pathname === '/api/admin/invites') return mode === 'off' ? createInvite(request, env) : retiredAccountEndpoint()
  if (request.method === 'GET' && url.pathname === '/api/admin/invites') return mode === 'off' ? listInvites(request, env) : retiredAccountEndpoint()
  const inviteRevoke = url.pathname.match(/^\/api\/admin\/invites\/([a-f0-9]{32})$/)
  if (request.method === 'DELETE' && inviteRevoke) return mode === 'off' ? revokeInvite(request, env, inviteRevoke[1]) : retiredAccountEndpoint()
  if (request.method === 'GET' && url.pathname === '/api/admin/users') return mode === 'off' ? listUsers(request, env) : retiredAccountEndpoint()
  const userDisable = url.pathname.match(/^\/api\/admin\/users\/([a-f0-9]{32})\/disable$/)
  if (request.method === 'POST' && userDisable) return mode === 'off' ? disableUser(request, env, userDisable[1]) : retiredAccountEndpoint()
  if (request.method === 'GET' && url.pathname === '/api/admin/settings') return adminSettings(request, env)
  if (request.method === 'PATCH' && url.pathname === '/api/admin/settings') return updateAdminSettings(request, env)
  if (request.method === 'GET' && url.pathname === '/api/admin/stats') return adminStats(request, env)
  return null
}

async function bootstrapAdmin(request: Request, env: AuthEnv): Promise<Response> {
  const originError = mutationOriginError(request, env)
  if (originError) return originError
  const configuredToken = env.BOOTSTRAP_ADMIN_TOKEN ?? ''
  const suppliedToken = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1] ?? ''
  if (configuredToken.length < 32 || suppliedToken.length < 32 ||
    !constantTimeEqual(await sha256Bytes(suppliedToken), await sha256Bytes(configuredToken))) return forbidden()
  const existing = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>()
  if ((existing?.count ?? 0) !== 0) return error('管理员初始化已经关闭。', 409)
  const email = normalizeEmail(env.BOOTSTRAP_ADMIN_EMAIL)
  const displayName = normalizeDisplayName(env.BOOTSTRAP_ADMIN_NAME)
  const body = await readJson<Record<string, unknown>>(request)
  const password = body && Object.keys(body).length === 1 && typeof body.password === 'string' ? body.password : ''
  if (!email || !displayName || !validPassword(password)) return error('管理员初始化配置无效。', 503)
  const now = new Date().toISOString()
  const id = randomHex(16)
  try {
    await env.DB.prepare(`INSERT INTO users
      (id, email, password_hash, display_name, role, invite_id, disabled_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, 'admin', NULL, NULL, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`)
      .bind(id, email, await hashPassword(password), displayName, now, now).run()
  } catch {
    return error('管理员初始化已经关闭。', 409)
  }
  const user = await userById(env, id)
  if (!user) return error('管理员初始化已经关闭。', 409)
  return sessionResponse(env, user, 201)
}

/** Returns no identity for absent, expired, revoked, or disabled sessions. */
export async function currentUser(request: Request, env: AuthEnv): Promise<AuthUser | null> {
  const token = cookie(request, SESSION_COOKIE)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  const now = new Date().toISOString()
  const row = await env.DB.prepare(`SELECT u.id, u.email, u.password_hash, u.display_name,
    CASE WHEN s.auth_source = 'universal' AND COALESCE(b.product_admin, 0) = 1 THEN 'admin' ELSE u.role END AS role,
    u.created_at, s.auth_source, s.id AS session_id, s.universal_refresh_token, s.universal_checked_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    LEFT JOIN identity_bindings b ON b.local_user_id = u.id AND b.provider = 'universal'
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.disabled_at IS NULL`)
    .bind(await sha256Text(token), now).first<UserRow & { session_id: string; universal_refresh_token: string | null; universal_checked_at: string | null }>()
  if (!row || (identityMode(env) === 'required' && row.auth_source !== 'universal' && row.id !== GUEST_DEMO_USER_ID)) return null
  if (row.auth_source === 'universal' && (!row.universal_checked_at || Date.now() - Date.parse(row.universal_checked_at) >= UNIVERSAL_RECHECK_MS)) {
    const refreshed = await refreshUniversalSession(env, row.session_id, row.id, row.universal_refresh_token)
    if (!refreshed) return null
    if (refreshed.kind === 'transient') {
      const lastVerifiedAt = Date.parse(row.universal_checked_at ?? '')
      if (!Number.isFinite(lastVerifiedAt) || Date.now() - lastVerifiedAt > universalGraceMs(env)) return null
      // A cached identity may keep using ordinary product features during a
      // short provider outage, but elevated product-admin authority never does.
      return { ...publicUser(row), role: 'user' }
    }
    const updated = await userById(env, row.id)
    if (!updated) return null
    return { ...updated, role: refreshed.productAdmin ? 'admin' : 'user' }
  }
  return publicUser(row)
}

async function register(request: Request, env: AuthEnv): Promise<Response> {
  const originError = mutationOriginError(request, env)
  if (originError) return originError
  const limitError = await enforceRateLimit(request, env, rateLimitRules.authRegister)
  if (limitError) return limitError
  const body = await readJson<Record<string, unknown>>(request)
  if (!body || Object.keys(body).some((key) => !['inviteCode', 'email', 'password', 'displayName'].includes(key))) return error('注册信息无效。', 400)
  const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : ''
  const email = normalizeEmail(body.email)
  const password = typeof body.password === 'string' ? body.password : ''
  const displayName = normalizeDisplayName(body.displayName)
  if (!validInviteCode(inviteCode) || !email || !validPassword(password) || !displayName) return error('注册信息无效。', 400)
  const now = new Date().toISOString()
  const id = randomHex(16)
  try {
    await env.DB.prepare(`INSERT INTO users
      (id, email, password_hash, display_name, role, invite_id, created_at, updated_at)
      SELECT ?, ?, ?, ?, 'user', id, ?, ? FROM invites
      WHERE code_hash = ? AND revoked_at IS NULL AND expires_at > ? AND uses_count < max_uses`)
      .bind(id, email, await hashPassword(password), displayName, now, now, await sha256Text(inviteCode), now).run()
  } catch (reason) {
    if (String(reason).includes('UNIQUE constraint failed: users.email')) return error('该邮箱已注册。', 409)
    return error('注册失败，请稍后重试。', 409)
  }
  const user = await userById(env, id)
  if (!user) return error('邀请码无效、已过期或已用尽。', 400)
  return sessionResponse(env, user, 201)
}

export const GUEST_DEMO_EMAIL = 'guest@blendproof.itycon.cn'
export const GUEST_DEMO_PASSWORD = 'tycon'
export const GUEST_DEMO_USER_ID = '00000000000000000000000000000002'

async function ensureGuestUser(env: AuthEnv): Promise<UserRow | null> {
  let row = await env.DB.prepare(`SELECT id, email, password_hash, display_name, role, created_at
    FROM users WHERE email = ? AND disabled_at IS NULL`).bind(GUEST_DEMO_EMAIL).first<UserRow>()
  if (!row) {
    const now = new Date().toISOString()
    const passwordHash = await hashPassword(GUEST_DEMO_PASSWORD)
    await env.DB.prepare(`INSERT OR IGNORE INTO users
      (id, email, password_hash, display_name, role, invite_id, created_at, updated_at)
      VALUES (?, ?, ?, '访客体验', 'user', NULL, ?, ?)`
    ).bind(GUEST_DEMO_USER_ID, GUEST_DEMO_EMAIL, passwordHash, now, now).run()
    row = await env.DB.prepare(`SELECT id, email, password_hash, display_name, role, created_at
      FROM users WHERE email = ? AND disabled_at IS NULL`).bind(GUEST_DEMO_EMAIL).first<UserRow>()
  }
  return row
}

async function login(request: Request, env: AuthEnv, guestOnly = false): Promise<Response> {
  const originError = mutationOriginError(request, env)
  if (originError) return originError
  const limitError = await enforceRateLimit(request, env, rateLimitRules.authLogin)
  if (limitError) return limitError
  const body = await readJson<Record<string, unknown>>(request)
  if (!body || Object.keys(body).some((key) => key !== 'email' && key !== 'password')) return error('邮箱或密码不正确。', 401)
  const email = normalizeEmail(body.email)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email) return error('邮箱或密码不正确。', 401)

  if (email === GUEST_DEMO_EMAIL && password === GUEST_DEMO_PASSWORD) {
    const guestRow = await ensureGuestUser(env)
    if (guestRow) {
      return sessionResponse(env, publicUser(guestRow), 200)
    }
  }

  if (guestOnly) return retiredAccountEndpoint()

  const row = await env.DB.prepare(`SELECT id, email, password_hash, display_name, role, created_at
    FROM users WHERE email = ? AND disabled_at IS NULL`).bind(email).first<UserRow>()
  if (!row || !validPassword(password) || !await verifyPassword(password, row.password_hash)) return error('邮箱或密码不正确。', 401)
  return sessionResponse(env, publicUser(row), 200)
}

async function logout(request: Request, env: AuthEnv): Promise<Response> {
  const originError = mutationOriginError(request, env)
  if (originError) return originError
  const token = cookie(request, SESSION_COOKIE)
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const now = new Date().toISOString()
    const tokenHash = await sha256Text(token)
    const universal = await env.DB.prepare(`SELECT id,universal_refresh_token FROM sessions
      WHERE token_hash=? AND auth_source='universal' AND revoked_at IS NULL`).bind(tokenHash)
      .first<{ id: string; universal_refresh_token: string | null }>()
    if (universal?.universal_refresh_token && env.UNIVERSAL_OIDC_ISSUER) {
      try {
        const refreshToken = await decryptSessionSecret(env, universal.id, universal.universal_refresh_token)
        await universalFetch(env, '/oauth2/revoke', { method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refreshToken }) })
      } catch { /* local logout remains authoritative for the BlendProof browser */ }
    }
    await env.DB.prepare('UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(now, now, tokenHash).run()
  }
  return new Response(null, { status: 204, headers: { ...privateHeaders(), 'Set-Cookie': clearSessionCookie() } })
}

async function ownStats(request: Request, env: AuthEnv): Promise<Response> {
  const user = await currentUser(request, env)
  if (!user) return unauthorized()
  const now = new Date().toISOString()
  const result = await env.DB.prepare(`SELECT
    COALESCE(SUM(reservation.byte_size), 0) AS used_bytes,
    COUNT(DISTINCT p.id) AS project_count,
    COUNT(DISTINCT CASE WHEN s.id IS NOT NULL THEN s.id END) AS active_share_count
    FROM projects p
    LEFT JOIN project_storage_reservations reservation ON reservation.project_id = p.id AND reservation.status = 'settled'
    LEFT JOIN shares s ON s.project_id = p.id AND s.revoked_at IS NULL AND s.expires_at > ?
    WHERE p.owner_id = ? AND p.status = 'ready' AND (p.expires_at IS NULL OR p.expires_at > ?)`)
    .bind(now, user.id, now).first<{ used_bytes: number; project_count: number; active_share_count: number }>()
  return Response.json({ usedBytes: result?.used_bytes ?? 0, projectCount: result?.project_count ?? 0,
    activeShareCount: result?.active_share_count ?? 0 }, { headers: privateHeaders() })
}

async function createInvite(request: Request, env: AuthEnv): Promise<Response> {
  const originError = mutationOriginError(request, env)
  if (originError) return originError
  const user = await currentUser(request, env)
  if (!user || user.role !== 'admin') return forbidden()
  const body = await readJson<Record<string, unknown>>(request)
  if (!body || Object.keys(body).some((key) => key !== 'expiresInHours' && key !== 'maxUses')) return error('邀请码参数无效。', 400)
  const expiresInHours = body.expiresInHours
  const maxUses = body.maxUses
  if (typeof expiresInHours !== 'number' || !Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 24 * 30 ||
    typeof maxUses !== 'number' || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10_000) return error('邀请码参数无效。', 400)
  const code = `BP-${randomHex(12).toUpperCase()}`
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60_000).toISOString()
  await env.DB.prepare(`INSERT INTO invites
    (id, code_hash, created_by_user_id, max_uses, uses_count, expires_at, revoked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, NULL, ?, ?)`)
    .bind(randomHex(16), await sha256Text(code), user.id, maxUses, expiresAt, now, now).run()
  return Response.json({ code, expiresAt, maxUses }, { status: 201, headers: privateHeaders() })
}

async function requireAdmin(request: Request, env: AuthEnv) {
  const user = await currentUser(request, env)
  return user?.role === 'admin' ? user : null
}

async function listInvites(request: Request, env: AuthEnv): Promise<Response> {
  if (!await requireAdmin(request, env)) return forbidden()
  const rows = await env.DB.prepare(`SELECT id, max_uses, uses_count, expires_at, revoked_at, created_at
    FROM invites ORDER BY created_at DESC LIMIT 100`).all<{
      id: string; max_uses: number; uses_count: number; expires_at: string; revoked_at: string | null; created_at: string
    }>()
  return Response.json({ invites: rows.results.map((row) => ({ id: row.id, maxUses: row.max_uses,
    usesCount: row.uses_count, expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at })) }, { headers: privateHeaders() })
}

async function revokeInvite(request: Request, env: AuthEnv, inviteId: string): Promise<Response> {
  const originError = mutationOriginError(request, env)
  if (originError) return originError
  if (!await requireAdmin(request, env)) return forbidden()
  const now = new Date().toISOString()
  const result = await env.DB.prepare('UPDATE invites SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL')
    .bind(now, now, inviteId).run()
  return result.meta.changes === 1 ? new Response(null, { status: 204, headers: privateHeaders() }) : error('邀请码不存在或已撤销。', 404)
}

async function listUsers(request: Request, env: AuthEnv): Promise<Response> {
  if (!await requireAdmin(request, env)) return forbidden()
  const rows = await env.DB.prepare(`SELECT u.id, u.email, u.display_name, u.role, u.disabled_at, u.created_at,
    COALESCE(SUM(CASE WHEN r.status = 'settled' THEN r.byte_size ELSE 0 END), 0) AS used_bytes,
    COUNT(DISTINCT CASE WHEN p.status = 'ready' THEN p.id END) AS project_count
    FROM users u LEFT JOIN projects p ON p.owner_id = u.id
    LEFT JOIN project_storage_reservations r ON r.project_id = p.id
    GROUP BY u.id ORDER BY u.created_at ASC`).all<{
      id: string; email: string; display_name: string; role: 'user' | 'admin'; disabled_at: string | null
      created_at: string; used_bytes: number; project_count: number
    }>()
  return Response.json({ users: rows.results.map((row) => ({ id: row.id, email: row.email,
    displayName: row.display_name, role: row.role, disabledAt: row.disabled_at, createdAt: row.created_at,
    usedBytes: row.used_bytes, projectCount: row.project_count })) }, { headers: privateHeaders() })
}

async function disableUser(request: Request, env: AuthEnv, userId: string): Promise<Response> {
  const originError = mutationOriginError(request, env)
  if (originError) return originError
  const admin = await requireAdmin(request, env)
  if (!admin) return forbidden()
  if (admin.id === userId) return error('不能停用当前管理员。', 409)
  const now = new Date().toISOString()
  const result = await env.DB.prepare(`UPDATE users SET disabled_at = ?, updated_at = ?
    WHERE id = ? AND role = 'user' AND disabled_at IS NULL`).bind(now, now, userId).run()
  if (result.meta.changes !== 1) return error('成员不存在、已停用或不是普通成员。', 404)
  await env.DB.prepare('UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .bind(now, now, userId).run()
  return new Response(null, { status: 204, headers: privateHeaders() })
}

async function adminSettings(request: Request, env: AuthEnv): Promise<Response> {
  if (!await requireAdmin(request, env)) return forbidden()
  const settings = await env.DB.prepare('SELECT capacity_bytes, max_share_hours FROM platform_settings WHERE id = 1')
    .first<{ capacity_bytes: number; max_share_hours: number }>()
  return Response.json({ capacityBytes: settings?.capacity_bytes ?? 5 * 1024 ** 3,
    maxShareHours: settings?.max_share_hours ?? 48 }, { headers: privateHeaders() })
}

async function updateAdminSettings(request: Request, env: AuthEnv): Promise<Response> {
  const originError = mutationOriginError(request, env)
  if (originError) return originError
  if (!await requireAdmin(request, env)) return forbidden()
  const body = await readJson<Record<string, unknown>>(request)
  if (!body || Object.keys(body).some((key) => key !== 'capacityBytes' && key !== 'maxShareHours')) return error('平台设置无效。', 400)
  const capacityBytes = body.capacityBytes
  const maxShareHours = body.maxShareHours
  if (typeof capacityBytes !== 'number' || !Number.isInteger(capacityBytes) || capacityBytes < 100 * 1024 ** 2 || capacityBytes > 5 * 1024 ** 3 ||
    typeof maxShareHours !== 'number' || !Number.isInteger(maxShareHours) || maxShareHours < 1 || maxShareHours > 48) return error('平台设置超出安全范围。', 400)
  const pool = await env.DB.prepare('SELECT ready_bytes, reserved_bytes FROM storage_pool WHERE id = 1').first<{ ready_bytes: number; reserved_bytes: number }>()
  if ((pool?.ready_bytes ?? 0) + (pool?.reserved_bytes ?? 0) > capacityBytes) return error('新容量不能低于当前占用。', 409)
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare('UPDATE platform_settings SET capacity_bytes = ?, max_share_hours = ?, updated_at = ? WHERE id = 1')
      .bind(capacityBytes, maxShareHours, now),
  ])
  return adminSettings(request, env)
}

async function adminStats(request: Request, env: AuthEnv): Promise<Response> {
  const user = await currentUser(request, env)
  if (!user || user.role !== 'admin') return forbidden()
  return Response.json(await publicStats(env), { headers: privateHeaders() })
}

export async function publicStats(env: AuthEnv) {
  const pool = await env.DB.prepare(`SELECT capacity_bytes, ready_bytes, reserved_bytes
    FROM storage_pool WHERE id = 1`).first<{ capacity_bytes: number; ready_bytes: number; reserved_bytes: number }>()
  const now = new Date().toISOString()
  const counts = await env.DB.prepare(`SELECT COUNT(*) AS project_count
    FROM projects WHERE status = 'ready' AND (expires_at IS NULL OR expires_at > ?)`).bind(now)
    .first<{ project_count: number }>()
  const users = await env.DB.prepare(`SELECT COUNT(*) AS user_count FROM users
    WHERE disabled_at IS NULL`).first<{ user_count: number }>()
  const shares = await env.DB.prepare(`SELECT COUNT(*) AS share_count FROM shares
    WHERE revoked_at IS NULL AND expires_at > ?`).bind(now).first<{ share_count: number }>()
  const settings = await env.DB.prepare('SELECT capacity_bytes, max_share_hours FROM platform_settings WHERE id = 1')
    .first<{ capacity_bytes: number; max_share_hours: number }>()
  const lifetime = await env.DB.prepare(`SELECT launched_at, processed_project_count, processed_asset_count,
    processed_bytes, cleaned_asset_count, cleaned_bytes FROM platform_lifetime_metrics WHERE id = 1`)
    .first<{ launched_at: string; processed_project_count: number; processed_asset_count: number;
      processed_bytes: number; cleaned_asset_count: number; cleaned_bytes: number }>()
  const capacityBytes = settings?.capacity_bytes ?? pool?.capacity_bytes ?? 5 * 1024 ** 3
  const usedBytes = (pool?.ready_bytes ?? 0) + (pool?.reserved_bytes ?? 0)
  return { capacityBytes, usedBytes, remainingBytes: Math.max(0, capacityBytes - usedBytes),
    projectCount: counts?.project_count ?? 0, activeShareCount: shares?.share_count ?? 0,
    userCount: users?.user_count ?? 0, retentionHours: settings?.max_share_hours ?? 48, recommendedShareHours: 24,
    launchedAt: lifetime?.launched_at ?? now, processedFileCount: lifetime?.processed_project_count ?? 0,
    processedAssetCount: lifetime?.processed_asset_count ?? 0, processedBytes: lifetime?.processed_bytes ?? 0,
    cleanedFileCount: lifetime?.cleaned_asset_count ?? 0, cleanedBytes: lifetime?.cleaned_bytes ?? 0 }
}

export async function issueSession(env: AuthEnv, user: AuthUser, status: number,
  options: { source?: 'local' | 'universal'; ttlSeconds?: number; location?: string; universalRefreshToken?: string } = {}) {
  const token = randomHex(32)
  const sessionId = randomHex(16)
  const now = new Date().toISOString()
  const ttlSeconds = options.ttlSeconds ?? SESSION_TTL_SECONDS
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  const encryptedRefreshToken = options.universalRefreshToken ? await encryptSessionSecret(env, sessionId, options.universalRefreshToken) : null
  await env.DB.prepare(`INSERT INTO sessions (id, token_hash, user_id, expires_at, revoked_at, created_at, updated_at, auth_source, universal_refresh_token, universal_checked_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`).bind(sessionId, await sha256Text(token), user.id, expiresAt, now, now,
      options.source ?? 'local', encryptedRefreshToken, options.source === 'universal' ? now : null).run()
  const headers = { ...privateHeaders(), 'Set-Cookie': sessionCookie(token, ttlSeconds), ...(options.location ? { Location: options.location } : {}) }
  return options.location ? new Response(null, { status, headers }) : Response.json({ user }, { status, headers })
}

const sessionResponse = issueSession

async function userById(env: AuthEnv, id: string): Promise<AuthUser | null> {
  const row = await env.DB.prepare('SELECT id, email, password_hash, display_name, role, created_at FROM users WHERE id = ? AND disabled_at IS NULL')
    .bind(id).first<UserRow>()
  return row ? publicUser(row) : null
}

function publicUser(row: UserRow): AuthUser { return { id: row.id, email: row.email, displayName: row.display_name, role: row.role, createdAt: row.created_at } }
function normalizeEmail(value: unknown) { const email = typeof value === 'string' ? value.trim().toLowerCase() : ''; return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email) && email.length <= 320 ? email : null }
function normalizeDisplayName(value: unknown) { const name = typeof value === 'string' ? value.trim() : ''; return name.length >= 1 && name.length <= 80 ? name : null }
function validPassword(value: string) { return value.length >= 8 && value.length <= 200 }
function validInviteCode(value: string) { return /^BP-[A-F0-9]{24}$/.test(value) }
function cookie(request: Request, name: string) { const prefix = `${name}=`; return request.headers.get('cookie')?.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? '' }
function sessionCookie(token: string, ttlSeconds = SESSION_TTL_SECONDS) { return `${SESSION_COOKIE}=${token}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}` }
function clearSessionCookie() { return `${SESSION_COOKIE}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` }
function mutationOriginError(request: Request, env: AuthEnv) { return request.headers.get('origin') === env.APP_ORIGIN ? null : error('请求来源无效。', 403) }
function privateHeaders() { return { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }
function unauthorized() { return Response.json({ error: '请先登录。' }, { status: 401, headers: privateHeaders() }) }
function forbidden() { return Response.json({ error: '需要管理员权限。' }, { status: 403, headers: privateHeaders() }) }
function retiredAccountEndpoint() { return Response.json({ error: '账号功能已迁移到 Universal 统一账号中心。' }, { status: 410, headers: privateHeaders() }) }
function identityMode(env: AuthEnv) { return env.UNIVERSAL_AUTH_MODE === 'required' || env.UNIVERSAL_AUTH_MODE === 'optional' ? env.UNIVERSAL_AUTH_MODE : 'off' }
function error(message: string, status: number) { return Response.json({ error: message }, { status, headers: privateHeaders() }) }
function readJson<T>(request: Request) { return /^application\/json(?:;charset=utf-8)?$/.test((request.headers.get('content-type') ?? '').toLowerCase().replace(/\s+/g, '')) ? request.json<T>().catch(() => null) : Promise.resolve(null) }
function randomHex(bytes: number) { const value = new Uint8Array(bytes); crypto.getRandomValues(value); return hex(value) }
function hex(value: Uint8Array) { return [...value].map((item) => item.toString(16).padStart(2, '0')).join('') }
async function sha256Text(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return hex(new Uint8Array(digest)) }
async function sha256Bytes(value: string) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))) }
async function sessionEncryptionKey(env: AuthEnv) {
  const secret = env.UNIVERSAL_SESSION_SECRET ?? ''
  if (secret.length < 32) throw new Error('UNIVERSAL_SESSION_SECRET is not configured')
  return crypto.subtle.importKey('raw', await sha256Bytes(secret), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
async function encryptSessionSecret(env: AuthEnv, sessionId: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(sessionId) },
    await sessionEncryptionKey(env), new TextEncoder().encode(value)))
  return `${base64Url(iv)}.${base64Url(ciphertext)}`
}
async function decryptSessionSecret(env: AuthEnv, sessionId: string, value: string) {
  const [iv, ciphertext] = value.split('.')
  if (!iv || !ciphertext) throw new Error('invalid ciphertext')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv), additionalData: new TextEncoder().encode(sessionId) },
    await sessionEncryptionKey(env), fromBase64Url(ciphertext))
  return new TextDecoder().decode(plain)
}
type UniversalRefreshResult = { kind: 'refreshed'; productAdmin: boolean } | { kind: 'transient' }

async function refreshUniversalSession(env: AuthEnv, sessionId: string, userId: string, encryptedToken: string | null): Promise<UniversalRefreshResult | null> {
  if (!encryptedToken || !env.UNIVERSAL_OIDC_ISSUER || !env.UNIVERSAL_OIDC_CLIENT_ID) return revokeSession(env, sessionId)
  try {
    const refreshToken = await decryptSessionSecret(env, sessionId, encryptedToken)
    const response = await universalFetch(env, '/oauth2/token', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: env.UNIVERSAL_OIDC_CLIENT_ID, refresh_token: refreshToken }) })
    const tokens = await response.json().catch(() => ({})) as { access_token?: unknown; refresh_token?: unknown }
    if (!response.ok) return transientProviderStatus(response.status) ? { kind: 'transient' } : revokeSession(env, sessionId)
    if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') return { kind: 'transient' }
    const meResponse = await universalFetch(env, '/v1/me', { headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' } })
    const me = await meResponse.json().catch(() => ({})) as { sub?: unknown; productId?: unknown; permissions?: unknown; email?: unknown; name?: unknown; preferred_username?: unknown }
    if (!meResponse.ok) return transientProviderStatus(meResponse.status) ? { kind: 'transient' } : revokeSession(env, sessionId)
    if (typeof me.sub !== 'string' || me.productId !== 'blendproof' || !me.permissions || typeof me.permissions !== 'object' || (me.permissions as Record<string, unknown>).login !== true) return revokeSession(env, sessionId)
    const binding = await env.DB.prepare("SELECT external_subject FROM identity_bindings WHERE provider='universal' AND local_user_id=?")
      .bind(userId).first<{ external_subject: string }>()
    if (!binding || binding.external_subject !== me.sub) return revokeSession(env, sessionId)
    const productAdmin = (me.permissions as Record<string, unknown>).product_admin === true
    const profile = universalProfile(me)
    const now = new Date().toISOString()
    await env.DB.batch([
      env.DB.prepare('UPDATE sessions SET universal_refresh_token=?, universal_checked_at=?, updated_at=? WHERE id=? AND revoked_at IS NULL')
        .bind(await encryptSessionSecret(env, sessionId, tokens.refresh_token), now, now, sessionId),
      env.DB.prepare("UPDATE identity_bindings SET product_admin=?, last_verified_at=? WHERE provider='universal' AND local_user_id=?")
        .bind(productAdmin ? 1 : 0, now, userId),
      env.DB.prepare('UPDATE users SET email=COALESCE(?,email), display_name=COALESCE(?,display_name), updated_at=? WHERE id=? AND disabled_at IS NULL')
        .bind(profile.email, profile.displayName, now, userId),
    ])
    return { kind: 'refreshed', productAdmin }
  } catch { return { kind: 'transient' } }
}
async function revokeSession(env: AuthEnv, sessionId: string): Promise<null> {
  const now = new Date().toISOString()
  await env.DB.prepare('UPDATE sessions SET revoked_at=?, updated_at=? WHERE id=? AND revoked_at IS NULL').bind(now, now, sessionId).run()
  return null
}
function universalFetch(env: AuthEnv, path: string, init?: RequestInit) {
  const target = new URL(path, env.UNIVERSAL_OIDC_ISSUER)
  return env.UNIVERSAL_OIDC_SERVICE ? env.UNIVERSAL_OIDC_SERVICE.fetch(new Request(target, init)) : fetch(target, init)
}
function transientProviderStatus(status: number) { return status === 429 || status >= 500 }
function universalGraceMs(env: AuthEnv) {
  const configured = Number(env.UNIVERSAL_AUTH_GRACE_SECONDS)
  const seconds = Number.isFinite(configured) ? Math.min(3600, Math.max(300, Math.trunc(configured))) : DEFAULT_UNIVERSAL_GRACE_SECONDS
  return seconds * 1000
}
function base64Url(value: Uint8Array) { let binary = ''; value.forEach((byte) => { binary += String.fromCharCode(byte) }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
function fromBase64Url(value: string) { const base64 = value.replace(/-/g, '+').replace(/_/g, '/'); const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')); return Uint8Array.from(binary, (character) => character.charCodeAt(0)) }
async function hashPassword(password: string) { const salt = new Uint8Array(16); crypto.getRandomValues(salt); const derived = await pbkdf2(password, salt, 100_000); return `pbkdf2-sha256$100000$${hex(salt)}$${hex(derived)}` }
async function verifyPassword(password: string, encoded: string) { const parts = encoded.split('$'); if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== '100000' || !/^[a-f0-9]{32}$/.test(parts[2]) || !/^[a-f0-9]{64}$/.test(parts[3])) return false; return constantTimeEqual(await pbkdf2(password, fromHex(parts[2]), 100_000), fromHex(parts[3])) }
async function pbkdf2(password: string, salt: Uint8Array, iterations: number) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(salt), iterations }, key, 256)) }
function fromHex(value: string) { const bytes = new Uint8Array(value.length / 2); for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16); return bytes }
function constantTimeEqual(left: Uint8Array, right: Uint8Array) { if (left.length !== right.length) return false; let different = 0; for (let index = 0; index < left.length; index += 1) different |= left[index] ^ right[index]; return different === 0 }
