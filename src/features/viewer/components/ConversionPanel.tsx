/**
 * 「转换内容」面板：把 manifest 里的场景统计呈现给审阅者。
 *
 * 抽成独立文件的原因不只是行数：解析脚本（landing 的 Import/Convert）
 * 产出的字段含义集中在这里，改转换报告只需看这一处。
 */

import { FileText } from "lucide-react";
import { ConversionSummary } from "../../../components/ConversionSummary";
import { t } from "../../../i18n";
import type { Manifest } from "../../../types";

export function ConversionPanel({
  collapsed,
  height,
  manifest,
  onToggleCollapse,
}: {
  collapsed: boolean;
  height: number;
  manifest: Manifest | null;
  onToggleCollapse: () => void;
}) {
  return (
    <section
      className={`panel summary-panel ${collapsed ? "collapsed" : ""}`}
      style={{ height: collapsed ? 28 : height }}
    >
      <div className="panel-header">
        <button
          type="button"
          className="panel-toggle"
          onClick={onToggleCollapse}
          title={t("折叠/展开转换内容")}
        >
          <span className="panel-icon">
            <FileText size={13} />
          </span>
          <span>{t("转换内容")}</span>
        </button>
      </div>
      <div className="panel-body">
        <ConversionSummary manifest={manifest} />
      </div>
    </section>
  );
}
