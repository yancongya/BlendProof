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
  registerProject(input: RegisterProjectInput): ProjectRegistration | Promise<ProjectRegistration>
  getProject(projectId: string): ProjectRecord | null | Promise<ProjectRecord | null>
  verifyOwnerCapability(projectId: string, capability: string): boolean | Promise<boolean>
  listComments(projectId: string): ReviewComment[] | Promise<ReviewComment[]>
  createComment(projectId: string, draft: ReviewCommentDraft): ReviewComment | Promise<ReviewComment>
  updateComment(projectId: string, commentId: string, patch: CommentPatch): ReviewComment | null | Promise<ReviewComment | null>
  createShare(projectId: string, input?: CreateShareInput): CreatedShare | Promise<CreatedShare>
  findShare(token: string): ShareRecord | null | Promise<ShareRecord | null>
  findShareById(shareId: string): ShareRecord | null | Promise<ShareRecord | null>
  verifySharePassword(token: string, password: string): Promise<boolean>
  revokeShare(projectId: string, shareId: string): ShareRecord | null | Promise<ShareRecord | null>
  isShareExpired(share: ShareRecord, now?: Date): boolean
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
