import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * The smallest synchronous boundary required by the legacy importer.
 *
 * File parsing happens before a transaction is opened.  The transaction only
 * performs synchronous repository operations, which makes this interface
 * usable by both a node:sqlite DatabaseSync-backed repository and an in-memory
 * test repository.  A SQLite adapter should expose the existing database
 * schema through these methods rather than making the importer know table
 * names or column encodings.
 */
export interface LegacyMigrationRepository {
  transaction<T>(work: (repository: LegacyMigrationTransaction) => T): T;
}

/**
 * Structural type for node:sqlite, kept here to avoid coupling to its runtime
 * class.  `BlendProofRepository` is also accepted through its public
 * `database` handle, so the migration does not need to import the repository
 * class (and remains easy to unit-test).
 */
export type LegacyMigrationDatabase = LegacyMigrationRepository | DatabaseSync | { database: DatabaseSync };

export interface LegacyMigrationTransaction {
  findProject(id: string): LegacyProjectRecord | null | undefined;
  insertProject(project: LegacyProjectRecord): void;
  findShareByToken(token: string): LegacyShareRecord | null | undefined;
  insertShare(share: LegacyShareRecord): void;
  findComment(id: string): LegacyCommentRecord | null | undefined;
  insertComment(comment: LegacyCommentRecord): void;
}

/** The metadata normalized from a legacy project directory. */
export interface LegacyProjectRecord {
  id: string;
  name: string;
  ownerId: string | null;
  /** The manifest remains in the project directory; repositories may omit it. */
  manifest?: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
}

/** A legacy share is intentionally imported as an unprotected read-only share. */
export interface LegacyShareRecord {
  /** Deterministic ID (`legacy:<token>`) keeps retries idempotent. */
  id: string;
  projectId: string;
  token: string;
  passwordHash: string | null;
  expiresAt: string | null;
  commentsPermission: "read_only" | "comment";
  revokedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Comment fields are kept opaque so old, forward-compatible fields survive. */
export type LegacyCommentRecord = Record<string, unknown> & {
  id: string;
  projectId: string;
};

export interface LegacyMigrationReport {
  projectsScanned: number;
  projectsImported: number;
  projectsSkipped: number;
  sharesImported: number;
  sharesSkipped: number;
  commentsImported: number;
  commentsSkipped: number;
}

/** A malformed legacy record is distinguishable from a database failure. */
export class LegacyMigrationError extends Error {
  readonly filePath: string;
  readonly projectId?: string;

  constructor(message: string, filePath: string, projectId?: string, options?: ErrorOptions) {
    super(`${message}（文件：${filePath}）`, options);
    this.name = "LegacyMigrationError";
    this.filePath = filePath;
    this.projectId = projectId;
  }
}

type LegacyShareJson = {
  token: string;
  createdAt?: string;
};

/**
 * Import projects written by the pre-SQLite file-storage implementation.
 *
 * `storageRoot` is the projects directory itself (the directory containing
 * one child directory per project).  Only children containing model.glb are
 * considered.  No source file is moved, renamed, rewritten, or deleted.
 * Missing share.json/comments.json are valid for old projects that never had
 * a share or a review comment.  Present files must contain valid JSON and the
 * expected root shape.
 */
export async function migrateLegacy(
  storageRoot: string,
  db: LegacyMigrationDatabase,
): Promise<LegacyMigrationReport> {
  const repository = isMigrationRepository(db)
    ? db
    : isRepositoryWithDatabase(db)
      ? createDatabaseSyncRepository(db.database)
      : createDatabaseSyncRepository(db);
  const report: LegacyMigrationReport = {
    projectsScanned: 0,
    projectsImported: 0,
    projectsSkipped: 0,
    sharesImported: 0,
    sharesSkipped: 0,
    commentsImported: 0,
    commentsSkipped: 0,
  };

  let entries;
  try {
    entries = await readdir(storageRoot, { withFileTypes: true });
  } catch (error) {
    throw new LegacyMigrationError(
      `无法扫描旧项目目录：${error instanceof Error ? error.message : String(error)}`,
      storageRoot,
    );
  }

  // Stable order makes duplicate diagnostics and migration reports repeatable.
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const legacyProjects = [] as string[];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(storageRoot, entry.name);
    if (await isRegularFile(path.join(projectDir, "model.glb"))) {
      legacyProjects.push(entry.name);
    }
  }

  for (const projectId of legacyProjects) {
    report.projectsScanned += 1;
    const projectDir = path.join(storageRoot, projectId);
    const records = await readLegacyProject(projectDir, projectId);

    // Every project is its own transaction.  A malformed file or a duplicate
    // therefore cannot leave a half-imported project behind.
    let outcome: unknown;
    try {
      outcome = repository.transaction((transaction) => {
        const existingProject = transaction.findProject(records.project.id);
        if (existingProject) {
          assertSameProject(existingProject, records.project, projectDir, projectId);
          report.projectsSkipped += 1;
        } else {
          transaction.insertProject(records.project);
          report.projectsImported += 1;
        }

        if (records.share) {
          const existingShare = transaction.findShareByToken(records.share.token);
          if (existingShare) {
            assertSameShare(existingShare, records.share, path.join(projectDir, "share.json"), projectId);
            report.sharesSkipped += 1;
          } else {
            transaction.insertShare(records.share);
            report.sharesImported += 1;
          }
        }

        for (const comment of records.comments) {
          const existingComment = transaction.findComment(comment.id);
          if (existingComment) {
            assertSameComment(existingComment, comment, path.join(projectDir, "comments.json"), projectId);
            report.commentsSkipped += 1;
          } else {
            transaction.insertComment(comment);
            report.commentsImported += 1;
          }
        }
      });
    } catch (error) {
      if (error instanceof LegacyMigrationError) throw error;
      const failureFile = records.comments.length > 0
        ? path.join(projectDir, "comments.json")
        : records.share
          ? path.join(projectDir, "share.json")
          : path.join(projectDir, "manifest.json");
      throw new LegacyMigrationError(
        `数据库写入失败：${error instanceof Error ? error.message : String(error)}`,
        failureFile,
        projectId,
        { cause: error },
      );
    }
    // The expression deliberately awaits nothing: a repository backed by
    // DatabaseSync is synchronous.  Keeping this check catches accidental
    // async transaction implementations before they can report false success.
    if (isPromiseLike(outcome)) {
      throw new TypeError("LegacyMigrationRepository.transaction 必须同步完成。");
    }
  }

  return report;
}

async function readLegacyProject(projectDir: string, projectId: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(projectId)) {
    throw new LegacyMigrationError("项目目录名不符合项目标识约定", projectDir, projectId);
  }

  const manifestPath = path.join(projectDir, "manifest.json");
  const manifest = await readJsonObject(manifestPath, projectId, "manifest.json");
  const sharePath = path.join(projectDir, "share.json");
  const shareJson = await readOptionalJson(sharePath, projectId, "share.json");
  const commentsPath = path.join(projectDir, "comments.json");
  const commentsJson = await readOptionalJson(commentsPath, projectId, "comments.json");

  const share = shareJson === undefined ? undefined : normalizeShare(shareJson, sharePath, projectId);
  const comments = commentsJson === undefined
    ? []
    : normalizeComments(commentsJson, commentsPath, projectId);
  const createdAt = share?.createdAt ?? null;
  const project: LegacyProjectRecord = {
    id: projectId,
    name: typeof manifest.scene === "string" && manifest.scene.trim() ? manifest.scene : projectId,
    ownerId: null,
    manifest,
    createdAt,
    updatedAt: createdAt,
  };
  return { project, share, comments };
}

async function readOptionalJson(filePath: string, projectId: string, label: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw invalidJsonError(filePath, projectId, label, error);
  }
}

async function readJsonObject(filePath: string, projectId: string, label: string): Promise<Record<string, unknown>> {
  const value = await readOptionalJson(filePath, projectId, label);
  if (!isObject(value)) {
    throw new LegacyMigrationError(`${label} 必须是 JSON 对象`, filePath, projectId);
  }
  return value;
}

function normalizeShare(value: unknown, filePath: string, projectId: string): LegacyShareRecord {
  if (!isObject(value) || typeof value.token !== "string" || !/^[a-f0-9]{32}$/.test(value.token)) {
    throw new LegacyMigrationError("share.json.token 必须是 32 位小写十六进制令牌", filePath, projectId);
  }
  const createdAt = value.createdAt ?? LEGACY_UNKNOWN_DATE;
  if (!isIsoDate(createdAt)) {
    throw new LegacyMigrationError("share.json.createdAt 必须是 ISO 日期", filePath, projectId);
  }
  return {
    id: `legacy:${value.token}`,
    projectId,
    token: value.token,
    passwordHash: null,
    expiresAt: null,
    commentsPermission: "read_only",
    revokedAt: null,
    createdAt: createdAt ?? null,
    updatedAt: createdAt ?? null,
  };
}

function normalizeComments(value: unknown, filePath: string, projectId: string): LegacyCommentRecord[] {
  if (!Array.isArray(value)) {
    throw new LegacyMigrationError("comments.json 必须是 JSON 数组", filePath, projectId);
  }
  const ids = new Set<string>();
  return value.map((item, index): LegacyCommentRecord => {
    if (!isObject(item) || typeof item.id !== "string" || !item.id.trim()) {
      throw new LegacyMigrationError(`comments.json[${index}].id 缺失或无效`, filePath, projectId);
    }
    if (ids.has(item.id)) {
      throw new LegacyMigrationError(`comments.json 含重复评论 id：${item.id}`, filePath, projectId);
    }
    ids.add(item.id);
    if (item.projectId !== undefined && item.projectId !== projectId) {
      throw new LegacyMigrationError(
        `comments.json[${index}].projectId 与所在项目不一致`,
        filePath,
        projectId,
      );
    }
    if (item.objectName !== null && typeof item.objectName !== "string") {
      throw new LegacyMigrationError(`comments.json[${index}].objectName 无效`, filePath, projectId);
    }
    if (typeof item.body !== "string" || !item.body.trim() || item.body.length > 5000) {
      throw new LegacyMigrationError(`comments.json[${index}].body 无效`, filePath, projectId);
    }
    if (typeof item.authorName !== "string" || !item.authorName.trim() || item.authorName.length > 120) {
      throw new LegacyMigrationError(`comments.json[${index}].authorName 无效`, filePath, projectId);
    }
    if (!isVec3(item.position) || !isVec3(item.normal) || !hasMagnitude(item.normal)) {
      throw new LegacyMigrationError(`comments.json[${index}] 的位置或法线锚点无效`, filePath, projectId);
    }
    if (!isCameraState(item.camera)) {
      throw new LegacyMigrationError(`comments.json[${index}].camera 无效`, filePath, projectId);
    }
    if (item.status !== "open" && item.status !== "resolved") {
      throw new LegacyMigrationError(`comments.json[${index}].status 无效`, filePath, projectId);
    }
    if (!isIsoDate(item.createdAt) || !isIsoDate(item.updatedAt)) {
      throw new LegacyMigrationError(`comments.json[${index}] 的时间字段无效`, filePath, projectId);
    }
    return { ...item, projectId } as LegacyCommentRecord;
  });
}

function assertSameProject(
  existing: LegacyProjectRecord,
  incoming: LegacyProjectRecord,
  projectDir: string,
  projectId: string,
) {
  if ((existing.manifest !== undefined && !sameJson(existing.manifest, incoming.manifest)) || existing.name !== incoming.name) {
    throw new LegacyMigrationError("数据库中已存在内容不同的项目记录", projectDir, projectId);
  }
}

function assertSameShare(
  existing: LegacyShareRecord,
  incoming: LegacyShareRecord,
  filePath: string,
  projectId: string,
) {
  if (!sameJson(existing, incoming)) {
    throw new LegacyMigrationError(`数据库中已存在内容不同的分享令牌：${incoming.token}`, filePath, projectId);
  }
}

function assertSameComment(
  existing: LegacyCommentRecord,
  incoming: LegacyCommentRecord,
  filePath: string,
  projectId: string,
) {
  if (!sameJson(existing, incoming)) {
    throw new LegacyMigrationError(`数据库中已存在内容不同的评论：${incoming.id}`, filePath, projectId);
  }
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(sortObject(left)) === JSON.stringify(sortObject(right));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function hasMagnitude(value: unknown) {
  return isVec3(value) && value.some((item) => Math.abs(item) > 1e-8);
}

function isCameraState(value: unknown) {
  if (!isObject(value)) return false;
  const projection = value.projection;
  const quaternion = value.quaternion;
  return (projection === "perspective" || projection === "orthographic") &&
    isVec3(value.position) && isVec3(value.target) &&
    Array.isArray(quaternion) && quaternion.length === 4 &&
    quaternion.every((item) => typeof item === "number" && Number.isFinite(item)) &&
    quaternion.some((item) => Math.abs(item) > 1e-8) &&
    (projection !== "perspective" || (typeof value.fov === "number" && value.fov > 0 && value.fov < 180)) &&
    (projection !== "orthographic" || (typeof value.zoom === "number" && value.zoom > 0));
}

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function invalidJsonError(filePath: string, projectId: string, label: string, error: unknown) {
  return new LegacyMigrationError(
    `${label} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
    filePath,
    projectId,
    { cause: error },
  );
}

async function isRegularFile(filePath: string) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value) && typeof (value as { then?: unknown }).then === "function";
}

function hashSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * Adapt the current node:sqlite schema to the importer boundary.  Keeping
 * this adapter here lets callers pass either `BlendProofRepository`'s
 * underlying DatabaseSync or a small repository fake in unit tests, while the
 * migration algorithm itself remains independent of SQL table names.
 */
export function createDatabaseSyncRepository(database: DatabaseSync): LegacyMigrationRepository {
  return {
    transaction<T>(work: (repository: LegacyMigrationTransaction) => T): T {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = work(createSqlTransaction(database));
        database.exec("COMMIT");
        return result;
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch { /* preserve the original error */ }
        throw error;
      }
    },
  };
}

function isMigrationRepository(value: LegacyMigrationDatabase): value is LegacyMigrationRepository {
  return typeof (value as Partial<LegacyMigrationRepository>).transaction === "function";
}

function isRepositoryWithDatabase(value: LegacyMigrationDatabase): value is { database: DatabaseSync } {
  return Boolean(value) && typeof (value as { database?: unknown }).database === "object" &&
    typeof (value as { database?: { prepare?: unknown } }).database?.prepare === "function";
}

function createSqlTransaction(database: DatabaseSync): LegacyMigrationTransaction {
  return {
    findProject(id) {
      const row = database.prepare(`
        SELECT id, name, owner_id, created_at
        FROM projects WHERE id = ?
      `).get(id) as {
        id: string;
        name: string;
        owner_id: string | null;
        created_at: string;
      } | undefined;
      if (!row) return undefined;
      return {
        id: row.id,
        name: row.name,
        ownerId: row.owner_id,
        // The current schema intentionally keeps manifest.json on disk.
        manifest: undefined,
        createdAt: row.created_at,
        updatedAt: row.created_at,
      };
    },
    insertProject(project) {
      database.prepare(`
        INSERT INTO projects
          (id, name, model_url, manifest_url, owner_id, owner_capability_hash, created_at)
        VALUES (?, ?, ?, ?, NULL, ?, ?)
      `).run(
        project.id,
        project.name,
        `/files/${project.id}/model.glb`,
        `/files/${project.id}/manifest.json`,
        hashSecret(randomBytes(32).toString("hex")),
        project.createdAt ?? LEGACY_UNKNOWN_DATE,
      );
    },
    findShareByToken(token) {
      const row = database.prepare(`
        SELECT id, project_id, password_hash, expires_at, comments_permission,
               revoked_at, created_at, updated_at
        FROM shares WHERE token_hash = ?
      `).get(hashSecret(token)) as {
        id: string;
        project_id: string;
        password_hash: string | null;
        expires_at: string | null;
        comments_permission: "read_only" | "comment";
        revoked_at: string | null;
        created_at: string;
        updated_at: string;
      } | undefined;
      if (!row) return undefined;
      return {
        id: row.id,
        projectId: row.project_id,
        token,
        passwordHash: row.password_hash,
        expiresAt: row.expires_at,
        commentsPermission: row.comments_permission,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },
    insertShare(share) {
      database.prepare(`
        INSERT INTO shares
          (id, project_id, token_hash, password_hash, expires_at, comments_permission,
           revoked_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, NULL, 'read_only', NULL, ?, ?)
      `).run(
        share.id,
        share.projectId,
        hashSecret(share.token),
        null,
        share.createdAt ?? LEGACY_UNKNOWN_DATE,
        share.updatedAt ?? share.createdAt ?? LEGACY_UNKNOWN_DATE,
      );
    },
    findComment(id) {
      const row = database.prepare(`
        SELECT id, project_id, object_name, position_json, normal_json, camera_json,
               body, author_name, status, created_at, updated_at
        FROM comments WHERE id = ?
      `).get(id) as SqlCommentRow | undefined;
      if (!row) return undefined;
      return {
        id: row.id,
        projectId: row.project_id,
        objectName: row.object_name,
        position: parseSqlJson(row.position_json),
        normal: parseSqlJson(row.normal_json),
        camera: parseSqlJson(row.camera_json),
        body: row.body,
        authorName: row.author_name,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },
    insertComment(comment) {
      const value = comment as Record<string, unknown>;
      const body = requireString(value.body, "body");
      const authorName = requireString(value.authorName, "authorName");
      const objectName = value.objectName as string | null;
      const status = value.status as "open" | "resolved";
      database.prepare(`
        INSERT INTO comments
          (id, project_id, object_name, position_json, normal_json, camera_json,
           body, author_name, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        comment.id,
        comment.projectId,
        objectName,
        JSON.stringify(value.position),
        JSON.stringify(value.normal),
        JSON.stringify(value.camera),
        body,
        authorName,
        status,
        typeof value.createdAt === "string" ? value.createdAt : LEGACY_UNKNOWN_DATE,
        typeof value.updatedAt === "string" ? value.updatedAt : LEGACY_UNKNOWN_DATE,
      );
    },
  };
}

type SqlCommentRow = {
  id: string;
  project_id: string;
  object_name: string | null;
  position_json: string;
  normal_json: string;
  camera_json: string;
  body: string;
  author_name: string;
  status: "open" | "resolved";
  created_at: string;
  updated_at: string;
};

const LEGACY_UNKNOWN_DATE = "1970-01-01T00:00:00.000Z";

function parseSqlJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return undefined; }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`旧评论 ${field} 无效。`);
  return value;
}
