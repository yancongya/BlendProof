import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'
import type { AuthEnv, AuthUser } from './auth.js'
import { currentUser, issueSession } from './auth.js'
import { universalProfile, type UniversalProfile } from './universal-profile.js'

export type UniversalAuthMode = 'off' | 'optional' | 'required'

type LoginTransaction = {
  state_hash: string
  nonce: string
  pkce_verifier: string
  return_to: string
  local_user_id: string | null
  expires_at: string
}

type TokenResponse = { access_token?: unknown; id_token?: unknown; refresh_token?: unknown; token_type?: unknown; expires_in?: unknown }
type MeResponse = { sub?: unknown; productId?: unknown; permissions?: unknown; email?: unknown; name?: unknown; preferred_username?: unknown }

const OIDC_SESSION_SECONDS = 30 * 24 * 60 * 60

export async function handleUniversalAuthRequest(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  if (request.method === 'GET' && url.pathname === '/api/auth/config') {
    const issuer = configuredIssuer(env)
    return Response.json({
      mode: authMode(env),
      universalAvailable: authMode(env) !== 'off' && Boolean(issuer && validClientId(env.UNIVERSAL_OIDC_CLIENT_ID)),
      registerUrl: issuer ? '/api/auth/universal/register' : null,
      resetPasswordUrl: issuer ? '/api/auth/universal/reset-password' : null,
      accountUrl: issuer ? '/api/auth/universal/account' : null,
      adminUrl: issuer ? '/api/auth/universal/admin' : null,
    }, { headers: privateHeaders() })
  }
  if (request.method === 'GET' && url.pathname === '/api/auth/universal/register') return accountRedirect(env, '/register')
  if (request.method === 'GET' && url.pathname === '/api/auth/universal/reset-password') return accountRedirect(env, '/reset-password')
  if (request.method === 'GET' && url.pathname === '/api/auth/universal/account') return accountRedirect(env, '/profile')
  if (request.method === 'GET' && url.pathname === '/api/auth/universal/admin') return accountRedirect(env, '/dashboard')
  if (request.method === 'GET' && url.pathname === '/api/auth/universal/start') return startLogin(request, env, url)
  if (request.method === 'GET' && url.pathname === '/api/auth/universal/callback') return finishLogin(request, env, url)
  return null
}

export function authMode(env: AuthEnv): UniversalAuthMode {
  return env.UNIVERSAL_AUTH_MODE === 'required' || env.UNIVERSAL_AUTH_MODE === 'optional' ? env.UNIVERSAL_AUTH_MODE : 'off'
}

function accountRedirect(env: AuthEnv, path: string): Response {
  const issuer = configuredIssuer(env)
  if (!issuer || authMode(env) === 'off') return error('统一账号服务尚未启用。', 503)
  return Response.redirect(`${issuer}${path}`, 302)
}

async function startLogin(request: Request, env: AuthEnv, url: URL): Promise<Response> {
  const issuer = configuredIssuer(env)
  const clientId = validClientId(env.UNIVERSAL_OIDC_CLIENT_ID) ? env.UNIVERSAL_OIDC_CLIENT_ID : null
  if (!issuer || !clientId || authMode(env) === 'off') return error('统一账号服务尚未启用。', 503)
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'))
  const state = randomBase64Url(32)
  const verifier = randomBase64Url(32)
  const nonce = randomBase64Url(32)
  const challenge = await sha256Base64Url(verifier)
  const now = new Date()
  const local = await currentUser(request, env)
  await env.DB.prepare(`INSERT INTO oidc_login_transactions
    (state_hash, nonce, pkce_verifier, return_to, local_user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(await sha256Hex(state), nonce, verifier, returnTo, local?.id ?? null,
      new Date(now.getTime() + 5 * 60_000).toISOString(), now.toISOString()).run()
  const authorize = new URL('/oauth2/authorize', issuer)
  authorize.searchParams.set('client_id', clientId)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('redirect_uri', callbackUrl(env))
  authorize.searchParams.set('scope', 'openid profile email')
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('nonce', nonce)
  authorize.searchParams.set('code_challenge', challenge)
  authorize.searchParams.set('code_challenge_method', 'S256')
  return Response.redirect(authorize.toString(), 302)
}

async function finishLogin(request: Request, env: AuthEnv, url: URL): Promise<Response> {
  const issuer = configuredIssuer(env)
  const clientId = validClientId(env.UNIVERSAL_OIDC_CLIENT_ID) ? env.UNIVERSAL_OIDC_CLIENT_ID : null
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!issuer || !clientId || authMode(env) === 'off' || !safeOpaque(code, 512) || !safeOpaque(state, 256)) {
    return error('统一登录回调无效。', 400)
  }
  const stateHash = await sha256Hex(state)
  const tx = await env.DB.prepare(`SELECT state_hash, nonce, pkce_verifier, return_to, local_user_id, expires_at
    FROM oidc_login_transactions WHERE state_hash = ?`).bind(stateHash).first<LoginTransaction>()
  if (!tx || Date.parse(tx.expires_at) <= Date.now()) return error('统一登录请求已过期，请重新登录。', 400)
  const consumed = await env.DB.prepare('DELETE FROM oidc_login_transactions WHERE state_hash = ?').bind(stateHash).run()
  if (consumed.meta.changes !== 1) return error('统一登录请求已使用。', 400)

  const tokenResponse = await universalFetch(env, '/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code,
      redirect_uri: callbackUrl(env), code_verifier: tx.pkce_verifier }),
  })
  const tokens: TokenResponse = await tokenResponse.json<TokenResponse>().catch(() => ({}))
  if (!tokenResponse.ok || typeof tokens.id_token !== 'string' || typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') {
    console.warn('Universal token exchange rejected', { status: tokenResponse.status,
      oauthError: typeof (tokens as Record<string, unknown>).error === 'string' ? (tokens as Record<string, unknown>).error : null,
      hasIdToken: typeof tokens.id_token === 'string', hasAccessToken: typeof tokens.access_token === 'string',
      hasRefreshToken: typeof tokens.refresh_token === 'string' })
    return error('统一账号令牌交换失败。', 502)
  }
  let subject: string
  try {
    const jwksResponse = await universalFetch(env, '/.well-known/jwks.json', { headers: { accept: 'application/json' } })
    if (!jwksResponse.ok) throw new Error('JWKS unavailable')
    const jwks = createLocalJWKSet(await jwksResponse.json<JSONWebKeySet>())
    const verified = await jwtVerify(tokens.id_token, jwks, { issuer, audience: clientId, algorithms: ['RS256'] })
    if (verified.protectedHeader.typ !== 'JWT' || verified.payload.nonce !== tx.nonce || typeof verified.payload.sub !== 'string') throw new Error('invalid claims')
    subject = verified.payload.sub
  } catch {
    return error('统一账号身份令牌验证失败。', 401)
  }
  const meResponse = await universalFetch(env, '/v1/me', {
    headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' },
  })
  const me: MeResponse = await meResponse.json<MeResponse>().catch(() => ({}))
  if (!meResponse.ok || me.sub !== subject || me.productId !== 'blendproof' || !hasLoginPermission(me.permissions)) {
    return error('当前账号没有 BlendProof 使用资格。', 403)
  }
  const user = await bindOrCreateUser(env, issuer, subject, tx.local_user_id, hasAdminPermission(me.permissions), universalProfile(me))
  if (user instanceof Response) return user
  return issueSession(env, user, 302, { source: 'universal', ttlSeconds: OIDC_SESSION_SECONDS, location: tx.return_to,
    universalRefreshToken: tokens.refresh_token })
}

export async function bindOrCreateUser(env: AuthEnv, issuer: string, subject: string, requestedLocalId: string | null,
  productAdmin: boolean, profile: UniversalProfile = { email: null, displayName: null }): Promise<AuthUser | Response> {
  const existing = await env.DB.prepare(`SELECT u.id, u.email, u.display_name, u.created_at, b.product_admin
    FROM identity_bindings b JOIN users u ON u.id = b.local_user_id
    WHERE b.issuer = ? AND b.external_subject = ? AND u.disabled_at IS NULL`)
    .bind(issuer, subject).first<{ id: string; email: string; display_name: string; created_at: string; product_admin: number }>()
  const now = new Date().toISOString()
  if (existing) {
    const email = profile.email ?? existing.email
    const displayName = profile.displayName ?? existing.display_name
    try {
      await env.DB.batch([
        env.DB.prepare('UPDATE identity_bindings SET last_verified_at = ?, product_admin = ? WHERE issuer = ? AND external_subject = ?')
          .bind(now, productAdmin ? 1 : 0, issuer, subject),
        env.DB.prepare('UPDATE users SET email=?, display_name=?, updated_at=? WHERE id=? AND disabled_at IS NULL')
          .bind(email, displayName, now, existing.id),
      ])
    } catch { return error('Universal 账号资料与现有 BlendProof 账号冲突。', 409) }
    return { id: existing.id, email, displayName,
      role: productAdmin ? 'admin' : 'user', createdAt: existing.created_at }
  }
  const localId = requestedLocalId ?? randomHex(16)
  if (requestedLocalId) {
    const local = await env.DB.prepare('SELECT id, email, display_name, created_at FROM users WHERE id = ? AND disabled_at IS NULL')
      .bind(localId).first<{ id: string; email: string; display_name: string; created_at: string }>()
    if (!local) return error('待绑定的 BlendProof 账号不存在。', 409)
    const email = profile.email ?? local.email
    const displayName = profile.displayName ?? local.display_name
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO identity_bindings
          (id, provider, issuer, external_subject, local_user_id, product_admin, linked_at, last_verified_at, created_by)
          VALUES (?, 'universal', ?, ?, ?, ?, ?, ?, 'user_binding')`)
          .bind(randomHex(16), issuer, subject, localId, productAdmin ? 1 : 0, now, now),
        env.DB.prepare('UPDATE users SET email=?, display_name=?, updated_at=? WHERE id=? AND disabled_at IS NULL')
          .bind(email, displayName, now, localId),
      ])
    } catch { return error('统一账号或 BlendProof 账号已绑定其他身份。', 409) }
    return { id: local.id, email, displayName,
      role: productAdmin ? 'admin' : 'user', createdAt: local.created_at }
  }
  const email = profile.email ?? `${subject.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48) || localId}@identity.invalid`
  const displayName = profile.displayName ?? 'Universal 用户'
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users
        (id, email, password_hash, display_name, role, invite_id, disabled_at, created_at, updated_at)
        VALUES (?, ?, 'external-identity-only', ?, 'user', NULL, NULL, ?, ?)`).bind(localId, email, displayName, now, now),
      env.DB.prepare(`INSERT INTO identity_bindings
        (id, provider, issuer, external_subject, local_user_id, product_admin, linked_at, last_verified_at, created_by)
        VALUES (?, 'universal', ?, ?, ?, ?, ?, ?, 'first_login')`)
        .bind(randomHex(16), issuer, subject, localId, productAdmin ? 1 : 0, now, now),
    ])
  } catch { return error('无法创建 BlendProof 业务身份。', 409) }
  return { id: localId, email, displayName, role: productAdmin ? 'admin' : 'user', createdAt: now }
}

function configuredIssuer(env: AuthEnv): string | null {
  if (!env.UNIVERSAL_OIDC_ISSUER) return null
  try {
    const url = new URL(env.UNIVERSAL_OIDC_ISSUER)
    return url.protocol === 'https:' && url.origin === env.UNIVERSAL_OIDC_ISSUER ? url.origin : null
  } catch { return null }
}
function universalFetch(env: AuthEnv, path: string, init?: RequestInit) {
  const target = new URL(path, env.UNIVERSAL_OIDC_ISSUER)
  return env.UNIVERSAL_OIDC_SERVICE ? env.UNIVERSAL_OIDC_SERVICE.fetch(new Request(target, init)) : fetch(target, init)
}
function validClientId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value) }
function callbackUrl(env: AuthEnv) { return `${env.APP_ORIGIN}/api/auth/universal/callback` }
function safeReturnTo(value: string | null) { return value && /^\/(?!\/)[^\r\n]{0,512}$/.test(value) ? value : '/?account=connected' }
function safeOpaque(value: string | null, max: number): value is string { return Boolean(value && value.length <= max && /^[A-Za-z0-9._~-]+$/.test(value)) }
function hasLoginPermission(value: unknown) { return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).login === true) }
function hasAdminPermission(value: unknown) { return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).product_admin === true) }
function privateHeaders() { return { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }
function error(message: string, status: number) { return Response.json({ error: message }, { status, headers: privateHeaders() }) }
function randomHex(bytes: number) { const value = crypto.getRandomValues(new Uint8Array(bytes)); return [...value].map((item) => item.toString(16).padStart(2, '0')).join('') }
function randomBase64Url(bytes: number) { const value = crypto.getRandomValues(new Uint8Array(bytes)); return base64Url(value) }
async function sha256Hex(value: string) { const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); return [...bytes].map((item) => item.toString(16).padStart(2, '0')).join('') }
async function sha256Base64Url(value: string) { return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))) }
function base64Url(value: Uint8Array) { let binary = ''; value.forEach((byte) => { binary += String.fromCharCode(byte) }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
