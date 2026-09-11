import { assertPublicAssetContent, assertPublicProjectAsset, publicAssetContentTypes } from '../server/asset-policy.js'
import type { PublicProjectAsset } from '../server/contracts.js'
import { enforceRateLimit, rateLimitRules } from './rate-limit.js'
import { R2ProjectStorage, r2AssetKey } from './r2-storage.js'

export type UploadEnv = Env & { UPLOAD_SIGNING_SECRET: string }

type ExpectedAsset = {
  name: PublicProjectAsset
  contentType: string
  byteSize: number
  sha256: string
}

type ProjectRow = {
  id: string
  owner_capability_hash: string
  storage_namespace: string
  status: string
  asset_version: number
}

type IntentRow = {
  id: string
  project_id: string
  intent_token_hash: string
  asset_version: number
  staging_namespace: string
  expected_assets_json: string
  status: string
  expires_at: string
}

export async function initializeProject(request: Request, env: UploadEnv): Promise<Response> {
  const limitError = await enforceRateLimit(request, env, rateLimitRules.projectCreate)
  if (limitError) return limitError
  const body = await readJson<{ name?: unknown }>(request)
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 256) {
    return jsonError('项目名称无效。', 400)
  }
  const id = randomHex(16)
  const ownerCapability = randomHex(32)
  const now = new Date().toISOString()
  await env.DB.prepare(`INSERT INTO projects
    (id, name, owner_capability_hash, storage_namespace, status, asset_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', 1, ?, ?)`)
    .bind(id, body.name.trim(), await sha256Text(ownerCapability), randomHex(16), now, now).run()
  return Response.json({ id, name: body.name.trim(), ownerCapability, status: 'pending' }, { status: 201 })
}

export async function createUploadIntent(request: Request, env: UploadEnv, projectId: string): Promise<Response> {
  if (!validSigningSecret(env)) return jsonError('上传签名服务未配置。', 503)
  const project = await authorizeOwner(request, env, projectId)
  if (project instanceof Response) return project
  // The owner capability has already been verified; scope this limit to that
  // capability and project so one owner cannot create unbounded intent rows.
  const limitError = await enforceRateLimit(request, env, rateLimitRules.uploadIntent,
    `${projectId}:${request.headers.get('x-blendproof-owner') ?? ''}`)
  if (limitError) return limitError
  if (!['pending', 'uploading'].includes(project.status)) return jsonError('项目当前不能上传。', 409)
  const body = await readJson<{ idempotencyKey?: unknown; assets?: unknown }>(request)
  const assets = parseExpectedAssets(body?.assets)
  if (!body || typeof body.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(body.idempotencyKey) || !assets) {
    return jsonError('上传意图参数无效。', 400)
  }

  const expectedJson = JSON.stringify(assets)
  const existing = await env.DB.prepare(`SELECT id, project_id, intent_token_hash, asset_version,
    staging_namespace, expected_assets_json, status, expires_at FROM upload_intents
    WHERE project_id = ? AND idempotency_key = ?`)
    .bind(projectId, body.idempotencyKey).first<IntentRow>()
  if (existing && Date.parse(existing.expires_at) > Date.now() && existing.status === 'uploading') {
    if (existing.expected_assets_json !== expectedJson) return jsonError('幂等键对应的资源清单不同。', 409)
    return uploadIntentResponse(projectId, existing, await deriveIntentToken(env, existing.id), 200)
  }
  if (existing) {
    await expireIntentAndAdvance(env, project, existing)
    return jsonError('旧上传意图已过期，请使用新的幂等键重试。', 409)
  }
  const versionIntent = await env.DB.prepare(`SELECT id, project_id, intent_token_hash, asset_version,
    staging_namespace, expected_assets_json, status, expires_at FROM upload_intents
    WHERE project_id = ? AND asset_version = ?`)
    .bind(projectId, project.asset_version).first<IntentRow>()
  if (versionIntent) {
    if (Date.parse(versionIntent.expires_at) > Date.now() && versionIntent.status === 'uploading') {
      return jsonError('项目已有进行中的上传。', 409)
    }
    await expireIntentAndAdvance(env, project, versionIntent)
  }

  const id = randomHex(16)
  const intentToken = await deriveIntentToken(env, id)
  const version = project.asset_version
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString()
  const now = new Date().toISOString()
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO upload_intents
        (id, project_id, idempotency_key, intent_token_hash, asset_version, staging_namespace,
         expected_assets_json, status, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?)`)
        .bind(id, projectId, body.idempotencyKey, await sha256Text(intentToken), version, randomHex(16),
          expectedJson, expiresAt, now, now),
      env.DB.prepare(`UPDATE projects SET status = 'uploading', updated_at = ?
        WHERE id = ? AND asset_version = ? AND status IN ('pending', 'uploading')`).bind(now, projectId, version),
    ])
  } catch {
    const winner = await env.DB.prepare(`SELECT id, project_id, intent_token_hash, asset_version,
      staging_namespace, expected_assets_json, status, expires_at FROM upload_intents
      WHERE project_id = ? AND idempotency_key = ?`).bind(projectId, body.idempotencyKey).first<IntentRow>()
    if (winner && winner.status === 'uploading' && Date.parse(winner.expires_at) > Date.now()) {
      if (winner.expected_assets_json !== expectedJson) return jsonError('幂等键对应的资源清单不同。', 409)
      return uploadIntentResponse(projectId, winner, await deriveIntentToken(env, winner.id), 200)
    }
    return jsonError('项目已有进行中的上传或状态已更新。', 409)
  }
  return uploadIntentResponse(projectId, { id, expires_at: expiresAt, expected_assets_json: expectedJson } as IntentRow, intentToken, 201)
}

export async function uploadAsset(request: Request, env: UploadEnv, projectId: string, assetValue: string): Promise<Response> {
  let asset: PublicProjectAsset
  try {
    assertPublicProjectAsset(assetValue)
    asset = assetValue
  } catch {
    return jsonError('资源不存在。', 404)
  }
  const intent = await authorizeIntent(request, env, projectId)
  if (intent instanceof Response) return intent
  const expected = (JSON.parse(intent.expected_assets_json) as ExpectedAsset[]).find((item) => item.name === asset)
  if (!expected) return jsonError('资源不在上传意图中。', 403)
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength !== expected.byteSize || await sha256Bytes(bytes) !== expected.sha256) {
    return jsonError('资源大小或校验和不匹配。', 422)
  }
  const requestType = (request.headers.get('content-type') ?? '').toLowerCase()
  if (requestType !== expected.contentType.toLowerCase()) return jsonError('资源 Content-Type 不匹配。', 415)
  try {
    assertPublicAssetContent(asset, bytes, expected.contentType, { allowLocalSourceMetadata: false })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '资源内容无效。', 422)
  }
  const objectKey = r2AssetKey(intent.staging_namespace, intent.asset_version, asset)
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO project_assets
      (id, project_id, upload_intent_id, asset_version, asset_name, object_key, content_type,
       byte_size, sha256, etag, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'staging', ?, ?)
      ON CONFLICT(project_id, asset_version, asset_name) DO UPDATE SET
        object_key = excluded.object_key, content_type = excluded.content_type,
        byte_size = excluded.byte_size, sha256 = excluded.sha256, etag = NULL,
        updated_at = excluded.updated_at
      WHERE project_assets.upload_intent_id = excluded.upload_intent_id
        AND project_assets.status = 'staging'`)
      .bind(randomHex(16), intent.project_id, intent.id, intent.asset_version, asset,
        objectKey, publicAssetContentTypes[asset], bytes.byteLength, expected.sha256, now, now),
    env.DB.prepare(`INSERT INTO cleanup_jobs
      (id, project_id, object_key, asset_version, kind, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'staging', 'pending', 0, ?, ?)
      ON CONFLICT(kind, object_key) DO UPDATE SET status = 'pending', last_error = NULL, updated_at = excluded.updated_at`)
      .bind(randomHex(16), intent.project_id, objectKey, intent.asset_version, now, now),
  ])
  const reservation = await env.DB.prepare(`SELECT upload_intent_id, byte_size, sha256, status
    FROM project_assets WHERE project_id = ? AND asset_version = ? AND asset_name = ?`)
    .bind(intent.project_id, intent.asset_version, asset)
    .first<{ upload_intent_id: string; byte_size: number; sha256: string; status: string }>()
  if (!reservation || reservation.upload_intent_id !== intent.id || reservation.status !== 'staging' ||
    reservation.byte_size !== expected.byteSize || reservation.sha256 !== expected.sha256) {
    return jsonError('资源上传状态冲突。', 409)
  }
  const storage = new R2ProjectStorage(env.ASSETS)
  await storage.put(intent.staging_namespace, asset, bytes, expected.contentType, intent.asset_version, {
    sha256: expected.sha256,
  })
  const object = await env.ASSETS.head(objectKey)
  const updated = await env.DB.prepare(`UPDATE project_assets SET etag = ?, updated_at = ?
    WHERE project_id = ? AND upload_intent_id = ? AND asset_version = ? AND asset_name = ?
      AND status = 'staging' AND sha256 = ? AND byte_size = ?`)
    .bind(object?.httpEtag ?? null, new Date().toISOString(), intent.project_id, intent.id,
      intent.asset_version, asset, expected.sha256, expected.byteSize).run()
  if (updated.meta.changes !== 1 || !object) return jsonError('资源登记失败，已进入清理队列。', 503)
  return new Response(null, { status: 204 })
}

export async function finalizeUpload(request: Request, env: UploadEnv, projectId: string): Promise<Response> {
  const project = await authorizeOwner(request, env, projectId)
  if (project instanceof Response) return project
  const body = await readJson<{ idempotencyKey?: unknown }>(request)
  if (!body || typeof body.idempotencyKey !== 'string') return jsonError('缺少上传幂等键。', 400)
  const intent = await env.DB.prepare(`SELECT id, project_id, intent_token_hash, asset_version,
    staging_namespace, expected_assets_json, status, expires_at FROM upload_intents
    WHERE project_id = ? AND idempotency_key = ?`)
    .bind(projectId, body.idempotencyKey).first<IntentRow>()
  if (!intent) return jsonError('上传意图不存在。', 404)
  if (intent.status === 'finalized' && project.status === 'ready') return Response.json({ id: projectId, status: 'ready' })
  if (intent.status !== 'uploading' || Date.parse(intent.expires_at) <= Date.now()) return jsonError('上传意图不可完成。', 409)
  const expected = JSON.parse(intent.expected_assets_json) as ExpectedAsset[]
  const rows = await env.DB.prepare(`SELECT asset_name, object_key, content_type, byte_size, sha256, etag FROM project_assets
    WHERE project_id = ? AND upload_intent_id = ? AND asset_version = ? AND status = 'staging'`)
    .bind(projectId, intent.id, intent.asset_version)
    .all<{ asset_name: string; object_key: string; content_type: string; byte_size: number; sha256: string; etag: string | null }>()
  if (rows.results.length !== expected.length || expected.some((asset) => !rows.results.some((row) =>
    row.asset_name === asset.name && row.byte_size === asset.byteSize && row.sha256 === asset.sha256))) {
    return jsonError('派生资源尚未完整上传。', 409)
  }
  for (const asset of expected) {
    const row = rows.results.find((item) => item.asset_name === asset.name)
    if (!row || row.object_key !== r2AssetKey(intent.staging_namespace, intent.asset_version, asset.name)) {
      return jsonError('派生资源对象键不匹配。', 409)
    }
    const object = await env.ASSETS.head(row.object_key)
    if (!object || !row.etag || object.httpEtag !== row.etag || object.size !== row.byte_size ||
      object.httpMetadata?.contentType !== publicAssetContentTypes[asset.name] ||
      object.customMetadata?.sha256 !== row.sha256) {
      return jsonError('派生资源存储校验失败。', 409)
    }
  }
  const now = new Date().toISOString()
  let results: D1Result[]
  try {
    results = await env.DB.batch([
      env.DB.prepare(`UPDATE projects SET status = 'ready', updated_at = ?
        WHERE id = ? AND status = 'uploading' AND asset_version = ?`).bind(now, projectId, intent.asset_version),
      env.DB.prepare(`UPDATE upload_intents SET status = 'finalized', updated_at = ?
        WHERE id = ? AND status = 'uploading'`).bind(now, intent.id),
      ...rows.results.map((row) => env.DB.prepare(`UPDATE project_assets SET status = 'ready', updated_at = ?
        WHERE project_id = ? AND upload_intent_id = ? AND asset_name = ? AND status = 'staging' AND etag = ?`)
        .bind(now, projectId, intent.id, row.asset_name, row.etag)),
      ...rows.results.map((row) => env.DB.prepare(`UPDATE cleanup_jobs SET status = 'done', updated_at = ?
        WHERE kind = 'staging' AND object_key = ? AND status IN ('pending', 'failed')`).bind(now, row.object_key)),
    ])
  } catch {
    return jsonError('项目状态冲突。', 409)
  }
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1 ||
    results.slice(2, 2 + rows.results.length).some((result) => result.meta.changes !== 1)) {
    return jsonError('项目状态冲突。', 409)
  }
  return Response.json({ id: projectId, status: 'ready' })
}

function parseExpectedAssets(value: unknown): ExpectedAsset[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) return null
  const assets: ExpectedAsset[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const item = raw as Record<string, unknown>
    try { assertPublicProjectAsset(item.name) } catch { return null }
    if (typeof item.contentType !== 'string' || typeof item.byteSize !== 'number' ||
      !Number.isSafeInteger(item.byteSize) || item.byteSize <= 0 ||
      typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) return null
    if (item.contentType.toLowerCase() !== publicAssetContentTypes[item.name].toLowerCase() &&
      !(item.name === 'manifest.json' && item.contentType.toLowerCase() === 'application/json')) return null
    const maximum = item.name === 'manifest.json' ? 512 * 1024 : item.name === 'thumbnail.webp' ? 10 * 1024 * 1024 : 50 * 1024 * 1024
    if (item.byteSize > maximum) return null
    assets.push({ name: item.name, contentType: item.contentType, byteSize: item.byteSize, sha256: item.sha256 })
  }
  const names = new Set(assets.map((asset) => asset.name))
  return names.size === assets.length && names.has('model.glb') && names.has('manifest.json') ? assets : null
}

async function authorizeOwner(request: Request, env: UploadEnv, projectId: string): Promise<ProjectRow | Response> {
  const capability = request.headers.get('x-blendproof-owner')
  if (!capability) return jsonError('缺少所有者凭据。', 401)
  const project = await env.DB.prepare(`SELECT id, owner_capability_hash, storage_namespace,
    status, asset_version FROM projects WHERE id = ?`).bind(projectId).first<ProjectRow>()
  if (!project || project.owner_capability_hash !== await sha256Text(capability)) return jsonError('所有者凭据无效。', 403)
  return project
}

async function authorizeIntent(request: Request, env: UploadEnv, projectId: string): Promise<IntentRow | Response> {
  const authorization = request.headers.get('authorization')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) return jsonError('缺少上传凭据。', 401)
  const intent = await env.DB.prepare(`SELECT id, project_id, intent_token_hash, asset_version,
    staging_namespace, expected_assets_json, status, expires_at FROM upload_intents
    WHERE project_id = ? AND intent_token_hash = ?`)
    .bind(projectId, await sha256Text(token)).first<IntentRow>()
  if (!intent) return jsonError('上传凭据无效。', 403)
  if (intent.status !== 'uploading' || Date.parse(intent.expires_at) <= Date.now()) return jsonError('上传凭据已失效。', 410)
  return intent
}

function readJson<T>(request: Request): Promise<T | null> {
  if (!/^application\/json(?:;charset=utf-8)?$/.test((request.headers.get('content-type') ?? '').toLowerCase().replace(/\s+/g, ''))) {
    return Promise.resolve(null)
  }
  return request.json<T>().catch(() => null)
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status })
}

function randomHex(bytes: number) {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return [...value].map((item) => item.toString(16).padStart(2, '0')).join('')
}

async function sha256Text(value: string) {
  return sha256Bytes(new TextEncoder().encode(value))
}

async function sha256Bytes(value: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(value).buffer)
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('')
}

function validSigningSecret(env: UploadEnv) {
  return typeof env.UPLOAD_SIGNING_SECRET === 'string' && env.UPLOAD_SIGNING_SECRET.length >= 32
}

async function deriveIntentToken(env: UploadEnv, intentId: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.UPLOAD_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`blendproof-upload:${intentId}`))
  return [...new Uint8Array(signature)].map((item) => item.toString(16).padStart(2, '0')).join('')
}

function uploadIntentResponse(projectId: string, intent: IntentRow, intentToken: string, status: number) {
  const assets = JSON.parse(intent.expected_assets_json) as ExpectedAsset[]
  return Response.json({
    intentToken,
    expiresAt: intent.expires_at,
    assets: assets.map((asset) => ({
      name: asset.name,
      method: 'PUT',
      url: `/api/projects/${projectId}/assets/${asset.name}`,
    })),
  }, { status })
}

async function expireIntentAndAdvance(env: UploadEnv, project: ProjectRow, intent: IntentRow) {
  if (project.asset_version !== intent.asset_version) return
  const now = new Date().toISOString()
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE upload_intents SET status = 'expired', updated_at = ?
      WHERE id = ? AND status IN ('pending', 'uploading', 'failed')`).bind(now, intent.id),
    env.DB.prepare(`UPDATE projects SET status = 'pending', asset_version = asset_version + 1, updated_at = ?
      WHERE id = ? AND asset_version = ? AND status IN ('pending', 'uploading')`)
      .bind(now, project.id, intent.asset_version),
  ])
  if (results[1].meta.changes !== 1) return
  project.asset_version += 1
  project.status = 'pending'
}
