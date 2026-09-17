/**
 * SharePage — entry point rendered at /s/<token>.
 * Handles:
 * - password unlock flow for protected shares
 * - guest display name prompt for commentable shares
 * - demo share (Suzanne, token="suzanne")
 * - cloud vs local transport
 * - read-only or commentable viewer via BlenderWorkspace
 *
 * Extracted from App.tsx L703–841.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlenderWorkspace } from "../workspace/BlenderWorkspace";
import { ReceiverShareCard } from "../components/ShareCards";
import {
  Notice,
  PasswordNotice,
  GuestNameNotice,
} from "../components/NoticeViews";
import { blendProofClient, type ProjectTransport } from "../api/blendProofClient";
import { readSharedView } from "../utils";
import type { Manifest, DisplayMode, CameraPreset } from "../types";
import { useGuestReview, type ReviewComment } from "../features/review";

// ---------------------------------------------------------------------------
// Demo constants (Suzanne permanent share)
// ---------------------------------------------------------------------------

const DEMO_SHARE_TOKEN = "suzanne";
const DEMO_SHARE_PASSWORD = "tycon";

const DEMO_COMMENTS: ReviewComment[] = [
  {
    id: "demo-1",
    projectId: "demo",
    objectName: "苏珊娜",
    position: [0, 0.5, 1.2],
    normal: [0, 0, 1],
    camera: {
      projection: "perspective",
      position: [0, 0, 3],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
    },
    body: "头顶多边形密度偏高，建议减面以降低 Web 端渲染负担。",
    authorName: "张工",
    authorType: "guest",
    status: "open",
    createdAt: "2026-09-14T10:30:00Z",
    updatedAt: "2026-09-14T10:30:00Z",
    replies: [],
  },
  {
    id: "demo-2",
    projectId: "demo",
    objectName: "苏珊娜",
    position: [0.8, 0.2, 0.3],
    normal: [1, 0, 0],
    camera: {
      projection: "perspective",
      position: [2, 1, 2],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
    },
    body: "右耳边缘法线翻转，渲染时出现黑色伪影。",
    authorName: "李审核",
    authorType: "guest",
    status: "resolved",
    createdAt: "2026-09-13T15:12:00Z",
    updatedAt: "2026-09-14T09:00:00Z",
    // 演示闭环：客户提出 → 创作者回复 → 标记已解决，双方都能看到全过程。
    replies: [
      {
        id: "demo-2-reply-1",
        commentId: "demo-2",
        body: "已确认是右耳法线方向反了，重算后发现同样影响左耳内侧，一并修好了。",
        authorName: "平台管理员",
        authorType: "owner",
        createdAt: "2026-09-13T18:40:00Z",
      },
    ],
  },
  {
    id: "demo-3",
    projectId: "demo",
    objectName: null,
    position: [0, -0.3, 0.8],
    normal: [0, -1, 0],
    camera: {
      projection: "perspective",
      position: [0, 0.5, 3],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
    },
    body: "整体模型质量不错，可直接用于审稿演示。",
    authorName: "阿烟",
    authorType: "guest",
    status: "open",
    createdAt: "2026-09-15T08:00:00Z",
    updatedAt: "2026-09-15T08:00:00Z",
    replies: [],
  },
];

const DEFAULT_MONKEY_MANIFEST: Manifest = {
  scene: "Suzanne 演示",
  camera: null,
  cameras: [],
  objects: [{ name: "苏珊娜", type: "MESH", collections: ["Collection"] }],
  collections: ["Collection"],
  materials: ["Material"],
  export: { glbBytes: 69708, objectCount: 1 },
};

// ---------------------------------------------------------------------------
// SharePage
// ---------------------------------------------------------------------------

export function SharePage() {
  const token = window.location.pathname
    .split("/")
    .filter(Boolean)
    .at(-1);
  const sharedView = useMemo(readSharedView, []);
  const searchSource = new URLSearchParams(window.location.search).get("source");
  const isDemoShare = token === DEMO_SHARE_TOKEN;
  const transport: ProjectTransport =
    searchSource === "cloud" ||
    isDemoShare ||
    (!searchSource &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1")
      ? "cloud"
      : "local";
  const [share, setShare] = useState<{
    name: string;
    modelUrl: string;
    manifest: Manifest;
    comments: ReviewComment[];
    commentsPermission: "read_only" | "comment";
    expiresAt: string | null;
  } | null>(() =>
    isDemoShare
      ? {
          name: DEFAULT_MONKEY_MANIFEST.scene,
          modelUrl: "/default-monkey.glb",
          manifest: DEFAULT_MONKEY_MANIFEST,
          comments: DEMO_COMMENTS,
          commentsPermission: "comment",
          expiresAt: null,
        }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(isDemoShare);
  const [password, setPassword] = useState("");
  const [guestName, setGuestName] = useState(() =>
    token
      ? window.localStorage.getItem(`blendproof-guest-name:${token}`) ?? ""
      : "",
  );
  // 批注的本地副本与全部写操作由审稿域统一持有；本页只做装配。
  const {
    comments: guestComments,
    busy: reviewBusy,
    error: reviewError,
    reset: resetGuestComments,
    canDelete: canDeleteComment,
    createComment,
    reply: replyToComment,
    removeComment,
    removeReply,
  } = useGuestReview({
    token: token ?? null,
    transport,
    demoMode: isDemoShare,
    authorName: guestName,
  });
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(sharedView?.selected ?? []),
  );
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(sharedView?.hidden ?? []),
  );
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    sharedView?.displayMode ?? "material",
  );
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("perspective");
  const restoredSharedSelectionRef = useRef(false);

  useEffect(() => {
    if (
      passwordRequired ||
      !share ||
      !sharedView ||
      restoredSharedSelectionRef.current
    )
      return;
    restoredSharedSelectionRef.current = true;
    setSelected(new Set(sharedView.selected));
  }, [passwordRequired, share, sharedView]);

  const loadShare = useCallback(() => {
    if (!token) return setError("缺少分享标识。");
    setError(null);
    blendProofClient
      .loadShare<Manifest>(token, transport)
      .then((body) => {
        setPasswordRequired(false);
        setShare(body);
        resetGuestComments(body.comments);
      })
      .catch((reason) => {
        if (isDemoShare) {
          // Fallback if offline
          setPasswordRequired(false);
          resetGuestComments(DEMO_COMMENTS);
          return;
        }
        setError(reason instanceof Error ? reason.message : "无法读取分享。");
      });
  }, [isDemoShare, token, transport, resetGuestComments]);

  useEffect(() => {
    if (!token) return setError("缺少分享标识。");
    blendProofClient
      .shareStatus(token, transport)
      .then((body) => {
        if (body.passwordRequired) setPasswordRequired(true);
        else loadShare();
      })
      .catch((reason) => {
        if (isDemoShare) {
          // Fallback if offline
          return;
        }
        setError(reason instanceof Error ? reason.message : "无法读取分享。");
      });
  }, [isDemoShare, loadShare, token, transport]);

  async function unlockShare() {
    if (!token) return setError("缺少分享标识。");
    try {
      await blendProofClient.unlockShare(token, password, transport);
      loadShare();
    } catch (reason) {
      if (isDemoShare && password === DEMO_SHARE_PASSWORD) {
        // Fallback for offline demo：解除密码锁后仍要走一次加载，
        // 否则批注列表会停在空状态（批注已不在 share 状态里）。
        setError(null);
        setPasswordRequired(false);
        loadShare();
        return;
      }
      setError(reason instanceof Error ? reason.message : "密码验证失败。");
    }
  }

  if (passwordRequired)
    return (
      <PasswordNotice
        password={password}
        error={error}
        onPassword={setPassword}
        onSubmit={unlockShare}
      />
    );
  if (error) return <Notice text={error} />;
  if (!share) return <Notice text="正在打开审稿文件。" />;
  if (!isDemoShare && share.commentsPermission === "comment" && !guestName.trim()) {
    return (
      <GuestNameNotice
        value={guestName}
        onChange={setGuestName}
        onSubmit={() => {
          const name = guestName.trim();
          if (!name || !token) return;
          window.localStorage.setItem(`blendproof-guest-name:${token}`, name);
          setGuestName(name);
        }}
      />
    );
  }

  return (
    <BlenderWorkspace
      title={share.manifest.scene}
      manifest={share.manifest}
      hidden={hidden}
      selected={selected}
      onSelect={(name) => setSelected(name ? new Set([name]) : new Set())}
      onSelectMany={(names) => setSelected(new Set(names))}
      onToggle={(name) =>
        setHidden((current) => {
          const next = new Set(current);
          next.has(name) ? next.delete(name) : next.add(name);
          return next;
        })
      }
      message={
        isDemoShare
          ? "管理员永久公开示例 · 可评论 · 不限时。"
          : share.commentsPermission === "comment"
          ? "访客可在模型表面添加批注。"
          : transport === "cloud"
          ? "只读分享。文件由云端 BlendProof 提供。"
          : "只读分享。文件由本机 BlendProof 提供。"
      }
      modelUrl={share.modelUrl}
      readOnly
      canView={!isDemoShare}
      canComment={share.commentsPermission === "comment"}
      commentAuthorName={guestName.trim() || "访客"}
      displayMode={displayMode}
      onDisplayMode={setDisplayMode}
      cameraPreset={cameraPreset}
      onCameraPreset={setCameraPreset}
      initialCamera={sharedView?.camera ?? null}
      comments={guestComments}
      reviewError={reviewError}
      canDeleteComment={canDeleteComment}
      onCreateComment={
        share.commentsPermission === "comment" ? createComment : undefined
      }
      onReplyComment={
        share.commentsPermission === "comment" ? replyToComment : undefined
      }
      onDeleteComment={removeComment}
      onDeleteReply={removeReply}
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
