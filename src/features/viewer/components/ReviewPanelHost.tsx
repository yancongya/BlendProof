/**
 * 审稿批注面板的外壳：状态筛选 + 计数 + 挂载批注列表。
 *
 * 这里只做「面板」这一层（折叠、筛选、计数），批注本身的渲染与交互
 * 仍归 review 域。查看器因此不需要了解批注的数据结构。
 *
 * `canDelete` / `onDeleteComment` 之类由外层页面决定 —— 谁能删依赖
 * 凭据与本地令牌，不属于视图层判断。
 */

import { MessageSquarePlus } from "lucide-react";
import { t, tf } from "../../../i18n";
import { ReviewPanel, type ReviewComment } from "../../../features/review";

const FILTERS = [
  ["all", "⬡", "全部"],
  ["open", "●", "待处理"],
  ["resolved", "✓", "已解决"],
] as const;

export function ReviewPanelHost({
  collapsed,
  comments,
  newCount,
  filter,
  selectedId,
  commentBody,
  readOnly,
  canComment,
  message,
  busy,
  canDelete,
  onToggleCollapse,
  onFilterChange,
  onAcknowledgeNew,
  onBody,
  onSelect,
  onSave,
  onCancelDraft,
  onToggleStatus,
  onEdit,
  onDeleteComment,
  onReply,
  onDeleteReply,
}: {
  collapsed: boolean;
  comments: ReviewComment[];
  newCount: number;
  filter: "all" | "open" | "resolved";
  selectedId: string | null;
  commentBody: string;
  readOnly: boolean;
  canComment: boolean;
  message: string | null;
  busy: boolean;
  canDelete: (id: string) => boolean;
  onToggleCollapse: () => void;
  onFilterChange: (filter: "all" | "open" | "resolved") => void;
  onAcknowledgeNew: () => void;
  onBody: (body: string) => void;
  onSelect: (id: string) => void;
  onSave: () => void;
  onCancelDraft: () => void;
  onToggleStatus: (comment: ReviewComment) => void;
  onEdit: (comment: ReviewComment, body: string) => void;
  onDeleteComment: (comment: ReviewComment) => void;
  onReply: (commentId: string, body: string) => void;
  onDeleteReply: (commentId: string, replyId: string) => void;
}) {
  return (
    <section
      className={`panel review-panel-section ${collapsed ? "collapsed" : ""}`}
      style={{ flex: 1, minHeight: collapsed ? 28 : 80 }}
    >
      <div className="panel-header">
        <button
          type="button"
          className="panel-toggle"
          onClick={onToggleCollapse}
          title={t("折叠/展开审稿批注")}
        >
          <span className="panel-icon">
            <MessageSquarePlus size={13} />
          </span>
          <span>{t("审稿批注")}</span>
          <b data-testid="review-count">
            {comments.length}
            {newCount > 0 ? tf(" · 新 %s", newCount) : ""}
          </b>
        </button>
        <div className="review-filters" aria-label={t("批注状态筛选")}>
          {FILTERS.map(([value, icon, label]) => (
            <button
              key={value}
              type="button"
              title={t(label)}
              className={filter === value ? "active" : ""}
              onClick={() => onFilterChange(value)}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-body">
        <ReviewPanel
          comments={comments}
          newCount={newCount}
          onAcknowledgeNew={onAcknowledgeNew}
          selectedId={selectedId}
          pending={null}
          body={commentBody}
          readOnly={readOnly}
          canComment={canComment}
          // 错误优先于成功文案：否则保存成功一次后，后续错误永远看不见。
          message={message}
          busy={busy}
          canDelete={canDelete}
          onBody={onBody}
          onSelect={onSelect}
          onSave={onSave}
          onCancel={onCancelDraft}
          onToggleStatus={onToggleStatus}
          onEdit={onEdit}
          onDeleteComment={onDeleteComment}
          onReply={onReply}
          onDeleteReply={onDeleteReply}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          hideTitle
        />
      </div>
    </section>
  );
}
