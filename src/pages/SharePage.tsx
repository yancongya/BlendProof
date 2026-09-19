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
import { CLIENT_GUIDE_STEPS } from "../features/viewer";
import { readSharedView, VIEWPORT_TOUR_STEPS } from "../utils";
import { GuidedTour } from "../components/GuidedTour";
import type { Manifest, DisplayMode, CameraPreset } from "../types";
import {
  DEMO_COMMENTS,
  DEMO_SHARE_PASSWORD,
  DEMO_SHARE_TOKEN,
  useGuestReview,
  type ReviewComment,
} from "../features/review";
import {
  DEFAULT_MONKEY_MANIFEST,
  DEFAULT_MONKEY_MODEL_URL,
} from "./demoProject";


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
  // 内置猴头演示：永久有效，不走 createShare，也不依赖任何后端账号。
  const isDemoShare = token === DEMO_SHARE_TOKEN;
  // `?source=browser` 由本机创建分享时写入，指向浏览器 IndexedDB 里的数据。
  const transport: ProjectTransport =
    searchSource === "browser"
      ? "browser"
      : searchSource === "cloud" ||
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
          modelUrl: DEFAULT_MONKEY_MODEL_URL,
          manifest: DEFAULT_MONKEY_MANIFEST,
          comments: DEMO_COMMENTS,
          commentsPermission: "comment",
          expiresAt: null,
        }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(isDemoShare);
  const [password, setPassword] = useState(() => new URLSearchParams(window.location.search).get("pwd") || "");
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

  useEffect(() => {
    if (passwordRequired && password && !share && !error) {
      unlockShare();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passwordRequired]);

  // 必须留在下方所有提前 return 之前：解锁会让 passwordRequired 翻转，
  // 若这些 hook 在 return 之后，首次渲染与解锁后渲染的 hook 数量不同，
  // React 会抛 "Rendered more hooks than during the previous render" 并整页白屏。
  const [showTour, setShowTour] = useState(false);
  useEffect(() => {
    const hasSeen = localStorage.getItem("blendproof:has-seen-tour");
    if (!hasSeen && share) {
      const timer = window.setTimeout(() => setShowTour(true), 1500);
      return () => window.clearTimeout(timer);
    }
  }, [share]);
  const handleCloseTour = useCallback(() => {
    localStorage.setItem("blendproof:has-seen-tour", "true");
    setShowTour(false);
  }, []);

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
    <>
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
          ? "管理员永久公开示例 · 可批注 · 不限时。"
          : share.commentsPermission === "comment"
          ? "访客可在模型表面添加批注。"
          : transport === "cloud"
          ? "只读分享。文件由云端 BlendProof 提供。"
          : "只读分享。文件由本机 BlendProof 提供。"
      }
      modelUrl={share.modelUrl}
      readOnly
      canView={!isDemoShare}
      guideSteps={CLIENT_GUIDE_STEPS}
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
      {showTour && (
        <GuidedTour steps={VIEWPORT_TOUR_STEPS} onClose={handleCloseTour} />
      )}
    </>
  );
}
