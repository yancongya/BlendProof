/**
 * 面板高度拖拽把手。
 *
 * 同时支持指针拖拽与键盘上下键（可访问性：仅用鼠标无法调整布局）。
 * 从 BlenderWorkspace 抽出，见 docs/ARCHITECTURE_RULES.md 的行数预算。
 */

import { useRef } from "react";

export function PanelResizeHandle({
  label,
  onDelta,
}: {
  label: string;
  onDelta: (delta: number) => void;
}) {
  const lastY = useRef(0);
  return (
    <div
      className="panel-resize-handle"
      role="separator"
      aria-label={label}
      aria-orientation="horizontal"
      tabIndex={0}
      onPointerDown={(event) => {
        lastY.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const delta = event.clientY - lastY.current;
        if (delta === 0) return;
        lastY.current = event.clientY;
        onDelta(delta);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") onDelta(-12);
        if (event.key === "ArrowDown") onDelta(12);
      }}
    />
  );
}
