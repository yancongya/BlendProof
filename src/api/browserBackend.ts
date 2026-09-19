/**
 * browser transport 的后端实现 —— 全部落在本机 IndexedDB，不发任何网络请求。
 *
 * 为什么需要它：浏览器转换出来的项目（id 形如 `browser-*`）从未在本机 bridge
 * 注册，若仍标成 `transport: "local"`，后续对本机 bridge 的
 * `/api/local/projects/browser-xxx/...` 请求必然 404 —— 转换完就无法分享、批注、删除。
 *
 * 产品约定（老板确认）：未登录用户上传的 .blend 只存浏览器缓存、不上传，
 * 仅作测试预览；登录后才由 cloud transport 负责上传。
 *
 * 路径与响应体刻意与 `server/index.ts`、`worker/` 保持同形，
 * 使同一份前端代码在三种 transport 下行为一致。见 docs/REVIEW_CONTRACT.md。
 */

import {
  commentNotFound,
  matchProjectRoute,
  matchShareRoute,
  notFound,
  readOwnerHeader,
  requirePermission,
} from "./browserRoutes";
import {
  COMMENT_STORE,
  PROJECT_STORE,
  SHARE_STORE,
  deleteRecord,
  getRecord,
  listComments,
  materializeBlobUrl,
  putRecord,
  listSharesOf,
  type BrowserCommentRecord,
  type BrowserProjectRecord,
  type BrowserShareRecord,
} from "./browserStore";
import { resolveShareExpiry } from "../shared/share-policy";
import type {
  ReviewComment,
  ReviewCommentDraft,
  ReviewCommentPatch,
  ReviewReply,
  ReviewReplyDraft,
} from "../features/review";

export type BrowserRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
};

const UNLOCKED_KEY = "blendproof:unlocked-shares";
const DELETE_TOKEN_HEADER = "x-blendproof-delete-token";

const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID().replaceAll("-", "")}`;
const nowIso = (): string => new Date().toISOString();

/** 列表响应永不返回 deleteToken，否则任何拿到分享链接的人都能删他人批注。 */
function strip(record: BrowserCommentRecord): ReviewComment {
  const { deleteToken: _token, replyDeleteTokens: _replyTokens, ...comment } = record;
  return comment;
}

function unlockedTokens(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(UNLOCKED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function markUnlocked(token: string): void {
  const tokens = unlockedTokens();
  tokens.add(token);
  sessionStorage.setItem(UNLOCKED_KEY, JSON.stringify([...tokens]));
}

// ---------------------------------------------------------------------------
// 权限与查找
// ---------------------------------------------------------------------------

async function requireOwner(projectId: string, headers: Record<string, string>): Promise<BrowserProjectRecord> {
  const project = await getRecord<BrowserProjectRecord>(PROJECT_STORE, projectId);
  if (!project || readOwnerHeader(headers) !== project.ownerCapability) {
    throw notFound("找不到该本地项目，请重新导入。");
  }
  return project;
}

/** 取出未撤销、未过期的分享；不检查口令是否已解锁。 */
async function findShare(token: string): Promise<BrowserShareRecord> {
  const share = await getRecord<BrowserShareRecord>(SHARE_STORE, token);
  if (!share || share.revokedAt) throw notFound("分享链接不存在或已被撤销。");
  if (share.expiresAt && Date.parse(share.expiresAt) <= Date.now()) throw notFound("分享链接已过期。");
  return share;
}

/** 需要已通过口令的分享。shareStatus / unlockShare 不能用它 —— 那会让口令页永远出不来。 */
async function requireShare(token: string): Promise<BrowserShareRecord> {
  const share = await findShare(token);
  if (share.password && !unlockedTokens().has(token)) throw notFound("请先输入分享口令。");
  return share;
}

function requireGuestCanWrite(share: BrowserShareRecord): void {
  if (share.commentsPermission !== "comment") throw notFound("该分享为只读，无法添加批注。");
}

async function requireComment(projectId: string, commentId: string): Promise<BrowserCommentRecord> {
  const record = await getRecord<BrowserCommentRecord>(COMMENT_STORE, commentId);
  if (!record || record.projectId !== projectId) throw commentNotFound();
  return record;
}

const save = (record: BrowserCommentRecord): Promise<unknown> => putRecord(COMMENT_STORE, record);
const listGuestVisible = async (projectId: string): Promise<ReviewComment[]> =>
  (await listComments(projectId)).map(strip);

// ---------------------------------------------------------------------------
// 创建者通道
// ---------------------------------------------------------------------------

async function createShare(projectId: string, headers: Record<string, string>, body: string | null) {
  const project = await requireOwner(projectId, headers);
  const input = JSON.parse(body ?? "{}") as {
    password?: string | null;
    expiresAt?: string | null;
    commentsPermission?: "read_only" | "comment";
  };
  const password = typeof input.password === "string" && input.password.length > 0 ? input.password : null;
  if (password !== null && (password.length < 4 || password.length > 200)) {
    throw new Error("分享密码需要 4 到 200 个字符。");
  }
  const token = crypto.randomUUID().replaceAll("-", "");
  const record: BrowserShareRecord = {
    token,
    id: newId("share"),
    projectId: project.id,
    password,
    // 用户自己的模型一律带有效期；永久有效只留给内置猴头演示（不经此路径）。
    expiresAt: resolveShareExpiry(input.expiresAt),
    commentsPermission: input.commentsPermission === "comment" ? "comment" : "read_only",
    createdAt: nowIso(),
    revokedAt: null,
  };
  await putRecord(SHARE_STORE, record);
  return {
    id: record.id,
    shareUrl: `${window.location.origin}/s/${token}?source=browser`,
    expiresAt: record.expiresAt,
    commentsPermission: record.commentsPermission,
  };
}

async function revokeShare(projectId: string, shareId: string, headers: Record<string, string>) {
  await requireOwner(projectId, headers);
  const share = (await listSharesOf(projectId)).find((item) => item.id === shareId);
  if (!share) throw notFound("找不到该分享。");
  await putRecord(SHARE_STORE, { ...share, revokedAt: nowIso() });
}

async function createOwnerComment(projectId: string, headers: Record<string, string>, body: string | null) {
  await requireOwner(projectId, headers);
  const draft = JSON.parse(body ?? "{}") as ReviewCommentDraft;
  requirePermission(draft.body);
  const stamp = nowIso();
  const record: BrowserCommentRecord = {
    ...draft,
    id: newId("comment"),
    projectId,
    authorType: "owner",
    status: "open",
    createdAt: stamp,
    updatedAt: stamp,
    replies: [],
    deleteToken: null,
    replyDeleteTokens: {},
  };
  await save(record);
  return { comment: strip(record) };
}

async function updateOwnerComment(
  projectId: string,
  headers: Record<string, string>,
  commentId: string,
  body: string | null,
) {
  await requireOwner(projectId, headers);
  const record = await requireComment(projectId, commentId);
  const patch = JSON.parse(body ?? "{}") as ReviewCommentPatch;
  if (patch.body !== undefined) requirePermission(patch.body);
  const next: BrowserCommentRecord = {
    ...record,
    body: patch.body ?? record.body,
    status: patch.status ?? record.status,
    updatedAt: nowIso(),
  };
  await save(next);
  return { comment: strip(next) };
}

async function deleteOwnerComment(projectId: string, headers: Record<string, string>, commentId: string) {
  await requireOwner(projectId, headers);
  await requireComment(projectId, commentId);
  await deleteRecord(COMMENT_STORE, commentId);
}

/** 追加一条回复并返回它，以及（仅访客）本次生成的删除令牌。 */
async function appendReply(
  projectId: string,
  commentId: string,
  body: string | null,
  authorType: "owner" | "guest",
): Promise<{ reply: ReviewReply; deleteToken: string | null }> {
  const record = await requireComment(projectId, commentId);
  const draft = JSON.parse(body ?? "{}") as ReviewReplyDraft;
  requirePermission(draft.body);
  const reply: ReviewReply = {
    id: newId("reply"),
    commentId,
    body: draft.body,
    authorName: draft.authorName,
    authorType,
    createdAt: nowIso(),
  };
  const deleteToken = authorType === "guest" ? newId("dt") : null;
  const replyDeleteTokens = { ...record.replyDeleteTokens };
  if (deleteToken) replyDeleteTokens[reply.id] = deleteToken;
  await save({ ...record, replies: [...record.replies, reply], replyDeleteTokens, updatedAt: nowIso() });
  return { reply, deleteToken };
}

async function deleteReply(
  commentId: string,
  replyId: string,
  guard: { kind: "owner"; projectId: string; headers: Record<string, string> } | { kind: "guest"; deleteToken: string },
) {
  const record = await getRecord<BrowserCommentRecord>(COMMENT_STORE, commentId);
  if (!record) throw commentNotFound();
  if (guard.kind === "owner") {
    await requireOwner(guard.projectId, guard.headers);
  } else if (record.replyDeleteTokens[replyId] !== guard.deleteToken) {
    throw notFound("没有权限删除该回复。");
  }
  const replyDeleteTokens = { ...record.replyDeleteTokens };
  delete replyDeleteTokens[replyId];
  await save({
    ...record,
    replies: record.replies.filter((reply) => reply.id !== replyId),
    replyDeleteTokens,
    updatedAt: nowIso(),
  });
}

// ---------------------------------------------------------------------------
// 访客通道
// ---------------------------------------------------------------------------

async function loadShare(token: string) {
  const share = await requireShare(token);
  const project = await getRecord<BrowserProjectRecord>(PROJECT_STORE, share.projectId);
  if (!project) throw notFound("该分享对应的项目已被删除。");
  return {
    name: project.name.replace(/\.blend$/i, ""),
    modelUrl: materializeBlobUrl(project.model, "model/gltf-binary"),
    manifest: project.manifest,
    comments: await listGuestVisible(share.projectId),
    commentsPermission: share.commentsPermission,
    expiresAt: share.expiresAt,
  };
}

async function unlockShare(token: string, body: string | null) {
  const share = await findShare(token);
  const input = JSON.parse(body ?? "{}") as { password?: string };
  if (share.password && input.password !== share.password) throw notFound("口令不正确。");
  markUnlocked(token);
}

async function createGuestComment(token: string, body: string | null) {
  const share = await requireShare(token);
  requireGuestCanWrite(share);
  const draft = JSON.parse(body ?? "{}") as ReviewCommentDraft;
  requirePermission(draft.body);
  const stamp = nowIso();
  const record: BrowserCommentRecord = {
    ...draft,
    id: newId("comment"),
    projectId: share.projectId,
    authorType: "guest",
    status: "open",
    createdAt: stamp,
    updatedAt: stamp,
    replies: [],
    deleteToken: newId("dt"),
    replyDeleteTokens: {},
  };
  await save(record);
  // deleteToken 只在此返回一次，由调用方存入 localStorage。
  return { comment: strip(record), deleteToken: record.deleteToken };
}

async function deleteGuestComment(token: string, commentId: string, headers: Record<string, string>) {
  const share = await requireShare(token);
  const record = await requireComment(share.projectId, commentId);
  if (!record.deleteToken || record.deleteToken !== (headers[DELETE_TOKEN_HEADER] ?? "")) {
    throw notFound("没有权限删除该批注。");
  }
  await deleteRecord(COMMENT_STORE, commentId);
}

// ---------------------------------------------------------------------------
// 路由分发
// ---------------------------------------------------------------------------

async function routeProject(request: BrowserRequest): Promise<unknown> {
  const { method, path, headers, body } = request;
  const match = matchProjectRoute(path);
  if (!match) throw notFound("不支持的本机操作。");
  switch (match.kind) {
    case "shares":
      if (method === "POST") return createShare(match.projectId, headers, body);
      break;
    case "share":
      if (method === "DELETE") return revokeShare(match.projectId, match.shareId, headers);
      break;
    case "comments":
      if (method === "GET") {
        await requireOwner(match.projectId, headers);
        return { comments: await listGuestVisible(match.projectId) };
      }
      if (method === "POST") return createOwnerComment(match.projectId, headers, body);
      break;
    case "comment":
      if (method === "PATCH") return updateOwnerComment(match.projectId, headers, match.commentId, body);
      if (method === "DELETE") return deleteOwnerComment(match.projectId, headers, match.commentId);
      break;
    case "replies":
      if (method === "POST") {
        await requireOwner(match.projectId, headers);
        const { reply } = await appendReply(match.projectId, match.commentId, body, "owner");
        return { reply };
      }
      break;
    case "reply":
      if (method === "DELETE") {
        return deleteReply(match.commentId, match.replyId, {
          kind: "owner",
          projectId: match.projectId,
          headers,
        });
      }
      break;
  }
  throw notFound("不支持的本机操作。");
}

async function routeShare(request: BrowserRequest): Promise<unknown> {
  const { method, path, headers, body } = request;
  const match = matchShareRoute(path);
  if (!match) throw notFound("不支持的本机操作。");
  switch (match.kind) {
    case "share":
      if (method === "GET") return loadShare(match.token);
      break;
    case "status":
      if (method === "GET") {
        const share = await findShare(match.token);
        return { passwordRequired: Boolean(share.password) };
      }
      break;
    case "access":
      if (method === "POST") return unlockShare(match.token, body);
      break;
    case "comments":
      if (method === "GET") {
        const share = await requireShare(match.token);
        return { comments: await listGuestVisible(share.projectId) };
      }
      if (method === "POST") return createGuestComment(match.token, body);
      break;
    case "comment":
      if (method === "DELETE") return deleteGuestComment(match.token, match.commentId, headers);
      break;
    case "replies":
      if (method === "POST") {
        const share = await requireShare(match.token);
        requireGuestCanWrite(share);
        return appendReply(share.projectId, match.commentId, body, "guest");
      }
      break;
    case "reply":
      if (method === "DELETE") {
        const share = await requireShare(match.token);
        return deleteReply(match.commentId, match.replyId, {
          kind: "guest",
          deleteToken: headers[DELETE_TOKEN_HEADER] ?? "",
        });
      }
      break;
  }
  throw notFound("不支持的本机操作。");
}

/**
 * 处理一次 browser transport 请求，返回与 bridge / worker 同形的响应体。
 * 失败抛 Error（消息与两端一致），由 blendProofClient 统一转成用户可见文案。
 */
export function browserBackendRequest(request: BrowserRequest): Promise<unknown> {
  if (request.path.startsWith("/api/projects/")) return routeProject(request);
  if (request.path.startsWith("/api/shares/")) return routeShare(request);
  return Promise.reject(notFound("不支持的本机操作。"));
}

/** 判断某个分享 token 是否属于本机浏览器存储（供分享页选择 transport）。 */
export async function hasBrowserShare(token: string): Promise<boolean> {
  return Boolean(await getRecord<BrowserShareRecord>(SHARE_STORE, token));
}
