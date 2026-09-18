/**
 * 视图域唯一出口。
 *
 * 外部（pages/ 与迁移期的 legacy 目录）只能从这里引用，禁止深引用内部路径。
 * 详见 docs/ARCHITECTURE_RULES.md。
 */

import "./viewer.css";

export { Model } from "./components/Model";
export { AnnotationHoverMarker } from "./components/AnnotationHoverMarker";
export { BoxSelectionController } from "./components/BoxSelectionController";
export { BlenderViewControls } from "./components/ViewControls";
export { BlenderViewportGrid } from "./components/ViewportGrid";
export { PanelResizeHandle } from "./components/PanelResizeHandle";
export { ClockIcon, FileIcon, TrashIcon } from "./components/ViewerIcons";
export { ViewerMenubar } from "./components/ViewerMenubar";
export { ViewerStatusbar } from "./components/ViewerStatusbar";
export { ObjectOutliner } from "./components/ObjectOutliner";
export { PropertyInspector } from "./components/PropertyInspector";
export { ConversionPanel } from "./components/ConversionPanel";
export { UploaderDialog } from "./components/UploaderDialog";
export { ViewportLoading } from "./components/ViewportLoading";
export { ViewportErrorBoundary } from "./components/ViewportErrorBoundary";
export { DecorativeBoundary } from "./components/DecorativeBoundary";
export { CLIENT_GUIDE_STEPS, VIEWER_GUIDE_STEPS } from "./viewerGuide";
export { clearModelCache } from "./meshCache";
