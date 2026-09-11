# BlendProof 协作约定

## 稳定产品边界

- 一个 Web 同时承担上传工作台和 `/s/<token>` 分享读取，必须复用同一 Viewer。
- `.blend` 只进入本机 bridge；Worker/R2 永远不得接收原始工程。云端仅允许 `model.glb`、裁剪后的 `manifest.json` 和可选 `thumbnail.webp`。
- Viewer 操作以 Blender 为基线：中键旋转、Shift+中键平移、滚轮缩放、空白取消选择、框选、`/` 独显、文件相机和 Blender 式显示模式。
- 首页维持 Blender Welcome 风格的单启动面板与 Tab，不把功能重新拆成互相重复的页面或多卡片 Dashboard。

## 账号与权限

- D1 角色只有 `admin`、`user`；审稿权限来自分享的 `read/comment` 设置，不增加静态 reviewer 角色。
- 邀请码注册、会话和项目归属必须由 Worker 强制执行，前端显示不能代替服务端授权。
- 邀请码是管理员可创建的独立资源，不是一账号一邀请码；每个码有自己的 `max_uses`、到期和撤销状态，公开响应不得返回 code hash。
- “删除成员”采用停用账号和撤销会话，不物理删除项目、评论或审计关系；禁止管理员停用自己。
- 首位管理员仅允许空库 bootstrap：邮箱/名称是部署变量，`BOOTSTRAP_ADMIN_TOKEN` 是 Cloudflare Secret。成功后删除 Secret，不提供“首位注册自动升管理员”。
- 临时账号密码、邀请码、session、owner capability 和 Secret 不得提交。`.dev.vars` 保持 Git ignored。

## 公益池与部署

- 业务容量上限 5 GiB；默认分享 24 小时，项目与派生资产硬上限 48 小时；D1 负责预留/结算，定时任务按精确 R2 key 清理。
- 本地实现、Miniflare、测试和 dry-run 可以直接执行；真实 Cloudflare 资源、DNS、Secret、远程 migration 或生产数据变更必须先获得用户明确授权。
- `APP_ORIGIN` 必须与实际 Web Origin 完全一致；本地标准入口为 `http://localhost:5173`。

## 验收与工作区纪律

- 变更后至少运行 `npm run check`、`npm run check:worker`、相关测试；涉及 Worker 时再运行 `npm run worker:dry-run`。
- UI 变更使用内置浏览器或 Playwright 实际点击验证，不只依赖构建成功。
- 不覆盖或提交用户的无关修改。当前 `temp/3D-Review-Research/README.md` 的删除状态属于用户，除非用户明确要求，否则保持不动。
- 长期状态记录在 `.planning/STATE.md`，阶段 4 明细记录在 `.planning/phases/04-cloud/04-01-PLAN.md`。
