# Phase 4D 部署与恢复清单

> 本文是操作清单，不是已执行记录。当前仓库的 `wrangler.jsonc` 仍指向本地占位资源（D1 `database_id: "local"`、R2 `blendproof-local`、`APP_ORIGIN=http://127.0.0.1:5173`）。在获得账户、目标资源、域名和生产数据的明确授权前，不得执行远程命令。

## 0. 授权闸门（必须由用户确认）

- [ ] 指定 Cloudflare 账户、Worker 名称、环境（production/staging）、D1 数据库、R2 bucket、部署域名，以及谁可以执行发布和回滚。
- [ ] 明确 Web 静态资源的托管方式和最终同源 URL。默认架构是网页与 Worker API 同源；若 API 跨域，必须先确定精确 allowlist Origin。
- [ ] 授权创建/修改 Worker、D1、R2、DNS/域名路由和生产数据；本清单不会代为执行这些动作。
- [ ] 确认保留期、上传大小/总量、分享有效期、评论权限和数据删除政策。
- [ ] 指定备份保留期、恢复目标（RPO/RTO）和上线窗口；生产回滚必须有值班联系人。

## 1. 发布前本地闸门（可本地完成）

- [ ] `npm ci`，然后运行 `npm run check`、`npm run check:worker`、`npm run test:backend`、`npm run test:worker`、`npm run build`。
- [ ] 运行 `npm run worker:dry-run`，检查输出包不包含 `.blend`、`.dev.vars`、本地数据库或 `storage/` 内容。
- [ ] 用本地 Wrangler/Miniflare 合同测试确认：原始 `.blend`/`multipart/form-data` 返回 415 且 D1/R2 零写入；派生资产仅允许 `model.glb`、裁剪后的 `manifest.json` 和可选 `thumbnail.webp`。
- [ ] 检查公开响应递归扫描，确认不出现 owner capability、token、密码 hash、`storage_namespace`、R2 `object_key` 或内部记录。
- [ ] 验证根页的本机转换桥仍是唯一 `.blend` 接收方；Worker 永不接收或保存 `.blend`。

## 2. 同源资源与配置

1. 为 staging/production 建立独立 Worker、D1 和 R2 名称；不要把本地 `database_id: "local"` 或本地 bucket 配置直接用于生产。
2. 将 `wrangler.jsonc` 的 `name`、D1 `database_name/database_id`、R2 `bucket_name`、`APP_ORIGIN` 改为目标环境值（建议使用 Wrangler 环境配置或受审查的独立配置文件）。
3. 网页 API 默认使用同源 `/api`；只有在确需独立 API 域名时才设置 `VITE_WORKER_API_ORIGIN`，并同步配置精确 CORS/Origin 校验。禁止 `*` 与公开 `r2.dev` 访问。
4. 发布前核对 `APP_ORIGIN` 与浏览器实际 Origin 完全一致（协议、主机、端口均不能漂移）。
5. 配置域名路由/静态托管，使 `/api/*` 到该 Worker，`/s/<token>` 和根页面到同一 Web；先在 staging 验证，再切生产流量。

## 3. D1/R2 初始化与 migrations

- [ ] 先在 staging 执行 migrations，并核对 `projects`、`upload_intents`、`project_assets`、`shares`、`comments`、`cleanup_jobs` 及索引/触发器。
- [ ] 生产执行前保存 D1 备份/导出，并记录 migration 版本；不得手工跳过或改写已应用 migration。
- [ ] 由获授权操作员按目标环境运行等价命令（占位示例，先用 `--help` 核对 Wrangler 版本和账号）：

  ```bash
  npx wrangler d1 migrations apply <PROD_D1_NAME> --remote
  npx wrangler d1 migrations list <PROD_D1_NAME> --remote
  ```

- [ ] R2 bucket 已创建且私有；Worker 绑定名保持 `ASSETS`。确认不开放 bucket listing、`r2.dev` 或客户端自提交 key。
- [ ] 先创建一个最小 staging 项目，确认 R2 object key 由服务端生成、至少含随机标识，D1 行与 R2 对象均可追踪。
- [ ] D1/R2 没有跨资源事务：测试 PUT 成功、D1 写入失败，及反向失败；确认 cleanup ledger 可重试，不误删 ready 资产。

## 4. Secrets 与配对

生产 Worker 必须配置至少 32 个字符、彼此独立的随机值：

- `UPLOAD_SIGNING_SECRET`：upload intent 签名。
- `SHARE_ACCESS_SECRET`：分享访问 cookie/HMAC。
- 可选 `SHARE_ACCESS_SECRET_PREVIOUS`：密钥轮换窗口内短暂保留旧值，不能与当前 upload secret 相同。

授权操作员使用 secret manager 或 `wrangler secret put <NAME>` 注入值；值不写入仓库、Wrangler 配置、日志、DTO、URL、R2 metadata 或聊天记录。轮换顺序为：先设置新 current，同时将旧值放入 previous；确认旧 cookie 的过渡期后删除 previous；记录时间、操作者和验证结果。

本机 bridge 的 `BLENDPROOF_PAIRING_CODE`/`VITE_LOCAL_BRIDGE_PAIRING_CODE` 只用于本机便利，不是云端 secret。生产配对码必须通过带外渠道交给可信上传者；桥仍使用一次性、短 TTL、绑定精确 Web Origin 的 nonce。不得把配对码放进公开前端 bundle、URL 或 Worker。

### 首位管理员种子化

邀请码注册刻意不提供“第一个用户自动成为管理员”的公开后门。部署时将 `BOOTSTRAP_ADMIN_EMAIL`、`BOOTSTRAP_ADMIN_NAME` 配置为普通 Worker 变量，将至少 32 字符的随机 `BOOTSTRAP_ADMIN_TOKEN` 通过 Cloudflare Secret 注入。获授权操作员仅在空数据库上调用一次 `POST /api/auth/bootstrap-admin`，使用 Bearer bootstrap token，并在 JSON body 提交经隐藏输入读取的初始密码。接口采用条件插入，只要 `users` 已有任何记录便永久返回 409；初始化成功并验证管理员能生成邀请码后，立即删除 bootstrap secret。明文密码、token 和邀请码不得出现在 shell 历史、仓库、部署日志或本文中。

## 5. CSP、来源与缓存

- [ ] 在 Web 静态响应设置严格 CSP，至少限制 `default-src 'self'`、`script-src 'self'`、`style-src 'self'`（按构建产物决定是否需要 nonce/hash）、`img-src 'self' blob: data:`、`connect-src 'self'`；生产不允许第三方脚本读取 owner 状态。
- [ ] 若本地导入页面仍需连接 loopback bridge，仅对本地开发构建允许 `http://127.0.0.1:* http://localhost:*` 的 `connect-src`；生产分享页不要放宽到 loopback。
- [ ] Worker mutation 校验精确 `Origin` 与 JSON Content-Type；跨域时只回显 allowlist Origin、启用 credentials 和 `Vary: Origin`，不使用通配符。
- [ ] 分享 status/manifest/model/comment 响应保持 `Cache-Control: private, no-store` 与 `X-Content-Type-Options: nosniff`；cookie 为 `Secure; HttpOnly; SameSite=Lax`、host-only、token 路径限定，并不超过分享剩余寿命。

## 6. 上线验收（staging 后 production）

- [ ] `GET /api/health` 只确认 Worker、D1、R2 绑定可用，不泄露资源 ID；检查 HTTP 状态和响应头。
- [ ] 双浏览器/无共享 cookie：A 本机 `.blend` 转换后只上传 GLB/manifest/thumbnail；B 使用分享 URL 读取 Viewer。任意非 loopback 请求均无 `.blend` 文件名、MIME、hash 或源字节标记。
- [ ] owner capability 只能操作自己的项目；随机 project/share/key 探测统一返回 404/拒绝，不能枚举 R2。
- [ ] 覆盖只读分享、可评论分享、密码错误/成功、过期（410）、撤销（立即失效）、旧 cookie 失效、评论创建/编辑/解决权限。
- [ ] finalize 前缺资产、错误 ETag/大小/Content-Type、manifest 诱饵字段、超限输入均被拒绝；ready 项目可稳定读取。
- [ ] 模拟上传中断、重复 intent/finalize、R2 暂时失败和定时清理；确认幂等、CAS、cleanup ledger 最终收敛。
- [ ] 验收控制台、Worker 错误日志、D1/R2 记录无未处理错误；记录请求 ID、版本、migration 版本和时间戳，但不记录 token/capability/secret/源文件名。
- [ ] 上线后再启用并验证上传大小/总量、未完成项目、密码尝试和访客评论速率限制，以及额度/错误告警。

## 7. 回滚与恢复

### Worker/Web 回滚

- [ ] 每次发布前记录当前 Worker 版本、静态 Web 构建 hash、配置 hash 和 migration 版本。
- [ ] 代码回滚优先恢复到上一个已验收 Worker/Web 版本；不要用回滚代码反向删除已应用的 D1 migration。
- [ ] 若新版本写入了旧版本不认识的数据，先暂停流量/写入并评估兼容性，再决定前向修复或数据恢复。

### D1/R2 恢复

- [ ] 定期导出/备份 D1，并按 RPO 保留；恢复演练必须在隔离 staging 数据库验证。Wrangler 的 export/restore 具体参数以当前版本 `--help` 和 Cloudflare 控制台为准，不在生产直接试命令。
- [ ] R2 备份需保留对象 key、大小、ETag、SHA-256、Content-Type 及对应 D1 行；恢复时先恢复 D1 staging/asset 状态，再逐对象校验并切换为 ready。
- [ ] 不可把“列举整个 R2 前缀”当作唯一恢复机制；系统设计依赖 D1 cleanup ledger 和精确 key。缺失对象的项目应保持不可访问/非 ready，不能静默展示损坏模型。
- [ ] 发现 secret 泄露时立即轮换对应 secret、撤销受影响分享、检查日志/审计记录；不要把泄露值写入 issue 或备份说明。

### 事故处置

1. 记录发现时间、影响范围、Worker/Web 版本和 D1 migration 版本。
2. 必要时暂停发布和 mutation 流量；保留审计日志，不删除证据。
3. 优先恢复可读性与访问隔离，再处理 orphan/cleanup backlog。
4. 恢复后用本节线上验收清单复测，并记录 RPO/RTO 实际值和后续修复项。

## 8. 当前未完成项与明确边界

- 真实 Cloudflare 资源、域名、生产 secret、额度观测、错误告警和线上双浏览器验收尚未执行；四类 D1 限流已通过本地合同测试，仍需线上复验。
- 现有本地 Wrangler/Miniflare 测试证明合同和失败路径，不等同于 Cloudflare 线上资源验收。
- 本文不执行部署、不创建/修改 Cloudflare 资源、不修改全局调度配置、不提交 git；所有带 `PROD` 的命令都要求用户先授权并由操作员复核目标账户与资源。
