import { createUploadIntent, finalizeUpload, initializeProject, uploadAsset } from './uploads.js'
import type { UploadEnv } from './uploads.js'
import { scheduledCleanup } from './cleanup.js'
import { handleShareRequest } from './shares.js'

export default {
  async fetch(request: Request, env: UploadEnv): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return Response.json({ runtime: 'cloudflare-worker', d1: Boolean(env.DB), r2: Boolean(env.ASSETS) })
    }
    if (request.method === 'GET' && url.pathname === '/api/public/stats') {
      const pool = await env.DB.prepare(`SELECT capacity_bytes, ready_bytes, reserved_bytes
        FROM storage_pool WHERE id = 1`).first<{ capacity_bytes: number; ready_bytes: number; reserved_bytes: number }>()
      const counts = await env.DB.prepare(`SELECT
        COUNT(*) AS project_count,
        COUNT(DISTINCT CASE WHEN owner_id IS NOT NULL THEN owner_id END) AS user_count
        FROM projects WHERE status = 'ready' AND (expires_at IS NULL OR expires_at > ?)`).bind(new Date().toISOString())
        .first<{ project_count: number; user_count: number }>()
      const shares = await env.DB.prepare(`SELECT COUNT(*) AS share_count FROM shares
        WHERE revoked_at IS NULL AND expires_at > ?`).bind(new Date().toISOString()).first<{ share_count: number }>()
      const capacityBytes = pool?.capacity_bytes ?? 5 * 1024 ** 3
      const usedBytes = (pool?.ready_bytes ?? 0) + (pool?.reserved_bytes ?? 0)
      return Response.json({
        capacityBytes, usedBytes, remainingBytes: Math.max(0, capacityBytes - usedBytes),
        projectCount: counts?.project_count ?? 0, activeShareCount: shares?.share_count ?? 0,
        userCount: counts?.user_count ?? 0, retentionHours: 48, recommendedShareHours: 24,
      }, { headers: { 'Cache-Control': 'public, max-age=30' } })
    }

    const shareResponse = await handleShareRequest(request, env as import('./shares.js').ShareEnv, url)
    if (shareResponse) return shareResponse

    if (request.method === 'POST' && url.pathname === '/api/projects') {
      const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
      if (contentType.includes('multipart/form-data') || contentType.includes('application/x-blender')) {
        return Response.json({ error: '云端不接收原始 .blend 文件。' }, { status: 415 })
      }
      const originError = mutationOriginError(request, env)
      if (originError) return originError
      return initializeProject(request, env)
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
