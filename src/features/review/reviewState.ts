/**
 * 批注列表的纯更新函数。
 *
 * 不依赖 React，便于单测；也让「列表怎么变」的规则集中在一处，
 * 而不是散在各写操作里。
 */

import type { ReviewComment, ReviewReply } from "./types";

/** 按 id 定位并替换一条批注。 */
function mapComment(
  comments: ReviewComment[],
  commentId: string,
  update: (comment: ReviewComment) => ReviewComment,
): ReviewComment[] {
  return comments.map((comment) => (comment.id === commentId ? update(comment) : comment));
}

export function addComment(comments: ReviewComment[], comment: ReviewComment) {
  return [...comments, comment];
}

export function replaceComment(comments: ReviewComment[], comment: ReviewComment) {
  return mapComment(comments, comment.id, () => comment);
}

/** 删除批注；其回复随服务端级联一并消失，本地无需单独处理。 */
export function dropComment(comments: ReviewComment[], commentId: string) {
  return comments.filter((comment) => comment.id !== commentId);
}

export function addReply(comments: ReviewComment[], commentId: string, reply: ReviewReply) {
  return mapComment(comments, commentId, (comment) => ({
    ...comment,
    replies: [...comment.replies, reply],
  }));
}

export function dropReply(comments: ReviewComment[], commentId: string, replyId: string) {
  return mapComment(comments, commentId, (comment) => ({
    ...comment,
    replies: comment.replies.filter((reply) => reply.id !== replyId),
  }));
}
