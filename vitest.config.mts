import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

const migrations = await readD1Migrations('./migrations')

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          UPLOAD_SIGNING_SECRET: 'blendproof-test-upload-signing-secret-0001',
        },
      },
    }),
  ],
  test: { include: ['worker/**/*.test.ts'] },
})
