import type {
  ReviewComment,
  ReviewCommentDraft,
} from "../reviewRepository";

export type OwnerProject = {
  id: string;
  name: string;
  modelUrl: string;
  manifestUrl: string;
  ownerCapability: string;
};

export type ShareSettings = {
  password?: string | null;
  expiresAt?: string | null;
  commentsPermission?: "read_only" | "comment";
};

export type CreatedShare = {
  id: string;
  shareUrl: string;
  expiresAt: string | null;
  commentsPermission: "read_only" | "comment";
};

export type SharedProject<Manifest> = {
  name: string;
  modelUrl: string;
  manifest: Manifest;
  comments: ReviewComment[];
  commentsPermission: "read_only" | "comment";
};

type ErrorBody = { error?: string };

export type BlendProofClientOptions = {
  /** Worker/API origin. Empty keeps requests same-origin. */
  workerOrigin?: string;
  /** Local Blender bridge origin. Empty uses the development /api/local proxy. */
  bridgeOrigin?: string;
  fetchImplementation?: typeof fetch;
};

/**
 * The browser's only transport boundary. The local bridge owns the current
 * `.blend`, review, and share workflow; the independently configured Worker
 * origin remains reserved for the cloud publish workflow.
 */
export class BlendProofClient {
  private readonly workerOrigin: string;
  private readonly bridgeOrigin: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: BlendProofClientOptions = {}) {
    this.workerOrigin = trimOrigin(options.workerOrigin);
    this.bridgeOrigin = trimOrigin(options.bridgeOrigin);
    this.fetchImplementation = options.fetchImplementation ?? ((input, init) => globalThis.fetch(input, init));
  }

  async convertLocal(file: File): Promise<OwnerProject> {
    const body = new FormData();
    body.append("blend", file);
    const project = await this.bridgeJson<OwnerProject>("/api/local/convert", {
      method: "POST",
      body,
    });
    return {
      ...project,
      modelUrl: this.bridgeUrl(project.modelUrl),
      manifestUrl: this.bridgeUrl(project.manifestUrl),
    };
  }

  loadJson<T>(url: string): Promise<T> {
    return this.requestJson<T>(url);
  }

  createShare(projectId: string, ownerCapability: string, settings: ShareSettings) {
    return this.bridgeJson<CreatedShare>(`/api/local/projects/${projectId}/shares`, {
      method: "POST",
      headers: ownerJsonHeaders(ownerCapability),
      body: JSON.stringify(settings),
    });
  }

  revokeShare(projectId: string, ownerCapability: string, shareId: string) {
    return this.bridgeVoid(`/api/local/projects/${projectId}/shares/${shareId}`, {
      method: "DELETE",
      headers: { "x-blendproof-owner": ownerCapability },
    });
  }

  async listOwnerComments(projectId: string, ownerCapability: string) {
    const body = await this.bridgeJson<{ comments: ReviewComment[] }>(
      `/api/local/projects/${projectId}/comments`,
      { headers: { "x-blendproof-owner": ownerCapability } },
    );
    return body.comments;
  }

  async createOwnerComment(projectId: string, ownerCapability: string, draft: ReviewCommentDraft) {
    const body = await this.bridgeJson<{ comment: ReviewComment }>(
      `/api/local/projects/${projectId}/comments`,
      {
        method: "POST",
        headers: ownerJsonHeaders(ownerCapability),
        body: JSON.stringify(draft),
      },
    );
    return body.comment;
  }

  async updateOwnerComment(
    projectId: string,
    ownerCapability: string,
    commentId: string,
    patch: Pick<Partial<ReviewComment>, "body" | "status">,
  ) {
    const body = await this.bridgeJson<{ comment: ReviewComment }>(
      `/api/local/projects/${projectId}/comments/${commentId}`,
      {
        method: "PATCH",
        headers: ownerJsonHeaders(ownerCapability),
        body: JSON.stringify(patch),
      },
    );
    return body.comment;
  }

  async loadShare<Manifest>(token: string): Promise<SharedProject<Manifest>> {
    const share = await this.bridgeJson<SharedProject<Manifest>>(`/api/local/shares/${token}`);
    return { ...share, modelUrl: this.bridgeUrl(share.modelUrl) };
  }

  shareStatus(token: string) {
    return this.bridgeJson<{ passwordRequired?: boolean }>(`/api/local/shares/${token}/status`);
  }

  unlockShare(token: string, password: string) {
    return this.bridgeVoid(`/api/local/shares/${token}/access`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
  }

  async createGuestComment(token: string, draft: ReviewCommentDraft) {
    const body = await this.bridgeJson<{ comment: ReviewComment }>(`/api/local/shares/${token}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!body.comment) throw new Error("无法添加评论。");
    return body.comment;
  }

  private workerJson<T>(path: string, init?: RequestInit) {
    return this.requestJson<T>(this.workerUrl(path), init);
  }

  private bridgeJson<T>(path: string, init?: RequestInit) {
    return this.requestJson<T>(this.bridgeUrl(path), init);
  }

  private async workerVoid(path: string, init?: RequestInit) {
    return this.requestVoid(this.workerUrl(path), init);
  }

  private async bridgeVoid(path: string, init?: RequestInit) {
    return this.requestVoid(this.bridgeUrl(path), init);
  }

  private async requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImplementation(url, init);
    const body = await response.json().catch(() => null) as (T & ErrorBody) | null;
    if (!response.ok) throw new Error(body?.error ?? "BlendProof API 请求失败。");
    if (body === null) throw new Error("BlendProof API 返回了无效 JSON。");
    return body;
  }

  private async requestVoid(url: string, init?: RequestInit): Promise<void> {
    const response = await this.fetchImplementation(url, init);
    if (response.ok) return;
    const body = await response.json().catch(() => null) as ErrorBody | null;
    throw new Error(body?.error ?? "BlendProof API 请求失败。");
  }

  private workerUrl(path: string) {
    return withOrigin(this.workerOrigin, path);
  }

  private bridgeUrl(path: string) {
    return withOrigin(this.bridgeOrigin, path);
  }
}

function ownerJsonHeaders(ownerCapability: string) {
  return { "content-type": "application/json", "x-blendproof-owner": ownerCapability };
}

function trimOrigin(value: string | undefined) {
  return value?.replace(/\/$/, "") ?? "";
}

function withOrigin(origin: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${origin}${path}`;
}

export const blendProofClient = new BlendProofClient({
  workerOrigin: import.meta.env?.VITE_WORKER_API_ORIGIN,
  bridgeOrigin: import.meta.env?.VITE_LOCAL_BRIDGE_ORIGIN,
});
