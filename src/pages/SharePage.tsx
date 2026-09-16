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
import type {
  ReviewComment,
  ReviewCommentDraft,
} from "../reviewRepository";

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
    authorName: "平台管理员",
    status: "open",
    createdAt: "2026-09-14T10:30:00Z",
    updatedAt: "2026-09-14T10:30:00Z",
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
    authorName: "张工",
    status: "resolved",
    createdAt: "2026-09-13T15:12:00Z",
    updatedAt: "2026-09-14T09:00:00Z",
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
    authorName: "李审核",
    status: "open",
    createdAt: "2026-09-15T08:00:00Z",
    updatedAt: "2026-09-15T08:00:00Z",
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
      })
      .catch((reason) => {
        if (isDemoShare) {
          // Fallback if offline
          setPasswordRequired(false);
          return;
        }
        setError(reason instanceof Error ? reason.message : "无法读取分享。");
      });
  }, [isDemoShare, token, transport]);

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
        // Fallback for offline demo
        setError(null);
        setPasswordRequired(false);
        return;
      }
      setError(reason instanceof Error ? reason.message : "密码验证失败。");
    }
  }

  async function createGuestComment(draft: ReviewCommentDraft) {
    if (!token) throw new Error("缺少分享标识。");
    const name = guestName.trim() || (isDemoShare ? "访客" : "");
    if (!name) throw new Error("请先填写审核名称。");
    try {
      const comment = await blendProofClient.createGuestComment(
        token,
        { ...draft, authorName: name },
        transport,
      );
      setShare((current) =>
        current
          ? { ...current, comments: [...current.comments, comment] }
          : current,
      );
      return comment;
    } catch (reason) {
      if (isDemoShare) {
        // Fallback for offline demo
        const now = new Date().toISOString();
        const comment: ReviewComment = {
          ...draft,
          id: `demo-${Date.now()}`,
          projectId: DEMO_SHARE_TOKEN,
          authorName: name,
          status: "open",
          createdAt: now,
          updatedAt: now,
        };
        setShare((current) =>
          current
            ? { ...current, comments: [...current.comments, comment] }
            : current,
        );
        return comment;
      }
      throw reason;
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
      canComment={share.commentsPermission === "comment"}
      commentAuthorName={guestName.trim() || "访客"}
      displayMode={displayMode}
      onDisplayMode={setDisplayMode}
      cameraPreset={cameraPreset}
      onCameraPreset={setCameraPreset}
      initialCamera={sharedView?.camera ?? null}
      comments={share.comments}
      reviewError={null}
      onCreateComment={
        share.commentsPermission === "comment" ? createGuestComment : undefined
      }
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
