/**
 * 分享页的访客批注状态与写操作。
 *
 * 抽成独立 hook 有两个原因：
 *   1. 分享页是行数超预算的存量文件（见 ARCHITECTURE_RULES §6），只能减不能增；
 *   2. 「访客能删什么」依赖本地删除令牌，属于审稿域规则，不该散在页面里。
 *
 * 离线演示降级见 demoFallback.ts。
 */

import { useCallback, useState } from "react";
import type { ProjectTransport } from "../../../api/blendProofClient";
import { readDeleteToken } from "../deleteTokens";
import { reviewRepository } from "../api/reviewRepository";
import { addComment, addReply, dropComment, dropReply } from "../reviewState";
import { localComment, localReply } from "../demoFallback";
import type { ReviewComment, ReviewCommentDraft } from "../types";

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

  const requireName = useCallback(() => {
    const name = authorName.trim() || (demoMode ? "访客" : "");
    if (!name) throw new Error("请先填写审核名称。");
    return name;
  }, [authorName, demoMode]);

  /** 演示模式下写失败就本地降级；真实分享照常抛出，由调用方显示原因。 */
  const run = useCallback(
    async <T,>(action: () => Promise<T>, fallback?: () => T): Promise<T> => {
      setBusy(true);
      setError(null);
      try {
        return await action();
      } catch (reason) {
        if (demoMode && fallback) return fallback();
        setError(reason instanceof Error ? reason.message : "操作失败。");
        throw reason;
      } finally {
        setBusy(false);
      }
    },
    [demoMode],
  );

  const requireToken = useCallback(() => {
    if (!token) throw new Error("缺少分享标识。");
    return token;
  }, [token]);

  const createComment = useCallback(
    async (draft: ReviewCommentDraft) => {
      const shareToken = requireToken();
      const name = requireName();
      const comment = await run(
        () => reviewRepository.createGuest(shareToken, { ...draft, authorName: name }, transport),
        () => localComment(shareToken, draft, name),
      );
      setComments((current) => addComment(current, comment));
      return comment;
    },
    [requireToken, requireName, run, transport],
  );

  const reply = useCallback(
    async (commentId: string, body: string) => {
      const shareToken = requireToken();
      const name = requireName();
      const created = await run(
        () => reviewRepository.replyGuest(shareToken, commentId, { body, authorName: name }, transport),
        () => localReply(commentId, body, name),
      );
      setComments((current) => addReply(current, commentId, created));
    },
    [requireToken, requireName, run, transport],
  );

  const removeComment = useCallback(
    async (commentId: string) => {
      const shareToken = requireToken();
      const deleteToken = readDeleteToken(commentId);
      if (!deleteToken) throw new Error("只能删除自己创建的批注。");
      await run(
        () => reviewRepository.removeGuest(shareToken, commentId, deleteToken, transport),
        () => undefined,
      );
      setComments((current) => dropComment(current, commentId));
    },
    [requireToken, run, transport],
  );

  const removeReply = useCallback(
    async (commentId: string, replyId: string) => {
      const shareToken = requireToken();
      const deleteToken = readDeleteToken(replyId);
      if (!deleteToken) throw new Error("只能删除自己创建的回复。");
      await run(
        () => reviewRepository.removeGuestReply(shareToken, commentId, replyId, deleteToken, transport),
        () => undefined,
      );
      setComments((current) => dropReply(current, commentId, replyId));
    },
    [requireToken, run, transport],
  );

  return {
    comments,
    busy,
    error,
    reset,
    canDelete,
    createComment,
    reply,
    removeComment,
    removeReply,
  };
}
