import type {
  CommentPatch,
  CreateShareInput,
  CreatedShare,
  ProjectRecord,
  ProjectRegistration,
  RegisterProjectInput,
  ReviewComment,
  ReviewCommentDraft,
  ShareRecord,
} from './db.js'

export type PublicProjectAsset = 'model.glb' | 'manifest.json' | 'thumbnail.webp'

export type StoredAsset = {
  body: ReadableStream<Uint8Array>
  contentType: string
  size: number
  etag?: string
}

/** Storage contract shared by the filesystem adapter and the future R2 adapter. */
export interface ProjectStorage {
  has(projectId: string, asset: PublicProjectAsset): Promise<boolean>
  get(projectId: string, asset: PublicProjectAsset): Promise<StoredAsset | null>
  put(
    projectId: string,
    asset: PublicProjectAsset,
    body: ReadableStream<Uint8Array> | Uint8Array | string,
    contentType: string,
  ): Promise<void>
  deleteProject(projectId: string): Promise<void>
}

/** Metadata contract implemented locally by SQLite and in the cloud by D1. */
export interface ReviewDatabase {
  registerProject(input: RegisterProjectInput): Promise<ProjectRegistration>
  getProject(projectId: string): Promise<ProjectRecord | null>
  verifyOwnerCapability(projectId: string, capability: string): Promise<boolean>
  listComments(projectId: string): Promise<ReviewComment[]>
  createComment(projectId: string, draft: ReviewCommentDraft): Promise<ReviewComment>
  updateComment(projectId: string, commentId: string, patch: CommentPatch): Promise<ReviewComment | null>
  createShare(projectId: string, input?: CreateShareInput): Promise<CreatedShare>
  findShare(token: string): Promise<ShareRecord | null>
  findShareById(shareId: string): Promise<ShareRecord | null>
  verifySharePassword(token: string, password: string): Promise<boolean>
  revokeShare(projectId: string, shareId: string): Promise<ShareRecord | null>
}

export type ShareAccessDecision =
  | { status: 'allowed'; share: ShareRecord }
  | { status: 'missing' | 'revoked' | 'expired' | 'password_required' }

/** Access policy remains HTTP-framework agnostic for Express and Workers. */
export interface ShareAccess {
  resolve(token: string, cookieHeader?: string, enforcePassword?: boolean): Promise<ShareAccessDecision>
  verifyPassword(token: string, password: string): Promise<boolean>
  createCookie(token: string, maxAgeSeconds?: number): Promise<string>
}
