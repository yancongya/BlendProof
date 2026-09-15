import { Environment, Grid, Line, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
  Box,
  Camera,
  ChevronDown,
  Circle,
  CheckCircle2,
  Copy,
  Eye,
  Focus,
  FolderOpen,
  Layers,
  Lightbulb,
  MessageSquarePlus,
  Palette,
  Search,
  Settings2,
  Share2,
  SlidersHorizontal,
  Grid2X2,
  History,
  HardDrive,
  KeyRound,
  Link2,
  LogIn,
  LogOut,
  ShieldCheck,
  Trash2,
  User,
  X,
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
  DoubleSide,
  Matrix3,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  type Camera as ThreeCamera,
  type Object3D,
} from "three";
import { BlenderLogo } from "./components/BlenderLogo";
import { getLang, t, tf, useI18n } from "./i18n";
import { MenubarActions, SplashActions } from "./components/TopActions";
import { UploaderPanel, type UploadStage } from "./components/UploaderPanel";
import { blendProofClient, type AccountStats, type AccountUser, type AdminInvite, type AdminSettings, type AdminUser, type CloudOwnerProject, type OwnerProject, type ProjectTransport, type PublicStats } from "./api/blendProofClient";
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
type ReviewFilter = "all" | "open" | "resolved";
type CameraPreset =
  "perspective" | "front" | "right" | "top" | `file:${string}`;
type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
} | null;
type PendingReview = Omit<ReviewCommentDraft, "body" | "authorName">;
type ActiveShareStatus = {
  expiresAt: string | null;
  permission: "read_only" | "comment";
};
type SharedViewState = {
  version: 1;
  camera: ReviewCameraState;
  displayMode: DisplayMode;
  hidden: string[];
  selected: string[];
};
const DEFAULT_MONKEY_MANIFEST: Manifest = {
  scene: "Suzanne 演示",
  camera: null,
  cameras: [],
  objects: [{ name: "苏珊娜", type: "MESH", collections: ["Collection"] }],
  collections: ["Collection"],
  materials: ["Material"],
  export: { glbBytes: 69708, objectCount: 1 },
};
const DEMO_SHARE_TOKEN = "suzanne";
const DEMO_SHARE_URL = `/s/${DEMO_SHARE_TOKEN}`;
const DEMO_SHARE_PASSWORD = "tycon";

function formatShareExpiry(expiresAt: string | null) {
  if (!expiresAt) return t("不限时");
  return new Intl.DateTimeFormat(getLang() === "en" ? "en-US" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(expiresAt));
}

function encodeSharedView(state: SharedViewState) {
  return `#view=${encodeURIComponent(JSON.stringify(state))}`;
}

function isFiniteTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function readSharedView(): SharedViewState | null {
  const raw = new URLSearchParams(window.location.hash.slice(1)).get("view");
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SharedViewState>;
    const camera = value.camera;
    const validNames = (items: unknown) => Array.isArray(items) && items.length <= 10000 &&
      items.every((item) => typeof item === "string" && item.length <= 256);
    if (value.version !== 1 || !camera || !["perspective", "orthographic"].includes(camera.projection) ||
      !isFiniteTuple(camera.position, 3) || !isFiniteTuple(camera.quaternion, 4) || !isFiniteTuple(camera.target, 3) ||
      !["material", "gray", "wire"].includes(value.displayMode ?? "") ||
      !validNames(value.hidden) || !validNames(value.selected)) return null;
    return value as SharedViewState;
  } catch {
    return null;
  }
}

function SenderShareCard({
  url,
  expiresAt,
  permission,
  protectedByPassword,
}: {
  url: string;
  expiresAt: string | null;
  permission: "read_only" | "comment";
  protectedByPassword: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="share-credential-card sender-card" aria-label="发送方分享凭证">
      <header><span>审稿凭证</span><b>已就绪</b></header>
      <div className="share-credential-code">{url.split("/s/").at(-1)?.split(/[?#]/)[0] ?? url}</div>
      <dl>
        <div><dt>权限</dt><dd>{permission === "comment" ? "可评论" : "只读"}</dd></div>
        <div><dt>到期</dt><dd>{formatShareExpiry(expiresAt)}</dd></div>
        <div><dt>密码</dt><dd>{protectedByPassword ? "已设置" : "无"}</dd></div>
      </dl>
      <div className="share-credential-actions">
        <button type="button" onClick={async () => {
          await navigator.clipboard.writeText(new URL(url, window.location.origin).toString());
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        }}>{copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}{copied ? "已复制" : "复制链接"}</button>
        <a href={url} target="_blank" rel="noreferrer">打开检查</a>
      </div>
    </section>
  );
}

function ReceiverShareCard({
  permission,
  expiresAt,
  transport,
  publisher,
  sourceLabel,
}: {
  permission: "read_only" | "comment";
  expiresAt: string | null;
  transport: ProjectTransport;
  publisher?: string;
  sourceLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="receiver-card-wrap">
      <button type="button" className="receiver-card-trigger" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ShieldCheck size={13} /> {permission === "comment" ? "可评论审稿" : "只读审稿"}
      </button>
      {open && (
        <section className="share-credential-card receiver-card" aria-label="接收方审稿凭证">
          <header><span>审稿通行证</span><b>访问有效</b></header>
          <p>{publisher ? tf("%s发布的永久公开示例。", publisher) : "此页面只读取派生的 Web 模型，不包含原始 Blender 工程。"}</p>
          <dl>
            <div><dt>权限</dt><dd>{permission === "comment" ? "查看与批注" : "仅查看"}</dd></div>
            <div><dt>来源</dt><dd>{sourceLabel ?? (transport === "cloud" ? "云端快递柜" : "本机分享")}</dd></div>
            <div><dt>到期</dt><dd>{formatShareExpiry(expiresAt)}</dd></div>
          </dl>
        </section>
      )}
    </div>
  );
}

export function App() {
  useI18n(); // re-render on language toggle so t()/tf() strings stay in sync
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
  const [homeOpen, setHomeOpen] = useState(true);
  const [publicStats, setPublicStats] = useState<PublicStats | null>(null);
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [accountStats, setAccountStats] = useState<AccountStats | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("material");
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("perspective");
  const [currentCamera, setCurrentCamera] = useState<ReviewCameraState | null>(null);
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
    let active = true;
    const refreshPublicStats = () => blendProofClient.publicStats()
      .then((next) => { if (active) setPublicStats(next); })
      .catch(() => { if (active) setPublicStats(null); });
    void refreshPublicStats();
    const interval = homeOpen ? window.setInterval(refreshPublicStats, 30_000) : undefined;
    blendProofClient.currentUser().then(async (user) => {
      if (!active) return null;
      setAccount(user);
      return user ? blendProofClient.accountStats() : null;
    }).then((next) => { if (active) setAccountStats(next); }).catch(() => {
      if (!active) return;
      setAccount(null);
      setAccountStats(null);
    });
    return () => {
      active = false;
      if (interval !== undefined) window.clearInterval(interval);
    };
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
    setMessage("正在浏览器本地读取并转换 Blender 文件。");
    try {
      let result: Project;
      try {
        result = await blendProofClient.convertInBrowser(file);
      } catch (browserReason) {
        setMessage("浏览器转换不适用于此文件，正在切换本机 Blender。");
        result = await blendProofClient.convertLocal(file);
      }
      setProject(result);
      setHidden(new Set());
      setSelected(new Set());
      setShareUrl(null);
      setShareId(null);
      setShareExpiresAt(null);
      setCloudProject(null);
      setUploadStage("ready");
      setMessage(result.id.startsWith("browser-") ? "浏览器本地转换完成。" : "本机 Blender 转换完成。");
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
      const baseUrl = cloudProject ? `${share.shareUrl}?source=cloud` : share.shareUrl;
      const view = currentCamera ? encodeSharedView({
        version: 1,
        camera: currentCamera,
        displayMode,
        hidden: [...hidden],
        selected: [...selected],
      }) : "";
      setShareUrl(`${baseUrl}${view}`);
      setShareId(share.id);
      setShareExpiresAt(share.expiresAt);
      setMessage(sharePermission === "comment"
        ? tf("已建立%s可评论分享链接。", cloudProject ? t("云端") : t("本地"))
        : tf("已建立%s只读分享链接。", cloudProject ? t("云端") : t("本地")));
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
    setMessage(tf("已切换到本地项目：%s", nextProject.name));
  }
  async function deleteCurrentProject() {
    if (!project || cloudProject) return;
    if (!window.confirm(tf("确定删除本地项目“%s”吗？此操作会移除转换文件和批注。", project.name))) return;
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
  const workspaceManifest = manifest ?? (!project ? DEFAULT_MONKEY_MANIFEST : null);
  const workspaceModelUrl = manifest ? project?.modelUrl : !project ? "/default-monkey.glb" : undefined;
  if (homeOpen) {
    return (
      <>
      <BlenderWorkspace
        title={project?.name ?? file?.name ?? "Suzanne 演示"} manifest={workspaceManifest} hidden={hidden} selected={selected}
        shareStatus={shareUrl ? { expiresAt: shareExpiresAt, permission: sharePermission } : !project ? { expiresAt: null, permission: "read_only" } : null}
        onSelect={(name) => setSelected(name ? new Set([name]) : new Set())} onSelectMany={(names) => setSelected(new Set(names))}
        onToggle={toggle} message={message} modelUrl={workspaceModelUrl} readOnly={false} canComment={Boolean(project)}
        displayMode={displayMode} onDisplayMode={setDisplayMode} cameraPreset={cameraPreset} onCameraPreset={setCameraPreset}
        comments={reviews.comments} reviewError={reviews.error} reviewNewCount={reviews.newCount} onAcknowledgeReview={reviews.acknowledgeNew} onCreateComment={reviews.create} onUpdateComment={reviews.update}
        onViewStateChange={setCurrentCamera}
        onOpenUploader={openUploader} onHome={() => setHomeOpen(true)} recentProjects={recentProjects} onProjectSelect={switchProject}
      />
      <StartPage
        recentProjects={recentProjects}
        stats={publicStats}
        account={account}
        accountStats={accountStats}
        onOpenFile={() => {
          setHomeOpen(false);
          openUploader();
        }}
        onProjectSelect={switchProject}
        onLogin={async (email, password) => {
          const user = await blendProofClient.login(email, password);
          setAccount(user);
          setAccountStats(await blendProofClient.accountStats());
        }}
        onRegister={async (input) => {
          const user = await blendProofClient.register(input);
          setAccount(user);
          setAccountStats(await blendProofClient.accountStats());
        }}
        onLogout={async () => {
          await blendProofClient.logout();
          setAccount(null);
          setAccountStats(null);
        }}
        onCreateInvite={(expiresInHours, maxUses) => blendProofClient.createInvite(expiresInHours, maxUses)}
        onClose={() => setHomeOpen(false)}
      />
      </>
    );
  }
  return (
    <BlenderWorkspace
      title={project?.name ?? file?.name ?? "Suzanne 演示"}
      shareStatus={shareUrl ? { expiresAt: shareExpiresAt, permission: sharePermission } : !project ? { expiresAt: null, permission: "read_only" } : null}
      manifest={workspaceManifest}
      hidden={hidden}
      selected={selected}
      onSelect={(name) => setSelected(name ? new Set([name]) : new Set())}
      onSelectMany={(names) => setSelected(new Set(names))}
      onToggle={toggle}
      message={message}
      modelUrl={workspaceModelUrl}
      readOnly={false}
      canComment={Boolean(project)}
      displayMode={displayMode}
      onDisplayMode={setDisplayMode}
      cameraPreset={cameraPreset}
      onCameraPreset={setCameraPreset}
      comments={reviews.comments}
      reviewError={reviews.error}
      reviewNewCount={reviews.newCount}
      onAcknowledgeReview={reviews.acknowledgeNew}
      onCreateComment={reviews.create}
      onUpdateComment={reviews.update}
      onViewStateChange={setCurrentCamera}
      uploaderOpen={uploaderOpen}
      onOpenUploader={openUploader}
      onCloseUploader={closeUploader}
      onHome={() => setHomeOpen(true)}
      onDeleteProject={!cloudProject && project ? () => void deleteCurrentProject() : undefined}
      onOpenFileMenu={() => setSharePanelOpen(false)}
      recentProjects={recentProjects}
      onProjectSelect={switchProject}
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
          aria-haspopup="dialog"
          aria-expanded={sharePanelOpen}
          onClick={() => setSharePanelOpen((current) => !current)}
        >
          <Share2 size={13} /> 分享
        </button>
        {sharePanelOpen && (
          <form className="share-panel" role="dialog" aria-label="分享设置" onSubmit={(event) => { event.preventDefault(); void createShare(); }}>
            {!project ? <>
              <div className="share-panel-title"><Share2 size={14} /> 管理员公开示例</div>
              <p className="demo-share-note">Suzanne 由平台管理员长期公开，不占用用户空间，也不会随普通项目自动清理。</p>
              <SenderShareCard
                url={DEMO_SHARE_URL}
                expiresAt={null}
                permission="read_only"
                protectedByPassword
              />
              <p className="demo-share-password">访问密码 <code>{DEMO_SHARE_PASSWORD}</code></p>
            </> : <>
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
              <SenderShareCard
                url={shareUrl}
                expiresAt={shareExpiresAt}
                permission={sharePermission}
                protectedByPassword={Boolean(sharePassword)}
              />
            )}
            {shareId && <button type="button" className="share-panel-revoke" onClick={() => void revokeShare()}>撤销分享</button>}
            </>}
          </form>
        )}
      </div>
    </BlenderWorkspace>
  );
}

export function SharePage() {
  const token = window.location.pathname.split("/").filter(Boolean).at(-1);
  const sharedView = useMemo(readSharedView, []);
  const transport: ProjectTransport = new URLSearchParams(window.location.search).get("source") === "cloud" ? "cloud" : "local";
  const isDemoShare = token === DEMO_SHARE_TOKEN;
  const [share, setShare] = useState<{
    name: string;
    modelUrl: string;
    manifest: Manifest;
    comments: ReviewComment[];
    commentsPermission: "read_only" | "comment";
    expiresAt: string | null;
  } | null>(() => isDemoShare ? {
    name: DEFAULT_MONKEY_MANIFEST.scene,
    modelUrl: "/default-monkey.glb",
    manifest: DEFAULT_MONKEY_MANIFEST,
    comments: [],
    commentsPermission: "read_only",
    expiresAt: null,
  } : null);
  const [error, setError] = useState<string | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(isDemoShare);
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sharedView?.selected ?? []));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(sharedView?.hidden ?? []));
  const [displayMode, setDisplayMode] = useState<DisplayMode>(sharedView?.displayMode ?? "material");
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("perspective");
  const restoredSharedSelectionRef = useRef(false);
  useEffect(() => {
    if (passwordRequired || !share || !sharedView || restoredSharedSelectionRef.current) return;
    restoredSharedSelectionRef.current = true;
    setSelected(new Set(sharedView.selected));
  }, [passwordRequired, share, sharedView]);
  const loadShare = useCallback(() => {
    if (isDemoShare) return;
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
  }, [isDemoShare, token, transport]);
  useEffect(() => {
    if (isDemoShare) return;
    if (!token) return setError("缺少分享标识。");
    blendProofClient.shareStatus(token, transport)
      .then((body) => {
        if (body.passwordRequired) setPasswordRequired(true);
        else loadShare();
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "无法读取分享。"));
  }, [isDemoShare, loadShare, token, transport]);
  async function unlockShare() {
    if (isDemoShare) {
      if (password !== DEMO_SHARE_PASSWORD) {
        setError("分享密码不正确。");
        return;
      }
      setError(null);
      setPasswordRequired(false);
      return;
    }
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
      hidden={hidden}
      selected={selected}
      onSelect={(name) => setSelected(name ? new Set([name]) : new Set())}
      onSelectMany={(names) => setSelected(new Set(names))}
      onToggle={(name) => setHidden((current) => { const next = new Set(current); next.has(name) ? next.delete(name) : next.add(name); return next; })}
      message={isDemoShare
        ? "管理员永久公开示例 · 只读 · 不限时。"
        : share.commentsPermission === "comment"
          ? "访客可在模型表面添加批注。"
          : transport === "cloud"
            ? "只读分享。文件由云端 BlendProof 提供。"
            : "只读分享。文件由本机 BlendProof 提供。"}
      modelUrl={share.modelUrl}
      readOnly
      canComment={share.commentsPermission === "comment"}
      commentAuthorName="访客"
      displayMode={displayMode}
      onDisplayMode={setDisplayMode}
      cameraPreset={cameraPreset}
      onCameraPreset={setCameraPreset}
      initialCamera={sharedView?.camera ?? null}
      comments={share.comments}
      reviewError={null}
      onCreateComment={share.commentsPermission === "comment" ? createGuestComment : undefined}
    >
      <ReceiverShareCard
        permission={share.commentsPermission}
        expiresAt={share.expiresAt}
        transport={transport}
        publisher={isDemoShare ? "平台管理员" : undefined}
        sourceLabel={isDemoShare ? "平台内置资产" : undefined}
      />
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
  account,
  accountStats,
  onOpenFile,
  onProjectSelect,
  onLogin,
  onRegister,
  onLogout,
  onCreateInvite,
  onClose,
}: {
  recentProjects: Project[];
  stats: PublicStats | null;
  account: AccountUser | null;
  accountStats: AccountStats | null;
  onOpenFile: () => void;
  onProjectSelect: (project: Project) => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (input: { inviteCode: string; email: string; password: string; displayName: string }) => Promise<void>;
  onLogout: () => Promise<void>;
  onCreateInvite: (expiresInHours: number, maxUses: number) => Promise<{ code: string; expiresAt: string; maxUses: number }>;
  onClose: () => void;
}) {
  const [shareInput, setShareInput] = useState("");
  const [shareError, setShareError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [startTab, setStartTab] = useState<"start" | "recent" | "status" | "account">("start");
  const [legalDocument, setLegalDocument] = useState<"privacy" | "terms" | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  const responseTime = useMemo(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const elapsed = navigation ? navigation.responseEnd - navigation.requestStart : 0;
    return Math.max(1, Math.round(elapsed || performance.now()));
  }, []);

  function openShare() {
    const value = shareInput.trim();
    const candidate = value.match(/^[a-f0-9]{32}$/) ? `/s/${value}` : value;
    try {
      const target = new URL(candidate, window.location.origin);
      if (target.origin !== window.location.origin || !/^\/s\/(?:[a-f0-9]{32}|suzanne)$/.test(target.pathname)) throw new Error();
      window.location.assign(`${target.pathname}${target.search}${target.hash}`);
    } catch {
      setShareError("请输入本站的完整分享链接，或 32 位分享码。");
    }
  }

  async function submitAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountBusy(true);
    setAccountError(null);
    try {
      if (authMode === "login") await onLogin(email, password);
      else await onRegister({ inviteCode, email, password, displayName });
      setAuthOpen(false);
      setPassword("");
    } catch (reason) {
      setAccountError(reason instanceof Error ? reason.message : "账号操作失败。");
    } finally {
      setAccountBusy(false);
    }
  }

  return (
    <main className="blendproof-start-page" data-testid="start-page" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="start-launcher" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="start-launcher-close" aria-label="关闭欢迎页" onClick={onClose}><X size={16} /></button>
        <div className="start-splash">
          <div className="start-splash-brand"><BlenderLogo /><span>BlendProof</span></div>
          <span className="start-splash-version">Web 0.1</span>
          <div className="start-splash-copy"><strong>Blender 工程的轻量审稿台</strong><span>本机转换 · 原始工程不上传</span></div>
        </div>
        <nav className="start-tabs" role="tablist" aria-label="启动页导航">
          {([['start', '开始'], ['recent', '最近项目'], ['status', '平台状态'], ['account', '账号']] as const).map(([key, label]) => <button type="button" role="tab" id={`start-tab-${key}`} aria-controls="start-tabpanel" key={key} className={startTab === key ? "active" : ""} aria-selected={startTab === key} onClick={() => setStartTab(key)}>{label}</button>)}
          <div className="start-tabs-actions"><SplashActions /></div>
        </nav>
        <div className="start-tab-body" id="start-tabpanel" role="tabpanel" aria-labelledby={`start-tab-${startTab}`} tabIndex={0}>
          {startTab === "start" && <div className="start-actions-grid">
            <section className="start-action-section"><h2>新建审稿</h2><button className="start-menu-action" type="button" onClick={onOpenFile}><FolderOpen /><span><strong>打开 .blend 文件</strong><small>在本机转换并生成 Web 预览</small></span></button><div className="start-privacy-note"><ShieldCheck size={15} /><span>原始 .blend 不会上传云端</span></div></section>
            <section className="start-action-section"><h2>打开分享</h2><form className="start-share-entry" onSubmit={(event) => { event.preventDefault(); openShare(); }}><label htmlFor="start-share-code"><Link2 size={18} /><span><strong>审稿链接或分享码</strong><small>无需账号即可打开只读分享</small></span></label><div><input id="start-share-code" aria-label="分享链接或分享码" value={shareInput} onChange={(event) => { setShareInput(event.target.value); setShareError(null); }} placeholder="粘贴 /s/… 或 32 位分享码" /><button type="submit">打开</button></div>{shareError && <small role="alert">{shareError}</small>}</form></section>
          </div>}
          {startTab === "recent" && <section className="start-recent-panel"><div className="start-panel-heading"><span>最近打开的项目</span><button onClick={onOpenFile}>打开其他文件</button></div>{recentProjects.length ? <div className="start-recent-list">{recentProjects.slice(0, 8).map((item) => <button type="button" className="start-recent-item" key={item.id} onClick={() => onProjectSelect(item)}><FileIcon /><span><strong>{item.name}</strong><small>本机转换项目 · {item.id.slice(0, 6)}</small></span><ChevronDown size={14} className="start-recent-arrow" /></button>)}</div> : <p className="start-empty">还没有最近项目。请先打开一个 .blend 文件。</p>}</section>}
          {startTab === "status" && <section className="start-system-panel">
            <div className="start-panel-heading"><span><HardDrive size={14} /> 公益存储池</span><i>已运行 {stats ? formatDuration(clock - Date.parse(stats.launchedAt)) : "—"}</i></div>
            <div className="storage-reading"><strong>{stats ? formatBytes(stats.remainingBytes) : "—"}</strong><span>当前可用 / {stats ? formatBytes(stats.capacityBytes) : "—"}</span></div>
            <div className="storage-meter" role="progressbar" aria-label="公益存储池已用容量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stats ? Math.min(100, stats.usedBytes / stats.capacityBytes * 100) : 0}><span style={{ width: `${stats ? Math.min(100, stats.usedBytes / stats.capacityBytes * 100) : 0}%` }} /></div>
            <div className="start-stats" aria-label="平台状态"><span><strong>{stats?.projectCount ?? "—"}</strong><small>在线项目</small></span><span><strong>{stats?.activeShareCount ?? "—"}</strong><small>有效分享</small></span><span><strong>{stats?.userCount ?? "—"}</strong><small>注册用户</small></span></div>
            <div className="start-lifetime-stats" aria-label="累计处理统计"><span><small>累计处理</small><strong>{stats?.processedFileCount ?? "—"} 份</strong><em>{stats ? `${stats.processedAssetCount} 个派生资产` : "—"}</em></span><span><small>处理总量</small><strong>{stats ? formatBytes(stats.processedBytes) : "—"}</strong><em>成功发布的 Web 资产</em></span><span><small>已自动清理</small><strong>{stats?.cleanedFileCount ?? "—"} 个</strong><em>{stats ? formatBytes(stats.cleanedBytes) : "—"}</em></span></div>
            <p className="start-retention">建议 24 小时内完成审稿；分享最长 {stats?.retentionHours ?? 48} 小时，派生资产到期自动清理。</p>
            <div className="start-site-notice"><p>{responseTime} ms · Gzip 启用。用户提交内容仅代表其作者，不代表 BlendProof 立场。联系：<a href="mailto:admin@itycon.cn">admin@itycon.cn</a></p><p>禁止上传色情、暴力、恐怖主义、违法或侵犯他人权益的文件。</p><p>© 2026 BlendProof. All rights reserved. <button type="button" onClick={() => setLegalDocument("privacy")}>隐私政策</button><span>·</span><button type="button" onClick={() => setLegalDocument("terms")}>服务条款</button></p></div>
          </section>}
          {startTab === "account" && <section className="start-user-panel"><div className="start-panel-heading"><span><User size={14} /> {account ? "我的账号" : "账号入口"}</span>{account?.role === "admin" && <i className="admin-badge"><ShieldCheck size={12} /> 管理员</i>}</div>{account ? <><div className="account-identity"><b>{account.displayName.slice(0, 1).toUpperCase()}</b><span><strong>{account.displayName}</strong><small>{account.email}</small></span><button className="account-logout" onClick={() => void onLogout()}><LogOut size={13} /> 退出</button></div><dl className="account-usage"><div><dt>个人占用</dt><dd>{accountStats ? formatBytes(accountStats.usedBytes) : "—"}</dd></div><div><dt>项目</dt><dd>{accountStats?.projectCount ?? "—"}</dd></div><div><dt>有效分享</dt><dd>{accountStats?.activeShareCount ?? "—"}</dd></div></dl>{account.role === "admin" && <AdminConsole accountId={account.id} onCreateInvite={onCreateInvite} />}</> : <><p>登录后可以查看自己的项目、分享数量和空间占用。为了控制公益资源，注册需要管理员发放的邀请码。</p><div className="account-buttons"><button onClick={() => { setAuthMode("login"); setAuthOpen(true); }}><LogIn size={13} /> 登录</button><button onClick={() => { setAuthMode("register"); setAuthOpen(true); }}><KeyRound size={13} /> 使用邀请码注册</button></div></>}</section>}
        </div>
        <footer className="start-launcher-footer"><span>BlendProof 公益 3D 审稿</span><span>容量 {stats ? formatBytes(stats.capacityBytes) : "—"} · 最长分享 {stats?.retentionHours ?? 48} 小时</span></footer>
      </section>
      {authOpen && <div className="uploader-modal-backdrop account-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}><form className="account-modal" role="dialog" aria-label={authMode === "login" ? "登录" : "邀请码注册"} onSubmit={submitAccount}><div className="account-modal-head"><strong>{authMode === "login" ? "登录 BlendProof" : "使用邀请码注册"}</strong><button type="button" aria-label="关闭账号面板" onClick={() => setAuthOpen(false)}>×</button></div><div className="account-tabs"><button type="button" className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setAccountError(null); }}>登录</button><button type="button" className={authMode === "register" ? "active" : ""} onClick={() => { setAuthMode("register"); setAccountError(null); }}>注册</button></div>{authMode === "register" && <><label>显示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label><label>邀请码<input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} required /></label></>}<label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>密码<input type="password" value={password} minLength={8} onChange={(event) => setPassword(event.target.value)} required /></label>{accountError && <p role="alert">{accountError}</p>}<button className="account-submit" disabled={accountBusy}>{accountBusy ? "处理中…" : authMode === "login" ? "登录" : "创建账号"}</button><small>注册只接受管理员发放的邀请码。</small></form></div>}
      {legalDocument && <LegalDocument kind={legalDocument} onClose={() => setLegalDocument(null)} />}
    </main>
  );
}

function LegalDocument({ kind, onClose }: { kind: "privacy" | "terms"; onClose: () => void }) {
  const privacy = kind === "privacy";
  return <div className="uploader-modal-backdrop legal-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><article className="legal-modal" role="dialog" aria-modal="true" aria-label={privacy ? "隐私政策" : "服务条款"}><header className="account-modal-head"><strong>BlendProof {privacy ? "隐私政策" : "服务条款"}</strong><button type="button" aria-label="关闭协议" onClick={onClose}>×</button></header>{privacy ? <div className="legal-copy"><p>生效日期：2026 年 9 月 12 日</p><h2>数据处理范围</h2><p>原始 .blend 文件仅在您的本机 Blender bridge 中读取和转换，不会上传至 BlendProof 云端。您确认发布后，云端仅保存用于审阅的轻量 GLB、裁剪后的 manifest、可选缩略图、分享设置和批注。</p><h2>账号与日志</h2><p>邀请码注册会处理邮箱、显示名称、账号角色、会话与邀请码使用记录。为保障安全、容量控制和故障排查，服务会保留必要的访问、发布、分享和清理日志。</p><h2>保留与删除</h2><p>普通审阅资产默认建议在 24 小时内使用，最长保留时间受平台配置限制（默认不超过 48 小时），到期后自动清理。管理员维护的公开演示模型不适用该临时保留规则。</p><h2>联系</h2><p>如需隐私相关协助，请联系 <a href="mailto:admin@itycon.cn">admin@itycon.cn</a>。</p></div> : <div className="legal-copy"><p>生效日期：2026 年 9 月 12 日</p><h2>服务定位</h2><p>BlendProof 是轻量 3D 审阅工具，不替代 Blender、专业归档、备份或法律存证服务。分享访问者应依分享人设置的权限使用审阅内容。</p><h2>允许与禁止</h2><p>您须确保拥有上传、转换、发布和分享内容的必要权利。严禁上传或传播色情、暴力、恐怖主义、违法、侵权、恶意程序或其他可能危害他人的文件与内容。</p><h2>账号与邀请码</h2><p>注册仅可使用管理员发放的邀请码。您应妥善保管账号和分享密码；管理员可基于安全、容量或违规情况撤销邀请码、停用账号或清理相关审阅资产。</p><h2>免责声明</h2><p>用户提交、评论和分享的内容仅代表其作者，不代表 BlendProof 立场。平台在法律允许的范围内按现状提供服务，不保证临时审阅资产的永久保存或所有格式的转换结果。</p></div>}<footer><button type="button" onClick={onClose}>我已了解</button></footer></article></div>;
}

function AdminConsole({ accountId, onCreateInvite }: { accountId: string; onCreateInvite: (expiresInHours: number, maxUses: number) => Promise<{ code: string }> }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [settings, setSettings] = useState<AdminSettings>({ capacityBytes: 5 * 1024 ** 3, maxShareHours: 48 });
  const [inviteHours, setInviteHours] = useState(168);
  const [inviteUses, setInviteUses] = useState(1);
  const [latestCode, setLatestCode] = useState<string | null>(null);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const [nextUsers, nextInvites, nextSettings] = await Promise.all([
      blendProofClient.adminUsers(), blendProofClient.adminInvites(), blendProofClient.adminSettings(),
    ]);
    setUsers(nextUsers); setInvites(nextInvites); setSettings(nextSettings);
  }, []);
  useEffect(() => { refresh().catch((reason) => setAdminMessage(reason instanceof Error ? reason.message : "无法读取管理信息。")); }, [refresh]);
  return <div className="admin-console">
    <section><div className="admin-section-title"><strong>平台设置</strong><span>安全上限：5 GB / 48 小时</span></div><div className="admin-settings-row"><label>存储阈值<select value={settings.capacityBytes} onChange={(event) => setSettings((current) => ({ ...current, capacityBytes: Number(event.target.value) }))}><option value={1024 ** 3}>1 GB</option><option value={2 * 1024 ** 3}>2 GB</option><option value={3 * 1024 ** 3}>3 GB</option><option value={5 * 1024 ** 3}>5 GB</option></select></label><label>最长分享<select value={settings.maxShareHours} onChange={(event) => setSettings((current) => ({ ...current, maxShareHours: Number(event.target.value) }))}><option value={12}>12 小时</option><option value={24}>24 小时</option><option value={48}>48 小时</option></select></label><button onClick={async () => { try { setSettings(await blendProofClient.updateAdminSettings(settings)); setAdminMessage("平台设置已保存。"); } catch (reason) { setAdminMessage(reason instanceof Error ? reason.message : "保存失败。"); } }}>保存设置</button></div></section>
    <section><div className="admin-section-title"><strong>成员</strong><span>{users.filter((user) => !user.disabledAt).length} 个有效账号</span></div><div className="admin-table">{users.map((user) => <div className={user.disabledAt ? "disabled" : ""} key={user.id}><span><b>{user.displayName}</b><small>{user.email}</small></span><span>{formatBytes(user.usedBytes)}</span><span>{user.projectCount} 项目</span><span>{user.role === "admin" ? "管理员" : user.disabledAt ? "已停用" : "成员"}</span>{user.id !== accountId && user.role !== "admin" && !user.disabledAt ? <button aria-label={tf("停用 %s", user.displayName)} onClick={async () => { if (!window.confirm(tf("停用成员“%s”吗？", user.displayName))) return; await blendProofClient.disableAdminUser(user.id); await refresh(); }}>停用</button> : <i />}</div>)}</div></section>
    <section><div className="admin-section-title"><strong>邀请码</strong><span>一个管理员可创建多个，每个码独立计算使用次数</span></div><div className="admin-invite-create"><label>有效期<input type="number" min={1} max={720} value={inviteHours} onChange={(event) => setInviteHours(Number(event.target.value))} /> 小时</label><label>可用次数<input type="number" min={1} max={10000} value={inviteUses} onChange={(event) => setInviteUses(Number(event.target.value))} /></label><button onClick={async () => { try { const result = await onCreateInvite(inviteHours, inviteUses); setLatestCode(result.code); await refresh(); } catch (reason) { setAdminMessage(reason instanceof Error ? reason.message : "创建失败。"); } }}><KeyRound size={13} /> 新增邀请码</button></div>{latestCode && <code className="admin-latest-code">{latestCode}</code>}<div className="admin-table invite-table">{invites.map((invite) => { const inactive = Boolean(invite.revokedAt) || invite.usesCount >= invite.maxUses || Date.parse(invite.expiresAt) <= Date.now(); return <div className={inactive ? "disabled" : ""} key={invite.id}><span><b>…{invite.id.slice(-8)}</b><small>{new Date(invite.expiresAt).toLocaleString(getLang() === "en" ? "en-US" : "zh-CN")}</small></span><span>{invite.usesCount} / {invite.maxUses} 次</span><span>{invite.revokedAt ? "已撤销" : inactive ? "已失效" : "可用"}</span>{!inactive ? <button aria-label={tf("撤销邀请码 %s", invite.id.slice(-8))} onClick={async () => { await blendProofClient.revokeAdminInvite(invite.id); await refresh(); }}>撤销</button> : <i />}</div>; })}</div></section>
    {adminMessage && <p className="admin-message" role="status">{adminMessage}</p>}
  </div>;
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

function formatDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainingSeconds = seconds % 60;
  if (getLang() === "en") {
    return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m ${remainingSeconds}s`;
  }
  return days > 0 ? `${days} 天 ${hours} 时 ${minutes} 分` : `${hours} 时 ${minutes} 分 ${remainingSeconds} 秒`;
}

function PanelResizeHandle({
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

function BlenderViewportGrid() {
  return (
    <group>
      <Grid
        position={[0, -0.003, 0]}
        args={[10, 10]}
        cellSize={1}
        cellThickness={0.65}
        cellColor="#5a5a5a"
        sectionSize={10}
        sectionThickness={0.8}
        sectionColor="#707070"
        fadeDistance={150}
        fadeStrength={1}
        infiniteGrid
        followCamera
        side={DoubleSide}
      />
      <Line points={[[-1000, 0, 0], [1000, 0, 0]]} color="#b84b55" lineWidth={1.15} />
      <Line points={[[0, 0, -1000], [0, 0, 1000]]} color="#5b9b46" lineWidth={1.15} />
    </group>
  );
}

function BlenderWorkspace({
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
  canComment = !readOnly,
  commentAuthorName = "本地创建者",
  displayMode,
  onDisplayMode,
  cameraPreset,
  onCameraPreset,
  comments,
  reviewError,
  reviewNewCount = 0,
  onAcknowledgeReview = () => undefined,
  onCreateComment,
  onUpdateComment,
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
  canComment?: boolean;
  commentAuthorName?: string;
  displayMode: DisplayMode;
  onDisplayMode: (mode: DisplayMode) => void;
  cameraPreset: CameraPreset;
  onCameraPreset: (preset: CameraPreset) => void;
  comments: ReviewComment[];
  reviewError: string | null;
  reviewNewCount?: number;
  onAcknowledgeReview?: () => void;
  onCreateComment?: (draft: ReviewCommentDraft) => Promise<ReviewComment>;
  onUpdateComment?: (
    commentId: string,
    patch: Pick<Partial<ReviewComment>, "body" | "status">,
  ) => Promise<ReviewComment>;
  initialCamera?: ReviewCameraState | null;
  onViewStateChange?: (camera: ReviewCameraState) => void;
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
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState<Vec3>([0, 0, 0]);
  const visibleComments = useMemo(
    () => reviewFilter === "all" ? comments : comments.filter((comment) => comment.status === reviewFilter),
    [comments, reviewFilter],
  );
  const [outlinerHeight, setOutlinerHeight] = useState(280);
  const [propertyHeight, setPropertyHeight] = useState(132);
  const [summaryHeight, setSummaryHeight] = useState(180);
  const [overlaysVisible, setOverlaysVisible] = useState(true);
  const [outlinerQuery, setOutlinerQuery] = useState("");
  const [focusRequest, setFocusRequest] = useState<{ names: string[]; nonce: number } | null>(null);
  const [reviewCameraRequest, setReviewCameraRequest] = useState<{
    camera: ReviewCameraState;
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
    setPendingReview(null);
    setSelectedCommentId(null);
    setCommentBody("");
    setReviewMessage(null);
    setNavigationTarget([0, 0, 0]);
    setReviewCameraRequest(null);
  }, [modelUrl]);
  useEffect(() => {
    if (!initialCamera || !sceneRoot || restoredInitialCameraRef.current === modelUrl) return;
    restoredInitialCameraRef.current = modelUrl ?? "default";
    setReviewCameraRequest({ camera: initialCamera, nonce: Date.now() });
  }, [initialCamera, modelUrl, sceneRoot]);
  const filteredObjects = useMemo(() => {
    const query = outlinerQuery.trim().toLocaleLowerCase();
    if (!query) return manifest?.objects ?? [];
    return (manifest?.objects ?? []).filter((object) =>
      object.name.toLocaleLowerCase().includes(query) || object.type.toLocaleLowerCase().includes(query));
  }, [manifest?.objects, outlinerQuery]);
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
      if ((event.key === "." || event.code === "NumpadDecimal") && selected.size > 0) {
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
                <div className="file-menu-item-with-submenu">
                  <button type="button" role="menuitem" aria-haspopup="menu">
                    <ClockIcon /> 最近项目 <span className="submenu-arrow">›</span>
                  </button>
                  <div className="file-recent-submenu" role="menu" aria-label="最近项目">
                    {recentProjects.length ? recentProjects.map((item) => (
                      <button key={item.id} type="button" role="menuitem" onClick={() => {
                        setFileMenuOpen(false);
                        onProjectSelect?.(item);
                      }}>
                        <FileIcon /> <span>{item.name}</span>
                      </button>
                    )) : <p>暂无最近项目</p>}
                  </div>
                </div>
                <div className="file-menu-separator" />
                <button type="button" role="menuitem" disabled={!onDeleteProject} onClick={() => { setFileMenuOpen(false); onDeleteProject?.(); }}>
                  <TrashIcon /> 删除当前本地项目
                </button>
              </div>
            )}
          </div>
        )}
        <div className="project-name">
          <span>{title}</span>
          {shareStatus && (
            <span
              className="project-share-status"
              role="status"
              aria-label={
                shareStatus.expiresAt
                  ? tf(
                      "已分享，%s，%s到期",
                      shareStatus.permission === "comment" ? t("可评论") : t("只读"),
                      formatShareExpiry(shareStatus.expiresAt),
                    )
                  : tf(
                      "已分享，%s，%s",
                      shareStatus.permission === "comment" ? t("可评论") : t("只读"),
                      formatShareExpiry(shareStatus.expiresAt),
                    )
              }
              title={
                shareStatus.expiresAt
                  ? tf(
                      "已分享 · %s · %s到期",
                      shareStatus.permission === "comment" ? t("可评论") : t("只读"),
                      formatShareExpiry(shareStatus.expiresAt),
                    )
                  : tf(
                      "已分享 · %s · %s",
                      shareStatus.permission === "comment" ? t("可评论") : t("只读"),
                      formatShareExpiry(shareStatus.expiresAt),
                    )
              }
            >
              <Share2 size={11} strokeWidth={2.2} />
            </span>
          )}
        </div>
        <div className="header-actions">
          {children ?? <span>只读审稿</span>}
          <MenubarActions />
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
                  setReviewFilter("all");
                  setAnnotationsVisible(true);
                }}
              >
                <MessageSquarePlus size={13} />
                {annotationMode ? "点击模型放置批注" : "添加批注"}
              </button>
            )}
            <div className="review-filters" aria-label="批注状态筛选">
              {([['all', '全部'], ['open', '待处理'], ['resolved', '已解决']] as const).map(([value, label]) => (
                <button key={value} type="button" className={reviewFilter === value ? "active" : ""} onClick={() => setReviewFilter(value)}>{label}</button>
              ))}
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
                  title={tf("使用文件相机：%s", camera.name || "Camera")}
                  onClick={() => onCameraPreset(`file:${camera.uuid}`)}
                >
                  相机 {camera.name || "Camera"}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`editor-mode overlay-toggle ${overlaysVisible ? "active" : ""}`}
              aria-pressed={overlaysVisible}
              title="显示或隐藏网格与坐标轴"
              onClick={() => setOverlaysVisible((visible) => !visible)}
            >
              <Grid2X2 size={12} /> 叠加层
            </button>
            <button
              type="button"
              className={`editor-mode overlay-toggle ${annotationsVisible ? "active" : ""}`}
              aria-pressed={annotationsVisible}
              title="显示或隐藏全部批注 Pin"
              onClick={() => setAnnotationsVisible((visible) => !visible)}
            >
              <MessageSquarePlus size={12} /> 批注
            </button>
          </div>
          <div className="viewport" data-testid="viewer-viewport" aria-label="3D 模型视图">
            {modelUrl ? (
              <Canvas
                camera={{ position: [7, 7, 5], fov: 45 }}
                dpr={[1, 2]}
                onPointerMissed={() => onSelect(null)}
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
                  {annotationsVisible && <ReviewAnnotations
                    comments={visibleComments}
                    selectedId={selectedCommentId}
                    onSelect={selectReviewComment}
                  />}
                  <Environment preset="city" />
                </Suspense>
                <BlenderViewControls
                  preset={cameraPreset}
                  fileCameras={fileCameras}
                  scene={sceneRoot}
                  onTargetChange={setNavigationTarget}
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
            ) : (
              <div className="empty-viewport">
                <BlenderLogo />
                <p>打开 .blend 以开始审稿</p>
              </div>
            )}
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
          <section className="outliner" style={{ height: outlinerHeight }}>
            <header>
              <span>
                <Layers size={13} /> 场景集合
              </span>
              <button
                type="button"
                className="outliner-focus"
                disabled={selected.size === 0}
                title="聚焦选中对象（小键盘 .）"
                aria-label="聚焦选中对象"
                onClick={() => setFocusRequest({ names: [...selected], nonce: Date.now() })}
              ><Focus size={12} /></button>
            </header>
            <label className="outliner-search">
              <Search size={12} />
              <input value={outlinerQuery} onChange={(event) => setOutlinerQuery(event.target.value)} placeholder="搜索对象" aria-label="搜索场景对象" />
              {outlinerQuery && <button type="button" aria-label="清除对象搜索" onClick={() => setOutlinerQuery("")}><X size={11} /></button>}
            </label>
            <div className="tree-root">
              <span>⌄</span>
              <strong>{manifest?.scene ?? "Scene Collection"}</strong>
            </div>
            <div className="tree-children">
              {filteredObjects.map((object) => (
                <div
                  className={`tree-row ${selected.has(object.name) ? "selected" : ""}`}
                  key={object.name}
                  role="treeitem"
                  tabIndex={0}
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
                    <Eye
                      className={hidden.has(object.name) ? "muted-eye" : ""}
                    />
                  </button>
                  <button
                    type="button"
                    className={`isolate ${isolated && selected.size === 1 && selected.has(object.name) ? "active" : ""}`}
                    aria-label={isolated && selected.size === 1 && selected.has(object.name) ? tf("退出 %s 的独显", object.name) : tf("独显 %s", object.name)}
                    title={isolated && selected.size === 1 && selected.has(object.name) ? t("退出独显") : t("独显此对象")}
                    onClick={(event) => {
                      event.stopPropagation();
                      isolateOutlinerObject(object.name);
                    }}
                  >
                    <Focus />
                  </button>
                </div>
              ))}
              {manifest && filteredObjects.length === 0 && <p className="outliner-empty">没有匹配对象</p>}
            </div>
          </section>
          <PanelResizeHandle
            label="调整场景集合面板高度"
            onDelta={(delta) => setOutlinerHeight((height) => Math.min(560, Math.max(90, height + delta)))}
          />
          <section className="properties">
            <header>
              <span>
                <SlidersHorizontal size={13} /> 属性
              </span>
            </header>
            {active && (
              <div className="property-body" style={{ height: propertyHeight }}>
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
            {active && (
              <PanelResizeHandle
                label="调整对象属性面板高度"
                onDelta={(delta) => setPropertyHeight((height) => Math.min(360, Math.max(76, height + delta)))}
              />
            )}
            <div className="property-summary-slot" style={{ height: summaryHeight }}>
              <ConversionSummary manifest={manifest} />
            </div>
            <PanelResizeHandle
              label="调整转换信息面板高度"
              onDelta={(delta) => setSummaryHeight((height) => Math.min(360, Math.max(82, height + delta)))}
            />
            <div className="review-panel-slot">
              <ReviewPanel
                comments={visibleComments}
                newCount={reviewNewCount}
                onAcknowledgeNew={onAcknowledgeReview}
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
            </div>
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
  focusRequest,
  onViewStateChange,
}: {
  preset: CameraPreset;
  fileCameras: ThreeCamera[];
  scene: Object3D | null;
  onTargetChange: (target: Vec3) => void;
  reviewCameraRequest: { camera: ReviewCameraState; nonce: number } | null;
  focusRequest: { names: string[]; nonce: number } | null;
  onViewStateChange?: (camera: ReviewCameraState) => void;
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
    if (!focusRequest || !scene || !controls.current) return;
    const bounds = new Box3();
    let found = false;
    const wanted = new Set(focusRequest.names);
    scene.traverse((node) => {
      if (!wanted.has(node.name)) return;
      const nodeBounds = new Box3().setFromObject(node);
      if (!nodeBounds.isEmpty()) {
        bounds.union(nodeBounds);
        found = true;
      }
    });
    if (!found || bounds.isEmpty()) return;
    const activeCamera = controls.current.object as ThreeCamera;
    const center = bounds.getCenter(new Vector3());
    const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.1);
    const direction = activeCamera.position.clone().sub(controls.current.target).normalize();
    if ((activeCamera as OrthographicCamera).isOrthographicCamera) {
      const orthographic = activeCamera as OrthographicCamera;
      const height = Math.abs(orthographic.top - orthographic.bottom);
      orthographic.zoom = Math.max(0.01, height / (radius * 2.4));
      orthographic.updateProjectionMatrix();
    } else {
      const perspective = activeCamera as PerspectiveCamera;
      const distance = radius / Math.tan((perspective.fov * Math.PI) / 360) * 1.25;
      activeCamera.position.copy(center).add(direction.multiplyScalar(distance));
    }
    controls.current.target.copy(center);
    controls.current.update();
    onTargetChange(center.toArray() as Vec3);
  }, [focusRequest, onTargetChange, scene]);
  useEffect(() => {
    const current = controls.current;
    if (!current) return;
    const onChange = () => {
      const target = current.target.toArray() as Vec3;
      onTargetChange(target);
      if (onViewStateChange) onViewStateChange(captureCameraState(current.object as ThreeCamera, target));
    };
    current.addEventListener("change", onChange);
    return () => current.removeEventListener("change", onChange);
  }, [onTargetChange, onViewStateChange]);
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

function captureCameraState(camera: ThreeCamera, target: Vec3): ReviewCameraState {
  const base = {
    position: camera.position.toArray() as Vec3,
    quaternion: camera.quaternion.toArray() as [number, number, number, number],
    target,
  };
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    const value = camera as OrthographicCamera;
    return {
      ...base,
      projection: "orthographic",
      zoom: value.zoom,
      orthographicHeight: Math.abs(value.top - value.bottom),
    };
  }
  return { ...base, projection: "perspective", fov: (camera as PerspectiveCamera).fov };
}

function ReviewPanel({
  comments,
  newCount,
  onAcknowledgeNew,
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
  newCount: number;
  onAcknowledgeNew: () => void;
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
        <b data-testid="review-count">{comments.length}{newCount > 0 ? tf(" · 新 %s", newCount) : ""}</b>
      </div>
      {newCount > 0 && <button className="review-new-notice" onClick={onAcknowledgeNew}>收到新批注，点击查看</button>}
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
