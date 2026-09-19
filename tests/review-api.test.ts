import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { createRepository } from "../server/db.js";
import { BRIDGE_NONCE_HEADER } from "../server/local-pairing.js";
import { normalizeUploadFilename } from "../server/upload-filename.js";

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
let bridgeNonce = "";
const bridgeOrigin = "http://localhost:5173";
const pairingCode = "review-api-one-shot-code";

type Json = Record<string, unknown>;

test("multipart UTF-8 文件名恢复且不破坏已解码名称", () => {
  const mojibake = Buffer.from("猴头.blend", "utf8").toString("latin1");
  assert.equal(normalizeUploadFilename(mojibake), "猴头.blend");
  assert.equal(normalizeUploadFilename("猴头.blend"), "猴头.blend");
  assert.equal(normalizeUploadFilename("review-scene.blend"), "review-scene.blend");
  assert.equal(normalizeUploadFilename("café.blend"), "café.blend");
});

async function isApiAvailable() {
  try {
    const response = await fetch(`${apiBase}/api/local/health`, { headers: { Origin: bridgeOrigin } });
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
  const headers = new Headers(init?.headers);
  headers.set("Origin", bridgeOrigin);
  if (bridgeNonce) headers.set(BRIDGE_NONCE_HEADER, bridgeNonce);
  const response = await fetch(`${apiBase}${pathname}`, { ...init, headers });
  const body = (await response.json()) as Json;
  return { response, body };
}

async function bridgeFetch(pathname: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Origin", bridgeOrigin);
  if (bridgeNonce) headers.set(BRIDGE_NONCE_HEADER, bridgeNonce);
  return fetch(`${apiBase}${pathname}`, { ...init, headers });
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
        BLENDPROOF_PAIRING_CODE: pairingCode,
      },
    },
  );
  await waitForApi();
  const pairing = await fetch(`${apiBase}/api/local/pair`, {
    method: "POST",
    headers: { Origin: bridgeOrigin, "content-type": "application/json" },
    body: JSON.stringify({ pairingCode }),
  });
  assert.equal(pairing.status, 201);
  bridgeNonce = String((await pairing.json() as Json).nonce);
  assert.match(bridgeNonce, /^[A-Za-z0-9_-]{43}$/);
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
  test("本机 bridge 使用精确 Origin 与短期配对 nonce", async () => {
    const missingOrigin = await fetch(`${apiBase}/api/local/projects/${projectId}/assets/model.glb`, {
      headers: { [BRIDGE_NONCE_HEADER]: bridgeNonce },
    });
    assert.equal(missingOrigin.status, 401);

    const wrongOrigin = await fetch(`${apiBase}/api/local/projects/${projectId}/assets/model.glb`, {
      headers: { Origin: "http://localhost:5174", [BRIDGE_NONCE_HEADER]: bridgeNonce },
    });
    assert.equal(wrongOrigin.status, 403);

    const missingNonce = await fetch(`${apiBase}/api/local/projects/${projectId}/assets/model.glb`, {
      headers: { Origin: bridgeOrigin },
    });
    assert.equal(missingNonce.status, 401);

    const wrongNonce = await fetch(`${apiBase}/api/local/projects/${projectId}/assets/model.glb`, {
      headers: { Origin: bridgeOrigin, [BRIDGE_NONCE_HEADER]: "b".repeat(43) },
    });
    assert.equal(wrongNonce.status, 401);

    const secondSession = await fetch(`${apiBase}/api/local/pair`, {
      method: "POST",
      headers: { Origin: bridgeOrigin, "content-type": "application/json" },
      body: JSON.stringify({ pairingCode }),
    });
    assert.equal(secondSession.status, 201);
    const secondBody = await secondSession.json() as { nonce: string };
    assert.notEqual(secondBody.nonce, bridgeNonce);
  });

  test("本机 bridge 仅在 /api/local 下暴露转换与派生资产", async () => {
    const legacyConvert = await fetch(`${apiBase}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/x-blender" },
      body: "not-a-real-blend",
    });
    assert.equal(legacyConvert.status, 404);

    const missingBlend = await bridgeFetch(`/api/local/convert`, {
      method: "POST",
      body: new FormData(),
    });
    assert.equal(missingBlend.status, 400);
    assert.equal(typeof (await missingBlend.json() as Json).error, "string");

    const asset = await bridgeFetch(`/api/local/projects/${projectId}/assets/model.glb`);
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), "test model");
    assert.equal((await fetch(`${apiBase}/files/${projectId}/model.glb`)).status, 404);
  });

  test("owner capability 严格限定项目", async () => {
    const missing = await request(`/api/local/projects/${projectId}/comments`);
    assert.equal(missing.response.status, 401);
    const wrong = await request(`/api/local/projects/${projectId}/comments`, { headers: { "x-blendproof-owner": "wrong" } });
    assert.equal(wrong.response.status, 403);
    const crossProject = await request(`/api/local/projects/${secondProjectId}/comments`, { headers: { "x-blendproof-owner": ownerCapability } });
    assert.equal(crossProject.response.status, 403);
    const valid = await request(`/api/local/projects/${secondProjectId}/comments`, { headers: { "x-blendproof-owner": secondOwnerCapability } });
    assert.equal(valid.response.status, 200);
  });
  test("创建、读取并更新评论", async () => {
    const created = await request(`/api/local/projects/${projectId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify(validDraft),
    });

    assert.equal(created.response.status, 201);
    const comment = created.body.comment as Json;
    assert.equal(comment.projectId, projectId);
    // 两条通道（SQLite 与 D1）必须同样在写入时去除首尾空白。
    assert.equal(comment.body, validDraft.body.trim());
    assert.equal(comment.status, "open");
    assert.equal(typeof comment.id, "string");
    assert.equal(typeof comment.createdAt, "string");
    assert.equal(typeof comment.updatedAt, "string");

    const listed = await request(`/api/local/projects/${projectId}/comments`, { headers: { "x-blendproof-owner": ownerCapability } });
    assert.equal(listed.response.status, 200);
    assert.deepEqual(listed.body.comments, [comment]);

    const updated = await request(
      `/api/local/projects/${projectId}/comments/${encodeURIComponent(String(comment.id))}`,
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

    const reread = await request(`/api/local/projects/${projectId}/comments`, { headers: { "x-blendproof-owner": ownerCapability } });
    assert.equal(reread.response.status, 200);
    assert.deepEqual(reread.body.comments, [updatedComment]);
  });

  test("拒绝非法锚点且不写入评论", async () => {
    const invalidDraft = { ...validDraft, position: [1, 2] };
    const result = await request(`/api/local/projects/${projectId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify(invalidDraft),
    });

    assert.equal(result.response.status, 400);
    assert.equal(typeof result.body.error, "string");
    const listed = await request(`/api/local/projects/${projectId}/comments`, { headers: { "x-blendproof-owner": ownerCapability } });
    assert.equal(listed.response.status, 200);
    assert.equal((listed.body.comments as unknown[]).length, 1);
  });

  test("拒绝非法路径和不存在项目", async () => {
    const illegalPath = await request("/api/local/projects/not.a.valid.project/comments", { headers: { "x-blendproof-owner": ownerCapability } });
    assert.equal(illegalPath.response.status, 404);

    const missingProject = await request("/api/local/projects/does-not-exist/comments", { headers: { "x-blendproof-owner": ownerCapability } });
    assert.equal(missingProject.response.status, 404);

    const missingCreate = await request("/api/local/projects/does-not-exist/comments", {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify(validDraft),
    });
    assert.equal(missingCreate.response.status, 404);
  });

  test("拒绝更新不存在的评论和非法状态", async () => {
    const missingComment = await request(
      `/api/local/projects/${projectId}/comments/${randomUUID()}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
        body: JSON.stringify({ body: "No such comment" }),
      },
    );
    assert.equal(missingComment.response.status, 404);

    const listed = await request(`/api/local/projects/${projectId}/comments`, { headers: { "x-blendproof-owner": ownerCapability } });
    const existingComment = (listed.body.comments as Json[])[0];
    const invalidStatus = await request(
      `/api/local/projects/${projectId}/comments/${encodeURIComponent(String(existingComment.id))}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
        body: JSON.stringify({ status: "closed" }),
      },
    );
    assert.equal(invalidStatus.response.status, 400);
  });

  test("分享只返回 token 资源并隐藏项目能力", async () => {
    const createdShare = await request(`/api/local/projects/${projectId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({}),
    });
    assert.equal(createdShare.response.status, 201);
    const token = String(createdShare.body.token);

    const shared = await request(`/api/local/shares/${token}`);
    assert.equal(shared.response.status, 200);
    assert.equal(shared.body.projectId, undefined);
    assert.equal(shared.body.modelUrl, `/api/local/shares/${token}/model.glb`);
    const sharedComment = (shared.body.comments as Json[])[0];
    assert.equal(sharedComment.projectId, undefined);

    const model = await bridgeFetch(`/api/local/shares/${token}/model.glb`);
    assert.equal(model.status, 200);
    const source = await fetch(`${apiBase}/files/${projectId}/source.blend`);
    assert.equal(source.status, 404);
    const shareRecord = await fetch(`${apiBase}/files/${projectId}/share.json`);
    assert.equal(shareRecord.status, 404);
  });

  test("密码、评论权限、有效期和撤销由服务端强制执行", async () => {
    // 用户上传的模型一律带有效期（永久有效只留给内置猴头演示）。
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const created = await request(`/api/local/projects/${projectId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ password: "review-pass", commentsPermission: "comment", expiresAt }),
    });
    assert.equal(created.response.status, 201);
    const token = String(created.body.token);
    const shareId = String(created.body.id);

    const locked = await request(`/api/local/shares/${token}`);
    assert.equal(locked.response.status, 401);
    assert.equal(locked.body.passwordRequired, true);

    const wrong = await bridgeFetch(`/api/local/shares/${token}/access`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "bad-pass" }),
    });
    assert.equal(wrong.status, 403);
    const access = await bridgeFetch(`/api/local/shares/${token}/access`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "review-pass" }),
    });
    assert.equal(access.status, 204);
    assert.match(access.headers.get("set-cookie") ?? "", new RegExp(`Path=/api/local/shares/${token}`));
    const cookie = access.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);

    const opened = await request(`/api/local/shares/${token}`, { headers: { cookie } });
    assert.equal(opened.response.status, 200);
    assert.equal(opened.body.projectId, undefined);
    assert.equal(opened.body.commentsPermission, "comment");
    assert.equal(opened.body.expiresAt, expiresAt);
    const guest = await request(`/api/local/shares/${token}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...validDraft, authorName: "Guest" }),
    });
    assert.equal(guest.response.status, 201);
    assert.equal((guest.body.comment as Json).projectId, undefined);

    const revoked = await bridgeFetch(`/api/local/projects/${projectId}/shares/${shareId}`, {
      method: "DELETE", headers: { "x-blendproof-owner": ownerCapability },
    });
    assert.equal(revoked.status, 204);
    const afterRevoke = await request(`/api/local/shares/${token}`, { headers: { cookie } });
    assert.equal(afterRevoke.response.status, 404);

    // 有效期越界一律在创建时拒绝，而不是静默截断 ——
    // 与云端 worker/shares.ts 同一套规则，避免「本地测好、线上被拒」。
    const createWith = (expiresAt: unknown) => request(`/api/local/projects/${projectId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ expiresAt }),
    });
    assert.equal((await createWith("2000-01-01T00:00:00.000Z")).response.status, 400);
    assert.equal((await createWith("2099-01-01T00:00:00.000Z")).response.status, 400);
    assert.equal((await createWith("not-a-date")).response.status, 400);

    // 未设置时按默认 24 小时，而不是永久有效。
    const defaulted = await createWith(undefined);
    assert.equal(defaulted.response.status, 201);
    const defaultHours = (Date.parse(String(defaulted.body.expiresAt)) - Date.now()) / 3_600_000;
    assert.ok(defaultHours > 23.9 && defaultHours <= 24, `默认有效期应为 24 小时，实际 ${defaultHours}`);
  });

  test("创建者可以回复、删除回复与评论，删除评论会连带清理回复", async () => {
    const created = await request(`/api/local/projects/${projectId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ ...validDraft, body: "回复测试" }),
    });
    assert.equal(created.response.status, 201);
    const comment = created.body.comment as Json;
    assert.equal(comment.authorType, "owner");
    assert.deepEqual(comment.replies, []);
    const commentPath = `/api/local/projects/${projectId}/comments/${encodeURIComponent(String(comment.id))}`;

    const invalid = await request(`${commentPath}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ body: "   ", authorName: "Tester" }),
    });
    assert.equal(invalid.response.status, 400);

    const reply = await request(`${commentPath}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ body: "  已确认，会在下版修正  ", authorName: "创作者" }),
    });
    assert.equal(reply.response.status, 201);
    const firstReply = reply.body.reply as Json;
    assert.equal(firstReply.body, "已确认，会在下版修正");
    assert.equal(firstReply.commentId, comment.id);
    assert.equal(firstReply.authorType, "owner");
    // 创建者走 capability 鉴权，因此不发放删除令牌。
    assert.equal(reply.body.deleteToken, undefined);

    const listed = await request(`/api/local/projects/${projectId}/comments`, {
      headers: { "x-blendproof-owner": ownerCapability },
    });
    const withReply = (listed.body.comments as Json[]).find((item) => item.id === comment.id);
    assert.deepEqual((withReply?.replies as Json[]).map((item) => item.body), ["已确认，会在下版修正"]);

    const missing = await request(`/api/local/projects/${projectId}/comments/missing-comment/replies`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ body: "x", authorName: "y" }),
    });
    assert.equal(missing.response.status, 404);

    // 删除单条回复不得影响兄弟回复与所属评论。
    await request(`${commentPath}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ body: "保留这条", authorName: "创作者" }),
    });
    const removed = await bridgeFetch(`${commentPath}/replies/${encodeURIComponent(String(firstReply.id))}`, {
      method: "DELETE",
      headers: { "x-blendproof-owner": ownerCapability },
    });
    assert.equal(removed.status, 204);
    const afterReplyDelete = await request(`/api/local/projects/${projectId}/comments`, {
      headers: { "x-blendproof-owner": ownerCapability },
    });
    const survivor = (afterReplyDelete.body.comments as Json[]).find((item) => item.id === comment.id);
    assert.deepEqual((survivor?.replies as Json[]).map((item) => item.body), ["保留这条"]);

    // 删除评论必须连带清理其回复。
    const deleted = await bridgeFetch(commentPath, {
      method: "DELETE",
      headers: { "x-blendproof-owner": ownerCapability },
    });
    assert.equal(deleted.status, 204);
    // 幂等：重复删除同样返回 204。
    const deletedAgain = await bridgeFetch(commentPath, {
      method: "DELETE",
      headers: { "x-blendproof-owner": ownerCapability },
    });
    assert.equal(deletedAgain.status, 204);
    const afterCommentDelete = await request(`/api/local/projects/${projectId}/comments`, {
      headers: { "x-blendproof-owner": ownerCapability },
    });
    assert.equal((afterCommentDelete.body.comments as Json[]).some((item) => item.id === comment.id), false);
  });

  test("访客只能删除自己创建的内容，且必须出示删除令牌", async () => {
    // 令牌走请求头，是线上契约的一部分，因此这里直接用字面量而非从服务端导入。
    const deleteTokenHeader = "x-blendproof-delete-token";
    const share = await request(`/api/local/projects/${projectId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ commentsPermission: "comment" }),
    });
    assert.equal(share.response.status, 201);
    const token = String(share.body.token);

    const comment = (await request(`/api/local/projects/${projectId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ ...validDraft, body: "访客删除测试" }),
    })).body.comment as Json;
    const commentId = String(comment.id);

    const guestReply = await request(`/api/local/shares/${token}/comments/${commentId}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "客户回复", authorName: "客户" }),
    });
    assert.equal(guestReply.response.status, 201);
    const replyId = String((guestReply.body.reply as Json).id);
    const deleteToken = String(guestReply.body.deleteToken);
    assert.match(deleteToken, /^[a-f0-9]{64}$/);
    assert.equal((guestReply.body.reply as Json).projectId, undefined);

    // 列表响应绝不包含令牌，否则任何拿到链接的人都能删除他人内容。
    const opened = await request(`/api/local/shares/${token}`);
    assert.equal(opened.response.status, 200);
    assert.equal(JSON.stringify(opened.body).includes(deleteToken), false);

    const replyPath = `/api/local/shares/${token}/comments/${commentId}/replies/${replyId}`;
    assert.equal((await bridgeFetch(replyPath, { method: "DELETE" })).status, 403);
    assert.equal((await bridgeFetch(replyPath, {
      method: "DELETE",
      headers: { [deleteTokenHeader]: "0".repeat(64) },
    })).status, 403);
    assert.equal((await bridgeFetch(replyPath, {
      method: "DELETE",
      headers: { [deleteTokenHeader]: deleteToken },
    })).status, 204);

    // 访客创建的评论同理：没令牌删不掉，有令牌可删。
    const guestComment = await request(`/api/local/shares/${token}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validDraft, body: "访客自己的评论", authorName: "客户" }),
    });
    assert.equal(guestComment.response.status, 201);
    const guestCommentId = String((guestComment.body.comment as Json).id);
    const guestCommentToken = String(guestComment.body.deleteToken);
    const guestCommentPath = `/api/local/shares/${token}/comments/${guestCommentId}`;

    // 创建者用 owner capability 无法走访客通道删除他人内容（缺令牌一律 403）。
    assert.equal((await bridgeFetch(guestCommentPath, { method: "DELETE" })).status, 403);
    assert.equal((await bridgeFetch(guestCommentPath, {
      method: "DELETE",
      headers: { [deleteTokenHeader]: guestCommentToken },
    })).status, 204);
  });

  test("访客轮询接口只返回批注，不含 manifest", async () => {
    const share = await request(`/api/local/projects/${projectId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ commentsPermission: "comment" }),
    });
    assert.equal(share.response.status, 201);
    const token = String(share.body.token);

    const comment = (await request(`/api/local/projects/${projectId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ ...validDraft, body: "轮询可见性" }),
    })).body.comment as Json;

    const polled = await request(`/api/local/shares/${token}/comments`);
    assert.equal(polled.response.status, 200);
    // 轮询路径刻意不带 manifest：否则每 15 秒都会重传一次模型信息。
    assert.equal(polled.body.manifest, undefined);
    assert.equal(polled.body.modelUrl, undefined);
    const listed = polled.body.comments as Json[];
    assert.ok(listed.some((item) => item.id === comment.id));
    // 与分享主接口一致：不泄漏 projectId。
    assert.equal(listed[0].projectId, undefined);

    // 只读分享同样可轮询（读取不受评论权限限制）。
    const readOnly = await request(`/api/local/projects/${projectId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blendproof-owner": ownerCapability },
      body: JSON.stringify({ commentsPermission: "read_only" }),
    });
    const readOnlyPoll = await request(`/api/local/shares/${String(readOnly.body.token)}/comments`);
    assert.equal(readOnlyPoll.response.status, 200);
  });

  test("删除本地项目必须持有 owner capability，并同时移除派生文件", async () => {
    const denied = await bridgeFetch(`/api/local/projects/${secondProjectId}`, {
      method: "DELETE",
      headers: { "x-blendproof-owner": ownerCapability },
    });
    assert.equal(denied.status, 403);

    const deleted = await bridgeFetch(`/api/local/projects/${secondProjectId}`, {
      method: "DELETE",
      headers: { "x-blendproof-owner": secondOwnerCapability },
    });
    assert.equal(deleted.status, 204);
    assert.equal((await bridgeFetch(`/api/local/projects/${secondProjectId}/assets/model.glb`)).status, 404);
  });
});
