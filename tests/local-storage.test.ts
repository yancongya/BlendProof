import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, test } from 'node:test'
import { LocalProjectStorage } from '../server/local-storage.js'
import { assertPublicAssetContent } from '../server/asset-policy.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('LocalProjectStorage', () => {
  test('implements the public asset contract without exposing arbitrary files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'blendproof-storage-'))
    roots.push(root)
    const storage = new LocalProjectStorage(root)
    const manifestBody = JSON.stringify({ scene: 'Test', objects: [], collections: [] })
    await storage.put('project-a', 'manifest.json', manifestBody, 'application/json')
    await storage.put('project-a', 'model.glb', validGlb(), 'model/gltf-binary')
    assert.equal(await storage.has('project-a', 'model.glb'), true)
    const manifest = await storage.get('project-a', 'manifest.json')
    assert.equal(manifest?.contentType, 'application/json; charset=utf-8')
    assert.equal(await new Response(manifest?.body).text(), manifestBody)
    assert.deepEqual(await readFile(storage.assetPath('project-a', 'model.glb')), Buffer.from(validGlb()))
    assert.throws(() => storage.projectPath('../escape'), /项目标识无效/)
    await assert.rejects(
      storage.put('project-a', 'model.glb', new Uint8Array([4]), 'application/octet-stream'),
      /Content-Type 无效/,
    )
    await storage.deleteProject('project-a')
    assert.equal(await storage.has('project-a', 'model.glb'), false)
  })

  test('rejects a VP8X-only wrapper without image payload', () => {
    const bytes = new Uint8Array(30)
    bytes.set(new TextEncoder().encode('RIFF'), 0)
    new DataView(bytes.buffer).setUint32(4, 22, true)
    bytes.set(new TextEncoder().encode('WEBPVP8X'), 8)
    new DataView(bytes.buffer).setUint32(16, 10, true)
    assert.throws(() => assertPublicAssetContent('thumbnail.webp', bytes, 'image/webp'), /图像 chunk/)
  })
})

function validGlb() {
  const json = new TextEncoder().encode('{"asset":{"version":"2.0"}}')
  const chunkLength = Math.ceil(json.byteLength / 4) * 4
  const bytes = new Uint8Array(20 + chunkLength).fill(0x20)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.byteLength, true)
  view.setUint32(12, chunkLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  bytes.set(json, 20)
  return bytes
}
