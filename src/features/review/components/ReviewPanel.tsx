/**
 * 审稿批注面板：批注列表 + 落点草稿 + 选中批注的编辑与回复线程。
 *
 * 只负责呈现与本地输入态；权限判定、持久化与确认由外层页面承担，
 * 因为「谁能删」的规则依赖凭据与本地令牌，不属于展示层。
 */

import { MessageSquarePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t, tf } from "../../../i18n";
import { ReviewItem } from "./ReviewItem";
import { ReviewReplyThread } from "./ReviewReplyThread";
import type { PendingReview, ReviewComment } from "../types";

export function ReviewPanel({
  comments,
  newCount,
  onAcknowledgeNew,
  selectedId,
  pending,
  body,
  readOnly,
  canComment,
  message,
  busy,
  canDelete,
  onBody,
  onSelect,
  onSave,
  onCancel,
  onToggleStatus,
  onEdit,
  onDeleteComment,
  onReply,
  onDeleteReply,
  collapsed,
  onToggleCollapse,
  hideTitle,
}: {
  comments: ReviewComment[];
  newCount: number;
  onAcknowledgeNew: () => void;
  selectedId: string | null;
  pending: PendingReview | null;
  body: string;
  readOnly: boolean;
  canComment: boolean;
  message: string | null;
  busy: boolean;
  /** 当前用户是否有权删除该 id（批注或回复）。 */
  canDelete: (id: string) => boolean;
  onBody: (body: string) => void;
  onSelect: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onToggleStatus: (comment: ReviewComment) => void;
  onEdit: (comment: ReviewComment, body: string) => void;
  onDeleteComment: (comment: ReviewComment) => void;
  onReply: (commentId: string, body: string) => void;
  onDeleteReply: (commentId: string, replyId: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  hideTitle?: boolean;
}) {
  const selectedComment = comments.find((comment) => comment.id === selectedId);
  const [editBody, setEditBody] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditBody(selectedComment?.body ?? "");
  }, [selectedComment]);

  // 选中批注后把它滚进视野。没有这一步，右上角的「收到新批注，点击查看」
  // 就只是清了个计数，用户仍然找不到那条内容。
  useEffect(() => {
    if (!selectedId) return;
    const node = listRef.current?.querySelector(`[data-comment-id="${CSS.escape(selectedId)}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  const countLabel = `${comments.length}${newCount > 0 ? tf(" · 新 %s", newCount) : ""}`;

  return (
    <div
      className="review-panel"
      data-testid="review-panel"
      aria-label={t("审稿批注")}
      aria-readonly={readOnly}
    >
      {!hideTitle && (
        <div className="review-panel-title">
          {onToggleCollapse ? (
            <button type="button" className="panel-toggle" onClick={onToggleCollapse}>
              <span className="panel-icon">
                <MessageSquarePlus size={13} />
              </span>
              <span>{t("审稿批注")}</span>
              <b data-testid="review-count">{countLabel}</b>
            </button>
          ) : (
            <>
              <span className="panel-icon">
                <MessageSquarePlus size={13} />
              </span>
              <span>{t("审稿批注")}</span>
              <b data-testid="review-count">{countLabel}</b>
            </>
          )}
        </div>
      )}
      {newCount > 0 && (
        <button className="review-new-notice" onClick={onAcknowledgeNew}>
          {t("收到新批注，点击查看")}
        </button>
      )}
      {pending && canComment && (
        <div className="review-compose" data-testid="review-draft">
          <span>{tf("批注位置：%s", pending.objectName ?? t("模型表面"))}</span>
          <textarea
            aria-label={t("批注内容")}
            data-testid="review-body"
            autoFocus
            value={body}
            placeholder={t("输入需要修改或确认的内容")}
            onChange={(event) => onBody(event.target.value)}
          />
          <div>
            <button onClick={onCancel}>{t("取消")}</button>
            <button
              data-testid="review-save"
              className="primary"
              disabled={!body.trim() || busy}
              onClick={onSave}
            >
              {t("保存批注")}
            </button>
          </div>
        </div>
      )}
      {message && <p className="review-message">{message}</p>}
      {selectedComment && !pending && !readOnly && (
        <div className="review-compose review-edit">
          <span>{tf("编辑第 %s 条批注", comments.indexOf(selectedComment) + 1)}</span>
          <textarea
            aria-label={t("编辑批注内容")}
            value={editBody}
            onChange={(event) => setEditBody(event.target.value)}
          />
          <div>
            <button
              className="primary"
              disabled={busy || !editBody.trim() || editBody.trim() === selectedComment.body}
              onClick={() => onEdit(selectedComment, editBody)}
            >
              {t("保存修改")}
            </button>
          </div>
        </div>
      )}
      <div className="review-list" ref={listRef}>
        {comments.map((comment, index) => (
          <ReviewItem
            key={comment.id}
            comment={comment}
            index={index + 1}
            selected={selectedId === comment.id}
            canModerate={!readOnly}
            canDelete={!readOnly && canDelete(comment.id)}
            busy={busy}
            onSelect={() => onSelect(comment.id)}
            onToggleStatus={() => onToggleStatus(comment)}
            onDelete={() => onDeleteComment(comment)}
          />
        ))}
        {!pending && comments.length === 0 && (
          <p className="review-empty">
            {canComment ? t("还没有批注，点上方按钮在模型上添加") : t("暂无批注")}
          </p>
        )}
      </div>
      {selectedComment && (
        <ReviewReplyThread
          comment={selectedComment}
          canReply={canComment}
          canDeleteReply={(replyId) => !readOnly && canDelete(replyId)}
          busy={busy}
          onReply={(text) => onReply(selectedComment.id, text)}
          onDeleteReply={(replyId) => onDeleteReply(selectedComment.id, replyId)}
        />
      )}
    </div>
  );
}
