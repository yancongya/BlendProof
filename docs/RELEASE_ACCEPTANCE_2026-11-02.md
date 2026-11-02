# 2026-11-02 性能与发布验收

## 范围与证据边界

本次覆盖落地页图片传输、懒加载/失败恢复、工作台欢迎页关闭后的指南、根路由与 `/dev/`、项目文档及统一发布门禁。检查不代替完整云端上传、双浏览器批注、账号管理员操作或到期清理的业务 E2E。

## 已完成的首轮发布

- 分支：`codex/fix-guide-after-cover`（推送同名 `origin` 分支；不是已合并 `main`）。
- 首轮业务提交：`d64027f`。
- Cloudflare 首轮版本：`fe79e2be-9874-4efe-8962-693d6e765ddc`。
- 命令：`BLENDPROOF_PRODUCTION_APPROVED=YES npm run deploy:production`。
- 部署脚本先重新完成当时的 10 步门禁：47 个后端/Viewer 测试、58 个 Worker 测试、图片/落地页静态 smoke、完整构建、Worker dry-run 和产物边界检查。
- 未执行远程 D1 migration、修改 Secret 或变更 DNS。

### 首轮线上 HTTP 验收

| 检查 | 结果 |
|---|---|
| `/`、`/landing/` | 200，落地页 HTML，与本地发布产物逐字节相同 |
| `/landing?utm_source=release` | 308，Location 为 `/landing/?utm_source=release` |
| `/dev`、`/dev/`、`/s/suzanne` | 200，工作台 HTML 壳，与本地发布产物逐字节相同 |
| `/does-not-exist`、缺失落地页 WebP | 404，不伪装成项目页 |
| `/api/health`、`/api/public/stats` | 200，JSON |
| `/landing/app.js` | 200，`text/javascript`，67,858 B，与本地发布产物逐字节相同 |
| splash WebP | 200，`image/webp`，82,986 B，与本地发布产物逐字节相同 |
| Hero 3D chunk | 200，`text/javascript`，605,238 B，与本地发布产物逐字节相同 |

汇总 13/13。原始证据在被忽略的 `output/release-20261102/`。初次 `app.js` 请求发生超时，保留失败报告；同 URL 重试成功（12.09 秒）后另存最终报告，不覆盖初次失败证据。部署资产上传也发生过重试后成功，不能据此声称 CDN/用户链路耗时已经全部解决。

## 性能产物

- 17 个原始卡面约 17.57 MB。
- 512w WebP 合计 613,118 B，768w 合计 1,170,308 B；浏览器按 `sizes/srcset` 选择，不应把两套素材简单相加当成一次访问的传输体积。
- splash WebP：82,986 B；卡面 alpha 通道有静态逐像素校验。
- Hero 3D 按视角和视口动态加载，初始落地页入口约 68 KB，3D chunk 约 605 KB。
- 工作台主 JS 约 1.48 MB（gzip 434.73 KB），仍有进一步分包空间。以上为构建体积，不是用户耗时或 Core Web Vitals 达标证明。

## 最终审核与流水线修正

### Standards

独立审核发现：门禁先测后构建依赖旧 `dist/`、CI 未提供新增授权变量、组件样式继续扩张全局 overrides。对应修正为：先构建再测 Worker、显式 `production` 授权且缺凭据失败、样式迁至工作台旁；自托管静态路由配置同步正式版。增加 `test:release-pipeline` 防止回归，门禁增为 11 步。

### Spec

独立审核发现：慢图片超时后的迟到成功无法自动恢复、演示模型悬挂可能一直 loading、README 使用步骤仍将根路径当作工作台。对应修正已完成；最终本地门禁、浏览器交互及证据边界记录在下方 2026-11-03 小节。

## 首轮浏览器边界（历史记录）

本轮尝试内置浏览器时，工具明确返回 `Local browser use is disabled in Work settings`。该记录不能解释为页面错误，也不等于完成生产浏览器验收；此前本地双视口报告不能直接冒充生产交互/FCP/LCP/CLS 证明。项目隔离式 Playwright 审计的结果应单独记录，不读取或复用用户浏览器会话。

## 长期未包含的验收

- 管理员登录、本机 `.blend` 转换后真实云端发布。
- 第二浏览器的实际批注写入、分享过期与定时清理。
- GitHub `production` environment 的 required reviewers、Secrets 存在与否、以及真正的 Actions 运行：提交 YAML 不代表已配置或运行 CI。
- RUM、完整 Lighthouse 和不同地区网络验证。

## 2026-11-03 后续修复与本地验收

本节记录首轮发布之后的源码，不代表已更新生产。

- 两名独立代理完成 UI 与发布流程审核。修复快速入门 Viewer 超时后缓存无法恢复、首次图片交集前离开后 BFCache 观察不恢复；定向加载测试从 16 项扩充为 32 项，均通过。
- 统一开发 Origin 为 `localhost:5173`；端口占用直接失败。部署测试显式隔离继承的 `YES` 与凭据；CI、部署和测试内部不重复跑门禁或构建落地页。
- 新增 `verify:production`，在部署后自动验证 13 项入口、重定向、404、健康响应与关键产物 SHA-256；每项最多两次，原始结果保留在 ignored `output/releases/`。本地 Worker 的 13/13 验证通过；这不是线上验收。
- 首次完整 11 步门禁通过：47 后端/Viewer、58 Worker、5 发布流程、32 加载测试以及资源 smoke、构建、dry-run、产物边界。总计 213 秒，图片编码占 178 秒；随后改为三项并行，35 个输出 WebP SHA-256 全部保持一致。
- 最终源码的完整 11 步门禁再次通过（`output/release-20261103/release-gate-final.log`）：总计 176 秒，图片处理 113 秒；相比本机首轮分别减少 37 秒（约 17%）和 65 秒（约 37%）。这是本次两次运行的耗时比较，不是跨机器基准，也不是网页加载速度提升比例。最终仍为 47 后端/Viewer、58 Worker、5 发布流程、32 加载回归测试全部通过。

### 浏览器证据

使用独立 Playwright 会话 `blendproof-release-20261103`，URL 为本地 Worker `http://127.0.0.1:8800/`，对应生产构建而非 Vite 源码。

| 范围 | 结果 |
| --- | --- |
| 创作者和审稿人逐段全页，375/390px 与桌面 | 文档宽度等于视口，无可见破图 |
| 创作者搜索/隐藏对象、添加/解决演示批注、权限和有效期、转换演示、隐私/条款弹窗 | 实际点击及状态断言通过；没有向生产写入批注 |
| 审稿人无效分享输入、演示链接、接收模型与 Hero 动态加载 | 错误可见，正确输入恢复并载入模型 |
| 快速入门模型请求失败后重试 | 浏览器拦截一次 GLB 请求，显示失败与重试，解除拦截后恢复画布 |
| 中英/主题切换与实时状态 | 修复缺失文案和健康字段，统计复用已读取数据即时重绘，不重复请求 |
| `/dev/` 关闭欢迎封面 | 无需旋转模型，指南立即显示 |
| BFCache | 普通后退检查完成，本次浏览器未取得 `persisted=true`；仅处理函数及竞态合同有自动化覆盖 |

原始记录及截图在 ignored `output/release-20261103/`。早期脚本曾因错误定位器和测试服务退出失败，已修正；这些工具失败不计为产品回归。故意注入的 GLB 请求失败是错误恢复测试，不能混为正常访问请求失败。

### 生产与 Skill

本轮没有执行生产部署。托管 Worker token 虽为 active，但目标账户读取返回 `403 No access to the specified resource`。NAS 短暂连接超时已恢复；旧 Wrangler 账户缓存与域名元数据交叉核对后，也不能获得 Worker 访问。用户明确决定“暂时只完成本地验收和推送”，生产暂缓，不改 DNS、Secret 或远程 migration。

通用失败经验已写入自有 `web-perf-skill` 的 `SKILL.md` 和 reference，并推送到私有仓库 `yancongya/web-perf-skill`。中央副本通过 SkillDo 更新，来源登记为该 Git 仓库；不再依赖第三方原版更新路径。项目流程见 `PERFORMANCE_RELEASE_WORKFLOW.md`。
