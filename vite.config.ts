import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const bridgeTarget = process.env.BLENDPROOF_BRIDGE_TARGET ?? 'http://127.0.0.1:8788'
const workerTarget = process.env.BLENDPROOF_WORKER_API_TARGET ?? 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/local': bridgeTarget,
      // The cloud API is intentionally independent from the local Blender bridge.
      '/api': workerTarget,
    },
  },
})
