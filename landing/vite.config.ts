import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')

/**
 * `validate_page.py` rejects `<link rel="modulepreload">` outright, and Vite
 * emits it for every entry chunk by default. Strip it after the HTML has been
 * generated.
 *
 * The same validator rejects any `src` that is a remote URL, so the entry must
 * stay a relative path — `base: './'` is what guarantees that, and it is also
 * required because both deploy targets serve this page from a sub-path
 * (`/landing/` on the Worker, `/BlendProof/` on GitHub Pages).
 */
function dropModulePreload(): Plugin {
  return {
    name: 'blendproof:drop-module-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/[ \t]*<link[^>]+rel="modulepreload"[^>]*>\s*/g, '')
      },
    },
  }
}

export default defineConfig({
  root: here,
  base: './',
  publicDir: false,
  plugins: [react(), dropModulePreload()],
  server: {
    // The demo model is imported from the app's own public/ directory so the
    // landing page and the product cannot drift apart.
    fs: { allow: [projectRoot] },
  },
  build: {
    // Built into the app's dist so the Worker serves it at /landing/ as a real
    // file, which keeps it clear of the SPA fallback in wrangler.jsonc.
    outDir: resolve(projectRoot, 'dist/landing'),
    // Never wipe the app build that lives alongside it in dist/.
    emptyOutDir: false,
    target: 'es2022',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        // One relative entry file named exactly `app.js`, so it cannot drift
        // into a hashed filename that the static checks and cache-busting
        // convention would have to chase.
        entryFileNames: 'app.js',
        chunkFileNames: 'app.js',
        assetFileNames: 'assets/[name][extname]',
        inlineDynamicImports: true,
      },
    },
  },
})
