# Phase 3 Plan 01 Summary: Local Share Backend

## Outcome

同一个 Web 已完成 `.blend → GLB → owner 管理 → 受保护分享 → 隔离访客打开 → 模型表面评论`，项目、分享和评论元数据由 SQLite 管理。

## Data and Access Contract

- `node:sqlite` 启用 foreign keys、WAL、busy timeout 与版本化 schema。
- 旧 `manifest.json`、`share.json`、`comments.json` 按项目事务幂等导入，原文件不删除，测试备份不参与。
- 新项目仅返回一次 256-bit owner capability，数据库只保存 SHA-256；项目读写 API 对无凭据返回 401、错误或跨项目凭据返回 403。
- 分享 token 仅以 SHA-256 存储；密码使用随机 salt 的 scrypt，访问成功签发 token 路径限定的 HttpOnly、SameSite=Lax cookie。
- 分享统一执行撤销、到期和密码检查；`comment` 访客只能创建评论，不能编辑或解决。

## Verification

- `npm run test:backend`：13/13 通过，覆盖 schema 幂等、100 条评论批量写入、跨项目隔离、旧数据迁移/回滚、owner、密码、过期、撤销与访客评论。
- `npm run check` 与 `npm run build` 通过；仅保留已知 Vite 大包提示和 Node 22 `node:sqlite` ExperimentalWarning。
- 浏览器从真实 `.blend` 创建项目，设置 7 天、密码和可评论分享；隔离会话输入密码后在“展示底板”创建“请确认底板边缘倒角”，上传者刷新后可见并可解决。
- 上传者与隔离访客浏览器控制台均为 0 error、0 warning。
- 旧 token `350ba9d3770b4187aff225f2b4c26be3` 继续返回 200；公开 DTO 无 `projectId`，`source.blend` 与数据库文件路由返回 404。

## Commits

- `ee9ecdc` SQLite repository and legacy migration
- `3b3c2a3` local API state moved to SQLite
- `766b887` owner and share access enforcement
- `e4bf8b5` protected configurable sharing flow

## Next

Phase 4 先抽象基础设施接口，再以 Workers + D1 + R2 替换本地实现；Viewer 与审稿业务合同保持不变。
