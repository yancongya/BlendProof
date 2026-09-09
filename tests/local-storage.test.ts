import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, test } from 'node:test'
import { LocalProjectStorage } from '../server/local-storage.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('LocalProjectStorage', () => {
  test('implements the public asset contract without exposing arbitrary files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'blendproof-storage-'))
    roots.push(root)
    const storage = new LocalProjectStorage(root)
    await storage.put('project-a', 'manifest.json', JSON.stringify({ scene: 'Test' }), 'application/json')
    await storage.put('project-a', 'model.glb', new Uint8Array([1, 2, 3]), 'model/gltf-binary')
    assert.equal(await storage.has('project-a', 'model.glb'), true)
    const manifest = await storage.get('project-a', 'manifest.json')
    assert.equal(manifest?.contentType, 'application/json; charset=utf-8')
    assert.equal(await new Response(manifest?.body).text(), JSON.stringify({ scene: 'Test' }))
    assert.deepEqual([...await readFile(storage.assetPath('project-a', 'model.glb'))], [1, 2, 3])
    assert.throws(() => storage.projectPath('../escape'), /项目标识无效/)
    await storage.deleteProject('project-a')
    assert.equal(await storage.has('project-a', 'model.glb'), false)
  })
})
