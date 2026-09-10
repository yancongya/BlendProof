import { applyD1Migrations, env } from 'cloudflare:test'
import type { D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { expireUploadIntents, processCleanupJobs, runCleanup } from './cleanup.js'
import { r2AssetKey } from './r2-storage.js'

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] }

beforeAll(async () => applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS))

describe('scheduled cleanup and recovery', () => {
  it('expires intents, queues exact staging keys, paginates, and is idempotent', async () => {
    const now = new Date('2026-09-10T00:00:00.000Z')
    const projectId = randomHex(16)
    const namespace = randomHex(16)
    const intentId = randomHex(16)
    const createdAt = new Date(now.getTime() - 60 * 60_000).toISOString()
    const modelKey = r2AssetKey(namespace, 1, 'model.glb')
    const manifestKey = r2AssetKey(namespace, 1, 'manifest.json')
    const glb = new Uint8Array([1, 2, 3])
    const manifest = new TextEncoder().encode('{}')

    await insertProject(projectId, namespace, 'uploading', now, createdAt)
    await insertIntent(intentId, projectId, 'uploading', now, createdAt, [
      { name: 'model.glb', contentType: 'model/gltf-binary', byteSize: glb.byteLength, sha256: 'a'.repeat(64) },
      { name: 'manifest.json', contentType: 'application/json', byteSize: manifest.byteLength, sha256: 'b'.repeat(64) },
    ])
    await env.DB.prepare(`INSERT INTO project_assets
      (id, project_id, upload_intent_id, asset_version, asset_name, object_key, content_type,
       byte_size, sha256, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, 'model.glb', ?, 'model/gltf-binary', 3, ?, 'staging', ?, ?)`)
      .bind(randomHex(16), projectId, intentId, modelKey, 'a'.repeat(64), createdAt, createdAt).run()
    await env.ASSETS.put(modelKey, glb)
    // This object has no project_assets row, emulating a crash after R2 PUT.
    await env.ASSETS.put(manifestKey, manifest)

    const first = await runCleanup(env, { now, pageSize: 1, maxIntents: 10, maxJobs: 10 })
    expect(first.expiredIntents.expired).toBe(1)
    expect(first.expiredIntents.enqueued).toBe(2)
    expect(first.jobs.deleted).toBe(2)
    expect(await env.ASSETS.head(modelKey)).toBeNull()
    expect(await env.ASSETS.head(manifestKey)).toBeNull()
    expect((await env.DB.prepare('SELECT status FROM upload_intents WHERE id = ?').bind(intentId).first<{ status: string }>())?.status).toBe('expired')

    const second = await runCleanup(env, { now, pageSize: 1, maxIntents: 10, maxJobs: 10 })
    expect(second.expiredIntents.expired).toBe(0)
    expect(second.jobs.claimed).toBe(0)
  })

  it('does not delete a ready asset and records an R2 failure for retry', async () => {
    const now = new Date('2026-09-10T00:00:00.000Z')
    const projectId = randomHex(16)
    const namespace = randomHex(16)
    const intentId = randomHex(16)
    const readyKey = r2AssetKey(namespace, 1, 'model.glb')
    const failedKey = `projects/${namespace}/v1/manifest.json`
    const createdAt = now.toISOString()
    await insertProject(projectId, namespace, 'ready', now, createdAt)
    await insertIntent(intentId, projectId, 'finalized', now, createdAt, [])
    await env.DB.prepare(`INSERT INTO project_assets
      (id, project_id, upload_intent_id, asset_version, asset_name, object_key, content_type,
       byte_size, sha256, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, 'model.glb', ?, 'model/gltf-binary', 3, ?, 'ready', ?, ?)`)
      .bind(randomHex(16), projectId, intentId, readyKey, 'a'.repeat(64), createdAt, createdAt).run()
    await env.ASSETS.put(readyKey, new Uint8Array([9, 9, 9]))
    await insertJob(randomHex(16), projectId, readyKey, now, 'pending')

    const readyReport = await processCleanupJobs(env, { now, maxJobs: 10 })
    expect(readyReport.skippedReady).toBe(1)
    expect(await env.ASSETS.head(readyKey)).not.toBeNull()

    const failedJobId = randomHex(16)
    await insertJob(failedJobId, projectId, failedKey, now, 'pending')
    const failingEnv = { ...env, ASSETS: { delete: async () => { throw new Error('R2 unavailable') } } as unknown as R2Bucket } as typeof env
    const failed = await processCleanupJobs(failingEnv, { now, maxJobs: 10 })
    expect(failed.failed).toBe(1)
    const failedRow = await env.DB.prepare('SELECT status, attempts, last_error FROM cleanup_jobs WHERE id = ?')
      .bind(failedJobId).first<{ status: string; attempts: number; last_error: string | null }>()
    expect(failedRow).toMatchObject({ status: 'failed', attempts: 1, last_error: 'R2 unavailable' })

    const retried = await processCleanupJobs(env, { now, maxJobs: 10 })
    expect(retried.deleted).toBe(1)
    expect((await env.DB.prepare('SELECT status, attempts FROM cleanup_jobs WHERE id = ?')
      .bind(failedJobId).first<{ status: string; attempts: number }>())).toMatchObject({ status: 'done', attempts: 2 })
  })

  it('does not process a pre-ledger cleanup job while its upload intent is active', async () => {
    const now = new Date('2026-09-10T00:00:00.000Z')
    const projectId = randomHex(16)
    const namespace = randomHex(16)
    const intentId = randomHex(16)
    const key = r2AssetKey(namespace, 1, 'model.glb')
    const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString()
    await insertProject(projectId, namespace, 'uploading', now, now.toISOString())
    await insertIntent(intentId, projectId, 'uploading', now, now.toISOString(), [])
    await env.DB.prepare('UPDATE upload_intents SET expires_at = ? WHERE id = ?').bind(expiresAt, intentId).run()
    await env.DB.prepare(`INSERT INTO project_assets
      (id, project_id, upload_intent_id, asset_version, asset_name, object_key, content_type,
       byte_size, sha256, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, 'model.glb', ?, 'model/gltf-binary', 3, ?, 'staging', ?, ?)`).bind(
      randomHex(16), projectId, intentId, key, 'a'.repeat(64), now.toISOString(), now.toISOString(),
    ).run()
    await insertJob(randomHex(16), projectId, key, now, 'pending')
    await env.ASSETS.put(key, new Uint8Array([1, 2, 3]))

    const report = await processCleanupJobs(env, { now, maxJobs: 10 })
    expect(report.claimed).toBe(0)
    expect(await env.ASSETS.head(key)).not.toBeNull()
    expect((await env.DB.prepare('SELECT status FROM cleanup_jobs WHERE object_key = ?')
      .bind(key).first<{ status: string }>())?.status).toBe('pending')
  })

  it('reclaims stale running jobs while leaving a fresh running job untouched', async () => {
    const now = new Date('2026-09-10T00:00:00.000Z')
    const projectId = randomHex(16)
    const namespace = randomHex(16)
    const oldJobId = randomHex(16)
    const freshJobId = randomHex(16)
    const oldTime = new Date(now.getTime() - 60 * 60_000).toISOString()
    await insertProject(projectId, namespace, 'pending', now, oldTime)
    await insertJob(oldJobId, projectId, `projects/${namespace}/v1/old`, now, 'running', oldTime, 1)
    await insertJob(freshJobId, projectId, `projects/${namespace}/v1/fresh`, now, 'running', now.toISOString(), 1)
    const report = await processCleanupJobs(env, { now, staleAfterMs: 15 * 60_000, maxJobs: 10 })
    expect(report.claimed).toBe(1)
    expect((await env.DB.prepare('SELECT status, attempts FROM cleanup_jobs WHERE id = ?')
      .bind(oldJobId).first<{ status: string; attempts: number }>())).toMatchObject({ status: 'done', attempts: 2 })
    expect((await env.DB.prepare('SELECT status, attempts FROM cleanup_jobs WHERE id = ?')
      .bind(freshJobId).first<{ status: string; attempts: number }>())).toMatchObject({ status: 'running', attempts: 1 })
  })

  it('honors the intent upper bound while walking pages', async () => {
    const now = new Date('2026-09-10T00:00:00.000Z')
    const ids: string[] = []
    for (let index = 0; index < 3; index += 1) {
      const projectId = randomHex(16)
      const namespace = randomHex(16)
      const intentId = randomHex(16)
      ids.push(intentId)
      await insertProject(projectId, namespace, 'uploading', now, now.toISOString())
      await insertIntent(intentId, projectId, 'uploading', now, now.toISOString(), [])
    }

    const first = await expireUploadIntents(env, { now, pageSize: 1, maxIntents: 2 })
    expect(first.scanned).toBe(2)
    expect(first.expired).toBe(2)
    const statuses = await env.DB.prepare(`SELECT status FROM upload_intents WHERE id IN (?, ?, ?)
      ORDER BY id`).bind(...ids).all<{ status: string }>()
    expect(statuses.results.filter((row) => row.status === 'uploading')).toHaveLength(1)
  })
})

async function insertProject(id: string, namespace: string, status: string, now: Date, timestamp: string) {
  await env.DB.prepare(`INSERT INTO projects
    (id, name, owner_capability_hash, storage_namespace, status, asset_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
    .bind(id, `cleanup-${id}`, 'c'.repeat(64), namespace, status, timestamp, timestamp).run()
}

async function insertIntent(
  id: string,
  projectId: string,
  status: string,
  now: Date,
  timestamp: string,
  expected: unknown[],
) {
  const project = await env.DB.prepare('SELECT storage_namespace FROM projects WHERE id = ?')
    .bind(projectId).first<{ storage_namespace: string }>()
  await env.DB.prepare(`INSERT INTO upload_intents
    (id, project_id, idempotency_key, intent_token_hash, asset_version, staging_namespace,
     expected_assets_json, status, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`)
    .bind(id, projectId, `key-${id}`, 'd'.repeat(64), project?.storage_namespace ?? id, JSON.stringify(expected), status,
      new Date(now.getTime() - 30 * 60_000).toISOString(), timestamp, timestamp).run()
}

async function insertJob(
  id: string,
  projectId: string,
  objectKey: string,
  now: Date,
  status: string,
  updatedAt = now.toISOString(),
  attempts = 0,
) {
  await env.DB.prepare(`INSERT INTO cleanup_jobs
    (id, project_id, object_key, asset_version, kind, status, attempts, created_at, updated_at)
    VALUES (?, ?, ?, 1, 'staging', ?, ?, ?, ?)`)
    .bind(id, projectId, objectKey, status, attempts, now.toISOString(), updatedAt).run()
}

function randomHex(bytes: number) {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return [...value].map((item) => item.toString(16).padStart(2, '0')).join('')
}
