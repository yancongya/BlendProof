# BlendProof Project State

Phase: 4 of 4（云端替换）
Plan: 04-01
Status: In progress
Last activity: 2026-09-11 - 云端评论闭环、可恢复上传、D1 限流及部署恢复清单完成本地验收

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
- Phase 4 需要真实 Cloudflare 资源授权；本地 Miniflare 验收不能替代线上部署验收。

## Session Continuity

Last session: 2026-09-11
Stopped at: Phase 4D local hardening complete; next requires authorized real Cloudflare deployment and production acceptance
Resume file: `.planning/phases/04-cloud/04-01-PLAN.md`
