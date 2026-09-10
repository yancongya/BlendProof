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
    await storage.deleteProject(id)
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
    await env.DB.prepare('UPDATE projects SET asset_version = 2 WHERE id = ?').bind('project-b').run()
    await env.DB.prepare(`INSERT INTO upload_intents
      (id, project_id, idempotency_key, intent_token_hash, asset_version, staging_namespace, expected_assets_json, expires_at, created_at, updated_at)
      VALUES ('intent-b', 'project-b', 'key-b', ?, 2, ?, '[]', ?, ?, ?)`)
      .bind('4'.repeat(64), '3'.repeat(32), new Date(Date.now() + 60_000).toISOString(), now, now).run()

    const insertAsset = env.DB.prepare(`INSERT INTO project_assets
      (id, project_id, upload_intent_id, asset_version, asset_name, object_key, content_type, byte_size, sha256, created_at, updated_at)
      VALUES (?, ?, 'intent-b', ?, 'model.glb', ?, 'model/gltf-binary', 24, ?, ?, ?)`)
    await expect(insertAsset.bind('asset-cross-project', 'project-a', 2, 'key-a', 'a'.repeat(64), now, now).run()).rejects.toThrow()
    await expect(insertAsset.bind('asset-cross-version', 'project-b', 99, 'key-b', 'a'.repeat(64), now, now).run()).rejects.toThrow()
    await expect(insertAsset.bind('asset-bad-sha', 'project-b', 2, 'key-c', 'z'.repeat(64), now, now).run()).rejects.toThrow()
  })

  it('runs initialize, authenticated derived uploads and finalize to ready', async () => {
    const origin = 'http://127.0.0.1:5173'
    const objectsBefore = (await env.ASSETS.list()).objects.length
    const initialize = await SELF.fetch('https://blendproof.test/api/projects', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Cloud Review' }),
    })
    expect(initialize.status).toBe(201)
    const project = await initialize.json<{ id: string; ownerCapability: string; status: string }>()
    expect(project.status).toBe('pending')
    expect(project.ownerCapability).toMatch(/^[a-f0-9]{64}$/)

    const glb = validGlb()
    const manifest = new TextEncoder().encode(JSON.stringify({ scene: 'Cloud', camera: null, objects: [], collections: [] }))
    const intentResponse = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/upload-intents`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-blendproof-owner': project.ownerCapability },
      body: JSON.stringify({
        idempotencyKey: 'test-upload-key-0001',
        assets: [
          { name: 'model.glb', contentType: 'model/gltf-binary', byteSize: glb.byteLength, sha256: await sha256(glb) },
          { name: 'manifest.json', contentType: 'application/json', byteSize: manifest.byteLength, sha256: await sha256(manifest) },
        ],
      }),
    })
    expect(intentResponse.status).toBe(201)
    const intent = await intentResponse.json<{ intentToken: string; assets: Array<{ name: string; url: string }> }>()
    expect(intent.intentToken).toMatch(/^[a-f0-9]{64}$/)
    expect(intent).not.toHaveProperty('id')
    expect(intent.assets.every((asset) => !asset.url.includes(intent.intentToken))).toBe(true)
    const recoveredIntent = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/upload-intents`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-blendproof-owner': project.ownerCapability },
      body: JSON.stringify({
        idempotencyKey: 'test-upload-key-0001',
        assets: [
          { name: 'model.glb', contentType: 'model/gltf-binary', byteSize: glb.byteLength, sha256: await sha256(glb) },
          { name: 'manifest.json', contentType: 'application/json', byteSize: manifest.byteLength, sha256: await sha256(manifest) },
        ],
      }),
    })
    expect(recoveredIntent.status).toBe(200)
    expect((await recoveredIntent.json<{ intentToken: string }>()).intentToken).toBe(intent.intentToken)

    for (const [name, bytes, contentType] of [
      ['model.glb', glb, 'model/gltf-binary'],
      ['manifest.json', manifest, 'application/json'],
    ] as const) {
      const upload = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/assets/${name}`, {
        method: 'PUT',
        headers: { origin, authorization: `Bearer ${intent.intentToken}`, 'content-type': contentType },
        body: bytes,
      })
      expect(upload.status).toBe(204)
    }

    const objects = await env.ASSETS.list()
    const manifestObject = objects.objects.find((object) => object.key.endsWith('/manifest.json'))
    expect(manifestObject).toBeDefined()
    await env.ASSETS.delete(manifestObject!.key)
    const missingFinalize = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/finalize`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-blendproof-owner': project.ownerCapability },
      body: JSON.stringify({ idempotencyKey: 'test-upload-key-0001' }),
    })
    expect(missingFinalize.status).toBe(409)
    expect((await env.DB.prepare('SELECT status FROM projects WHERE id = ?').bind(project.id).first<{ status: string }>())?.status).toBe('uploading')
    const retryManifest = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/assets/manifest.json`, {
      method: 'PUT',
      headers: { origin, authorization: `Bearer ${intent.intentToken}`, 'content-type': 'application/json' },
      body: manifest,
    })
    expect(retryManifest.status).toBe(204)

    const finalize = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/finalize`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-blendproof-owner': project.ownerCapability },
      body: JSON.stringify({ idempotencyKey: 'test-upload-key-0001' }),
    })
    expect(finalize.status).toBe(200)
    expect(await finalize.json()).toEqual({ id: project.id, status: 'ready' })
    const row = await env.DB.prepare('SELECT status FROM projects WHERE id = ?').bind(project.id).first<{ status: string }>()
    expect(row?.status).toBe('ready')
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM project_assets WHERE status = 'ready'").first<{ count: number }>())?.count).toBe(2)
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM cleanup_jobs WHERE status = 'done'").first<{ count: number }>())?.count).toBe(2)
    expect((await env.ASSETS.list()).objects).toHaveLength(objectsBefore + 2)
  })

  it('rejects wrong origin, owner, intent token and disguised blend content', async () => {
    const origin = 'http://127.0.0.1:5173'
    const objectsBefore = (await env.ASSETS.list()).objects.length
    const assetsBefore = (await env.DB.prepare('SELECT COUNT(*) AS count FROM project_assets').first<{ count: number }>())?.count ?? 0
    const denied = await SELF.fetch('https://blendproof.test/api/projects', {
      method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{"name":"Denied"}',
    })
    expect(denied.status).toBe(403)

    const created = await SELF.fetch('https://blendproof.test/api/projects', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{"name":"Protected"}',
    })
    const project = await created.json<{ id: string; ownerCapability: string }>()
    const disguised = polyglotGlb()
    const manifest = new TextEncoder().encode(JSON.stringify({ scene: 'Safe', objects: [], collections: [] }))
    const intentResponse = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/upload-intents`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-blendproof-owner': project.ownerCapability },
      body: JSON.stringify({ idempotencyKey: 'test-upload-key-0002', assets: [
        { name: 'model.glb', contentType: 'model/gltf-binary', byteSize: disguised.byteLength, sha256: await sha256(disguised) },
        { name: 'manifest.json', contentType: 'application/json', byteSize: manifest.byteLength, sha256: await sha256(manifest) },
      ] }),
    })
    const intent = await intentResponse.json<{ intentToken: string }>()
    const wrongToken = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/assets/model.glb`, {
      method: 'PUT', headers: { origin, authorization: 'Bearer wrong', 'content-type': 'model/gltf-binary' }, body: disguised,
    })
    expect(wrongToken.status).toBe(403)
    const disguisedUpload = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/assets/model.glb`, {
      method: 'PUT', headers: { origin, authorization: `Bearer ${intent.intentToken}`, 'content-type': 'model/gltf-binary' }, body: disguised,
    })
    expect(disguisedUpload.status).toBe(422)
    expect((await env.ASSETS.list()).objects).toHaveLength(objectsBefore)
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM project_assets').first<{ count: number }>())?.count).toBe(assetsBefore)
  })

  it('returns a stable conflict when an expired idempotency key is retried', async () => {
    const origin = 'http://127.0.0.1:5173'
    const created = await SELF.fetch('https://blendproof.test/api/projects', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{"name":"Expiry"}',
    })
    const project = await created.json<{ id: string; ownerCapability: string }>()
    const glb = validGlb()
    const manifest = new TextEncoder().encode(JSON.stringify({ scene: 'Expiry', objects: [], collections: [] }))
    const body = JSON.stringify({ idempotencyKey: 'expired-key-test-0001', assets: [
      { name: 'model.glb', contentType: 'model/gltf-binary', byteSize: glb.byteLength, sha256: await sha256(glb) },
      { name: 'manifest.json', contentType: 'application/json', byteSize: manifest.byteLength, sha256: await sha256(manifest) },
    ] })
    const headers = { origin, 'content-type': 'application/json', 'x-blendproof-owner': project.ownerCapability }
    const first = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/upload-intents`, {
      method: 'POST', headers, body,
    })
    expect(first.status).toBe(201)
    await env.DB.prepare('UPDATE upload_intents SET expires_at = ? WHERE project_id = ?')
      .bind(new Date(Date.now() - 1_000).toISOString(), project.id).run()

    const expiredOnce = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/upload-intents`, {
      method: 'POST', headers, body,
    })
    const expiredTwice = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/upload-intents`, {
      method: 'POST', headers, body,
    })
    expect(expiredOnce.status).toBe(409)
    expect(expiredTwice.status).toBe(409)
    expect((await env.DB.prepare('SELECT asset_version FROM projects WHERE id = ?').bind(project.id)
      .first<{ asset_version: number }>())?.asset_version).toBe(2)
  })

  it('recovers the same upload intent under concurrent idempotent requests', async () => {
    const origin = 'http://127.0.0.1:5173'
    const created = await SELF.fetch('https://blendproof.test/api/projects', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{"name":"Concurrent"}',
    })
    const project = await created.json<{ id: string; ownerCapability: string }>()
    const glb = validGlb()
    const manifest = new TextEncoder().encode(JSON.stringify({ scene: 'Concurrent', objects: [], collections: [] }))
    const body = JSON.stringify({ idempotencyKey: 'concurrent-key-0001', assets: [
      { name: 'model.glb', contentType: 'model/gltf-binary', byteSize: glb.byteLength, sha256: await sha256(glb) },
      { name: 'manifest.json', contentType: 'application/json', byteSize: manifest.byteLength, sha256: await sha256(manifest) },
    ] })
    const headers = { origin, 'content-type': 'application/json', 'x-blendproof-owner': project.ownerCapability }
    const responses = await Promise.all(Array.from({ length: 4 }, () => SELF.fetch(
      `https://blendproof.test/api/projects/${project.id}/upload-intents`,
      { method: 'POST', headers, body },
    )))
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 201])
    const tokens = await Promise.all(responses.map(async (response) =>
      (await response.json<{ intentToken: string }>()).intentToken))
    expect(new Set(tokens).size).toBe(1)
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM upload_intents WHERE project_id = ?')
      .bind(project.id).first<{ count: number }>())?.count).toBe(1)
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
  return buildGlb({ asset: { version: '2.0' } })
}

function polyglotGlb() {
  const binary = new TextEncoder().encode('BLENDER-v300-secret-marker')
  return buildGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: binary.byteLength }] }, binary)
}

function buildGlb(document: Record<string, unknown>, binary?: Uint8Array) {
  const json = new TextEncoder().encode(JSON.stringify(document))
  const chunkLength = Math.ceil(json.byteLength / 4) * 4
  const binaryLength = binary ? Math.ceil(binary.byteLength / 4) * 4 : 0
  const bytes = new Uint8Array(20 + chunkLength + (binary ? 8 + binaryLength : 0)).fill(0x20)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.byteLength, true)
  view.setUint32(12, chunkLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  bytes.set(json, 20)
  if (binary) {
    const offset = 20 + chunkLength
    view.setUint32(offset, binaryLength, true)
    view.setUint32(offset + 4, 0x004e4942, true)
    bytes.set(binary, offset + 8)
  }
  return bytes
}

async function sha256(value: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(value).buffer)
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('')
}
