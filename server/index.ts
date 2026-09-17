import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import {
  BlendProofRepository,
  generateDeleteToken,
  hashPassword,
  hashSecret,
  openDatabase,
  type ReviewCommentDraft,
  type ReviewReplyDraft,
  type ShareRecord,
} from './db.js'
import { migrateLegacy } from './migrate-legacy.js'
import { isPublicProjectAsset, LocalProjectStorage } from './local-storage.js'
import type { StoredAsset } from './contracts.js'
import { LocalReviewDatabase } from './local-database.js'
import { LocalShareAccess } from './local-share-access.js'
import { BRIDGE_NONCE_HEADER, LocalBridgePairing } from './local-pairing.js'
import { normalizeUploadFilename } from './upload-filename.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const storageRoot = process.env.BLENDPROOF_STORAGE_ROOT ?? path.join(root, 'storage', 'projects')
const incomingRoot = process.env.BLENDPROOF_INCOMING_ROOT ?? path.join(path.dirname(storageRoot), 'incoming')
const trashRoot = path.join(path.dirname(storageRoot), '.trash')
const exportScript = path.join(root, 'server', 'blender', 'export_glb.py')
const blenderCandidates = [
  process.env.BLENDER_BIN,
  '/Users/tanyancong/Library/Application Support/Steam/steamapps/common/Blender/Blender.app/Contents/MacOS/Blender',
  '/Applications/Blender.app/Contents/MacOS/Blender',
].filter((candidate): candidate is string => Boolean(candidate))
const blenderBin = blenderCandidates.find(existsSync)

await mkdir(storageRoot, { recursive: true })
await mkdir(incomingRoot, { recursive: true })
await rm(trashRoot, { recursive: true, force: true })
await mkdir(trashRoot, { recursive: true })
const database = await openDatabase()
const sqliteRepository = new BlendProofRepository(database)
await migrateLegacy(storageRoot, sqliteRepository)
const repository = new LocalReviewDatabase(sqliteRepository)
const projectStorage = new LocalProjectStorage(storageRoot)
const accessSecret = process.env.BLENDPROOF_ACCESS_SECRET ?? await loadAccessSecret(path.join(path.dirname(storageRoot), '.access-secret'))
const shareAccess = new LocalShareAccess(repository, accessSecret)
const bridgePairing = new LocalBridgePairing()
const bridgeOrigins = new Set(
  (process.env.BLENDPROOF_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)

const app = express()
const upload = multer({ dest: incomingRoot, limits: { fileSize: 1024 * 1024 * 1024 } })

app.use(bridgeOriginGuard)
app.use(cors({
  origin: [...bridgeOrigins],
  credentials: true,
  allowedHeaders: ['content-type', 'x-blendproof-owner', BRIDGE_NONCE_HEADER],
}))
app.use(express.json({ limit: '1mb' }))
app.use('/api/local', bridgeNonceGuard)

app.post('/api/local/pair', (request, response) => {
  const input = request.body as { pairingCode?: unknown; code?: unknown } | undefined
  const pairingCode = input?.pairingCode ?? input?.code
  const origin = requestOrigin(request)
  const session = origin ? bridgePairing.pair(pairingCode, origin) : null
  if (!session) {
    response.status(401).json({ error: '配对码无效或已使用。' })
    return
  }
  response.setHeader('Cache-Control', 'no-store')
  response.status(201).json({
    nonce: session.nonce,
    expiresAt: new Date(session.expiresAt).toISOString(),
  })
})

app.get('/api/local/projects/:projectId/assets/:fileName', async (request, response) => {
  if (!isProjectId(request.params.projectId) || !isPublicProjectAsset(request.params.fileName) || request.params.fileName === 'thumbnail.webp') {
    response.status(404).end()
    return
  }
  const asset = await projectStorage.get(request.params.projectId, request.params.fileName)
  if (!asset) {
    response.status(404).end()
    return
  }
  sendStoredAsset(response, asset)
})

app.get('/api/local/health', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.json({ blenderReady: Boolean(blenderBin) })
})

app.post('/api/local/convert', upload.single('blend'), async (request, response) => {
  const uploadName = request.file ? normalizeUploadFilename(request.file.originalname) : ''
  if (!request.file || path.extname(uploadName).toLowerCase() !== '.blend') {
    response.status(400).json({ error: '请选择一个 .blend 文件。' })
    return
  }
  if (!blenderBin) {
    await rm(request.file.path, { force: true })
    response.status(503).json({ error: '未找到本机 Blender。可通过 BLENDER_BIN 指定其可执行文件。' })
    return
  }

  const projectId = randomUUID().replaceAll('-', '')
  const projectDir = projectStorage.projectPath(projectId)
  const sourcePath = path.join(projectDir, 'source.blend')
  const glbPath = path.join(projectDir, 'model.glb')
  const manifestPath = path.join(projectDir, 'manifest.json')

  await mkdir(projectDir, { recursive: true })
  await rename(request.file.path, sourcePath)

  try {
    await runBlender(blenderBin, sourcePath, glbPath, manifestPath)
    const project = await repository.registerProject({
      id: projectId,
      name: uploadName,
      modelUrl: `/api/local/projects/${projectId}/assets/model.glb`,
      manifestUrl: `/api/local/projects/${projectId}/assets/manifest.json`,
    })
    response.status(201).json(project)
  } catch (error) {
    await projectStorage.deleteProject(projectId)
    response.status(422).json({ error: error instanceof Error ? error.message : 'Blender 导出失败。' })
  }
})

app.post('/api/local/projects/:projectId/shares', async (request, response) => {
  if (!isProjectId(request.params.projectId)) {
    response.status(400).json({ error: '项目标识无效。' })
    return
  }
  if (!await projectStorage.has(request.params.projectId, 'model.glb')) {
    response.status(404).json({ error: '找不到可分享的本地项目。' })
    return
  }
  if (!await repository.getProject(request.params.projectId)) {
    response.status(404).json({ error: '找不到可分享的本地项目。' })
    return
  }
  if (!await requireOwner(request, response, request.params.projectId)) return
  const input = request.body as { password?: unknown; expiresAt?: unknown; commentsPermission?: unknown }
  const password = typeof input?.password === 'string' && input.password.length > 0 ? input.password : null
  const expiresAt = input?.expiresAt === null || input?.expiresAt === undefined || input?.expiresAt === ''
    ? null
    : String(input.expiresAt)
  const commentsPermission = input?.commentsPermission ?? 'read_only'
  try {
    const share = await repository.createShare(request.params.projectId, {
      passwordHash: password ? await hashPassword(password) : null,
      expiresAt,
      commentsPermission: commentsPermission as 'read_only' | 'comment',
    })
    response.status(201).json({
      id: share.id,
      token: share.token,
      shareUrl: share.shareUrl,
      passwordProtected: share.passwordProtected,
      expiresAt: share.expiresAt,
      commentsPermission: share.commentsPermission,
    })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : '分享设置无效。' })
  }
})

app.delete('/api/local/projects/:projectId', async (request, response) => {
  const { projectId } = request.params
  if (!isProjectId(projectId)) {
    response.status(400).json({ error: '项目标识无效。' })
    return
  }
  if (!await repository.getProject(projectId)) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!await requireOwner(request, response, projectId)) return
  const projectPath = projectStorage.projectPath(projectId)
  const trashPath = path.join(trashRoot, `${projectId}-${randomUUID().replaceAll('-', '')}`)
  let staged = false
  try {
    await rename(projectPath, trashPath)
    staged = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    await repository.deleteProject(projectId)
  } catch (error) {
    if (staged) await rename(trashPath, projectPath)
    throw error
  }
  if (staged) await rm(trashPath, { recursive: true, force: true }).catch(() => undefined)
  response.status(204).end()
})

app.delete('/api/local/projects/:projectId/shares/:shareId', async (request, response) => {
  if (!await requireOwner(request, response, request.params.projectId)) return
  const share = await repository.revokeShare(request.params.projectId, request.params.shareId)
  if (!share) {
    response.status(404).json({ error: '找不到可撤销的分享。' })
    return
  }
  response.status(204).end()
})

app.get('/api/local/projects/:projectId/comments', async (request, response) => {
  if (!isProjectId(request.params.projectId) || !await projectStorage.has(request.params.projectId, 'model.glb')) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!await repository.getProject(request.params.projectId)) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!await requireOwner(request, response, request.params.projectId)) return
  response.json({ comments: await repository.listComments(request.params.projectId) })
})

app.post('/api/local/projects/:projectId/comments', async (request, response) => {
  if (!isProjectId(request.params.projectId) || !await projectStorage.has(request.params.projectId, 'model.glb')) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!isCommentDraft(request.body)) {
    response.status(400).json({ error: '评论内容或锚点无效。' })
    return
  }
  if (!await repository.getProject(request.params.projectId)) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!await requireOwner(request, response, request.params.projectId)) return
  const comment = await repository.createComment(request.params.projectId, request.body as ReviewCommentDraft)
  response.status(201).json({ comment })
})

app.patch('/api/local/projects/:projectId/comments/:commentId', async (request, response) => {
  if (!isProjectId(request.params.projectId) || !await projectStorage.has(request.params.projectId, 'model.glb')) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!request.body || typeof request.body !== 'object') {
    response.status(400).json({ error: '评论更新内容无效。' })
    return
  }
  const patch = request.body as { body?: unknown; status?: unknown }
  if (patch.body !== undefined && (typeof patch.body !== 'string' || !patch.body.trim())) {
    response.status(400).json({ error: '评论正文无效。' })
    return
  }
  if (patch.status !== undefined && !['open', 'resolved'].includes(String(patch.status))) {
    response.status(400).json({ error: '评论状态无效。' })
    return
  }
  const nextBody = typeof patch.body === 'string' ? patch.body.trim() : undefined
  const nextStatus = patch.status === 'open' || patch.status === 'resolved' ? patch.status : undefined
  if (!await repository.getProject(request.params.projectId)) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!await requireOwner(request, response, request.params.projectId)) return
  const updated = await repository.updateComment(request.params.projectId, request.params.commentId, {
    ...(nextBody !== undefined ? { body: nextBody } : {}),
    ...(nextStatus !== undefined ? { status: nextStatus } : {}),
  })
  if (!updated) {
    response.status(404).json({ error: '找不到评论。' })
    return
  }
  response.json({ comment: updated })
})

app.delete('/api/local/projects/:projectId/comments/:commentId', async (request, response) => {
  if (!isProjectId(request.params.projectId) || !await projectStorage.has(request.params.projectId, 'model.glb')) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!await repository.getProject(request.params.projectId)) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!await requireOwner(request, response, request.params.projectId)) return
  // 幂等：评论已不存在时同样返回 204，避免客户端重试产生噪音。
  await repository.deleteComment(request.params.projectId, request.params.commentId)
  response.status(204).end()
})

app.post('/api/local/projects/:projectId/comments/:commentId/replies', async (request, response) => {
  if (!isProjectId(request.params.projectId) || !await projectStorage.has(request.params.projectId, 'model.glb')) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!isReplyDraft(request.body)) {
    response.status(400).json({ error: '回复内容无效。' })
    return
  }
  if (!await repository.getProject(request.params.projectId)) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!await requireOwner(request, response, request.params.projectId)) return
  const reply = await repository.createReply(
    request.params.projectId,
    request.params.commentId,
    request.body as ReviewReplyDraft,
    { authorType: 'owner' },
  )
  if (!reply) {
    response.status(404).json({ error: '找不到评论。' })
    return
  }
  response.status(201).json({ reply })
})

app.delete('/api/local/projects/:projectId/comments/:commentId/replies/:replyId', async (request, response) => {
  if (!isProjectId(request.params.projectId) || !await projectStorage.has(request.params.projectId, 'model.glb')) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!await repository.getProject(request.params.projectId)) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!await requireOwner(request, response, request.params.projectId)) return
  await repository.deleteReply(request.params.projectId, request.params.commentId, request.params.replyId)
  response.status(204).end()
})

app.post('/api/local/shares/:token/access', async (request, response) => {
  const share = await resolveShare(request.params.token, response, false)
  if (!share) return
  if (!share.passwordProtected) {
    response.status(204).end()
    return
  }
  if (typeof request.body?.password !== 'string' || !await shareAccess.verifyPassword(request.params.token, request.body.password)) {
    response.status(403).json({ error: '分享密码不正确。' })
    return
  }
  response.setHeader('Set-Cookie', await shareAccess.createCookie(request.params.token))
  response.status(204).end()
})

app.get('/api/local/shares/:token/status', async (request, response) => {
  const share = await resolveShare(request.params.token, response, false)
  if (!share) return
  response.json({
    passwordRequired: share.passwordProtected && !shareAccess.hasCookie(request.params.token, request.headers.cookie),
    commentsPermission: share.commentsPermission,
  })
})

app.get('/api/local/shares/:token', async (request, response) => {
  const share = await resolveShare(request.params.token, response, true, request.headers.cookie)
  if (!share) return
  const project = await repository.getProject(share.projectId)
  if (!project) {
    response.status(404).json({ error: '分享链接不存在或已失效。' })
    return
  }
  const manifestAsset = await projectStorage.get(share.projectId, 'manifest.json')
  if (!manifestAsset) {
    response.status(404).json({ error: '分享模型不存在。' })
    return
  }
  const manifest = JSON.parse(await new Response(manifestAsset.body).text())
  response.json({
    name: manifest.scene,
    modelUrl: `/api/local/shares/${request.params.token}/model.glb`,
    manifest,
    comments: (await repository.listComments(share.projectId)).map(toSharedComment),
    commentsPermission: share.commentsPermission,
    expiresAt: share.expiresAt,
  })
})

app.get('/api/local/shares/:token/model.glb', async (request, response) => {
  const share = await resolveShare(request.params.token, response, true, request.headers.cookie)
  if (!share) return
  const asset = await projectStorage.get(share.projectId, 'model.glb')
  if (!asset) {
    response.status(404).end()
    return
  }
  sendStoredAsset(response, asset)
})

app.get('/api/local/shares/:token/comments', async (request, response) => {
  const share = await resolveShare(request.params.token, response, true, request.headers.cookie)
  if (!share) return
  // 轮询用：只返回批注，不含 manifest，避免每 15 秒重传模型信息。
  const comments = await repository.listComments(share.projectId)
  response.json({ comments: comments.map(toSharedComment) })
})

app.post('/api/local/shares/:token/comments', async (request, response) => {
  const share = await resolveShare(request.params.token, response, true, request.headers.cookie)
  if (!share) return
  if (share.commentsPermission !== 'comment') {
    response.status(403).json({ error: '该分享不允许访客添加评论。' })
    return
  }
  if (!isCommentDraft(request.body)) {
    response.status(400).json({ error: '评论内容或锚点无效。' })
    return
  }
  const issued = issueDeleteToken()
  const comment = await repository.createComment(share.projectId, request.body as ReviewCommentDraft, {
    authorType: 'guest',
    deleteTokenHash: issued.hash,
  })
  // 明文令牌只返回一次给创建者本人；列表响应永不包含它。
  response.status(201).json({ comment: toSharedComment(comment), deleteToken: issued.token })
})

app.delete('/api/local/shares/:token/comments/:commentId', async (request, response) => {
  const share = await resolveShare(request.params.token, response, true, request.headers.cookie)
  if (!share) return
  if (share.commentsPermission !== 'comment') {
    response.status(403).json({ error: '该分享不允许访客删除。' })
    return
  }
  const stored = await repository.commentDeleteTokenHash(share.projectId, request.params.commentId)
  if (!matchesDeleteToken(request.header(DELETE_TOKEN_HEADER), stored)) {
    response.status(403).json({ error: '无法删除该内容。' })
    return
  }
  await repository.deleteComment(share.projectId, request.params.commentId)
  response.status(204).end()
})

app.post('/api/local/shares/:token/comments/:commentId/replies', async (request, response) => {
  const share = await resolveShare(request.params.token, response, true, request.headers.cookie)
  if (!share) return
  if (share.commentsPermission !== 'comment') {
    response.status(403).json({ error: '该分享不允许访客回复。' })
    return
  }
  if (!isReplyDraft(request.body)) {
    response.status(400).json({ error: '回复内容无效。' })
    return
  }
  const issued = issueDeleteToken()
  const reply = await repository.createReply(
    share.projectId,
    request.params.commentId,
    request.body as ReviewReplyDraft,
    { authorType: 'guest', deleteTokenHash: issued.hash },
  )
  if (!reply) {
    response.status(404).json({ error: '找不到评论。' })
    return
  }
  response.status(201).json({ reply, deleteToken: issued.token })
})

app.delete('/api/local/shares/:token/comments/:commentId/replies/:replyId', async (request, response) => {
  const share = await resolveShare(request.params.token, response, true, request.headers.cookie)
  if (!share) return
  if (share.commentsPermission !== 'comment') {
    response.status(403).json({ error: '该分享不允许访客删除。' })
    return
  }
  const stored = await repository.replyDeleteTokenHash(
    share.projectId,
    request.params.commentId,
    request.params.replyId,
  )
  if (!matchesDeleteToken(request.header(DELETE_TOKEN_HEADER), stored)) {
    response.status(403).json({ error: '无法删除该内容。' })
    return
  }
  await repository.deleteReply(share.projectId, request.params.commentId, request.params.replyId)
  response.status(204).end()
})

function bridgeOriginGuard(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (!request.path.startsWith('/api/local')) {
    next()
    return
  }
  const origin = requestOrigin(request)
  const requiresOrigin = request.path === '/api/local/pair' || !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
  if ((requiresOrigin && !origin) || (origin && !bridgeOrigins.has(origin))) {
    response.status(403).json({ error: '本机 bridge 仅接受受信任的 Web Origin。' })
    return
  }
  next()
}

function bridgeNonceGuard(request: express.Request, response: express.Response, next: express.NextFunction) {
  response.setHeader('Cache-Control', 'private, no-store')
  // Pairing is the only route allowed to bootstrap a session. CORS preflight
  // has no application nonce yet, and health is intentionally non-sensitive.
  if (request.path === '/pair' || request.path === '/health' || request.method === 'OPTIONS') {
    next()
    return
  }
  const origin = requestOrigin(request)
  if (!origin || !bridgePairing.isValid(request.header(BRIDGE_NONCE_HEADER), origin)) {
    response.setHeader('X-BlendProof-Bridge-Session', 'invalid')
    response.status(401).json({ error: '缺少或已过期的本机 bridge 会话。' })
    return
  }
  next()
}

function requestOrigin(request: express.Request) {
  const header = request.header('origin')
  if (header) return header
  const referer = request.header('referer')
  if (!referer) return null
  try { return new URL(referer).origin } catch { return null }
}

type StoredComment = Record<string, unknown> & { id: string }

function toSharedComment(comment: StoredComment) {
  const { projectId: _privateProjectId, ...shared } = comment
  return shared
}

/** 访客删除令牌的请求头。放在头部而非 URL，避免令牌进入日志与浏览器历史。 */
const DELETE_TOKEN_HEADER = 'x-blendproof-delete-token'

/**
 * 生成删除令牌。明文只交给创建者一次，库里只留摘要——
 * 与其他凭据一致（capability / share token 同样只存 SHA-256）。
 */
function issueDeleteToken(): { token: string; hash: string } {
  const token = generateDeleteToken()
  return { token, hash: hashSecret(token) }
}

/** 常量时间比较，避免用响应时间区分「令牌错误」与「内容不存在」。 */
function matchesDeleteToken(provided: string | undefined, storedHash: string | null): boolean {
  if (!provided || storedHash === null) return false
  const providedHash = hashSecret(provided)
  const left = Buffer.from(providedHash, 'hex')
  const right = Buffer.from(storedHash, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

async function requireOwner(request: express.Request, response: express.Response, projectId: string): Promise<boolean> {
  const capability = request.header('x-blendproof-owner')
  if (!capability) {
    response.status(401).json({ error: '缺少项目所有者凭据。' })
    return false
  }
  if (!await repository.verifyOwnerCapability(projectId, capability)) {
    response.status(403).json({ error: '项目所有者凭据无效。' })
    return false
  }
  return true
}

async function loadAccessSecret(secretPath: string): Promise<string> {
  try {
    const existing = (await readFile(secretPath, 'utf8')).trim()
    if (/^[a-f0-9]{64}$/.test(existing)) return existing
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const secret = randomBytes(32).toString('hex')
  await writeFile(secretPath, secret, { mode: 0o600 })
  return secret
}

async function resolveShare(token: string, response: express.Response, requirePassword: boolean, cookieHeader?: string): Promise<ShareRecord | null> {
  const decision = await shareAccess.resolve(token, cookieHeader, requirePassword)
  if (decision.status === 'expired') {
    response.status(410).json({ error: '分享链接已过期。' })
    return null
  }
  if (decision.status === 'password_required') {
    response.status(401).json({ error: '该分享需要密码。', passwordRequired: true })
    return null
  }
  if (decision.status !== 'allowed') {
    response.status(404).json({ error: '分享链接不存在或已失效。' })
    return null
  }
  return decision.share
}

function isProjectId(projectId: string) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(projectId)
}

function sendStoredAsset(response: express.Response, asset: StoredAsset) {
  response.setHeader('Content-Type', asset.contentType)
  response.setHeader('Content-Length', String(asset.size))
  if (asset.etag) response.setHeader('ETag', asset.etag)
  Readable.fromWeb(asset.body as import('node:stream/web').ReadableStream<Uint8Array>).pipe(response)
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
}

function isReplyDraft(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const draft = value as Record<string, unknown>
  const keys = Object.keys(draft)
  if (keys.some((key) => key !== 'body' && key !== 'authorName')) return false
  return typeof draft.body === 'string' && draft.body.trim().length > 0 &&
    typeof draft.authorName === 'string' && draft.authorName.trim().length > 0 &&
    draft.body.trim().length <= 5000 && draft.authorName.trim().length <= 120
}

function isCommentDraft(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const draft = value as Record<string, unknown>
  return typeof draft.body === 'string' && draft.body.trim().length > 0 &&
    typeof draft.authorName === 'string' && draft.authorName.trim().length > 0 &&
    (draft.objectName === null || typeof draft.objectName === 'string') &&
    draft.body.trim().length <= 5000 && draft.authorName.trim().length <= 120 &&
    isVec3(draft.position) && isVec3(draft.normal) &&
    hasMagnitude(draft.normal) && isCameraState(draft.camera)
}

function hasMagnitude(value: unknown) {
  return isVec3(value) && value.some((item) => Math.abs(item) > 1e-8)
}

function isCameraState(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const camera = value as Record<string, unknown>
  const projection = camera.projection
  return (projection === 'perspective' || projection === 'orthographic') &&
    isVec3(camera.position) && isVec3(camera.target) &&
    Array.isArray(camera.quaternion) && camera.quaternion.length === 4 && camera.quaternion.every(Number.isFinite) &&
    camera.quaternion.some((item) => Math.abs(item) > 1e-8) &&
    (projection !== 'perspective' || (typeof camera.fov === 'number' && camera.fov > 0 && camera.fov < 180)) &&
    (projection !== 'orthographic' || (typeof camera.zoom === 'number' && camera.zoom > 0))
}

function runBlender(bin: string, sourcePath: string, glbPath: string, manifestPath: string) {
  return new Promise<void>((resolve, reject) => {
    const process = spawn(bin, ['--background', sourcePath, '--python', exportScript, '--', glbPath, manifestPath], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    process.stdout.on('data', (chunk) => { output += chunk.toString() })
    process.stderr.on('data', (chunk) => { output += chunk.toString() })
    process.on('error', reject)
    process.on('close', (code) => {
      if (code === 0 && existsSync(glbPath) && existsSync(manifestPath)) resolve()
      else reject(new Error(`Blender 未能导出该文件。${output.slice(-800)}`))
    })
  })
}

const port = Number(process.env.PORT ?? 8788)
const server = app.listen(port, '127.0.0.1', () => console.log(`BlendProof local bridge running at http://127.0.0.1:${port}`))

function close() {
  server.close(() => database.close())
}
process.once('SIGTERM', close)
process.once('SIGINT', close)
