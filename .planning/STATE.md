# BlendProof Project State

Phase: 2 of 4（审稿能力）
Plan: 待创建
Status: Ready
Last activity: 2026-09-08 - Viewer 内核通过三组样例的真实浏览器验收

Progress: ███░░ 55%

## Decisions

- 同一个 Web 复用上传与分享 Viewer。
- `.blend` 由本机 Blender 转换，Web 读取 GLB。
- Viewer 内核能力以成熟参考实现为基线，产品层保留 Blender 风格外壳。

## Current Risks

- 阶段 2 尚未固定评论锚点、相机状态和截图的数据合同。
- 当前本地分享仍是文件 manifest 合同；SQLite、密码、有效期与用户边界属于阶段 3。

## Session Continuity

Last session: 2026-09-08
Stopped at: Phase 2 planning boundary
Resume file: `docs/LONG_TERM_PLAN.md`
