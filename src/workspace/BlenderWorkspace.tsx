/**
 * BlenderWorkspace — the main Viewer shell used by both the upload workspace
 * (App) and the share page (SharePage). Renders the Blender-style menubar,
 * 3D viewport (Canvas), Outliner, Properties, ConversionSummary, ReviewPanel,
 * and an optional Uploader modal slot.
 *
 * Extracted from App.tsx L1093–1954.
 */

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import {
  Box,
  Camera,
  Circle,
  Eye,
  FileText,
  Focus,
  Grid2X2,
  History,
  Layers,
  Lightbulb,
  MessageSquarePlus,
  Palette,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type { Camera as ThreeCamera, Object3D } from "three";
import { BlenderLogo } from "../components/BlenderLogo";
import { GuidedTour, type GuidedTourStep } from "../components/GuidedTour";
import { MenubarActions } from "../components/TopActions";
import { ConversionSummary } from "../components/ConversionSummary";
import {
  ReviewAnnotations,
  ReviewPanel,
  type PendingReview,
  type ReviewComment,
  type ReviewCommentDraft,
  type ReviewCommentPatch,
} from "../features/review";
import {
  AnnotationHoverMarker,
  BlenderViewControls,
  BlenderViewportGrid,
  BoxSelectionController,
  ConversionPanel,
  DecorativeBoundary,
  Model,
  ObjectOutliner,
  PanelResizeHandle,
  PropertyInspector,
  ReviewPanelHost,
  UploaderDialog,
  ViewerMenubar,
  ViewerStatusbar,
  clearModelCache,
  VIEWER_GUIDE_STEPS,
  ViewportErrorBoundary,
  ViewportLoading,
} from "../features/viewer";
import { t, tf } from "../i18n";
import { formatShareExpiry } from "../utils";
import type {
  ActiveShareStatus,
  CameraPreset,
  DisplayMode,
  Manifest,
  Project,
  SelectionBox,
  ShadingMode,
} from "../types";
import type { CameraState } from "../shared/types/camera";
import type { SurfaceHit } from "../shared/types/picking";
import type { Vec3 } from "../shared/types/geometry";


// ---------------------------------------------------------------------------
// BlenderWorkspace
// ---------------------------------------------------------------------------

export function BlenderWorkspace({
  title,
  shareStatus,
  manifest,
  hidden,
  selected,
  onSelect,
  onSelectMany,
  onToggle,
  message,
  modelUrl,
  readOnly,
  canView = !readOnly,
  canAnnotate = !readOnly,
  canComment = !readOnly,
  commentAuthorName = "本地创建者",
  displayMode,
  onDisplayMode,
  cameraPreset,
  onCameraPreset,
  comments,
  reviewError,
  reviewNewCount = 0,
  onAcknowledgeReview = () => null,
  onCreateComment,
  onUpdateComment,
  onDeleteComment,
  onDeleteReply,
  canDeleteComment,
  onReplyComment,
  initialCamera = null,
  onViewStateChange,
  uploaderOpen = false,
  onOpenUploader,
  onCloseUploader,
  onHome,
  onDeleteProject,
  onOpenFileMenu,
  recentProjects = [],
  onProjectSelect,
  uploader,
  children,
}: {
  title: string;
  shareStatus?: ActiveShareStatus | null;
  manifest: Manifest | null;
  hidden: Set<string>;
  selected: Set<string>;
  onSelect: (name: string | null) => void;
  onSelectMany: (names: string[]) => void;
  onToggle: (name: string) => void;
  message: string;
  modelUrl?: string;
  readOnly: boolean;
  /** 允许视图操作（框选/独显/聚焦）但不能编辑项目 */
  canView?: boolean;
  /** 允许添加/删除批注 */
  canAnnotate?: boolean;
  canComment?: boolean;
  commentAuthorName?: string;
  displayMode: DisplayMode;
  onDisplayMode: (mode: DisplayMode) => void;
  cameraPreset: CameraPreset;
  onCameraPreset: (preset: CameraPreset) => void;
  comments: ReviewComment[];
  reviewError: string | null;
  reviewNewCount?: number;
  /**
   * 清空未读计数并返回最新一条未读批注的 id，用于定位。
   * 只清计数不定位会让界面上的「点击查看」变成空承诺。
   */
  onAcknowledgeReview?: () => string | null;
  onCreateComment?: (draft: ReviewCommentDraft) => Promise<ReviewComment>;
  onUpdateComment?: (
    commentId: string,
    patch: ReviewCommentPatch,
  ) => Promise<ReviewComment>;
  /** 删除批注与回复；访客侧只对"自己创建的"返回 true。 */
  onDeleteComment?: (commentId: string) => Promise<void> | void;
  onDeleteReply?: (commentId: string, replyId: string) => Promise<void> | void;
  /** 是否允许删除指定 id（批注或回复）。缺省时按 readOnly 判定。 */
  canDeleteComment?: (id: string) => boolean;
  /** 正文由页面补上作者名；返回值只用于等待完成，不消费结果。 */
  onReplyComment?: (commentId: string, body: string) => Promise<unknown> | void;
  initialCamera?: CameraState | null;
  onViewStateChange?: (camera: CameraState) => void;
  uploaderOpen?: boolean;
  onOpenUploader?: () => void;
  onCloseUploader?: () => void;
  onHome?: () => void;
  onDeleteProject?: () => void;
  onOpenFileMenu?: () => void;
  recentProjects?: Project[];
  onProjectSelect?: (project: Project) => void;
  uploader?: ReactNode;
  children?: ReactNode;
}) {
  const active =
    selected.size === 1
      ? manifest?.objects.find((object) => selected.has(object.name))
      : undefined;

  const [fileCameras, setFileCameras] = useState<ThreeCamera[]>([]);
  const [isolated, setIsolated] = useState(false);
  const [sceneRoot, setSceneRoot] = useState<Object3D | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox>(null);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [annotationHover, setAnnotationHover] = useState<SurfaceHit | null>(null);
  const [annotationPopover, setAnnotationPopover] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<"all" | "open" | "resolved">("all");
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState<Vec3>([0, 0, 0]);
  const visibleComments = useMemo(
    () =>
      reviewFilter === "all"
        ? comments
        : comments.filter((comment) => comment.status === reviewFilter),
    [comments, reviewFilter],
  );
  const [outlinerHeight, setOutlinerHeight] = useState(280);
  const [outlinerCollapsed, setOutlinerCollapsed] = useState(false);
  const [propertyHeight, setPropertyHeight] = useState(132);
  const [propertyCollapsed, setPropertyCollapsed] = useState(false);
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [reviewCollapsed, setReviewCollapsed] = useState(false);
  // 成功提示自动消失；错误提示常驻，否则会被成功文案永久遮挡。
  useEffect(() => {
    if (!reviewMessage) return;
    const timer = window.setTimeout(() => setReviewMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [reviewMessage]);
  const [summaryHeight, setSummaryHeight] = useState(180);
  const [overlaysVisible, setOverlaysVisible] = useState(true);
  const [shadingMode, setShadingMode] = useState<ShadingMode>("smooth");
  const [outlinerQuery, setOutlinerQuery] = useState("");
  const [focusRequest, setFocusRequest] = useState<{
    names: string[];
    nonce: number;
  } | null>(null);
  const [reviewCameraRequest, setReviewCameraRequest] = useState<{
    camera: CameraState;
    nonce: number;
  } | null>(null);
  const uploaderTriggerRef = useRef<HTMLButtonElement>(null);
  const uploaderCloseRef = useRef<HTMLButtonElement>(null);
  const uploaderDialogRef = useRef<HTMLElement>(null);
  const uploaderWasOpenRef = useRef(false);
  const restoredInitialCameraRef = useRef<string | null>(null);

  const collectCameras = useCallback(
    (cameras: ThreeCamera[]) => setFileCameras(cameras),
    [],
  );

  useEffect(() => {
    if (selected.size === 0) setIsolated(false);
  }, [selected]);

  const toggleIsolation = useCallback(() => {
    if (selected.size > 0) setIsolated((current) => !current);
  }, [selected]);

  const isolateOutlinerObject = useCallback(
    (name: string) => {
      if (isolated && selected.size === 1 && selected.has(name)) {
        setIsolated(false);
        return;
      }
      onSelect(name);
      setIsolated(true);
    },
    [isolated, onSelect, selected],
  );

  useEffect(() => {
    setAnnotationMode(false);
    setAnnotationHover(null);
    setAnnotationPopover(null);
    setPendingReview(null);
    setSelectedCommentId(null);
    setCommentBody("");
    setReviewMessage(null);
    setNavigationTarget([0, 0, 0]);
    setReviewCameraRequest(null);
  }, [modelUrl]);

  useEffect(() => {
    if (!initialCamera || !sceneRoot || restoredInitialCameraRef.current === modelUrl)
      return;
    restoredInitialCameraRef.current = modelUrl ?? "default";
    setReviewCameraRequest({ camera: initialCamera, nonce: Date.now() });
  }, [initialCamera, modelUrl, sceneRoot]);

  const filteredObjects = useMemo(() => {
    const query = outlinerQuery.trim().toLocaleLowerCase();
    if (!query) return manifest?.objects ?? [];
    return (manifest?.objects ?? []).filter(
      (object) =>
        object.name.toLocaleLowerCase().includes(query) ||
        object.type.toLocaleLowerCase().includes(query),
    );
  }, [manifest?.objects, outlinerQuery]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']"))
        return;
      if (event.key === "Escape" && (annotationMode || pendingReview)) {
        event.preventDefault();
        setAnnotationMode(false);
        setAnnotationHover(null);
        setAnnotationPopover(null);
        setPendingReview(null);
        setCommentBody("");
        return;
      }
      if (
        (event.code === "NumpadDivide" || event.key === "/") &&
        selected.size > 0
      ) {
        event.preventDefault();
        toggleIsolation();
        return;
      }
      if (
        (event.key === "." || event.code === "NumpadDecimal") &&
        selected.size > 0
      ) {
        event.preventDefault();
        setFocusRequest({ names: [...selected], nonce: Date.now() });
        return;
      }
      const preset =
        event.code === "Numpad1"
          ? "front"
          : event.code === "Numpad3"
          ? "right"
          : event.code === "Numpad7"
          ? "top"
          : event.code === "Numpad0"
          ? "perspective"
          : null;
      if (preset) {
        event.preventDefault();
        onCameraPreset(preset);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [annotationMode, onCameraPreset, pendingReview, selected, toggleIsolation]);

  useEffect(() => {
    if (!uploaderOpen) {
      if (uploaderWasOpenRef.current && onOpenUploader)
        uploaderTriggerRef.current?.focus();
      uploaderWasOpenRef.current = false;
      return;
    }
    uploaderWasOpenRef.current = true;
    const frame = requestAnimationFrame(() => uploaderCloseRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [onOpenUploader, uploaderOpen]);

  useEffect(() => {
    if (!fileMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".file-menu-wrap")) setFileMenuOpen(false);
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFileMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnKeyDown);
    };
  }, [fileMenuOpen]);

  function handleUploaderDialogKeyDown(
    event: React.KeyboardEvent<HTMLElement>,
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseUploader?.();
      return;
    }
    if (event.key !== "Tab" || !uploaderDialogRef.current) return;
    const focusable = Array.from(
      uploaderDialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
      ),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function savePendingReview() {
    if (!pendingReview || !onCreateComment || !commentBody.trim()) return;
    if (reviewBusy) return;
    setReviewBusy(true);
    try {
      const comment = await onCreateComment({
        ...pendingReview,
        body: commentBody.trim(),
        authorName: commentAuthorName,
      });
      setSelectedCommentId(comment.id);
      setPendingReview(null);
      setAnnotationPopover(null);
      setCommentBody("");
      setReviewMessage("批注已保存。");
    } catch (reason) {
      setReviewMessage(
        reason instanceof Error ? reason.message : "批注保存失败。",
      );
    } finally {
      setReviewBusy(false);
    }
  }

  async function toggleReviewStatus(comment: ReviewComment) {
    if (!onUpdateComment || reviewBusy) return;
    setReviewBusy(true);
    try {
      await onUpdateComment(comment.id, {
        status: comment.status === "open" ? "resolved" : "open",
      });
      setReviewMessage(
        comment.status === "open" ? "批注已解决。" : "批注已重新打开。",
      );
    } catch (reason) {
      setReviewMessage(
        reason instanceof Error ? reason.message : "批注更新失败。",
      );
    } finally {
      setReviewBusy(false);
    }
  }

  async function editReviewComment(comment: ReviewComment, body: string) {
    if (!onUpdateComment || reviewBusy || !body.trim()) return;
    setReviewBusy(true);
    try {
      await onUpdateComment(comment.id, { body: body.trim() });
      setReviewMessage("批注内容已更新。");
    } catch (reason) {
      setReviewMessage(
        reason instanceof Error ? reason.message : "批注更新失败。",
      );
    } finally {
      setReviewBusy(false);
    }
  }

  /** 删除不可逆，因此先确认；与删除项目的既有做法保持一致。 */
  function confirmDelete(message: string) {
    return window.confirm(message);
  }

  async function deleteReviewComment(comment: ReviewComment) {
    if (!onDeleteComment || reviewBusy) return;
    if (!confirmDelete(`删除这条批注？其下的回复也会一并删除。\n\n「${comment.body}」`)) return;
    setReviewBusy(true);
    try {
      await onDeleteComment(comment.id);
      setReviewMessage("批注已删除。");
      if (selectedCommentId === comment.id) {
        setSelectedCommentId(null);
        setPendingReview(null);
      }
    } catch (reason) {
      setReviewMessage(
        reason instanceof Error ? reason.message : "批注删除失败。",
      );
    } finally {
      setReviewBusy(false);
    }
  }

  async function replyReviewComment(commentId: string, body: string) {
    if (!onReplyComment || reviewBusy || !body.trim()) return;
    setReviewBusy(true);
    try {
      await onReplyComment(commentId, body.trim());
      setReviewMessage("回复已发送。");
    } catch (reason) {
      setReviewMessage(
        reason instanceof Error ? reason.message : "回复发送失败。",
      );
    } finally {
      setReviewBusy(false);
    }
  }

  async function deleteReviewReply(commentId: string, replyId: string) {
    if (!onDeleteReply || reviewBusy) return;
    if (!confirmDelete("删除这条回复？")) return;
    setReviewBusy(true);
    try {
      await onDeleteReply(commentId, replyId);
      setReviewMessage("回复已删除。");
    } catch (reason) {
      setReviewMessage(
        reason instanceof Error ? reason.message : "回复删除失败。",
      );
    } finally {
      setReviewBusy(false);
    }
  }

  function selectReviewComment(commentId: string) {
    setSelectedCommentId(commentId);
    const comment = comments.find((item) => item.id === commentId);
    if (comment)
      setReviewCameraRequest({ camera: comment.camera, nonce: Date.now() });
  }

  /** 「收到新批注，点击查看」：消费未读计数并跳到那条批注。 */
  function acknowledgeAndLocateReview() {
    const commentId = onAcknowledgeReview();
    if (commentId) selectReviewComment(commentId);
  }

  return (
    <main className="blender-shell" data-testid="blendproof-app" data-readonly={readOnly}>
      <ViewerMenubar
        title={title}
        shareStatus={shareStatus}
        fileMenuOpen={fileMenuOpen}
        showFileMenu={Boolean(uploader && onOpenUploader)}
        recentProjects={recentProjects}
        onHome={onHome}
        onOpenFileMenu={onOpenFileMenu}
        onOpenUploader={onOpenUploader}
        onProjectSelect={onProjectSelect}
        onDeleteProject={onDeleteProject}
        onToggleFileMenu={setFileMenuOpen}
        onOpenGuide={() => setGuideOpen(true)}
      >
        {children}
      </ViewerMenubar>
      {guideOpen && (
        <GuidedTour
          steps={VIEWER_GUIDE_STEPS.filter(
            (step) => step.id !== "annotation" || canComment,
          )}
          onClose={() => setGuideOpen(false)}
          onStepChange={(step) => {
            if (step.id === "annotation") {
              setAnnotationsVisible(true);
              setReviewFilter("all");
            }
          }}
        />
      )}
      <div className="blender-main">
        <section className="editor">
          <div className="editor-header">
            <div
              className="editor-type"
              aria-label="3D 视图"
              data-guide="viewport"
            >
              <Box size={14} /> 3D 视图
            </div>
            <div className="header-right">
              {readOnly && !canComment && modelUrl && (
                <span className="annotation-hint" style={{ fontSize: 10, color: '#999', marginRight: 8 }}>
                  {t("当前为只读，需要批注请联系分享者")}
                </span>
              )}
              {canComment && modelUrl && (
                <button
                  className={`annotation-tool ${annotationMode ? "active" : ""}`}
                  data-testid="annotation-toggle"
                  data-guide="annotation-tool"
                  title={t("在模型上点击添加批注")}
                  aria-pressed={annotationMode}
                  onClick={() => {
                    setAnnotationMode((current) => !current);
                    setAnnotationHover(null);
                    setAnnotationPopover(null);
                    setPendingReview(null);
                    setReviewFilter("all");
                    setAnnotationsVisible(true);
                  }}
                >
                  <MessageSquarePlus size={13} />
                  {annotationMode ? t("退出标注模式") : t("添加批注")}
                </button>
              )}
              <div className="view-controls" aria-label="视图控制">
                <div className="icon-group" aria-label="显示模式">
                  <button
                    title="线框"
                    className={displayMode === "wire" ? "active" : ""}
                    onClick={() => onDisplayMode("wire")}
                  >
                    <Grid2X2 />
                  </button>
                  <button
                    title="灰模"
                    className={displayMode === "gray" ? "active" : ""}
                    onClick={() => onDisplayMode("gray")}
                  >
                    <Circle />
                  </button>
                  <button
                    title="材质预览"
                    className={displayMode === "material" ? "active" : ""}
                    onClick={() => onDisplayMode("material")}
                  >
                    <Palette />
                  </button>
                </div>
                <div className="icon-group camera-group" aria-label="镜头预设">
                  <button
                    title="正视图 - 小键盘 1"
                    className={cameraPreset === "front" ? "active" : ""}
                    onClick={() => onCameraPreset("front")}
                  >
                    1
                  </button>
                  <button
                    title="右视图 - 小键盘 3"
                    className={cameraPreset === "right" ? "active" : ""}
                    onClick={() => onCameraPreset("right")}
                  >
                    3
                  </button>
                  <button
                    title="顶视图 - 小键盘 7"
                    className={cameraPreset === "top" ? "active" : ""}
                    onClick={() => onCameraPreset("top")}
                  >
                    7
                  </button>
                  <button
                    title="透视图 - 小键盘 0"
                    className={cameraPreset === "perspective" ? "active" : ""}
                    onClick={() => onCameraPreset("perspective")}
                  >
                    0
                  </button>
                </div>
                {fileCameras.map((camera) => (
                  <button
                    key={camera.uuid}
                    className={`file-camera ${
                      cameraPreset === `file:${camera.uuid}` ? "active" : ""
                    }`}
                    title={tf("使用文件相机：%s", camera.name || "Camera")}
                    onClick={() => onCameraPreset(`file:${camera.uuid}`)}
                  >
                    相机 {camera.name || "Camera"}
                  </button>
                ))}
                <button
                  type="button"
                  className={`editor-mode overlay-toggle ${
                    overlaysVisible ? "active" : ""
                  }`}
                  aria-pressed={overlaysVisible}
                  title="显示或隐藏网格与坐标轴"
                  onClick={() => setOverlaysVisible((visible) => !visible)}
                >
                  <Grid2X2 size={12} /> 叠加层
                </button>
                <button
                  type="button"
                  className={`editor-mode overlay-toggle ${
                    annotationsVisible ? "active" : ""
                  }`}
                  aria-pressed={annotationsVisible}
                  title="显示或隐藏全部批注 Pin"
                  onClick={() =>
                    setAnnotationsVisible((visible) => !visible)
                  }
                >
                  <MessageSquarePlus size={12} /> 批注
                </button>
                <button
                  type="button"
                  className={`editor-mode overlay-toggle shading-toggle ${
                    shadingMode === "flat" ? "active" : ""
                  }`}
                  aria-pressed={shadingMode === "flat"}
                  title={
                    shadingMode === "smooth"
                      ? "切换为平直着色"
                      : "切换为平滑着色"
                  }
                  onClick={() =>
                    setShadingMode((mode) =>
                      mode === "smooth" ? "flat" : "smooth",
                    )
                  }
                >
                  {shadingMode === "smooth" ? "平滑" : "平直"}
                </button>
              </div>
            </div>
          </div>
          <div
            className={`viewport ${annotationMode ? "annotation-mode" : ""}`}
            data-testid="viewer-viewport"
            aria-label="3D 模型视图"
          >
            {modelUrl ? (
              <ViewportErrorBoundary
                hint={
                  readOnly
                    ? t("请把这条提示发给分享者，让对方确认模型文件是否仍然可用。")
                    : t("可以重新上传 .blend，或在文件菜单中选择其他项目。")
                }
                onRetry={() => clearModelCache(modelUrl)}
              >
              <Canvas
                camera={{ position: [7, 7, 5], fov: 45 }}
                dpr={[1, 2]}
                onPointerMissed={() => onSelect(null)}
                onContextMenu={(event) => event.preventDefault()}
                onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
              >
                <color attach="background" args={["#1e1e1e"]} />
                {overlaysVisible && <BlenderViewportGrid />}
                <ambientLight intensity={1.35} />
                <directionalLight position={[5, 8, 4]} intensity={2.5} />
                <Suspense fallback={null}>
                  <Model
                    url={modelUrl}
                    hidden={hidden}
                    displayMode={displayMode}
                    shadingMode={shadingMode}
                    selected={selected}
                    isolated={isolated}
                    onIsolationInvalid={() => setIsolated(false)}
                    selectableNames={
                      new Set(manifest?.objects.map((object) => object.name))
                    }
                    onObjectClick={onSelect}
                    onCameras={collectCameras}
                    onSceneReady={setSceneRoot}
                    annotationMode={annotationMode}
                    hoveredName={annotationHover?.objectName ?? null}
                    navigationTarget={navigationTarget}
                    onHoverAnnotation={setAnnotationHover}
                    onAnnotation={(hit, camera, screen) => {
                      // viewer 只上报拾取结果与相机；「批注草稿」是审稿域的概念，
                      // 由这里组装，viewer 因此不必依赖 review 域。
                      setPendingReview({ ...hit, camera });
                      setAnnotationHover(null);
                      setAnnotationPopover({
                        x: screen.x > 700 ? screen.x - 270 : screen.x,
                        y: Math.min(
                          Math.max(12, screen.y),
                          Math.max(12, window.innerHeight - 260),
                        ),
                      });
                      setCommentBody("");
                      setAnnotationMode(false);
                      setReviewMessage("已定位批注，请填写内容。");
                    }}
                  />
                  {annotationMode && annotationHover && (
                    <AnnotationHoverMarker hit={annotationHover} />
                  )}
                  {annotationsVisible && (
                    <ReviewAnnotations
                      comments={visibleComments}
                      selectedId={selectedCommentId}
                      onSelect={selectReviewComment}
                    />
                  )}
                  {/* 环境贴图来自 CDN：失败只是少了氛围，不该让用户看到「模型无法加载」。 */}
                  <DecorativeBoundary>
                    <Environment preset="city" />
                  </DecorativeBoundary>
                </Suspense>
                <BlenderViewControls
                  preset={cameraPreset}
                  fileCameras={fileCameras}
                  scene={sceneRoot}
                  onTargetChange={setNavigationTarget}
              annotationMode={annotationMode}
                  reviewCameraRequest={reviewCameraRequest}
                  focusRequest={focusRequest}
                  onViewStateChange={onViewStateChange}
                />
                {!annotationMode && (
                  <BoxSelectionController
                    scene={sceneRoot}
                    selectableNames={
                      new Set(manifest?.objects.map((object) => object.name))
                    }
                    onSelectMany={onSelectMany}
                    onBoxChange={setSelectionBox}
                  />
                )}
              </Canvas>
              </ViewportErrorBoundary>
            ) : (
              <div className="empty-viewport">
                <BlenderLogo />
                <p>打开 .blend 以开始审稿</p>
              </div>
            )}
            {/* 慢网或大模型下必须有进度反馈：此前 Suspense fallback 为 null，
                客户看到空白视口会以为链接坏了。 */}
            <ViewportLoading
              hint={
                readOnly
                  ? t("首次打开需要下载模型，请稍候。")
                  : t("正在从本机读取已转换的模型。")
              }
            />
            {overlaysVisible && (
              <div className="axis-widget">
                <b>Z</b>
                <i>Y</i>
                <em>X</em>
              </div>
            )}
            {selectionBox && (
              <div
                className="selection-box"
                style={{
                  left: selectionBox.left,
                  top: selectionBox.top,
                  width: selectionBox.width,
                  height: selectionBox.height,
                }}
              />
            )}
            {pendingReview && annotationPopover && (
              <div
                className="annotation-popover"
                style={{
                  left: annotationPopover.x,
                  top: annotationPopover.y,
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <div className="annotation-popover-title">
                  <MessageSquarePlus size={13} /> 添加批注{" "}
                  <button
                    type="button"
                    aria-label="取消"
                    onClick={() => {
                      setPendingReview(null);
                      setAnnotationPopover(null);
                      setCommentBody("");
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
                <small>落点：{pendingReview.objectName ?? "模型表面"}</small>
                <textarea
                  aria-label="批注内容"
                  autoFocus
                  value={commentBody}
                  placeholder="输入需要修改或确认的内容"
                  onChange={(event) => setCommentBody(event.target.value)}
                />
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingReview(null);
                      setAnnotationPopover(null);
                      setCommentBody("");
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!commentBody.trim() || reviewBusy}
                    onClick={() => void savePendingReview()}
                  >
                    保存批注
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="viewport-hints">
            {annotationMode ? (
              <>
                悬停模型显示吸附点 <span>·</span> 右键创建批注 <span>·</span>{" "}
                Esc 退出
              </>
            ) : (
              <>
                {readOnly
                  ? t("拖动旋转 · Shift+右键平移")
                  : t("左键拖拽框选 · 中键旋转 · Shift+中键平移")}
              </>
            )}
            <span>·</span> 滚轮缩放 <span>·</span>/{" "}
            {selected.size > 0
              ? isolated
                ? "退出局部视图"
                : "独显选中物体"
              : "独显"}
          </div>
        </section>
        <aside className="right-editors">
          <ObjectOutliner
            collapsed={outlinerCollapsed}
            height={outlinerHeight}
            query={outlinerQuery}
            manifest={manifest}
            objects={filteredObjects}
            selected={selected}
            hidden={hidden}
            readOnly={!canView}
            isolated={isolated}
            onToggleCollapse={() => setOutlinerCollapsed((c) => !c)}
            onQueryChange={setOutlinerQuery}
            onSelect={(name) => onSelect(name)}
            onToggle={onToggle}
            onIsolate={isolateOutlinerObject}
            onFocus={() => setFocusRequest({ names: [...selected], nonce: Date.now() })}
          />
          <PanelResizeHandle
            label="调整场景集合面板高度"
            onDelta={(delta) =>
              setOutlinerHeight((height) =>
                Math.min(560, Math.max(90, height + delta)),
              )
            }
          />
          <PropertyInspector
            collapsed={propertyCollapsed}
            height={propertyHeight}
            active={active}
            onToggleCollapse={() => setPropertyCollapsed((c) => !c)}
          />
          <PanelResizeHandle
            label="调整属性面板高度"
            onDelta={(delta) =>
              setPropertyHeight((height) =>
                Math.min(360, Math.max(76, height + delta)),
              )
            }
          />
          <ConversionPanel
            collapsed={summaryCollapsed}
            height={summaryHeight}
            manifest={manifest}
            onToggleCollapse={() => setSummaryCollapsed((c) => !c)}
          />
          <PanelResizeHandle
            label="调整转换信息面板高度"
            onDelta={(delta) =>
              setSummaryHeight((height) =>
                Math.min(360, Math.max(82, height + delta)),
              )
            }
          />
          <ReviewPanelHost
            collapsed={reviewCollapsed}
            comments={visibleComments}
            newCount={reviewNewCount}
            filter={reviewFilter}
            selectedId={selectedCommentId}
            commentBody={commentBody}
            readOnly={!canView}
            canComment={canComment}
            // 错误优先于成功文案：否则保存成功一次后，后续错误永远看不见。
            message={reviewError ?? reviewMessage}
            busy={reviewBusy}
            canDelete={canDeleteComment ?? (() => !readOnly)}
            onToggleCollapse={() => setReviewCollapsed((c) => !c)}
            onFilterChange={setReviewFilter}
            onAcknowledgeNew={acknowledgeAndLocateReview}
            onBody={setCommentBody}
            onSelect={selectReviewComment}
            onSave={() => void savePendingReview()}
            onCancelDraft={() => {
              setPendingReview(null);
              setCommentBody("");
            }}
            onToggleStatus={(comment) => void toggleReviewStatus(comment)}
            onEdit={(comment, body) => void editReviewComment(comment, body)}
            onDeleteComment={(comment) => void deleteReviewComment(comment)}
            onReply={(commentId, text) => void replyReviewComment(commentId, text)}
            onDeleteReply={(commentId, replyId) => void deleteReviewReply(commentId, replyId)}
          />
        </aside>
      </div>
      {uploader && uploaderOpen && (
        <UploaderDialog
          onClose={onCloseUploader}
          onKeyDown={handleUploaderDialogKeyDown}
          dialogRef={uploaderDialogRef}
          closeButtonRef={uploaderCloseRef}
        >
          {uploader}
        </UploaderDialog>
      )}
      <ViewerStatusbar message={message} isolated={isolated} readOnly={readOnly} />
    </main>
  );
}
