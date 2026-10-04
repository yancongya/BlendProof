import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const bridgeTarget = process.env.BLENDPROOF_BRIDGE_TARGET ?? 'http://127.0.0.1:8788'
const workerTarget = process.env.BLENDPROOF_WORKER_API_TARGET ?? 'http://127.0.0.1:8787'

function landingAtRootDuringDev(): Plugin {
  return {
    name: 'blendproof:landing-at-root-during-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if ((request.url ?? '').split(/[?#]/, 1)[0] !== '/') return next()
        try {
          const source = await readFile(resolve(process.cwd(), 'landing/index.html'), 'utf8')
          const html = source
            .replaceAll('./assets/', '/landing/assets/')
            .replace('../public/blendproof-splash-v2.jpg', '/blendproof-splash-v2.jpg')
            .replace('./src/main.ts', '/landing/src/main.ts')
          response.statusCode = 200
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.end(await server.transformIndexHtml('/', html))
        } catch (error) {
          next(error as Error)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [landingAtRootDuringDev(), react()],
  server: {
    port: 5173,
    proxy: {
      '/api/local': bridgeTarget,
      // The cloud API is intentionally independent from the local Blender bridge.
      '/api': workerTarget,
    },
  },
})
