# BlendProof Project State

Phase: 3 of 4（本地分享后端）
Plan: 待创建
Status: Ready
Last activity: 2026-09-09 - 表面批注、编辑、视角重放与只读分享通过浏览器验收

Progress: ████░ 72%

## Decisions

- 同一个 Web 复用上传与分享 Viewer。
- `.blend` 由本机 Blender 转换，Web 读取 GLB。
- Viewer 内核能力以成熟参考实现为基线，产品层保留 Blender 风格外壳。

## Current Risks

- 项目评论目前仍落在 `comments.json`，需要迁移到 SQLite 并保留 repository 合同。
- owner mutation 尚无服务端 capability；分享密码、有效期和访客评论权限尚未实现。

## Session Continuity

Last session: 2026-09-09
Stopped at: Phase 3 planning boundary
Resume file: `docs/LONG_TERM_PLAN.md`
