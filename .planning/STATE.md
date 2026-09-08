# BlendProof Project State

Phase: 1 of 4（Viewer 内核）
Plan: 01-01
Status: In progress
Last activity: 2026-09-08 - 完成同源模型加载与文件相机投影修复，待浏览器复验

Progress: ██░░░ 40%

## Decisions

- 同一个 Web 复用上传与分享 Viewer。
- `.blend` 由本机 Blender 转换，Web 读取 GLB。
- Viewer 内核能力以成熟参考实现为基线，产品层保留 Blender 风格外壳。

## Current Risks

- 多相机 GLB 已在浏览器画布呈现，文件相机按钮已出现；透视文件相机切换已有浏览器截图。
- 顶部正交相机的最终投影复验被本地服务进程中断阻塞；选择、框选与局部视图仍未具备真实浏览器通过证据。

## Session Continuity

Last session: 2026-09-08
Stopped at: Phase 1 browser verification
Resume file: `.planning/phases/01-viewer-core/01-01-PLAN.md`
