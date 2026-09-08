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
app.use('/files', express.static(storageRoot))

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

  const projectId = randomUUID().slice(0, 8)
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
      modelUrl: `http://localhost:8787/files/${projectId}/model.glb`,
      manifestUrl: `http://localhost:8787/files/${projectId}/manifest.json`,
    })
  } catch (error) {
    await rm(projectDir, { recursive: true, force: true })
    response.status(422).json({ error: error instanceof Error ? error.message : 'Blender 导出失败。' })
  }
})

app.post('/api/projects/:projectId/shares', async (request, response) => {
  const projectDir = path.join(storageRoot, request.params.projectId)
  if (!existsSync(path.join(projectDir, 'model.glb'))) {
    response.status(404).json({ error: '找不到可分享的本地项目。' })
    return
  }
  const token = randomUUID().replaceAll('-', '')
  await writeFile(path.join(projectDir, 'share.json'), JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2))
  response.status(201).json({ token, shareUrl: `http://127.0.0.1:5173/s/${token}` })
})

app.get('/api/shares/:token', async (request, response) => {
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(storageRoot, { withFileTypes: true }))
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const projectDir = path.join(storageRoot, entry.name)
    try {
      const share = JSON.parse(await readFile(path.join(projectDir, 'share.json'), 'utf8')) as { token: string }
      if (share.token === request.params.token) {
        const manifest = JSON.parse(await readFile(path.join(projectDir, 'manifest.json'), 'utf8'))
        response.json({ name: entry.name, modelUrl: `http://localhost:8787/files/${entry.name}/model.glb`, manifest })
        return
      }
    } catch { /* Projects without a share record are intentionally skipped. */ }
  }
  response.status(404).json({ error: '分享链接不存在或已失效。' })
})

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
