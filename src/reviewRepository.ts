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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "评论服务请求失败。");
  return body;
}

export const reviewRepository = {
  async list(projectId: string) {
    const body = await request<{ comments: ReviewComment[] }>(
      `/api/projects/${projectId}/comments`,
    );
    return body.comments;
  },

  async create(projectId: string, draft: ReviewCommentDraft) {
    const body = await request<{ comment: ReviewComment }>(
      `/api/projects/${projectId}/comments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      },
    );
    return body.comment;
  },

  async update(
    projectId: string,
    commentId: string,
    patch: Pick<Partial<ReviewComment>, "body" | "status">,
  ) {
    const body = await request<{ comment: ReviewComment }>(
      `/api/projects/${projectId}/comments/${commentId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    return body.comment;
  },
};
