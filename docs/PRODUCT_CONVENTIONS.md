# BlendProof 产品与账号约定

本文承载原先写在根 `README.md` 中的产品形态、账号权限与存储策略约定。根 README 改为面向工程的结构化文档，产品口径以本文为准。

## 首页与界面形态

- 首页是 Blender Welcome 风格的单一启动面板，通过「开始 / 最近项目 / 平台状态 / 账号」Tab 切换；不要重新拆成多张 Dashboard 卡片。
- 根页每次加载默认打开 Blender 风格欢迎封面；封面为项目原创资产（`public/blendproof-splash-v1.png`）。
- 平台状态实时显示 D1 持久化的运行时长、累计处理文件/派生资产、处理字节和已清理资产/字节。
- 启动页「平台状态」Tab 底部提供响应/Gzip、内容责任、联系方式、禁止内容提示，以及可点击打开的《隐私政策》和《服务条款》协议窗口；联系邮箱为 `admin@itycon.cn`。

## Viewer 与分享

- Viewer 操作以 Blender 为基线：中键旋转、Shift+中键平移、滚轮缩放、空白取消选择、框选、`/` 独显、文件相机和 Blender 式显示模式。
- Viewer Outliner 支持对象名称/类型搜索、键盘选择与聚焦（小键盘 `.`）。
- 分享链接可将相机、显示模式、隐藏对象和选中对象写入 `#view=...` URL fragment，打开后恢复该视角。
- 创建分享后显示发送方审稿凭证卡（分享码、权限、到期、密码状态与复制入口）；接收方在同一 Viewer 顶栏查看通行证卡（权限、来源与到期）。

## 账号与角色

- 账号角色只保留 `admin` 和 `user`。上传者、创建者和审稿者不设永久角色；审稿者能否评论由每条分享的「只读 / 可评论」权限决定。
- 接入 Universal 后，公开统计中的用户数仍表示已经在 BlendProof 建立业务主体的产品用户，不表示 Universal 全平台账号总数，也不表示仅获得资格但从未进入 BlendProof 的人数。
- Cloudflare R2 容量阈值、`storage_pool`、上传预留、分享期限和清理策略继续由 BlendProof 管理；统一身份接入不得绕过或迁移这些业务约束。
- Universal 登录采用服务端 BFF：浏览器不保存 OIDC token；refresh token 以服务端 AES-GCM 密文保存，并按 5 分钟窗口轮换、复查产品资格。
- Universal 明确返回无效令牌、撤销资格或身份不匹配时立即撤销 BlendProof 会话。仅网络异常、限流或 `5xx` 可使用最近一次成功校验结果宽限最多 30 分钟；宽限期间一律降为普通用户，不保留产品管理员权限，超过宽限后拒绝访问但不销毁可恢复会话。
- Worker 间 OIDC token、JWKS、`/v1/me` 与 revoke 请求走 `UNIVERSAL_OIDC_SERVICE` Service Binding；公开 issuer 与浏览器授权地址仍为 `https://adobesync.itycon.cn`。
- `UNIVERSAL_AUTH_MODE=required` 是当前生产状态：注册、登录、重置密码和账号管理均由 Universal 接管。若需紧急回退，可暂时改回 `optional` 并重新部署；回退仅恢复旧登录入口，不移除既有 Universal 身份绑定。
- 已注册用户可以作为项目创建者发起审稿，也可以通过可评论分享参与审稿。当前不增加「批准/驳回/多级审批」工作流；批注及 open/resolved 状态是现阶段的轻量审稿闭环。
- 生产账号注册与产品资格由 Universal 管理；BlendProof 原邀请码注册接口仅作为 `off` 模式的自托管兼容实现，在当前 `required` 模式不可用。
- 管理员可查看成员的空间/项目占用、停用普通成员，并在 5 GiB 与 48 小时硬上限内调低平台存储阈值和最长分享时间。
- 「删除成员」采用停用账号和撤销会话，不物理删除项目、评论或审计关系；禁止管理员停用自己。

## 存储池与保留策略

- 公益存储池业务上限为 5 GiB；推荐 24 小时内完成审稿，云端派生资产最长保留 48 小时并由定时任务自动清理。
- 每个小时 cron 通过与厂商无关的精确对象 key 账本重试清理；D1 作为原子配额账本（上传先预留、finalize 结算、失败/过期释放）。官方部署使用 R2，自托管存储边界与 S3 兼容配置见 [`SELF_HOSTED_STORAGE.md`](SELF_HOSTED_STORAGE.md)。
- 云端项目最长保留 48 小时（即使未创建分享），分享默认 24 小时。
- **本地不做自动清理。** 清理只针对 CF 存储（`worker/cleanup.ts`）。本机 bridge 的 `storage/projects/` 与浏览器 IndexedDB 都只在用户主动删除项目时清除。

## 上传去向与账号门槛

- **未登录时上传的 .blend 不离开浏览器**：转换产物只写 IndexedDB（`transport: "browser"`），作为测试预览，可完整走通预览、批注、分享与访客查看；这些数据不占配额、不进云端。
- **上传到云端的前提是已登录账号**。浏览器转换不支持该文件时，未登录状态**不会**回退到本机 Blender 或云端 —— 那等于在用户不知情的情况下把原件送出去，前端会直接提示需要登录。
- 登录后可以「发布云端」，把浏览器本地的模型与批注迁移上去（`publishCloud`），此时才产生配额占用与 48 小时保留期。
- **永久有效的分享链接只针对内置 Suzanne 演示模型**（见下节）。用户上传的模型一律带有效期，默认 24 小时、上限 48 小时，本地与云端由同一套规则强制：`src/shared/share-policy.ts`、`server/share-policy.ts`、`worker/shares.ts`。

## 首位管理员

Cloudflare 部署时配置：

- 普通变量：`BOOTSTRAP_ADMIN_EMAIL`、`BOOTSTRAP_ADMIN_NAME`
- Cloudflare Secret：`BOOTSTRAP_ADMIN_TOKEN`，至少 32 字符

仅当 `users` 为空时，获授权操作员可以调用一次 `POST /api/auth/bootstrap-admin`，以 Bearer token 鉴权并在 JSON body 提交初始密码。创建成功后接口会永久关闭，随后必须删除 `BOOTSTRAP_ADMIN_TOKEN`。

不得提供「首位注册自动升管理员」。不要把管理员密码或 token 写进 `wrangler.jsonc`、Git、命令历史或部署日志。

## 本地测试数据

- 本地 D1 可建立管理员、上传者、审稿者测试账号，但临时密码和 bootstrap token 只保存在忽略提交的 `.dev.vars` 或当前测试记录中，不写入仓库。
- 上传后的原始文件、GLB 和 manifest 位于 `storage/projects/<项目 ID>/`。
- Wrangler 的本地 D1/R2 状态位于 `.wrangler/`；这里只是开发数据，不能当生产备份。
- `test-assets/` 只用于开发验证，不参与项目运行时存储。

## 演示模型与体验账号

没有打开项目时，Viewer 默认展示内置的 Suzanne 猴头 GLB（`public/default-monkey.glb`，69,708 字节）；它由开发测试文件离线导出，原始 `.blend` 不进入前端构建。

该模型作为平台管理员维护的永久只读公开示例，可通过 `/s/suzanne` 访问，演示口令为 `tycon`。它不占用户配额、不进入 48 小时清理。在 `/s/suzanne` 入口处访客经口令解锁后可添加线上审稿批注，批注持久化存储于 D1 中并跨会话可见。此口令是公开演示提示，并非账号凭据或安全边界。

同时平台提供通用访客体验账号（邮箱 `guest@blendproof.itycon.cn` / 口令 `tycon`），在欢迎页“账号”Tab 提供一键填入并登录按钮。Worker 自动处理体验账号的会话自举，方便未持有管理员邀请码的访客快速测试云端工作流。

## 部署注意事项

`wrangler.jsonc` 现已保存真实的 D1 `database_id`、R2 bucket 与自定义域配置，可直接作为生产配置使用。上线前的授权闸门、Secret 写入、migration 顺序、双浏览器验收与回滚清单见 [`PHASE_4D_DEPLOYMENT_RECOVERY.md`](PHASE_4D_DEPLOYMENT_RECOVERY.md)。

真实资源创建、Secret 写入、远程 migration 和首次生产发布仍需明确授权。
