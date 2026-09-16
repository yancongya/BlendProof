/**
 * 访客删除令牌的本地存储。
 *
 * 访客没有可验证身份，服务端据此也无法判断"这条是不是你发的"，因此创建时
 * 会一次性下发一个删除令牌，由浏览器本地保存（服务端只存摘要）。
 * 丢掉令牌就等于失去删除自己内容的能力——这是设计取舍，不是缺陷。
 *
 * 契约见 docs/REVIEW_CONTRACT.md。
 */

const STORAGE_KEY = "bp-review-tokens";

type TokenMap = Record<string, string>;

function readAll(): TokenMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as TokenMap;
  } catch {
    // 存储被禁用或内容损坏时按"没有令牌"处理，不影响审稿主流程。
    return {};
  }
}

function writeAll(tokens: TokenMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // 无痕模式等场景下写失败：本次会话内仍可用，刷新后失效。
  }
}

export function rememberDeleteToken(id: string, token: string): void {
  if (!id || !token) return;
  writeAll({ ...readAll(), [id]: token });
}

export function readDeleteToken(id: string): string | null {
  if (!id) return null;
  return readAll()[id] ?? null;
}

export function forgetDeleteToken(id: string): void {
  if (!id) return;
  const tokens = readAll();
  if (!(id in tokens)) return;
  delete tokens[id];
  writeAll(tokens);
}
