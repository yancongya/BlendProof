/**
 * StartPage — the Blender-style welcome launcher modal that overlays the
 * Viewer on first load and when the user clicks the home button.
 *
 * Contains four tabs: 开始 (Start) / 最近项目 (Recent) / 平台状态 (Status) / 账号 (Account).
 *
 * Extracted from App.tsx L861–974.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  HardDrive,
  KeyRound,
  Link2,
  LogIn,
  LogOut,
  ShieldCheck,
  User,
  X,
  Box,
  Eye,
} from "lucide-react";
import { BlenderLogo } from "../components/BlenderLogo";
import { SplashActions } from "../components/TopActions";
import { AdminConsole } from "./AdminConsole";
import { LegalDocument } from "./LegalDocument";
import { blendProofClient } from "../api/blendProofClient";
import type {
  AccountStats,
  AccountUser,
  PublicStats,
} from "../api/blendProofClient";
import type { Project } from "../types";
import { formatBytes, formatDuration } from "../utils";

export function StartPage({
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
  initialTab = "start",
  onClose,
}: {
  recentProjects: Project[];
  stats: PublicStats | null;
  account: AccountUser | null;
  accountStats: AccountStats | null;
  onOpenFile: () => void;
  onProjectSelect: (project: Project) => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (input: {
    inviteCode: string;
    email: string;
    password: string;
    displayName: string;
  }) => Promise<void>;
  onLogout: () => Promise<void>;
  onCreateInvite: (
    expiresInHours: number,
    maxUses: number,
  ) => Promise<{ code: string; expiresAt: string; maxUses: number }>;
  initialTab?: "start" | "recent" | "status" | "account";
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
  const [startTab, setStartTab] = useState<
    "start" | "recent" | "status" | "account"
  >(initialTab);
  const [legalDocument, setLegalDocument] = useState<
    "privacy" | "terms" | null
  >(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const responseTime = useMemo(() => {
    const navigation = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming | undefined;
    const elapsed = navigation
      ? navigation.responseEnd - navigation.requestStart
      : 0;
    return Math.max(1, Math.round(elapsed || performance.now()));
  }, []);

  const [clipboardMatch, setClipboardMatch] = useState<{ url: string; password?: string; projectName?: string } | null>(null);

  useEffect(() => {
    function parseClipboardText(text: string) {
      const urlMatch = text.match(/https?:\/\/[^\s]+\/s\/([a-zA-Z0-9_-]+)/);
      const pwdMatch = text.match(/密码：([^\s]+)/);
      const projMatch = text.match(/项目：([^\n]+)/);
      
      if (urlMatch) {
         setClipboardMatch({
           url: urlMatch[0],
           password: pwdMatch ? pwdMatch[1] : undefined,
           projectName: projMatch ? projMatch[1] : undefined
         });
      }
    }

    async function checkClipboard() {
      try {
        const text = await navigator.clipboard.readText();
        parseClipboardText(text);
      } catch (e) {
        // Ignored
      }
    }
    
    function handlePaste(e: ClipboardEvent) {
      const text = e.clipboardData?.getData("text");
      if (text) parseClipboardText(text);
    }

    window.addEventListener("focus", checkClipboard);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("focus", checkClipboard);
      window.removeEventListener("paste", handlePaste);
    };
  }, []);


  function openShare() {
    const value = shareInput.trim();
    const candidate = value.match(/^[a-f0-9]{32}$/)
      ? `/s/${value}`
      : value;
    try {
      const target = new URL(candidate, window.location.origin);
      if (
        target.origin !== window.location.origin ||
        !/^\/s\/(?:[a-f0-9]{32}|suzanne)$/.test(target.pathname)
      )
        throw new Error();
      window.location.assign(
        `${target.pathname}${target.search}${target.hash}`,
      );
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
      setAccountError(
        reason instanceof Error ? reason.message : "账号操作失败。",
      );
    } finally {
      setAccountBusy(false);
    }
  }

  return (
    <main
      className="blendproof-start-page"
      data-testid="start-page"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="start-launcher"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="start-launcher-close"
          aria-label="关闭欢迎页"
          onClick={onClose}
        >
          <X size={16} />
        </button>
        <div className="start-splash">
          <video
            className="start-splash-video"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/blendproof-splash-v2.jpg"
            aria-hidden="true"
          >
            <source src="/intro.mp4" type="video/mp4" />
          </video>
          <div className="start-splash-brand">
            <BlenderLogo />
            <span>BlendProof</span>
          </div>
          <span className="start-splash-version">Web 0.1</span>
          <div className="start-splash-copy">
            <strong>Blender 工程的轻量审稿台</strong>
            <span>本机转换 · 原始工程不上传</span>
          </div>
        </div>
        <nav
          className="start-tabs"
          role="tablist"
          aria-label="启动页导航"
        >
          {(
            [
              ["start", "开始"],
              ["recent", "最近项目"],
              ["status", "平台状态"],
              ["account", "账号"],
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              role="tab"
              id={`start-tab-${key}`}
              aria-controls="start-tabpanel"
              key={key}
              className={startTab === key ? "active" : ""}
              aria-selected={startTab === key}
              onClick={() => setStartTab(key)}
            >
              {label}
            </button>
          ))}
          <div className="start-tabs-actions">
            <SplashActions />
          </div>
        </nav>
        <div
          className="start-tab-body"
          id="start-tabpanel"
          role="tabpanel"
          aria-labelledby={`start-tab-${startTab}`}
          tabIndex={0}
        >
          {startTab === "start" && (
            <div className="start-actions-grid">
              <section className="start-action-section">
                <h2>新建审稿</h2>
                <button
                  className="start-menu-action"
                  type="button"
                  onClick={onOpenFile}
                >
                  <Box />
                  <span>
                    <strong>打开 .blend 文件</strong>
                    <small>在本机转换并生成 Web 预览</small>
                  </span>
                </button>
                <div className="start-privacy-note">
                  <ShieldCheck size={15} />
                  <span>原始 .blend 不会上传云端</span>
                </div>
              </section>
              <section className="start-action-section">
                <h2>打开分享</h2>
                {clipboardMatch && (
                  <div className="clipboard-toast" style={{ background: 'var(--panel-bg-hover, #2c2c2c)', padding: '10px 12px', borderRadius: '6px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--border-color, #444)' }}>
                    <div>
                      <div style={{ color: 'var(--text-color, #e5e5e5)', fontSize: '13px', fontWeight: 'bold' }}>检测到分享口令</div>
                      <div style={{ color: 'var(--text-muted, #aaa)', fontSize: '11px', marginTop: '2px' }}>{clipboardMatch.projectName || "3D 协作模型"}</div>
                    </div>
                    <button 
                      type="button"
                      onClick={() => {
                         let target = clipboardMatch.url;
                         if (clipboardMatch.password) target += `?pwd=${encodeURIComponent(clipboardMatch.password)}`;
                         window.location.assign(target);
                      }}
                      style={{ background: 'var(--accent-color, #3b82f6)', color: '#fff', padding: '6px 12px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', border: 'none', fontWeight: 500 }}
                    >
                      立即打开
                    </button>
                  </div>
                )}
                <form
                  className="start-share-entry"
                  onSubmit={(event) => {
                    event.preventDefault();
                    openShare();
                  }}
                >
                  <label htmlFor="start-share-code">
                    <Link2 size={18} />
                    <span>
                      <strong>分享链接或分享码</strong>
                      <small>无需账号即可打开只读分享</small>
                    </span>
                  </label>
                  <div>
                    <input
                      id="start-share-code"
                      aria-label="分享链接或分享码"
                      value={shareInput}
                      onChange={(event) => {
                        setShareInput(event.target.value);
                        setShareError(null);
                      }}
                      placeholder="粘贴 /s/… 或 32 位分享码"
                    />
                    <button type="submit">打开</button>
                  </div>
                  {shareError && <small role="alert">{shareError}</small>}
                  <button
                    type="button"
                    className="start-demo-btn"
                    onClick={() => window.location.assign("/s/suzanne")}
                  >
                    <Eye size={14} />
                    <span>快速体验：Suzanne 猴头公开演示（口令 tycon）</span>
                  </button>
                </form>
              </section>
            </div>
          )}
          {startTab === "recent" && (
            <section className="start-recent-panel">
              <div className="start-panel-heading">
                <span>最近打开的项目</span>
                <button onClick={onOpenFile}>打开其他文件</button>
              </div>
              {recentProjects.length ? (
                <div className="start-recent-list">
                  {recentProjects.slice(0, 8).map((item) => (
                    <button
                      type="button"
                      className="start-recent-item"
                      key={item.id}
                      onClick={() => onProjectSelect(item)}
                    >
                      <span className="start-file-icon">
                        <Box size={15} />
                      </span>
                      <span>
                        <strong>{item.name}</strong>
                        <small>本机转换项目 · {item.id.slice(0, 6)}</small>
                      </span>
                      <ChevronDown size={14} className="start-recent-arrow" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="start-empty">
                  还没有最近项目。请先打开一个 .blend 文件。
                </p>
              )}
            </section>
          )}
          {startTab === "status" && (
            <section className="start-system-panel">
              <div className="start-panel-heading">
                <span>
                  <HardDrive size={14} /> 公益存储池
                </span>
                <i>
                  已运行{" "}
                  {stats
                    ? formatDuration(clock - Date.parse(stats.launchedAt))
                    : "—"}
                </i>
              </div>
              <div className="storage-reading">
                <strong>
                  {stats ? formatBytes(stats.remainingBytes) : "—"}
                </strong>
                <span>
                  当前可用 / {stats ? formatBytes(stats.capacityBytes) : "—"}
                </span>
              </div>
              <div
                className="storage-meter"
                role="progressbar"
                aria-label="公益存储池已用容量"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={
                  stats
                    ? Math.min(
                        100,
                        (stats.usedBytes / stats.capacityBytes) * 100,
                      )
                    : 0
                }
              >
                <span
                  style={{
                    width: `${
                      stats
                        ? Math.min(
                            100,
                            (stats.usedBytes / stats.capacityBytes) * 100,
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
              <div className="start-stats" aria-label="平台状态">
                <span>
                  <strong>{stats?.projectCount ?? "—"}</strong>
                  <small>在线项目</small>
                </span>
                <span>
                  <strong>{stats?.activeShareCount ?? "—"}</strong>
                  <small>有效分享</small>
                </span>
                <span>
                  <strong>{stats?.userCount ?? "—"}</strong>
                  <small>注册用户</small>
                </span>
              </div>
              <div className="start-lifetime-stats" aria-label="累计处理统计">
                <span>
                  <small>累计处理</small>
                  <strong>{stats?.processedFileCount ?? "—"} 份</strong>
                  <em>
                    {stats
                      ? `${stats.processedAssetCount} 个派生资产`
                      : "—"}
                  </em>
                </span>
                <span>
                  <small>处理总量</small>
                  <strong>
                    {stats ? formatBytes(stats.processedBytes) : "—"}
                  </strong>
                  <em>成功发布的 Web 资产</em>
                </span>
                <span>
                  <small>已自动清理</small>
                  <strong>{stats?.cleanedFileCount ?? "—"} 个</strong>
                  <em>
                    {stats ? formatBytes(stats.cleanedBytes) : "—"}
                  </em>
                </span>
              </div>
              <p className="start-retention">
                建议 24 小时内完成审稿；分享最长{" "}
                {stats?.retentionHours ?? 48} 小时，派生资产到期自动清理。
              </p>
              <div className="start-site-notice">
                <p>
                  {responseTime} ms · Gzip 启用。用户提交内容仅代表其作者，不代表
                  BlendProof 立场。联系：
                  <a href="mailto:admin@itycon.cn">admin@itycon.cn</a>
                </p>
                <p>
                  禁止上传色情、暴力、恐怖主义、违法或侵犯他人权益的文件。
                </p>
                <p>
                  © 2026 BlendProof. All rights reserved.{" "}
                  <button
                    type="button"
                    onClick={() => setLegalDocument("privacy")}
                  >
                    隐私政策
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => setLegalDocument("terms")}
                  >
                    服务条款
                  </button>
                </p>
              </div>
            </section>
          )}
          {startTab === "account" && (
            <section className="start-user-panel">
              <div className="start-panel-heading">
                <span>
                  <User size={14} /> {account ? "我的账号" : "账号入口"}
                </span>
                {account?.role === "admin" && (
                  <i className="admin-badge">
                    <ShieldCheck size={12} /> 管理员
                  </i>
                )}
              </div>
              {account ? (
                <>
                  <div className="account-identity">
                    <b>{account.displayName.slice(0, 1).toUpperCase()}</b>
                    <span>
                      <strong>{account.displayName}</strong>
                      <small>{account.email}</small>
                    </span>
                    <button
                      className="account-logout"
                      onClick={() => void onLogout()}
                    >
                      <LogOut size={13} /> 退出
                    </button>
                  </div>
                  <dl className="account-usage">
                    <div>
                      <dt>个人占用</dt>
                      <dd>
                        {accountStats
                          ? formatBytes(accountStats.usedBytes)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>项目</dt>
                      <dd>{accountStats?.projectCount ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>有效分享</dt>
                      <dd>{accountStats?.activeShareCount ?? "—"}</dd>
                    </div>
                  </dl>
                  {account.role === "admin" && (
                    <AdminConsole
                      accountId={account.id}
                      onCreateInvite={onCreateInvite}
                    />
                  )}
                </>
              ) : (
                <>
                  <p>
                    登录后可以查看自己的项目、分享数量和空间占用。为了控制公益资源，注册需要管理员发放的邀请码。
                  </p>
                  <div className="account-buttons">
                    <button
                      onClick={() => {
                        setAuthMode("login");
                        setAuthOpen(true);
                      }}
                    >
                      <LogIn size={13} /> 登录
                    </button>
                    <button
                      onClick={() => {
                        setAuthMode("register");
                        setAuthOpen(true);
                      }}
                    >
                      <KeyRound size={13} /> 使用邀请码注册
                    </button>
                  </div>
                  <div className="demo-account-box" style={{ marginTop: '16px', padding: '12px', background: '#1c1c1c', border: '1px solid #333', borderRadius: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e87d0d', fontSize: '11px', fontWeight: 600, marginBottom: '6px' }}>
                      <ShieldCheck size={14} /> 公开体验账号
                    </div>
                    <p style={{ margin: '0 0 8px', color: '#999', fontSize: '10px', lineHeight: 1.5 }}>
                      访客可使用通用体验账号登录，体验完整的项目审稿与批注功能：
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 8px', fontSize: '10px', color: '#bbb', background: '#141414', padding: '8px', borderRadius: '2px', border: '1px solid #282828' }}>
                      <span style={{ color: '#777' }}>邮箱：</span>
                      <code>guest@blendproof.itycon.cn</code>
                      <span style={{ color: '#777' }}>密码：</span>
                      <code>tycon</code>
                    </div>
                    <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        style={{ padding: '4px 10px', background: '#2c2c2c', border: '1px solid #444', color: '#e0e0e0', borderRadius: '2px', fontSize: '10px', cursor: 'pointer' }}
                        onClick={() => {
                          setEmail("guest@blendproof.itycon.cn");
                          setPassword("tycon");
                          setAuthMode("login");
                          setAuthOpen(true);
                        }}
                      >
                        一键填入并登录
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
        <footer className="start-launcher-footer">
          <span>BlendProof 公益 3D 审稿</span>
          <span>
            {stats
              ? `${stats.projectCount} 项目 · ${stats.activeShareCount} 分享 · ${stats.userCount} 用户`
              : "—"}{" "}
            · 容量 {stats ? formatBytes(stats.capacityBytes) : "—"} ·
            最长分享 {stats?.retentionHours ?? 48} 小时
          </span>
        </footer>
      </section>
      {authOpen && (
        <div
          className="uploader-modal-backdrop account-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAuthOpen(false);
          }}
        >
          <form
            className="account-modal"
            role="dialog"
            aria-label={authMode === "login" ? "登录" : "邀请码注册"}
            onSubmit={submitAccount}
          >
            <div className="account-modal-head">
              <strong>
                {authMode === "login"
                  ? "登录 BlendProof"
                  : "使用邀请码注册"}
              </strong>
              <button
                type="button"
                aria-label="关闭账号面板"
                onClick={() => setAuthOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="account-tabs">
              <button
                type="button"
                className={authMode === "login" ? "active" : ""}
                onClick={() => {
                  setAuthMode("login");
                  setAccountError(null);
                }}
              >
                登录
              </button>
              <button
                type="button"
                className={authMode === "register" ? "active" : ""}
                onClick={() => {
                  setAuthMode("register");
                  setAccountError(null);
                }}
              >
                注册
              </button>
            </div>
            {authMode === "register" && (
              <>
                <label>
                  显示名称
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                  />
                </label>
                <label>
                  邀请码
                  <input
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value)}
                    required
                  />
                </label>
              </>
            )}
            <label>
              邮箱
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={password}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {accountError && <p role="alert">{accountError}</p>}
            <button className="account-submit" disabled={accountBusy}>
              {accountBusy
                ? "处理中…"
                : authMode === "login"
                ? "登录"
                : "创建账号"}
            </button>
            <small>注册只接受管理员发放的邀请码。</small>
          </form>
        </div>
      )}
      {legalDocument && (
        <LegalDocument
          kind={legalDocument}
          onClose={() => setLegalDocument(null)}
        />
      )}
    </main>
  );
}
