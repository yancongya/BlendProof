import { env, applyD1Migrations, SELF } from 'cloudflare:test'
import type { D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { scryptAsync } from '@noble/hashes/scrypt.js'
import { R2ProjectStorage, r2AssetKey } from './r2-storage.js'

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] }

beforeAll(async () => applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS))

describe('BlendProof Worker local runtime', () => {
  it('starts with local D1 and R2 bindings', async () => {
    const response = await SELF.fetch('https://blendproof.test/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ runtime: 'cloudflare-worker', d1: true, r2: true })
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()
    expect(tables.results.map((row) => row.name)).toContain('projects')
    expect(tables.results.map((row) => row.name)).toContain('rate_limit_windows')
  })

  it('bootstraps exactly one deployment-configured administrator and then closes the endpoint', async () => {
    const origin = 'http://localhost:5173'
    const wrong = await SELF.fetch('https://blendproof.test/api/auth/bootstrap-admin', {
      method: 'POST', headers: { origin, authorization: 'Bearer definitely-wrong-bootstrap-token-0001', 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'temporary admin password' }),
    })
    expect(wrong.status).toBe(403)
    const created = await SELF.fetch('https://blendproof.test/api/auth/bootstrap-admin', {
      method: 'POST', headers: { origin, authorization: 'Bearer blendproof-test-bootstrap-admin-token-0001', 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'temporary admin password' }),
    })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ user: { email: 'bootstrap-admin@example.test', displayName: 'Bootstrap Admin', role: 'admin' } })
    const repeated = await SELF.fetch('https://blendproof.test/api/auth/bootstrap-admin', {
      method: 'POST', headers: { origin, authorization: 'Bearer blendproof-test-bootstrap-admin-token-0001', 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'another admin password' }),
    })
    expect(repeated.status).toBe(409)
  })

  it('publishes privacy-safe public pool statistics', async () => {
    const response = await SELF.fetch('https://blendproof.test/api/public/stats')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=30')
    const body = await response.json<Record<string, unknown>>()
    expect(body).toMatchObject({
      capacityBytes: 5 * 1024 ** 3,
      retentionHours: 48,
      recommendedShareHours: 24,
      processedFileCount: 0,
      processedAssetCount: 0,
      processedBytes: 0,
      cleanedFileCount: 0,
      cleanedBytes: 0,
    })
    expect(Date.parse(String(body.launchedAt))).not.toBeNaN()
    expect(body).not.toHaveProperty('ownerCapability')
    expect(body).not.toHaveProperty('storageNamespace')
  })

  it('runs invitation account registration, session, ownership and admin statistics as a closed Worker flow', async () => {
    const origin = 'http://localhost:5173'
    const now = new Date().toISOString()
    const adminId = randomHex(16)
    const adminToken = randomHex(32)
    await env.DB.prepare(`INSERT INTO users
      (id, email, password_hash, display_name, role, invite_id, disabled_at, created_at, updated_at)
      VALUES (?, ?, ?, 'Platform admin', 'admin', NULL, NULL, ?, ?)`)
      .bind(adminId, `admin-${adminId}@example.test`, await authPasswordHash('admin password'), now, now).run()
    await env.DB.prepare(`INSERT INTO sessions (id, token_hash, user_id, expires_at, revoked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)`)
      .bind(randomHex(16), await sha256Text(adminToken), adminId, new Date(Date.now() + 60_000).toISOString(), now, now).run()

    const inviteResponse = await SELF.fetch('https://blendproof.test/api/admin/invites', {
      method: 'POST', headers: { origin, cookie: `bp_session=${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expiresInHours: 12, maxUses: 1 }),
    })
    expect(inviteResponse.status).toBe(201)
    const invite = await inviteResponse.json<{ code: string; expiresAt: string; maxUses: number }>()
    expect(invite).toMatchObject({ maxUses: 1 })
    expect(invite.code).toMatch(/^BP-[A-F0-9]{24}$/)

    const register = await SELF.fetch('https://blendproof.test/api/auth/register', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ inviteCode: invite.code, email: `member-${adminId}@example.test`, password: 'a real password', displayName: 'Member' }),
    })
    expect(register.status).toBe(201)
    expect(register.headers.get('set-cookie')).toContain('HttpOnly')
    expect(register.headers.get('set-cookie')).toContain('Secure')
    expect(register.headers.get('set-cookie')).toContain('SameSite=Lax')
    let memberCookie = (register.headers.get('set-cookie') ?? '').split(';', 1)[0]
    const member = await register.json<{ user: { id: string; email: string; role: string } }>()
    expect(member.user).toMatchObject({ email: `member-${adminId}@example.test`, role: 'user' })
    const consumed = await env.DB.prepare('SELECT uses_count FROM invites WHERE code_hash = ?').bind(await sha256Text(invite.code)).first<{ uses_count: number }>()
    expect(consumed?.uses_count).toBe(1)

    const repeated = await SELF.fetch('https://blendproof.test/api/auth/register', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ inviteCode: invite.code, email: `second-${adminId}@example.test`, password: 'a real password', displayName: 'Second' }),
    })
    expect(repeated.status).toBe(400)
    const rejectedLogin = await SELF.fetch('https://blendproof.test/api/auth/login', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: `member-${adminId}@example.test`, password: 'wrong password' }),
    })
    expect(rejectedLogin.status).toBe(401)
    const login = await SELF.fetch('https://blendproof.test/api/auth/login', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: `member-${adminId}@example.test`, password: 'a real password' }),
    })
    expect(login.status).toBe(200)
    memberCookie = (login.headers.get('set-cookie') ?? '').split(';', 1)[0]
    const me = await SELF.fetch('https://blendproof.test/api/me', { headers: { cookie: memberCookie } })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ user: { id: member.user.id, displayName: 'Member' } })

    const initialized = await SELF.fetch('https://blendproof.test/api/projects', {
      method: 'POST', headers: { origin, cookie: memberCookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Account-bound project' }),
    })
    expect(initialized.status).toBe(201)
    const project = await initialized.json<{ id: string }>()
    expect((await env.DB.prepare('SELECT owner_id FROM projects WHERE id = ?').bind(project.id).first<{ owner_id: string }>())?.owner_id).toBe(member.user.id)
    await env.DB.prepare("UPDATE projects SET status = 'ready' WHERE id = ?").bind(project.id).run()
    expect(await (await SELF.fetch('https://blendproof.test/api/me/stats', { headers: { cookie: memberCookie } })).json())
      .toMatchObject({ usedBytes: 0, projectCount: 1, activeShareCount: 0 })

    const deniedAdmin = await SELF.fetch('https://blendproof.test/api/admin/stats', { headers: { cookie: memberCookie } })
    expect(deniedAdmin.status).toBe(403)
    const adminStats = await SELF.fetch('https://blendproof.test/api/admin/stats', { headers: { cookie: `bp_session=${adminToken}` } })
    expect(adminStats.status).toBe(200)
    expect(await adminStats.json()).toHaveProperty('capacityBytes', 5 * 1024 ** 3)

    const users = await SELF.fetch('https://blendproof.test/api/admin/users', { headers: { cookie: `bp_session=${adminToken}` } })
    expect(users.status).toBe(200)
    expect(await users.json()).toMatchObject({ users: expect.arrayContaining([
      expect.objectContaining({ id: member.user.id, displayName: 'Member', role: 'user', usedBytes: 0, projectCount: 1 }),
    ]) })
    const deniedSettings = await SELF.fetch('https://blendproof.test/api/admin/settings', {
      method: 'PATCH', headers: { origin, cookie: memberCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ capacityBytes: 2 * 1024 ** 3, maxShareHours: 24 }),
    })
    expect(deniedSettings.status).toBe(403)
    const settings = await SELF.fetch('https://blendproof.test/api/admin/settings', {
      method: 'PATCH', headers: { origin, cookie: `bp_session=${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ capacityBytes: 2 * 1024 ** 3, maxShareHours: 24 }),
    })
    expect(settings.status).toBe(200)
    expect(await settings.json()).toEqual({ capacityBytes: 2 * 1024 ** 3, maxShareHours: 24 })
    await SELF.fetch('https://blendproof.test/api/admin/settings', {
      method: 'PATCH', headers: { origin, cookie: `bp_session=${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ capacityBytes: 5 * 1024 ** 3, maxShareHours: 48 }),
    })
    const listedInvites = await SELF.fetch('https://blendproof.test/api/admin/invites', { headers: { cookie: `bp_session=${adminToken}` } })
    expect(listedInvites.status).toBe(200)
    const inviteRows = await listedInvites.json<{ invites: Array<{ id: string; usesCount: number }> }>()
    expect(inviteRows.invites.some((item) => item.usesCount === 1)).toBe(true)

    const loggedOut = await SELF.fetch('https://blendproof.test/api/auth/logout', { method: 'POST', headers: { origin, cookie: memberCookie } })
    expect(loggedOut.status).toBe(204)
    expect(loggedOut.headers.get('set-cookie')).toContain('Max-Age=0')
    const disabledIdentity = await SELF.fetch('https://blendproof.test/api/me', { headers: { cookie: memberCookie } })
    expect(disabledIdentity.status).toBe(200)
    expect(await disabledIdentity.json()).toEqual({ user: null })
  }, 20_000)

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

  it('rejects loopback-only source metadata at the cloud upload HTTP boundary', async () => {
    const project = await pendingProject('Strict cloud manifest')
    const manifest = new TextEncoder().encode(JSON.stringify({
      scene: 'Safe title', objects: [], collections: [], export: { sourceBytes: 42 },
    }))
    const response = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/upload-intents`, {
      method: 'POST', headers: ownerJson('http://localhost:5173', project.ownerCapability),
      body: JSON.stringify({ idempotencyKey: 'strict-cloud-manifest-01', assets: [
        { name: 'model.glb', contentType: 'model/gltf-binary', byteSize: validGlb().byteLength, sha256: await sha256(validGlb()) },
        { name: 'manifest.json', contentType: 'application/json', byteSize: manifest.byteLength, sha256: await sha256(manifest) },
      ] }),
    })
    const intent = await response.json<{ intentToken: string }>()
    const upload = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/assets/manifest.json`, {
      method: 'PUT', headers: { origin: 'http://localhost:5173', authorization: `Bearer ${intent.intentToken}`,
        'content-type': 'application/json' }, body: manifest,
    })
    expect(upload.status).toBe(422)
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM project_assets WHERE project_id = ?')
      .bind(project.id).first<{ count: number }>())?.count).toBe(0)
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
    ['manifest.json', JSON.stringify({ scene: 'x', objects: [], collections: [], export: { sourceBytes: 42 } }), 'application/json'],
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
    const origin = 'http://localhost:5173'
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
    const origin = 'http://localhost:5173'
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
    const origin = 'http://localhost:5173'
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
    const origin = 'http://localhost:5173'
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

  it('rate-limits creation, upload intents, password attempts, and guest comments with scoped retry windows', async () => {
    const origin = 'http://localhost:5173'
    const projectIp = '198.51.100.41'
    const createResponses = await Promise.all(Array.from({ length: 6 }, (_, index) => SELF.fetch('https://blendproof.test/api/projects', {
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': projectIp },
      body: JSON.stringify({ name: `Rate project ${index}` }),
    })))
    expect(createResponses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201, 429])
    expectRetryAfter(createResponses[5])
    expect((await SELF.fetch('https://blendproof.test/api/projects', {
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.42' }, body: '{"name":"Other network"}',
    })).status).toBe(201)

    const uploadProject = await pendingProject('Rate intent')
    const uploadHeaders = { origin, 'content-type': 'application/json', 'x-blendproof-owner': uploadProject.ownerCapability,
      'cf-connecting-ip': '198.51.100.43' }
    const intentResponses = await Promise.all(Array.from({ length: 11 }, (_, index) => SELF.fetch(
      `https://blendproof.test/api/projects/${uploadProject.id}/upload-intents`,
      { method: 'POST', headers: { ...uploadHeaders, 'cf-connecting-ip': `198.51.100.${43 + index}` },
        body: JSON.stringify({ idempotencyKey: `rate-intent-key-${String(index).padStart(4, '0')}` }) },
    )))
    expect(intentResponses.slice(0, 10).every((response) => response.status === 400)).toBe(true)
    expect(intentResponses[10].status).toBe(429)
    expectRetryAfter(intentResponses[10])

    const passwordProject = await readyProject('Rate password')
    const protectedResponse = await SELF.fetch(`https://blendproof.test/api/projects/${passwordProject.id}/shares`, {
      method: 'POST', headers: ownerJson(origin, passwordProject.ownerCapability), body: JSON.stringify({ password: 'correct horse' }),
    })
    const protectedShare = await protectedResponse.json<{ token: string }>()
    const passwordHeaders = { origin, 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.44' }
    const passwordResponses = await Promise.all(Array.from({ length: 6 }, () => SELF.fetch(`https://blendproof.test/api/shares/${protectedShare.token}/access`, {
      method: 'POST', headers: passwordHeaders, body: '{"password":"wrong password"}',
    })))
    expect(passwordResponses.slice(0, 5).every((response) => response.status === 403)).toBe(true)
    expect(passwordResponses[5].status).toBe(429)
    expectRetryAfter(passwordResponses[5])
    expect((await SELF.fetch(`https://blendproof.test/api/shares/${protectedShare.token}/access`, {
      method: 'POST', headers: { ...passwordHeaders, 'cf-connecting-ip': '198.51.100.45' }, body: '{"password":"correct horse"}',
    })).status).toBe(204)

    const commentProject = await readyProject('Rate comment')
    const commentShareResponse = await SELF.fetch(`https://blendproof.test/api/projects/${commentProject.id}/shares`, {
      method: 'POST', headers: ownerJson(origin, commentProject.ownerCapability), body: JSON.stringify({ commentsPermission: 'comment' }),
    })
    const commentShare = await commentShareResponse.json<{ token: string }>()
    const commentHeaders = { origin, 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.46' }
    const commentResponses = await Promise.all(Array.from({ length: 11 }, () => SELF.fetch(`https://blendproof.test/api/shares/${commentShare.token}/comments`, {
      method: 'POST', headers: commentHeaders, body: JSON.stringify(commentDraft()),
    })))
    expect(commentResponses.slice(0, 10).every((response) => response.status === 201)).toBe(true)
    expect(commentResponses[10].status).toBe(429)
    expectRetryAfter(commentResponses[10])
    expect((await SELF.fetch(`https://blendproof.test/api/shares/${commentShare.token}/comments`, {
      method: 'POST', headers: { ...commentHeaders, 'cf-connecting-ip': '198.51.100.47' }, body: JSON.stringify(commentDraft()),
    })).status).toBe(201)

    const storedKey = await env.DB.prepare("SELECT key_hash FROM rate_limit_windows WHERE scope = 'project-create-ip' LIMIT 1")
      .first<{ key_hash: string }>()
    expect(storedKey?.key_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(storedKey?.key_hash).not.toBe(projectIp)
  }, 30_000)

  it('serves password shares only through Worker, strips public DTO internals, and revokes old cookies immediately', async () => {
    const origin = 'http://localhost:5173'
    const project = await readyProject('Password Share')
    const created = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/shares`, {
      method: 'POST', headers: ownerJson(origin, project.ownerCapability),
      body: JSON.stringify({ password: 'correct horse', commentsPermission: 'comment' }),
    })
    expect(created.status).toBe(201)
    const share = await created.json<{ id: string; token: string; shareUrl: string }>()
    expect(share.token).toMatch(/^[a-f0-9]{32}$/)
    expect(share.shareUrl).toBe(`/s/${share.token}`)
    expect(JSON.stringify(share)).not.toContain('owner_capability')

    const locked = await SELF.fetch(`https://blendproof.test/api/shares/${share.token}`)
    expect(locked.status).toBe(401)
    expect(await locked.json()).toMatchObject({ passwordRequired: true })
    const badOrigin = await SELF.fetch(`https://blendproof.test/api/shares/${share.token}/access`, {
      method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{"password":"correct horse"}',
    })
    expect(badOrigin.status).toBe(403)
    const access = await SELF.fetch(`https://blendproof.test/api/shares/${share.token}/access`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{"password":"correct horse"}',
    })
    expect(access.status).toBe(204)
    const setCookie = access.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('Secure; HttpOnly; SameSite=Lax')
    expect(setCookie).toContain(`Path=/api/shares/${share.token}`)
    const cookie = setCookie.split(';', 1)[0]

    const loaded = await SELF.fetch(`https://blendproof.test/api/shares/${share.token}`, { headers: { cookie } })
    expect(loaded.status).toBe(200)
    const shared = await loaded.json<Record<string, unknown>>()
    expect(shared).toMatchObject({ name: 'Password Share', commentsPermission: 'comment', comments: [] })
    expect(typeof shared.expiresAt).toBe('string')
    expect(Number.isFinite(Date.parse(String(shared.expiresAt)))).toBe(true)
    expect(JSON.stringify(shared)).not.toMatch(/projectId|ownerCapability|capability_hash|storage_namespace|object_key|password_hash/i)
    const manifest = await SELF.fetch(`https://blendproof.test/api/shares/${share.token}/manifest.json`, { headers: { cookie } })
    expect(manifest.status).toBe(200)
    expect(await manifest.json()).toMatchObject({ scene: 'Password Share' })
    const model = await SELF.fetch(`https://blendproof.test/api/shares/${share.token}/model.glb`, { headers: { cookie } })
    expect(model.status).toBe(200)
    expect(model.headers.get('cache-control')).toBe('private, no-store')

    const guestComment = await SELF.fetch(`https://blendproof.test/api/shares/${share.token}/comments`, {
      method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(commentDraft()),
    })
    expect(guestComment.status).toBe(201)
    expect(JSON.stringify(await guestComment.json())).not.toContain('projectId')
    const ownerComments = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/comments`, {
      headers: { 'x-blendproof-owner': project.ownerCapability },
    })
    expect(ownerComments.status).toBe(200)
    expect((await ownerComments.json<{ comments: Array<{ projectId: string }> }>()).comments[0].projectId).toBe(project.id)

    const revoked = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/shares/${share.id}`, {
      method: 'DELETE', headers: { origin, 'x-blendproof-owner': project.ownerCapability },
    })
    expect(revoked.status).toBe(204)
    expect((await SELF.fetch(`https://blendproof.test/api/shares/${share.token}`, { headers: { cookie } })).status).toBe(404)
  })

  it('allows ready owners to create and update comments while rejecting non-JSON mutations and unready shares', async () => {
    const origin = 'http://localhost:5173'
    const pending = await pendingProject('Pending')
    const denied = await SELF.fetch(`https://blendproof.test/api/projects/${pending.id}/shares`, {
      method: 'POST', headers: ownerJson(origin, pending.ownerCapability), body: JSON.stringify({}),
    })
    expect(denied.status).toBe(409)
    const project = await readyProject('Owner Review')
    const nonJson = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/comments`, {
      method: 'POST', headers: { origin, 'x-blendproof-owner': project.ownerCapability, 'content-type': 'text/plain' }, body: 'not json',
    })
    expect(nonJson.status).toBe(400)
    const comment = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/comments`, {
      method: 'POST', headers: ownerJson(origin, project.ownerCapability), body: JSON.stringify(commentDraft()),
    })
    expect(comment.status).toBe(201)
    const id = (await comment.json<{ comment: { id: string } }>()).comment.id
    const update = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/comments/${id}`, {
      method: 'PATCH', headers: ownerJson(origin, project.ownerCapability), body: JSON.stringify({ status: 'resolved', body: 'fixed' }),
    })
    expect(update.status).toBe(200)
    expect(await update.json()).toMatchObject({ comment: { status: 'resolved', body: 'fixed' } })
  })

  it('keeps legacy project and share IDs routable for owner share and review operations', async () => {
    const origin = 'http://localhost:5173'
    const project = await readyProject('Legacy identifiers', 'legacy_project-2026')
    const created = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/shares`, {
      method: 'POST', headers: ownerJson(origin, project.ownerCapability), body: JSON.stringify({ commentsPermission: 'comment' }),
    })
    expect(created.status).toBe(201)
    const share = await created.json<{ id: string }>()
    const legacyShareId = 'legacy:share_2026-09'
    await env.DB.prepare('UPDATE shares SET id = ? WHERE id = ?').bind(legacyShareId, share.id).run()
    const comment = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/comments`, {
      method: 'POST', headers: ownerJson(origin, project.ownerCapability), body: JSON.stringify(commentDraft()),
    })
    expect(comment.status).toBe(201)
    const revoked = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/shares/${legacyShareId}`, {
      method: 'DELETE', headers: { origin, 'x-blendproof-owner': project.ownerCapability },
    })
    expect(revoked.status).toBe(204)
  })

  it('accepts legacy Node scrypt password hashes without changing the public password route', async () => {
    const origin = 'http://localhost:5173'
    const project = await readyProject('Legacy scrypt')
    const token = randomHex(16)
    const salt = new Uint8Array(16).fill(7)
    const digest = await scryptAsync('legacy secret', salt, { N: 16_384, r: 8, p: 1, dkLen: 32 })
    await insertShare(project.id, token, `scrypt$${toHex(salt)}$${toHex(digest)}`)
    const access = await SELF.fetch(`https://blendproof.test/api/shares/${token}/access`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ password: 'legacy secret' }),
    })
    expect(access.status).toBe(204)
    const cookie = (access.headers.get('set-cookie') ?? '').split(';', 1)[0]
    expect((await SELF.fetch(`https://blendproof.test/api/shares/${token}`, { headers: { cookie } })).status).toBe(200)
  }, 15_000)

  it('rejects a ready asset when its persisted ETag or content type diverges from R2', async () => {
    const origin = 'http://localhost:5173'
    const project = await readyProject('Integrity')
    const token = await createUnprotectedShare(project, origin)
    await env.DB.prepare("UPDATE project_assets SET etag = 'wrong-etag' WHERE project_id = ? AND asset_name = 'model.glb'")
      .bind(project.id).run()
    expect((await SELF.fetch(`https://blendproof.test/api/shares/${token}/model.glb`)).status).toBe(404)
    const model = await env.DB.prepare("SELECT etag FROM project_assets WHERE project_id = ? AND asset_name = 'model.glb'")
      .bind(project.id).first<{ etag: string }>()
    const objectKey = (await env.DB.prepare("SELECT object_key FROM project_assets WHERE project_id = ? AND asset_name = 'model.glb'")
      .bind(project.id).first<{ object_key: string }>())!.object_key
    const object = await env.ASSETS.head(objectKey)
    await env.DB.prepare("UPDATE project_assets SET etag = ?, content_type = 'application/json' WHERE project_id = ? AND asset_name = 'model.glb'")
      .bind(object!.httpEtag, project.id).run()
    expect((await SELF.fetch(`https://blendproof.test/api/shares/${token}/model.glb`)).status).toBe(404)
    expect(model).toBeDefined()
  })

  it('does not write guest read-only comments and rejects tampered, expired, cross-token, and rotates-old cookies', async () => {
    const origin = 'http://localhost:5173'
    const project = await readyProject('Cookie boundaries')
    const created = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/shares`, {
      method: 'POST', headers: ownerJson(origin, project.ownerCapability),
      body: JSON.stringify({ password: 'cookie secret', commentsPermission: 'read_only' }),
    })
    const share = await created.json<{ token: string }>()
    const access = await SELF.fetch(`https://blendproof.test/api/shares/${share.token}/access`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ password: 'cookie secret' }),
    })
    const cookie = (access.headers.get('set-cookie') ?? '').split(';', 1)[0]
    const before = await commentCount(project.id)
    const deniedGuest = await SELF.fetch(`https://blendproof.test/api/shares/${share.token}/comments`, {
      method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(commentDraft()),
    })
    expect(deniedGuest.status).toBe(403)
    expect(await commentCount(project.id)).toBe(before)

    const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('0') ? '1' : '0'}`
    expect((await SELF.fetch(`https://blendproof.test/api/shares/${share.token}`, { headers: { cookie: tampered } })).status).toBe(401)
    const expired = await signedCookie(share.token, Math.floor(Date.now() / 1000) - 1, 'blendproof-test-share-access-secret-0001')
    expect((await SELF.fetch(`https://blendproof.test/api/shares/${share.token}`, { headers: { cookie: expired } })).status).toBe(401)
    const prior = await signedCookie(share.token, Math.floor(Date.now() / 1000) + 600, 'blendproof-test-share-access-secret-previous-1')
    expect((await SELF.fetch(`https://blendproof.test/api/shares/${share.token}`, { headers: { cookie: prior } })).status).toBe(200)

    const otherProject = await readyProject('Other cookie')
    const otherToken = await createPasswordShare(otherProject, origin, 'cookie secret')
    expect((await SELF.fetch(`https://blendproof.test/api/shares/${otherToken}`, { headers: { cookie } })).status).toBe(401)
  })

  it('atomically reserves the 5 GiB public pool before accepting concurrent upload intents', async () => {
    const origin = 'http://localhost:5173'
    const pool = await env.DB.prepare('SELECT capacity_bytes, ready_bytes, reserved_bytes FROM storage_pool WHERE id = 1')
      .first<{ capacity_bytes: number; ready_bytes: number; reserved_bytes: number }>()
    expect(pool).not.toBeNull()
    const first = await pendingProject('Pool contender A')
    const second = await pendingProject('Pool contender B')
    const assets = [
      { name: 'model.glb', contentType: 'model/gltf-binary', byteSize: 60, sha256: 'a'.repeat(64) },
      { name: 'manifest.json', contentType: 'application/json', byteSize: 30, sha256: 'b'.repeat(64) },
    ]
    try {
      await env.DB.prepare('UPDATE storage_pool SET ready_bytes = capacity_bytes - 100, reserved_bytes = 0 WHERE id = 1').run()
      const responses = await Promise.all([first, second].map((project, index) => SELF.fetch(
        `https://blendproof.test/api/projects/${project.id}/upload-intents`, {
          method: 'POST', headers: ownerJson(origin, project.ownerCapability),
          body: JSON.stringify({ idempotencyKey: `pool-race-intent-key-${index}`, assets }),
        },
      )))
      expect(responses.map((response) => response.status).sort()).toEqual([201, 507])
      const accounted = await env.DB.prepare('SELECT ready_bytes, reserved_bytes, capacity_bytes FROM storage_pool WHERE id = 1')
        .first<{ ready_bytes: number; reserved_bytes: number; capacity_bytes: number }>()
      expect((accounted?.ready_bytes ?? 0) + (accounted?.reserved_bytes ?? 0)).toBeLessThanOrEqual(accounted?.capacity_bytes ?? 0)
      await env.DB.prepare("UPDATE project_storage_reservations SET status = 'released', updated_at = ? WHERE project_id IN (?, ?) AND status = 'reserved'")
        .bind(new Date().toISOString(), first.id, second.id).run()
    } finally {
      await env.DB.prepare('UPDATE storage_pool SET ready_bytes = ?, reserved_bytes = ? WHERE id = 1')
        .bind(pool!.ready_bytes, pool!.reserved_bytes).run()
    }
  })

  it('defaults shares to 24 hours and rejects an expiry beyond 48 hours', async () => {
    const origin = 'http://localhost:5173'
    const project = await readyProject('Bounded expiry')
    const before = Date.now()
    const defaultShare = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/shares`, {
      method: 'POST', headers: ownerJson(origin, project.ownerCapability), body: JSON.stringify({}),
    })
    expect(defaultShare.status).toBe(201)
    const created = await defaultShare.json<{ expiresAt: string }>()
    expect(Date.parse(created.expiresAt)).toBeGreaterThanOrEqual(before + 23 * 60 * 60_000)
    expect(Date.parse(created.expiresAt)).toBeLessThanOrEqual(before + 25 * 60 * 60_000)
    const tooLong = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/shares`, {
      method: 'POST', headers: ownerJson(origin, project.ownerCapability),
      body: JSON.stringify({ expiresAt: new Date(Date.now() + 49 * 60 * 60_000).toISOString() }),
    })
    expect(tooLong.status).toBe(400)
  })
})

async function pendingProject(name: string, id = randomHex(16)) {
  const ownerCapability = randomHex(32)
  const now = new Date().toISOString()
  await env.DB.prepare(`INSERT INTO projects (id, name, owner_capability_hash, storage_namespace, status, asset_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', 1, ?, ?)`).bind(id, name, await sha256Text(ownerCapability), randomHex(16), now, now).run()
  return { id, ownerCapability }
}

async function readyProject(name: string, id?: string) {
  const project = await pendingProject(name, id)
  const storageNamespace = randomHex(16)
  const stagingNamespace = randomHex(16)
  const intentId = randomHex(16)
  const now = new Date().toISOString()
  await env.DB.prepare("UPDATE projects SET status = 'ready', storage_namespace = ? WHERE id = ?").bind(storageNamespace, project.id).run()
  const manifest = new TextEncoder().encode(JSON.stringify({ scene: name, camera: null, objects: [], collections: [], r2Key: 'must-not-reflect' }))
  const model = validGlb()
  const manifestKey = r2AssetKey(stagingNamespace, 1, 'manifest.json')
  const modelKey = r2AssetKey(stagingNamespace, 1, 'model.glb')
  const expected = JSON.stringify([
    { name: 'model.glb', contentType: 'model/gltf-binary', byteSize: model.byteLength, sha256: await sha256(model) },
    { name: 'manifest.json', contentType: 'application/json', byteSize: manifest.byteLength, sha256: await sha256(manifest) },
  ])
  await env.DB.prepare(`INSERT INTO upload_intents
    (id, project_id, idempotency_key, intent_token_hash, asset_version, staging_namespace,
     expected_assets_json, status, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, 'finalized', ?, ?, ?)`).bind(
    intentId, project.id, `ready-${intentId}`, 'a'.repeat(64), stagingNamespace, expected,
    new Date(Date.now() + 60_000).toISOString(), now, now,
  ).run()
  const manifestObject = await env.ASSETS.put(manifestKey, manifest, { httpMetadata: { contentType: 'application/json; charset=utf-8' } })
  const modelObject = await env.ASSETS.put(modelKey, model, { httpMetadata: { contentType: 'model/gltf-binary' } })
  for (const [assetName, objectKey, contentType, bytes, etag] of [
    ['model.glb', modelKey, 'model/gltf-binary', model, modelObject.httpEtag],
    ['manifest.json', manifestKey, 'application/json; charset=utf-8', manifest, manifestObject.httpEtag],
  ] as const) {
    await env.DB.prepare(`INSERT INTO project_assets
      (id, project_id, upload_intent_id, asset_version, asset_name, object_key, content_type,
       byte_size, sha256, etag, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`).bind(
      randomHex(16), project.id, intentId, assetName, objectKey, contentType, bytes.byteLength,
      await sha256(bytes), etag, now, now,
    ).run()
  }
  return project
}

async function createUnprotectedShare(project: { id: string; ownerCapability: string }, origin: string) {
  const response = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/shares`, {
    method: 'POST', headers: ownerJson(origin, project.ownerCapability), body: JSON.stringify({}),
  })
  expect(response.status).toBe(201)
  return (await response.json<{ token: string }>()).token
}

async function createPasswordShare(project: { id: string; ownerCapability: string }, origin: string, password: string) {
  const response = await SELF.fetch(`https://blendproof.test/api/projects/${project.id}/shares`, {
    method: 'POST', headers: ownerJson(origin, project.ownerCapability), body: JSON.stringify({ password }),
  })
  expect(response.status).toBe(201)
  return (await response.json<{ token: string }>()).token
}

async function insertShare(projectId: string, token: string, passwordHash: string) {
  const now = new Date().toISOString()
  await env.DB.prepare(`INSERT INTO shares
    (id, project_id, token_hash, password_hash, expires_at, comments_permission, revoked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, 'read_only', NULL, ?, ?)`)
    .bind(randomHex(16), projectId, await sha256Text(token), passwordHash, now, now).run()
}

async function commentCount(projectId: string) {
  return (await env.DB.prepare('SELECT COUNT(*) AS count FROM comments WHERE project_id = ?').bind(projectId).first<{ count: number }>())?.count ?? 0
}

async function signedCookie(token: string, expires: number, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const message = new TextEncoder().encode(`blendproof-share:v1:${token}:${expires}`)
  const signature = toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, message)))
  return `bp_access_${token.slice(0, 12)}=v1.${expires}.${signature}`
}

function toHex(value: Uint8Array) {
  return [...value].map((item) => item.toString(16).padStart(2, '0')).join('')
}

function ownerJson(origin: string, ownerCapability: string) {
  return { origin, 'content-type': 'application/json', 'x-blendproof-owner': ownerCapability }
}

function expectRetryAfter(response: Response) {
  expect(response.headers.get('retry-after')).toMatch(/^[1-9][0-9]*$/)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
}

function commentDraft() {
  return { objectName: null, position: [1, 2, 3], normal: [0, 1, 0], authorName: 'Reviewer', body: 'Please review',
    camera: { projection: 'perspective', position: [2, 3, 4], target: [0, 0, 0], quaternion: [0, 0, 0, 1], fov: 45 } }
}

function randomHex(bytes: number) {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return [...value].map((item) => item.toString(16).padStart(2, '0')).join('')
}

async function sha256Text(value: string) {
  return sha256(new TextEncoder().encode(value))
}

async function authPasswordHash(password: string) {
  const salt = new Uint8Array(16).fill(9)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const derived = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256,
  ))
  return `pbkdf2-sha256$100000$${toHex(salt)}$${toHex(derived)}`
}

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
