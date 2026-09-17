/**
 * 属性面板：显示当前选中对象的名称与所属集合。
 *
 * 目前是只读展示。保留独立文件是为了让「选中对象 → 属性」这条链
 * 有明确归属，后续要加可编辑属性时有地方落。
 */

import { SlidersHorizontal } from "lucide-react";
import { t } from "../../../i18n";
import type { Manifest } from "../../../types";

export function PropertyInspector({
  collapsed,
  height,
  active,
  onToggleCollapse,
}: {
  collapsed: boolean;
  height: number;
  active: Manifest["objects"][number] | undefined;
  onToggleCollapse: () => void;
}) {
  return (
    <section
      className={`panel properties-panel ${collapsed ? "collapsed" : ""}`}
      // 只依赖传入的 height：「转换内容」已是独立面板，
      // 把它算进来会让拖转换内容的把手连带撑高本面板。
      style={{ height: collapsed ? 28 : height + 28 }}
    >
      <div className="panel-header">
        <button
          type="button"
          className="panel-toggle"
          onClick={onToggleCollapse}
          title={t("折叠/展开属性")}
        >
          <span className="panel-icon">
            <SlidersHorizontal size={13} />
          </span>
          <span>{t("属性")}</span>
        </button>
      </div>
      <div className="panel-body">
        {active && (
          <div className="property-body" style={{ height }}>
            <p className="property-kicker">{active.type}</p>
            <label>
              {t("对象名称")}
              <input value={active.name} readOnly />
            </label>
            <label>
              {t("集合")}
              <input value={active.collections.join(", ") || "Scene Collection"} readOnly />
            </label>
          </div>
        )}
      </div>
    </section>
  );
}
