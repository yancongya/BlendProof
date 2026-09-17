/**
 * Share credential cards used in the workspace share panel (sender side)
 * and the share page (receiver side).
 */

import { useState } from "react";
import { CheckCircle2, Copy, ShieldCheck } from "lucide-react";
import { tf } from "../i18n";
import { formatShareExpiry } from "../utils";
import type { ProjectTransport } from "../api/blendProofClient";

// ---------------------------------------------------------------------------
// SenderShareCard — shown to the project owner after creating a share
// ---------------------------------------------------------------------------

export function SenderShareCard({
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
      <header><span>分享信息</span><b>已就绪</b></header>
      <div className="share-credential-code">{url.split("/s/").at(-1)?.split(/[?#]/)[0] ?? url}</div>
      <dl>
        <div><dt>权限</dt><dd>{permission === "comment" ? "可批注" : "仅查看"}</dd></div>
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

// ---------------------------------------------------------------------------
// ReceiverShareCard — shown to reviewers inside the share page viewer
// ---------------------------------------------------------------------------

export function ReceiverShareCard({
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
        <ShieldCheck size={13} /> {permission === "comment" ? "可批注" : "仅查看"}
      </button>
      {open && (
        <section className="share-credential-card receiver-card" aria-label="接收方分享信息">
          <header><span>分享信息</span><b>访问有效</b></header>
          <p>{publisher ? tf("%s发布的永久公开示例。", publisher) : "此页面只读取派生的 Web 模型，不包含原始 Blender 工程。"}</p>
          <dl>
            <div><dt>权限</dt><dd>{permission === "comment" ? "可批注" : "仅查看"}</dd></div>
            <div><dt>来源</dt><dd>{sourceLabel ?? (transport === "cloud" ? "云端快递柜" : "本机分享")}</dd></div>
            <div><dt>到期</dt><dd>{formatShareExpiry(expiresAt)}</dd></div>
          </dl>
        </section>
      )}
    </div>
  );
}
