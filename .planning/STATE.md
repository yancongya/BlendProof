# BlendProof Project State

Phase: 0 of 4（研究基线）
Plan: 00-01
Status: Complete
Last activity: 2026-09-08 - 固化三组相机样例和浏览器失败基线

Progress: █░░░░ 20%

## Decisions

- 同一个 Web 复用上传与分享 Viewer。
- `.blend` 由本机 Blender 转换，Web 读取 GLB。
- Viewer 内核能力以成熟参考实现为基线，产品层保留 Blender 风格外壳。

## Current Risks

- 当前 React Three Fiber Viewer 对已验证的 GLB 在浏览器画布中不呈现；文件相机控制因此未出现。
- 相机切换、框选与局部视图仍未具备真实浏览器通过证据。

## Session Continuity

Last session: 2026-09-08
Stopped at: Phase 0 complete
Resume file: `docs/VIEWER_BASELINE.md`
