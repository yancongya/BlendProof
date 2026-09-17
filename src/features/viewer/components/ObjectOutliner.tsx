import { Box, Camera, Eye, Focus, Layers, Lightbulb, Search, X } from "lucide-react";
import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { t, tf } from "../../../i18n";
import type { Manifest } from "../../../types";

export function ObjectOutliner({
  collapsed,
  height,
  query,
  manifest,
  objects,
  selected,
  hidden,
  readOnly,
  isolated,
  onToggleCollapse,
  onQueryChange,
  onSelect,
  onToggle,
  onIsolate,
  onFocus,
}: {
  collapsed: boolean;
  height: number;
  query: string;
  manifest: Manifest | null;
  objects: Manifest["objects"];
  selected: Set<string>;
  hidden: Set<string>;
  readOnly: boolean;
  isolated: boolean;
  onToggleCollapse: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (name: string) => void;
  onToggle: (name: string) => void;
  onIsolate: (name: string) => void;
  onFocus: () => void;
}) {
  const isIsolated = (name: string) =>
    isolated && selected.size === 1 && selected.has(name);

  const parentRef = useRef<HTMLDivElement>(null);
  
  const rowVirtualizer = useVirtualizer({
    count: objects.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
  });

  return (
    <section
      className={`panel outliner-panel \${collapsed ? "collapsed" : ""}`}
      data-guide="outliner"
      style={{ height: collapsed ? 28 : height }}
    >
      <div className="panel-header">
        <button
          type="button"
          className="panel-toggle"
          onClick={onToggleCollapse}
          title={t("折叠/展开")}
        >
          <span className="panel-icon">
            <Layers size={13} />
          </span>
          <span>{t("场景集合")}</span>
        </button>
        <button
          type="button"
          className="outliner-focus"
          disabled={selected.size === 0}
          title={t("聚焦选中对象（小键盘 .）")}
          aria-label={t("聚焦选中对象")}
          onClick={onFocus}
        >
          <Focus size={12} />
        </button>
      </div>
      <div className="panel-body">
        <label className="outliner-search">
          <Search size={12} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("搜索对象")}
            aria-label={t("搜索场景对象")}
          />
          {query && (
            <button type="button" aria-label={t("清除对象搜索")} onClick={() => onQueryChange("")}>
              <X size={11} />
            </button>
          )}
        </label>
        <div className="tree-root">
          <span>⌄</span>
          <strong>{manifest?.scene ?? "Scene Collection"}</strong>
        </div>
        <div 
          className="tree-children" 
          ref={parentRef} 
          style={{ 
            height: height - 78 > 0 ? height - 78 : 0, 
            overflowY: "auto" 
          }}
        >
          <div style={{ height: `\${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const object = objects[virtualItem.index];
            return (
            <div
              className={`tree-row \${selected.has(object.name) ? "selected" : ""}`}
              key={virtualItem.key}
              role="treeitem"
              tabIndex={0}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `\${virtualItem.size}px`,
                transform: `translateY(\${virtualItem.start}px)`
              }}
              aria-selected={selected.has(object.name)}
              onClick={() => onSelect(object.name)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(object.name);
                }
              }}
            >
              <span className="tree-icon">
                {object.type === "CAMERA" ? (
                  <Camera />
                ) : object.type === "LIGHT" ? (
                  <Lightbulb />
                ) : (
                  <Box />
                )}
              </span>
              <span>{object.name}</span>
              <button
                type="button"
                aria-label={tf(hidden.has(object.name) ? "显示 %s" : "隐藏 %s", object.name)}
                className="eye"
                disabled={readOnly}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle(object.name);
                }}
              >
                <Eye className={hidden.has(object.name) ? "muted-eye" : ""} />
              </button>
              <button
                type="button"
                className={`isolate \${isIsolated(object.name) ? "active" : ""}`}
                aria-label={
                  isIsolated(object.name)
                    ? tf("退出 %s 的独显", object.name)
                    : tf("独显 %s", object.name)
                }
                title={isIsolated(object.name) ? t("退出独显") : t("独显此对象")}
                onClick={(event) => {
                  event.stopPropagation();
                  onIsolate(object.name);
                }}
              >
                <Focus />
              </button>
            </div>
            );
          })}
          </div>
          {manifest && objects.length === 0 && (
            <p className="outliner-empty">{t("没有匹配对象")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
