/**
 * 选中批注的回复线程：回复列表 + 回复输入框。
 *
 * 这是「审稿闭环」的落点——客户提问、创作者回复、双方各自看到对方的
 * 内容与时间，不需要再借微信或邮件往返。
 */

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { t, tf } from "../../../i18n";
import { formatRelativeTime } from "../../../utils";
import type { ReviewComment } from "../types";

export function ReviewReplyThread({
  comment,
  canReply,
  canDeleteReply,
  busy,
  onReply,
  onDeleteReply,
}: {
  comment: ReviewComment;
  canReply: boolean;
  /** 创建者可删除任意回复；访客只能删自己的（由外层算好传入）。 */
  canDeleteReply: (replyId: string) => boolean;
  busy: boolean;
  onReply: (body: string) => void;
  onDeleteReply: (replyId: string) => void;
}) {
  const storageKey = `blendproof-reply-draft:${comment.id}`;
  const [draft, setDraft] = useState(() => window.sessionStorage.getItem(storageKey) ?? "");

  // 切换批注时重新从缓存读取
  useEffect(() => {
    setDraft(window.sessionStorage.getItem(storageKey) ?? "");
  }, [storageKey]);

  const handleDraftChange = (val: string) => {
    setDraft(val);
    window.sessionStorage.setItem(storageKey, val);
  };

  const trimmed = draft.trim();

  return (
    <div className="review-thread" data-testid="review-thread">
      {comment.replies.length > 0 && (
        <ul className="review-reply-list">
          {comment.replies.map((reply) => (
            <li key={reply.id} data-testid="review-reply" data-reply-id={reply.id}>
              <div className="review-reply-head">
                <span>{reply.authorName}</span>
                {reply.authorType === "guest" && (
                  <em className="review-author-badge">{t("客户")}</em>
                )}
                <time dateTime={reply.createdAt}>{formatRelativeTime(reply.createdAt)}</time>
                {canDeleteReply(reply.id) && (
                  <button
                    className="review-delete"
                    disabled={busy}
                    onClick={() => onDeleteReply(reply.id)}
                    aria-label={t("删除这条回复")}
                    title={t("删除这条回复")}
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
              <p>{reply.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canReply && (
        <div className="review-reply-compose">
          <textarea
            aria-label={t("回复内容")}
            data-testid="review-reply-body"
            value={draft}
            placeholder={t("回复这条批注")}
            onChange={(event) => handleDraftChange(event.target.value)}
          />
          <button
            className="primary"
            data-testid="review-reply-save"
            disabled={busy || !trimmed}
            onClick={() => {
              onReply(trimmed);
              setDraft("");
              window.sessionStorage.removeItem(storageKey);
            }}
          >
            {t("回复")}
          </button>
        </div>
      )}
      {!canReply && comment.replies.length === 0 && (
        <p className="review-empty">{t("暂无回复")}</p>
      )}
    </div>
  );
}
