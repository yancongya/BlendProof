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
  /** One-shot out-of-band code used to bootstrap a short-lived local session. */
  bridgePairingCode?: string;
  fetchImplementation?: typeof fetch;
};

export const LOCAL_BRIDGE_NONCE_HEADER = "x-blendproof-session-nonce";

/**
 * The browser's only transport boundary. The local bridge owns the current
 * `.blend`, review, and share workflow; the independently configured Worker
 * origin remains reserved for the cloud publish workflow.
 */
export class BlendProofClient {
  private readonly workerOrigin: string;
  private readonly bridgeOrigin: string;
  private bridgePairingCode: string;
  private readonly fetchImplementation: typeof fetch;
  private bridgeNonce: string | null = null;
  private bridgeExpiresAt = 0;
  private bridgePairingPromise: Promise<void> | null = null;

  constructor(options: BlendProofClientOptions = {}) {
    this.workerOrigin = trimOrigin(options.workerOrigin);
    this.bridgeOrigin = trimOrigin(options.bridgeOrigin);
    this.bridgePairingCode = options.bridgePairingCode ?? import.meta.env?.VITE_LOCAL_BRIDGE_PAIRING_CODE ?? "";
    this.fetchImplementation = options.fetchImplementation ?? ((input, init) => globalThis.fetch(input, init));
    this.restoreBridgeSession();
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
    return this.requestJson<T>(url, undefined, this.isBridgeUrl(url));
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
    return this.requestJson<T>(this.bridgeUrl(path), init, true);
  }

  private async workerVoid(path: string, init?: RequestInit) {
    return this.requestVoid(this.workerUrl(path), init);
  }

  private async bridgeVoid(path: string, init?: RequestInit) {
    return this.requestVoid(this.bridgeUrl(path), init, true);
  }

  /** Fetch a local asset or any other bridge resource with its session header. */
  async fetchLocal(url: string, init?: RequestInit): Promise<Response> {
    const resolved = this.bridgeUrl(url);
    if (!this.isBridgeUrl(resolved)) throw new Error("拒绝向本机 bridge 之外的地址发送会话凭据。");
    return this.bridgeFetch(resolved, init);
  }

  /** Headers for loaders (such as GLTFLoader) after a bridge call has paired. */
  assetRequestHeaders(url: string): Record<string, string> {
    return this.isBridgeUrl(url) && this.bridgeNonce && this.bridgeExpiresAt > Date.now()
      ? { [LOCAL_BRIDGE_NONCE_HEADER]: this.bridgeNonce }
      : {};
  }

  private async requestJson<T>(url: string, init?: RequestInit, bridge = false): Promise<T> {
    const response = bridge
      ? await this.bridgeFetch(url, init)
      : await this.fetchImplementation(url, init);
    const body = await response.json().catch(() => null) as (T & ErrorBody) | null;
    if (!response.ok) throw new Error(body?.error ?? "BlendProof API 请求失败。");
    if (body === null) throw new Error("BlendProof API 返回了无效 JSON。");
    return body;
  }

  private async requestVoid(url: string, init?: RequestInit, bridge = false): Promise<void> {
    const response = bridge
      ? await this.bridgeFetch(url, init)
      : await this.fetchImplementation(url, init);
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

  private isBridgeUrl(url: string) {
    const bridgePath = this.bridgeUrl("/api/local");
    return url === bridgePath || url.startsWith(`${bridgePath}/`);
  }

  private async withBridgeSession(init?: RequestInit): Promise<RequestInit> {
    await this.ensureBridgeSession();
    const headers = new Headers(init?.headers);
    headers.set(LOCAL_BRIDGE_NONCE_HEADER, this.bridgeNonce!);
    return { ...init, credentials: init?.credentials ?? "include", headers };
  }

  private async ensureBridgeSession() {
    if (this.bridgeNonce && this.bridgeExpiresAt > Date.now() + 5_000) return;
    if (!this.bridgePairingCode) {
      throw new Error("缺少本机 bridge 配对码，请配置 VITE_LOCAL_BRIDGE_PAIRING_CODE。");
    }
    if (!this.bridgePairingPromise) {
      this.bridgePairingPromise = this.pairBridge().finally(() => {
        this.bridgePairingPromise = null;
      });
    }
    await this.bridgePairingPromise;
  }

  private async pairBridge() {
    const response = await this.fetchImplementation(this.bridgeUrl("/api/local/pair"), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingCode: this.bridgePairingCode }),
    });
    const body = await response.json().catch(() => null) as {
      nonce?: unknown;
      expiresAt?: unknown;
      error?: string;
    } | null;
    if (!response.ok) throw new Error(body?.error ?? "本机 bridge 配对失败。");
    if (typeof body?.nonce !== "string" || !body.nonce || typeof body.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(body.expiresAt))) {
      throw new Error("本机 bridge 返回了无效会话。");
    }
    this.bridgeNonce = body.nonce;
    this.bridgeExpiresAt = Date.parse(body.expiresAt);
    this.persistBridgeSession();
  }

  private async bridgeFetch(url: string, init?: RequestInit) {
    let response = await this.fetchImplementation(url, await this.withBridgeSession(init));
    if (response.status === 401 && response.headers.get("x-blendproof-bridge-session") === "invalid") {
      this.bridgeNonce = null;
      this.bridgeExpiresAt = 0;
      response = await this.fetchImplementation(url, await this.withBridgeSession(init));
    }
    return response;
  }

  private restoreBridgeSession() {
    if (typeof sessionStorage === "undefined") return;
    try {
      const stored = JSON.parse(sessionStorage.getItem("blendproof:bridge-session") ?? "null") as Record<string, unknown> | null;
      if (stored && stored.bridgeOrigin === this.bridgeOrigin && typeof stored.nonce === "string" && typeof stored.expiresAt === "number") {
        this.bridgeNonce = stored.nonce;
        this.bridgeExpiresAt = stored.expiresAt;
      }
    } catch { /* Ignore corrupt browser session state and pair again. */ }
  }

  private persistBridgeSession() {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem("blendproof:bridge-session", JSON.stringify({
      nonce: this.bridgeNonce,
      expiresAt: this.bridgeExpiresAt,
      bridgeOrigin: this.bridgeOrigin,
    }));
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
  bridgePairingCode: import.meta.env?.VITE_LOCAL_BRIDGE_PAIRING_CODE,
});
