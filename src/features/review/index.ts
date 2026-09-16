/**
 * 审稿域唯一出口。
 *
 * 外部（pages/ 与迁移期的 legacy 目录）只能从这里引用，禁止深引用内部路径。
 * 详见 docs/ARCHITECTURE_RULES.md。
 */

import "./review.css";

export type {
  AnnotationHit,
  PendingReview,
  ReviewAuthorType,
  ReviewComment,
  ReviewCommentDraft,
  ReviewCommentPatch,
  ReviewFilter,
  ReviewReply,
  ReviewReplyDraft,
  ReviewStatus,
} from "./types";

export { reviewRepository } from "./api/reviewRepository";
export { useReviewComments } from "./hooks/useReviewComments";
export { useGuestReview } from "./hooks/useGuestReview";
export {
  forgetDeleteToken,
  readDeleteToken,
  rememberDeleteToken,
} from "./deleteTokens";
export { ReviewPanel } from "./components/ReviewPanel";
export { ReviewAnnotations } from "./components/ReviewAnnotations";
