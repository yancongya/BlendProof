import { Environment, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
  Box,
  Camera,
  ChevronDown,
  Circle,
  Eye,
  Focus,
  FolderOpen,
  Layers,
  Lightbulb,
  MessageSquarePlus,
  Palette,
  Settings2,
  Share2,
  SlidersHorizontal,
  Grid2X2,
  History,
  Trash2,
} from "lucide-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
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
import { UploaderPanel, type UploadStage } from "./components/UploaderPanel";
import { blendProofClient, type CloudOwnerProject, type OwnerProject, type ProjectTransport, type PublicStats } from "./api/blendProofClient";
import { ReviewAnnotations } from "./review/ReviewAnnotations";
import { useReviewComments } from "./review/useReviewComments";
import type {
  ReviewCameraState,
  ReviewComment,
  ReviewCommentDraft,
  Vec3,
} from "./reviewRepository";

type Project = OwnerProject;
type SceneObject = { name: string; type: string; collections: string[] };
type Manifest = {
  scene: string;
  camera?: string | null;
  cameras?: Array<{ name?: string; projection?: string }>;
  objects: SceneObject[];
  collections?: string[];
  materials?: Array<unknown> | number | null;
  sourceBytes?: number;
  glbBytes?: number;
  export?: { sourceBytes?: number; glbBytes?: number; objectCount?: number };
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
      const stored: unknown = JSON.parse(localStorage.getItem("blendproof:last-project") ?? "null");
      return isStoredProject(stored) ? stored : null;
    } catch {
      return null;
    }
  });
  const [recentProjects, setRecentProjects] = useState<Project[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("blendproof:recent-projects") ?? "[]");
      return Array.isArray(stored)
        ? stored.filter(isStoredProject).slice(0, 8)
        : [];
    } catch {
      return [];
    }
  });
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [cloudProject, setCloudProject] = useState<CloudOwnerProject | null>(null);
  const [publishTitle, setPublishTitle] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState(
    "选择 Blender 文件以建立本地审稿项目。",
  );
  const [processing, setProcessing] = useState(false);
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [sharePassword, setSharePassword] = useState("");
  const [shareHours, setShareHours] = useState("24");
  const [sharePermission, setSharePermission] = useState<"read_only" | "comment">("read_only");
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(false);
  const [publicStats, setPublicStats] = useState<PublicStats | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("material");
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("perspective");
  const openUploader = useCallback(() => {
    // Opening the file panel is always a fresh selection flow; the active Viewer project stays intact.
    setFile(null);
    setUploadStage("idle");
    setUploaderOpen(true);
  }, []);
  const closeUploader = useCallback(() => setUploaderOpen(false), []);
  const reviewProject = cloudProject ?? project;
  const reviews = useReviewComments(reviewProject?.id ?? null, reviewProject?.ownerCapability ?? null, cloudProject ? "cloud" : "local");
  useEffect(() => {
    let active = true;
    setManifest(null);
    if (project) {
      blendProofClient.loadJson<Manifest>(project.manifestUrl)
        .then((nextManifest) => {
          if (active) setManifest(nextManifest);
        })
        .catch((reason) => {
          if (!active) return;
          setMessage(reason instanceof Error ? reason.message : "无法读取本地项目。");
        });
    }
    return () => { active = false; };
  }, [project]);
  useEffect(() => {
    blendProofClient.publicStats().then(setPublicStats).catch(() => setPublicStats(null));
  }, [homeOpen]);
  useEffect(() => {
    if (manifest) setPublishTitle(manifest.scene || project?.name.replace(/\.blend$/i, "") || "");
  }, [manifest, project?.id, project?.name]);
  useEffect(() => {
    if (project) {
      localStorage.setItem("blendproof:last-project", JSON.stringify(project));
      setRecentProjects((current) => {
        const next = [project, ...current.filter((item) => item.id !== project.id)].slice(0, 8);
        localStorage.setItem("blendproof:recent-projects", JSON.stringify(next));
        return next;
      });
    }
  }, [project]);
  async function convert() {
    if (!file) return;
    setProcessing(true);
    setHomeOpen(false);
    setUploadStage("converting");
    setMessage("正在调用本机 Blender 导出 GLB。");
    try {
      const result = await blendProofClient.convertLocal(file);
      setProject(result);
      setHidden(new Set());
      setSelected(new Set());
      setShareUrl(null);
      setShareId(null);
      setShareExpiresAt(null);
      setCloudProject(null);
      setUploadStage("ready");
      setMessage("本机转换完成。");
    } catch (reason) {
      setUploadStage("error");
      setMessage(reason instanceof Error ? reason.message : "导入失败。");
    } finally {
      setProcessing(false);
    }
  }
  async function createShare() {
    const target = cloudProject ?? project;
    if (!target) return;
    try {
      const transport: ProjectTransport = cloudProject ? "cloud" : "local";
      const share = await blendProofClient.createShare(target.id, target.ownerCapability, {
        password: sharePassword || null,
        expiresAt: new Date(Date.now() + Number(shareHours) * 3_600_000).toISOString(),
        commentsPermission: sharePermission,
      }, transport);
      setShareUrl(cloudProject ? `${share.shareUrl}?source=cloud` : share.shareUrl);
      setShareId(share.id);
      setShareExpiresAt(share.expiresAt);
      setMessage(sharePermission === "comment"
        ? `已建立${cloudProject ? "云端" : "本地"}可评论分享链接。`
        : `已建立${cloudProject ? "云端" : "本地"}只读分享链接。`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "无法建立分享链接。");
    }
  }
  async function revokeShare() {
    const target = cloudProject ?? project;
    if (!target || !shareId) return;
    try {
      await blendProofClient.revokeShare(target.id, target.ownerCapability, shareId, cloudProject ? "cloud" : "local");
      setShareUrl(null);
      setShareId(null);
      setShareExpiresAt(null);
      setMessage("分享已撤销。");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "无法撤销分享。");
    }
  }
  async function publishCloud() {
    if (!project || !manifest) return;
    setProcessing(true);
    setUploadStage("uploading");
    setMessage("正在将 GLB 与裁剪后的清单发布到云端快递柜。");
    try {
      const published = await blendProofClient.publishCloud({
        name: publishTitle,
        modelUrl: project.modelUrl,
        manifestUrl: project.manifestUrl,
      });
      const cloudComments = await blendProofClient.listOwnerComments(published.id, published.ownerCapability, "cloud");
      for (const comment of reviews.comments) {
        const existing = cloudComments.find((item) => item.objectName === comment.objectName && item.body === comment.body &&
          item.authorName === comment.authorName && JSON.stringify(item.position) === JSON.stringify(comment.position));
        if (!existing) {
          const migrated = await blendProofClient.createOwnerComment(published.id, published.ownerCapability, {
            objectName: comment.objectName, position: comment.position, normal: comment.normal, camera: comment.camera,
            body: comment.body, authorName: comment.authorName,
          }, "cloud");
          if (comment.status === "resolved") await blendProofClient.updateOwnerComment(
            published.id, published.ownerCapability, migrated.id, { status: "resolved" }, "cloud",
          );
        } else if (comment.status === "resolved" && existing.status !== "resolved") {
          await blendProofClient.updateOwnerComment(
            published.id, published.ownerCapability, existing.id, { status: "resolved" }, "cloud",
          );
        }
      }
      setCloudProject(published);
      setShareUrl(null);
      setShareId(null);
      setShareExpiresAt(null);
      setUploadStage("published");
      setMessage("派生资产已发布到云端，可以创建审稿分享。");
    } catch (reason) {
      setUploadStage("publish_error");
      setMessage(reason instanceof Error ? reason.message : "云端发布失败，可安全重试。");
    } finally {
      setProcessing(false);
    }
  }
  function pick(nextFile: File | null) {
    setFile(nextFile);
    if (nextFile) {
      setUploadStage("selected");
      setMessage("文件已选择，点击导入即可开始。");
    } else {
      setUploadStage("idle");
      setMessage("选择 Blender 文件以建立本地审稿项目。");
    }
  }
  function switchProject(nextProject: Project) {
    setHomeOpen(false);
    setProject(nextProject);
    setManifest(null);
    setFile(null);
    setUploadStage("idle");
    setHidden(new Set());
    setSelected(new Set());
    setShareUrl(null);
    setShareId(null);
    setShareExpiresAt(null);
    setCloudProject(null);
    setPublishTitle(nextProject.name.replace(/\.blend$/i, ""));
    setUploadStage("ready");
    setUploaderOpen(true);
    setMessage(`已切换到本地项目：${nextProject.name}`);
  }
  async function deleteCurrentProject() {
    if (!project || cloudProject) return;
    if (!window.confirm(`确定删除本地项目“${project.name}”吗？此操作会移除转换文件和批注。`)) return;
    try {
      await blendProofClient.deleteLocalProject(project.id, project.ownerCapability);
      const next = recentProjects.filter((item) => item.id !== project.id);
      setRecentProjects(next);
      localStorage.setItem("blendproof:recent-projects", JSON.stringify(next));
      localStorage.removeItem("blendproof:last-project");
      setProject(null);
      setManifest(null);
      setCloudProject(null);
      setFile(null);
      setHomeOpen(true);
      setMessage("本地项目已删除。");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "无法删除本地项目。");
    }
  }
  function toggle(name: string) {
    setHidden((current) => {
      const next = new Set(current);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }
  if (homeOpen) {
    return (
      <StartPage
        recentProjects={recentProjects}
        stats={publicStats}
        onOpenFile={() => {
          setHomeOpen(false);
          openUploader();
        }}
        onProjectSelect={switchProject}
      />
    );
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
      modelUrl={manifest ? project?.modelUrl : undefined}
      readOnly={false}
      displayMode={displayMode}
      onDisplayMode={setDisplayMode}
      cameraPreset={cameraPreset}
      onCameraPreset={setCameraPreset}
      comments={reviews.comments}
      reviewError={reviews.error}
      onCreateComment={reviews.create}
      onUpdateComment={reviews.update}
      uploaderOpen={uploaderOpen}
      onOpenUploader={openUploader}
      onCloseUploader={closeUploader}
      onHome={() => setHomeOpen(true)}
      onDeleteProject={!cloudProject && project ? () => void deleteCurrentProject() : undefined}
      onOpenFileMenu={() => setSharePanelOpen(false)}
      uploader={
        <UploaderPanel
          file={file}
          stage={uploadStage}
          message={uploadStage === "idle" ? "选择 Blender 文件以建立本地审稿项目。" : message}
          manifest={manifest}
          processing={processing}
          shareUrl={shareUrl}
          shareExpiresAt={shareExpiresAt}
          onFile={pick}
          onConvert={() => void convert()}
          recentProjects={recentProjects}
          onProjectSelect={switchProject}
          publishTitle={publishTitle}
          onPublishTitle={setPublishTitle}
          onPublish={() => void publishCloud()}
        />
      }
    >
      <div className="share-menu-wrap">
        <button
          type="button"
          className="menu-item share-trigger"
          disabled={!project}
          aria-haspopup="dialog"
          aria-expanded={sharePanelOpen}
          onClick={() => setSharePanelOpen((current) => !current)}
        >
          <Share2 size={13} /> 分享
        </button>
        {sharePanelOpen && (
          <form className="share-panel" role="dialog" aria-label="分享设置" onSubmit={(event) => { event.preventDefault(); void createShare(); }}>
            <div className="share-panel-title"><Share2 size={14} /> 分享当前项目</div>
            <label className="share-setting">
              <span>密码</span>
              <input aria-label="分享密码" type="password" value={sharePassword} placeholder="可选" onChange={(event) => setSharePassword(event.target.value)} />
            </label>
            <label className="share-setting">
              <span>有效期</span>
              <select aria-label="分享有效期" value={shareHours} onChange={(event) => setShareHours(event.target.value)}>
                <option value="6">6 小时</option><option value="24">24 小时（推荐）</option><option value="48">48 小时（最长）</option>
              </select>
            </label>
            <label className="share-setting">
              <span>权限</span>
              <select aria-label="分享评论权限" value={sharePermission} onChange={(event) => setSharePermission(event.target.value as "read_only" | "comment")}>
                <option value="read_only">只读</option><option value="comment">可评论</option>
              </select>
            </label>
            <button type="submit" className="share-panel-primary">
              <Share2 size={13} /> {cloudProject ? "创建云端分享" : "创建本地分享"}
            </button>
            {shareUrl && (
              <a className="share-panel-link" href={shareUrl} target="_blank" rel="noreferrer">
                {sharePermission === "comment" ? "打开可评论分享" : "打开只读分享"}
              </a>
            )}
            {shareId && <button type="button" className="share-panel-revoke" onClick={() => void revokeShare()}>撤销分享</button>}
          </form>
        )}
      </div>
    </BlenderWorkspace>
  );
}

export function SharePage() {
  const token = window.location.pathname.split("/").filter(Boolean).at(-1);
  const transport: ProjectTransport = new URLSearchParams(window.location.search).get("source") === "cloud" ? "cloud" : "local";
  const [share, setShare] = useState<{
    name: string;
    modelUrl: string;
    manifest: Manifest;
    comments: ReviewComment[];
    commentsPermission: "read_only" | "comment";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [displayMode, setDisplayMode] = useState<DisplayMode>("material");
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("perspective");
  const loadShare = useCallback(() => {
    if (!token) return setError("缺少分享标识。");
    setError(null);
    blendProofClient.loadShare<Manifest>(token, transport)
      .then((body) => {
        setPasswordRequired(false);
        setShare(body);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "无法读取分享。"),
      );
  }, [token, transport]);
  useEffect(() => {
    if (!token) return setError("缺少分享标识。");
    blendProofClient.shareStatus(token, transport)
      .then((body) => {
        if (body.passwordRequired) setPasswordRequired(true);
        else loadShare();
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "无法读取分享。"));
  }, [loadShare, token, transport]);
  async function unlockShare() {
    if (!token) return setError("缺少分享标识。");
    try {
      await blendProofClient.unlockShare(token, password, transport);
      loadShare();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "密码验证失败。");
    }
  }
  async function createGuestComment(draft: ReviewCommentDraft) {
    if (!token) throw new Error("缺少分享标识。");
    const comment = await blendProofClient.createGuestComment(token, draft, transport);
    setShare((current) => current ? { ...current, comments: [...current.comments, comment] } : current);
    return comment;
  }
  if (passwordRequired) return <PasswordNotice password={password} error={error} onPassword={setPassword} onSubmit={unlockShare} />;
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
      message={share.commentsPermission === "comment" ? "访客可在模型表面添加批注。" : transport === "cloud" ? "只读分享。文件由云端 BlendProof 提供。" : "只读分享。文件由本机 BlendProof 提供。"}
      modelUrl={share.modelUrl}
      readOnly
      canComment={share.commentsPermission === "comment"}
      commentAuthorName="访客"
      displayMode={displayMode}
      onDisplayMode={setDisplayMode}
      cameraPreset={cameraPreset}
      onCameraPreset={setCameraPreset}
      comments={share.comments}
      reviewError={null}
      onCreateComment={share.commentsPermission === "comment" ? createGuestComment : undefined}
    >
      <span>{share.commentsPermission === "comment" ? "可评论审稿" : "只读审稿"}</span>
    </BlenderWorkspace>
  );
}

function PasswordNotice({ password, error, onPassword, onSubmit }: { password: string; error: string | null; onPassword: (value: string) => void; onSubmit: () => void }) {
  return <div className="notice"><BlenderLogo /><h1>受保护的审稿链接</h1><p>{error ?? "请输入分享密码后继续。"}</p><input aria-label="访问密码" type="password" value={password} autoFocus onChange={(event) => onPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSubmit(); }} /><button className="primary" onClick={onSubmit}>打开审稿</button></div>;
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

function StartPage({
  recentProjects,
  stats,
  onOpenFile,
  onProjectSelect,
}: {
  recentProjects: Project[];
  stats: PublicStats | null;
  onOpenFile: () => void;
  onProjectSelect: (project: Project) => void;
}) {
  return (
    <main className="blendproof-start-page" data-testid="start-page">
      <section className="start-card">
        <div className="start-brand"><BlenderLogo /><span>BlendProof</span></div>
        <p className="start-eyebrow">WEB 3D REVIEW DESK</p>
        <h1>开始一次清晰的审稿。</h1>
        <p className="start-intro">在本机转换 Blender 工程，保留模型上下文，再把轻量预览交给协作者。</p>
        <div className="start-stats" aria-label="公益存储池状态">
          <span><strong>{stats ? formatBytes(stats.remainingBytes) : "—"}</strong><small>公益池可用 / 5 GB</small></span>
          <span><strong>{stats?.projectCount ?? "—"}</strong><small>在线项目</small></span>
          <span><strong>{stats?.activeShareCount ?? "—"}</strong><small>有效分享</small></span>
          <span><strong>{stats?.userCount ?? "—"}</strong><small>已识别用户</small></span>
        </div>
        <p className="start-retention">建议 24 小时内完成审稿，云端派生资产最长保留 48 小时后自动清理。</p>
        <button type="button" className="start-open-button" onClick={onOpenFile}>
          <FolderOpen size={17} /> 打开 .blend 文件
        </button>
        <div className="start-divider"><span>最近项目</span></div>
        {recentProjects.length ? (
          <div className="start-recent-list">
            {recentProjects.slice(0, 6).map((item) => (
              <button type="button" className="start-recent-item" key={item.id} onClick={() => onProjectSelect(item)}>
                <FileIcon />
                <span><strong>{item.name}</strong><small>本地项目 · {item.id.slice(0, 6)}</small></span>
                <ChevronDown size={14} className="start-recent-arrow" />
              </button>
            ))}
          </div>
        ) : (
          <p className="start-empty">还没有最近项目。打开一个 .blend 文件开始。</p>
        )}
        <p className="start-footnote">项目数据保存在本机。云端分享只发送派生的 Web 预览资产。</p>
      </section>
    </main>
  );
}

function FileIcon() {
  return <span className="start-file-icon"><Box size={15} /></span>;
}

function ClockIcon() {
  return <History size={14} />;
}

function TrashIcon() {
  return <Trash2 size={14} />;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, bytes)} B`;
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
  canComment = !readOnly,
  commentAuthorName = "本地创建者",
  displayMode,
  onDisplayMode,
  cameraPreset,
  onCameraPreset,
  comments,
  reviewError,
  onCreateComment,
  onUpdateComment,
  uploaderOpen = false,
  onOpenUploader,
  onCloseUploader,
  onHome,
  onDeleteProject,
  onOpenFileMenu,
  uploader,
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
  canComment?: boolean;
  commentAuthorName?: string;
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
  uploaderOpen?: boolean;
  onOpenUploader?: () => void;
  onCloseUploader?: () => void;
  onHome?: () => void;
  onDeleteProject?: () => void;
  onOpenFileMenu?: () => void;
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
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState<Vec3>([0, 0, 0]);
  const [reviewCameraRequest, setReviewCameraRequest] = useState<{
    camera: ReviewCameraState;
    nonce: number;
  } | null>(null);
  const uploaderTriggerRef = useRef<HTMLButtonElement>(null);
  const uploaderCloseRef = useRef<HTMLButtonElement>(null);
  const uploaderDialogRef = useRef<HTMLElement>(null);
  const uploaderWasOpenRef = useRef(false);
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
        toggleIsolation();
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
  }, [onCameraPreset, selected, toggleIsolation]);
  useEffect(() => {
    if (!uploaderOpen) {
      if (uploaderWasOpenRef.current && onOpenUploader) uploaderTriggerRef.current?.focus();
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
  function handleUploaderDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
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
        <button
          type="button"
          className="brand-mark"
          aria-label="返回 BlendProof 启动页"
          onClick={onHome}
        >
          <BlenderLogo />
          <span>BlendProof</span>
        </button>
        {uploader && onOpenUploader && (
          <div className="file-menu-wrap">
            <button
              ref={uploaderTriggerRef}
              type="button"
              className="menu-item file-menu-trigger"
              data-testid="open-uploader"
              aria-haspopup="menu"
              aria-expanded={fileMenuOpen}
              title="文件菜单"
              onClick={() => setFileMenuOpen((current) => {
                if (!current) onOpenFileMenu?.();
                return !current;
              })}
            >
              <FolderOpen size={13} /> 文件 <ChevronDown size={11} />
            </button>
            {fileMenuOpen && (
              <div className="file-menu" role="menu" aria-label="文件菜单">
                <button type="button" role="menuitem" onClick={() => { setFileMenuOpen(false); onOpenUploader(); }}>
                  <FolderOpen size={14} /> 打开上传工作台
                </button>
                <button type="button" role="menuitem" onClick={() => { setFileMenuOpen(false); onOpenUploader(); }}>
                  <ClockIcon /> 最近项目
                </button>
                <div className="file-menu-separator" />
                <button type="button" role="menuitem" disabled={!onDeleteProject} onClick={() => { setFileMenuOpen(false); onDeleteProject?.(); }}>
                  <TrashIcon /> 删除当前本地项目
                </button>
              </div>
            )}
          </div>
        )}
        <div className="project-name">{title}</div>
        <div className="header-actions">
          {children ?? <span>只读审稿</span>}
        </div>
      </header>
      <div className="blender-main">
        <section className="editor">
          <div className="editor-header">
            <div className="editor-type" aria-label="3D 视图">
              <Box size={14} /> 3D 视图
            </div>
            {canComment && modelUrl && (
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
                    onIsolationInvalid={() => setIsolated(false)}
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
                  <button
                    type="button"
                    className={`isolate ${isolated && selected.size === 1 && selected.has(object.name) ? "active" : ""}`}
                    aria-label={isolated && selected.size === 1 && selected.has(object.name) ? `退出 ${object.name} 的独显` : `独显 ${object.name}`}
                    title={isolated && selected.size === 1 && selected.has(object.name) ? "退出独显" : "独显此对象"}
                    onClick={(event) => {
                      event.stopPropagation();
                      isolateOutlinerObject(object.name);
                    }}
                  >
                    <Focus />
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
            {active && (
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
            )}
            <ConversionSummary manifest={manifest} />
            <ReviewPanel
              comments={comments}
              selectedId={selectedCommentId}
              pending={pendingReview}
              body={commentBody}
              readOnly={readOnly}
              canComment={canComment}
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
      {uploader && uploaderOpen && (
        <div
          className="uploader-modal-backdrop"
          data-testid="uploader-modal"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) onCloseUploader?.();
          }}
        >
          <section
            ref={uploaderDialogRef}
            id="uploader-dialog"
            className="uploader-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="uploader-dialog-title"
            onKeyDown={handleUploaderDialogKeyDown}
          >
            <div className="uploader-dialog-bar">
              <h2 id="uploader-dialog-title">文件 / 打开 .blend</h2>
              <button
                ref={uploaderCloseRef}
                type="button"
                className="uploader-dialog-close"
                data-testid="close-uploader"
                aria-label="关闭上传工作台"
                onClick={onCloseUploader}
              >
                ×
              </button>
            </div>
            {uploader}
          </section>
        </div>
      )}
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
  onIsolationInvalid,
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
  onIsolationInvalid: () => void;
  selectableNames: Set<string>;
  onObjectClick: (name: string | null) => void;
  onCameras: (cameras: ThreeCamera[]) => void;
  onSceneReady: (scene: Object3D) => void;
  annotationMode: boolean;
  navigationTarget: Vec3;
  onAnnotation: (draft: PendingReview) => void;
}) {
  const { camera } = useThree();
  const requestHeaders = useMemo(() => blendProofClient.assetRequestHeaders(url), [url]);
  const gltf = useGLTF(url, true, true, (loader) => loader.setRequestHeader(requestHeaders));
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const selectedInScene = useMemo(() => {
    const names = new Set<string>();
    scene.traverse((node) => {
      const identity = objectIdentity(node);
      if (selected.has(identity)) names.add(identity);
    });
    return names;
  }, [scene, selected]);
  const isolationHierarchy = useMemo(() => {
    const nodes = new Set<Object3D>();
    if (!isolated || selectedInScene.size === 0) return nodes;

    scene.traverse((node) => {
      if (!selected.has(objectIdentity(node))) return;
      // A visible descendant still needs every parent in the render tree to
      // remain visible. Include both directions around every selected node.
      node.traverse((descendant) => nodes.add(descendant));
      let ancestor: Object3D | null = node;
      while (ancestor) {
        nodes.add(ancestor);
        ancestor = ancestor.parent;
      }
    });
    return nodes;
  }, [isolated, scene, selected, selectedInScene]);
  // A stale manifest/outliner name must not turn local view into an empty scene.
  const hasRenderableIsolation = useMemo(
    () => [...isolationHierarchy].some((node) => "isMesh" in node && Boolean((node as Object3D & { isMesh?: boolean }).isMesh)),
    [isolationHierarchy],
  );
  const effectiveIsolation = isolated && selectedInScene.size > 0 && hasRenderableIsolation;
  useEffect(() => {
    if (isolated && selected.size > 0 && (selectedInScene.size === 0 || !hasRenderableIsolation))
      onIsolationInvalid();
  }, [hasRenderableIsolation, isolated, onIsolationInvalid, selected.size, selectedInScene]);
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
      const belongsToIsolation = isolationHierarchy.has(node);
      // In Blender-style local view the selected target remains visible even
      // if it was hidden in the global outliner before entering local view.
      node.visible = effectiveIsolation
        ? belongsToIsolation
        : !hidden.has(objectIdentity(node));
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
  }, [
    displayMode,
    effectiveIsolation,
    hidden,
    isolationHierarchy,
    scene,
    selected,
  ]);
  return (
    <primitive
      object={scene}
      onClick={(event: any) => {
        event.stopPropagation();
        let node: Object3D | null = event.object;
        while (node && !selectableNames.has(objectIdentity(node))) node = node.parent;
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
            objectName: node ? objectIdentity(node) : null,
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
        onObjectClick(node ? objectIdentity(node) : null);
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
    const identity = objectIdentity(current);
    if (selectableNames.has(identity)) return identity;
    current = current.parent;
  }
  return null;
}

function belongsToAnySelected(node: Object3D, selected: Set<string>) {
  let current: Object3D | null = node;
  while (current) {
    if (selected.has(objectIdentity(current))) return true;
    current = current.parent;
  }
  return false;
}

function objectIdentity(node: Object3D) {
  return typeof node.userData?.name === "string" && node.userData.name
    ? node.userData.name
    : node.name;
}

function isStoredProject(value: unknown): value is Project {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(item.id) &&
    typeof item.name === "string" && item.name.length > 0 && item.name.length <= 512 &&
    typeof item.ownerCapability === "string" && item.ownerCapability.length > 0 &&
    typeof item.modelUrl === "string" && isLocalBridgeResource(item.modelUrl) &&
    typeof item.manifestUrl === "string" && isLocalBridgeResource(item.manifestUrl);
}

function isLocalBridgeResource(value: string) {
  if (value.startsWith("/api/local/")) return true;
  try {
    const url = new URL(value);
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") &&
      url.pathname.startsWith("/api/local/");
  } catch { return false; }
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
      // OrbitControls reverses ROTATE/PAN when a modifier is present. Keep
      // Shift on ROTATE so its internal modifier branch yields PAN; invert
      // only Ctrl/Meta so they keep Blender's ordinary MMB rotation.
      controls.current.mouseButtons.MIDDLE = !event.shiftKey && (event.ctrlKey || event.metaKey)
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
  canComment,
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
  canComment: boolean;
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
      {pending && canComment && (
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
    bytes !== undefined ? `${(bytes / 1024).toFixed(1)} KB` : "准备导入后显示";
  return (
    <div className="conversion-summary">
      <p className="property-kicker">转换内容</p>
      <span>
        场景 <b>{manifest?.scene ?? "-"}</b>
      </span>
      <span>
        集合 <b>{manifest?.collections?.length ?? 0}</b>
      </span>
      <span>
        对象{" "}
        <b>{manifest?.export?.objectCount ?? manifest?.objects.length ?? 0}</b>
      </span>
      <span>
        相机 <b>{manifest?.cameras?.length ?? (manifest?.camera ? 1 : 0)}</b>
      </span>
      <span>
        材质 <b>{Array.isArray(manifest?.materials) ? manifest.materials.length : manifest?.materials ?? 0}</b>
      </span>
      <span>
        原始文件 <b>{size(manifest?.export?.sourceBytes ?? manifest?.sourceBytes)}</b>
      </span>
      <span>
        Web GLB <b>{size(manifest?.export?.glbBytes ?? manifest?.glbBytes)}</b>
      </span>
    </div>
  );
}
