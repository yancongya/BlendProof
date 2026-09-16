/**
 * 离线演示降级构造器。
 *
 * Suzanne 演示在无后端时（静态预览、worker 未启动）仍要可交互，
 * 因此写操作失败后回退为本地记录。只影响演示口令分享。
 */

import type { ReviewComment, ReviewCommentDraft, ReviewReply } from "./types";

export function localComment(
  token: string,
  draft: ReviewCommentDraft,
  authorName: string,
): ReviewComment {
  const now = new Date().toISOString();
  return {
    ...draft,
    id: `demo-${Date.now()}`,
    projectId: token,
    authorName,
    authorType: "guest",
    status: "open",
    createdAt: now,
    updatedAt: now,
    replies: [],
  };
}

export function localReply(
  commentId: string,
  body: string,
  authorName: string,
): ReviewReply {
  return {
    id: `demo-reply-${Date.now()}`,
    commentId,
    body,
    authorName,
    authorType: "guest",
    createdAt: new Date().toISOString(),
  };
}
