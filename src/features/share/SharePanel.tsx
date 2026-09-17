/**
 * 创建者侧的「分享设置」面板（密码/有效期/权限/分享链接/撤销）。
 *
 * 从 WorkspacePage 抽出：「分享设置表单 + 分享链接展示 + 撤销按钮」
 * 这组 UI 不应与上传/转换/项目加载混在一起。抽出后更容易改表单布局
 * 或独立于工作台复用。
 */

import { Share2 } from "lucide-react";
import { SenderShareCard } from "../../components/ShareCards";

const DEMO_SHARE_URL = "/s/suzanne";
const DEMO_SHARE_PASSWORD = "tycon";

export type SharePanelProps = {
  // 项目是否存在
  hasProject: boolean;
  // 分享表单状态
  sharePassword: string;
  shareHours: string;
  sharePermission: "read_only" | "comment";
  // 分享结果
  shareUrl: string | null;
  shareExpiresAt: string | null;
  shareId: string | null;
  // 可见性
  isOpen: boolean;
  // 回调
  onToggle: () => void;
  onBackdropClick: () => void;
  onPasswordChange: (v: string) => void;
  onHoursChange: (v: string) => void;
  onPermissionChange: (v: "read_only" | "comment") => void;
  onCreateShare: () => void;
  onRevokeShare: () => void;
  isCloud: boolean;
};

export function SharePanel({
  hasProject,
  sharePassword,
  shareHours,
  sharePermission,
  shareUrl,
  shareExpiresAt,
  shareId,
  isOpen,
  onToggle,
  onBackdropClick,
  onPasswordChange,
  onHoursChange,
  onPermissionChange,
  onCreateShare,
  onRevokeShare,
  isCloud,
}: SharePanelProps) {
  return (
    <div className="share-menu-wrap">
      <button
        type="button"
        className="menu-item share-trigger"
        data-guide="share-button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <Share2 size={13} /> 分享
      </button>
      {isOpen && (
        <>
          <div className="share-panel-backdrop" onClick={onBackdropClick} />
          <form
            className="share-panel"
            role="dialog"
            aria-label="分享设置"
            onSubmit={(event) => {
              event.preventDefault();
              onCreateShare();
            }}
          >
            {!hasProject ? (
              <>
                <div className="share-panel-title">
                  <Share2 size={14} /> 管理员公开示例
                </div>
                <p className="demo-share-note">
                  Suzanne 由平台管理员长期公开，不占用用户空间，也不会随普通项目自动清理。
                </p>
                <SenderShareCard
                  url={DEMO_SHARE_URL}
                  expiresAt={null}
                  permission="read_only"
                  protectedByPassword
                />
                <p className="demo-share-password">
                  访问密码 <code>{DEMO_SHARE_PASSWORD}</code>
                </p>
              </>
            ) : (
              <>
                <div className="share-panel-title">
                  <Share2 size={14} /> 分享当前项目
                </div>
                <label className="share-setting">
                  <span>密码</span>
                  <input
                    aria-label="分享密码"
                    type="password"
                    value={sharePassword}
                    placeholder="可选"
                    onChange={(event) => onPasswordChange(event.target.value)}
                  />
                </label>
                <label className="share-setting">
                  <span>有效期</span>
                  <select
                    aria-label="分享有效期"
                    value={shareHours}
                    onChange={(event) => onHoursChange(event.target.value)}
                  >
                    <option value="6">6 小时</option>
                    <option value="24">24 小时（推荐）</option>
                    <option value="48">48 小时（最长）</option>
                  </select>
                </label>
                <label className="share-setting">
                  <span>权限</span>
                  <select
                    aria-label="分享评论权限"
                    value={sharePermission}
                    onChange={(event) =>
                      onPermissionChange(event.target.value as "read_only" | "comment")
                    }
                  >
                    <option value="read_only">只读</option>
                    <option value="comment">可评论</option>
                  </select>
                </label>
                <button type="submit" className="share-panel-primary">
                  <Share2 size={13} /> {isCloud ? "创建云端分享" : "创建本地分享"}
                </button>
                {shareUrl && (
                  <SenderShareCard
                    url={shareUrl}
                    expiresAt={shareExpiresAt}
                    permission={sharePermission}
                    protectedByPassword={Boolean(sharePassword)}
                  />
                )}
                {shareId && (
                  <button
                    type="button"
                    className="share-panel-revoke"
                    onClick={onRevokeShare}
                  >
                    撤销分享
                  </button>
                )}
              </>
            )}
          </form>
        </>
      )}
    </div>
  );
}
