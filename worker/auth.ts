import { enforceRateLimit, rateLimitRules } from './rate-limit.js'
import type { UploadEnv } from './uploads.js'

export type AuthEnv = UploadEnv & {
  BOOTSTRAP_ADMIN_EMAIL?: string
  BOOTSTRAP_ADMIN_NAME?: string
  BOOTSTRAP_ADMIN_TOKEN?: string
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
}

const SESSION_COOKIE = 'bp_session'
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

/** Handles only account endpoints; null lets the Worker continue routing. */
export async function handleAuthRequest(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  if (request.method === 'POST' && url.pathname === '/api/auth/bootstrap-admin') return bootstrapAdmin(request, env)
  if (request.method === 'POST' && url.pathname === '/api/auth/register') return register(request, env)
  if (request.method === 'POST' && url.pathname === '/api/auth/login') return login(request, env)
  if (request.method === 'POST' && url.pathname === '/api/auth/logout') return logout(request, env)
  if (request.method === 'GET' && url.pathname === '/api/me') {
    const user = await currentUser(request, env)
    return user ? Response.json({ user }, { headers: privateHeaders() }) : unauthorized()
  }
  if (request.method === 'GET' && url.pathname === '/api/me/stats') return ownStats(request, env)
  if (request.method === 'POST' && url.pathname === '/api/admin/invites') return createInvite(request, env)
  if (request.method === 'GET' && url.pathname === '/api/admin/invites') return listInvites(request, env)
  const inviteRevoke = url.pathname.match(/^\/api\/admin\/invites\/([a-f0-9]{32})$/)
  if (request.method === 'DELETE' && inviteRevoke) return revokeInvite(request, env, inviteRevoke[1])
  if (request.method === 'GET' && url.pathname === '/api/admin/users') return listUsers(request, env)
  const userDisable = url.pathname.match(/^\/api\/admin\/users\/([a-f0-9]{32})\/disable$/)
  if (request.method === 'POST' && userDisable) return disableUser(request, env, userDisable[1])
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
  const row = await env.DB.prepare(`SELECT u.id, u.email, u.password_hash, u.display_name, u.role, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.disabled_at IS NULL`)
    .bind(await sha256Text(token), now).first<UserRow>()
  return row ? publicUser(row) : null
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

async function login(request: Request, env: AuthEnv): Promise<Response> {
  const originError = mutationOriginError(request, env)
  if (originError) return originError
  const limitError = await enforceRateLimit(request, env, rateLimitRules.authLogin)
  if (limitError) return limitError
  const body = await readJson<Record<string, unknown>>(request)
  if (!body || Object.keys(body).some((key) => key !== 'email' && key !== 'password')) return error('邮箱或密码不正确。', 401)
  const email = normalizeEmail(body.email)
  const password = typeof body.password === 'string' ? body.password : ''
  const row = email ? await env.DB.prepare(`SELECT id, email, password_hash, display_name, role, created_at
    FROM users WHERE email = ? AND disabled_at IS NULL`).bind(email).first<UserRow>() : null
  if (!row || !validPassword(password) || !await verifyPassword(password, row.password_hash)) return error('邮箱或密码不正确。', 401)
  return sessionResponse(env, publicUser(row), 200)
}

async function logout(request: Request, env: AuthEnv): Promise<Response> {
  const originError = mutationOriginError(request, env)
  if (originError) return originError
  const token = cookie(request, SESSION_COOKIE)
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const now = new Date().toISOString()
    await env.DB.prepare('UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(now, now, await sha256Text(token)).run()
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
  const capacityBytes = settings?.capacity_bytes ?? pool?.capacity_bytes ?? 5 * 1024 ** 3
  const usedBytes = (pool?.ready_bytes ?? 0) + (pool?.reserved_bytes ?? 0)
  return { capacityBytes, usedBytes, remainingBytes: Math.max(0, capacityBytes - usedBytes),
    projectCount: counts?.project_count ?? 0, activeShareCount: shares?.share_count ?? 0,
    userCount: users?.user_count ?? 0, retentionHours: settings?.max_share_hours ?? 48, recommendedShareHours: 24 }
}

async function sessionResponse(env: AuthEnv, user: AuthUser, status: number) {
  const token = randomHex(32)
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString()
  await env.DB.prepare(`INSERT INTO sessions (id, token_hash, user_id, expires_at, revoked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?)`).bind(randomHex(16), await sha256Text(token), user.id, expiresAt, now, now).run()
  return Response.json({ user }, { status, headers: { ...privateHeaders(), 'Set-Cookie': sessionCookie(token) } })
}

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
function sessionCookie(token: string) { return `${SESSION_COOKIE}=${token}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}` }
function clearSessionCookie() { return `${SESSION_COOKIE}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` }
function mutationOriginError(request: Request, env: AuthEnv) { return request.headers.get('origin') === env.APP_ORIGIN ? null : error('请求来源无效。', 403) }
function privateHeaders() { return { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }
function unauthorized() { return Response.json({ error: '请先登录。' }, { status: 401, headers: privateHeaders() }) }
function forbidden() { return Response.json({ error: '需要管理员权限。' }, { status: 403, headers: privateHeaders() }) }
function error(message: string, status: number) { return Response.json({ error: message }, { status, headers: privateHeaders() }) }
function readJson<T>(request: Request) { return /^application\/json(?:;charset=utf-8)?$/.test((request.headers.get('content-type') ?? '').toLowerCase().replace(/\s+/g, '')) ? request.json<T>().catch(() => null) : Promise.resolve(null) }
function randomHex(bytes: number) { const value = new Uint8Array(bytes); crypto.getRandomValues(value); return hex(value) }
function hex(value: Uint8Array) { return [...value].map((item) => item.toString(16).padStart(2, '0')).join('') }
async function sha256Text(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return hex(new Uint8Array(digest)) }
async function sha256Bytes(value: string) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))) }
async function hashPassword(password: string) { const salt = new Uint8Array(16); crypto.getRandomValues(salt); const derived = await pbkdf2(password, salt, 100_000); return `pbkdf2-sha256$100000$${hex(salt)}$${hex(derived)}` }
async function verifyPassword(password: string, encoded: string) { const parts = encoded.split('$'); if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== '100000' || !/^[a-f0-9]{32}$/.test(parts[2]) || !/^[a-f0-9]{64}$/.test(parts[3])) return false; return constantTimeEqual(await pbkdf2(password, fromHex(parts[2]), 100_000), fromHex(parts[3])) }
async function pbkdf2(password: string, salt: Uint8Array, iterations: number) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(salt), iterations }, key, 256)) }
function fromHex(value: string) { const bytes = new Uint8Array(value.length / 2); for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16); return bytes }
function constantTimeEqual(left: Uint8Array, right: Uint8Array) { if (left.length !== right.length) return false; let different = 0; for (let index = 0; index < left.length; index += 1) different |= left[index] ^ right[index]; return different === 0 }
