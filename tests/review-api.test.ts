import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { createRepository } from "../server/db.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectId = `api-test-${randomUUID()}`;
const secondProjectId = `api-test-${randomUUID()}`;

let serverProcess: ChildProcess | undefined;
let testRoot = "";
let projectsRoot = "";
let projectDir = "";
let apiBase = "";
let ownerCapability = "";
let secondOwnerCapability = "";

type Json = Record<string, unknown>;

async function isApiAvailable() {
  try {
    const response = await fetch(`${apiBase}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForApi(timeoutMs = 8_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isApiAvailable()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`评论 API 未在 ${timeoutMs}ms 内启动：${apiBase}`);
}

async function request(pathname: string, init?: RequestInit) {
  const response = await fetch(`${apiBase}${pathname}`, init);
  const body = (await response.json()) as Json;
  return { response, body };
}

const validDraft = {
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
  body: "  Check this edge  ",
  authorName: "API test",
};

before(async () => {
  testRoot = await mkdtemp(path.join(tmpdir(), "blendproof-api-"));
  projectsRoot = path.join(testRoot, "projects");
  projectDir = path.join(projectsRoot, projectId);
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "model.glb"), "test model");
  await writeFile(
    path.join(projectDir, "manifest.json"),
    JSON.stringify({ scene: "API test scene", objects: [], collections: [] }),
  );
  const secondProjectDir = path.join(projectsRoot, secondProjectId);
  await mkdir(secondProjectDir, { recursive: true });
  await writeFile(path.join(secondProjectDir, "model.glb"), "second model");
  await writeFile(path.join(secondProjectDir, "manifest.json"), JSON.stringify({ scene: "Second", objects: [], collections: [] }));
  const dbPath = path.join(testRoot, "blendproof.sqlite");
  const repository = await createRepository({ path: dbPath });
  ownerCapability = repository.registerProject({ id: projectId, name: "API test scene" }).ownerCapability;
  secondOwnerCapability = repository.registerProject({ id: secondProjectId, name: "Second" }).ownerCapability;
  repository.close();

  const port = 18_000 + Math.floor(Math.random() * 10_000);
  apiBase = `http://127.0.0.1:${port}`;
  serverProcess = spawn(
    process.execPath,
    [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), "server/index.ts"],
    {
      cwd: repoRoot,
      stdio: "ignore",
      env: {
        ...process.env,
        PORT: String(port),
        BLENDPROOF_STORAGE_ROOT: projectsRoot,
        BLENDPROOF_INCOMING_ROOT: path.join(testRoot, "incoming"),
        BLENDPROOF_DB_PATH: dbPath,
      },
    },
  );
  await waitForApi();
});

after(async () => {
  if (serverProcess) {
    serverProcess.kill();
    await new Promise<void>((resolve) => {
      serverProcess?.once("exit", () => resolve());
      setTimeout(resolve, 1_000);
    });
  }
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
});

describe("阶段 2 评论 API", () => {
  test("owner capability 严格限定项目", async () => {
    const missing = await request(`/api/projects/${projectId}/comments`);
    assert.equal(missing.response.status, 401);
    const wrong = await request(`/api/projects/${projectId}/comments`, { headers: { "x-blendproof-owner": "wrong" } });
    assert.equal(wrong.response.status, 403);
    const crossProject = await request(`/api/projects/${secondProjectId}/comments`, { headers: { "x-blendproof-owner": ownerCapability } });
    assert.equal(crossProject.response.status, 403);
    const valid = await request(`/api/projects/${secondProjectId}/comments`, { headers: { "x-blendproof-owner": secondOwnerCapability } });
    assert.equal(valid.response.status, 200);
  });
  test("创建、读取并更新评论", async () => {
    const created = await request(`/api/projects/${projectId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify(validDraft),
    });

    assert.equal(created.response.status, 201);
    const comment = created.body.comment as Json;
    assert.equal(comment.projectId, projectId);
    assert.equal(comment.body, validDraft.body);
    assert.equal(comment.status, "open");
    assert.equal(typeof comment.id, "string");
    assert.equal(typeof comment.createdAt, "string");
    assert.equal(typeof comment.updatedAt, "string");

    const listed = await request(`/api/projects/${projectId}/comments`, { headers: { "x-blendproof-owner": ownerCapability } });
    assert.equal(listed.response.status, 200);
    assert.deepEqual(listed.body.comments, [comment]);

    const updated = await request(
      `/api/projects/${projectId}/comments/${encodeURIComponent(String(comment.id))}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
        body: JSON.stringify({ body: "  Edge fixed  ", status: "resolved" }),
      },
    );
    assert.equal(updated.response.status, 200);
    const updatedComment = updated.body.comment as Json;
    assert.equal(updatedComment.id, comment.id);
    assert.equal(updatedComment.body, "Edge fixed");
    assert.equal(updatedComment.status, "resolved");
    assert.notEqual(updatedComment.updatedAt, comment.updatedAt);

    const reread = await request(`/api/projects/${projectId}/comments`, { headers: { "x-blendproof-owner": ownerCapability } });
    assert.equal(reread.response.status, 200);
    assert.deepEqual(reread.body.comments, [updatedComment]);
  });

  test("拒绝非法锚点且不写入评论", async () => {
    const invalidDraft = { ...validDraft, position: [1, 2] };
    const result = await request(`/api/projects/${projectId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify(invalidDraft),
    });

    assert.equal(result.response.status, 400);
    assert.equal(typeof result.body.error, "string");
    const listed = await request(`/api/projects/${projectId}/comments`, { headers: { "x-blendproof-owner": ownerCapability } });
    assert.equal(listed.response.status, 200);
    assert.equal((listed.body.comments as unknown[]).length, 1);
  });

  test("拒绝非法路径和不存在项目", async () => {
    const illegalPath = await request("/api/projects/not.a.valid.project/comments", { headers: { "x-blendproof-owner": ownerCapability } });
    assert.equal(illegalPath.response.status, 404);

    const missingProject = await request("/api/projects/does-not-exist/comments", { headers: { "x-blendproof-owner": ownerCapability } });
    assert.equal(missingProject.response.status, 404);

    const missingCreate = await request("/api/projects/does-not-exist/comments", {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify(validDraft),
    });
    assert.equal(missingCreate.response.status, 404);
  });

  test("拒绝更新不存在的评论和非法状态", async () => {
    const missingComment = await request(
      `/api/projects/${projectId}/comments/${randomUUID()}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
        body: JSON.stringify({ body: "No such comment" }),
      },
    );
    assert.equal(missingComment.response.status, 404);

    const listed = await request(`/api/projects/${projectId}/comments`, { headers: { "x-blendproof-owner": ownerCapability } });
    const existingComment = (listed.body.comments as Json[])[0];
    const invalidStatus = await request(
      `/api/projects/${projectId}/comments/${encodeURIComponent(String(existingComment.id))}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
        body: JSON.stringify({ status: "closed" }),
      },
    );
    assert.equal(invalidStatus.response.status, 400);
  });

  test("分享只返回 token 资源并隐藏项目能力", async () => {
    const createdShare = await request(`/api/projects/${projectId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({}),
    });
    assert.equal(createdShare.response.status, 201);
    const token = String(createdShare.body.token);

    const shared = await request(`/api/shares/${token}`);
    assert.equal(shared.response.status, 200);
    assert.equal(shared.body.projectId, undefined);
    assert.equal(shared.body.modelUrl, `/api/shares/${token}/model.glb`);
    const sharedComment = (shared.body.comments as Json[])[0];
    assert.equal(sharedComment.projectId, undefined);

    const model = await fetch(`${apiBase}/api/shares/${token}/model.glb`);
    assert.equal(model.status, 200);
    const source = await fetch(`${apiBase}/files/${projectId}/source.blend`);
    assert.equal(source.status, 404);
    const shareRecord = await fetch(`${apiBase}/files/${projectId}/share.json`);
    assert.equal(shareRecord.status, 404);
  });

  test("密码、评论权限、过期和撤销由服务端强制执行", async () => {
    const created = await request(`/api/projects/${projectId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ password: "review-pass", commentsPermission: "comment", expiresAt: "2099-01-01T00:00:00.000Z" }),
    });
    assert.equal(created.response.status, 201);
    const token = String(created.body.token);
    const shareId = String(created.body.id);

    const locked = await request(`/api/shares/${token}`);
    assert.equal(locked.response.status, 401);
    assert.equal(locked.body.passwordRequired, true);

    const wrong = await fetch(`${apiBase}/api/shares/${token}/access`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "bad-pass" }),
    });
    assert.equal(wrong.status, 403);
    const access = await fetch(`${apiBase}/api/shares/${token}/access`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "review-pass" }),
    });
    assert.equal(access.status, 204);
    const cookie = access.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);

    const opened = await request(`/api/shares/${token}`, { headers: { cookie } });
    assert.equal(opened.response.status, 200);
    assert.equal(opened.body.projectId, undefined);
    assert.equal(opened.body.commentsPermission, "comment");
    const guest = await request(`/api/shares/${token}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...validDraft, authorName: "Guest" }),
    });
    assert.equal(guest.response.status, 201);
    assert.equal((guest.body.comment as Json).projectId, undefined);

    const revoked = await fetch(`${apiBase}/api/projects/${projectId}/shares/${shareId}`, {
      method: "DELETE", headers: { "x-blendproof-owner": ownerCapability },
    });
    assert.equal(revoked.status, 204);
    const afterRevoke = await request(`/api/shares/${token}`, { headers: { cookie } });
    assert.equal(afterRevoke.response.status, 404);

    const expired = await request(`/api/projects/${projectId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ expiresAt: "2000-01-01T00:00:00.000Z" }),
    });
    const expiredRead = await request(`/api/shares/${String(expired.body.token)}`);
    assert.equal(expiredRead.response.status, 410);
  });
});
