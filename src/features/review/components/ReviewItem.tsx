/**
 * 单条批注在右侧列表中的一行。
 *
 * 展示正文、锚点、作者、相对时间、回复数与解决状态；按权限显示
 * 「解决/重开」与「删除」。重活（编辑、回复）由外层容器承担。
 */

import { Check, CornerDownRight, RotateCcw, Trash2 } from "lucide-react";
import { t, tf } from "../../../i18n";
import { formatRelativeTime } from "../../../utils";
import type { ReviewComment } from "../types";

export function ReviewItem({
  comment,
  index,
  selected,
  canModerate,
  canDelete,
  busy,
  onSelect,
  onToggleStatus,
  onDelete,
}: {
  comment: ReviewComment;
  index: number;
  selected: boolean;
  /** 审稿方裁决（open/resolved）与正文编辑只属创建者。 */
  canModerate: boolean;
  /** 访客只能删除自己创建的内容，因此由外层判定。 */
  canDelete: boolean;
  busy: boolean;
  onSelect: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const resolved = comment.status === "resolved";
  return (
    <div
      data-testid="review-item"
      data-comment-id={comment.id}
      data-resolved={resolved}
      className={`review-item ${selected ? "selected" : ""} ${resolved ? "resolved" : ""}`}
    >
      <i>{index}</i>
      <button className="review-item-main" onClick={onSelect}>
        <strong>{comment.body}</strong>
        <small>
          {comment.objectName ?? t("模型表面")}
          <span> · </span>
          {comment.authorName}
          {comment.authorType === "guest" && <em className="review-author-badge">{t("客户")}</em>}
          <span> · </span>
          <time dateTime={comment.createdAt}>{formatRelativeTime(comment.createdAt)}</time>
        </small>
        {(comment.replies.length > 0 || resolved) && (
          <small className="review-item-tags">
            {resolved && <span className="review-tag">{t("已解决")}</span>}
            {comment.replies.length > 0 && (
              <span className="review-tag">
                <CornerDownRight size={10} />
                {tf("%s 条回复", comment.replies.length)}
              </span>
            )}
          </small>
        )}
      </button>
      {canModerate && (
        <button
          className="review-status"
          disabled={busy}
          onClick={onToggleStatus}
          aria-label={resolved ? t("重新打开这条批注") : t("标记为已解决")}
          title={resolved ? t("重新打开这条批注") : t("标记为已解决")}
        >
          {resolved ? <RotateCcw size={11} /> : <Check size={11} />}
        </button>
      )}
      {canDelete && (
        <button
          className="review-delete"
          disabled={busy}
          onClick={onDelete}
          aria-label={tf("删除第 %s 条批注", index)}
          title={t("删除这条批注")}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}
