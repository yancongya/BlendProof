import { blendProofClient } from "./api/blendProofClient";

export type Vec3 = [number, number, number];

export type ReviewCameraState = {
  projection: "perspective" | "orthographic";
  position: Vec3;
  quaternion: [number, number, number, number];
  target: Vec3;
  fov?: number;
  zoom?: number;
  orthographicHeight?: number;
};

export type ReviewComment = {
  id: string;
  projectId: string;
  objectName: string | null;
  position: Vec3;
  normal: Vec3;
  camera: ReviewCameraState;
  body: string;
  authorName: string;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
};

export type ReviewCommentDraft = Omit<
  ReviewComment,
  "id" | "projectId" | "status" | "createdAt" | "updatedAt"
>;

export const reviewRepository = {
  async list(projectId: string, ownerCapability: string) {
    return blendProofClient.listOwnerComments(projectId, ownerCapability);
  },

  async create(projectId: string, ownerCapability: string, draft: ReviewCommentDraft) {
    return blendProofClient.createOwnerComment(projectId, ownerCapability, draft);
  },

  async update(
    projectId: string,
    ownerCapability: string,
    commentId: string,
    patch: Pick<Partial<ReviewComment>, "body" | "status">,
  ) {
    return blendProofClient.updateOwnerComment(projectId, ownerCapability, commentId, patch);
  },
};
