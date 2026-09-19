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
import { GuidedTour } from "../components/GuidedTour";
import { VIEWPORT_TOUR_STEPS } from "../utils";
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
import { useDemoReview, useReviewComments } from "../features/review";
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
import {
  DEFAULT_MONKEY_MANIFEST,
  DEFAULT_MONKEY_MODEL_URL,
} from "./demoProject";

// ---------------------------------------------------------------------------
// Constants shared between workspace and the demo overlay
// ---------------------------------------------------------------------------

const DEMO_SHARE_URL = `/s/suzanne`;
const DEMO_SHARE_PASSWORD = "tycon";

/**
 * Runtime guard: validates a value loaded from localStorage is a Project.
 *
 * browser transport 的 modelUrl 是 blob: URL（只在本会话有效），
 * 因此不能用 isLocalBridgeResource 判定；它每次都由 IndexedDB 重新物化，
 * 这里的 URL 只要存在即可。
 */
function isStoredProject(value: unknown): value is Project {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const isBrowser = item.transport === "browser";
  const hasResourceUrl = (candidate: unknown): boolean =>
    typeof candidate === "string" && (isBrowser ? candidate.startsWith("blob:") : isLocalBridgeResource(candidate));
  return (
    typeof item.id === "string" &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(item.id) &&
    typeof item.name === "string" &&
    item.name.length > 0 &&
    item.name.length <= 512 &&
    typeof item.ownerCapability === "string" &&
    item.ownerCapability.length > 0 &&
    hasResourceUrl(item.modelUrl) &&
    hasResourceUrl(item.manifestUrl)
  );
}

/** 读取上次打开的项目；browser transport 的 blob URL 随后会被重新物化。 */
function readStoredProject(): Project | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem("blendproof:last-project") ?? "null");
    return isStoredProject(stored) ? stored : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// WorkspacePage
// ---------------------------------------------------------------------------

export function WorkspacePage() {
  useI18n(); // re-render on language toggle so t()/tf() strings stay in sync

  const [file, setFile] = useState<File | null>(null);
  const [project, setProject] = useState<Project | null>(readStoredProject);
  // browser transport 的模型字节存在 IndexedDB，恢复前不能渲染视口。
  const [restoringProject, setRestoringProject] = useState(
    () => readStoredProject()?.transport === "browser",
  );
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

  const [showTour, setShowTour] = useState(false);
  useEffect(() => {
    const hasSeen = localStorage.getItem("blendproof:has-seen-tour");
    if (!hasSeen && (project || (!homeOpen && !file))) {
      const timer = window.setTimeout(() => setShowTour(true), 1500);
      return () => window.clearTimeout(timer);
    }
  }, [project, homeOpen, file]);
  const handleCloseTour = useCallback(() => {
    localStorage.setItem("blendproof:has-seen-tour", "true");
    setShowTour(false);
  }, []);

  const openUploader = useCallback(() => {
    // Opening the file panel is always a fresh selection flow; the active Viewer project stays intact.
    setFile(null);
    setUploadStage("idle");
    setUploaderOpen(true);
  }, []);
  const closeUploader = useCallback(() => setUploaderOpen(false), []);

  const reviewProject = cloudProject ?? project;
  // 三条通道：cloud（登录后发布的）、browser（本地上传，只在浏览器里）、local（本机 bridge）。
  const projectTransport: ProjectTransport = cloudProject
    ? "cloud"
    : project?.transport === "browser"
      ? "browser"
      : "local";
  // 有项目走真实审稿接口；没有项目（Suzanne 演示）走纯本地演示态。
  // 两者形状一致，下游无需分支。演示态可写，用于本地/远程一致的体验验证。
  const ownerReviews = useReviewComments(
    reviewProject?.id ?? null,
    reviewProject?.ownerCapability ?? null,
    projectTransport,
  );
  const demoReviews = useDemoReview();
  const reviews = reviewProject ? ownerReviews : demoReviews;
  const displayComments = reviews.comments;

  // 批注与回复的作者名取自登录账号，与创建批注时保持一致。
  const reviewAuthorName = account?.displayName?.trim() || "本地创建者";
  const replyToReviewComment = (commentId: string, body: string) =>
    reviews.reply(commentId, { body, authorName: reviewAuthorName });

  /**
   * 刷新后用 IndexedDB 里的字节重新物化 browser 项目。
   *
   * blob URL 只活在创建它的那次会话，localStorage 里存的那个刷新后必然失效 ——
   * 不重新物化就会表现为「模型加载失败」。记录不存在（换浏览器 / 清了缓存）
   * 则清掉这个项目，退回演示态。
   */
  useEffect(() => {
    const stored = project;
    if (!stored || stored.transport !== "browser") {
      setRestoringProject(false);
      return;
    }
    let active = true;
    blendProofClient
      .restoreBrowserProject(stored.id)
      .then((restored) => {
        if (!active) return;
        if (restored) setProject(restored);
        else {
          localStorage.removeItem("blendproof:last-project");
          setProject(null);
          setMessage("本地缓存中的模型已不存在，请重新导入 .blend 文件。");
        }
      })
      .catch(() => {
        if (active) setMessage("读取本地缓存失败，请重新导入 .blend 文件。");
      })
      .finally(() => {
        if (active) setRestoringProject(false);
      });
    return () => {
      active = false;
    };
    // 只在换项目时重新物化；拖拽面板等重渲染不该触发。
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    setManifest(null);
    if (project && !restoringProject) {
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
  }, [project, restoringProject]);

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

  /**
   * 导入 .blend。
   *
   * 产品约定：**未登录时绝不把文件送出浏览器** —— 只做本机转换并把产物存进
   * IndexedDB，作为测试预览。登录后才允许回退到本机 bridge / 云端上传。
   * 所以浏览器转换失败时不能无脑回退，那等于在用户不知情的情况下上传了原件。
   */
  async function convert() {
    if (!file) return;
    setProcessing(true);
    setHomeOpen(false);
    setUploadStage("converting");
    setMessage("正在浏览器本地读取并转换 Blender 文件，文件不会离开本机。");
    try {
      let result: Project;
      try {
        result = await blendProofClient.convertInBrowser(file);
      } catch (browserReason) {
        if (!account) {
          throw new Error(
            `${browserReason instanceof Error ? browserReason.message : "浏览器转换失败。"}` +
              "该文件需要登录账号后由本机 Blender 转换；未登录状态下不会上传你的文件。",
          );
        }
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
        result.transport === "browser"
          ? "模型已在 3D 视口中就绪（仅保存在本机浏览器，登录后可上传云端）。"
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
      const transport = projectTransport;
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
              "已建立%s可批注分享链接。",
              cloudProject ? t("云端") : t("本地"),
            )
          : tf(
              "已建立%s仅查看分享链接。",
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
        projectTransport,
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

  async function switchProject(nextProject: Project) {
    setHomeOpen(false);
    setManifest(null);
    setFile(null);
    setUploadStage("ready");
    setHidden(new Set());
    setSelected(new Set());
    setShareUrl(null);
    setShareId(null);
    setShareExpiresAt(null);
    setCloudProject(null);
    setPublishTitle(nextProject.name.replace(/\.blend$/i, ""));
    // 最近项目里存的是上次会话的 blob URL，切回来必须先重新物化。
    if (nextProject.transport === "browser") {
      setRestoringProject(true);
      const restored = await blendProofClient.restoreBrowserProject(nextProject.id);
      setRestoringProject(false);
      if (!restored) {
        setMessage("本地缓存中的模型已不存在，请重新导入 .blend 文件。");
        return;
      }
      setProject(restored);
      setMessage(tf("已切换到本地项目：%s", restored.name));
      return;
    }
    setProject(nextProject);
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
      if (project.transport === "browser") {
        await blendProofClient.deleteBrowserProject(project.id, project.ownerCapability);
      } else {
        await blendProofClient.deleteLocalProject(
          project.id,
          project.ownerCapability,
        );
      }
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
    ? DEFAULT_MONKEY_MODEL_URL
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
    <>
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
      {showTour && (
        <GuidedTour steps={VIEWPORT_TOUR_STEPS} onClose={handleCloseTour} />
      )}
    </>
  );
}
