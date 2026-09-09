import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, test } from 'node:test'
import { BlendProofRepository, hashPassword, migrate } from '../server/db.js'

const draft = {
  objectName: 'Cube',
  position: [1, 2, 3] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
  camera: {
    projection: 'perspective' as const,
    position: [4, 5, 6] as [number, number, number],
    quaternion: [0, 0, 0, 1] as [number, number, number, number],
    target: [0, 0, 0] as [number, number, number],
    fov: 45,
  },
  body: 'Review',
  authorName: 'Test',
}

describe('SQLite repository', () => {
  test('schema migration is idempotent and enables integrity controls', () => {
    const database = new DatabaseSync(':memory:')
    migrate(database)
    migrate(database)
    const repository = new BlendProofRepository(database)
    assert.equal((database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1)
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count, 1)
    repository.close()
  })

  test('comments remain project-scoped under a large write batch', () => {
    const repository = new BlendProofRepository(new DatabaseSync(':memory:'))
    const a = repository.registerProject({ id: 'project-a', name: 'A' })
    const b = repository.registerProject({ id: 'project-b', name: 'B' })
    for (let index = 0; index < 100; index += 1) repository.createComment(a.id, { ...draft, body: `A-${index}` })
    repository.createComment(b.id, { ...draft, body: 'B-only' })
    assert.equal(repository.listComments(a.id).length, 100)
    assert.deepEqual(repository.listComments(b.id).map((comment) => comment.body), ['B-only'])
    assert.equal(repository.updateComment(b.id, repository.listComments(a.id)[0].id, { status: 'resolved' }), null)
    assert.equal(repository.verifyOwnerCapability(a.id, b.ownerCapability), false)
    repository.close()
  })

  test('password, expiration and revocation state never expose hashes', async () => {
    const repository = new BlendProofRepository(new DatabaseSync(':memory:'))
    const project = repository.registerProject({ name: 'Protected' })
    const share = repository.createShare(project.id, {
      passwordHash: await hashPassword('secret-pass'),
      expiresAt: '2099-01-01T00:00:00.000Z',
      commentsPermission: 'comment',
    })
    assert.equal(await repository.verifySharePassword(share.token, 'secret-pass'), true)
    assert.equal(await repository.verifySharePassword(share.token, 'wrong-pass'), false)
    assert.equal('passwordHash' in share, false)
    assert.equal(repository.isShareExpired(share, new Date('2100-01-01')), true)
    assert.ok(repository.revokeShare(project.id, share.id)?.revokedAt)
    repository.close()
  })
})
