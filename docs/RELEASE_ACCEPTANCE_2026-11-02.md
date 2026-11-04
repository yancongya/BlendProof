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

### 本轮提交与交付

- 业务及流程提交：`ef09b17`（`perf: 完善落地页加载恢复与统一发布验收流程`），已推送至 `origin/codex/fix-guide-after-cover`，未合并 `main`、未创建版本 tag。
- 自有 Skill：`fa28c1b` 已推送 `yancongya/web-perf-skill` 的 `main`；远端 HEAD 与本地一致，SkillDo 中央 revision 同步完成。三个更新文档逐字节一致，15 个注册工具路径均为指向中央副本的有效软链接。
- 提交仅包含本任务 28 个明确文件；凭据、运行时存储、原始 `.blend`、浏览器/性能报告未加入提交。
- 本小节是业务推送完成后的文档记录，不改变已验收的运行时代码，因此不重复完整门禁。生产按用户选择暂缓，恢复前需要用户重新明确要求，不能因凭据修复而自动部署。

## 2026-11-04 生产发布（通道 B，已授权）

用户在明确答复“授权 b 发布。合并 main”后执行，属已授权生产变更；未执行远程 D1 migration，未修改 Secret 或 DNS。

### 合并与触发

- `origin/main` fast-forward `7643520` → `6ce8a53`（6 个提交，无合并提交、非 force push）；工作流为 `workflow_dispatch` only，推送 `main` 不会自动部署。
- 通道 B：`BLENDPROOF_PRODUCTION_APPROVED=YES npm run deploy:actions -- main`，run `41856628675`，ref `main`，commit `6ce8a53`。
- CI 内完整 11 步门禁通过后执行 `wrangler deploy --keep-vars`：`Uploaded blendproof (6.08 sec)`、`Deployed blendproof triggers (2.31 sec)`，自定义域 `blendproof.itycon.cn` 与 `schedule: 0 * * * *` 均生效。
- Cloudflare Version ID：`7209784a-debe-463e-bd4d-c603ac214b0d`（取代首轮 `fe79e2be-9874-4efe-8962-693d6e765ddc`）。

### CI 内验收 12/13 与假阴性定位

CI 的 `hash-compare` 验收报 12/13，`/s/suzanne` 两次尝试均失败，run 因此显示 failure。定位为边缘传播期假阴性，不是产品故障：

- 时间线：`Deployed triggers` 于 15:22:31，验收请求在 15:22:31–34 发出，仅约 3 秒；同批 `/landing/` 与 `/landing/app.js` 也各用了 2 次尝试。
- 交叉证明：约 76 秒后 `/s/suzanne` 返回 200、519 B，与**已通过**的 `/dev/` 的 sha256 完全相同（`895255c5a58a5042ed2498bed172442dd0f091b6e9d6609f3dbb85954569528f`），即它与 `dist/index.html` 同样逐字节一致。
- 结论：部署成功，CI 的失败信号来自验收时机，不代表线上故障；Actions 历史中这条红色 failure 应据此解读。

### 本机复验（发布后）

- `npm run verify:production -- --routes-only`：**13/13 PASS，全部 1 次尝试**；Hero chunk `hero3d-IvMFL4wx.js`（旧版为 `hero3d-C8J-kb0U.js`）。报告在被忽略的 `output/releases/http-1793805893414.json`。
- 新代码确认上线：`/landing/app.js` 由 67,858 B 变为 **72,837 B**；标记命中 `bp-retry` 0→1、`qs-mini-viewer-status` 0→1、`blendproof:language-change` 0→2。这些标记在部署前的线上 bundle 中均为 0。
- 仍未包含：生产环境的真实浏览器交互验收、真实 BFCache（`persisted=true`）、云端上传/双浏览器批注/过期清理 E2E、RUM 与完整 Lighthouse。本机浏览器验收针对同一源码的生产构建，不能直接冒充线上交互证据。

### 由本次失败固化的修复

- `scripts/verify-production.mjs` 新增 `--settle-ms`（探测前等待）与 `--backoff-ms`（尝试间隔，默认 `3000,8000,15000`，即最多 4 次尝试），无效参数直接拒绝；报告记录 `settleMs`、`backoffMs`、`attemptsAllowed` 与每次尝试结果。
- `scripts/deploy-production.sh` 部署后改为 `npm run verify:production -- --settle-ms 8000`。
- `tests/release-pipeline.test.mjs` 抽出 fixture 服务器助手，新增 3 项：传播期瞬时失败被有界退避恢复（断言 3 次尝试、`[false,false,true]`、`[503,503,200]`）、持续失败按上限耗尽并如实报 12/13、无效参数被拒绝。该套件由 22 项增至 **25 项，全部通过**。
- 上述改动只涉及发布/验收脚本、测试与文档，不进入 `dist`，因此不需要重新部署；CI 已对同一 commit `6ce8a53` 跑过完整门禁，本机不重复整套门禁。
- 附带发现：首次运行让 GitHub 自动创建 `production` environment，且 protection rules 为空（无 required reviewers），通道 B 的唯一闸门是 `approve_production` 输入。需要仓库级人工审批须由用户在仓库设置中配置。

## 2026-11-05 生产真实浏览器验收（第 1 项）

范围：`https://blendproof.itycon.cn`，独立 Playwright 会话 `blendproof-prod-20261105`，只读浏览与交互；未写入批注、未创建云端项目或分享。原始结果在 ignored `output/prod-audit-20261105/`。

### 结论：发现并修复 1 个真实缺陷

🔴 **身份门"跳过 ✕"按钮在所有视口都点不到**（已修复）

- 取证：`#tarot-skip` 矩形内 5 个采样点的 `elementFromPoint` 全部返回 `BUTTON#theme-toggle` 或 `DIV.top-actions`，无一命中跳过按钮；真实 `page.mouse.click` 后 **主题 dark→light，身份门毫无反应**（`identityChosen` 仍 `false`、`main` 高度仍 0）。390 与 1280 均复现。
- 根因：`.top-actions` 是 `position:fixed; top:14px; right:16px; z-index:10000`，高于 `.tarot-portal` 的 `z-index:9999`；`.tarot-skip` 为 `position:absolute; top:16px; right:20px; z-index:auto`，两者在右上角完全重叠。`skipBtn` 的点击处理器本身完好（写 `bp-identity-seen=1` 并置 `identityChosen=true`），属纯层叠遮挡。
- 修法：把跳过按钮移到门户 `padding-top:44px` 那条干净带的**左侧**（`left:20px`），而不是抬 z-index——抬层级只会让两个可用控件叠在同一批像素上。
- 复验：375/390/768/1280 四个视口，5 个采样点全部命中 `#tarot-skip`，层叠栈上方无其他元素，`overlappingInteractive` 为空；真实点击后 `identityChosen` false→true、正文展开（`main` 高度 0→11729/11522/9154/7800）、`bp-identity-seen=1`，主题保持 dark 未被误触，0 页面错误。
- 回归断言：`tests/landing-smoke.mjs` 新增“身份门跳过按钮避开固定顶栏占位，不被遮挡”，静态校验该规则用 `left:20px` 且不再用 `right:20px`。落地页测试 32/32 + smoke 全部通过。

### 生产验收通过项

| 范围 | 结果 |
| --- | --- |
| 身份门两条路径 | 首访（清 storage）显示可点 CTA；回访（`bp-identity-seen=1` + `bp-perspective`）直接进正文且 CTA 置为 disabled——均为设计行为 |
| 逐段全页滚动 | 390/1280 × creator/reviewer 四种组合：`scrollWidth == clientWidth`，无横向滚动；20 张图全部 complete、0 破图；0 控制台错误、0 HTTP ≥400 |
| 视角分区 | creator 隐藏 section 7（含 `.live`），reviewer 隐藏 section 3/4/6；`pageHeight` creator 11547 / reviewer 5547 |
| Hero 3D | 仅审稿视角初始化（`main.ts`: `root.dataset.view !== 'reviewer'` 直接 return）；移动端 390 审稿视角 **1 秒内**出现 356×278 canvas、3 个状态按钮可见 |
| Hero 三态互斥 | `solid/review/resolved` 依次点击，每次只有一个 `aria-pressed=true` |
| 身份重选按钮文案 | 随角色正确变化：creator `✦ 造物者`、reviewer `◈ 审视者`，`title=重新选择身份` |
| 快速入门 mini viewer | 审稿面板第 3 步加载出 286×186 canvas，`aria-busy=false`，无错误层 |
| **失败→重试闭环** | 首次加载前拦截 `default-monkey.glb`：出现 `data-kind=error`、`role=status` 文案“模型加载失败，请重试。”、可见“重试”按钮；解除拦截点重试后 canvas 恢复 286×186、错误层移除 |
| 实时平台状态 | reviewer 视角 `.live` 可见（613×322）→ `state=online`，`health="运行中Worker · D1 · R2"`（证明健康字段修复生效），`capacity="5.0 GB已用 0 B"`、`projects="10 条活跃分享"` 为真实生产数据 |
| 语言切换不重复请求 | 全程 `/api` 只有 2 次（health + stats 各一次）；中英切换后 note 与 health 文案同步变化，**0 次新增请求**，证明缓存重绘修复生效 |
| 中英/主题切换 | `h1` 与 `html[lang]` 同步切换并可还原；主题 dark↔light 且 `localStorage.bp-theme` 同步 |
| `/s/suzanne` | 口令门正常（`aria-label="访问密码"` + “打开审稿”），输入 `tycon` 解锁后 canvas 997×690，1 秒内加载完成、无“正在加载模型”残留，批注控件存在但未写入任何批注 |
| **`/dev/` 关闭封面即出指南** | 关闭前 `welcome=true/guide=false`；点击 `.start-launcher-close`（`aria-label="关闭欢迎页"`）后 **486 ms** 内 `welcome=false/guide=true`、标题“打开 Blender 文件”，**全程未操作 3D 视图**——用户最初报的问题在生产已修复 |

### 仍未达成的验收

- **真实 BFCache 未命中**：注入 `pageshow/pagehide` 记录后导航到 `/dev/` 再 `goBack()`，`window.__bp` 未存活、`persisted` 始终非 true，页面是整页重载。恢复分支仍只有 32 项模拟生命周期测试覆盖，不能声称真实 BFCache 已验证。
- 云端业务 E2E（真实 `.blend` 上传→云端发布、第二浏览器写入批注、分享过期与 cron 清理）本轮仍未执行，因为会写入生产数据。
- RUM、完整 Lighthouse、多地区网络仍未采集。

### 本轮测量失误（已更正，非产品问题）

- 把 `blob:https://…/<uuid>` 从左侧截断成 `/<uuid>`，误报为“站点根路径请求失败”。实际 27 个 blob 读取全部 200，仅 1 个 `blob:` script 被 abort（worker/解码器 teardown），`performance` resource timing 为空属正常，0 控制台错误。
- 用全局选择器 `#quickstart .quickstart__step` 取到 6 个步骤（两个 `data-perspective` 面板各 3 个），点了 creator 面板的第 3 步却期待 reviewer 面板里的 `#qs-mini-viewer`，误判为“mini viewer 不加载”。
- 滚动 `[data-stat="note"]` 去触发实时状态，但唯一的 `.live` 在 creator 视角高度为 0 的 section 7 内，IntersectionObserver 永不触发，误判为“实时状态卡住”。
- 语言切换“无重复请求”的基线索引取在轮询之前，导致 `noRefetch` 误报 false；实际按 `/api` 总调用数判定为 0 次新增。

## 2026-11-05 云端业务 E2E（第 3 项，生产，已授权）

用户授权后执行。使用体验账号与临时数据；**未向永久的 `/s/suzanne` 演示写入任何批注**。

| 环节 | 结果 |
| --- | --- |
| 体验账号登录 | `一键进入体验账号` → `/api/me` 返回 `guest@blendproof.itycon.cn` / 访客体验 / `role=user` |
| 浏览器内 `.blend` → GLB | **成功，无需本机 bridge**：`simple-review-scene.blend` 111.5 KB → GLB 42.3 KB；Outliner 5 个对象；属性面板 对象 5 / 相机 1 / 材质 4；原始 `.blend` 未离开本机 |
| 云端发布契约 | `POST /api/projects` → 项目 `22e69fecb218243e3ce7e0eaacbb85e2` → `POST upload-intents` → `PUT assets/manifest.json` → `PUT assets/model.glb` → `POST finalize` → `GET comments`，约 9 秒，0 控制台错误 |
| 创建分享 | `POST /api/projects/{id}/shares` → token `d539310e4b63bfe180cbc99e22c414b6`，权限“可批注”，到期 11/06 01:27（24h），无密码，提供“撤销分享” |
| 第二匿名会话读取 | `/api/me` 返回 `user:null`；`GET /api/shares/{token}/model.glb` 从 R2 取得模型；5 个对象齐全；权限显示“可批注” |
| 写入批注 | 关闭操作指南后进入批注模式（`.viewport.annotation-mode`），**首次左键点击模型表面即落点**；`textarea[aria-label="批注内容"]` 填入后点“保存批注” → `POST /api/shares/{token}/comments`；UI 显示“批注已保存。审稿批注 1 … 产品主体 · E2E验收-审稿人B” |
| 持久化（权威） | `GET /api/shares/{token}/comments` 返回完整记录：`id`、`objectName`、`position`、`normal`、`camera{projection,position,quaternion,target,fov}`、`body`、`authorName`、`authorType=guest`、`status=open`、`createdAt/updatedAt`、`replies`。重新进入后 UI 显示“审稿批注 1 … 10 分钟前” |

关键操作前提：**操作指南浮层会盖住视口**，未关闭时任何落点点击都到不了 canvas（此前两次“点不中模型”均为该原因，非产品缺陷）。

未完成：分享撤销、到期与 cron 真实回收、限流边界、作者侧回读该批注。测试数据（1 项目 + 1 分享 + 1 批注）留在生产，按 24h 分享 / 48h 项目上限自动清理。

### 🔴 审稿昵称刷新即丢失（已修复，尚未部署）

- 现象：接口已有批注记录，但刷新后回到“进入审稿 填写一个名称”，`localStorage` 无 `blendproof-guest-name:<token>`（实测仅有 `blendproof:has-seen-tour` 与 `bp-review-tokens`）。
- 根因：`guestName` 由 localStorage 初始化，而渲染门槛是 `!guestName.trim()`，`onChange={setGuestName}` 一打字就解除门槛；写 localStorage 只发生在 `onSubmit`。没点“继续审稿”的审稿人因此永不落盘，但其已发布批注仍带着该昵称显示给作者。
- 修复：改用 `onChange={updateGuestName}`，输入即写入、清空即 `removeItem`，并以 `try/catch` 容忍存储被禁用；`onSubmit` 写入 trim 后的值。新增静态回归断言，禁止退回 `onChange={setGuestName}`。
- 状态：`npm run check` 通过、`test:release-pipeline` 36/36 通过；**未部署，需在生产复验**。

## 2026-11-05 发布流程统一与门禁提速

- 新增 `npm run ship`：预检 → 推送 → 单通道部署 → 线上验收 → 收尾清理，一条命令完成。选项 `--channel ci|local`、`--ref`、`--push`、`--ff-main`、`--gate`、`--no-clean`、`--dry-run`。工作区脏直接拒绝且**不替你提交**；CI 通道不在本地重复门禁；部署失败传播退出码且**不清理**，避免丢失失败发布的产物身份。
- 图片编码改为内容寻址缓存（`scripts/image-cache.json`，随产物提交）：门禁 **176s → 42s**，图片步骤 **88–113s → 0.49s**（18 命中 / 0 编码）。
- 缓存失效已验证：篡改清单中源哈希 → 只重编码该图（17 命中）；删除一个产物 → 只重建该图且 `git status` 为空（字节与提交版一致，证明编码确定性）；`--force` / `BLENDPROOF_IMAGE_FORCE=1` 忽略缓存；清单缺失或损坏退化为全量编码而非失败。
- 清理段实测：`clean:task --apply` 移出 11,017,247 B（`dist` + `dist-worker` + `tsconfig.tsbuildinfo`），`.vite-temp` 因两个 Vite dev 服务在运行而跳过。
- 测量纪律：首次冷跑记为 376s 是因为同时开着 3 个 Playwright 浏览器（CPU 仅 53%）；关闭后同一次编码为 88s。**耗时对比必须在同等负载下取数**，否则会把 CPU 争用当成回归。
