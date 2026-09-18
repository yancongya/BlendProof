/**
 * 演示态（没有真实项目）的批注状态。
 *
 * 与 `useReviewComments` 保持同一形状，页面里可以按「有无项目」二选一，
 * 调用方无需分支。
 *
 * 刻意**不发任何请求**：演示态没有 projectId / ownerCapability，请求必然失败；
 * 而「先请求再降级」会让本地与远程的表现依赖网络状况。纯本地实现让
 * 「本地测到什么、远程就是什么」成为结构上的保证，而不是靠降级兜底。
 */

import { useCallback, useRef, useState } from "react";
import { addComment, addReply, dropComment, dropReply, replaceComment } from "../reviewState";
import { DEMO_SHARE_TOKEN, cloneDemoComments } from "../demoComments";
import type {
  ReviewComment,
  ReviewCommentDraft,
  ReviewCommentPatch,
  ReviewReply,
  ReviewReplyDraft,
} from "../types";

export function useDemoReview() {
  const [comments, setComments] = useState<ReviewComment[]>(cloneDemoComments);
  const [error] = useState<string | null>(null);
  const [newCount, setNewCount] = useState(0);
  /** 写操作需要读到最新列表（如按 id 取原条目），state 的闭包拿不到。 */
  const latest = useRef(comments);
  latest.current = comments;

  /** 演示态没有轮询，也就没有「未读」可言。 */
  const acknowledgeNew = useCallback((): string | null => {
    setNewCount(0);
    return null;
  }, []);

  const create = useCallback(async (draft: ReviewCommentDraft): Promise<ReviewComment> => {
    const now = new Date().toISOString();
    const comment: ReviewComment = {
      ...draft,
      id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      projectId: DEMO_SHARE_TOKEN,
      // 工作区是创建者视角，演示态同样以 owner 身份落笔。
      authorType: "owner",
      status: "open",
      createdAt: now,
      updatedAt: now,
      replies: [],
    };
    setComments((current) => addComment(current, comment));
    return comment;
  }, []);

  const update = useCallback(
    async (commentId: string, patch: ReviewCommentPatch): Promise<ReviewComment> => {
      const existing = latest.current.find((comment) => comment.id === commentId);
      if (!existing) throw new Error("批注不存在或已被删除。");
      const next: ReviewComment = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      setComments((current) => replaceComment(current, next));
      return next;
    },
    [],
  );

  const remove = useCallback(async (commentId: string): Promise<void> => {
    setComments((current) => dropComment(current, commentId));
  }, []);

  const reply = useCallback(
    async (commentId: string, draft: ReviewReplyDraft): Promise<ReviewReply> => {
      const created: ReviewReply = {
        id: `demo-reply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        commentId,
        body: draft.body,
        authorName: draft.authorName,
        authorType: "owner",
        createdAt: new Date().toISOString(),
      };
      setComments((current) => addReply(current, commentId, created));
      return created;
    },
    [],
  );

  const removeReply = useCallback(async (commentId: string, replyId: string): Promise<void> => {
    setComments((current) => dropReply(current, commentId, replyId));
  }, []);

  return { comments, error, newCount, acknowledgeNew, create, update, remove, reply, removeReply };
}
