# BlendProof Project State

Phase: 4 of 4（云端替换）
Plan: 04-01
Status: Follow-up locally verified; production update deferred by user
Last activity: 2026-11-03 - 新增每次任务收尾清理；约 10.5 MiB 闲置构建已移入可恢复废纸篓，保留现有开发服务；用户再次确认生产暂缓

Progress: ████▉ 99%

## Decisions

- 同一个 Web 复用上传与分享 Viewer。
- `.blend` 由本机 Blender 转换，Web 读取 GLB。
- Viewer 内核能力以成熟参考实现为基线，产品层保留 Blender 风格外壳。

## Current Risks

- `node:sqlite` 在本机 Node 22 可用但仍有 ExperimentalWarning，必须锁定运行时并保持 D1 适配边界。
- Worker 已完成项目、派生资产、分享访问、密码、撤销、评论及定时清理本地实现；基础资源与 HTTP 入口此前已上线；完整云端业务 E2E 仍待验收。
- 本机 bridge 使用精确 Origin/Referer 解析与短期、Origin-bound nonce；开发脚本中的固定配对码只用于本地便利，生产仍需带外配对入口。
- Web typed client 已接入云端 publish、精确 upload intent、清单去敏、创建分享与 `/s/:token?source=cloud` 读取；真实云端发布全链路与网络故障恢复仍待验收。
- D1 固定窗口限流已覆盖项目创建、上传 intent、密码尝试与访客评论；尚待真实边缘 IP/并发复验。
- D1 已作为 5 GiB 公益存储池的原子配额账本；上传先预留、finalize 结算、失败/过期释放，R2 指标仅用于未来对账。
- 云端项目最长保留 48 小时（即使未创建分享），分享默认 24 小时；每小时 cron 通过精确 R2 key 账本重试清理。
- 首页改为 Blender 风格单面板启动器，通过“开始 / 最近项目 / 平台状态 / 账号”Tab 复用上传、分享与状态能力；封面为项目原创资产。
- D1 已加入邀请码注册、PBKDF2 密码、哈希会话 token、个人空间统计和管理员邀请码接口；公开用户数按未停用注册账号统计。
- 首位管理员不能从公开注册流程自举，生产部署时必须由获授权操作员在 D1 中安全种子化；具体生产身份与恢复流程仍需上线前确认。
- 首位管理员支持部署变量邮箱/名称 + Secret token 的一次性空库 bootstrap；本地已建立管理员、上传者、审稿者三个临时账号验证角色界面，生产仍须删除 bootstrap secret 后才开放。
- Welcome 改为覆盖 Viewer 的可关闭模态层；管理员页已接成员用量/停用、邀请码列表/新增/撤销，以及 5 GiB/48h 硬上限内的平台阈值设置。
- 空工作区已使用用户提供的 Suzanne 工程离线导出的 68 KB GLB 作为默认模型；源 `.blend` 不进构建。注册用户继续通过可评论分享参与审稿，暂不扩张为正式审批状态机。
- Suzanne 同时作为管理员永久只读公开示例，固定入口 `/s/suzanne`、公开演示口令 `tycon`；静态派生资产不计入普通用户配额和 48 小时清理。
- 分享面板已形成发送方审稿凭证卡，分享 Viewer 使用同源接收方通行证卡；两端显示权限与到期，接收方另显示资产来源。匿名 `/api/me` 作为正常状态返回空身份，不再制造控制台 401 噪声。
- 平台状态 Tab 已加入响应/Gzip、内容责任、禁止色情/暴力/恐怖主义/违法侵权内容、`admin@itycon.cn` 联系方式及可点击打开的隐私政策/服务条款；协议明确原始 `.blend` 仅本机处理、派生资产最长 48 小时并自动清理。
- Viewer 已支持 Outliner 对象搜索、键盘聚焦/小键盘 `.`，以及分享 URL `#view=...` fragment 对相机、显示模式、隐藏/选中对象的恢复。
- 文件菜单已改为无裁切的左侧展开及“最近项目”悬停二级菜单；“对象模式”占位已替换为控制网格/轴线的叠加层开关，网格对比度增强。中文 multipart 文件名在 bridge 归一化为 UTF-8。
- 生产 Worker、D1、私有 R2、每小时 cron 与自定义域 `blendproof.itycon.cn` 已部署；8 个 migration、健康检查、5 GiB/48h 公开指标和 Suzanne 密码分享已线上验收。
- 生产首位管理员已创建并完成登录验证；账号凭据与 Worker 密钥不记录在仓库中，一次性 bootstrap Secret 已从 Worker 删除。
- 尚需在真实浏览器中完成管理员登录、本机 `.blend` 转换后发布、第二浏览器评论与过期清理的端到端验收。
- `0009_platform_lifetime_metrics.sql` 已上线；根页刷新默认打开欢迎封面，状态 Tab 每秒更新运行时长、每 30 秒同步容量与累计处理/清理文件和字节统计。
- 完成 `src/App.tsx` 模块化重构：将 2685 行单文件拆分为 `src/pages/`、`src/workspace/`、`src/start/`、`src/review/`、`src/components/` 及 `src/types.ts` / `src/utils.ts`，`App.tsx` 瘦身为轻量路由与 re-export 入口。
- 增加未登录用户操作拦截与引导：未登录时尝试发布云端或创建分享，提示友好警告并自动切换至欢迎页“账号”Tab。
- 官方托管使用 Orbit 品牌与独立账号页域名；`UNIVERSAL_*` 作为协议兼容名保留。社区自托管默认 `off` 模式，使用 BlendProof 内置账号和邀请码，不依赖 Orbit。
- 官方访客体验账号（`guest@blendproof.itycon.cn` / `tycon`）改为 `ENABLE_DEMO_ACCOUNT` 显式开关；自托管默认隐藏且 Worker 拒绝该凭据。
- 完善线上 Suzanne 猴头模型公开演示（`/s/suzanne`）的真实持久化审稿：Worker `shares.ts` 支持 `suzanne` 路由与 D1 项目/分享自动关联，访客添加的批注持久化存入 D1 数据库且永久豁免 48 小时清理；前端 `SharePage.tsx` 接入云端接口并提供离线兜底，启动页增加一键跳转公开演示。

- 落地页全息 3D 视差塔罗牌门面已上线：支持【I · 造物者】与【II · 审视者】双身份卡牌交互与 Atropos 多层视差；
- 落地页支持中英完整双语（i18n 无损实时切换）与亮色/暗色（Light/Dark）双主题自适应；
- 落地页支持点击卡牌的电影级居中景深冲刺破屏进场动效（Card-rush transition）并平滑衔接至专属视角；
- 修复客户视角批注闭环插画（`.loop-illo`）节点 2 坐标与节点 1 重叠压盖的 Bug，规整为左中右对称的三节点时序循环动画。

## Session Continuity

Last session: 2026-11-03
Stopped at: Local acceptance complete; ef09b17 pushed to origin/codex/fix-guide-after-cover and web-perf Skill fa28c1b pushed/synchronized. Production is deferred by user and must not resume automatically after a credential change.
Resume file: `.planning/phases/04-cloud/04-01-PLAN.md`

## 2026-11-02 落地页性能与发布收尾

- 业务提交：`d64027f`（`codex/fix-guide-after-cover`），已推送同名 `origin` 分支；不代表已合并默认分支。
- Cloudflare 版本：`fe79e2be-9874-4efe-8962-693d6e765ddc`；通过 `BLENDPROOF_PRODUCTION_APPROVED=YES npm run deploy:production` 部署。此次未执行远程 migration、Secret 或 DNS 变更。
- `verify:release` 完整 10 步通过（47 个后端/Viewer 测试、58 个 Worker 测试、落地页资源 smoke、完整构建及 dry-run/产物边界）；部署脚本再次运行同一门禁后发布。
- 线上 HTTP 验证 13/13：根路径和 `/landing/` 返回落地页；`/landing` 保留 query 返回 308；`/dev`、`/dev/`、`/s/suzanne` 返回工作台壳；未知路径和缺失 WebP 为 404；健康及公开指标为 200。HTML、落地页 JS、代表性 WebP 与动态 3D chunk 均和本地发布产物逐字节一致。
- 图片：17 个卡面源约 17.57 MB，512w WebP 合计 613,118 B，768w 合计 1,170,308 B；首屏 splash WebP 为 82,986 B。
- 内置浏览器被当前 Work 设置禁用，未绕过设置启动其他浏览器。因此本次新增的是生产 HTTP 证据，不是生产交互/FCP/LCP/CLS 验收；先前本地双视口报告不能代替生产浏览器证明。
- 观察到一次落地页 JS HTTP 超时；后续同 URL 请求为 200、67,858 B、12.09 秒并逐字节匹配。部署资产上传也曾重试后成功；不能据此宣称网络链路已不再慢。
- 原始 HTTP 检查与重试证据保留在被忽略的 `output/release-20261102/`；长期发布记录见 `docs/RELEASE_ACCEPTANCE_2026-11-02.md`。
- 未关闭的既有范围：完整云端发布/第二浏览器批注/过期清理 E2E；工作台主 JS 约 1.48 MB（gzip 434.73 KB）仍为后续分包优化项。

## 2026-11-03 收尾与暂缓发布

- 本轮修复：卡片独立加载、迟到成功/重试/BFCache 恢复，快速入门 Viewer 超时后的重试入口和调用方缓存清理，接收端错误提示，语言切换后的实时统计文案，健康接口字段对齐。
- 发布流程：统一 localhost 开发 Origin，单次 11 步门禁，先构建后测试；去掉落地页内部重复构建，每步输出耗时，图片最多三项并行。新增自动 `verify:production` HTTP/hash 验证；原始报告均保持 ignored。
- 本地浏览器覆盖创作者/审稿人完整页面、375/390px/桌面、主要演示及弹窗交互；关闭欢迎页后指南立即显示。32 个异步加载回归测试通过；真实 BFCache 本次未命中，模拟生命周期测试不等同浏览器命中证明。
- 自有 web-perf Skill 已更新失败经验并推送私有源仓库 `yancongya/web-perf-skill`；SkillDo 来源已登记为该 Git 仓库，中央内容和工具链接独立核验。
- 本轮没有生产部署。NAS 连接恢复后，托管 `cloudflare.itycon.workers-deploy` token 状态为 active，但目标账户 Worker 设置返回 403；用户明确选择“暂时只完成本地验收和推送”。恢复生产前需修复同一托管 alias 的账户权限，不在聊天/仓库传递 token。
- 首轮线上版本记录为 `fe79e2be-9874-4efe-8962-693d6e765ddc`，本轮未重新核验当前线上版本；不得将本轮本地证据归给该历史线上版本。最终完整门禁 176 秒通过（图片处理 113 秒），详情及提交记录见 `docs/RELEASE_ACCEPTANCE_2026-11-02.md`。
- 本轮业务与规范提交 `ef09b17` 已推送 `origin/codex/fix-guide-after-cover`；自有 Skill `fa28c1b` 已推送并同步 SkillDo，15 个注册工具软链接有效。后续仅追加交付记录，不改变运行时产物、不重复门禁；剩余生产任务按用户要求暂停。

## 2026-11-03 每次任务收尾清理

- 新增 `npm run clean:task`（默认只读），`-- --apply` 仅移动明确、未跟踪、ignored 且闲置的构建文件到 macOS 废纸篓。白名单与每次任务收尾顺序已写入 README、README.zh、AGENTS 及性能工作流；不挂到构建/部署中途。
- 本轮检查：`npm run check`、`npm run check:worker` 通过；发布流程与清理回归共 16 项通过（5 项既有发布合同 + 11 项清理保护）。没有改变 Web/Worker 运行时代码，不重复图片编码、业务 UI 或完整发布门禁；此前 176 秒门禁只归属此前版本。
- 已执行 dry-run 后 apply：移动 `dist`、`dist-worker`、`tsconfig.tsbuildinfo` 共 11,016,855 B（约 10.5 MiB）到可恢复废纸篓。操作 ID：`2026-11-03T12-18-41-973Z-0daecf0f`；本地恢复清单 `output/cleanup/<operation>.json` 保持 ignored。
- 两个已有 Vite 开发服务未停止，`.vite-temp` 因运行中而跳过；依赖、`.vite` 热缓存、本地数据库/存储、性能报告和压缩后的发布图片全部保留。移动到废纸篓不等于释放物理空间，不自动清空。
- 首次进程盘点因桌面工具继承项目 cwd 而保守跳过；随后明确识别仓库外 CUA/Xcode MCP 工具并保留逐候选打开文件检查，补充回归测试。生产是否恢复已再次询问，用户明确答复“仍暂缓生产，只完成本地清理和推送”。之后发布或使用 built 测试前需重新构建。
