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
          APP_ORIGIN: 'http://localhost:5173',
          UPLOAD_SIGNING_SECRET: 'blendproof-test-upload-signing-secret-0001',
          SHARE_ACCESS_SECRET: 'blendproof-test-share-access-secret-0001',
          SHARE_ACCESS_SECRET_PREVIOUS: 'blendproof-test-share-access-secret-previous-1',
          BOOTSTRAP_ADMIN_EMAIL: 'bootstrap-admin@example.test',
          BOOTSTRAP_ADMIN_NAME: 'Bootstrap Admin',
          BOOTSTRAP_ADMIN_TOKEN: 'blendproof-test-bootstrap-admin-token-0001',
        },
      },
    }),
  ],
  test: { include: ['worker/**/*.test.ts'] },
})
