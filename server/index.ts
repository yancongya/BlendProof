import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import multer from 'multer'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const storageRoot = path.join(root, 'storage', 'projects')
const exportScript = path.join(root, 'server', 'blender', 'export_glb.py')
const blenderCandidates = [
  process.env.BLENDER_BIN,
  '/Users/tanyancong/Library/Application Support/Steam/steamapps/common/Blender/Blender.app/Contents/MacOS/Blender',
  '/Applications/Blender.app/Contents/MacOS/Blender',
].filter((candidate): candidate is string => Boolean(candidate))
const blenderBin = blenderCandidates.find(existsSync)

const app = express()
const upload = multer({ dest: path.join(root, 'storage', 'incoming'), limits: { fileSize: 1024 * 1024 * 1024 } })

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
    response.status(201).json({
      id: projectId,
      name: request.file.originalname,
      modelUrl: `/files/${projectId}/model.glb`,
      manifestUrl: `/files/${projectId}/manifest.json`,
    })
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
  const token = randomUUID().replaceAll('-', '')
  await writeFile(path.join(projectDir, 'share.json'), JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2))
  response.status(201).json({ token, shareUrl: `/s/${token}` })
})

app.get('/api/projects/:projectId/comments', async (request, response) => {
  const projectDir = resolveProjectDir(request.params.projectId)
  if (!projectDir || !existsSync(path.join(projectDir, 'model.glb'))) {
    response.status(404).json({ error: '找不到本地项目。' })
    return
  }
  response.json({ comments: await readComments(projectDir) })
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
  const now = new Date().toISOString()
  const comment = {
    ...request.body,
    id: randomUUID(),
    projectId: request.params.projectId,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  }
  await serializeCommentWrite(async () => {
    const comments = await readComments(projectDir)
    comments.push(comment)
    await writeComments(projectDir, comments)
  })
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
  let updated: StoredComment | null = null
  await serializeCommentWrite(async () => {
    const comments = await readComments(projectDir)
    const index = comments.findIndex((comment) => comment.id === request.params.commentId)
    if (index < 0) return
    comments[index] = {
      ...comments[index],
      ...(nextBody !== undefined ? { body: nextBody } : {}),
      ...(nextStatus !== undefined ? { status: nextStatus } : {}),
      updatedAt: new Date().toISOString(),
    }
    updated = comments[index]
    await writeComments(projectDir, comments)
  })
  if (!updated) {
    response.status(404).json({ error: '找不到评论。' })
    return
  }
  response.json({ comment: updated })
})

app.get('/api/shares/:token', async (request, response) => {
  const projectDir = await findShareProject(request.params.token)
  if (!projectDir) {
    response.status(404).json({ error: '分享链接不存在或已失效。' })
    return
  }
  const manifest = JSON.parse(await readFile(path.join(projectDir, 'manifest.json'), 'utf8'))
  response.json({
    name: manifest.scene,
    modelUrl: `/api/shares/${request.params.token}/model.glb`,
    manifest,
    comments: (await readComments(projectDir)).map(toSharedComment),
  })
})

app.get('/api/shares/:token/model.glb', async (request, response) => {
  const projectDir = await findShareProject(request.params.token)
  if (!projectDir) {
    response.status(404).end()
    return
  }
  response.sendFile(path.join(projectDir, 'model.glb'))
})

type StoredComment = Record<string, unknown> & { id: string }

function toSharedComment(comment: StoredComment) {
  const { projectId: _privateProjectId, ...shared } = comment
  return shared
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

async function findShareProject(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(storageRoot, { withFileTypes: true }))
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const projectDir = path.join(storageRoot, entry.name)
    try {
      const share = JSON.parse(await readFile(path.join(projectDir, 'share.json'), 'utf8')) as { token?: string }
      if (share.token === token) return projectDir
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
  }
  return null
}

async function readComments(projectDir: string): Promise<StoredComment[]> {
  try {
    const value = JSON.parse(await readFile(path.join(projectDir, 'comments.json'), 'utf8'))
    return Array.isArray(value) ? value : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

let commentWriteQueue = Promise.resolve()
async function serializeCommentWrite(work: () => Promise<void>) {
  const next = commentWriteQueue.then(work, work)
  commentWriteQueue = next.catch(() => {})
  await next
}

async function writeComments(projectDir: string, comments: StoredComment[]) {
  const target = path.join(projectDir, 'comments.json')
  const temporary = path.join(projectDir, `comments-${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(comments, null, 2))
  await rename(temporary, target)
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

await mkdir(storageRoot, { recursive: true })
await mkdir(path.join(root, 'storage', 'incoming'), { recursive: true })
app.listen(8787, () => console.log('BlendProof local API running at http://localhost:8787'))
