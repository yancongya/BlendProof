/**
 * 视图域的小图标。
 *
 * 从 BlenderWorkspace 抽出：它们只服务于文件菜单的最近项目列表，
 * 混在 1400 行的组件里会让「菜单项用什么图标」这件小事也难以定位。
 */

import { Box, History, Trash2 } from "lucide-react";

export function FileIcon() {
  return (
    <span className="start-file-icon">
      <Box size={15} />
    </span>
  );
}

export function ClockIcon() {
  return <History size={14} />;
}

export function TrashIcon() {
  return <Trash2 size={14} />;
}
