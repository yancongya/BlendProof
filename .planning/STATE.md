# BlendProof Project State

Phase: 4 of 4（云端替换）
Plan: 04-01
Status: In progress
Last activity: 2026-09-11 - 公益存储池、48h 自动清理、公开统计与 Blender 风格首页/菜单完成本地验收

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
- 首页已显示可用容量、在线项目、有效分享与已识别用户数；邀请码账户表和管理后台仍属后续范围，当前匿名项目不会虚构为用户。
- Phase 4 需要真实 Cloudflare 资源授权；本地 Miniflare 验收不能替代线上部署验收。

## Session Continuity

Last session: 2026-09-11
Stopped at: Phase 4D local hardening plus public-pool retention complete; next requires authorized real Cloudflare deployment and production acceptance
Resume file: `.planning/phases/04-cloud/04-01-PLAN.md`
