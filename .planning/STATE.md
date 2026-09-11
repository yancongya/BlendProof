# BlendProof Project State

Phase: 4 of 4（云端替换）
Plan: 04-01
Status: In progress
Last activity: 2026-09-11 - Blender 单面板启动器、邀请码账号与个人空间统计完成本地验收

Progress: ████▉ 99%

## Decisions

- 同一个 Web 复用上传与分享 Viewer。
- `.blend` 由本机 Blender 转换，Web 读取 GLB。
- Viewer 内核能力以成熟参考实现为基线，产品层保留 Blender 风格外壳。

## Current Risks

- `node:sqlite` 在本机 Node 22 可用但仍有 ExperimentalWarning，必须锁定运行时并保持 D1 适配边界。
- Worker 已完成项目、派生资产、分享访问、密码、撤销、评论及定时清理本地实现；尚未进行真实 Cloudflare 资源验收。
- 本机 bridge 使用精确 Origin/Referer 解析与短期、Origin-bound nonce；开发脚本中的固定配对码只用于本地便利，生产仍需带外配对入口。
- Web typed client 已接入云端 publish、精确 upload intent、清单去敏、创建分享与 `/s/:token?source=cloud` 读取；尚未验证真实 Cloudflare 环境与网络故障恢复。
- D1 固定窗口限流已覆盖项目创建、上传 intent、密码尝试与访客评论；尚待真实边缘 IP/并发复验。
- D1 已作为 5 GiB 公益存储池的原子配额账本；上传先预留、finalize 结算、失败/过期释放，R2 指标仅用于未来对账。
- 云端项目最长保留 48 小时（即使未创建分享），分享默认 24 小时；每小时 cron 通过精确 R2 key 账本重试清理。
- 首页改为 Blender 风格单面板启动器，通过“开始 / 最近项目 / 平台状态 / 账号”Tab 复用上传、分享与状态能力；封面为项目原创资产。
- D1 已加入邀请码注册、PBKDF2 密码、哈希会话 token、个人空间统计和管理员邀请码接口；公开用户数按未停用注册账号统计。
- 首位管理员不能从公开注册流程自举，生产部署时必须由获授权操作员在 D1 中安全种子化；具体生产身份与恢复流程仍需上线前确认。
- 首位管理员支持部署变量邮箱/名称 + Secret token 的一次性空库 bootstrap；本地已建立管理员、上传者、审稿者三个临时账号验证角色界面，生产仍须删除 bootstrap secret 后才开放。
- Welcome 改为覆盖 Viewer 的可关闭模态层；管理员页已接成员用量/停用、邀请码列表/新增/撤销，以及 5 GiB/48h 硬上限内的平台阈值设置。
- 空工作区已使用用户提供的 Suzanne 工程离线导出的 68 KB GLB 作为默认模型；源 `.blend` 不进构建。注册用户继续通过可评论分享参与审稿，暂不扩张为正式审批状态机。
- Phase 4 需要真实 Cloudflare 资源授权；本地 Miniflare 验收不能替代线上部署验收。

## Session Continuity

Last session: 2026-09-11
Stopped at: Phase 4D local hardening, invite accounts and Blender launcher complete; next requires authorized admin bootstrap and real Cloudflare production acceptance
Resume file: `.planning/phases/04-cloud/04-01-PLAN.md`
