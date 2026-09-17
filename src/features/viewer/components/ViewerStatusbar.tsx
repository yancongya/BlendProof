/**
 * 底部状态栏：运行消息 + 当前视图模式。
 *
 * 从 BlenderWorkspace 抽出后，「用户在底部能看到什么」这件事
 * 不必在 1400 行里翻找。
 */

import { t } from "../../../i18n";

export function ViewerStatusbar({
  message,
  isolated,
  readOnly,
}: {
  message: string;
  isolated: boolean;
  readOnly: boolean;
}) {
  return (
    <footer className="blender-status">
      <span>{message}</span>
      <span>
        {isolated ? t("局部视图") : readOnly ? t("共享视图") : t("本地工程")} · BlendProof
      </span>
    </footer>
  );
}
