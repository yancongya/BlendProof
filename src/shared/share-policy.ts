/**
 * 分享有效期的统一策略。
 *
 * 产品约定：**永久有效只用于内置的猴头演示模型**（预览用途，不经由 createShare）。
 * 用户自己上传的模型一律按这里设定的有效期与上限，本地与云端行为必须一致。
 *
 * 云端实现见 `worker/shares.ts` 的 createShare；本机 bridge 见 `server/index.ts`。
 * 三处取值必须同步修改。
 */

/** 用户未指定有效期时的默认保留时长。 */
export const DEFAULT_SHARE_HOURS = 24;
/** 允许用户设置的最长保留时长。 */
export const MAX_SHARE_HOURS = 48;

export const DEFAULT_SHARE_TTL_MS = DEFAULT_SHARE_HOURS * 60 * 60_000;
export const MAX_SHARE_TTL_MS = MAX_SHARE_HOURS * 60 * 60_000;

/**
 * 解析并校验用户请求的有效期，返回规范化后的 ISO 字符串。
 *
 * 未提供时用默认值；越界（过去 / 超出上限）直接拒绝，
 * 而不是静默截断 —— 否则「本地测好、线上被拒」的分叉会重现。
 */
export function resolveShareExpiry(requested: string | null | undefined, nowMs = Date.now()): string {
  const requestedMs =
    requested === null || requested === undefined || requested === ""
      ? nowMs + DEFAULT_SHARE_TTL_MS
      : Date.parse(requested);
  if (!Number.isFinite(requestedMs) || requestedMs <= nowMs || requestedMs > nowMs + MAX_SHARE_TTL_MS) {
    throw new Error(`分享有效期必须在未来 ${MAX_SHARE_HOURS} 小时内；未设置时默认保留 ${DEFAULT_SHARE_HOURS} 小时。`);
  }
  return new Date(requestedMs).toISOString();
}
