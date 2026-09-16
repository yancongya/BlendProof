/**
 * 审稿域的数据访问层。
 *
 * 屏蔽本地 SQLite 与云端 D1 的差异，对上层只暴露批注的读写。
 * 接口契约见 docs/REVIEW_CONTRACT.md。
 */

import {
  blendProofClient,
  type ProjectTransport,
} from "../../../api/blendProofClient";
import type {
  ReviewComment,
  ReviewCommentDraft,
  ReviewCommentPatch,
} from "../types";

export const reviewRepository = {
  async list(
    projectId: string,
    ownerCapability: string,
    transport: ProjectTransport = "local",
  ) {
    return blendProofClient.listOwnerComments(projectId, ownerCapability, transport);
  },

  async create(
    projectId: string,
    ownerCapability: string,
    draft: ReviewCommentDraft,
    transport: ProjectTransport = "local",
  ): Promise<ReviewComment> {
    return blendProofClient.createOwnerComment(projectId, ownerCapability, draft, transport);
  },

  async update(
    projectId: string,
    ownerCapability: string,
    commentId: string,
    patch: ReviewCommentPatch,
    transport: ProjectTransport = "local",
  ): Promise<ReviewComment> {
    return blendProofClient.updateOwnerComment(projectId, ownerCapability, commentId, patch, transport);
  },
};
