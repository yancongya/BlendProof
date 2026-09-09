import { Environment, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
  Box,
  Camera,
  ChevronDown,
  Circle,
  Eye,
  FolderOpen,
  Layers,
  Lightbulb,
  MessageSquarePlus,
  Palette,
  Settings2,
  Share2,
  SlidersHorizontal,
  Upload,
  Grid2X2,
} from "lucide-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, ReactNode } from "react";
import {
  Box3,
  Matrix3,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  type Camera as ThreeCamera,
  type Object3D,
} from "three";
import { BlenderLogo } from "./components/BlenderLogo";
import { ReviewAnnotations } from "./review/ReviewAnnotations";
import { useReviewComments } from "./review/useReviewComments";
import type {
  ReviewCameraState,
  ReviewComment,
  ReviewCommentDraft,
  Vec3,
} from "./reviewRepository";

type Project = {
  id: string;
  name: string;
  modelUrl: string;
  manifestUrl: string;
};
type SceneObject = { name: string; type: string; collections: string[] };
type Manifest = {
  scene: string;
  camera: string | null;
  objects: SceneObject[];
  collections: string[];
  export?: { sourceBytes: number; glbBytes: number; objectCount: number };
};
type DisplayMode = "material" | "gray" | "wire";
type CameraPreset =
  "perspective" | "front" | "right" | "top" | `file:${string}`;
type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
} | null;
type PendingReview = Omit<ReviewCommentDraft, "body" | "authorName">;

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [project, setProject] = useState<Project | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("blendproof:last-project") ?? "null");
    } catch {
      return null;
    }
  });
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState(
    "选择 Blender 文件以建立本地审稿项目。",
  );
  const [processing, setProcessing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("material");
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("perspective");
  const input = useRef<HTMLInputElement>(null);
  const reviews = useReviewComments(project?.id ?? null);
  useEffect(() => {
    if (project)
      fetch(project.manifestUrl)
        .then((res) => res.json())
        .then(setManifest);
  }, [project]);
  useEffect(() => {
    if (project)
      localStorage.setItem("blendproof:last-project", JSON.stringify(project));
  }, [project]);
  async function convert() {
    if (!file) return;
    setProcessing(true);
    setMessage("正在调用本机 Blender 导出 GLB。");
    const body = new FormData();
    body.append("blend", file);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        body,
      });
      const result = (await response.json()) as Project & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "导入失败。");
      setProject(result);
      setHidden(new Set());
      setSelected(new Set());
      setShareUrl(null);
      setMessage("本机转换完成。");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "导入失败。");
    } finally {
      setProcessing(false);
    }
  }
  async function createShare() {
    if (!project) return;
    const response = await fetch(
      `/api/projects/${project.id}/shares`,
      { method: "POST" },
    );
    const body = (await response.json()) as {
      shareUrl?: string;
      error?: string;
    };
    setShareUrl(body.shareUrl ?? null);
    setMessage(body.error ?? "已建立本地只读分享链接。");
  }
  function pick(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setMessage("文件已选择，点击导入即可开始。");
  }
  function toggle(name: string) {
    setHidden((current) => {
      const next = new Set(current);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }
  return (
    <BlenderWorkspace
      title={project?.name ?? file?.name ?? "未命名"}
      manifest={manifest}
      hidden={hidden}
      selected={selected}
      onSelect={(name) => setSelected(name ? new Set([name]) : new Set())}
      onSelectMany={(names) => setSelected(new Set(names))}
      onToggle={toggle}
      message={message}
      modelUrl={project?.modelUrl}
      readOnly={false}
      displayMode={displayMode}
      onDisplayMode={setDisplayMode}
      cameraPreset={cameraPreset}
      onCameraPreset={setCameraPreset}
      comments={reviews.comments}
      reviewError={reviews.error}
      onCreateComment={reviews.create}
      onUpdateComment={reviews.update}
    >
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept=".blend"
        onChange={pick}
      />
      <button className="menu-item" onClick={() => input.current?.click()}>
        <FolderOpen size={13} /> 打开 .blend
      </button>
      <button
        className="menu-item"
        disabled={!file || processing}
        onClick={convert}
      >
        <Upload size={13} /> {processing ? "导入中" : "导入审稿模型"}
      </button>
      <button className="menu-item" disabled={!project} onClick={createShare}>
        <Share2 size={13} /> 创建分享
      </button>
      {shareUrl && (
        <a
          className="share-chip"
          href={shareUrl}
          target="_blank"
          rel="noreferrer"
        >
          打开只读分享
        </a>
      )}
    </BlenderWorkspace>
  );
}

export function SharePage() {
  const token = window.location.pathname.split("/").filter(Boolean).at(-1);
  const [share, setShare] = useState<{
    name: string;
    modelUrl: string;
    manifest: Manifest;
    comments: ReviewComment[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [displayMode, setDisplayMode] = useState<DisplayMode>("material");
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("perspective");
  useEffect(() => {
    if (!token) return setError("缺少分享标识。");
    fetch(`/api/shares/${token}`)
      .then(async (response) => {
        const body = (await response.json()) as {
          name: string;
          modelUrl: string;
          manifest: Manifest;
          comments: ReviewComment[];
          error?: string;
        };
        if (!response.ok) throw new Error(body.error);
        setShare(body);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "无法读取分享。"),
      );
  }, [token]);
  if (error) return <Notice text={error} />;
  if (!share) return <Notice text="正在打开审稿文件。" />;
  return (
    <BlenderWorkspace
      title={share.manifest.scene}
      manifest={share.manifest}
      hidden={new Set()}
      selected={selected}
      onSelect={(name) => setSelected(name ? new Set([name]) : new Set())}
      onSelectMany={(names) => setSelected(new Set(names))}
      onToggle={() => {}}
      message="只读分享。文件由本机 BlendProof 提供。"
      modelUrl={share.modelUrl}
      readOnly
      displayMode={displayMode}
      onDisplayMode={setDisplayMode}
      cameraPreset={cameraPreset}
      onCameraPreset={setCameraPreset}
      comments={share.comments}
      reviewError={null}
    />
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="notice">
      <BlenderLogo />
      <h1>BlendProof</h1>
      <p>{text}</p>
    </div>
  );
}
function BlenderWorkspace({
  title,
  manifest,
  hidden,
  selected,
  onSelect,
  onSelectMany,
  onToggle,
  message,
  modelUrl,
  readOnly,
  displayMode,
  onDisplayMode,
  cameraPreset,
  onCameraPreset,
  comments,
  reviewError,
  onCreateComment,
  onUpdateComment,
  children,
}: {
  title: string;
  manifest: Manifest | null;
  hidden: Set<string>;
  selected: Set<string>;
  onSelect: (name: string | null) => void;
  onSelectMany: (names: string[]) => void;
  onToggle: (name: string) => void;
  message: string;
  modelUrl?: string;
  readOnly: boolean;
  displayMode: DisplayMode;
  onDisplayMode: (mode: DisplayMode) => void;
  cameraPreset: CameraPreset;
  onCameraPreset: (preset: CameraPreset) => void;
  comments: ReviewComment[];
  reviewError: string | null;
  onCreateComment?: (draft: ReviewCommentDraft) => Promise<ReviewComment>;
  onUpdateComment?: (
    commentId: string,
    patch: Pick<Partial<ReviewComment>, "body" | "status">,
  ) => Promise<ReviewComment>;
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
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState<Vec3>([0, 0, 0]);
  const [reviewCameraRequest, setReviewCameraRequest] = useState<{
    camera: ReviewCameraState;
    nonce: number;
  } | null>(null);
  const collectCameras = useCallback(
    (cameras: ThreeCamera[]) => setFileCameras(cameras),
    [],
  );
  useEffect(() => {
    if (selected.size === 0) setIsolated(false);
  }, [selected]);
  useEffect(() => {
    setAnnotationMode(false);
    setPendingReview(null);
    setSelectedCommentId(null);
    setCommentBody("");
    setReviewMessage(null);
    setNavigationTarget([0, 0, 0]);
    setReviewCameraRequest(null);
  }, [modelUrl]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']"))
        return;
      if (
        (event.code === "NumpadDivide" || event.key === "/") &&
        selected.size > 0
      ) {
        event.preventDefault();
        setIsolated((current) => !current);
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
  }, [onCameraPreset, selected]);
  async function savePendingReview() {
    if (!pendingReview || !onCreateComment || !commentBody.trim()) return;
    if (reviewBusy) return;
    setReviewBusy(true);
    try {
      const comment = await onCreateComment({
        ...pendingReview,
        body: commentBody.trim(),
        authorName: "本地创建者",
      });
      setSelectedCommentId(comment.id);
      setPendingReview(null);
      setCommentBody("");
      setReviewMessage("批注已保存。");
    } catch (reason) {
      setReviewMessage(reason instanceof Error ? reason.message : "批注保存失败。");
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
      setReviewMessage(comment.status === "open" ? "批注已解决。" : "批注已重新打开。");
    } catch (reason) {
      setReviewMessage(reason instanceof Error ? reason.message : "批注更新失败。");
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
      setReviewMessage(reason instanceof Error ? reason.message : "批注更新失败。");
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
  return (
    <main className="blender-shell" data-testid="blendproof-app" data-readonly={readOnly}>
      <header className="blender-menubar">
        <div className="brand-mark">
          <BlenderLogo />
          <span>BlendProof</span>
        </div>
        <div className="project-name">{title}</div>
        <div className="header-actions">
          {children ?? <span>只读审稿</span>}
        </div>
      </header>
      <div className="blender-main">
        <section className="editor">
          <div className="editor-header">
            <div className="editor-type">
              <Box size={14} /> 3D 视图 <ChevronDown size={12} />
            </div>
            {!readOnly && modelUrl && (
              <button
                className={`annotation-tool ${annotationMode ? "active" : ""}`}
                data-testid="annotation-toggle"
                aria-pressed={annotationMode}
                onClick={() => {
                  setAnnotationMode((current) => !current);
                  setPendingReview(null);
                }}
              >
                <MessageSquarePlus size={13} />
                {annotationMode ? "点击模型放置批注" : "添加批注"}
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
                  className={`file-camera ${cameraPreset === `file:${camera.uuid}` ? "active" : ""}`}
                  title={`使用文件相机：${camera.name || "Camera"}`}
                  onClick={() => onCameraPreset(`file:${camera.uuid}`)}
                >
                  相机 {camera.name || "Camera"}
                </button>
              ))}
            </div>
            <div className="editor-mode">对象模式</div>
          </div>
          <div className="viewport" data-testid="viewer-viewport" aria-label="3D 模型视图">
            {modelUrl ? (
              <Canvas
                camera={{ position: [7, -7, 5], fov: 45 }}
                dpr={[1, 2]}
                onPointerMissed={() => onSelect(null)}
                onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
              >
                <color attach="background" args={["#1e1e1e"]} />
                <ambientLight intensity={1.35} />
                <directionalLight position={[5, 8, 4]} intensity={2.5} />
                <Suspense fallback={null}>
                  <Model
                    url={modelUrl}
                    hidden={hidden}
                    displayMode={displayMode}
                    selected={selected}
                    isolated={isolated}
                    selectableNames={
                      new Set(manifest?.objects.map((object) => object.name))
                    }
                    onObjectClick={onSelect}
                    onCameras={collectCameras}
                    onSceneReady={setSceneRoot}
                    annotationMode={annotationMode}
                    navigationTarget={navigationTarget}
                    onAnnotation={(draft) => {
                      setPendingReview(draft);
                      setCommentBody("");
                      setAnnotationMode(false);
                      setReviewMessage("已定位批注，请填写内容。");
                    }}
                  />
                  <ReviewAnnotations
                    comments={comments}
                    selectedId={selectedCommentId}
                    onSelect={selectReviewComment}
                  />
                  <Environment preset="city" />
                </Suspense>
                <BlenderViewControls
                  preset={cameraPreset}
                  fileCameras={fileCameras}
                  scene={sceneRoot}
                  onTargetChange={setNavigationTarget}
                  reviewCameraRequest={reviewCameraRequest}
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
            ) : (
              <div className="empty-viewport">
                <BlenderLogo />
                <p>打开 .blend 以开始审稿</p>
              </div>
            )}
            <div className="axis-widget">
              <b>Z</b>
              <i>Y</i>
              <em>X</em>
            </div>
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
          </div>
          <div className="viewport-hints">
            左键拖拽框选 <span>·</span> 中键旋转 <span>·</span> Shift + 中键平移{" "}
            <span>·</span> 滚轮缩放 <span>·</span>/{" "}
            {selected.size > 0
              ? isolated
                ? "退出局部视图"
                : "独显选中物体"
              : "独显"}
          </div>
        </section>
        <aside className="right-editors">
          <section className="outliner">
            <header>
              <span>
                <Layers size={13} /> 场景集合
              </span>
            </header>
            <div className="tree-root">
              <span>⌄</span>
              <strong>{manifest?.scene ?? "Scene Collection"}</strong>
            </div>
            <div className="tree-children">
              {manifest?.objects.map((object) => (
                <div
                  className={`tree-row ${selected.has(object.name) ? "selected" : ""}`}
                  key={object.name}
                  onClick={() => onSelect(object.name)}
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
                    className="eye"
                    disabled={readOnly}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggle(object.name);
                    }}
                  >
                    <Eye
                      className={hidden.has(object.name) ? "muted-eye" : ""}
                    />
                  </button>
                </div>
              ))}
            </div>
          </section>
          <section className="properties">
            <header>
              <span>
                <SlidersHorizontal size={13} /> 属性
              </span>
            </header>
            {active ? (
              <div className="property-body">
                <p className="property-kicker">{active.type}</p>
                <label>
                  对象名称
                  <input value={active.name} readOnly />
                </label>
                <label>
                  集合
                  <input
                    value={active.collections.join(", ") || "Scene Collection"}
                    readOnly
                  />
                </label>
              </div>
            ) : (
              <ConversionSummary manifest={manifest} />
            )}
            <ReviewPanel
              comments={comments}
              selectedId={selectedCommentId}
              pending={pendingReview}
              body={commentBody}
              readOnly={readOnly}
              message={reviewMessage ?? reviewError}
              onBody={setCommentBody}
              onSelect={selectReviewComment}
              onSave={() => void savePendingReview()}
              busy={reviewBusy}
              onCancel={() => {
                setPendingReview(null);
                setCommentBody("");
              }}
              onToggleStatus={(comment) => void toggleReviewStatus(comment)}
              onEdit={(comment, body) => void editReviewComment(comment, body)}
            />
          </section>
        </aside>
      </div>
      <footer className="blender-status">
        <span>{message}</span>
        <span>
          {isolated ? "局部视图" : readOnly ? "共享视图" : "本地工程"} ·
          BlendProof
        </span>
      </footer>
    </main>
  );
}
function Model({
  url,
  hidden,
  displayMode,
  selected,
  isolated,
  selectableNames,
  onObjectClick,
  onCameras,
  onSceneReady,
  annotationMode,
  navigationTarget,
  onAnnotation,
}: {
  url: string;
  hidden: Set<string>;
  displayMode: DisplayMode;
  selected: Set<string>;
  isolated: boolean;
  selectableNames: Set<string>;
  onObjectClick: (name: string | null) => void;
  onCameras: (cameras: ThreeCamera[]) => void;
  onSceneReady: (scene: Object3D) => void;
  annotationMode: boolean;
  navigationTarget: Vec3;
  onAnnotation: (draft: PendingReview) => void;
}) {
  const { camera } = useThree();
  const gltf = useGLTF(url);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  useEffect(() => {
    const cameras: ThreeCamera[] = [];
    scene.traverse((node) => {
      if ((node as ThreeCamera).isCamera) cameras.push(node as ThreeCamera);
    });
    onCameras(cameras);
    onSceneReady(scene);
  }, [onCameras, onSceneReady, scene]);
  useEffect(() => {
    scene.traverse((node: Object3D & { material?: unknown }) => {
      node.visible =
        !hidden.has(node.name) &&
        (!isolated ||
          selected.size === 0 ||
          belongsToAnySelected(node, selected));
      const materials = Array.isArray(node.material)
        ? node.material
        : node.material
          ? [node.material]
          : [];
      for (const material of materials as Array<{
        userData: Record<string, unknown>;
        color?: { getHex: () => number; setHex: (value: number) => void };
        emissive?: { getHex: () => number; setHex: (value: number) => void };
        emissiveIntensity?: number;
        wireframe?: boolean;
        needsUpdate: boolean;
      }>) {
        const original = material.userData.blendProofOriginal as
          | {
              color?: number;
              emissive?: number;
              emissiveIntensity?: number;
              wireframe?: boolean;
            }
          | undefined;
        if (!original)
          material.userData.blendProofOriginal = {
            color: material.color?.getHex(),
            emissive: material.emissive?.getHex(),
            emissiveIntensity: material.emissiveIntensity,
            wireframe: material.wireframe,
          };
        const saved = material.userData.blendProofOriginal as {
          color?: number;
          emissive?: number;
          emissiveIntensity?: number;
          wireframe?: boolean;
        };
        if (displayMode === "wire") {
          material.wireframe = true;
          material.color?.setHex(0xe87d0d);
        } else if (displayMode === "gray") {
          material.wireframe = false;
          material.color?.setHex(0xaeb4b7);
        } else {
          material.wireframe = saved.wireframe;
          if (saved.color !== undefined) material.color?.setHex(saved.color);
        }
        if (belongsToAnySelected(node, selected)) {
          material.emissive?.setHex(0xe87d0d);
          material.emissiveIntensity = 0.52;
        } else {
          if (saved.emissive !== undefined)
            material.emissive?.setHex(saved.emissive);
          material.emissiveIntensity = saved.emissiveIntensity;
        }
        material.needsUpdate = true;
      }
    });
  }, [displayMode, hidden, isolated, scene, selected]);
  return (
    <primitive
      object={scene}
      onClick={(event: any) => {
        event.stopPropagation();
        let node: Object3D | null = event.object;
        while (node && !selectableNames.has(node.name)) node = node.parent;
        if (annotationMode && event.face) {
          const normal = event.face.normal
            .clone()
            .applyMatrix3(new Matrix3().getNormalMatrix(event.object.matrixWorld))
            .normalize();
          const towardCamera = new Vector3()
            .copy(camera.position)
            .sub(event.point)
            .normalize();
          if (normal.dot(towardCamera) < 0) normal.negate();
          const perspective = (camera as any).isPerspectiveCamera;
          onAnnotation({
            objectName: node?.name ?? null,
            position: event.point.toArray() as Vec3,
            normal: normal.toArray() as Vec3,
            camera: {
              projection: perspective ? "perspective" : "orthographic",
              position: camera.position.toArray() as Vec3,
              quaternion: camera.quaternion.toArray() as [number, number, number, number],
              target: navigationTarget,
              ...(perspective
                ? { fov: (camera as any).fov }
                : {
                    zoom: (camera as any).zoom,
                    orthographicHeight:
                      (camera as any).top - (camera as any).bottom,
                  }),
            },
          });
          return;
        }
        onObjectClick(node?.name ?? null);
      }}
    />
  );
}

function BoxSelectionController({
  scene,
  selectableNames,
  onSelectMany,
  onBoxChange,
}: {
  scene: Object3D | null;
  selectableNames: Set<string>;
  onSelectMany: (names: string[]) => void;
  onBoxChange: (box: SelectionBox) => void;
}) {
  const { camera, gl, size } = useThree();
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  useEffect(() => {
    const element = gl.domElement;
    const point = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      start.current = point(event);
      dragged.current = false;
    };
    const onMove = (event: PointerEvent) => {
      if (!start.current) return;
      const end = point(event);
      const left = Math.min(start.current.x, end.x);
      const top = Math.min(start.current.y, end.y);
      if (
        Math.abs(end.x - start.current.x) >= 8 ||
        Math.abs(end.y - start.current.y) >= 8
      )
        dragged.current = true;
      onBoxChange({
        left,
        top,
        width: Math.abs(end.x - start.current.x),
        height: Math.abs(end.y - start.current.y),
      });
    };
    const onUp = (event: PointerEvent) => {
      const box = start.current;
      start.current = null;
      onBoxChange(null);
      if (!box || !scene) return;
      const end = point(event);
      const left = Math.min(box.x, end.x);
      const right = Math.max(box.x, end.x);
      const top = Math.min(box.y, end.y);
      const bottom = Math.max(box.y, end.y);
      if (right - left < 8 || bottom - top < 8) return;
      const selected = new Set<string>();
      scene.updateWorldMatrix(true, true);
      scene.traverse((node) => {
        const name = selectableAncestorName(node, selectableNames);
        if (!name || !(node as { isMesh?: boolean }).isMesh) return;
        const bounds = new Box3().setFromObject(node);
        if (bounds.isEmpty()) return;
        let objectLeft = Number.POSITIVE_INFINITY;
        let objectRight = Number.NEGATIVE_INFINITY;
        let objectTop = Number.POSITIVE_INFINITY;
        let objectBottom = Number.NEGATIVE_INFINITY;
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y])
            for (const z of [bounds.min.z, bounds.max.z]) {
              const projected = new Vector3(x, y, z).project(camera);
              const screenX = ((projected.x + 1) / 2) * size.width;
              const screenY = ((1 - projected.y) / 2) * size.height;
              objectLeft = Math.min(objectLeft, screenX);
              objectRight = Math.max(objectRight, screenX);
              objectTop = Math.min(objectTop, screenY);
              objectBottom = Math.max(objectBottom, screenY);
            }
        if (
          objectRight >= left &&
          objectLeft <= right &&
          objectBottom >= top &&
          objectTop <= bottom
        )
          selected.add(name);
      });
      onSelectMany([...selected]);
    };
    const onClickCapture = (event: MouseEvent) => {
      if (!dragged.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dragged.current = false;
    };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("click", onClickCapture, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [camera, gl, onBoxChange, onSelectMany, scene, selectableNames, size]);
  return null;
}

function selectableAncestorName(node: Object3D, selectableNames: Set<string>) {
  let current: Object3D | null = node;
  while (current) {
    if (selectableNames.has(current.name)) return current.name;
    current = current.parent;
  }
  return null;
}

function belongsToAnySelected(node: Object3D, selected: Set<string>) {
  let current: Object3D | null = node;
  while (current) {
    if (selected.has(current.name)) return true;
    current = current.parent;
  }
  return false;
}

function BlenderViewControls({
  preset,
  fileCameras,
  scene,
  onTargetChange,
  reviewCameraRequest,
}: {
  preset: CameraPreset;
  fileCameras: ThreeCamera[];
  scene: Object3D | null;
  onTargetChange: (target: Vec3) => void;
  reviewCameraRequest: { camera: ReviewCameraState; nonce: number } | null;
}) {
  const { camera, gl, set, size } = useThree();
  const controls = useRef<any>(null);
  const navigationCamera = useRef<ThreeCamera | null>(null);
  if (!navigationCamera.current) navigationCamera.current = camera;
  useEffect(() => {
    const source = preset.startsWith("file:")
      ? fileCameras.find((item) => item.uuid === preset.slice(5))
      : undefined;
    if (source) {
      source.updateWorldMatrix(true, false);
      const fileCamera = source.clone() as ThreeCamera;
      source.getWorldPosition(fileCamera.position);
      source.getWorldQuaternion(fileCamera.quaternion);
      if (fileCamera.type === "PerspectiveCamera") {
        (fileCamera as any).aspect = size.width / size.height;
      }
      (fileCamera as any).updateProjectionMatrix();
      set({ camera: fileCamera as any });
      if (controls.current) controls.current.object = fileCamera;
      const forward = new Vector3(0, 0, -1).applyQuaternion(
        fileCamera.quaternion,
      );
      controls.current?.target
        .copy(fileCamera.position)
        .add(forward.multiplyScalar(10));
    } else {
      const activeCamera = navigationCamera.current!;
      set({ camera: activeCamera as any });
      if (controls.current) controls.current.object = activeCamera;
      const bounds = scene ? new Box3().setFromObject(scene) : null;
      const center =
        bounds && !bounds.isEmpty()
          ? bounds.getCenter(new Vector3())
          : new Vector3();
      const radius =
        bounds && !bounds.isEmpty()
          ? Math.max(bounds.getSize(new Vector3()).length() / 2, 1)
          : 4;
      const distance = radius * 2.4;
      const position: [number, number, number] =
        preset === "front"
          ? [center.x, center.y - distance, center.z]
          : preset === "right"
            ? [center.x + distance, center.y, center.z]
            : preset === "top"
              ? [center.x, center.y, center.z + distance]
              : [
                  center.x + distance * 0.62,
                  center.y - distance * 0.62,
                  center.z + distance * 0.5,
                ];
      activeCamera.position.set(...position);
      controls.current?.target.copy(center);
      activeCamera.lookAt(center);
      (activeCamera as any).updateProjectionMatrix();
    }
    controls.current?.update();
    if (controls.current)
      onTargetChange(controls.current.target.toArray() as Vec3);
  }, [fileCameras, onTargetChange, preset, scene, set, size.height, size.width]);
  useEffect(() => {
    if (!reviewCameraRequest) return;
    const saved = reviewCameraRequest.camera;
    const aspect = size.width / size.height;
    const replayCamera: ThreeCamera =
      saved.projection === "orthographic"
        ? new OrthographicCamera(
            -(saved.orthographicHeight ?? 10) * aspect * 0.5,
            (saved.orthographicHeight ?? 10) * aspect * 0.5,
            (saved.orthographicHeight ?? 10) * 0.5,
            -(saved.orthographicHeight ?? 10) * 0.5,
            0.01,
            10000,
          )
        : new PerspectiveCamera(saved.fov ?? 45, aspect, 0.01, 10000);
    replayCamera.position.fromArray(saved.position);
    replayCamera.quaternion.fromArray(saved.quaternion);
    if ((replayCamera as OrthographicCamera).isOrthographicCamera)
      (replayCamera as OrthographicCamera).zoom = saved.zoom ?? 1;
    (replayCamera as PerspectiveCamera | OrthographicCamera).updateProjectionMatrix();
    set({ camera: replayCamera as any });
    if (controls.current) {
      controls.current.object = replayCamera;
      controls.current.target.fromArray(saved.target);
      controls.current.update();
    }
    onTargetChange(saved.target);
  }, [onTargetChange, reviewCameraRequest, set, size.height, size.width]);
  useEffect(() => {
    const current = controls.current;
    if (!current) return;
    const onChange = () =>
      onTargetChange(current.target.toArray() as Vec3);
    current.addEventListener("change", onChange);
    return () => current.removeEventListener("change", onChange);
  }, [onTargetChange]);
  useEffect(() => {
    const element = gl.domElement;
    const chooseMiddleAction = (event: PointerEvent) => {
      if (!controls.current || event.button !== 1) return;
      controls.current.mouseButtons.MIDDLE = event.shiftKey
        ? MOUSE.PAN
        : MOUSE.ROTATE;
    };
    const restoreMiddleAction = () => {
      if (controls.current)
        controls.current.mouseButtons.MIDDLE = MOUSE.ROTATE;
    };
    element.addEventListener("pointerdown", chooseMiddleAction, true);
    window.addEventListener("pointerup", restoreMiddleAction);
    return () => {
      element.removeEventListener("pointerdown", chooseMiddleAction, true);
      window.removeEventListener("pointerup", restoreMiddleAction);
    };
  }, [gl]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      mouseButtons={{ LEFT: undefined, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN }}
    />
  );
}

function ReviewPanel({
  comments,
  selectedId,
  pending,
  body,
  readOnly,
  message,
  busy,
  onBody,
  onSelect,
  onSave,
  onCancel,
  onToggleStatus,
  onEdit,
}: {
  comments: ReviewComment[];
  selectedId: string | null;
  pending: PendingReview | null;
  body: string;
  readOnly: boolean;
  message: string | null;
  busy: boolean;
  onBody: (body: string) => void;
  onSelect: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onToggleStatus: (comment: ReviewComment) => void;
  onEdit: (comment: ReviewComment, body: string) => void;
}) {
  const selectedComment = comments.find((comment) => comment.id === selectedId);
  const [editBody, setEditBody] = useState("");
  useEffect(() => {
    setEditBody(selectedComment?.body ?? "");
  }, [selectedComment]);
  return (
    <div className="review-panel" data-testid="review-panel" aria-label="审稿批注" aria-readonly={readOnly}>
      <div className="review-panel-title">
        <span>审稿批注</span>
        <b data-testid="review-count">{comments.length}</b>
      </div>
      {pending && !readOnly && (
        <div className="review-compose" data-testid="review-draft">
          <span>落点：{pending.objectName ?? "模型表面"}</span>
          <textarea
            aria-label="批注内容"
            data-testid="review-body"
            autoFocus
            value={body}
            placeholder="输入需要修改或确认的内容"
            onChange={(event) => onBody(event.target.value)}
          />
          <div>
            <button onClick={onCancel}>取消</button>
            <button data-testid="review-save" className="primary" disabled={!body.trim() || busy} onClick={onSave}>
              保存批注
            </button>
          </div>
        </div>
      )}
      {message && <p className="review-message">{message}</p>}
      {selectedComment && !pending && !readOnly && (
        <div className="review-compose review-edit">
          <span>编辑批注 #{comments.indexOf(selectedComment) + 1}</span>
          <textarea
            aria-label="编辑批注内容"
            value={editBody}
            onChange={(event) => setEditBody(event.target.value)}
          />
          <div>
            <button
              className="primary"
              disabled={busy || !editBody.trim() || editBody.trim() === selectedComment.body}
              onClick={() => onEdit(selectedComment, editBody)}
            >
              保存修改
            </button>
          </div>
        </div>
      )}
      <div className="review-list">
        {comments.map((comment, index) => (
          <div
            key={comment.id}
            data-testid="review-item"
            data-comment-id={comment.id}
            className={`review-item ${selectedId === comment.id ? "selected" : ""}`}
          >
            <i>{index + 1}</i>
            <button className="review-item-main" onClick={() => onSelect(comment.id)}>
              <strong>{comment.body}</strong>
              <small>
                {comment.objectName ?? "模型表面"} · {comment.authorName}
              </small>
            </button>
            {!readOnly && (
              <button
                className="review-status"
                disabled={busy}
                onClick={() => onToggleStatus(comment)}
              >
                {comment.status === "open" ? "解决" : "重开"}
              </button>
            )}
          </div>
        ))}
        {!pending && comments.length === 0 && (
          <p className="review-empty">暂无批注</p>
        )}
      </div>
    </div>
  );
}

function ConversionSummary({ manifest }: { manifest: Manifest | null }) {
  const size = (bytes?: number) =>
    bytes ? `${(bytes / 1024).toFixed(1)} KB` : "准备导入后显示";
  return (
    <div className="conversion-summary">
      <p className="property-kicker">转换内容</p>
      <span>
        场景 <b>{manifest?.scene ?? "-"}</b>
      </span>
      <span>
        对象{" "}
        <b>{manifest?.export?.objectCount ?? manifest?.objects.length ?? 0}</b>
      </span>
      <span>
        原始文件 <b>{size(manifest?.export?.sourceBytes)}</b>
      </span>
      <span>
        Web GLB <b>{size(manifest?.export?.glbBytes)}</b>
      </span>
    </div>
  );
}
