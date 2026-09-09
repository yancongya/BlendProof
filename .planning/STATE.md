# BlendProof Project State

Phase: 4 of 4（云端替换）
Plan: 04-01
Status: In progress
Last activity: 2026-09-09 - Phase 4A 存储/数据库合同建立，云端安全状态机门槛已固定

Progress: ████░ 88%

## Decisions

- 同一个 Web 复用上传与分享 Viewer。
- `.blend` 由本机 Blender 转换，Web 读取 GLB。
- Viewer 内核能力以成熟参考实现为基线，产品层保留 Blender 风格外壳。

## Current Risks

- `node:sqlite` 在本机 Node 22 可用但仍有 ExperimentalWarning，必须锁定运行时并保持 D1 适配边界。
- ShareAccess 尚未从 Express 路由完整提取，Worker/D1/R2 实现尚未建立。
- Phase 4 需要真实 Cloudflare 资源授权；本地 Miniflare 验收不能替代线上部署验收。

## Session Continuity

Last session: 2026-09-09
Stopped at: Phase 4 Wave 4A adapter boundary
Resume file: `.planning/phases/04-cloud/04-01-PLAN.md`
