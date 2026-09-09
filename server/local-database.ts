import type {
  CommentPatch,
  CreateShareInput,
  RegisterProjectInput,
  ReviewCommentDraft,
} from './db.js'
import { BlendProofRepository } from './db.js'
import type { ReviewDatabase } from './contracts.js'

/** Async facade keeps Express on the same contract that D1 will implement. */
export class LocalReviewDatabase implements ReviewDatabase {
  constructor(readonly repository: BlendProofRepository) {}

  async registerProject(input: RegisterProjectInput) { return this.repository.registerProject(input) }
  async getProject(projectId: string) { return this.repository.getProject(projectId) }
  async verifyOwnerCapability(projectId: string, capability: string) {
    return this.repository.verifyOwnerCapability(projectId, capability)
  }
  async listComments(projectId: string) { return this.repository.listComments(projectId) }
  async createComment(projectId: string, draft: ReviewCommentDraft) {
    return this.repository.createComment(projectId, draft)
  }
  async updateComment(projectId: string, commentId: string, patch: CommentPatch) {
    return this.repository.updateComment(projectId, commentId, patch)
  }
  async createShare(projectId: string, input?: CreateShareInput) {
    return this.repository.createShare(projectId, input)
  }
  async findShare(token: string) { return this.repository.findShare(token) }
  async findShareById(shareId: string) { return this.repository.findShareById(shareId) }
  async verifySharePassword(token: string, password: string) {
    return this.repository.verifySharePassword(token, password)
  }
  async revokeShare(projectId: string, shareId: string) {
    return this.repository.revokeShare(projectId, shareId)
  }
}

export function isShareExpired(expiresAt: string | null, now = new Date()) {
  return expiresAt !== null && Date.parse(expiresAt) <= now.getTime()
}
