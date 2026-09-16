/**
 * 创建者侧的批注写操作。
 *
 * 与 useReviewComments 配对：列表与轮询归它，写操作归这里。
 * 拆开是因为两者加起来会超出 hook 行数预算，且写操作本可独立测试。
 *
 * 所有写操作共用一套「凭据检查 + 代际守卫」：请求发出后若项目已切换或
 * 已有更新的请求，就丢弃本次结果，避免旧响应覆盖新状态。
 */

import { useCallback } from "react";
import type { ProjectTransport } from "../../../api/blendProofClient";
import {
  addComment,
  addReply,
  dropComment,
  dropReply,
  replaceComment,
} from "../reviewState";
import { reviewRepository } from "../api/reviewRepository";
import type {
  ReviewComment,
  ReviewCommentDraft,
  ReviewCommentPatch,
  ReviewReply,
  ReviewReplyDraft,
} from "../types";

const OWNER_CREDENTIALS_REQUIRED = "请重新导入项目以取得所有者凭据。";

export function useReviewMutations({
  projectId,
  ownerCapability,
  transport,
  setComments,
  beginWrite,
  isStale,
}: {
  projectId: string | null;
  ownerCapability: string | null;
  transport: ProjectTransport;
  setComments: (update: (current: ReviewComment[]) => ReviewComment[]) => void;
  beginWrite: () => { generation: number; projectId: string };
  isStale: (generation: number, forProject: string) => boolean;
}) {
  /** 写操作进入前统一校验凭据；缺凭据就抛，让调用方显示原因。 */
  const credentials = useCallback(() => {
    if (!projectId || !ownerCapability) throw new Error(OWNER_CREDENTIALS_REQUIRED);
    return ownerCapability;
  }, [projectId, ownerCapability]);

  const create = useCallback(
    async (draft: ReviewCommentDraft) => {
      const capability = credentials();
      const { generation, projectId: target } = beginWrite();
      const comment = await reviewRepository.create(target, capability, draft, transport);
      if (!isStale(generation, target)) setComments((current) => addComment(current, comment));
      return comment;
    },
    [beginWrite, credentials, isStale, setComments, transport],
  );

  const update = useCallback(
    async (commentId: string, patch: ReviewCommentPatch) => {
      const capability = credentials();
      const { generation, projectId: target } = beginWrite();
      const comment = await reviewRepository.update(target, capability, commentId, patch, transport);
      if (!isStale(generation, target)) setComments((current) => replaceComment(current, comment));
      return comment;
    },
    [beginWrite, credentials, isStale, setComments, transport],
  );

  const remove = useCallback(
    async (commentId: string) => {
      const capability = credentials();
      const { generation, projectId: target } = beginWrite();
      await reviewRepository.remove(target, capability, commentId, transport);
      if (!isStale(generation, target))
        setComments((current) => dropComment(current, commentId));
    },
    [beginWrite, credentials, isStale, setComments, transport],
  );

  const reply = useCallback(
    async (commentId: string, draft: ReviewReplyDraft): Promise<ReviewReply> => {
      const capability = credentials();
      const { generation, projectId: target } = beginWrite();
      const created = await reviewRepository.reply(target, capability, commentId, draft, transport);
      if (!isStale(generation, target))
        setComments((current) => addReply(current, commentId, created));
      return created;
    },
    [beginWrite, credentials, isStale, setComments, transport],
  );

  const removeReply = useCallback(
    async (commentId: string, replyId: string) => {
      const capability = credentials();
      const { generation, projectId: target } = beginWrite();
      await reviewRepository.removeReply(target, capability, commentId, replyId, transport);
      if (!isStale(generation, target))
        setComments((current) => dropReply(current, commentId, replyId));
    },
    [beginWrite, credentials, isStale, setComments, transport],
  );

  return { create, update, remove, reply, removeReply };
}
