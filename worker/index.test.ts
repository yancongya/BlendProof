import { env, applyD1Migrations, SELF } from 'cloudflare:test'
import type { D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { R2ProjectStorage } from './r2-storage.js'

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] }

beforeAll(async () => applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS))

describe('BlendProof Worker local runtime', () => {
  it('starts with local D1 and R2 bindings', async () => {
    const response = await SELF.fetch('https://blendproof.test/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ runtime: 'cloudflare-worker', d1: true, r2: true })
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()
    expect(tables.results.map((row) => row.name)).toContain('projects')
  })

  it.each([
    ['application/x-blender', 'BLENDER-secret-marker'],
    ['Application/X-Blender', 'BLENDER-secret-marker'],
    ['multipart/form-data; boundary=blendproof', '--blendproof\r\nContent-Disposition: form-data; name="blend"; filename="secret.blend"\r\n\r\nBLENDER-secret-marker\r\n--blendproof--'],
  ])('rejects raw blend upload %s without touching D1 or R2', async (contentType, body) => {
    const beforeCounts = await databaseCounts()
    const response = await SELF.fetch('https://blendproof.test/api/projects', {
      method: 'POST', headers: { 'content-type': contentType }, body,
    })
    expect(response.status).toBe(415)
    expect(await databaseCounts()).toEqual(beforeCounts)
    expect((await env.ASSETS.list()).objects).toHaveLength(0)
  })

  it('implements the same derived-asset storage contract on R2', async () => {
    const storage = new R2ProjectStorage(env.ASSETS)
    const id = '0123456789abcdef0123456789abcdef'
    await storage.put(id, 'model.glb', validGlb(), 'model/gltf-binary')
    const asset = await storage.get(id, 'model.glb')
    expect(asset?.contentType).toBe('model/gltf-binary')
    expect(new Uint8Array(await new Response(asset?.body).arrayBuffer())).toEqual(validGlb())
    await storage.deleteProject(id)
    expect(await storage.has(id, 'model.glb')).toBe(false)
  })

  it.each([
    ['source.blend', validGlb(), 'model/gltf-binary'],
    ['model.glb', new TextEncoder().encode('BLENDER-secret-marker'), 'model/gltf-binary'],
    ['manifest.json', JSON.stringify({ scene: 'x', objects: [], collections: [], r2Key: 'trap' }), 'application/json'],
  ])('rejects invalid derived asset %s before an R2 write', async (asset, body, contentType) => {
    const storage = new R2ProjectStorage(env.ASSETS)
    const id = 'abcdef0123456789abcdef0123456789'
    await expect(storage.put(id, asset as 'model.glb', body, contentType)).rejects.toThrow()
    expect((await env.ASSETS.list()).objects).toHaveLength(0)
  })

  it('stores versions independently and cleans only the requested version', async () => {
    const storage = new R2ProjectStorage(env.ASSETS)
    const id = 'fedcba9876543210fedcba9876543210'
    await storage.put(id, 'model.glb', validGlb(), 'model/gltf-binary', 1)
    await storage.put(id, 'model.glb', validGlb(), 'model/gltf-binary', 2)
    await storage.deleteVersion(id, 1)
    expect(await storage.has(id, 'model.glb', 1)).toBe(false)
    expect(await storage.has(id, 'model.glb', 2)).toBe(true)
  })

  it('enforces upload-state migration constraints', async () => {
    const now = new Date().toISOString()
    await expect(env.DB.prepare(`INSERT INTO projects
      (id, name, owner_capability_hash, storage_namespace, status, asset_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`)
      .bind('legacy-project', 'Legacy', 'hash', '0'.repeat(32), now, now).run()).rejects.toThrow()
    await env.DB.prepare(`INSERT INTO projects
      (id, name, owner_capability_hash, storage_namespace, status, asset_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', 1, ?, ?)`)
      .bind('legacy-project', 'Legacy', 'hash', '0'.repeat(32), now, now).run()
    await expect(env.DB.prepare(`INSERT INTO cleanup_jobs
      (id, project_id, object_key, kind, attempts, created_at, updated_at)
      VALUES (?, ?, ?, 'staging', -1, ?, ?)`)
      .bind('job', 'legacy-project', 'projects/key', now, now).run()).rejects.toThrow()
  })

  it('rejects assets bound to another project, version or invalid digest', async () => {
    const now = new Date().toISOString()
    for (const [id, namespace] of [['project-a', '1'.repeat(32)], ['project-b', '2'.repeat(32)]]) {
      await env.DB.prepare(`INSERT INTO projects
        (id, name, owner_capability_hash, storage_namespace, status, asset_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', 1, ?, ?)`)
        .bind(id, id, 'hash', namespace, now, now).run()
    }
    await env.DB.prepare(`INSERT INTO upload_intents
      (id, project_id, idempotency_key, asset_version, staging_namespace, expected_assets_json, expires_at, created_at, updated_at)
      VALUES ('intent-b', 'project-b', 'key-b', 2, ?, '[]', ?, ?, ?)`)
      .bind('3'.repeat(32), new Date(Date.now() + 60_000).toISOString(), now, now).run()

    const insertAsset = env.DB.prepare(`INSERT INTO project_assets
      (id, project_id, upload_intent_id, asset_version, asset_name, object_key, content_type, byte_size, sha256, created_at, updated_at)
      VALUES (?, ?, 'intent-b', ?, 'model.glb', ?, 'model/gltf-binary', 24, ?, ?, ?)`)
    await expect(insertAsset.bind('asset-cross-project', 'project-a', 2, 'key-a', 'a'.repeat(64), now, now).run()).rejects.toThrow()
    await expect(insertAsset.bind('asset-cross-version', 'project-b', 99, 'key-b', 'a'.repeat(64), now, now).run()).rejects.toThrow()
    await expect(insertAsset.bind('asset-bad-sha', 'project-b', 2, 'key-c', 'z'.repeat(64), now, now).run()).rejects.toThrow()
  })
})

async function databaseCounts() {
  const tables = ['projects', 'upload_intents', 'project_assets', 'shares', 'comments', 'cleanup_jobs']
  return Object.fromEntries(await Promise.all(tables.map(async (table) => {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>()
    return [table, row?.count ?? 0]
  })))
}

function validGlb() {
  const bytes = new Uint8Array(24)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.byteLength, true)
  view.setUint32(12, 4, true)
  view.setUint32(16, 0x4e4f534a, true)
  bytes.set(new TextEncoder().encode('{}  '), 20)
  return bytes
}
