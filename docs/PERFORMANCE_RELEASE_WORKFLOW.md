# 性能与发布工作流

## 一条命令发布

发布只用 `npm run ship`，它串起：预检 → 推送 → 部署 → 线上验收 → 收尾清理。

```sh
BLENDPROOF_PRODUCTION_APPROVED=YES npm run ship -- --channel ci --ref main --push --ff-main
npm run ship -- --dry-run            # 只打印计划，不需要授权，无副作用
```

| 选项 | 作用 |
| --- | --- |
| `--channel ci\|local` | `ci`（默认）触发 Actions，由 CI 跑门禁并部署；`local` 本机跑门禁后 wrangler 部署，可做逐字节 hash 验收 |
| `--ref NAME` | 发布 ref，默认当前分支 |
| `--push` | 本地领先远端时推送该 ref；默认拒绝并提示，不擅自推送 |
| `--ff-main` | 同时把 `main` 快进到该 ref（非快进由 git 拒绝，绝不强推） |
| `--gate` | 发布前额外在本地跑一次完整门禁 |
| `--no-clean` | 跳过收尾清理 |
| `--dry-run` | 只打印计划 |

规则：

- 工作区必须干净；`ship` 不会替你提交，脏树直接退出并打印 `git status`。
- **不重复门禁**：CI 通道的 job 内部已跑 11 步门禁，`ship` 不再本地跑一遍；需要本地门禁时用 `--gate` 或 `--channel local`。
- 一次发布只走一条通道；通道选择、授权、ref 同步检查都在这一处完成。
- 部署失败直接传播退出码，并且**不执行清理**，避免把失败发布对应的产物身份清掉。
- 清理失败不掩盖发布结果，但会以非零退出并提示手动运行 `clean:task`。
- 只想本地全量检查而不发布：`npm run verify:release`。

## 标准入口

- `npm run dev`：一个 Vite、bridge 和本地 Worker。使用 `localhost:5173`，`/` 为落地页，`/dev/` 为工作台；固定端口，Origin 必须一致。
- 修改中先做相关类型、单元或浏览器检查。需要发布时选择下面两条通道之一，一次发布只用一条。
- 两条通道都要求 `BLENDPROOF_PRODUCTION_APPROVED=YES`，都不绕过门禁，也不重复跑门禁。
- 完整构建先于依赖 `dist/` 的测试；落地页使用 `test:landing:built` 检查本次产物，避免内部再次 build。需要独立重建落地页时才运行 `test:landing`。
- `verify:production` 做只读 GET，比对入口、308 查询参数、404、健康响应以及 HTML/JS/WebP/Hero chunk 的 SHA-256。每项最多两次请求，两次结果均保留；结果写入 `output/releases/`，不能据此宣称浏览器或业务 E2E 通过。

## 两条发布通道

```sh
# 通道 A：本机构建并部署（可做逐字节 hash 相等验收）
BLENDPROOF_PRODUCTION_APPROVED=YES npm run deploy:production

# 通道 B：CI 构建并部署（本机凭据不可用或需要 CI 审计记录时）
BLENDPROOF_PRODUCTION_APPROVED=YES npm run deploy:actions [分支名]
```

| 通道 | 构建位置 | 顺序 | 验收强度 | 适用 |
| --- | --- | --- | --- | --- |
| `deploy:production` | 本机 | 授权检查 → 11 步门禁（子进程无凭据）→ `wrangler deploy --keep-vars` → `verify:production` | `hash-compare`：线上响应与本机 `dist` 逐字节相等 | 本机 Cloudflare 凭据可用，且需要最强产物身份证明 |
| `deploy:actions` | GitHub Actions（ubuntu） | 授权检查 → 工作区干净且 `origin/<ref>` == 本地 HEAD → `workflow_dispatch` → 跟踪 run → `verify:production -- --routes-only` | `routes-only`：路由/308/404/健康字段 + 记录线上 hash，不断言相等 | 本机凭据受限，或要求发布在 CI 留审计记录 |

- 通道 B 不重跑门禁：CI job 内的 `deploy:production` 已经跑过一次完整门禁，本机再跑等于同一版本两次门禁。
- 跨平台构建字节可能不同，所以通道 B 不能声称 hash 相等；需要该证明就改用通道 A，或下载线上产物与 CI 归档产物比对。
- 通道 B 的 run 停在 required reviewers 时退出 3 并提示人工批准，不无限等待；CI 失败退出 4 并附失败日志尾部，不得写成发布成功。
- 通道 B 需要 `gh` 已认证、仓库级或 `production` environment 级配置 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`。YAML 不配置审批规则；required reviewers 只能在仓库设置里加。
- 发布前必须确认远端 ref 与本地 HEAD 一致：CI 只构建已推送的提交，本地未推送的修复不会上线。
- 通道 B 可以用 `approve_production=NO` 安全预演：`gh workflow run deploy.yml --ref <branch> -f approve_production=NO`。工作流顺序是 checkout → setup-node → `npm ci` → 审批检查，所以 NO 预演会真实验证触发权限与 CI 依赖安装，然后在调用 Wrangler 之前退出 1，不接触任何 Cloudflare 资源。该 run 在 Actions 历史中显示为红色 failure，属预期，不能记作发布失败。首次运行会让 GitHub 自动创建 `production` environment。
- `production` environment 被自动创建时不带任何 protection rules，因此通道 B 的唯一闸门是 `approve_production` 输入；需要仓库级人工审批必须由用户在仓库设置中配置 required reviewers，工作流 YAML 不会代为配置。
- 本机 npm 可能比 CI 新（例如本机 11.19 有 install-scripts 门禁提示，CI Node 22 自带 npm 10.x 没有）。这类差异只影响本机 dry-run 输出，判断 CI 行为要看真实 run 日志，不要把本机警告当成 CI 失败。

## 落地页图片编码缓存

- 门禁第 1 步曾是 88–113s 的全量 WebP 重编码，占 176s 门禁的 **64%**；而 35 个产物与清单都已提交，重编码结果逐字节相同（实测 `git status` 为空）。
- `scripts/image-cache.json` 记录 `paramsHash`（sharp 版本、宽度、质量、alphaQuality、effort）与每张图的 `sourceSha256` 及各产物 `sha256`。**三者全等才跳过编码**；任一不符只重编码该图。
- 实测：冷缓存 88s → 热缓存 **0.49s**（18 命中 / 0 编码）；篡改清单里的源哈希只重编码该图（17 命中）；删除一个产物只重建该图且字节与提交版一致。
- CI 同样受益（清单已提交）：门禁图片步骤 **0s（18 命中 / 0 编码）**，11 步合计 **43s**，整个 Actions run **96s**（此前约 5 分钟）；`npm run ship` 端到端约 **111s**。
- `--force` 或 `BLENDPROOF_IMAGE_FORCE=1` 忽略缓存。清单缺失或损坏自动退化为全量编码，**不会让门禁失败**。
- 清单必须随产物一起提交，否则 CI 每次全新 checkout 仍要全量重编码。
- 质量、尺寸、alpha 逐像素校验与体积预算只在真正编码时执行；命中缓存意味着产物字节未变，这些校验结论仍然成立。预算检查每次运行都做。

## 本次失败转化为规则

| 失败 | 规范与修复 |
| --- | --- |
| Actions、部署脚本、落地页测试重复构建/检查 | 单一门禁，复用本次产物；每一步报告耗时和失败退出码。 |
| 图片编码串行耗时长，全部结束前没有进度 | 最多三项并行，每张输出开始和完成耗时；保持质量、尺寸、alpha 与预算校验，并比较优化前后产物 SHA-256。 |
| 门禁先测 Worker，误读旧 `dist` | 先完整 build，再运行 Worker/落地页合同测试。 |
| 发布 shell 的 `YES` 污染拒绝授权测试 | 每个用例固定自己的授权和凭据环境，部署命令使用 fake；用外层带 `YES` 的测试验证隔离。 |
| `localhost` 文档与 `127.0.0.1` Worker Origin 不一致 | 固定标准 Origin，并在端口占用时失败，防止自动换端口或提交请求被拒绝。 |
| 代理服务 503/会话失效，重复等待 | 对同一临时故障最多重试一次；主流程接管。先检查原 session/PID 与日志，确认结束后才重启。 |
| 补丁与 `git add/commit/push` 串在同一条命令且缺少 `set -e`，补丁断言失败后提交仍执行，把共享仓库中他人未提交的改动扫入提交并挂上错误信息 | 编辑与提交分步；编辑前先 `git status` 确认工作区状态；只暂存显式路径；提交信息只描述本次真正写入的内容。发现错误归属时不改写已发布历史、不 force push，用后续提交如实更正并说明原提交实际包含什么。 |
| 粗粒度 `manualChunks` 让入口出现 `import "./vendor-three-*.js"`，路由懒加载被抵消 | 分包方案必须看**入口 chunk 的真实 import 语句**与 `index.html` 的 modulepreload 列表，而不是构建输出的文件清单；并做对照实验（只路由分包 vs 路由+vendor 分包）。若共享 vendor 变成动态导入，会先下载解析入口再发第二次请求形成瀑布，TTI 反而更差——两条路由都需要的库（如 three）适合作为入口静态依赖并 preload。分包生效要在**网络层**证明：记录每条路由实际请求到的 chunk，确认互不拖载。 |
| 依赖越积越多，`npm ci` 与 `node_modules` 变慢变大 | 定期全仓库扫描 `dependencies` 引用（含 `worker/`、`server/`、`landing/`，不只看 `src/`），移除零引用项，并用回归断言阻止再次引入。 |
| 部署完成后数秒即做 HTTP 验收，边缘尚未传播，健康发布被判失败（实测 `/s/suzanne` 假阴性） | 验收先 `--settle-ms` 再按 `--backoff-ms` 有界退避重试，保留每次尝试的状态与 hash；结论区分“瞬时传播失败”“持续失败”“上传成功但验收未通过”，互不冒充。可用同批已通过的同源路由做交叉证明（例如 `/s/<token>` 与 `/dev/` 返回同一 `index.html`，比对 sha256）。 |
| 浏览器默认会话与其他项目混用 | 独立命名会话，所有命令带同一名字；导航后重新 snapshot，结束只关闭自己的会话。 |
| 只扫描角色选择器便宣称整页验收 | 逐段滚动并实际点击；分别覆盖创作者/审稿人、375/390px/桌面、语言/主题、错误/重试与欢迎页关闭后的指南。 |
| 卡面超时后成功、首次交集前 BFCache 恢复遗漏 | 跟踪当前请求归属，迟到成功按合同恢复；恢复尚未开始观察的卡片，避免永久禁用。 |
| mini Viewer 超时已 dispose，调用方却保留成功缓存 | `ready=false` 清理调用方实例，显示可点击重试；覆盖 import、GLB 超时、迟到完成、切步、pagehide/pageshow。 |
| 实时状态读取旧健康字段；切换语言后仍留旧文案 | 对齐 Worker 的 `database.bound/objectStorage.bound`；复用已读取的数据重渲染语言，不重复网络请求。 |
| NAS 短暂不可达、Wrangler 缓存账户不属于当前 token | 通过 `bwvault` 读取托管凭据；恢复连接后继续；账户列表权限不足时用既有域名元数据定位，再核对真实 Worker/D1/R2 绑定，不能盲信登录缓存。 |

## 收口与证据

1. 记录源码 commit/dirty diff、锁文件和报告路径；并行代理不同时修改同一文件或 `dist/`。
2. 检查静态测试、浏览器交互和生产 HTTP 各自的结论。模拟 `pageshow` 只证明处理函数；真实 BFCache 必须有 `persisted=true`。
3. 完整门禁通过后只显式暂存本次文件。提交/推送当前分支，不 force push、不擅自打 tag、不混入用户修改。
4. 部署记录包括业务 commit、Cloudflare version、HTTP 报告、生产浏览器结果及未测项。门禁失败不能发布；上传成功但 HTTP 失败不能写成发布验收完成。
5. 将最终事实追加到 `RELEASE_ACCEPTANCE_2026-11-02.md`，同步 `.planning/STATE.md`。仅更新记录的后续文档提交不需要再次部署相同运行时产物。

通用经验维护在自有 `web-perf-skill` 仓库，由 SkillDo 更新中央副本；源码、中央内容及各工具软链接分别核验。原始浏览器/性能报告、`.blend`、运行时存储和凭据不提交。

## 任务收尾清理（每次执行）

顺序：完成所需测试和浏览器/发布验收 → 保存报告与构建身份 → 清理 → 更新并提交交付记录。本地任务无需为清理启动生产部署；仍要用原 `dist` 部署、排错或比对线上 hash 时延后清理。

```sh
npm run clean:task              # 只读预览
npm run clean:task -- --apply   # macOS：移入可恢复废纸篓
```

- 固定候选为 `dist/`、`dist-worker/`、`tsconfig.tsbuildinfo`、`node_modules/.vite-temp/`；不会递归寻找其他项目的构建目录。
- 保留约 604 MB 的本项目依赖（本次盘点值，不是固定预算），避免每次重新安装；不自动运行 `npm prune` 或删除所谓“未使用模块”。依赖移除必须另行核对源码、动态 import、构建和锁文件。
- `.vite` 热缓存、`.wrangler` 本地 D1、`storage`、`output` 证据、源码、锁文件、压缩后的发布图片都不在候选内。
- 对候选检查 Git 跟踪/ignore、软链接、进程和打开文件；移动前重新检查。运行中的 build、preview、Worker 或未知项目运行时会阻断；只有明确的源码 Vite dev 可与闲置 dist 清理共存，且其 `.vite-temp` 保留。无法读取进程不视为空闲，不为清理停止已有服务。
- 桌面 CUA/Xcode MCP 工具可能继承仓库 cwd，但不等于项目服务；只排除脚本明确识别、入口在仓库外的这两类工具，仍逐候选检查打开文件。不能泛化为忽略所有 Node/MCP 进程。
- 使用原生文件移动，遵循 `mac-dev-cleanup` 的 Trash-first 边界，不运行全盘清理。目标为 `~/.Trash/BlendProof-builds/<operation>/`；恢复清单保存在该目录的 `manifest.json` 及 `output/cleanup/`。恢复时先确认原路径不存在，再按清单移回，不能覆盖新构建。
- 仅移出工作目录，不自动清空废纸篓，不声称已释放物理磁盘。非 macOS 只支持预览；跨文件系统移动失败时不降级成复制后永久删除。
- 不挂到 `postbuild`、`verify:release` 或 `deploy:production` 中途。清理后独立跑 `test:worker`/`test:landing:built`/`verify:production` 前需重新构建，原验收记录只对应原产物。
- `test:release-pipeline` 同时验证清理白名单、dry-run、进程保护、受跟踪文件/软链接拒绝、重复执行和恢复清单；不要为清理再跑整套图片编码与业务 UI 验收。
