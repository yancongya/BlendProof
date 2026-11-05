import { cpSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const bridgeTarget = process.env.BLENDPROOF_BRIDGE_TARGET ?? 'http://127.0.0.1:8788'
const workerTarget = process.env.BLENDPROOF_WORKER_API_TARGET ?? 'http://127.0.0.1:8787'
const preserveDist = process.env.BLENDPROOF_PRESERVE_DIST === '1'

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

function refreshPublicOnAppBuild(): Plugin {
  return {
    name: 'blendproof:refresh-public-on-app-build',
    apply: 'build',
    closeBundle() {
      if (!preserveDist) return
      // Native cp replaces read-only copies (intro.mp4) without deleting the
      // neighbouring landing build, and also works on a fresh checkout.
      const publicDir = resolve(process.cwd(), 'public')
      const outDir = resolve(process.cwd(), 'dist')
      for (const name of readdirSync(publicDir)) {
        if (name === '.DS_Store') continue
        cpSync(resolve(publicDir, name), resolve(outDir, name), { recursive: true, force: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [landingAtRootDuringDev(), react(), refreshPublicOnAppBuild()],
  build: {
    rollupOptions: {
      output: {
        // Split stable vendor code from app code so an app edit no longer
        // invalidates the three.js/react downloads, and the browser can fetch
        // the chunks in parallel instead of one 1.48 MB file.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](three|three-stdlib)[\\/]/.test(id)) return 'vendor-three'
          if (/[\\/]node_modules[\\/]@react-three[\\/]/.test(id)) return 'vendor-r3f'
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons'
          return 'vendor'
        },
      },
    },
    // `build:app` runs beside the landing build in the same dist/ directory.
    // It opts into preservation so an app-only rebuild cannot remove /landing/.
    emptyOutDir: !preserveDist,
    // Vite copyFile cannot overwrite read-only public copies. Refresh them
    // with native cp in the plugin above when preserving the landing build.
    copyPublicDir: !preserveDist,
  },
  server: {
    port: 5173,
    proxy: {
      '/api/local': bridgeTarget,
      // The cloud API is intentionally independent from the local Blender bridge.
      '/api': workerTarget,
    },
  },
})
