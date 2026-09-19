/**
 * browser transport 的路径解析与入参守卫。
 *
 * 路径形状与 `server/index.ts`（`/api/local/...`）保持一致，
 * 只是去掉了 `/local` 前缀 —— 因为 browser transport 根本不出浏览器。
 * 这样 `blendProofClient` 那 15 个方法一行都不用改。
 */

export const BROWSER_COMMENT_LIMIT = { body: 5000, authorName: 120 } as const;

export function decodeSegment(value: string): string {
  return decodeURIComponent(value);
}

export function notFound(message: string): Error {
  return new Error(message);
}

export function commentNotFound(): Error {
  return new Error("找不到该批注。");
}

/** 创建者凭据走 header（与两端一致），不放 URL，避免进日志与历史。 */
export function readOwnerHeader(headers: Record<string, string>): string {
  return headers["x-blendproof-owner"] ?? "";
}

export function requirePermission(body: string): void {
  if (typeof body !== "string" || body.trim().length === 0) throw new Error("批注内容不能为空。");
  if (body.trim().length > BROWSER_COMMENT_LIMIT.body) throw new Error("批注内容过长。");
}

export type ProjectRoute =
  | { kind: "shares"; projectId: string }
  | { kind: "share"; projectId: string; shareId: string }
  | { kind: "comments"; projectId: string }
  | { kind: "comment"; projectId: string; commentId: string }
  | { kind: "replies"; projectId: string; commentId: string }
  | { kind: "reply"; projectId: string; commentId: string; replyId: string };

export type ShareRoute =
  | { kind: "share"; token: string }
  | { kind: "status"; token: string }
  | { kind: "access"; token: string }
  | { kind: "comments"; token: string }
  | { kind: "comment"; token: string; commentId: string }
  | { kind: "replies"; token: string; commentId: string }
  | { kind: "reply"; token: string; commentId: string; replyId: string };

export function matchProjectRoute(path: string): ProjectRoute | null {
  const parts = path.split("/").filter(Boolean).map(decodeSegment);
  if (parts.length < 4 || parts[0] !== "api" || parts[1] !== "projects") return null;
  const projectId = parts[2];
  if (parts[3] === "shares") {
    if (parts.length === 4) return { kind: "shares", projectId };
    if (parts.length === 5) return { kind: "share", projectId, shareId: parts[4] };
  }
  if (parts[3] === "comments") {
    if (parts.length === 4) return { kind: "comments", projectId };
    if (parts.length === 5) return { kind: "comment", projectId, commentId: parts[4] };
    if (parts.length === 6 && parts[5] === "replies") {
      return { kind: "replies", projectId, commentId: parts[4] };
    }
    if (parts.length === 7 && parts[5] === "replies") {
      return { kind: "reply", projectId, commentId: parts[4], replyId: parts[6] };
    }
  }
  return null;
}

export function matchShareRoute(path: string): ShareRoute | null {
  const parts = path.split("/").filter(Boolean).map(decodeSegment);
  if (parts.length < 3 || parts[0] !== "api" || parts[1] !== "shares") return null;
  const token = parts[2];
  if (parts.length === 3) return { kind: "share", token };
  if (parts.length === 4 && parts[3] === "status") return { kind: "status", token };
  if (parts.length === 4 && parts[3] === "access") return { kind: "access", token };
  if (parts[3] === "comments") {
    if (parts.length === 4) return { kind: "comments", token };
    if (parts.length === 5) return { kind: "comment", token, commentId: parts[4] };
    if (parts.length === 6 && parts[5] === "replies") return { kind: "replies", token, commentId: parts[4] };
    if (parts.length === 7 && parts[5] === "replies") {
      return { kind: "reply", token, commentId: parts[4], replyId: parts[6] };
    }
  }
  return null;
}
