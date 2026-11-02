# 性能与发布工作流

## 标准入口

- `npm run dev`：一个 Vite、bridge 和本地 Worker。使用 `localhost:5173`，`/` 为落地页，`/dev/` 为工作台；固定端口，Origin 必须一致。
- 修改中先做相关类型、单元或浏览器检查。需要发布时，直接执行已授权的 `BLENDPROOF_PRODUCTION_APPROVED=YES npm run deploy:production`。
- 部署脚本依次执行一次完整 11 步门禁、Wrangler 上传、`verify:production`。CI 只调用该入口；不要先完整预检一遍再立即部署。
- 完整构建先于依赖 `dist/` 的测试；落地页使用 `test:landing:built` 检查本次产物，避免内部再次 build。需要独立重建落地页时才运行 `test:landing`。
- `verify:production` 做只读 GET，比对入口、308 查询参数、404、健康响应以及 HTML/JS/WebP/Hero chunk 的 SHA-256。每项最多两次请求，两次结果均保留；结果写入 `output/releases/`，不能据此宣称浏览器或业务 E2E 通过。

## 本次失败转化为规则

| 失败 | 规范与修复 |
| --- | --- |
| Actions、部署脚本、落地页测试重复构建/检查 | 单一门禁，复用本次产物；每一步报告耗时和失败退出码。 |
| 图片编码串行耗时长，全部结束前没有进度 | 最多三项并行，每张输出开始和完成耗时；保持质量、尺寸、alpha 与预算校验，并比较优化前后产物 SHA-256。 |
| 门禁先测 Worker，误读旧 `dist` | 先完整 build，再运行 Worker/落地页合同测试。 |
| 发布 shell 的 `YES` 污染拒绝授权测试 | 每个用例固定自己的授权和凭据环境，部署命令使用 fake；用外层带 `YES` 的测试验证隔离。 |
| `localhost` 文档与 `127.0.0.1` Worker Origin 不一致 | 固定标准 Origin，并在端口占用时失败，防止自动换端口或提交请求被拒绝。 |
| 代理服务 503/会话失效，重复等待 | 对同一临时故障最多重试一次；主流程接管。先检查原 session/PID 与日志，确认结束后才重启。 |
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
