import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  LegacyMigrationError,
  migrateLegacy,
  type LegacyCommentRecord,
  type LegacyMigrationRepository,
  type LegacyMigrationTransaction,
  type LegacyProjectRecord,
  type LegacyShareRecord,
} from "../server/migrate-legacy.ts";

class MemoryRepository implements LegacyMigrationRepository {
  projects = new Map<string, LegacyProjectRecord>();
  shares = new Map<string, LegacyShareRecord>();
  comments = new Map<string, LegacyCommentRecord>();

  transaction<T>(work: (repository: LegacyMigrationTransaction) => T): T {
    const snapshot = {
      projects: new Map(this.projects),
      shares: new Map(this.shares),
      comments: new Map(this.comments),
    };
    const tx: LegacyMigrationTransaction = {
      findProject: (id) => this.projects.get(id),
      insertProject: (project) => this.projects.set(project.id, project),
      findShareByToken: (token) => [...this.shares.values()].find((share) => share.token === token),
      insertShare: (share) => this.shares.set(share.id, share),
      findComment: (id) => this.comments.get(id),
      insertComment: (comment) => this.comments.set(comment.id, comment),
    };
    try {
      return work(tx);
    } catch (error) {
      this.projects = snapshot.projects;
      this.shares = snapshot.shares;
      this.comments = snapshot.comments;
      throw error;
    }
  }
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "blendproof-legacy-"));
  const project = path.join(root, "legacy-project");
  await (await import("node:fs/promises")).mkdir(project, { recursive: true });
  await writeFile(path.join(project, "model.glb"), "not actually a GLB");
  await writeFile(path.join(project, "manifest.json"), JSON.stringify({ scene: "Legacy scene", objects: [] }));
  await writeFile(
    path.join(project, "share.json"),
    JSON.stringify({ token: "0123456789abcdef0123456789abcdef", createdAt: "2026-09-01T00:00:00.000Z" }),
  );
  await writeFile(
    path.join(project, "comments.json"),
    JSON.stringify([{
      id: "comment-1",
      objectName: "Cube",
      position: [1, 2, 3],
      normal: [0, 0, 1],
      camera: {
        projection: "perspective",
        position: [4, 5, 6],
        quaternion: [0, 0, 0, 1],
        target: [0, 0, 0],
        fov: 45,
      },
      body: "Old note",
      authorName: "Legacy author",
      status: "open",
      projectId: "legacy-project",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    }]),
  );
  await writeFile(
    path.join(project, "comments.test-backup.json"),
    JSON.stringify([{ id: "must-not-import", body: "backup" }]),
  );
  return { root, project };
}

test("迁移旧项目、分享和评论，且忽略 test-backup 并保留原文件", async () => {
  const { root, project } = await fixtureRoot();
  try {
    const db = new MemoryRepository();
    const first = await migrateLegacy(root, db);
    assert.deepEqual(first, {
      projectsScanned: 1,
      projectsImported: 1,
      projectsSkipped: 0,
      sharesImported: 1,
      sharesSkipped: 0,
      commentsImported: 1,
      commentsSkipped: 0,
    });
    assert.equal(db.projects.get("legacy-project")?.ownerId, null);
    assert.equal(db.shares.get("legacy:0123456789abcdef0123456789abcdef")?.commentsPermission, "read_only");
    assert.equal(db.shares.get("legacy:0123456789abcdef0123456789abcdef")?.passwordHash, null);
    assert.equal(db.comments.size, 1);
    assert.equal(db.comments.has("must-not-import"), false);

    const second = await migrateLegacy(root, db);
    assert.deepEqual(second, {
      projectsScanned: 1,
      projectsImported: 0,
      projectsSkipped: 1,
      sharesImported: 0,
      sharesSkipped: 1,
      commentsImported: 0,
      commentsSkipped: 1,
    });
    assert.equal(await readFile(path.join(project, "share.json"), "utf8"),
      JSON.stringify({ token: "0123456789abcdef0123456789abcdef", createdAt: "2026-09-01T00:00:00.000Z" }));
    assert.equal(await readFile(path.join(project, "comments.test-backup.json"), "utf8"),
      JSON.stringify([{ id: "must-not-import", body: "backup" }]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("非法 JSON 报告具体文件并回滚所在项目事务", async () => {
  const { root, project } = await fixtureRoot();
  try {
    const commentsPath = path.join(project, "comments.json");
    await writeFile(commentsPath, "{not-json");
    const db = new MemoryRepository();
    await assert.rejects(
      migrateLegacy(root, db),
      (error: unknown) => error instanceof LegacyMigrationError &&
        error.filePath === commentsPath && error.message.includes(commentsPath),
    );
    assert.equal(db.projects.size, 0);
    assert.equal(db.shares.size, 0);
    assert.equal(db.comments.size, 0);
    assert.equal(await readFile(commentsPath, "utf8"), "{not-json");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("同一批次重复 token 和重复评论会在具体 JSON 文件处失败且不留下部分记录", async () => {
  const { root, project } = await fixtureRoot();
  const secondProject = path.join(root, "legacy-project-2");
  try {
    await (await import("node:fs/promises")).mkdir(secondProject, { recursive: true });
    await writeFile(path.join(secondProject, "model.glb"), "model");
    await writeFile(path.join(secondProject, "manifest.json"), JSON.stringify({ scene: "Second" }));
    await writeFile(path.join(secondProject, "share.json"), JSON.stringify({ token: "0123456789abcdef0123456789abcdef" }));
    const db = new MemoryRepository();
    await assert.rejects(migrateLegacy(root, db), (error: unknown) =>
      error instanceof LegacyMigrationError && error.filePath.endsWith(path.join("legacy-project-2", "share.json")));
    // The first project is a valid, committed transaction; only the
    // conflicting second project's transaction is rolled back.
    assert.equal(db.projects.size, 1);
    assert.equal(db.shares.size, 1);
    assert.equal(db.comments.size, 1);
    // A duplicate inside one comments.json is diagnosed before its project transaction.
    await rm(secondProject, { recursive: true, force: true });
    await (await import("node:fs/promises")).mkdir(secondProject, { recursive: true });
    await writeFile(path.join(secondProject, "model.glb"), "model");
    await writeFile(path.join(secondProject, "manifest.json"), JSON.stringify({ scene: "Second" }));
    const duplicateComment = {
      id: "x",
      objectName: null,
      position: [0, 0, 0],
      normal: [0, 0, 1],
      camera: {
        projection: "orthographic",
        position: [0, 0, 5],
        quaternion: [0, 0, 0, 1],
        target: [0, 0, 0],
        zoom: 1,
      },
      body: "Duplicate",
      authorName: "Legacy author",
      status: "open",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    await writeFile(path.join(secondProject, "comments.json"), JSON.stringify([duplicateComment, duplicateComment]));
    await assert.rejects(migrateLegacy(root, db), (error: unknown) =>
      error instanceof LegacyMigrationError && error.filePath.endsWith(path.join("legacy-project-2", "comments.json")));
    assert.equal(db.projects.size, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
