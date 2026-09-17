/**
 * 固定间隔轮询。
 *
 * `pause` 为 true 时跳过本轮——审稿场景下必须如此：轮询的 GET 可能比
 * 刚发出的写请求更早返回，若用它覆盖本地状态，刚发出的回复会被抹掉。
 *
 * 回调失败不抛出，由调用方决定如何呈现（轮询失败通常应静默）。
 */

import { useEffect, useRef } from "react";

export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
  pause = false,
) {
  // 用 ref 持有最新回调，避免回调每次重建都重置定时器。
  const latest = useRef({ callback, pause });
  latest.current = { callback, pause };

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (latest.current.pause) return;
      void latest.current.callback();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);
}
