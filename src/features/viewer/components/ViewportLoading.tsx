/**
 * 模型加载进度（B1）。
 *
 * 原实现是 `<Suspense fallback={null}>`：慢网或大模型下视口一片空白，
 * 客户会以为链接坏了而直接关掉。这里用 drei 的 useProgress（zain 的全局
 * 状态，可在 Canvas 外读取）显示进度。
 */

import { useProgress } from "@react-three/drei";
import { t } from "../../../i18n";

export function ViewportLoading({ hint }: { hint?: string }) {
  const { active, progress } = useProgress();
  if (!active) return null;
  const percent = Math.round(progress);
  return (
    <div
      className="viewport-loading"
      role="status"
      aria-live="polite"
      data-testid="viewport-loading"
    >
      <div className="viewport-loading-track">
        <span style={{ width: `${Math.max(6, Math.min(100, progress))}%` }} />
      </div>
      <p>{t("正在加载模型")} {percent}%</p>
      {hint && <small>{hint}</small>}
    </div>
  );
}
