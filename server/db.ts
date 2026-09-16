import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

/**
 * The SQLite layer deliberately knows nothing about HTTP or the filesystem
 * representation of a project.  The Express layer can therefore keep serving
 * GLB/manifest files from the project directory while using this module for
 * metadata and review state.
 */

export type Vec3 = [number, number, number]

export type ReviewCameraState = {
  projection: 'perspective' | 'orthographic'
  position: Vec3
  quaternion: [number, number, number, number]
  target: Vec3
  fov?: number
  zoom?: number
  orthographicHeight?: number
}

export type ReviewReply = {
  id: string
  commentId: string
  body: string
  authorName: string
  authorType: 'owner' | 'guest'
  createdAt: string
}

export type ReviewReplyDraft = { body: string; authorName: string }

export type ReviewComment = {
  id: string
  projectId: string
  objectName: string | null
  position: Vec3
  normal: Vec3
  camera: ReviewCameraState
  body: string
  authorName: string
  authorType: 'owner' | 'guest'
  status: 'open' | 'resolved'
  createdAt: string
  updatedAt: string
  /** 内联返回，避免前端为每条评论再发一次请求。 */
  replies: ReviewReply[]
}

export type ReviewCommentDraft = Omit<
  ReviewComment,
  'id' | 'projectId' | 'status' | 'createdAt' | 'updatedAt' | 'authorType' | 'replies'
>

export type CommentPatch = Partial<Pick<ReviewComment, 'body' | 'status'>>

/**
 * 作者身份与删除令牌。
 *
 * 访客没有可验证身份（author_id 恒为 null），删除自己的内容只能凭创建时发放的令牌；
 * 库里只存 SHA-256 摘要，明文只在创建响应里返回一次。
 */
export type CommentAuthorOptions = {
  authorType?: 'owner' | 'guest'
  deleteTokenHash?: string | null
}

export type ProjectRecord = {
  id: string
  name: string
  modelUrl: string
  manifestUrl: string
  ownerId: string | null
  createdAt: string
}

export type ProjectRegistration = ProjectRecord & {
  /** Returned once to the caller; only its SHA-256 digest is persisted. */
  ownerCapability: string
}

export type CommentsPermission = 'read_only' | 'comment'

/** Public share data. Sensitive hashes and the original token are excluded. */
export type ShareRecord = {
  id: string
  projectId: string
  passwordProtected: boolean
  expiresAt: string | null
  commentsPermission: CommentsPermission
  revokedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CreatedShare = ShareRecord & {
  /** The only operation that returns the newly generated token. */
  token: string
  shareUrl: string
}

export type DatabaseOptions = {
  /** Defaults to BLENDPROOF_DB_PATH or storage/blendproof.sqlite. */
  path?: string
}

export type RepositoryOptions = DatabaseOptions & {
  database?: DatabaseSync
}

export type RegisterProjectInput = {
  id?: string
  name: string
  modelUrl?: string
  manifestUrl?: string
  ownerId?: string | null
}

export type CreateShareInput = {
  id?: string
  /** Useful for an explicit migration later; normal callers should omit it. */
  token?: string
  /** A password hash produced by the access layer; plaintext is never accepted here. */
  passwordHash?: string | null
  expiresAt?: string | null
  commentsPermission?: CommentsPermission
  shareUrl?: string
}

const scrypt = promisify(scryptCallback)

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 4 || password.length > 200) {
    throw new TypeError('分享密码需要 4 到 200 个字符。')
  }
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 32) as Buffer
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = encoded.split('$')
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(saltHex) || !/^[a-f0-9]{64}$/.test(hashHex)) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length) as Buffer
  return timingSafeEqual(actual, expected)
}

type ProjectRow = {
  id: string
  name: string
  model_url: string
  manifest_url: string
  owner_id: string | null
  created_at: string
}

type ShareRow = {
  id: string
  project_id: string
  password_hash: string | null
  expires_at: string | null
  comments_permission: CommentsPermission
  revoked_at: string | null
  created_at: string
  updated_at: string
}

type CommentRow = {
  id: string
  project_id: string
  object_name: string | null
  position_json: string
  normal_json: string
  camera_json: string
  body: string
  author_name: string
  author_type: 'owner' | 'guest'
  status: 'open' | 'resolved'
  delete_token_hash: string | null
  created_at: string
  updated_at: string
}

type ReplyRow = {
  id: string
  comment_id: string
  project_id: string
  body: string
  author_name: string
  author_type: 'owner' | 'guest'
  delete_token_hash: string | null
  created_at: string
}

/** 列清单集中在此，避免各查询漏列或列序不一致。 */
const commentColumns = `id, project_id, object_name, position_json, normal_json, camera_json,
             body, author_name, author_type, status, delete_token_hash, created_at, updated_at`
const replyColumns = `id, comment_id, project_id, body, author_name, author_type,
             delete_token_hash, created_at`

const schemaMigrations: ReadonlyArray<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        model_url TEXT NOT NULL,
        manifest_url TEXT NOT NULL,
        owner_id TEXT,
        owner_capability_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE shares (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        expires_at TEXT,
        comments_permission TEXT NOT NULL DEFAULT 'read_only'
          CHECK (comments_permission IN ('read_only', 'comment')),
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE comments (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        object_name TEXT,
        position_json TEXT NOT NULL,
        normal_json TEXT NOT NULL,
        camera_json TEXT NOT NULL,
        body TEXT NOT NULL,
        author_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'resolved')),
        author_id TEXT,
        author_type TEXT NOT NULL DEFAULT 'owner'
          CHECK (author_type IN ('owner', 'guest')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX shares_project_id_idx ON shares(project_id);
      CREATE INDEX comments_project_created_idx ON comments(project_id, created_at, id);
      CREATE INDEX comments_project_status_idx ON comments(project_id, status);
    `,
  },
  {
    // 批注回复：把审稿从「单向留言」变成可对话的闭环。
    // 与 D1 的 migrations/0010_comment_replies.sql 必须保持一致，否则两条通道行为分叉。
    version: 2,
    sql: `
      CREATE TABLE comment_replies (
        id TEXT PRIMARY KEY NOT NULL,
        comment_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        body TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_type TEXT NOT NULL DEFAULT 'owner'
          CHECK (author_type IN ('owner', 'guest')),
        delete_token_hash TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX comment_replies_comment_created_idx
        ON comment_replies(comment_id, created_at, id);
      CREATE INDEX comment_replies_project_idx ON comment_replies(project_id);

      ALTER TABLE comments ADD COLUMN delete_token_hash TEXT;
    `,
  },
]

const defaultDatabasePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'storage',
  'blendproof.sqlite',
)

/** SHA-256 is used for capabilities/tokens so the database is not a credential store. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export function generateOwnerCapability(): string {
  return randomBytes(32).toString('hex')
}

export function generateShareToken(): string {
  // Keep the existing 32-hex URL contract while storing only its digest.
  return randomBytes(16).toString('hex')
}

/**
 * 访客删除令牌。只把明文交给创建者一次，库里存 hashSecret(token)。
 * 比分享令牌更长，因为它是删除凭据而非 URL 标识。
 */
export function generateDeleteToken(): string {
  return randomBytes(32).toString('hex')
}

function isMemoryDatabase(databasePath: string): boolean {
  return databasePath === ':memory:' || databasePath.startsWith('file::memory:')
}

/** Open a configured database and apply all schema migrations exactly once. */
export async function openDatabase(databasePath = process.env.BLENDPROOF_DB_PATH ?? defaultDatabasePath) {
  if (!isMemoryDatabase(databasePath)) await mkdir(path.dirname(path.resolve(databasePath)), { recursive: true })

  const database = new DatabaseSync(databasePath)
  // Keep these explicit instead of relying solely on constructor defaults so
  // the same contract remains true when this module is adapted to D1 later.
  database.exec('PRAGMA foreign_keys = ON;')
  database.exec('PRAGMA journal_mode = WAL;')
  database.exec('PRAGMA synchronous = NORMAL;')
  database.exec('PRAGMA busy_timeout = 5000;')
  migrate(database)
  return database
}

export const createDatabase = openDatabase

export function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  const current = database
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number } | undefined
  const currentVersion = Number(current?.version ?? 0)

  for (const migration of schemaMigrations) {
    if (migration.version <= currentVersion) continue
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migration.sql)
      database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString())
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}

function withTransaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function toProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    modelUrl: row.model_url,
    manifestUrl: row.manifest_url,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  }
}

function toShare(row: ShareRow): ShareRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    passwordProtected: row.password_hash !== null,
    expiresAt: row.expires_at,
    commentsPermission: row.comments_permission,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseJson<T>(value: string, field: string): T {
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(`数据库中的 ${field} JSON 无效。`)
  }
}

function toReply(row: ReplyRow): ReviewReply {
  return {
    id: row.id,
    commentId: row.comment_id,
    body: row.body,
    authorName: row.author_name,
    authorType: row.author_type,
    createdAt: row.created_at,
  }
}

function toComment(row: CommentRow, replies: ReviewReply[] = []): ReviewComment {
  return {
    id: row.id,
    projectId: row.project_id,
    objectName: row.object_name,
    position: parseJson<Vec3>(row.position_json, 'position'),
    normal: parseJson<Vec3>(row.normal_json, 'normal'),
    camera: parseJson<ReviewCameraState>(row.camera_json, 'camera'),
    body: row.body,
    authorName: row.author_name,
    authorType: row.author_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    replies,
  }
}

export class BlendProofRepository {
  readonly database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.database = database
    // A caller may pass an already-open in-memory database in tests. Ensure
    // both pragmas and migrations still hold for that path.
    database.exec('PRAGMA foreign_keys = ON;')
    database.exec('PRAGMA journal_mode = WAL;')
    database.exec('PRAGMA synchronous = NORMAL;')
    database.exec('PRAGMA busy_timeout = 5000;')
    migrate(database)
  }

  registerProject(input: RegisterProjectInput): ProjectRegistration {
    if (!input || typeof input.name !== 'string' || !input.name.trim()) {
      throw new TypeError('项目名称不能为空。')
    }
    const id = input.id ?? randomUUID().replaceAll('-', '')
    const modelUrl = input.modelUrl ?? `/files/${id}/model.glb`
    const manifestUrl = input.manifestUrl ?? `/files/${id}/manifest.json`
    const ownerCapability = generateOwnerCapability()
    const now = new Date().toISOString()

    withTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO projects
          (id, name, model_url, manifest_url, owner_id, owner_capability_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.name,
        modelUrl,
        manifestUrl,
        input.ownerId ?? null,
        hashSecret(ownerCapability),
        now,
      )
    })

    return {
      id,
      name: input.name,
      modelUrl,
      manifestUrl,
      ownerId: input.ownerId ?? null,
      createdAt: now,
      ownerCapability,
    }
  }

  createProject(input: RegisterProjectInput): ProjectRegistration {
    return this.registerProject(input)
  }

  getProject(projectId: string): ProjectRecord | null {
    const row = this.database.prepare(`
      SELECT id, name, model_url, manifest_url, owner_id, created_at
      FROM projects WHERE id = ?
    `).get(projectId) as ProjectRow | undefined
    return row ? toProject(row) : null
  }

  deleteProject(projectId: string): void {
    withTransaction(this.database, () => {
      this.database.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    })
  }

  verifyOwnerCapability(projectId: string, capability: string): boolean {
    if (!capability) return false
    const row = this.database.prepare(
      'SELECT owner_capability_hash FROM projects WHERE id = ?',
    ).get(projectId) as { owner_capability_hash: string } | undefined
    return row?.owner_capability_hash === hashSecret(capability)
  }

  listComments(projectId: string): ReviewComment[] {
    // rowid 作为 insert 序 tiebreaker：同一毫秒创建的两条记录 created_at 相同，
    // 若退化到随机 id 排序，对话顺序会不确定。
    const rows = this.database.prepare(`
      SELECT ${commentColumns}
      FROM comments
      WHERE project_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(projectId) as unknown as CommentRow[]
    if (rows.length === 0) return []
    const replies = this.database.prepare(`
      SELECT ${replyColumns}
      FROM comment_replies
      WHERE project_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(projectId) as unknown as ReplyRow[]
    const grouped = new Map<string, ReviewReply[]>()
    for (const reply of replies) {
      const bucket = grouped.get(reply.comment_id)
      if (bucket) bucket.push(toReply(reply))
      else grouped.set(reply.comment_id, [toReply(reply)])
    }
    return rows.map((row) => toComment(row, grouped.get(row.id) ?? []))
  }

  createComment(
    projectId: string,
    draft: ReviewCommentDraft,
    options: CommentAuthorOptions = {},
  ): ReviewComment {
    const now = new Date().toISOString()
    const comment: ReviewComment = {
      objectName: draft.objectName,
      position: draft.position,
      normal: draft.normal,
      camera: draft.camera,
      body: draft.body.trim(),
      authorName: draft.authorName.trim(),
      authorType: options.authorType ?? 'owner',
      id: randomUUID(),
      projectId,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      replies: [],
    }
    withTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO comments
          (id, project_id, object_name, position_json, normal_json, camera_json,
           body, author_name, author_type, status, delete_token_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        comment.id,
        projectId,
        comment.objectName,
        JSON.stringify(comment.position),
        JSON.stringify(comment.normal),
        JSON.stringify(comment.camera),
        comment.body,
        comment.authorName,
        comment.authorType,
        comment.status,
        options.deleteTokenHash ?? null,
        comment.createdAt,
        comment.updatedAt,
      )
    })
    return comment
  }

  updateComment(projectId: string, commentId: string, patch: CommentPatch): ReviewComment | null {
    const existing = this.database.prepare(`
      SELECT ${commentColumns}
      FROM comments WHERE id = ? AND project_id = ?
    `).get(commentId, projectId) as CommentRow | undefined
    if (!existing) return null

    const nextBody = patch.body === undefined ? existing.body : patch.body
    const nextStatus = patch.status === undefined ? existing.status : patch.status
    const updatedAt = new Date().toISOString()
    withTransaction(this.database, () => {
      this.database.prepare(`
        UPDATE comments SET body = ?, status = ?, updated_at = ?
        WHERE id = ? AND project_id = ?
      `).run(nextBody, nextStatus, updatedAt, commentId, projectId)
    })
    const replies = this.database.prepare(`
      SELECT ${replyColumns} FROM comment_replies WHERE comment_id = ? AND project_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(commentId, projectId) as unknown as ReplyRow[]
    return toComment(
      { ...existing, body: nextBody, status: nextStatus, updated_at: updatedAt },
      replies.map(toReply),
    )
  }

  /** 删除评论并连带清理其回复，不留孤儿回复。 */
  deleteComment(projectId: string, commentId: string): void {
    withTransaction(this.database, () => {
      this.database.prepare('DELETE FROM comment_replies WHERE comment_id = ? AND project_id = ?')
        .run(commentId, projectId)
      this.database.prepare('DELETE FROM comments WHERE id = ? AND project_id = ?')
        .run(commentId, projectId)
    })
  }

  /** 评论不存在时返回 null，让调用方能回 404 而不是静默成功。 */
  createReply(
    projectId: string,
    commentId: string,
    draft: ReviewReplyDraft,
    options: CommentAuthorOptions = {},
  ): ReviewReply | null {
    const parent = this.database.prepare('SELECT id FROM comments WHERE id = ? AND project_id = ?')
      .get(commentId, projectId) as { id: string } | undefined
    if (!parent) return null
    const reply: ReviewReply = {
      id: randomUUID(),
      commentId,
      // 与 worker 通道保持一致：正文与作者名在写入时去除首尾空白。
      body: draft.body.trim(),
      authorName: draft.authorName.trim(),
      authorType: options.authorType ?? 'owner',
      createdAt: new Date().toISOString(),
    }
    withTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO comment_replies
          (id, comment_id, project_id, body, author_name, author_type, delete_token_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reply.id,
        reply.commentId,
        projectId,
        reply.body,
        reply.authorName,
        reply.authorType,
        options.deleteTokenHash ?? null,
        reply.createdAt,
      )
    })
    return reply
  }

  deleteReply(projectId: string, commentId: string, replyId: string): void {
    this.database.prepare(
      'DELETE FROM comment_replies WHERE id = ? AND comment_id = ? AND project_id = ?',
    ).run(replyId, commentId, projectId)
  }

  /** 访客删除令牌比对：库中只存摘要，因此返回摘要而非明文。 */
  commentDeleteTokenHash(projectId: string, commentId: string): string | null {
    const row = this.database.prepare(
      'SELECT delete_token_hash FROM comments WHERE id = ? AND project_id = ?',
    ).get(commentId, projectId) as { delete_token_hash: string | null } | undefined
    return row?.delete_token_hash ?? null
  }

  replyDeleteTokenHash(projectId: string, commentId: string, replyId: string): string | null {
    const row = this.database.prepare(
      'SELECT delete_token_hash FROM comment_replies WHERE id = ? AND comment_id = ? AND project_id = ?',
    ).get(replyId, commentId, projectId) as { delete_token_hash: string | null } | undefined
    return row?.delete_token_hash ?? null
  }

  createShare(projectId: string, input: CreateShareInput = {}): CreatedShare {
    const token = input.token ?? generateShareToken()
    if (!/^[a-f0-9]{32}$/.test(token)) throw new TypeError('分享令牌格式无效。')
    const commentsPermission = input.commentsPermission ?? 'read_only'
    if (commentsPermission !== 'read_only' && commentsPermission !== 'comment') {
      throw new TypeError('评论权限无效。')
    }
    if (input.expiresAt !== undefined && input.expiresAt !== null && !Number.isFinite(Date.parse(input.expiresAt))) {
      throw new TypeError('分享有效期无效。')
    }
    const id = input.id ?? randomUUID().replaceAll('-', '')
    const now = new Date().toISOString()

    withTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO shares
          (id, project_id, token_hash, password_hash, expires_at, comments_permission,
           revoked_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        id,
        projectId,
        hashSecret(token),
        input.passwordHash ?? null,
        input.expiresAt ?? null,
        commentsPermission,
        now,
        now,
      )
    })

    const share = this.findShareById(id)
    if (!share) throw new Error('创建分享后无法读取分享记录。')
    return {
      ...share,
      token,
      shareUrl: input.shareUrl ?? `/s/${token}`,
    }
  }

  findShare(token: string): ShareRecord | null {
    if (!token) return null
    const row = this.database.prepare(`
      SELECT id, project_id, password_hash, expires_at, comments_permission,
             revoked_at, created_at, updated_at
      FROM shares WHERE token_hash = ?
    `).get(hashSecret(token)) as ShareRow | undefined
    return row ? toShare(row) : null
  }

  findShareById(shareId: string): ShareRecord | null {
    const row = this.database.prepare(`
      SELECT id, project_id, password_hash, expires_at, comments_permission,
             revoked_at, created_at, updated_at
      FROM shares WHERE id = ?
    `).get(shareId) as ShareRow | undefined
    return row ? toShare(row) : null
  }

  /** Internal access-layer helper; the hash itself is never part of ShareRecord. */
  verifySharePasswordHash(token: string, passwordHash: string): boolean {
    if (!token || !passwordHash) return false
    const row = this.database.prepare(
      'SELECT password_hash FROM shares WHERE token_hash = ?',
    ).get(hashSecret(token)) as { password_hash: string | null } | undefined
    return row?.password_hash === passwordHash
  }

  async verifySharePassword(token: string, password: string): Promise<boolean> {
    const row = this.database.prepare(
      'SELECT password_hash FROM shares WHERE token_hash = ?',
    ).get(hashSecret(token)) as { password_hash: string | null } | undefined
    return Boolean(row?.password_hash && await verifyPassword(password, row.password_hash))
  }

  revokeShare(projectId: string, shareId: string): ShareRecord | null {
    const now = new Date().toISOString()
    const result = this.database.prepare(`
      UPDATE shares SET revoked_at = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND revoked_at IS NULL
    `).run(now, now, shareId, projectId)
    if (result.changes === 0) return null
    return this.findShareById(shareId)
  }

  isShareExpired(share: ShareRecord, now = new Date()): boolean {
    return share.expiresAt !== null && Date.parse(share.expiresAt) <= now.getTime()
  }

  close(): void {
    this.database.close()
  }
}

export async function createRepository(options: RepositoryOptions = {}): Promise<BlendProofRepository> {
  const database = options.database ?? await openDatabase(options.path)
  return new BlendProofRepository(database)
}
