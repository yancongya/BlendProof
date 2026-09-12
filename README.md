# BlendProof

Blender 风格的 Web 3D 审稿工具。原始 `.blend` 只在本机交给 Blender 转换；用户确认发布后，云端只接收经过裁剪的 GLB、manifest 和可选缩略图。

生产入口：[https://blendproof.itycon.cn](https://blendproof.itycon.cn)

## 当前闭环

1. 在网页中选择 `.blend`。
2. 本机 Blender 在后台导出 `model.glb` 和 `manifest.json`。
3. 浏览器加载 GLB，支持轨道查看与按对象开关可见性。
4. 同一 Web 的 `/s/<token>` 路由读取分享模型，不另建第二套 Viewer。
5. 本地开发使用 SQLite/文件系统，云端适配 Cloudflare Workers、D1 和私有 R2。

没有打开项目时，Viewer 默认展示内置的 Suzanne 猴头 GLB；它由开发测试文件离线导出，原始 `.blend` 不进入前端构建。该模型作为平台管理员维护的永久只读公开示例，可通过 `/s/suzanne` 访问，演示口令为 `tycon`；它不占用户配额、不进入 48 小时清理，也不创建无归属批注。此口令是公开演示提示，并非账号凭据或安全边界。

本地阶段最终验收范围与证据见 [`docs/LOCAL_MILESTONE_ACCEPTANCE.md`](docs/LOCAL_MILESTONE_ACCEPTANCE.md)。

## 产品与账号约定

- 首页是 Blender Welcome 风格的单一启动面板，通过“开始 / 最近项目 / 平台状态 / 账号”Tab 切换；不要重新拆成多张 Dashboard 卡片。
- 公益存储池业务上限为 5 GiB；推荐 24 小时内完成审稿，云端派生资产最长保留 48 小时并由定时任务自动清理。
- 账号角色只保留 `admin` 和 `user`。上传者、创建者和审稿者不设永久角色；审稿者能否评论由每条分享的“只读 / 可评论”权限决定。
- 已注册用户可以作为项目创建者发起审稿，也可以通过可评论分享参与审稿。当前不增加“批准/驳回/多级审批”工作流；批注及 open/resolved 状态是现阶段的轻量审稿闭环。
- 注册必须使用管理员创建的邀请码。普通用户只能查看自己的项目、有效分享和空间占用；管理员在同一账号页面额外看到平台控制与邀请码功能。
- 管理员可创建多个邀请码；每个邀请码独立设置有效期和最大使用次数，并可主动撤销。默认 UI 是 7 天、1 次使用，不是“每个管理员只能有一个邀请码”。
- 管理员可查看成员的空间/项目占用、停用普通成员，并在 5 GiB 与 48 小时硬上限内调低平台存储阈值和最长分享时间。
- 创建分享后显示发送方审稿凭证卡（分享码、权限、到期、密码状态与复制入口）；接收方在同一 Viewer 顶栏查看通行证卡（权限、来源与到期）。
- 启动页“平台状态”Tab 底部提供响应/Gzip、内容责任、联系方式、禁止内容提示，以及可点击打开的《隐私政策》和《服务条款》协议窗口；联系邮箱为 `admin@itycon.cn`。
- Viewer Outliner 支持对象名称/类型搜索、键盘选择与聚焦（小键盘 `.`），分享链接可将相机、显示模式、隐藏对象和选中对象写入 `#view=...` URL fragment，打开后恢复该视角。
- 本地 D1 可建立管理员、上传者、审稿者测试账号，但临时密码和 bootstrap token 只保存在忽略提交的 `.dev.vars` 或当前测试记录中，不写入仓库。

## 首位管理员

Cloudflare 部署时配置：

- 普通变量：`BOOTSTRAP_ADMIN_EMAIL`、`BOOTSTRAP_ADMIN_NAME`
- Cloudflare Secret：`BOOTSTRAP_ADMIN_TOKEN`，至少 32 字符

仅当 `users` 为空时，获授权操作员可以调用一次 `POST /api/auth/bootstrap-admin`，以 Bearer token 鉴权并在 JSON body 提交初始密码。创建成功后接口会永久关闭，随后必须删除 `BOOTSTRAP_ADMIN_TOKEN`。不要把管理员密码或 token 写进 `wrangler.jsonc`、Git、命令历史或部署日志。完整上线边界见 [Phase 4D 部署与恢复清单](docs/PHASE_4D_DEPLOYMENT_RECOVERY.md)。

## Cloudflare 上线前替换项

`wrangler.jsonc` 当前保留本地 Miniflare 名称与占位资源 ID，不能直接作为生产配置发布。正式上线前需：

1. 把 Worker、D1 与 R2 名称和 D1 `database_id` 替换为目标账号中的真实资源。
2. 把 `APP_ORIGIN` 改为最终 HTTPS Origin，并保持无尾斜杠的完全匹配。
3. 通过 Wrangler Secret 配置 `SHARE_ACCESS_SECRET`、`SESSION_SECRET` 与一次性的 `BOOTSTRAP_ADMIN_TOKEN`，不得写入配置文件。
4. 先执行 D1 migrations，再构建 Web；Worker Static Assets 会托管 `dist/`，`/api/*` 优先进入 Worker，`/s/*` 回退到 SPA。
5. 管理员初始化成功后立即删除 bootstrap secret，再完成双浏览器分享、密码、评论、撤销、到期与 cron 清理验收。

真实资源创建、Secret 写入、远程 migration 和首次生产发布仍需明确授权。

## 运行

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。本机 Blender bridge 使用 `8788`，本地 Cloudflare Worker 使用 `8787`。需要同时验证云端适配器时另开终端运行：

```bash
npm run worker:dev
```

默认优先使用 Steam Blender；如需指定其他版本：

```bash
BLENDER_BIN="/Applications/Blender.app/Contents/MacOS/Blender" npm run dev:server
```

## 本地数据

- 上传后的原始文件、GLB 和 manifest 位于 `storage/projects/<项目 ID>/`。
- Wrangler 的本地 D1/R2 状态位于 `.wrangler/`；这里只是开发数据，不能当生产备份。
- `test-assets/` 只用于开发验证，不参与项目运行时存储。

## 创建与验证简易测试场景

```bash
npm run create:test-blend
```

这会创建 `test-assets/simple-review-scene.blend`，其中包含两个网格、地面、灯光和相机，不依赖 Geometry Nodes。导入后点击“创建本地测试分享”，再在同一个站点打开生成的 `/s/<token>` 链接，即可验证客户侧的只读加载。

## 已验证的测试边界

`test-assets/zhuzhiliao_geometry_nodes_substep_core.blend` 可以成功完成导出及网页加载。
该文件的 Simulation Zone 在 Blender 后台模式不能求值，因而部分 Stub 网格会被原生 glTF 导出器省略。产品下一阶段应把这类告警提取为转换报告，并提供前台 Blender 导出或“已烘焙模型”作为替代路径。
