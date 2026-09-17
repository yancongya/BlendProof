/**
 * WorkspacePage — the main logged-in workspace. Manages:
 * - File selection and local/browser Blender conversion
 * - Project manifest loading, cloud publish, share creation/revocation
 * - StartPage launcher overlay
 * - Share panel (sender side)
 * - Delegates 3D rendering to BlenderWorkspace
 *
 * Extracted from App.tsx L270–701 (formerly exported as `App`).
 */

import { useCallback, useEffect, useState } from "react";
import { SharePanel } from "../features/share";
import { BlenderWorkspace } from "../workspace/BlenderWorkspace";
import { StartPage } from "../start/StartPage";
import { SenderShareCard } from "../components/ShareCards";
import { UploaderPanel, type UploadStage } from "../components/UploaderPanel";
import {
  blendProofClient,
  type AccountStats,
  type AccountUser,
  type CloudOwnerProject,
  type ProjectTransport,
  type PublicStats,
} from "../api/blendProofClient";
import { useReviewComments } from "../features/review";
import { useI18n, t, tf } from "../i18n";
import { encodeSharedView, isLocalBridgeResource } from "../utils";
import type {
  ActiveShareStatus,
  CameraPreset,
  DisplayMode,
  Manifest,
  Project,
} from "../types";
import type { CameraState } from "../shared/types/camera";

// ---------------------------------------------------------------------------
// Constants shared between workspace and the demo overlay
// ---------------------------------------------------------------------------

const DEMO_SHARE_URL = `/s/suzanne`;
const DEMO_SHARE_PASSWORD = "tycon";

const DEFAULT_MONKEY_MANIFEST: Manifest = {
  scene: "Suzanne 演示",
  camera: null,
  cameras: [],
  objects: [{ name: "苏珊娜", type: "MESH", collections: ["Collection"] }],
  collections: ["Collection"],
  materials: ["Material"],
  export: { glbBytes: 69708, objectCount: 1 },
};

/** Runtime guard: validates a value loaded from localStorage is a Project. */
function isStoredProject(value: unknown): value is Project {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(item.id) &&
    typeof item.name === "string" &&
    item.name.length > 0 &&
    item.name.length <= 512 &&
    typeof item.ownerCapability === "string" &&
    item.ownerCapability.length > 0 &&
    typeof item.modelUrl === "string" &&
    isLocalBridgeResource(item.modelUrl) &&
    typeof item.manifestUrl === "string" &&
    isLocalBridgeResource(item.manifestUrl)
  );
}

// ---------------------------------------------------------------------------
// WorkspacePage
// ---------------------------------------------------------------------------

export function WorkspacePage() {
  useI18n(); // re-render on language toggle so t()/tf() strings stay in sync

  const [file, setFile] = useState<File | null>(null);
  const [project, setProject] = useState<Project | null>(() => {
    try {
      const stored: unknown = JSON.parse(
        localStorage.getItem("blendproof:last-project") ?? "null",
      );
      return isStoredProject(stored) ? stored : null;
    } catch {
      return null;
    }
  });
  const [recentProjects, setRecentProjects] = useState<Project[]>(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem("blendproof:recent-projects") ?? "[]",
      );
      return Array.isArray(stored)
        ? stored.filter(isStoredProject).slice(0, 8)
        : [];
    } catch {
      return [];
    }
  });
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [cloudProject, setCloudProject] = useState<CloudOwnerProject | null>(
    null,
  );
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
  const [shareError, setShareError] = useState<string | null>(null);
  const [homeOpen, setHomeOpen] = useState(true);
  const [publicStats, setPublicStats] = useState<PublicStats | null>(null);
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [accountStats, setAccountStats] = useState<AccountStats | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("material");
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("perspective");
  const [currentCamera, setCurrentCamera] = useState<CameraState | null>(null);
  const [startTabHint, setStartTabHint] = useState<"start" | "recent" | "status" | "account" | null>(null);

  const openUploader = useCallback(() => {
    // Opening the file panel is always a fresh selection flow; the active Viewer project stays intact.
    setFile(null);
    setUploadStage("idle");
    setUploaderOpen(true);
  }, []);
  const closeUploader = useCallback(() => setUploaderOpen(false), []);

  const reviewProject = cloudProject ?? project;
  const reviews = useReviewComments(
    reviewProject?.id ?? null,
    reviewProject?.ownerCapability ?? null,
    cloudProject ? "cloud" : "local",
  );
  // Use demo comments when no project is loaded (Suzanne overlay)
  const DEMO_COMMENTS = [] as typeof reviews.comments; // keep demo-only comments in SharePage
  const displayComments = reviewProject ? reviews.comments : DEMO_COMMENTS;

  // 批注与回复的作者名取自登录账号，与创建批注时保持一致。
  const reviewAuthorName = account?.displayName?.trim() || "本地创建者";
  const replyToReviewComment = (commentId: string, body: string) =>
    reviews.reply(commentId, { body, authorName: reviewAuthorName });

  useEffect(() => {
    let active = true;
    setManifest(null);
    if (project) {
      blendProofClient
        .loadJson<Manifest>(project.manifestUrl)
        .then((nextManifest) => {
          if (active) setManifest(nextManifest);
        })
        .catch((reason) => {
          if (!active) return;
          setMessage(
            reason instanceof Error ? reason.message : "无法读取本地项目。",
          );
        });
    }
    return () => {
      active = false;
    };
  }, [project]);

  useEffect(() => {
    let active = true;
    const refreshPublicStats = () =>
      blendProofClient
        .publicStats()
        .then((next) => {
          if (active) setPublicStats(next);
        })
        .catch(() => {
          if (active) setPublicStats(null);
        });
    void refreshPublicStats();
    const interval = homeOpen
      ? window.setInterval(refreshPublicStats, 30_000)
      : undefined;
    blendProofClient
      .currentUser()
      .then(async (user) => {
        if (!active) return null;
        setAccount(user);
        return user ? blendProofClient.accountStats() : null;
      })
      .then((next) => {
        if (active) setAccountStats(next);
      })
      .catch(() => {
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
    if (manifest)
      setPublishTitle(
        manifest.scene ||
          project?.name.replace(/\.blend$/i, "") ||
          "",
      );
  }, [manifest, project?.id, project?.name]);

  useEffect(() => {
    if (project) {
      localStorage.setItem("blendproof:last-project", JSON.stringify(project));
      setRecentProjects((current) => {
        const next = [
          project,
          ...current.filter((item) => item.id !== project.id),
        ].slice(0, 8);
        localStorage.setItem(
          "blendproof:recent-projects",
          JSON.stringify(next),
        );
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
      } catch {
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
      closeUploader();
      setMessage(
        result.id.startsWith("browser-")
          ? "模型已在 3D 视口中就绪。"
          : "模型已在 3D 视口中就绪。",
      );
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
    if (cloudProject && !account) {
      setMessage("创建云端分享需要登录账号，请先登录。");
      setStartTabHint("account");
      setHomeOpen(true);
      return;
    }
    try {
      const transport: ProjectTransport = cloudProject ? "cloud" : "local";
      const share = await blendProofClient.createShare(
        target.id,
        target.ownerCapability,
        {
          password: sharePassword || null,
          expiresAt: new Date(
            Date.now() + Number(shareHours) * 3_600_000,
          ).toISOString(),
          commentsPermission: sharePermission,
        },
        transport,
      );
      const baseUrl = cloudProject
        ? `${share.shareUrl}?source=cloud`
        : share.shareUrl;
      const view = currentCamera
        ? encodeSharedView({
            version: 1,
            camera: currentCamera,
            displayMode,
            hidden: [...hidden],
            selected: [...selected],
          })
        : "";
      setShareUrl(`${baseUrl}${view}`);
      setShareId(share.id);
      setShareExpiresAt(share.expiresAt);
      setShareError(null);
      setShareError(null);
      setMessage(
        sharePermission === "comment"
          ? tf(
              "已建立%s可评论分享链接。",
              cloudProject ? t("云端") : t("本地"),
            )
          : tf(
              "已建立%s只读分享链接。",
              cloudProject ? t("云端") : t("本地"),
            ),
      );
    } catch (reason) {
      setShareError(
        reason instanceof Error ? reason.message : "无法建立分享链接。",
      );
    }
  }

  async function revokeShare() {
    const target = cloudProject ?? project;
    if (!target || !shareId) return;
    // 撤销不可逆：客户手上的链接会立刻失效，正在进行的审稿会中断，因此先确认。
    if (!window.confirm("撤销后该分享链接立即失效，客户将无法继续查看与批注。\n\n确定撤销？")) return;
    try {
      await blendProofClient.revokeShare(
        target.id,
        target.ownerCapability,
        shareId,
        cloudProject ? "cloud" : "local",
      );
      setShareUrl(null);
      setShareId(null);
      setShareExpiresAt(null);
      setMessage("分享已撤销。");
      setShareError(null);
    } catch (reason) {
      setShareError(
        reason instanceof Error ? reason.message : "无法撤销分享。",
      );
    }
  }

  async function publishCloud() {
    if (!project || !manifest) return;
    if (!account) {
      setMessage("发布云端需要登录账号，请先登录。");
      setStartTabHint("account");
      setHomeOpen(true);
      return;
    }
    setProcessing(true);
    setUploadStage("uploading");
    setMessage("正在将 GLB 与裁剪后的清单发布到云端快递柜。");
    try {
      const published = await blendProofClient.publishCloud({
        name: publishTitle,
        modelUrl: project.modelUrl,
        manifestUrl: project.manifestUrl,
      });
      const cloudComments = await blendProofClient.listOwnerComments(
        published.id,
        published.ownerCapability,
        "cloud",
      );
      for (const comment of reviews.comments) {
        const existing = cloudComments.find(
          (item) =>
            item.objectName === comment.objectName &&
            item.body === comment.body &&
            item.authorName === comment.authorName &&
            JSON.stringify(item.position) === JSON.stringify(comment.position),
        );
        if (!existing) {
          const migrated = await blendProofClient.createOwnerComment(
            published.id,
            published.ownerCapability,
            {
              objectName: comment.objectName,
              position: comment.position,
              normal: comment.normal,
              camera: comment.camera,
              body: comment.body,
              authorName: comment.authorName,
            },
            "cloud",
          );
          if (comment.status === "resolved")
            await blendProofClient.updateOwnerComment(
              published.id,
              published.ownerCapability,
              migrated.id,
              { status: "resolved" },
              "cloud",
            );
        } else if (
          comment.status === "resolved" &&
          existing.status !== "resolved"
        ) {
          await blendProofClient.updateOwnerComment(
            published.id,
            published.ownerCapability,
            existing.id,
            { status: "resolved" },
            "cloud",
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
      setMessage(
        reason instanceof Error ? reason.message : "云端发布失败，可安全重试。",
      );
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
    if (
      !window.confirm(
        tf(
          "确定删除本地项目\u201c%s\u201d吗？此操作会移除转换文件和批注。",
          project.name,
        ),
      )
    )
      return;
    try {
      await blendProofClient.deleteLocalProject(
        project.id,
        project.ownerCapability,
      );
      const next = recentProjects.filter((item) => item.id !== project.id);
      setRecentProjects(next);
      localStorage.setItem(
        "blendproof:recent-projects",
        JSON.stringify(next),
      );
      localStorage.removeItem("blendproof:last-project");
      setProject(null);
      setManifest(null);
      setCloudProject(null);
      setFile(null);
      setHomeOpen(true);
      setMessage("本地项目已删除。");
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "无法删除本地项目。",
      );
    }
  }

  function toggle(name: string) {
    setHidden((current) => {
      const next = new Set(current);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  const workspaceManifest =
    manifest ?? (!project ? DEFAULT_MONKEY_MANIFEST : null);
  const workspaceModelUrl = manifest
    ? project?.modelUrl
    : !project
    ? "/default-monkey.glb"
    : undefined;

  const shareStatusProp: ActiveShareStatus | null = shareUrl
    ? { expiresAt: shareExpiresAt, permission: sharePermission }
    : !project
    ? { expiresAt: null, permission: "read_only" }
    : null;

  if (homeOpen) {
    return (
      <>
        <BlenderWorkspace
          title={project?.name ?? file?.name ?? "Suzanne 演示"}
          manifest={workspaceManifest}
          hidden={hidden}
          selected={selected}
          shareStatus={shareStatusProp}
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
          comments={displayComments}
          reviewError={reviews.error}
          reviewNewCount={reviews.newCount}
          onAcknowledgeReview={reviews.acknowledgeNew}
          onCreateComment={reviews.create}
          commentAuthorName={reviewAuthorName}
          onUpdateComment={reviews.update}
          onDeleteComment={reviews.remove}
          onReplyComment={replyToReviewComment}
          onDeleteReply={reviews.removeReply}
          onViewStateChange={setCurrentCamera}
          onOpenUploader={openUploader}
          onHome={() => setHomeOpen(true)}
          recentProjects={recentProjects}
          onProjectSelect={switchProject}
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
          onCreateInvite={(expiresInHours, maxUses) =>
            blendProofClient.createInvite(expiresInHours, maxUses)
          }
          initialTab={startTabHint ?? "start"}
          onClose={() => {
            setStartTabHint(null);
            setHomeOpen(false);
          }}
        />
      </>
    );
  }

  return (
    <BlenderWorkspace
      title={project?.name ?? file?.name ?? "Suzanne 演示"}
      shareStatus={shareStatusProp}
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
      comments={displayComments}
      reviewError={reviews.error}
      reviewNewCount={reviews.newCount}
      onAcknowledgeReview={reviews.acknowledgeNew}
      onCreateComment={reviews.create}
      commentAuthorName={reviewAuthorName}
      onUpdateComment={reviews.update}
      onDeleteComment={reviews.remove}
      onReplyComment={replyToReviewComment}
      onDeleteReply={reviews.removeReply}
      onViewStateChange={setCurrentCamera}
      uploaderOpen={uploaderOpen}
      onOpenUploader={openUploader}
      onCloseUploader={closeUploader}
      onHome={() => setHomeOpen(true)}
      onDeleteProject={
        !cloudProject && project ? () => void deleteCurrentProject() : undefined
      }
      onOpenFileMenu={() => setSharePanelOpen(false)}
      recentProjects={recentProjects}
      onProjectSelect={switchProject}
      uploader={
        <UploaderPanel
          file={file}
          stage={uploadStage}
          message={
            uploadStage === "idle"
              ? "选择 Blender 文件以建立本地审稿项目。"
              : message
          }
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
          account={account}
        />
      }
    >
      <SharePanel
        hasProject={Boolean(project)}
        sharePassword={sharePassword}
        shareHours={shareHours}
        sharePermission={sharePermission}
        shareUrl={shareUrl}
        shareExpiresAt={shareExpiresAt}
        shareId={shareId}
        isOpen={sharePanelOpen}
        isCloud={Boolean(cloudProject)}
        onToggle={() => setSharePanelOpen((c) => !c)}
        onBackdropClick={() => setSharePanelOpen(false)}
        onPasswordChange={setSharePassword}
        onHoursChange={setShareHours}
        onPermissionChange={setSharePermission}
        onCreateShare={() => void createShare()}
        shareError={shareError}
        onRevokeShare={() => void revokeShare()}
      />
    </BlenderWorkspace>
  );
}
