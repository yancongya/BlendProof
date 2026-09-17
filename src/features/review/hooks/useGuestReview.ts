/**
 * 分享页的访客批注状态：列表、轮询、删除权限，并组合写操作。
 *
 * 抽成独立 hook 有两个原因：
 *   1. 分享页是行数超预算的存量文件（见 ARCHITECTURE_RULES §6），只能减不能增；
 *   2. 「访客能删什么」依赖本地删除令牌，属于审稿域规则，不该散在页面里。
 *
 * 写操作在 useGuestMutations，离线演示降级见 demoFallback.ts。
 */

import { useCallback, useState } from "react";
import type { ProjectTransport } from "../../../api/blendProofClient";
import { usePolling } from "../../../shared/hooks/usePolling";
import { readDeleteToken } from "../deleteTokens";
import { reviewRepository } from "../api/reviewRepository";
import { useGuestMutations } from "./useGuestMutations";
import { REVIEW_POLL_MS } from "./useReviewComments";
import type { ReviewComment } from "../types";

export function useGuestReview({
  token,
  transport,
  demoMode,
  authorName,
}: {
  token: string | null;
  transport: ProjectTransport;
  /** 演示分享在无后端时允许本地降级。 */
  demoMode: boolean;
  authorName: string;
}) {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 分享加载完成后用服务端结果替换本地副本。 */
  const reset = useCallback((next: ReviewComment[]) => {
    setComments(next);
    setError(null);
  }, []);

  /** 访客只能删除自己创建的内容，凭据是创建时存下的本地令牌。 */
  const canDelete = useCallback((id: string) => readDeleteToken(id) !== null, []);

  /**
   * 轮询让客户不必刷新就能看到创作者的处理与回复。
   * 失败静默——网络抖动不该打断正在看模型的人；写操作进行中跳过本轮，
   * 否则轮询结果可能早于写请求返回，把刚发出的回复抹掉。
   */
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setComments(await reviewRepository.listGuest(token, transport));
    } catch {
      /* 保持现有列表，等下一轮 */
    }
  }, [token, transport]);
  usePolling(refresh, REVIEW_POLL_MS, Boolean(token), busy);

  const mutations = useGuestMutations({
    token,
    transport,
    demoMode,
    authorName,
    setComments,
    setBusy,
    setError,
  });

  return { comments, busy, error, reset, canDelete, ...mutations };
}
