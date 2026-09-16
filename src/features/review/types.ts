/**
 * 审稿域类型。
 *
 * 锚点相关的纯几何/相机类型提升到了 shared（viewer 也要用），
 * 这里只保留审稿域自己的概念。
 */

import type { CameraState } from "../../shared/types/camera";
import type { Vec3 } from "../../shared/types/geometry";

export type ReviewStatus = "open" | "resolved";

export type ReviewComment = {
  id: string;
  projectId: string;
  objectName: string | null;
  position: Vec3;
  normal: Vec3;
  camera: CameraState;
  body: string;
  authorName: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
};

export type ReviewCommentDraft = Omit<
  ReviewComment,
  "id" | "projectId" | "status" | "createdAt" | "updatedAt"
>;

/** PATCH 允许变更的字段。状态是审稿方裁决，访客无权修改。 */
export type ReviewCommentPatch = Pick<Partial<ReviewComment>, "body" | "status">;

/** 批注列表的状态筛选。 */
export type ReviewFilter = "all" | ReviewStatus;

/** 已在模型上落点、等待填写正文的批注草稿。 */
export type PendingReview = Omit<ReviewCommentDraft, "body" | "authorName">;

/** 悬停模型表面时的命中结果，用于显示吸附点。 */
export type AnnotationHit = {
  position: Vec3;
  normal: Vec3;
  objectName: string | null;
};
