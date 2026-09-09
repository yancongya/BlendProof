import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { BlendProofRepository, hashPassword, openDatabase, type ReviewCommentDraft, type ShareRecord } from './db.js'
import { migrateLegacy } from './migrate-legacy.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const storageRoot = process.env.BLENDPROOF_STORAGE_ROOT ?? path.join(root, 'storage', 'projects')
const incomingRoot = process.env.BLENDPROOF_INCOMING_ROOT ?? path.join(path.dirname(storageRoot), 'incoming')
const exportScript = path.join(root, 'server', 'blender', 'export_glb.py')
const blenderCandidates = [
  process.env.BLENDER_BIN,
  '/Users/tanyancong/Library/Application Support/Steam/steamapps/common/Blender/Blender.app/Contents/MacOS/Blender',
  '/Applications/Blender.app/Contents/MacOS/Blender',
].filter((candidate): candidate is string => Boolean(candidate))
const blenderBin = blenderCandidates.find(existsSync)

await mkdir(storageRoot, { recursive: true })
await mkdir(incomingRoot, { recursive: true })
const database = await openDatabase()
const repository = new BlendProofRepository(database)
await migrateLegacy(storageRoot, repository)
const accessSecret = process.env.BLENDPROOF_ACCESS_SECRET ?? await loadAccessSecret(path.join(path.dirname(storageRoot), '.access-secret'))

const app = express()
const upload = multer({ dest: incomingRoot, limits: { fileSize: 1024 * 1024 * 1024 } })

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }))
app.use(express.json({ limit: '1mb' }))
app.get('/files/:projectId/:fileName', (request, response) => {
  const projectDir = resolveProjectDir(request.params.projectId)
  if (!projectDir || !['model.glb', 'manifest.json'].includes(request.params.fileName)) {
    response.status(404).end()
    return
  }
  response.sendFile(path.join(projectDir, request.params.fileName))
})

app.get('/api/health', (_request, response) => {
  response.json({ blenderReady: Boolean(blenderBin), blenderBin: blenderBin ?? null })
})

app.post('/api/projects', upload.single('blend'), async (request, response) => {
  if (!request.file || path.extname(request.file.originalname).toLowerCase() !== '.blend') {
    response.status(400).json({ error: '请选择一个 .blend 文件。' })
    return
  }
  if (!blenderBin) {
    await rm(request.file.path, { force: true })
    response.status(503).json({ error: '未找到本机 Blender。可通过 BLENDER_BIN 指定其可执行文件。' })
    return
  }

  const projectId = randomUUID().replaceAll('-', '')
  const projectDir = path.join(storageRoot, projectId)
  const sourcePath = path.join(projectDir, 'source.blend')
  const glbPath = path.join(projectDir, 'model.glb')
  const manifestPath = path.join(projectDir, 'manifest.json')

  await mkdir(projectDir, { recursive: true })
  await rename(request.file.path, sourcePath)

  try {
    await runBlender(blenderBin, sourcePath, glbPath, manifestPath)
    const project = repository.registerProject({ id: projectId, name: request.file.originalname })
    response.status(201).json(project)
  } catch (error) {
    await rm(projectDir, { recursive: true, force: true })
    response.status(422).json({ error: error instanceof Error ? error.message : 'Blender 导出失败。' })
  }
})

app.post('/api/projects/:projectId/shares', async (request, response) => {
  const projectDir = resolveProjectDir(request.params.projectId)
  if (!projectDir) {
    response.status(400).json({ error: '项目标识无效。' })
    return
  }
  if (!existsSync(path.join(projectDir, 'model.glb'))) {
    response.status(404).json({ error: '找不到可分享的本地项目。' })
    return
  }
  if (!repository.getProject(request.params.projectId)) {
    response.status(404).json({ error: '找不到可分享的本地项目。' })
    return
  }
  if (!requireOwner(request, response, request.params.projectId)) return
  const input = request.body as { password?: unknown; expiresAt?: unknown; commentsPermission?: unknown }
  const password = typeof input?.password === 'string' && input.password.length > 0 ? input.password : null
  const expiresAt = input?.expiresAt === null || input?.expiresAt === undefined || input?.expiresAt === ''
    ? null
    : String(input.expiresAt)
  const commentsPermission = input?.commentsPermission ?? 'read_only'
  try {
    const share = repository.createShare(request.params.projectId, {
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

app.delete('/api/projects/:projectId/shares/:shareId', (request, response) => {
  if (!requireOwner(request, response, request.params.projectId)) return
  const share = repository.revokeShare(request.params.projectId, request.params.shareId)
  if (!share) {
    response.status(404).json({ error: '找不到可撤销的分享。' })
    return
  }
  response.status(204).end()
})

app.get('/api/projects/:projectId/comments', async (request, response) => {
  const projectDir = resolveProjectDir(request.params.projectId)
  if (!projectDir || !existsSync(path.join(projectDir, 'model.glb'))) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!repository.getProject(request.params.projectId)) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!requireOwner(request, response, request.params.projectId)) return
  response.json({ comments: repository.listComments(request.params.projectId) })
})

app.post('/api/projects/:projectId/comments', async (request, response) => {
  const projectDir = resolveProjectDir(request.params.projectId)
  if (!projectDir || !existsSync(path.join(projectDir, 'model.glb'))) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!isCommentDraft(request.body)) {
    response.status(400).json({ error: '评论内容或锚点无效。' })
    return
  }
  if (!repository.getProject(request.params.projectId)) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!requireOwner(request, response, request.params.projectId)) return
  const comment = repository.createComment(request.params.projectId, request.body as ReviewCommentDraft)
  response.status(201).json({ comment })
})

app.patch('/api/projects/:projectId/comments/:commentId', async (request, response) => {
  const projectDir = resolveProjectDir(request.params.projectId)
  if (!projectDir || !existsSync(path.join(projectDir, 'model.glb'))) {
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
  if (!repository.getProject(request.params.projectId)) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  if (!requireOwner(request, response, request.params.projectId)) return
  const updated = repository.updateComment(request.params.projectId, request.params.commentId, {
    ...(nextBody !== undefined ? { body: nextBody } : {}),
    ...(nextStatus !== undefined ? { status: nextStatus } : {}),
  })
  if (!updated) {
    response.status(404).json({ error: '找不到评论。' })
    return
  }
  response.json({ comment: updated })
})

app.post('/api/shares/:token/access', async (request, response) => {
  const share = resolveShare(request.params.token, response, false)
  if (!share) return
  if (!share.passwordProtected) {
    response.status(204).end()
    return
  }
  if (typeof request.body?.password !== 'string' || !await repository.verifySharePassword(request.params.token, request.body.password)) {
    response.status(403).json({ error: '分享密码不正确。' })
    return
  }
  response.setHeader('Set-Cookie', `${accessCookieName(request.params.token)}=${accessCookieValue(request.params.token)}; HttpOnly; SameSite=Lax; Path=/api/shares/${request.params.token}; Max-Age=86400`)
  response.status(204).end()
})

app.get('/api/shares/:token/status', (request, response) => {
  const share = resolveShare(request.params.token, response, false)
  if (!share) return
  response.json({
    passwordRequired: share.passwordProtected && !hasAccessCookie(request.params.token, request.headers.cookie),
    commentsPermission: share.commentsPermission,
  })
})

app.get('/api/shares/:token', async (request, response) => {
  const share = resolveShare(request.params.token, response, true, request.headers.cookie)
  if (!share) return
  const project = repository.getProject(share.projectId)
  if (!project) {
    response.status(404).json({ error: '分享链接不存在或已失效。' })
    return
  }
  const projectDir = resolveProjectDir(share.projectId)!
  const manifest = JSON.parse(await readFile(path.join(projectDir, 'manifest.json'), 'utf8'))
  response.json({
    name: manifest.scene,
    modelUrl: `/api/shares/${request.params.token}/model.glb`,
    manifest,
    comments: repository.listComments(share.projectId).map(toSharedComment),
    commentsPermission: share.commentsPermission,
  })
})

app.get('/api/shares/:token/model.glb', async (request, response) => {
  const share = resolveShare(request.params.token, response, true, request.headers.cookie)
  if (!share) return
  response.sendFile(path.join(resolveProjectDir(share.projectId)!, 'model.glb'))
})

app.post('/api/shares/:token/comments', async (request, response) => {
  const share = resolveShare(request.params.token, response, true, request.headers.cookie)
  if (!share) return
  if (share.commentsPermission !== 'comment') {
    response.status(403).json({ error: '该分享不允许访客添加评论。' })
    return
  }
  if (!isCommentDraft(request.body)) {
    response.status(400).json({ error: '评论内容或锚点无效。' })
    return
  }
  const comment = repository.createComment(share.projectId, request.body as ReviewCommentDraft)
  response.status(201).json({ comment: toSharedComment(comment) })
})

type StoredComment = Record<string, unknown> & { id: string }

function toSharedComment(comment: StoredComment) {
  const { projectId: _privateProjectId, ...shared } = comment
  return shared
}

function requireOwner(request: express.Request, response: express.Response, projectId: string): boolean {
  const capability = request.header('x-blendproof-owner')
  if (!capability) {
    response.status(401).json({ error: '缺少项目所有者凭据。' })
    return false
  }
  if (!repository.verifyOwnerCapability(projectId, capability)) {
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

function accessCookieName(token: string) {
  return `bp_access_${token.slice(0, 12)}`
}

function accessCookieValue(token: string) {
  return createHmac('sha256', accessSecret).update(token).digest('hex')
}

function hasAccessCookie(token: string, cookieHeader?: string): boolean {
  const expected = accessCookieValue(token)
  const raw = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${accessCookieName(token)}=`))
  const actual = raw?.slice(raw.indexOf('=') + 1) ?? ''
  if (!/^[a-f0-9]{64}$/.test(actual)) return false
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}

function resolveShare(token: string, response: express.Response, requirePassword: boolean, cookieHeader?: string): ShareRecord | null {
  if (!/^[a-f0-9]{32}$/.test(token)) {
    response.status(404).json({ error: '分享链接不存在或已失效。' })
    return null
  }
  const share = repository.findShare(token)
  if (!share || share.revokedAt) {
    response.status(404).json({ error: '分享链接不存在或已失效。' })
    return null
  }
  if (repository.isShareExpired(share)) {
    response.status(410).json({ error: '分享链接已过期。' })
    return null
  }
  if (requirePassword && share.passwordProtected && !hasAccessCookie(token, cookieHeader)) {
    response.status(401).json({ error: '该分享需要密码。', passwordRequired: true })
    return null
  }
  return share
}

function resolveProjectDir(projectId: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(projectId)) return null
  return path.join(storageRoot, projectId)
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
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

const port = Number(process.env.PORT ?? 8787)
const server = app.listen(port, () => console.log(`BlendProof local API running at http://localhost:${port}`))

function close() {
  server.close(() => database.close())
}
process.once('SIGTERM', close)
process.once('SIGINT', close)
