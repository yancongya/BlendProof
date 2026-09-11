# BlendProof 本地里程碑验收

日期：2026-09-11

## 结论

本地目标已形成同一个 Web 内的完整闭环：Blender 工程经 loopback bridge 转换为 GLB，上传者在 Blender 风格 Viewer 中审稿并创建受控分享，接收方通过 `/s/:token` 复用同一 Viewer 查看或添加表面批注。

## 当前证据

- Viewer：无/单/多文件相机、1/3/7/0 预设、透视/正交切换、选择、空白取消、框选、`/` 独显、线框/灰模/材质模式已有浏览器画布验收。
- Blender 操作：中键旋转、Shift+中键平移、滚轮缩放；本轮用真实画布拖拽确认 Shift+中键只平移视图而不改变模型观察姿态。
- 视口外壳：无限网格、X/Y 轴、叠加层开关、场景树、独显按钮、暗色滚动条和可拖拽面板分隔条均在真实浏览器验证。
- 审稿：表面锚点、编号 pin、正文编辑、解决/重开、稳定相机重放、只读及可评论分享已验收。
- 本地后端：SQLite 项目/分享/评论、owner capability、密码、到期、撤销和访客权限由服务端强制执行。
- 上传安全：原始 `.blend` 只发往 loopback bridge，公开路由不提供源文件；本轮真实转换 `猴头.blend` 并确认 UTF-8 文件名、1 Collection、1 Object、1 Material 与 68.1 KB GLB 正常显示。
- 分享闭环：发送方凭证卡与接收方通行证显示权限和到期；真实新标签页成功读取同一模型及可评论权限。
- UI 回归：文件菜单从左侧完整展开，“最近项目”悬停显示二级菜单并可直接切换；叠加层可同时隐藏和恢复网格与坐标轴。

## 自动化门禁

- `npm run check`
- `npm run check:worker`
- `npm run test:backend`
- `npm run test:worker`
- `npm run build`
- `npm run worker:dry-run`
- `git diff --check`

真实 Cloudflare D1/R2/Worker 部署属于 Phase 4D 的独立生产验收，必须在获得账户和目标资源授权后执行，不影响本地里程碑结论。
