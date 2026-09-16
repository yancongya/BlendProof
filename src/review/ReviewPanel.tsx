/**
 * ReviewPanel — right-side panel that lists review annotations, supports
 * selecting, editing, and toggling the resolved/open status of comments.
 * Also shows a compose area when a pending annotation is being placed.
 */

import { useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { tf } from "../i18n";
import type { ReviewComment } from "../reviewRepository";
import type { PendingReview } from "../types";

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
  onBody,
  onSelect,
  onSave,
  onCancel,
  onToggleStatus,
  onEdit,
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
  onBody: (body: string) => void;
  onSelect: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onToggleStatus: (comment: ReviewComment) => void;
  onEdit: (comment: ReviewComment, body: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  hideTitle?: boolean;
}) {
  const selectedComment = comments.find((comment) => comment.id === selectedId);
  const [editBody, setEditBody] = useState("");
  useEffect(() => {
    setEditBody(selectedComment?.body ?? "");
  }, [selectedComment]);

  return (
    <div
      className="review-panel"
      data-testid="review-panel"
      aria-label="审稿批注"
      aria-readonly={readOnly}
    >
      {!hideTitle && (
        <div className="review-panel-title">
          {onToggleCollapse && (
            <button type="button" className="panel-toggle" onClick={onToggleCollapse}>
              <span className="panel-icon">
                <MessageSquarePlus size={13} />
              </span>
              <span>审稿批注</span>
              <b data-testid="review-count">
                {comments.length}
                {newCount > 0 ? tf(" · 新 %s", newCount) : ""}
              </b>
            </button>
          )}
          {!onToggleCollapse && (
            <>
              <span className="panel-icon">
                <MessageSquarePlus size={13} />
              </span>
              <span>审稿批注</span>
              <b data-testid="review-count">
                {comments.length}
                {newCount > 0 ? tf(" · 新 %s", newCount) : ""}
              </b>
            </>
          )}
        </div>
      )}
      {newCount > 0 && (
        <button className="review-new-notice" onClick={onAcknowledgeNew}>
          收到新批注，点击查看
        </button>
      )}
      {pending && canComment && (
        <div className="review-compose" data-testid="review-draft">
          <span>落点：{pending.objectName ?? "模型表面"}</span>
          <textarea
            aria-label="批注内容"
            data-testid="review-body"
            autoFocus
            value={body}
            placeholder="输入需要修改或确认的内容"
            onChange={(event) => onBody(event.target.value)}
          />
          <div>
            <button onClick={onCancel}>取消</button>
            <button
              data-testid="review-save"
              className="primary"
              disabled={!body.trim() || busy}
              onClick={onSave}
            >
              保存批注
            </button>
          </div>
        </div>
      )}
      {message && <p className="review-message">{message}</p>}
      {selectedComment && !pending && !readOnly && (
        <div className="review-compose review-edit">
          <span>编辑批注 #{comments.indexOf(selectedComment) + 1}</span>
          <textarea
            aria-label="编辑批注内容"
            value={editBody}
            onChange={(event) => setEditBody(event.target.value)}
          />
          <div>
            <button
              className="primary"
              disabled={
                busy ||
                !editBody.trim() ||
                editBody.trim() === selectedComment.body
              }
              onClick={() => onEdit(selectedComment, editBody)}
            >
              保存修改
            </button>
          </div>
        </div>
      )}
      <div className="review-list">
        {comments.map((comment, index) => (
          <div
            key={comment.id}
            data-testid="review-item"
            data-comment-id={comment.id}
            className={`review-item ${selectedId === comment.id ? "selected" : ""}`}
          >
            <i>{index + 1}</i>
            <button className="review-item-main" onClick={() => onSelect(comment.id)}>
              <strong>{comment.body}</strong>
              <small>
                {comment.objectName ?? "模型表面"} · {comment.authorName}
              </small>
            </button>
            {!readOnly && (
              <button
                className="review-status"
                disabled={busy}
                onClick={() => onToggleStatus(comment)}
              >
                {comment.status === "open" ? "解决" : "重开"}
              </button>
            )}
          </div>
        ))}
        {!pending && comments.length === 0 && (
          <p className="review-empty">暂无批注</p>
        )}
      </div>
    </div>
  );
}
