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
  author_type: 'owner' | 'guest'; delete_token_hash: string | null; created_at: string; updated_at: string
}
type ReplyRow = {
  id: string; comment_id: string; project_id: string; body: string; author_name: string
  author_type: 'owner' | 'guest'; delete_token_hash: string | null; created_at: string
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
  // 回复路由必须在通用 comment 路由之前匹配（更具体的路径优先）。
  const ownerReply = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]{1,64})\/comments\/([A-Za-z0-9_-]{1,64})\/replies\/([A-Za-z0-9_-]{1,64})$/)
  if (ownerReply && request.method === 'DELETE') {
    const originError = mutationOriginError(request, env)
    return originError ?? deleteOwnerReply(request, env, ownerReply[1], ownerReply[2], ownerReply[3])
  }
  const ownerReplies = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]{1,64})\/comments\/([A-Za-z0-9_-]{1,64})\/replies$/)
  if (ownerReplies && request.method === 'POST') {
    const originError = mutationOriginError(request, env)
    return originError ?? createOwnerReply(request, env, ownerReplies[1], ownerReplies[2])
  }
  const ownerComment = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]{1,64})\/comments\/([A-Za-z0-9_-]{1,64})$/)
  if (ownerComment && request.method === 'PATCH') {
    const originError = mutationOriginError(request, env)
    return originError ?? updateOwnerComment(request, env, ownerComment[1], ownerComment[2])
  }
  if (ownerComment && request.method === 'DELETE') {
    const originError = mutationOriginError(request, env)
    return originError ?? deleteOwnerComment(request, env, ownerComment[1], ownerComment[2])
  }
  const access = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32}|suzanne)\/access$/)
  if (access && request.method === 'POST') {
    const originError = mutationOriginError(request, env)
    return originError ?? accessShare(request, env, access[1])
  }
  const status = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32}|suzanne)\/status$/)
  if (status && request.method === 'GET') return shareStatus(request, env, status[1])
  const asset = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32}|suzanne)\/(model\.glb|manifest\.json)$/)
  if (asset && request.method === 'GET') return shareAsset(request, env, asset[1], asset[2] as 'model.glb' | 'manifest.json')
  const guestComments = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32}|suzanne)\/comments$/)
  // 轮询用：只取批注，避免每 15 秒重传一次 manifest 与模型信息。
  if (guestComments && request.method === 'GET') return guestCommentList(request, env, guestComments[1])
  if (guestComments && request.method === 'POST') {
    const originError = mutationOriginError(request, env)
    return originError ?? createGuestComment(request, env, guestComments[1])
  }
  // 回复路由必须在通用 comment 路由之前匹配（更具体的路径优先）。
  const guestReply = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32}|suzanne)\/comments\/([A-Za-z0-9_-]{1,64})\/replies\/([A-Za-z0-9_-]{1,64})$/)
  if (guestReply && request.method === 'DELETE') {
    const originError = mutationOriginError(request, env)
    return originError ?? deleteGuestReply(request, env, guestReply[1], guestReply[2], guestReply[3])
  }
  const guestReplies = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32}|suzanne)\/comments\/([A-Za-z0-9_-]{1,64})\/replies$/)
  if (guestReplies && request.method === 'POST') {
    const originError = mutationOriginError(request, env)
    return originError ?? createGuestReply(request, env, guestReplies[1], guestReplies[2])
  }
  const guestComment = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32}|suzanne)\/comments\/([A-Za-z0-9_-]{1,64})$/)
  if (guestComment && request.method === 'DELETE') {
    const originError = mutationOriginError(request, env)
    return originError ?? deleteGuestComment(request, env, guestComment[1], guestComment[2])
  }
  const load = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32}|suzanne)$/)
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
  const rows = await commentsWithRepliesFor(env, projectId)
  return Response.json({ comments: rows.map(({ comment, replies }) => toOwnerComment(comment, replies)) }, { headers: { 'Cache-Control': 'private, no-store' } })
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

async function deleteOwnerComment(request: Request, env: ShareEnv, projectId: string, commentId: string): Promise<Response> {
  const project = await authorizeOwner(request, env, projectId)
  if (project instanceof Response) return project
  if (project.status !== 'ready') return error('找不到项目。', 404)
  // 显式删除回复再删评论，不依赖 D1 是否开启外键级联。
  await env.DB.batch([
    env.DB.prepare('DELETE FROM comment_replies WHERE comment_id = ? AND project_id = ?').bind(commentId, projectId),
    env.DB.prepare('DELETE FROM comments WHERE id = ? AND project_id = ?').bind(commentId, projectId),
  ])
  // 幂等：评论已不存在时同样返回 204，避免客户端重试产生噪音。
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } })
}

async function createOwnerReply(request: Request, env: ShareEnv, projectId: string, commentId: string): Promise<Response> {
  const project = await authorizeOwner(request, env, projectId)
  if (project instanceof Response) return project
  if (project.status !== 'ready') return error('找不到项目。', 404)
  const payload = await readJson<Record<string, unknown>>(request)
  if (!isReplyDraft(payload)) return error('回复内容无效。', 400)
  const reply = await insertReply(env, projectId, commentId, payload, 'owner', null)
  if (!reply) return error('找不到评论。', 404)
  return Response.json({ reply: toReply(reply) }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
}

async function deleteOwnerReply(request: Request, env: ShareEnv, projectId: string, commentId: string, replyId: string): Promise<Response> {
  const project = await authorizeOwner(request, env, projectId)
  if (project instanceof Response) return project
  if (project.status !== 'ready') return error('找不到项目。', 404)
  await env.DB.prepare('DELETE FROM comment_replies WHERE id = ? AND comment_id = ? AND project_id = ?')
    .bind(replyId, commentId, projectId).run()
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } })
}

async function createGuestReply(request: Request, env: ShareEnv, token: string, commentId: string): Promise<Response> {
  const found = await resolveShare(env, token, true, request)
  if (found instanceof Response) return found
  const { share, project } = found
  if (share.comments_permission !== 'comment') return shareError('该分享不允许访客回复。', 403, share)
  const limitError = await enforceRateLimit(request, env, rateLimitRules.guestComment, share.id)
  if (limitError) return limitError
  const payload = await readJson<Record<string, unknown>>(request)
  if (!isReplyDraft(payload)) return shareError('回复内容无效。', 400, share)
  const issued = await issueDeleteToken()
  const reply = await insertReply(env, project.id, commentId, payload, 'guest', issued.hash, share.id)
  if (!reply) return shareError('该分享已失效或不允许回复。', 403, share)
  // 明文令牌只返回一次给创建者本人；列表响应永不包含它。
  return Response.json({ reply: toReply(reply), deleteToken: issued.token }, { status: 201, headers: privateHeaders(share) })
}

async function deleteGuestReply(request: Request, env: ShareEnv, token: string, commentId: string, replyId: string): Promise<Response> {
  const found = await resolveShare(env, token, true, request)
  if (found instanceof Response) return found
  const { share, project } = found
  if (share.comments_permission !== 'comment') return shareError('该分享不允许访客删除。', 403, share)
  return deleteGuestOwned(env, share, {
    select: `SELECT delete_token_hash FROM comment_replies WHERE id = ? AND comment_id = ? AND project_id = ?`,
    bind: [replyId, commentId, project.id],
    remove: `DELETE FROM comment_replies WHERE id = ? AND comment_id = ? AND project_id = ?`,
    request,
  })
}

async function deleteGuestComment(request: Request, env: ShareEnv, token: string, commentId: string): Promise<Response> {
  const found = await resolveShare(env, token, true, request)
  if (found instanceof Response) return found
  const { share, project } = found
  if (share.comments_permission !== 'comment') return shareError('该分享不允许访客删除。', 403, share)
  return deleteGuestOwned(env, share, {
    select: `SELECT delete_token_hash FROM comments WHERE id = ? AND project_id = ?`,
    bind: [commentId, project.id],
    remove: `DELETE FROM comments WHERE id = ? AND project_id = ?`,
    // 评论删除需要连带清理回复（评论与回复的 id 都靠同一个 commentId 定位）。
    cascade: `DELETE FROM comment_replies WHERE comment_id = ? AND project_id = ?`,
    cascadeBind: [commentId, project.id],
    request,
  })
}

/**
 * 访客删除自己内容的统一入口。
 *
 * 访客没有可验证身份（author_id 恒为 null），因此只能凭创建时发放的删除令牌。
 * 为免探测他人批注 id，缺少/不匹配令牌与内容不存在都返回同一个 403。
 */
async function deleteGuestOwned(
  env: ShareEnv,
  share: ShareRow,
  options: {
    select: string
    bind: unknown[]
    remove: string
    cascade?: string
    cascadeBind?: unknown[]
    request: Request
  },
): Promise<Response> {
  const row = await env.DB.prepare(options.select).bind(...options.bind).first<{ delete_token_hash: string | null }>()
  const provided = options.request.headers.get(DELETE_TOKEN_HEADER)
  const forbidden = shareError('无法删除该内容。', 403, share)
  if (!row || row.delete_token_hash === null || provided === null) return forbidden
  if (!await matchesDeleteToken(provided, row.delete_token_hash)) return forbidden
  const statements = options.cascade
    ? [env.DB.prepare(options.cascade).bind(...(options.cascadeBind ?? [])), env.DB.prepare(options.remove).bind(...options.bind)]
    : [env.DB.prepare(options.remove).bind(...options.bind)]
  await env.DB.batch(statements)
  return new Response(null, { status: 204, headers: privateHeaders(share) })
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

export const SUZANNE_TOKEN = 'suzanne'
export const SUZANNE_PASSWORD = 'tycon'
export const SUZANNE_PROJECT_ID = '00000000000000000000000000000001'
export const SUZANNE_SHARE_ID = '00000000000000000000000000000001'

const DEFAULT_MONKEY_MANIFEST: Record<string, unknown> = {
  scene: 'Suzanne 演示',
  camera: null,
  cameras: [],
  objects: [{ name: '苏珊娜', type: 'MESH', collections: ['Collection'] }],
  collections: ['Collection'],
  materials: ['Material'],
  export: { glbBytes: 69708, objectCount: 1 },
}

const INITIAL_SUZANNE_COMMENTS: Array<Record<string, unknown> & { reply?: { body: string; authorName: string } }> = [
  {
    objectName: '苏珊娜',
    position: [0, 0.5, 1.2],
    normal: [0, 0, 1],
    camera: {
      projection: 'perspective',
      position: [0, 0, 3],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
      fov: 45,
    },
    body: '头顶多边形密度偏高，建议减面以降低 Web 端渲染负担。',
    authorName: '平台管理员',
  },
  {
    objectName: '苏珊娜',
    position: [0.8, 0.2, 0.3],
    normal: [1, 0, 0],
    camera: {
      projection: 'perspective',
      position: [2, 1, 2],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
      fov: 45,
    },
    body: '右耳边缘法线翻转，渲染时出现黑色伪影。',
    authorName: '张工',
    // 演示闭环：客户提出 → 创作者回复。回复随评论一并种下。
    reply: {
      body: '已确认是右耳法线方向反了，重算后发现同样影响左耳内侧，一并修好了。',
      authorName: '平台管理员',
    },
  },
  {
    objectName: null,
    position: [0, -0.3, 0.8],
    normal: [0, -1, 0],
    camera: {
      projection: 'perspective',
      position: [0, 0.5, 3],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
      fov: 45,
    },
    body: '整体模型质量不错，可直接用于审稿演示。',
    authorName: '李审核',
  },
]

async function ensureSuzanneDemo(env: ShareEnv): Promise<void> {
  const existing = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(SUZANNE_PROJECT_ID).first()
  if (existing) return
  const now = new Date().toISOString()
  const pwhash = await hashPassword(SUZANNE_PASSWORD)
  const tokenHash = await sha256Text(SUZANNE_TOKEN)
  const capHash = await sha256Text('suzanne-demo-capability')

  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO projects
      (id, name, owner_id, owner_capability_hash, storage_namespace, status, asset_version, expires_at, created_at, updated_at)
      VALUES (?, 'Suzanne 演示', NULL, ?, 'suzanne-demo', 'ready', 1, NULL, ?, ?)`
    ).bind(SUZANNE_PROJECT_ID, capHash, now, now),
    env.DB.prepare(`INSERT OR IGNORE INTO shares
      (id, project_id, token_hash, password_hash, expires_at, comments_permission, revoked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, 'comment', NULL, ?, ?)`
    ).bind(SUZANNE_SHARE_ID, SUZANNE_PROJECT_ID, tokenHash, pwhash, now, now),
  ])

  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM comments WHERE project_id = ?').bind(SUZANNE_PROJECT_ID).first<{ count: number }>()
  if ((count?.count ?? 0) === 0) {
    for (const item of INITIAL_SUZANNE_COMMENTS) {
      const comment = await insertComment(env, SUZANNE_PROJECT_ID, item, 'owner')
      if (item.reply) await insertReply(env, SUZANNE_PROJECT_ID, comment.id, item.reply, 'owner', null)
    }
  }
}

async function loadShare(request: Request, env: ShareEnv, token: string): Promise<Response> {
  const found = await resolveShare(env, token, true, request)
  if (found instanceof Response) return found
  const { share, project } = found
  let manifest: Record<string, unknown> | null
  let modelUrl: string
  if (token === SUZANNE_TOKEN) {
    manifest = DEFAULT_MONKEY_MANIFEST
    modelUrl = '/default-monkey.glb'
  } else {
    manifest = await readManifest(env, project)
    if (manifest === null) return shareError('分享模型不存在。', 404, share)
    modelUrl = `/api/shares/${token}/model.glb`
  }
  const rows = await commentsWithRepliesFor(env, project.id)
  return Response.json({ name: project.name, modelUrl,
    manifest, comments: rows.map(({ comment, replies }) => toPublicComment(comment, replies)),
    commentsPermission: share.comments_permission,
    expiresAt: share.expires_at }, { headers: privateHeaders(share) })
}

async function shareAsset(request: Request, env: ShareEnv, token: string, asset: 'model.glb' | 'manifest.json'): Promise<Response> {
  const found = await resolveShare(env, token, true, request)
  if (found instanceof Response) return found
  const { share, project } = found
  if (token === SUZANNE_TOKEN) {
    if (asset === 'manifest.json') {
      return Response.json(DEFAULT_MONKEY_MANIFEST, { headers: privateHeaders(share) })
    }
    return new Response(null, { status: 302, headers: { Location: '/default-monkey.glb', ...privateHeaders(share) } })
  }
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

/**
 * 访客侧批注轮询入口。只返回批注，不含 manifest/模型地址，
 * 让分享页可以低成本地发现创作者的新回复与状态变化。
 */
async function guestCommentList(request: Request, env: ShareEnv, token: string): Promise<Response> {
  const found = await resolveShare(env, token, true, request)
  if (found instanceof Response) return found
  const { share, project } = found
  const rows = await commentsWithRepliesFor(env, project.id)
  return Response.json(
    { comments: rows.map(({ comment, replies }) => toPublicComment(comment, replies)) },
    { headers: privateHeaders(share) },
  )
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
  const issued = await issueDeleteToken()
  const comment = await insertGuestComment(env, project.id, share.id, draft, issued.hash)
  if (!comment) return shareError('该分享已失效或不允许评论。', 403, share)
  // 明文令牌只返回一次给创建者本人；列表响应永不包含它。
  return Response.json({ comment: toPublicComment(comment), deleteToken: issued.token }, { status: 201, headers: privateHeaders(share) })
}

async function resolveShare(env: ShareEnv, token: string, passwordRequired: boolean, request?: Request): Promise<{ share: ShareRow; project: ProjectRow } | Response> {
  if (token === SUZANNE_TOKEN) {
    await ensureSuzanneDemo(env)
  }
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

const commentFields = 'id, project_id, object_name, position_json, normal_json, camera_json, body, author_name, status, author_id, author_type, delete_token_hash, created_at, updated_at'
const replyFields = 'id, comment_id, project_id, body, author_name, author_type, delete_token_hash, created_at'
async function commentsFor(env: ShareEnv, projectId: string) {
  // rowid 作为 insert 序 tiebreaker：同一毫秒创建的两条记录 created_at 相同，
  // 若退化到随机 id 排序，对话顺序会不确定。
  return (await env.DB.prepare(`SELECT ${commentFields} FROM comments WHERE project_id = ? ORDER BY created_at ASC, rowid ASC`)
    .bind(projectId).all<CommentRow>()).results
}
async function repliesFor(env: ShareEnv, projectId: string) {
  return (await env.DB.prepare(`SELECT ${replyFields} FROM comment_replies WHERE project_id = ? ORDER BY created_at ASC, rowid ASC`)
    .bind(projectId).all<ReplyRow>()).results
}
/**
 * 列表读取：把回复按评论内联，避免前端为每条评论再发一次请求。
 * 回复量受分享有效期约束，一次取全比 N+1 更划算。
 */
async function commentsWithRepliesFor(env: ShareEnv, projectId: string) {
  const [comments, replies] = await Promise.all([commentsFor(env, projectId), repliesFor(env, projectId)])
  const grouped = new Map<string, ReplyRow[]>()
  for (const reply of replies) {
    const bucket = grouped.get(reply.comment_id)
    if (bucket) bucket.push(reply)
    else grouped.set(reply.comment_id, [reply])
  }
  return comments.map((comment) => ({ comment, replies: grouped.get(comment.id) ?? [] }))
}
async function insertComment(env: ShareEnv, projectId: string, draft: Record<string, unknown>, authorType: 'owner' | 'guest', deleteTokenHash: string | null = null): Promise<CommentRow> {
  const now = new Date().toISOString()
  const comment: CommentRow = { id: randomHex(16), project_id: projectId, object_name: draft.objectName as string | null,
    position_json: JSON.stringify(draft.position), normal_json: JSON.stringify(draft.normal), camera_json: JSON.stringify(draft.camera),
    body: (draft.body as string).trim(), author_name: (draft.authorName as string).trim(), status: 'open', author_id: null,
    author_type: authorType, delete_token_hash: deleteTokenHash, created_at: now, updated_at: now }
  await env.DB.prepare(`INSERT INTO comments (${commentFields}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(comment.id, comment.project_id, comment.object_name, comment.position_json, comment.normal_json, comment.camera_json,
      comment.body, comment.author_name, comment.status, comment.author_id, comment.author_type,
      comment.delete_token_hash, now, now).run()
  return comment
}
async function insertGuestComment(env: ShareEnv, projectId: string, shareId: string, draft: Record<string, unknown>, deleteTokenHash: string): Promise<CommentRow | null> {
  const now = new Date().toISOString()
  const comment: CommentRow = { id: randomHex(16), project_id: projectId, object_name: draft.objectName as string | null,
    position_json: JSON.stringify(draft.position), normal_json: JSON.stringify(draft.normal), camera_json: JSON.stringify(draft.camera),
    body: (draft.body as string).trim(), author_name: (draft.authorName as string).trim(), status: 'open', author_id: null,
    author_type: 'guest', delete_token_hash: deleteTokenHash, created_at: now, updated_at: now }
  const result = await env.DB.prepare(`INSERT INTO comments (${commentFields})
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM shares s JOIN projects p ON p.id = s.project_id
      WHERE s.id = ? AND s.project_id = ? AND s.comments_permission = 'comment'
        AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?)
        AND p.status = 'ready'
    )`).bind(comment.id, comment.project_id, comment.object_name, comment.position_json, comment.normal_json,
    comment.camera_json, comment.body, comment.author_name, comment.status, comment.author_id,
    comment.author_type, comment.delete_token_hash, now, now, shareId, projectId, now).run()
  return result.meta.changes === 1 ? comment : null
}
/**
 * 写入回复。owner 走 capability 鉴权，guest 额外要求分享仍可评论，
 * 因此 guest 分支用 INSERT ... SELECT WHERE EXISTS 把授权条件写进语句本身。
 */
async function insertReply(env: ShareEnv, projectId: string, commentId: string, payload: Record<string, unknown>, authorType: 'owner' | 'guest', deleteTokenHash: string | null, shareId?: string): Promise<ReplyRow | null> {
  const now = new Date().toISOString()
  const reply: ReplyRow = { id: randomHex(16), comment_id: commentId, project_id: projectId,
    body: (payload.body as string).trim(), author_name: (payload.authorName as string).trim(),
    author_type: authorType, delete_token_hash: deleteTokenHash, created_at: now }
  const values = [reply.id, reply.comment_id, reply.project_id, reply.body, reply.author_name,
    reply.author_type, reply.delete_token_hash, now]
  if (authorType === 'guest' && shareId) {
    const result = await env.DB.prepare(`INSERT INTO comment_replies (${replyFields})
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM comments c
          JOIN shares s ON s.project_id = c.project_id
          JOIN projects p ON p.id = c.project_id
        WHERE c.id = ? AND c.project_id = ? AND s.id = ?
          AND s.comments_permission = 'comment' AND s.revoked_at IS NULL
          AND (s.expires_at IS NULL OR s.expires_at > ?) AND p.status = 'ready'
      )`).bind(...values, commentId, projectId, shareId, now).run()
    return result.meta.changes === 1 ? reply : null
  }
  const result = await env.DB.prepare(`INSERT INTO comment_replies (${replyFields})
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM comments WHERE id = ? AND project_id = ?)`)
    .bind(...values, commentId, projectId).run()
  return result.meta.changes === 1 ? reply : null
}
function toReply(row: ReplyRow) { return { id: row.id, commentId: row.comment_id, body: row.body,
  authorName: row.author_name, authorType: row.author_type, createdAt: row.created_at } }
function toOwnerComment(row: CommentRow, replies: ReplyRow[] = []) { return { id: row.id, projectId: row.project_id, objectName: row.object_name,
  position: parseJson(row.position_json), normal: parseJson(row.normal_json), camera: parseJson(row.camera_json), body: row.body,
  authorName: row.author_name, authorType: row.author_type, status: row.status,
  createdAt: row.created_at, updatedAt: row.updated_at, replies: replies.map(toReply) } }
function toPublicComment(row: CommentRow, replies: ReplyRow[] = []) { const { projectId: _projectId, ...comment } = toOwnerComment(row, replies); return comment }
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
function isVec3(value: unknown): value is [number, number, number] { return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) }function isCamera(value: unknown): boolean {
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

function isReplyDraft(value: Record<string, unknown> | null): value is Record<string, unknown> {
  if (!value || Object.keys(value).some((key) => key !== 'body' && key !== 'authorName')) return false
  return typeof value.body === 'string' && value.body.trim().length > 0 && value.body.trim().length <= 5000 &&
    typeof value.authorName === 'string' && value.authorName.trim().length > 0 && value.authorName.trim().length <= 120
}

/** 访客删除令牌的请求头。放在头部而非 URL，避免令牌进入日志与浏览器历史。 */
const DELETE_TOKEN_HEADER = 'x-blendproof-delete-token'

/**
 * 生成删除令牌。明文只交给创建者一次，库里只留摘要——
 * 与其他凭据列（token_hash / owner_capability_hash）一致。
 * 32 字节与本地 SQLite 通道的 generateDeleteToken() 保持一致。
 */
async function issueDeleteToken() {
  const token = randomHex(32)
  return { token, hash: await sha256Text(token) }
}

/** 常量时间比较，避免用响应时间区分「令牌错误」与「内容不存在」。 */
async function matchesDeleteToken(provided: string, storedHash: string) {
  const providedHash = await sha256Text(provided)
  if (providedHash.length !== storedHash.length) return false
  let diff = 0
  for (let index = 0; index < providedHash.length; index += 1) {
    diff |= providedHash.charCodeAt(index) ^ storedHash.charCodeAt(index)
  }
  return diff === 0
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
