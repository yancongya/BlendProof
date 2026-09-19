import { createUploadIntent, finalizeUpload, initializeProject, uploadAsset } from './uploads.js'
import type { UploadEnv } from './uploads.js'
import { scheduledCleanup } from './cleanup.js'
import { handleShareRequest } from './shares.js'
import { currentUser, handleAuthRequest, publicStats } from './auth.js'

export default {
  async fetch(request: Request, env: UploadEnv): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return Response.json({ runtime: 'cloudflare-worker', d1: Boolean(env.DB), r2: Boolean(env.ASSETS) })
    }
    if (request.method === 'GET' && url.pathname === '/api/public/stats') {
      return Response.json(await publicStats(env), { headers: { 'Cache-Control': 'public, max-age=30' } })
    }

    const authResponse = await handleAuthRequest(request, env, url)
    if (authResponse) return authResponse

    const shareResponse = await handleShareRequest(request, env as import('./shares.js').ShareEnv, url)
    if (shareResponse) return shareResponse

    if (request.method === 'POST' && url.pathname === '/api/projects') {
      const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
      if (contentType.includes('multipart/form-data') || contentType.includes('application/x-blender')) {
        return Response.json({ error: '云端不接收原始 .blend 文件。' }, { status: 415 })
      }
      // 只认 Content-Type 会被 application/octet-stream 绕过，因此再核一次文件头。
      if (await hasBlendMagic(request)) {
        return Response.json({ error: '云端不接收原始 .blend 文件。' }, { status: 415 })
      }
      const originError = mutationOriginError(request, env)
      if (originError) return originError
      return initializeProject(request, env, await currentUser(request, env))
    }

    const intentMatch = url.pathname.match(/^\/api\/projects\/([a-f0-9]{32})\/upload-intents$/)
    if (request.method === 'POST' && intentMatch) {
      const originError = mutationOriginError(request, env)
      return originError ?? createUploadIntent(request, env, intentMatch[1])
    }
    const finalizeMatch = url.pathname.match(/^\/api\/projects\/([a-f0-9]{32})\/finalize$/)
    if (request.method === 'POST' && finalizeMatch) {
      const originError = mutationOriginError(request, env)
      return originError ?? finalizeUpload(request, env, finalizeMatch[1])
    }
    const uploadMatch = url.pathname.match(/^\/api\/projects\/([a-f0-9]{32})\/assets\/(model\.glb|manifest\.json|thumbnail\.webp)$/)
    if (request.method === 'PUT' && uploadMatch) {
      const originError = mutationOriginError(request, env)
      return originError ?? uploadAsset(request, env, uploadMatch[1], uploadMatch[2])
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },
  async scheduled(_controller: ScheduledController, env: UploadEnv, context: ExecutionContext): Promise<void> {
    context.waitUntil(scheduledCleanup(env))
  },
}

function mutationOriginError(request: Request, env: UploadEnv): Response | null {
  const origin = request.headers.get('origin')
  if (origin !== env.APP_ORIGIN) return Response.json({ error: '请求来源无效。' }, { status: 403 })
  return null
}

const BLEND_MAGIC = new TextEncoder().encode('BLENDER')

/**
 * 未压缩的 .blend 以 "BLENDER" 开头。这里只读首块字节，
 * 不用把整个请求体拉进内存 —— 命中即为拒绝路径。
 */
async function hasBlendMagic(request: Request): Promise<boolean> {
  const reader = request.clone().body?.getReader()
  if (!reader) return false
  try {
    const { value } = await reader.read()
    if (!value || value.byteLength < BLEND_MAGIC.byteLength) return false
    return BLEND_MAGIC.every((byte, index) => value[index] === byte)
  } catch {
    return false
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
