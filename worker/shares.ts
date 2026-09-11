import { publicAssetContentTypes } from '../server/asset-policy.js'
import { scryptAsync } from '@noble/hashes/scrypt.js'
import { enforceRateLimit, rateLimitRules } from './rate-limit.js'
import type { UploadEnv } from './uploads.js'

export type ShareEnv = UploadEnv & { SHARE_ACCESS_SECRET: string; SHARE_ACCESS_SECRET_PREVIOUS?: string }

type ProjectRow = { id: string; name: string; owner_capability_hash: string; storage_namespace: string; status: string; asset_version: number; expires_at: string | null }
type ShareRow = {
  id: string; project_id: string; password_hash: string | null; expires_at: string | null
  comments_permission: 'read_only' | 'comment'; revoked_at: string | null; created_at: string; updated_at: string
}
type CommentRow = {
  id: string; project_id: string; object_name: string | null; position_json: string; normal_json: string
  camera_json: string; body: string; author_name: string; status: 'open' | 'resolved'; author_id: string | null
  author_type: 'owner' | 'guest'; created_at: string; updated_at: string
}
type ReadyAssetRow = { object_key: string; content_type: string; byte_size: number; etag: string | null }

const DEFAULT_SHARE_TTL_MS = 24 * 60 * 60_000

/** Returns null when the request does not belong to the share/review surface. */
export async function handleShareRequest(request: Request, env: ShareEnv, url: URL): Promise<Response | null> {
  const projectShare = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]{1,64})\/shares$/)
  if (projectShare && request.method === 'POST') {
    const originError = mutationOriginError(request, env)
    return originError ?? createShare(request, env, projectShare[1])
  }
  const revoke = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]{1,64})\/shares\/([A-Za-z0-9:_-]{1,96})$/)
  if (revoke && request.method === 'DELETE') {
    const originError = mutationOriginError(request, env)
    return originError ?? revokeShare(request, env, revoke[1], revoke[2])
  }
  const ownerComments = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]{1,64})\/comments$/)
  if (ownerComments && request.method === 'GET') return ownerCommentList(request, env, ownerComments[1])
  if (ownerComments && request.method === 'POST') {
    const originError = mutationOriginError(request, env)
    return originError ?? createOwnerComment(request, env, ownerComments[1])
  }
  const ownerComment = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]{1,64})\/comments\/([A-Za-z0-9_-]{1,64})$/)
  if (ownerComment && request.method === 'PATCH') {
    const originError = mutationOriginError(request, env)
    return originError ?? updateOwnerComment(request, env, ownerComment[1], ownerComment[2])
  }
  const access = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32})\/access$/)
  if (access && request.method === 'POST') {
    const originError = mutationOriginError(request, env)
    return originError ?? accessShare(request, env, access[1])
  }
  const status = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32})\/status$/)
  if (status && request.method === 'GET') return shareStatus(request, env, status[1])
  const asset = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32})\/(model\.glb|manifest\.json)$/)
  if (asset && request.method === 'GET') return shareAsset(request, env, asset[1], asset[2] as 'model.glb' | 'manifest.json')
  const guestComments = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32})\/comments$/)
  if (guestComments && request.method === 'POST') {
    const originError = mutationOriginError(request, env)
    return originError ?? createGuestComment(request, env, guestComments[1])
  }
  const load = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32})$/)
  if (load && request.method === 'GET') return loadShare(request, env, load[1])
  return null
}

async function createShare(request: Request, env: ShareEnv, projectId: string): Promise<Response> {
  const project = await authorizeOwner(request, env, projectId)
  if (project instanceof Response) return project
  if (project.status !== 'ready') return error('项目尚未准备好分享。', 409)
  const body = await readJson<Record<string, unknown>>(request)
  if (!body) return error('分享设置无效。', 400)
  if (Object.keys(body).some((key) => !['password', 'expiresAt', 'commentsPermission'].includes(key))) return error('分享设置无效。', 400)
  const permission = body.commentsPermission ?? 'read_only'
  if (permission !== 'read_only' && permission !== 'comment') return error('评论权限无效。', 400)
  const nowMs = Date.now()
  const configured = await env.DB.prepare('SELECT max_share_hours FROM platform_settings WHERE id = 1')
    .first<{ max_share_hours: number }>()
  const maxShareHours = configured?.max_share_hours ?? 48
  const maxShareTtlMs = maxShareHours * 60 * 60_000
  const requestedExpiry = body.expiresAt === undefined || body.expiresAt === null || body.expiresAt === ''
    ? nowMs + DEFAULT_SHARE_TTL_MS
    : Date.parse(String(body.expiresAt))
  if (!Number.isFinite(requestedExpiry) || requestedExpiry <= nowMs || requestedExpiry > nowMs + maxShareTtlMs) {
    return error(`分享有效期必须在未来 ${maxShareHours} 小时内；默认保留 24 小时。`, 400)
  }
  if (project.expires_at && requestedExpiry > Date.parse(project.expires_at)) {
    return error('分享有效期不能超过该项目的 48 小时保留上限。', 400)
  }
  const expiresAt = new Date(requestedExpiry).toISOString()
  const password = body.password === undefined || body.password === null || body.password === '' ? null : body.password
  if (password !== null && (typeof password !== 'string' || password.length < 4 || password.length > 200)) {
    return error('分享密码需要 4 到 200 个字符。', 400)
  }
  if (password !== null && !validShareSecret(env)) return error('分享访问服务未配置。', 503)
  const token = randomHex(16)
  const id = randomHex(16)
  const now = new Date().toISOString()
  try {
    await env.DB.prepare(`INSERT INTO shares
      (id, project_id, token_hash, password_hash, expires_at, comments_permission, revoked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .bind(id, projectId, await sha256Text(token), password === null ? null : await hashPassword(password),
        expiresAt, permission, now, now).run()
  } catch {
    return error('项目当前不能创建分享。', 409)
  }
  return Response.json({ id, token, shareUrl: `/s/${token}`, passwordProtected: password !== null,
    expiresAt, commentsPermission: permission }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
}

async function revokeShare(request: Request, env: ShareEnv, projectId: string, shareId: string): Promise<Response> {
  const project = await authorizeOwner(request, env, projectId)
  if (project instanceof Response) return project
  if (project.status !== 'ready') return error('找不到项目。', 404)
  const result = await env.DB.prepare(`UPDATE shares SET revoked_at = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND revoked_at IS NULL`).bind(new Date().toISOString(), new Date().toISOString(), shareId, projectId).run()
  return result.meta.changes === 1 ? new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } }) : error('找不到可撤销的分享。', 404)
}

async function ownerCommentList(request: Request, env: ShareEnv, projectId: string): Promise<Response> {
  const project = await authorizeOwner(request, env, projectId)
  if (project instanceof Response) return project
  if (project.status !== 'ready') return error('找不到项目。', 404)
  const rows = await commentsFor(env, projectId)
  return Response.json({ comments: rows.map(toOwnerComment) }, { headers: { 'Cache-Control': 'private, no-store' } })
}

async function createOwnerComment(request: Request, env: ShareEnv, projectId: string): Promise<Response> {
  const project = await authorizeOwner(request, env, projectId)
  if (project instanceof Response) return project
  if (project.status !== 'ready') return error('找不到项目。', 404)
  const draft = await readJson<Record<string, unknown>>(request)
  if (!isCommentDraft(draft)) return error('评论内容或锚点无效。', 400)
  const comment = await insertComment(env, projectId, draft, 'owner')
  return Response.json({ comment: toOwnerComment(comment) }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
}

async function updateOwnerComment(request: Request, env: ShareEnv, projectId: string, commentId: string): Promise<Response> {
  const project = await authorizeOwner(request, env, projectId)
  if (project instanceof Response) return project
  if (project.status !== 'ready') return error('找不到项目。', 404)
  const patch = await readJson<Record<string, unknown>>(request)
  if (!patch || Object.keys(patch).some((key) => key !== 'body' && key !== 'status') ||
    (patch.body !== undefined && (typeof patch.body !== 'string' || !patch.body.trim() || patch.body.trim().length > 5000)) ||
    (patch.status !== undefined && patch.status !== 'open' && patch.status !== 'resolved') ||
    (patch.body === undefined && patch.status === undefined)) return error('评论更新内容无效。', 400)
  const current = await env.DB.prepare(`SELECT ${commentFields} FROM comments WHERE id = ? AND project_id = ?`)
    .bind(commentId, projectId).first<CommentRow>()
  if (!current) return error('找不到评论。', 404)
  const body = typeof patch.body === 'string' ? patch.body.trim() : current.body
  const status = patch.status === 'open' || patch.status === 'resolved' ? patch.status : current.status
  const now = new Date().toISOString()
  await env.DB.prepare('UPDATE comments SET body = ?, status = ?, updated_at = ? WHERE id = ? AND project_id = ?')
    .bind(body, status, now, commentId, projectId).run()
  return Response.json({ comment: toOwnerComment({ ...current, body, status, updated_at: now }) }, { headers: { 'Cache-Control': 'private, no-store' } })
}

async function accessShare(request: Request, env: ShareEnv, token: string): Promise<Response> {
  const found = await resolveShare(env, token, false)
  if (found instanceof Response) return found
  const { share } = found
  if (!share.password_hash) return noContent(share)
  const limitError = await enforceRateLimit(request, env, rateLimitRules.passwordAttempt, share.id)
  if (limitError) return limitError
  const body = await readJson<Record<string, unknown>>(request)
  if (!body || Object.keys(body).some((key) => key !== 'password') || typeof body.password !== 'string' ||
    body.password.length < 4 || body.password.length > 200 || !await verifyPassword(body.password, share.password_hash)) {
    return shareError('分享密码不正确。', 403, share)
  }
  if (!validShareSecret(env)) return shareError('分享访问服务未配置。', 503, share)
  const cookie = await accessCookie(env, token, share.expires_at)
  return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie, 'Cache-Control': 'private, no-store' } })
}

async function shareStatus(request: Request, env: ShareEnv, token: string): Promise<Response> {
  const found = await resolveShare(env, token, false)
  if (found instanceof Response) return found
  const { share } = found
  if (share.password_hash && !validShareSecret(env)) return shareError('分享访问服务未配置。', 503, share)
  return Response.json({ passwordRequired: Boolean(share.password_hash) && !await hasAccessCookie(request, env, token),
    commentsPermission: share.comments_permission }, { headers: privateHeaders(share) })
}

async function loadShare(request: Request, env: ShareEnv, token: string): Promise<Response> {
  const found = await resolveShare(env, token, true, request)
  if (found instanceof Response) return found
  const { share, project } = found
  const manifest = await readManifest(env, project)
  if (manifest === null) return shareError('分享模型不存在。', 404, share)
  const comments = await commentsFor(env, project.id)
  return Response.json({ name: project.name, modelUrl: `/api/shares/${token}/model.glb`,
    manifest, comments: comments.map(toPublicComment), commentsPermission: share.comments_permission,
    expiresAt: share.expires_at }, { headers: privateHeaders(share) })
}

async function shareAsset(request: Request, env: ShareEnv, token: string, asset: 'model.glb' | 'manifest.json'): Promise<Response> {
  const found = await resolveShare(env, token, true, request)
  if (found instanceof Response) return found
  const { share, project } = found
  if (asset === 'manifest.json') {
    const manifest = await readManifest(env, project)
    return manifest === null
      ? shareError('分享模型不存在。', 404, share)
      : Response.json(manifest, { headers: privateHeaders(share) })
  }
  const stored = await readyAsset(env, project, asset)
  if (!stored) return shareError('分享模型不存在。', 404, share)
  const object = await env.ASSETS.get(stored.object_key)
  if (!object || stored.etag === null || object.size !== stored.byte_size || object.httpEtag !== stored.etag ||
    stored.content_type !== publicAssetContentTypes[asset] || object.httpMetadata?.contentType !== publicAssetContentTypes[asset]) {
    return shareError('分享模型不存在。', 404, share)
  }
  return new Response(object.body, { headers: {
    'Content-Type': publicAssetContentTypes[asset],
    'Content-Length': String(object.size), 'ETag': object.httpEtag, ...privateHeaders(share),
  } })
}

async function createGuestComment(request: Request, env: ShareEnv, token: string): Promise<Response> {
  const found = await resolveShare(env, token, true, request)
  if (found instanceof Response) return found
  const { share, project } = found
  if (share.comments_permission !== 'comment') return shareError('该分享不允许访客添加评论。', 403, share)
  const limitError = await enforceRateLimit(request, env, rateLimitRules.guestComment, share.id)
  if (limitError) return limitError
  const draft = await readJson<Record<string, unknown>>(request)
  if (!isCommentDraft(draft)) return shareError('评论内容或锚点无效。', 400, share)
  const comment = await insertGuestComment(env, project.id, share.id, draft)
  if (!comment) return shareError('该分享已失效或不允许评论。', 403, share)
  return Response.json({ comment: toPublicComment(comment) }, { status: 201, headers: privateHeaders(share) })
}

async function resolveShare(env: ShareEnv, token: string, passwordRequired: boolean, request?: Request): Promise<{ share: ShareRow; project: ProjectRow } | Response> {
  const row = await env.DB.prepare(`SELECT s.id, s.project_id, s.password_hash, s.expires_at, s.comments_permission,
    s.revoked_at, s.created_at, s.updated_at FROM shares s JOIN projects p ON p.id = s.project_id
    WHERE s.token_hash = ? AND p.status = 'ready'`).bind(await sha256Text(token)).first<ShareRow>()
  if (!row || row.revoked_at) return error('分享链接不存在或已失效。', 404)
  if (row.expires_at !== null && Date.parse(row.expires_at) <= Date.now()) return shareError('分享链接已过期。', 410, row)
  const project = await env.DB.prepare("SELECT id, name, owner_capability_hash, storage_namespace, status, asset_version, expires_at FROM projects WHERE id = ? AND status = 'ready' AND (expires_at IS NULL OR expires_at > ?)")
    .bind(row.project_id, new Date().toISOString()).first<ProjectRow>()
  if (!project) return error('分享链接不存在或已失效。', 404)
  if (row.password_hash && !validShareSecret(env)) return shareError('分享访问服务未配置。', 503, row)
  if (passwordRequired && row.password_hash && (!request || !await hasAccessCookie(request, env, token))) {
    return shareError('该分享需要密码。', 401, row, { passwordRequired: true })
  }
  return { share: row, project }
}

async function readManifest(env: ShareEnv, project: ProjectRow): Promise<Record<string, unknown> | null> {
  const stored = await readyAsset(env, project, 'manifest.json')
  if (!stored) return null
  const object = await env.ASSETS.get(stored.object_key)
  if (!object || object.size > 512 * 1024 || object.size !== stored.byte_size || stored.etag === null ||
    object.httpEtag !== stored.etag || stored.content_type !== publicAssetContentTypes['manifest.json'] ||
    object.httpMetadata?.contentType !== publicAssetContentTypes['manifest.json']) return null
  try {
    const value = JSON.parse(await new Response(object.body).text())
    return sanitizeManifest(value)
  } catch { return null }
}
async function readyAsset(env: ShareEnv, project: ProjectRow, asset: 'model.glb' | 'manifest.json') {
  return env.DB.prepare(`SELECT object_key, content_type, byte_size, etag FROM project_assets
    WHERE project_id = ? AND asset_version = ? AND asset_name = ? AND status = 'ready'
    LIMIT 1`).bind(project.id, project.asset_version, asset).first<ReadyAssetRow>()
}

function sanitizeManifest(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.scene !== 'string' || record.scene.length > 256 ||
    (record.camera !== undefined && record.camera !== null && typeof record.camera !== 'string') ||
    !isStringArray(record.collections, 2_000) || !Array.isArray(record.objects) || record.objects.length > 10_000) return null
  const objects: Array<{ name: string; type: string; collections: string[] }> = []
  for (const value of record.objects) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const object = value as Record<string, unknown>
    if (typeof object.name !== 'string' || object.name.length > 256 || typeof object.type !== 'string' || object.type.length > 64 ||
      !isStringArray(object.collections, 2_000)) return null
    objects.push({ name: object.name, type: object.type, collections: object.collections })
  }
  const manifest: Record<string, unknown> = { scene: record.scene, objects, collections: record.collections }
  if (record.camera !== undefined) manifest.camera = record.camera
  if (record.cameras !== undefined) {
    if (!Array.isArray(record.cameras) || record.cameras.length > 256) return null
    const cameras: Array<{ name: string; projection: string }> = []
    for (const value of record.cameras) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      const camera = value as Record<string, unknown>
      if (Object.keys(camera).some((key) => key !== 'name' && key !== 'projection') ||
        typeof camera.name !== 'string' || camera.name.length > 256 ||
        typeof camera.projection !== 'string' || camera.projection.length > 32) return null
      cameras.push({ name: camera.name, projection: camera.projection })
    }
    manifest.cameras = cameras
  }
  if (record.materials !== undefined) {
    if (!isStringArray(record.materials, 2_000)) return null
    manifest.materials = record.materials
  }
  if (record.export !== undefined) {
    if (!record.export || typeof record.export !== 'object' || Array.isArray(record.export)) return null
    const source = record.export as Record<string, unknown>
    const allowed = ['glbBytes', 'objectCount']
    if (Object.keys(source).some((key) => !allowed.includes(key)) || Object.values(source).some((item) =>
      typeof item !== 'number' || !Number.isFinite(item) || item < 0)) return null
    manifest.export = { ...source }
  }
  return manifest
}
function isStringArray(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every((item) => typeof item === 'string' && item.length <= 256)
}

const commentFields = 'id, project_id, object_name, position_json, normal_json, camera_json, body, author_name, status, author_id, author_type, created_at, updated_at'
async function commentsFor(env: ShareEnv, projectId: string) {
  return (await env.DB.prepare(`SELECT ${commentFields} FROM comments WHERE project_id = ? ORDER BY created_at ASC, id ASC`)
    .bind(projectId).all<CommentRow>()).results
}
async function insertComment(env: ShareEnv, projectId: string, draft: Record<string, unknown>, authorType: 'owner' | 'guest'): Promise<CommentRow> {
  const now = new Date().toISOString()
  const comment: CommentRow = { id: randomHex(16), project_id: projectId, object_name: draft.objectName as string | null,
    position_json: JSON.stringify(draft.position), normal_json: JSON.stringify(draft.normal), camera_json: JSON.stringify(draft.camera),
    body: (draft.body as string).trim(), author_name: (draft.authorName as string).trim(), status: 'open', author_id: null,
    author_type: authorType, created_at: now, updated_at: now }
  await env.DB.prepare(`INSERT INTO comments (${commentFields}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(comment.id, comment.project_id, comment.object_name, comment.position_json, comment.normal_json, comment.camera_json,
      comment.body, comment.author_name, comment.status, comment.author_id, comment.author_type, now, now).run()
  return comment
}
async function insertGuestComment(env: ShareEnv, projectId: string, shareId: string, draft: Record<string, unknown>): Promise<CommentRow | null> {
  const now = new Date().toISOString()
  const comment: CommentRow = { id: randomHex(16), project_id: projectId, object_name: draft.objectName as string | null,
    position_json: JSON.stringify(draft.position), normal_json: JSON.stringify(draft.normal), camera_json: JSON.stringify(draft.camera),
    body: (draft.body as string).trim(), author_name: (draft.authorName as string).trim(), status: 'open', author_id: null,
    author_type: 'guest', created_at: now, updated_at: now }
  const result = await env.DB.prepare(`INSERT INTO comments (${commentFields})
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM shares s JOIN projects p ON p.id = s.project_id
      WHERE s.id = ? AND s.project_id = ? AND s.comments_permission = 'comment'
        AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?)
        AND p.status = 'ready'
    )`).bind(comment.id, comment.project_id, comment.object_name, comment.position_json, comment.normal_json,
    comment.camera_json, comment.body, comment.author_name, comment.status, comment.author_id,
    comment.author_type, now, now, shareId, projectId, now).run()
  return result.meta.changes === 1 ? comment : null
}
function toOwnerComment(row: CommentRow) { return { id: row.id, projectId: row.project_id, objectName: row.object_name,
  position: parseJson(row.position_json), normal: parseJson(row.normal_json), camera: parseJson(row.camera_json), body: row.body,
  authorName: row.author_name, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at } }
function toPublicComment(row: CommentRow) { const { projectId: _projectId, ...comment } = toOwnerComment(row); return comment }
function parseJson(value: string) { return JSON.parse(value) as unknown }

async function authorizeOwner(request: Request, env: ShareEnv, projectId: string): Promise<ProjectRow | Response> {
  const capability = request.headers.get('x-blendproof-owner')
  if (!capability) return error('缺少所有者凭据。', 401)
  const project = await env.DB.prepare('SELECT id, name, owner_capability_hash, storage_namespace, status, asset_version, expires_at FROM projects WHERE id = ?')
    .bind(projectId).first<ProjectRow>()
  if (!project || project.owner_capability_hash !== await sha256Text(capability)) return error('所有者凭据无效。', 403)
  return project
}

function isCommentDraft(value: Record<string, unknown> | null): value is Record<string, unknown> {
  if (!value || Object.keys(value).some((key) => !['objectName', 'position', 'normal', 'camera', 'body', 'authorName'].includes(key))) return false
  return typeof value.body === 'string' && value.body.trim().length > 0 && value.body.trim().length <= 5000 &&
    typeof value.authorName === 'string' && value.authorName.trim().length > 0 && value.authorName.trim().length <= 120 &&
    (value.objectName === null || typeof value.objectName === 'string') && (value.objectName === null || value.objectName.length <= 256) &&
    isVec3(value.position) && isVec3(value.normal) && value.normal.some((item) => Math.abs(item) > 1e-8) && isCamera(value.camera)
}
function isVec3(value: unknown): value is [number, number, number] { return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) }
function isCamera(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const camera = value as Record<string, unknown>
  const keys = Object.keys(camera)
  if (keys.some((key) => !['projection', 'position', 'quaternion', 'target', 'fov', 'zoom', 'orthographicHeight'].includes(key))) return false
  const quaternion = camera.quaternion
  const transformValid = isVec3(camera.position) && isVec3(camera.target) && Array.isArray(quaternion) &&
    quaternion.length === 4 && quaternion.every(Number.isFinite) && quaternion.some((item) => Math.abs(item) > 1e-8)
  if (!transformValid) return false
  if (camera.projection === 'perspective') {
    return typeof camera.fov === 'number' && Number.isFinite(camera.fov) && camera.fov > 0 && camera.fov < 180 &&
      camera.zoom === undefined && camera.orthographicHeight === undefined
  }
  return camera.projection === 'orthographic' && typeof camera.zoom === 'number' && Number.isFinite(camera.zoom) && camera.zoom > 0 &&
    camera.fov === undefined && (camera.orthographicHeight === undefined ||
      (typeof camera.orthographicHeight === 'number' && Number.isFinite(camera.orthographicHeight) && camera.orthographicHeight > 0))
}

async function hashPassword(password: string) {
  const salt = new Uint8Array(16); crypto.getRandomValues(salt)
  const iterations = 100_000
  const derived = await pbkdf2(password, salt, iterations)
  return `pbkdf2-sha256$${iterations}$${hex(salt)}$${hex(derived)}`
}
async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split('$')
  if (parts.length === 4 && parts[0] === 'pbkdf2-sha256' && /^[1-9][0-9]{4,6}$/.test(parts[1]) &&
    /^[a-f0-9]{32}$/.test(parts[2]) && /^[a-f0-9]{64}$/.test(parts[3])) {
    const iterations = Number(parts[1])
    if (iterations < 100_000 || iterations > 1_000_000) return false
    return constantTimeEqual(await pbkdf2(password, fromHex(parts[2]), iterations), fromHex(parts[3]))
  }
  if (parts.length === 3 && parts[0] === 'scrypt' && /^[a-f0-9]{32}$/.test(parts[1]) && /^[a-f0-9]{64}$/.test(parts[2])) {
    const actual = await scryptAsync(new TextEncoder().encode(password), fromHex(parts[1]), { N: 16_384, r: 8, p: 1, dkLen: 32 })
    return constantTimeEqual(actual, fromHex(parts[2]))
  }
  return false
}
async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(salt), iterations }, key, 256))
}
async function accessCookie(env: ShareEnv, token: string, expiresAt: string | null) {
  const remaining = expiresAt === null ? 86_400 : Math.min(86_400, Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)))
  const expires = Math.floor(Date.now() / 1000) + remaining
  return `bp_access_${token.slice(0, 12)}=${await cookieValue(env, token, expires)}; Secure; HttpOnly; SameSite=Lax; Path=/api/shares/${token}; Max-Age=${remaining}`
}
async function hasAccessCookie(request: Request, env: ShareEnv, token: string) {
  const name = `bp_access_${token.slice(0, 12)}=`
  const raw = request.headers.get('cookie')?.split(';').map((item) => item.trim()).find((item) => item.startsWith(name))?.slice(name.length) ?? ''
  const [version, expiresText, signature] = raw.split('.')
  const expires = Number(expiresText)
  if (version !== 'v1' || !Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000) || !/^[a-f0-9]{64}$/.test(signature ?? '')) return false
  const expected = await cookieValues(env, token, expires)
  return expected.some((value) => constantTimeEqual(fromHex(signature), fromHex(value)))
}
async function cookieValue(env: ShareEnv, token: string, expires: number) {
  return `v1.${expires}.${(await cookieValues(env, token, expires))[0]}`
}
async function cookieValues(env: ShareEnv, token: string, expires: number) {
  const secrets = [env.SHARE_ACCESS_SECRET, env.SHARE_ACCESS_SECRET_PREVIOUS]
    .filter((secret): secret is string => typeof secret === 'string' && secret.length >= 32)
  if (!secrets.length) throw new Error('分享访问密钥未配置。')
  return Promise.all(secrets.map(async (secret) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`blendproof-share:v1:${token}:${expires}`))))
  }))
}
function privateHeaders(_share: ShareRow) { return { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }
function noContent(share: ShareRow) { return new Response(null, { status: 204, headers: privateHeaders(share) }) }
function shareError(message: string, status: number, share: ShareRow, extra: Record<string, unknown> = {}) { return Response.json({ error: message, ...extra }, { status, headers: privateHeaders(share) }) }
function error(message: string, status: number) { return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }) }
function mutationOriginError(request: Request, env: ShareEnv) { return request.headers.get('origin') === env.APP_ORIGIN ? null : error('请求来源无效。', 403) }
function readJson<T>(request: Request): Promise<T | null> { return /^application\/json(?:;charset=utf-8)?$/.test((request.headers.get('content-type') ?? '').toLowerCase().replace(/\s+/g, '')) ? request.json<T>().catch(() => null) : Promise.resolve(null) }
function randomHex(bytes: number) { const value = new Uint8Array(bytes); crypto.getRandomValues(value); return hex(value) }
function hex(value: Uint8Array) { return [...value].map((item) => item.toString(16).padStart(2, '0')).join('') }
function fromHex(value: string) { const output = new Uint8Array(value.length / 2); for (let i = 0; i < output.length; i += 1) output[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16); return output }
function constantTimeEqual(left: Uint8Array, right: Uint8Array) { if (left.length !== right.length) return false; let result = 0; for (let i = 0; i < left.length; i += 1) result |= left[i] ^ right[i]; return result === 0 }
async function sha256Text(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return hex(new Uint8Array(digest)) }
function validShareSecret(env: ShareEnv) {
  return typeof env.SHARE_ACCESS_SECRET === 'string' && env.SHARE_ACCESS_SECRET.length >= 32 &&
    env.SHARE_ACCESS_SECRET !== env.UPLOAD_SIGNING_SECRET &&
    (env.SHARE_ACCESS_SECRET_PREVIOUS === undefined || env.SHARE_ACCESS_SECRET_PREVIOUS !== env.UPLOAD_SIGNING_SECRET)
}
