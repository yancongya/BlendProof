/**
 * Lightweight full-screen notice views used before the main Viewer loads:
 * - PasswordNotice: password prompt for protected shares
 * - GuestNameNotice: display-name prompt for commentable shares
 * - Notice: generic loading / error message
 */

import { BlenderLogo } from "./BlenderLogo";

export function PasswordNotice({
  password,
  error,
  onPassword,
  onSubmit,
}: {
  password: string;
  error: string | null;
  onPassword: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="notice">
      <BlenderLogo />
      <h1>受保护的分享链接</h1>
      <p>{error ?? "请输入分享密码后继续。"}</p>
      <input
        aria-label="访问密码"
        type="password"
        value={password}
        autoFocus
        onChange={(event) => onPassword(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") onSubmit(); }}
      />
      <button className="primary" onClick={onSubmit}>打开审稿</button>
    </div>
  );
}

export function GuestNameNotice({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="notice">
      <BlenderLogo />
      <h1>进入审稿</h1>
      <p>填写一个名称，批注会以此名称显示给项目作者。</p>
      <input
        aria-label="审核名称"
        autoFocus
        maxLength={40}
        value={value}
        placeholder="例如：客户 A"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") onSubmit(); }}
      />
      <button className="primary" disabled={!value.trim()} onClick={onSubmit}>继续审稿</button>
    </div>
  );
}

export function Notice({ text }: { text: string }) {
  return (
    <div className="notice">
      <BlenderLogo />
      <h1>BlendProof</h1>
      <p>{text}</p>
    </div>
  );
}
