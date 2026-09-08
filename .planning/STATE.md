# BlendProof Project State

Phase: 0 of 4（研究基线）
Plan: 00-01
Status: In progress
Last activity: 2026-09-08 - 开始执行研究基线

Progress: ░░░░░ 0%

## Decisions

- 同一个 Web 复用上传与分享 Viewer。
- `.blend` 由本机 Blender 转换，Web 读取 GLB。
- Viewer 内核能力以成熟参考实现为基线，产品层保留 Blender 风格外壳。

## Current Risks

- 当前 React Three Fiber 相机控制在切换文件相机后闪回。
- 当前框选与局部视图属于自写实现，尚未经过独立 Viewer 基线验证。

## Session Continuity

Last session: 2026-09-08
Stopped at: Phase 0 execution started
Resume file: `.planning/phases/00-research-baseline/00-01-PLAN.md`
