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
  /** Local projects use the bridge by default; cloud projects use the Worker. */
  transport?: ProjectTransport;
  /** Cloud initialization/finalization state. Local bridge projects are ready on return. */
  status?: "pending" | "uploading" | "ready";
};

export type ProjectTransport = "local" | "cloud";

export type CloudOwnerProject = Pick<OwnerProject, "id" | "name" | "ownerCapability"> & {
  transport: "cloud";
  status: "ready";
};

/**
 * Only URLs of already-derived local assets are accepted here. The project
 * title is deliberately independent from a local .blend filename.
 */
export type CloudPublishInput = {
  name: string;
  modelUrl: string;
  manifestUrl: string;
  /** Reuse this value to retry an interrupted publish safely. */
  idempotencyKey?: string;
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

export type PublicStats = {
  capacityBytes: number;
  usedBytes: number;
  remainingBytes: number;
  projectCount: number;
  activeShareCount: number;
  userCount: number;
  retentionHours: number;
  recommendedShareHours: number;
};

export type AccountUser = {
  id: string;
  email: string;
  displayName: string;
  role: "user" | "admin";
  createdAt: string;
};

export type AccountStats = {
  usedBytes: number;
  projectCount: number;
  activeShareCount: number;
};

export type AdminUser = AccountUser & { disabledAt: string | null; usedBytes: number; projectCount: number };
export type AdminInvite = { id: string; maxUses: number; usesCount: number; expiresAt: string; revokedAt: string | null; createdAt: string };
export type AdminSettings = { capacityBytes: number; maxShareHours: number };

export type SharedProject<Manifest> = {
  name: string;
  modelUrl: string;
  manifest: Manifest;
  comments: ReviewComment[];
  commentsPermission: "read_only" | "comment";
  expiresAt: string | null;
};

type CloudManifest = {
  scene: string;
  camera?: string | null;
  cameras?: Array<{ name: string; projection: string }>;
  objects: Array<{ name: string; type: string; collections: string[] }>;
  collections: string[];
  materials?: string[];
  /** Source-file metadata is intentionally excluded before cloud upload. */
  export?: { glbBytes?: number; objectCount?: number };
};

type UploadAsset = {
  name: "model.glb" | "manifest.json";
  contentType: "model/gltf-binary" | "application/json";
  byteSize: number;
  sha256: string;
};

type UploadIntent = {
  intentToken: string;
  assets: Array<{ name: UploadAsset["name"]; method: "PUT"; url: string }>;
};

type ErrorBody = { error?: string };
type CloudPublishSession = CloudOwnerProject & { fingerprint: string; idempotencyKey: string };

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
      transport: "local",
      status: "ready",
      modelUrl: this.bridgeUrl(project.modelUrl),
      manifestUrl: this.bridgeUrl(project.manifestUrl),
    };
  }

  /**
   * Publish only a locally converted GLB and a serialized, allowlisted
   * manifest. The raw .blend never crosses the Worker transport boundary.
   */
  async publishCloud(input: CloudPublishInput): Promise<CloudOwnerProject> {
    const name = cloudProjectName(input.name);
    const requestedIdempotencyKey = input.idempotencyKey ?? createIdempotencyKey();
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(requestedIdempotencyKey)) {
      throw new Error("云端上传幂等键无效。");
    }

    const [modelBytes, rawManifest] = await Promise.all([
      this.readDerivedLocalAsset(input.modelUrl),
      this.readDerivedLocalJson(input.manifestUrl),
    ]);
    if (modelBytes.byteLength === 0 || modelBytes.byteLength > 50 * 1024 * 1024) {
      throw new Error("派生 GLB 文件大小无效。");
    }
    const manifestBytes = serializeCloudManifest(rawManifest, name);
    const assets: Array<UploadAsset & { body: Uint8Array }> = [
      {
        name: "model.glb",
        contentType: "model/gltf-binary",
        byteSize: modelBytes.byteLength,
        sha256: await sha256Hex(modelBytes),
        body: modelBytes,
      },
      {
        name: "manifest.json",
        contentType: "application/json",
        byteSize: manifestBytes.byteLength,
        sha256: await sha256Hex(manifestBytes),
        body: manifestBytes,
      },
    ];

    const fingerprint = await sha256Hex(new TextEncoder().encode(JSON.stringify({
      name,
      assets: assets.map(({ body: _body, name: assetName, byteSize, sha256 }) => ({ name: assetName, byteSize, sha256 })),
    })));
    const recovered = restoreCloudPublishSession(fingerprint);
    let idempotencyKey = recovered?.idempotencyKey ?? requestedIdempotencyKey;
    let project: Pick<CloudOwnerProject, "id" | "name" | "ownerCapability">;
    if (recovered) {
      const finalized = await this.workerFetch(`/api/projects/${encodeURIComponent(recovered.id)}/finalize`, {
        method: "POST",
        headers: ownerJsonHeaders(recovered.ownerCapability),
        body: JSON.stringify({ idempotencyKey: recovered.idempotencyKey }),
      });
      if (finalized.ok) return recovered;
      if (finalized.status !== 404 && finalized.status !== 409) throw await responseError(finalized);
      project = recovered;
    } else {
      const initialized = await this.workerJson<{ id: unknown; name: unknown; ownerCapability: unknown; status: unknown }>("/api/projects", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ name }),
      });
      project = parseInitializedCloudProject(initialized);
      persistCloudPublishSession({ ...project, transport: "cloud", status: "ready", fingerprint, idempotencyKey });
    }

    const requestIntent = () => this.workerJson<UploadIntent>(`/api/projects/${encodeURIComponent(project.id)}/upload-intents`, {
      method: "POST", headers: ownerJsonHeaders(project.ownerCapability),
      body: JSON.stringify({ idempotencyKey, assets: assets.map(({ body: _body, ...asset }) => asset) }),
    });
    let intent: UploadIntent;
    try {
      intent = await requestIntent();
    } catch (reason) {
      if (!recovered || !(reason instanceof Error) || !reason.message.includes("旧上传意图已过期")) throw reason;
      idempotencyKey = createIdempotencyKey();
      persistCloudPublishSession({ ...project, transport: "cloud", status: "ready", fingerprint, idempotencyKey });
      intent = await requestIntent();
    }
    validateUploadIntent(intent, project.id, assets);

    await Promise.all(intent.assets.map(async (target) => {
      const asset = assets.find((item) => item.name === target.name);
      if (!asset) throw new Error("云端上传意图包含未知资源。");
      const response = await this.workerFetch(target.url, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${intent.intentToken}`,
          "content-type": asset.contentType,
        },
        body: asset.body as unknown as BodyInit,
      });
      if (!response.ok) throw await responseError(response);
    }));

    const finalized = await this.workerJson<{ id: unknown; status: unknown }>(`/api/projects/${encodeURIComponent(project.id)}/finalize`, {
      method: "POST",
      headers: ownerJsonHeaders(project.ownerCapability),
      body: JSON.stringify({ idempotencyKey }),
    });
    if (finalized.id !== project.id || finalized.status !== "ready") {
      throw new Error("云端项目未能完成发布。");
    }
    return {
      ...project,
      transport: "cloud",
      status: "ready",
    };
  }

  loadJson<T>(url: string): Promise<T> {
    return this.requestJson<T>(url, undefined, this.isBridgeUrl(url));
  }

  createShare(projectId: string, ownerCapability: string, settings: ShareSettings, transport: ProjectTransport = "local") {
    return this.transportJson<CreatedShare>(transport, `/api/projects/${encodeURIComponent(projectId)}/shares`, {
      method: "POST",
      headers: ownerJsonHeaders(ownerCapability),
      body: JSON.stringify(settings),
    });
  }

  revokeShare(projectId: string, ownerCapability: string, shareId: string, transport: ProjectTransport = "local") {
    return this.transportVoid(transport, `/api/projects/${encodeURIComponent(projectId)}/shares/${encodeURIComponent(shareId)}`, {
      method: "DELETE",
      headers: { "x-blendproof-owner": ownerCapability },
    });
  }

  deleteLocalProject(projectId: string, ownerCapability: string) {
    return this.bridgeVoid(`/api/local/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
      headers: { "x-blendproof-owner": ownerCapability },
    });
  }

  publicStats() {
    return this.workerJson<PublicStats>("/api/public/stats");
  }

  async currentUser() {
    return (await this.workerJson<{ user: AccountUser | null }>("/api/me")).user;
  }

  async accountStats() {
    return this.workerJson<AccountStats>("/api/me/stats");
  }

  async login(email: string, password: string) {
    return (await this.workerJson<{ user: AccountUser }>("/api/auth/login", {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ email, password }),
    })).user;
  }

  async register(input: { inviteCode: string; email: string; password: string; displayName: string }) {
    return (await this.workerJson<{ user: AccountUser }>("/api/auth/register", {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify(input),
    })).user;
  }

  logout() {
    return this.workerVoid("/api/auth/logout", { method: "POST", headers: jsonHeaders() });
  }

  createInvite(expiresInHours = 168, maxUses = 1) {
    return this.workerJson<{ code: string; expiresAt: string; maxUses: number }>("/api/admin/invites", {
      method: "POST", headers: jsonHeaders(), body: JSON.stringify({ expiresInHours, maxUses }),
    });
  }

  async adminUsers() {
    return (await this.workerJson<{ users: AdminUser[] }>("/api/admin/users")).users;
  }

  async adminInvites() {
    return (await this.workerJson<{ invites: AdminInvite[] }>("/api/admin/invites")).invites;
  }

  revokeAdminInvite(inviteId: string) {
    return this.workerVoid(`/api/admin/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
  }

  disableAdminUser(userId: string) {
    return this.workerVoid(`/api/admin/users/${encodeURIComponent(userId)}/disable`, { method: "POST", headers: jsonHeaders() });
  }

  adminSettings() {
    return this.workerJson<AdminSettings>("/api/admin/settings");
  }

  updateAdminSettings(settings: AdminSettings) {
    return this.workerJson<AdminSettings>("/api/admin/settings", { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(settings) });
  }

  async listOwnerComments(projectId: string, ownerCapability: string, transport: ProjectTransport = "local") {
    const body = await this.transportJson<{ comments: ReviewComment[] }>(
      transport, `/api/projects/${encodeURIComponent(projectId)}/comments`,
      { headers: { "x-blendproof-owner": ownerCapability } },
    );
    return body.comments;
  }

  async createOwnerComment(projectId: string, ownerCapability: string, draft: ReviewCommentDraft, transport: ProjectTransport = "local") {
    const body = await this.transportJson<{ comment: ReviewComment }>(
      transport, `/api/projects/${encodeURIComponent(projectId)}/comments`,
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
    transport: ProjectTransport = "local",
  ) {
    const body = await this.transportJson<{ comment: ReviewComment }>(
      transport, `/api/projects/${encodeURIComponent(projectId)}/comments/${encodeURIComponent(commentId)}`,
      {
        method: "PATCH",
        headers: ownerJsonHeaders(ownerCapability),
        body: JSON.stringify(patch),
      },
    );
    return body.comment;
  }

  async loadShare<Manifest>(token: string, transport: ProjectTransport = "local"): Promise<SharedProject<Manifest>> {
    const share = await this.transportJson<SharedProject<Manifest>>(transport, `/api/shares/${encodeURIComponent(token)}`);
    return { ...share, modelUrl: this.transportUrl(transport, share.modelUrl) };
  }

  shareStatus(token: string, transport: ProjectTransport = "local") {
    return this.transportJson<{ passwordRequired?: boolean }>(transport, `/api/shares/${encodeURIComponent(token)}/status`);
  }

  unlockShare(token: string, password: string, transport: ProjectTransport = "local") {
    return this.transportVoid(transport, `/api/shares/${encodeURIComponent(token)}/access`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
  }

  async createGuestComment(token: string, draft: ReviewCommentDraft, transport: ProjectTransport = "local") {
    const body = await this.transportJson<{ comment: ReviewComment }>(transport, `/api/shares/${encodeURIComponent(token)}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!body.comment) throw new Error("无法添加评论。");
    return body.comment;
  }

  private workerJson<T>(path: string, init?: RequestInit) {
    return this.requestJson<T>(this.workerUrl(path), { ...init, credentials: init?.credentials ?? "include" });
  }

  private bridgeJson<T>(path: string, init?: RequestInit) {
    return this.requestJson<T>(this.bridgeUrl(path), init, true);
  }

  private async workerVoid(path: string, init?: RequestInit) {
    return this.requestVoid(this.workerUrl(path), { ...init, credentials: init?.credentials ?? "include" });
  }

  private async bridgeVoid(path: string, init?: RequestInit) {
    return this.requestVoid(this.bridgeUrl(path), init, true);
  }

  private transportJson<T>(transport: ProjectTransport, path: string, init?: RequestInit) {
    return transport === "cloud"
      ? this.workerJson<T>(path, init)
      : this.bridgeJson<T>(localApiPath(path), init);
  }

  private transportVoid(transport: ProjectTransport, path: string, init?: RequestInit) {
    return transport === "cloud"
      ? this.workerVoid(path, init)
      : this.bridgeVoid(localApiPath(path), init);
  }

  private transportUrl(transport: ProjectTransport, path: string) {
    return transport === "cloud" ? this.workerUrl(path) : this.bridgeUrl(path);
  }

  private async workerFetch(path: string, init?: RequestInit) {
    return this.fetchImplementation(this.workerUrl(path), { ...init, credentials: init?.credentials ?? "include" });
  }

  private async readDerivedLocalAsset(url: string) {
    const response = await this.fetchLocal(url);
    if (!response.ok) throw await responseError(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async readDerivedLocalJson(url: string): Promise<unknown> {
    const response = await this.fetchLocal(url);
    if (!response.ok) throw await responseError(response);
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("本机 bridge 返回了无效 manifest JSON。");
    }
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

const CLOUD_PUBLISH_SESSION_KEY = "blendproof:cloud-publish-session";

function restoreCloudPublishSession(fingerprint: string): CloudPublishSession | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(CLOUD_PUBLISH_SESSION_KEY) ?? "null") as Partial<CloudPublishSession> | null;
    if (value?.fingerprint !== fingerprint || typeof value.id !== "string" || !/^[a-f0-9]{32}$/.test(value.id) ||
      typeof value.name !== "string" || typeof value.ownerCapability !== "string" || !/^[a-f0-9]{64}$/.test(value.ownerCapability) ||
      typeof value.idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(value.idempotencyKey)) return null;
    return { id: value.id, name: value.name, ownerCapability: value.ownerCapability, transport: "cloud", status: "ready",
      fingerprint, idempotencyKey: value.idempotencyKey };
  } catch { return null; }
}

function persistCloudPublishSession(value: CloudPublishSession) {
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(CLOUD_PUBLISH_SESSION_KEY, JSON.stringify(value));
}

function ownerJsonHeaders(ownerCapability: string) {
  return { "content-type": "application/json", "x-blendproof-owner": ownerCapability };
}

function jsonHeaders() {
  return { "content-type": "application/json" };
}

function cloudProjectName(value: string) {
  const name = value.trim();
  if (!name || name.length > 256 || /\.blend(?:$|\s)/i.test(name)) {
    throw new Error("云端项目名称无效；请使用不含 .blend 文件名的审稿标题。");
  }
  return name;
}

function createIdempotencyKey() {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  if (random && /^[a-f0-9]{32}$/i.test(random)) return `publish_${random}`;
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues(bytes);
  return `publish_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function parseInitializedCloudProject(value: { id: unknown; name: unknown; ownerCapability: unknown; status: unknown }) {
  if (typeof value.id !== "string" || !/^[a-f0-9]{32}$/.test(value.id) ||
    typeof value.name !== "string" || !value.name || typeof value.ownerCapability !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.ownerCapability) || value.status !== "pending") {
    throw new Error("云端项目初始化响应无效。");
  }
  return { id: value.id, name: value.name, ownerCapability: value.ownerCapability };
}

function validateUploadIntent(intent: UploadIntent, projectId: string, expectedAssets: UploadAsset[]) {
  if (!intent || typeof intent.intentToken !== "string" || !/^[a-f0-9]{64}$/.test(intent.intentToken) ||
    !Array.isArray(intent.assets) || intent.assets.length !== expectedAssets.length) {
    throw new Error("云端上传意图响应无效。");
  }
  const expectedNames = new Set(expectedAssets.map((asset) => asset.name));
  const seen = new Set<string>();
  for (const asset of intent.assets) {
    const expectedUrl = `/api/projects/${encodeURIComponent(projectId)}/assets/${asset.name}`;
    if (!asset || (asset.name !== "model.glb" && asset.name !== "manifest.json") || asset.method !== "PUT" ||
      asset.url !== expectedUrl || seen.has(asset.name)) {
      throw new Error("云端上传意图包含不安全的资源地址。");
    }
    seen.add(asset.name);
  }
  if (seen.size !== expectedNames.size || [...expectedNames].some((name) => !seen.has(name))) {
    throw new Error("云端上传意图缺少派生资源。");
  }
}

function serializeCloudManifest(value: unknown, projectName: string): Uint8Array {
  const manifest = sanitizeCloudManifest(value);
  manifest.scene = projectName;
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (bytes.byteLength === 0 || bytes.byteLength > 512 * 1024) {
    throw new Error("派生 manifest 文件大小无效。");
  }
  return bytes;
}

/**
 * Mirrors the Worker public manifest schema while dropping unknown fields.
 * In particular, sourceBytes is not allowed to leave the loopback bridge.
 */
function sanitizeCloudManifest(value: unknown): CloudManifest {
  if (!isRecord(value) || typeof value.scene !== "string" || !value.scene || value.scene.length > 256 ||
    !isStringArray(value.collections, 2_000) || !Array.isArray(value.objects) || value.objects.length > 10_000) {
    throw new Error("本机 bridge 返回的 manifest 不符合云端发布格式。");
  }
  const manifest: CloudManifest = {
    scene: value.scene,
    collections: [...value.collections],
    objects: value.objects.map((item) => sanitizeCloudObject(item)),
  };
  if (Object.hasOwn(value, "camera")) {
    if (value.camera !== null && typeof value.camera !== "string") throw new Error("manifest 相机信息无效。");
    manifest.camera = value.camera;
  }
  if (Object.hasOwn(value, "cameras")) {
    if (!Array.isArray(value.cameras) || value.cameras.length > 256) throw new Error("manifest 相机列表无效。");
    manifest.cameras = value.cameras.map((item) => {
      if (!isRecord(item) || typeof item.name !== "string" || !item.name || item.name.length > 256 ||
        typeof item.projection !== "string" || !item.projection || item.projection.length > 32) {
        throw new Error("manifest 相机信息无效。");
      }
      return { name: item.name, projection: item.projection };
    });
  }
  if (Object.hasOwn(value, "materials")) {
    if (!isStringArray(value.materials, 2_000)) throw new Error("manifest 材质列表无效。");
    manifest.materials = [...value.materials];
  }
  if (Object.hasOwn(value, "export")) {
    if (!isRecord(value.export)) throw new Error("manifest 导出信息无效。");
    const exported: CloudManifest["export"] = {};
    if (Object.hasOwn(value.export, "glbBytes")) {
      if (!isNonNegativeFiniteNumber(value.export.glbBytes)) throw new Error("manifest GLB 大小无效。");
      exported.glbBytes = value.export.glbBytes;
    }
    if (Object.hasOwn(value.export, "objectCount")) {
      if (!isNonNegativeFiniteNumber(value.export.objectCount)) throw new Error("manifest 对象数量无效。");
      exported.objectCount = value.export.objectCount;
    }
    if (Object.keys(exported).length > 0) manifest.export = exported;
  }
  return manifest;
}

function sanitizeCloudObject(value: unknown) {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name || value.name.length > 256 ||
    typeof value.type !== "string" || !value.type || value.type.length > 64 || !isStringArray(value.collections, 2_000)) {
    throw new Error("manifest 对象列表无效。");
  }
  return { name: value.name, type: value.type, collections: [...value.collections] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every((item) =>
    typeof item === "string" && item.length <= 256);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

async function sha256Hex(value: Uint8Array) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("当前浏览器不支持 SHA-256 上传校验。");
  const bytes = Uint8Array.from(value);
  const digest = await subtle.digest("SHA-256", bytes.buffer);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => null) as ErrorBody | null;
  return new Error(body?.error ?? "BlendProof API 请求失败。");
}

function trimOrigin(value: string | undefined) {
  return value?.replace(/\/$/, "") ?? "";
}

function withOrigin(origin: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${origin}${path}`;
}

function localApiPath(path: string) {
  return path.replace(/^\/api(?=\/|$)/, "/api/local");
}

export const blendProofClient = new BlendProofClient({
  workerOrigin: import.meta.env?.VITE_WORKER_API_ORIGIN,
  bridgeOrigin: import.meta.env?.VITE_LOCAL_BRIDGE_ORIGIN,
  bridgePairingCode: import.meta.env?.VITE_LOCAL_BRIDGE_PAIRING_CODE,
});
