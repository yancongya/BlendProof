/**
 * 本机 bridge 的分享有效期策略。
 *
 * 产品约定：**永久有效只用于内置的猴头演示模型**（预览用途，不经 createShare）。
 * 用户上传的模型一律带有效期，默认 24 小时、上限 48 小时 ——
 * 与云端工作流保持一致，避免「本地测好、线上被拒」。
 *
 * 同一组取值在三处必须同步：`src/shared/share-policy.ts`（浏览器 / 前端）、
 * 本文件（本机 bridge）、`worker/shares.ts`（云端）。
 */

export const DEFAULT_SHARE_HOURS = 24
export const MAX_SHARE_HOURS = 48

const HOUR_MS = 60 * 60_000

/** 解析并校验请求里的有效期，返回规范化后的 ISO 字符串；越界直接抛错。 */
export function resolveShareExpiry(requested: unknown, nowMs = Date.now()): string {
  const requestedMs =
    requested === null || requested === undefined || requested === ''
      ? nowMs + DEFAULT_SHARE_HOURS * HOUR_MS
      : Date.parse(String(requested))
  if (!Number.isFinite(requestedMs) || requestedMs <= nowMs || requestedMs > nowMs + MAX_SHARE_HOURS * HOUR_MS) {
    throw new Error(`分享有效期必须在未来 ${MAX_SHARE_HOURS} 小时内；未设置时默认保留 ${DEFAULT_SHARE_HOURS} 小时。`)
  }
  return new Date(requestedMs).toISOString()
}
