/**
 * AdminConsole — admin-only section shown inside the Account tab of StartPage.
 * Manages platform settings, member list, and invite codes.
 */

import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { blendProofClient } from "../api/blendProofClient";
import type { AdminInvite, AdminSettings, AdminUser } from "../api/blendProofClient";
import { getLang } from "../i18n";
import { tf } from "../i18n";
import { formatBytes } from "../utils";

export function AdminConsole({
  accountId,
  onCreateInvite,
}: {
  accountId: string;
  onCreateInvite: (
    expiresInHours: number,
    maxUses: number,
  ) => Promise<{ code: string }>;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [settings, setSettings] = useState<AdminSettings>({
    capacityBytes: 5 * 1024 ** 3,
    maxShareHours: 48,
  });
  const [inviteHours, setInviteHours] = useState(168);
  const [inviteUses, setInviteUses] = useState(1);
  const [latestCode, setLatestCode] = useState<string | null>(null);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextUsers, nextInvites, nextSettings] = await Promise.all([
      blendProofClient.adminUsers(),
      blendProofClient.adminInvites(),
      blendProofClient.adminSettings(),
    ]);
    setUsers(nextUsers);
    setInvites(nextInvites);
    setSettings(nextSettings);
  }, []);

  useEffect(() => {
    refresh().catch((reason) =>
      setAdminMessage(
        reason instanceof Error ? reason.message : "无法读取管理信息。",
      ),
    );
  }, [refresh]);

  return (
    <div className="admin-console">
      <section>
        <div className="admin-section-title">
          <strong>平台设置</strong>
          <span>安全上限：5 GB / 48 小时</span>
        </div>
        <div className="admin-settings-row">
          <label>
            存储阈值
            <select
              value={settings.capacityBytes}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  capacityBytes: Number(event.target.value),
                }))
              }
            >
              <option value={1024 ** 3}>1 GB</option>
              <option value={2 * 1024 ** 3}>2 GB</option>
              <option value={3 * 1024 ** 3}>3 GB</option>
              <option value={5 * 1024 ** 3}>5 GB</option>
            </select>
          </label>
          <label>
            最长分享
            <select
              value={settings.maxShareHours}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  maxShareHours: Number(event.target.value),
                }))
              }
            >
              <option value={12}>12 小时</option>
              <option value={24}>24 小时</option>
              <option value={48}>48 小时</option>
            </select>
          </label>
          <button
            onClick={async () => {
              try {
                setSettings(
                  await blendProofClient.updateAdminSettings(settings),
                );
                setAdminMessage("平台设置已保存。");
              } catch (reason) {
                setAdminMessage(
                  reason instanceof Error ? reason.message : "保存失败。",
                );
              }
            }}
          >
            保存设置
          </button>
        </div>
      </section>
      <section>
        <div className="admin-section-title">
          <strong>成员</strong>
          <span>
            {users.filter((user) => !user.disabledAt).length} 个有效账号
          </span>
        </div>
        <div className="admin-table">
          {users.map((user) => (
            <div className={user.disabledAt ? "disabled" : ""} key={user.id}>
              <span>
                <b>{user.displayName}</b>
                <small>{user.email}</small>
              </span>
              <span>{formatBytes(user.usedBytes)}</span>
              <span>{user.projectCount} 项目</span>
              <span>
                {user.role === "admin"
                  ? "管理员"
                  : user.disabledAt
                  ? "已停用"
                  : "成员"}
              </span>
              {user.id !== accountId &&
              user.role !== "admin" &&
              !user.disabledAt ? (
                <button
                  aria-label={tf("停用 %s", user.displayName)}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        tf("停用成员\u201c%s\u201d吗？", user.displayName),
                      )
                    )
                      return;
                    await blendProofClient.disableAdminUser(user.id);
                    await refresh();
                  }}
                >
                  停用
                </button>
              ) : (
                <i />
              )}
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="admin-section-title">
          <strong>邀请码</strong>
          <span>一个管理员可创建多个，每个码独立计算使用次数</span>
        </div>
        <div className="admin-invite-create">
          <label>
            有效期
            <input
              type="number"
              min={1}
              max={720}
              value={inviteHours}
              onChange={(event) => setInviteHours(Number(event.target.value))}
            />{" "}
            小时
          </label>
          <label>
            可用次数
            <input
              type="number"
              min={1}
              max={10000}
              value={inviteUses}
              onChange={(event) => setInviteUses(Number(event.target.value))}
            />
          </label>
          <button
            onClick={async () => {
              try {
                const result = await onCreateInvite(inviteHours, inviteUses);
                setLatestCode(result.code);
                await refresh();
              } catch (reason) {
                setAdminMessage(
                  reason instanceof Error ? reason.message : "创建失败。",
                );
              }
            }}
          >
            <KeyRound size={13} /> 新增邀请码
          </button>
        </div>
        {latestCode && (
          <code className="admin-latest-code">{latestCode}</code>
        )}
        <div className="admin-table invite-table">
          {invites.map((invite) => {
            const inactive =
              Boolean(invite.revokedAt) ||
              invite.usesCount >= invite.maxUses ||
              Date.parse(invite.expiresAt) <= Date.now();
            return (
              <div className={inactive ? "disabled" : ""} key={invite.id}>
                <span>
                  <b>…{invite.id.slice(-8)}</b>
                  <small>
                    {new Date(invite.expiresAt).toLocaleString(
                      getLang() === "en" ? "en-US" : "zh-CN",
                    )}
                  </small>
                </span>
                <span>
                  {invite.usesCount} / {invite.maxUses} 次
                </span>
                <span>
                  {invite.revokedAt
                    ? "已撤销"
                    : inactive
                    ? "已失效"
                    : "可用"}
                </span>
                {!inactive ? (
                  <button
                    aria-label={tf(
                      "撤销邀请码 %s",
                      invite.id.slice(-8),
                    )}
                    onClick={async () => {
                      await blendProofClient.revokeAdminInvite(invite.id);
                      await refresh();
                    }}
                  >
                    撤销
                  </button>
                ) : (
                  <i />
                )}
              </div>
            );
          })}
        </div>
      </section>
      {adminMessage && (
        <p className="admin-message" role="status">
          {adminMessage}
        </p>
      )}
    </div>
  );
}
