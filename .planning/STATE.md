# BlendProof Project State

Phase: 4 of 4（云端替换）
Plan: 04-01
Status: In progress
Last activity: 2026-09-10 - Worker 派生资产上传状态机与本机 bridge/上传弹窗完成并通过浏览器验收

Progress: ████░ 92%

## Decisions

- 同一个 Web 复用上传与分享 Viewer。
- `.blend` 由本机 Blender 转换，Web 读取 GLB。
- Viewer 内核能力以成熟参考实现为基线，产品层保留 Blender 风格外壳。

## Current Risks

- `node:sqlite` 在本机 Node 22 可用但仍有 ExperimentalWarning，必须锁定运行时并保持 D1 适配边界。
- Worker 已完成项目初始化、上传 intent、派生资产 PUT、finalize 与定时 staging 清理；分享访问、密码、撤销和评论 API 尚未迁移。
- 本机 bridge 与 Worker 已拆分 transport，但本机 bridge 的一次性 pairing nonce 和精确 Origin 授权仍待实现。
- Web typed client 已收口现有本地流程，云端 publish 编排与上传阶段 UI 尚未接入。
- Phase 4 需要真实 Cloudflare 资源授权；本地 Miniflare 验收不能替代线上部署验收。

## Session Continuity

Last session: 2026-09-10
Stopped at: Phase 4B upload slice + Phase 4C local uploader modal; next implement Worker share/comments and bridge pairing
Resume file: `.planning/phases/04-cloud/04-01-PLAN.md`
