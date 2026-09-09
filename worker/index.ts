export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return Response.json({ runtime: 'cloudflare-worker', d1: Boolean(env.DB), r2: Boolean(env.ASSETS) })
    }

    if (request.method === 'POST' && url.pathname === '/api/projects') {
      const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
      if (contentType.includes('multipart/form-data') || contentType.includes('application/x-blender')) {
        return Response.json({ error: '云端不接收原始 .blend 文件。' }, { status: 415 })
      }
      return Response.json({ error: '请先通过本机转换桥生成 Web 资产。' }, { status: 400 })
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },
}
