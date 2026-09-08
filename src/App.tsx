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
  MOUSE,
  Vector3,
  type Camera as ThreeCamera,
  type Object3D,
} from "three";
import { BlenderLogo } from "./components/BlenderLogo";

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

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [project, setProject] = useState<Project | null>(null);
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
  useEffect(() => {
    if (project)
      fetch(project.manifestUrl)
        .then((res) => res.json())
        .then(setManifest);
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
  const collectCameras = useCallback(
    (cameras: ThreeCamera[]) => setFileCameras(cameras),
    [],
  );
  useEffect(() => {
    if (selected.size === 0) setIsolated(false);
  }, [selected]);
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
  return (
    <main className="blender-shell">
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
          <div className="viewport">
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
                  />
                  <Environment preset="city" />
                </Suspense>
                <BlenderViewControls
                  preset={cameraPreset}
                  fileCameras={fileCameras}
                />
                <BoxSelectionController
                  scene={sceneRoot}
                  selectableNames={
                    new Set(manifest?.objects.map((object) => object.name))
                  }
                  onSelectMany={onSelectMany}
                  onBoxChange={setSelectionBox}
                />
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
}) {
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
  useEffect(() => {
    const element = gl.domElement;
    const point = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      start.current = point(event);
    };
    const onMove = (event: PointerEvent) => {
      if (!start.current) return;
      const end = point(event);
      const left = Math.min(start.current.x, end.x);
      const top = Math.min(start.current.y, end.y);
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
        const position = new Vector3()
          .setFromMatrixPosition(node.matrixWorld)
          .project(camera);
        const x = ((position.x + 1) / 2) * size.width;
        const y = ((1 - position.y) / 2) * size.height;
        if (x >= left && x <= right && y >= top && y <= bottom)
          selected.add(name);
      });
      onSelectMany([...selected]);
    };
    element.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      element.removeEventListener("pointerdown", onDown);
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
}: {
  preset: CameraPreset;
  fileCameras: ThreeCamera[];
}) {
  const { camera } = useThree();
  const controls = useRef<any>(null);
  useEffect(() => {
    const source = preset.startsWith("file:")
      ? fileCameras.find((item) => item.uuid === preset.slice(5))
      : undefined;
    if (source) {
      source.updateWorldMatrix(true, false);
      source.getWorldPosition(camera.position);
      source.getWorldQuaternion(camera.quaternion);
      const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      controls.current?.target
        .copy(camera.position)
        .add(forward.multiplyScalar(10));
    } else {
      const position: [number, number, number] =
        preset === "front"
          ? [0, -8, 0]
          : preset === "right"
            ? [8, 0, 0]
            : preset === "top"
              ? [0, 0, 8]
              : [5, -5, 4];
      camera.position.set(...position);
      controls.current?.target.set(0, 0, 0);
      camera.lookAt(0, 0, 0);
    }
    controls.current?.update();
    camera.updateProjectionMatrix();
  }, [camera, fileCameras, preset]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      mouseButtons={{ LEFT: undefined, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN }}
    />
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
