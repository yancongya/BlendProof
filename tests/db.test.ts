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
    const applied = (database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count
    // 重复 migrate 不得重复应用；条数随迁移推进而增长，因此断言幂等而非固定条数。
    migrate(database)
    const afterSecondRun = (database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count
    const repository = new BlendProofRepository(database)
    assert.equal((database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1)
    assert.ok(applied >= 1)
    assert.equal(afterSecondRun, applied)
    // 0010 引入的回复表与访客删除令牌列。
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'comment_replies'").get())
    const commentColumns = database.prepare('PRAGMA table_info(comments)').all() as unknown as Array<{ name: string }>
    assert.ok(commentColumns.some((column) => column.name === 'delete_token_hash'))
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

  test('replies are listed inline and cascade when the comment is deleted', () => {
    const repository = new BlendProofRepository(new DatabaseSync(':memory:'))
    const project = repository.registerProject({ name: 'Replies' })
    const comment = repository.createComment(project.id, draft)

    assert.deepEqual(comment.replies, [])
    assert.equal(comment.authorType, 'owner')

    const first = repository.createReply(project.id, comment.id, { body: '第一条回复', authorName: '审查者' })
    assert.ok(first)
    repository.createReply(project.id, comment.id, { body: '第二条回复', authorName: '审查者' }, { authorType: 'guest', deleteTokenHash: 'hash-a' })

    const [loaded] = repository.listComments(project.id)
    assert.deepEqual(loaded.replies.map((reply) => reply.body), ['第一条回复', '第二条回复'])
    assert.equal(loaded.replies[1].authorType, 'guest')

    // 回复必须挂在存在的评论上。
    assert.equal(repository.createReply(project.id, 'missing-comment', { body: 'x', authorName: 'y' }), null)

    repository.deleteComment(project.id, comment.id)
    assert.equal(repository.listComments(project.id).length, 0)
    const orphans = repository.database
      .prepare('SELECT COUNT(*) AS count FROM comment_replies WHERE project_id = ?')
      .get(project.id) as { count: number }
    assert.equal(orphans.count, 0)
    repository.close()
  })

  test('deleting one reply leaves its siblings intact', () => {
    const repository = new BlendProofRepository(new DatabaseSync(':memory:'))
    const project = repository.registerProject({ name: 'Siblings' })
    const comment = repository.createComment(project.id, draft)
    const keep = repository.createReply(project.id, comment.id, { body: 'keep', authorName: 'A' })
    const drop = repository.createReply(project.id, comment.id, { body: 'drop', authorName: 'B' })
    assert.ok(keep && drop)

    repository.deleteReply(project.id, comment.id, drop.id)
    const [loaded] = repository.listComments(project.id)
    assert.deepEqual(loaded.replies.map((reply) => reply.body), ['keep'])
    repository.close()
  })

  test('delete token hashes are readable but never leak through the comment payload', () => {
    const repository = new BlendProofRepository(new DatabaseSync(':memory:'))
    const project = repository.registerProject({ name: 'Tokens' })
    const comment = repository.createComment(project.id, draft, { authorType: 'guest', deleteTokenHash: 'comment-hash' })
    const reply = repository.createReply(project.id, comment.id, { body: 'r', authorName: 'G' }, { authorType: 'guest', deleteTokenHash: 'reply-hash' })
    assert.ok(reply)

    assert.equal(repository.commentDeleteTokenHash(project.id, comment.id), 'comment-hash')
    assert.equal(repository.replyDeleteTokenHash(project.id, comment.id, reply.id), 'reply-hash')
    assert.equal(repository.commentDeleteTokenHash(project.id, 'missing'), null)

    // 列表响应绝不包含令牌（否则任何拿到分享链接的人都能删除他人批注）。
    const [loaded] = repository.listComments(project.id)
    assert.equal('deleteTokenHash' in loaded, false)
    assert.equal('delete_token_hash' in loaded, false)
    assert.equal('deleteTokenHash' in loaded.replies[0], false)
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
