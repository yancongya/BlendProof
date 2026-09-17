/**
 * 审稿域的数据访问层。
 *
 * 屏蔽本地 SQLite 与云端 D1 的差异，对上层只暴露批注与回复的读写。
 * 接口契约见 docs/REVIEW_CONTRACT.md。
 *
 * 两条通道（local / cloud）必须行为一致：同一能力在两处都要实现，
 * 否则会出现"本地能删、线上不能删"这类分叉。
 */

import {
  blendProofClient,
  type ProjectTransport,
} from "../../../api/blendProofClient";
import { rememberDeleteToken } from "../deleteTokens";
import type {
  ReviewComment,
  ReviewCommentDraft,
  ReviewCommentPatch,
  ReviewReply,
  ReviewReplyDraft,
} from "../types";

export const reviewRepository = {
  // --- 创建者通道（凭 owner capability） ---

  async list(
    projectId: string,
    ownerCapability: string,
    transport: ProjectTransport = "local",
  ): Promise<ReviewComment[]> {
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

  async remove(
    projectId: string,
    ownerCapability: string,
    commentId: string,
    transport: ProjectTransport = "local",
  ): Promise<void> {
    await blendProofClient.deleteOwnerComment(projectId, ownerCapability, commentId, transport);
  },

  async reply(
    projectId: string,
    ownerCapability: string,
    commentId: string,
    draft: ReviewReplyDraft,
    transport: ProjectTransport = "local",
  ): Promise<ReviewReply> {
    return blendProofClient.createOwnerReply(projectId, ownerCapability, commentId, draft, transport);
  },

  async removeReply(
    projectId: string,
    ownerCapability: string,
    commentId: string,
    replyId: string,
    transport: ProjectTransport = "local",
  ): Promise<void> {
    await blendProofClient.deleteOwnerReply(projectId, ownerCapability, commentId, replyId, transport);
  },

  // --- 访客通道（凭分享访问 cookie + 删除令牌） ---

  /**
   * 访客侧列表/轮询。只取批注，不走 loadShare —— 后者每次都带完整 manifest。
   */
  async listGuest(token: string, transport: ProjectTransport = "local"): Promise<ReviewComment[]> {
    return blendProofClient.listGuestComments(token, transport);
  },

  /**
   * 创建访客评论。服务端只在此返回一次删除令牌，这里立即存到本地，
   * 供之后删除自己发的内容；返回评论本身给调用方渲染。
   */
  async createGuest(
    token: string,
    draft: ReviewCommentDraft,
    transport: ProjectTransport = "local",
  ): Promise<ReviewComment> {
    const { comment, deleteToken } = await blendProofClient.createGuestComment(token, draft, transport);
    if (deleteToken) rememberDeleteToken(comment.id, deleteToken);
    return comment;
  },

  async replyGuest(
    token: string,
    commentId: string,
    draft: ReviewReplyDraft,
    transport: ProjectTransport = "local",
  ): Promise<ReviewReply> {
    const { reply, deleteToken } = await blendProofClient.createGuestReply(token, commentId, draft, transport);
    if (deleteToken) rememberDeleteToken(reply.id, deleteToken);
    return reply;
  },

  async removeGuest(
    token: string,
    commentId: string,
    deleteToken: string,
    transport: ProjectTransport = "local",
  ): Promise<void> {
    await blendProofClient.deleteGuestComment(token, commentId, deleteToken, transport);
  },

  async removeGuestReply(
    token: string,
    commentId: string,
    replyId: string,
    deleteToken: string,
    transport: ProjectTransport = "local",
  ): Promise<void> {
    await blendProofClient.deleteGuestReply(token, commentId, replyId, deleteToken, transport);
  },
};
