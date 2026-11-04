# BlendProof 协作约定

## 稳定产品边界

- 一个 Web 同时承担上传工作台和 `/s/<token>` 分享读取，必须复用同一 Viewer。
- `.blend` 只进入本机 bridge；Worker/R2 永远不得接收原始工程。云端仅允许 `model.glb`、裁剪后的 `manifest.json` 和可选 `thumbnail.webp`。
- 空工作区默认加载 `public/default-monkey.glb`；该演示模型是平台管理员维护的永久只读示例，固定入口 `/s/suzanne`、公开演示口令 `tycon`，不计入用户配额或 48 小时清理。空工作区未绑定项目时不可产生无归属批注；在公开入口 `/s/suzanne` 处访客经口令解锁后可添加线上审稿批注，批注持久化存入 D1 且豁免清理。不得把其源 `.blend` 复制进 `public` 或构建产物。
- Viewer 操作以 Blender 为基线：中键旋转、Shift+中键平移、滚轮缩放、空白取消选择、框选、`/` 独显、文件相机和 Blender 式显示模式。
- 项目工作台 `/dev/` 的欢迎页维持 Blender Welcome 风格的单启动面板与 Tab，不把功能重新拆成互相重复的页面或多卡片 Dashboard。

## 账号与权限

- D1 角色只有 `admin`、`user`；审稿权限来自分享的 `read/comment` 设置，不增加静态 reviewer 角色。
- 在用户明确需要正式签核前，不引入批准/驳回或多级审批状态机；继续使用批注及 open/resolved 状态完成轻量审稿。
- 提供公共体验账号 `guest@blendproof.itycon.cn`（口令 `tycon`），支持游客一键登录测试云端功能；Worker 自动在 D1 初始化普通用户记录并颁发安全会话，免邀请码。
- 未登录用户触发发布云端或创建分享时，系统进行拦截并自动引导至启动页登录 Tab；创作者本地转换与本地批注仍通过 `ownerCapability` 正常进行，不受登录限制。
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

## 入口与发布流程

- `/` 是落地页；Worker 将根请求提供为规范的 `/landing/` 落地页壳。
- `/landing/` 是规范静态落地页入口；`/landing` 必须返回 `308` 到 `/landing/` 并保留查询参数。
- `/dev/` 是项目工作台；`/dev` 也进入项目工作台。`/s/<token>` 是分享页，并复用同一个 Viewer。
- 本地开发使用 `npm run dev`：Vite 固定 `localhost:5173`（端口占用即失败），Blender bridge 在 `8788`，本地 Worker 在 `8787`。Worker 的 `APP_ORIGIN` 同为 `http://localhost:5173`，不要混用 `127.0.0.1`。本地 `/` 是落地页，`/dev/` 是项目工作台。
- `npm run build` 构建工作台与落地页；`npm run build:app` 只构建工作台并保留 `dist/landing/`；`npm run build:landing` 只构建落地页。
- 落地页卡面必须先运行 `npm run optimize:landing-images`，使用 WebP、512/768w `srcset`、原生懒加载和异步解码；身份卡接近视口时才启动对应卡片图片解码，各卡独立就绪，Hero 3D 必须保持动态加载，不能阻塞首屏身份入口。

## 检查与发布门禁

变更后按需运行并在发布前完成完整门禁：

```sh
npm run verify:release
```

`verify:release` 是唯一规范的本地发布门禁入口：会优化并校验落地页图片、运行类型/架构/后端/发布脚本检查、构建本次产物，再运行 Worker 合同测试、落地页测试、Wrangler dry-run 和最终产物边界检查。`npm run deploy:production` 会先检查显式授权，再运行完整门禁，只有通过后才会调用 `wrangler deploy --keep-vars`：

```sh
BLENDPROOF_PRODUCTION_APPROVED=YES npm run deploy:production
```

Worker 路由测试依赖 `dist/`，完整流水线必须先构建本次产物再运行 `test:worker`，不能用旧构建证明新源码。落地页测试使用 `test:landing:built` 复用本次产物。门禁逐步输出耗时和失败退出码；修复中只重跑受影响检查，立即发布时直接调用部署脚本，不预先重复整套门禁。代理服务失败时主流程继续，不反复等待同一失败代理。

GitHub Actions 只允许手动触发，运行时必须显式选择 `YES`，并配置 Cloudflare token 和 account ID；Actions 只调用同一部署脚本，不重复跑两次门禁。GitHub environment 的 required reviewers 仍需在仓库设置中单独配置。部署脚本会从门禁子进程环境中移除 Cloudflare 凭据，门禁失败时不会调用 Wrangler。

从操作机触发 Actions 发布用 `npm run deploy:actions`（可传分支名，默认当前分支）：同样要求 `BLENDPROOF_PRODUCTION_APPROVED=YES`，先确认工作区干净且 `origin/<ref>` 与本地 HEAD 一致，再触发 `workflow_dispatch` 并跟踪该 run。run 停在 required reviewers 时退出并提示人工批准；CI 失败时传播非零退出码，不得宣称发布成功。CI 成功后脚本自动运行 `npm run verify:production -- --routes-only`。CI 在另一平台构建，字节可能与本机不同，因此跨机验收只校验路由、308、404 与健康字段并记录线上产物 hash，不做 hash 相等断言；需要逐字节相等时走本机 `deploy:production` 通道。两条通道都不得绕过门禁，也不要同时触发。

部署成功后脚本自动调用 `npm run verify:production`，只读验证入口与本次产物 hash，原始报告写入被忽略的 `output/releases/`。默认 `hash-compare` 模式需要本机 `dist`；`--routes-only` 供 CI/跨机发布后使用，改为从线上 `/landing/app.js` 发现 Hero chunk，只校验路由与健康字段并记录线上 hash。边缘传播不是瞬时的：验收支持 `--settle-ms`（探测前等待，`deploy-production.sh` 默认传 `8000`）与 `--backoff-ms`（尝试间隔，默认 `3000,8000,15000`，即最多 4 次尝试），报告记录 `settleMs`、`backoffMs`、`attemptsAllowed` 与每次尝试的状态和 hash。HTTP 验证失败表示已部署但验收未通过，不自动回滚；先看保留的每次尝试结果，区分瞬时传播失败、持续失败与真实故障，不得把上传成功写成验收通过，也不得把传播期假阴性写成发布失败。自托管可设置非秘密 `BLENDPROOF_PRODUCTION_ORIGIN`，独立本地验证用 `npm run verify:production -- --origin http://127.0.0.1:8800`。

不得用直接的 `npx wrangler deploy` 绕过发布门禁。真实 Cloudflare 资源、远程 D1 migration、DNS、Secret 和生产数据变更仍需用户明确授权；本地测试、浏览器实验室报告与生产 URL 验收必须分开记录。

## 交付边界

- 不提交 `.dev.vars`、`storage/`、`output/`、`*.blend` 或本地浏览器/性能报告。落地页 `landing/assets/optimized/` 是运行时发布资源，应保留并随构建校验。
- 推送前先审核 `git diff --check`、`git diff --stat` 和提交文件清单；不要 force push，不要擅自创建版本 tag。

发布失败经验与操作顺序见 `docs/PERFORMANCE_RELEASE_WORKFLOW.md`；通用规则在 SkillDo 管理的自有 `web-perf` Skill 中维护。

## 每次任务结束后的本地清理

- 在相关测试、浏览器/发布验收结束且证据已保存后，运行 `npm run clean:task` 预览，再执行 `npm run clean:task -- --apply`。这是任务收尾步骤，不是定时任务，不挂到 `postbuild` 或部署门禁中途。
- 固定候选仅为 `dist/`、`dist-worker/`、`tsconfig.tsbuildinfo`、`node_modules/.vite-temp/`。默认保留 `node_modules` 依赖与 `.vite` 热缓存、`.wrangler` 本地数据库、`storage`、`output` 验收证据、源码、锁文件和 `landing/assets/optimized` 发布素材。
- 检查 Git 跟踪、ignore、软链接和运行进程。构建/预览/Worker 等仍运行时跳过；源码 Vite dev 运行时仅保留其临时缓存，闲置构建产物可清理。检查权限不足则停止，不把无法检查当作空闲；不得为清理停止用户已有服务。
- macOS 下移动到 `~/.Trash/BlendProof-builds/<operation>/`，原路径清单保存在废纸篓及 `output/cleanup/`；不永久删除、不自动清空废纸篓，也不宣称已释放物理磁盘空间。其他平台仅支持预览。
- 需要继续部署或核对原构建 hash 时先保留 `dist`。清理后再运行 Worker 静态路由/落地页 built 测试必须重新构建；不能拿清理前的产物身份证明后来重建的产物。
