/**
 * 顶部菜单栏：品牌、文件菜单、项目名与分享状态、右侧插槽。
 *
 * 从 BlenderWorkspace 抽出。顺带消掉了分享状态文案的四处重复——
 * aria-label 与 title 各写两遍、内容几乎相同，改一处很容易漏掉另一处。
 */

import { ChevronDown, FolderOpen, Share2 } from "lucide-react";
import type { ReactNode } from "react";
import { BlenderLogo } from "../../../components/BlenderLogo";
import { MenubarActions } from "../../../components/TopActions";
import { t, tf } from "../../../i18n";
import { formatShareExpiry } from "../../../utils";
import type { ActiveShareStatus, Project } from "../../../types";
import { FileIcon } from "./ViewerIcons";

/** 分享状态的一句话描述。分隔符不同，其余完全一致。 */
function shareStatusText(status: ActiveShareStatus, separator: string) {
  const permission = status.permission === "comment" ? t("可评论") : t("只读");
  const expiry = formatShareExpiry(status.expiresAt);
  return status.expiresAt
    ? tf(`已分享${separator}%s${separator}%s到期`, permission, expiry)
    : tf(`已分享${separator}%s${separator}%s`, permission, expiry);
}

export function ViewerMenubar({
  title,
  shareStatus,
  fileMenuOpen,
  showFileMenu,
  recentProjects,
  children,
  onHome,
  onOpenFileMenu,
  onOpenUploader,
  onProjectSelect,
  onDeleteProject,
  onToggleFileMenu,
  onOpenGuide,
}: {
  title: string;
  shareStatus?: ActiveShareStatus | null;
  fileMenuOpen: boolean;
  /** 只有带上传能力时才渲染文件菜单（分享页没有）。 */
  showFileMenu: boolean;
  recentProjects: Project[];
  children?: ReactNode;
  onHome?: () => void;
  onOpenFileMenu?: () => void;
  onOpenUploader?: () => void;
  onProjectSelect?: (project: Project) => void;
  onDeleteProject?: () => void;
  onToggleFileMenu: (open: boolean) => void;
  onOpenGuide: () => void;
}) {
  return (
    <header className="blender-menubar">
      <button
        type="button"
        className="brand-mark"
        aria-label={t("返回 BlendProof 启动页")}
        onClick={onHome}
      >
        <BlenderLogo />
        <span>BlendProof</span>
      </button>
      {showFileMenu && (
        <div className="file-menu-wrap">
          <button
            type="button"
            className="menu-item file-menu-trigger"
            data-guide="file-menu"
            data-testid="open-uploader"
            aria-haspopup="menu"
            aria-expanded={fileMenuOpen}
            title={t("文件菜单")}
            onClick={() => {
              if (!fileMenuOpen) onOpenFileMenu?.();
              onToggleFileMenu(!fileMenuOpen);
            }}
          >
            <FolderOpen size={13} /> {t("文件")} <ChevronDown size={11} />
          </button>
          {fileMenuOpen && (
            <div className="file-menu" role="menu" aria-label={t("文件菜单")}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onToggleFileMenu(false);
                  onOpenUploader?.();
                }}
              >
                <FolderOpen size={14} /> {t("打开上传工作台")}
              </button>
              <div className="file-menu-item-with-submenu">
                <button type="button" role="menuitem" aria-haspopup="menu">
                  <ChevronDown size={14} /> {t("最近项目")}{" "}
                  <span className="submenu-arrow">›</span>
                </button>
                <div className="file-recent-submenu" role="menu" aria-label={t("最近项目")}>
                  {recentProjects.length ? (
                    recentProjects.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onToggleFileMenu(false);
                          onProjectSelect?.(item);
                        }}
                      >
                        <FileIcon /> <span>{item.name}</span>
                      </button>
                    ))
                  ) : (
                    <p>{t("暂无最近项目")}</p>
                  )}
                </div>
              </div>
              <div className="file-menu-separator" />
              <button
                type="button"
                role="menuitem"
                disabled={!onDeleteProject}
                onClick={() => {
                  onToggleFileMenu(false);
                  onDeleteProject?.();
                }}
              >
                <span style={{ display: "contents" }}>🗑</span> {t("删除当前本地项目")}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="project-name">
        <span>{title}</span>
        {shareStatus && (
          <span
            className="project-share-status"
            role="status"
            aria-label={shareStatusText(shareStatus, "，")}
            title={shareStatusText(shareStatus, " · ")}
          >
            <Share2 size={11} strokeWidth={2.2} />
          </span>
        )}
        <button
          type="button"
          className="guide-trigger"
          title={t("打开操作指南")}
          onClick={onOpenGuide}
        >
          ?
        </button>
      </div>
      <div className="header-actions">
        {children ?? <span>{t("只读审稿")}</span>}
        <MenubarActions />
      </div>
    </header>
  );
}
