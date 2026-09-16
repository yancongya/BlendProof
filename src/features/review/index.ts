/**
 * 审稿域唯一出口。
 *
 * 外部（pages/ 与迁移期的 legacy 目录）只能从这里引用，禁止深引用内部路径。
 * 详见 docs/ARCHITECTURE_RULES.md。
 */

export type {
  AnnotationHit,
  PendingReview,
  ReviewComment,
  ReviewCommentDraft,
  ReviewCommentPatch,
  ReviewFilter,
  ReviewStatus,
} from "./types";

export { reviewRepository } from "./api/reviewRepository";
export { useReviewComments } from "./hooks/useReviewComments";
export { ReviewPanel } from "./components/ReviewPanel";
export { ReviewAnnotations } from "./components/ReviewAnnotations";
