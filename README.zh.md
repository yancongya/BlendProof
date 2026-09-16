<a id="readme-top"></a>

<br />
<div align="center">
  <img src="public/blendproof-splash-v1.png" alt="BlendProof" width="640">
  <h3 align="center">BlendProof</h3>
  <p align="center">
    面向协作的 Blender 风格 3D 审稿台，本地转换后即可线上分享。
    <br />
    <a href="https://blendproof.itycon.cn"><strong>打开线上站点 »</strong></a>
    ·
    <a href="#使用方式">快速上手</a>
    ·
    <a href="docs/LOCAL_MILESTONE_ACCEPTANCE.md">验收记录</a>
  </p>
</div>

[English](README.md) · **简体中文**

> [!NOTE]
> Phase 4（云端替换）已完成并部署到 `blendproof.itycon.cn`。真实浏览器中的端到端验收——管理员登录、发布真实 `.blend`、跨浏览器评论与过期清理——仍待完成。详见 [`docs/PHASE_4D_DEPLOYMENT_RECOVERY.md`](docs/PHASE_4D_DEPLOYMENT_RECOVERY.md)。

<details>
  <summary>目录</summary>
  <ol>
    <li><a href="#项目简介">项目简介</a></li>
    <li><a href="#功能特性">功能特性</a></li>
    <li><a href="#技术架构">技术架构</a></li>
    <li><a href="#快速开始">快速开始</a>
      <ul>
        <li><a href="#环境要求">环境要求</a></li>
        <li><a href="#安装">安装</a></li>
      </ul>
    </li>
    <li><a href="#使用方式">使用方式</a></li>
    <li><a href="#开发指南">开发指南</a></li>
    <li><a href="#接口">接口</a></li>
    <li><a href="#部署">部署</a></li>
    <li><a href="#保留与配额">保留与配额</a></li>
    <li><a href="#已知限制">已知限制</a></li>
    <li><a href="#常见问题">常见问题</a></li>
    <li><a href="#参与贡献">参与贡献</a></li>
    <li><a href="#许可证">许可证</a></li>
  </ol>
</details>

## 项目简介

BlendProof 是一个专注于协作审稿的 Blender 风格 Web 3D 工作台。浏览器优先在本地解析受支持的静态 `.blend` 子集并生成 GLB；超出范围的文件自动回退到本机 Blender bridge。云端只接收派生的 `model.glb`、允许列表中的 `manifest.json` 和可选的 `thumbnail.webp`。

**为什么需要它：**

- **原始工程不进云端。** 浏览器模式在页面内读取，回退模式只发送到用户本机的 bridge；Worker 直接以 HTTP 415 拒收 `.blend`。
- **审稿者不必装 Blender。** 一条链接就能打开模型，并恢复发送方的相机、显示模式和隐藏对象。
- **没有基础设施账单。** Cloudflare Workers、D1 与私有 R2 支撑一个 5 GiB 公益池，48 小时自动清理。

上传工作台与 `/s/<token>` 分享路由是同一个应用、同一个 Viewer 组件，不存在需要同步的第二套前端。

产品形态与账号约定——首页布局、角色、邀请码与保留策略——汇总在 [`docs/PRODUCT_CONVENTIONS.md`](docs/PRODUCT_CONVENTIONS.md)。

体验改造与前端解耦方案（目标模块划分、依赖方向规则、文件行数预算）见 [`docs/UX_OVERHAUL_AND_DECOUPLING.md`](docs/UX_OVERHAUL_AND_DECOUPLING.md)。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 功能特性

- **Blender 式导航** —— 中键旋转、Shift+中键平移、滚轮缩放、框选、空白取消选择、`/` 独显、线框/灰模/材质模式，以及文件相机。
- **Outliner** —— 按名称或类型搜索对象，用键盘选择并聚焦（小键盘 `.`）。
- **审稿批注** —— 表面锚点批注、编号 pin、编辑/解决/重开，并在持久化状态上稳定重放相机。
- **受控分享** —— `/s/<token>` 支持只读或可评论权限、可选密码、到期与撤销；`#view=...` 恢复发送方的相机、显示模式、隐藏对象与选中项。
- **账号** —— 邀请码注册、`admin` / `user` 角色、个人空间统计。
- **管理后台** —— 成员用量与停用、邀请码创建与撤销，以及在 5 GiB / 48 小时上限内调整平台阈值。
- **批注通知** —— 项目作者每 15 秒检查新批注，右侧显示未读数量和站内提示，无需额外部署实时服务。
- **平台状态** —— 持久化的运行时长、累计处理文件与字节数、清理计数，在首页实时刷新。
- **访客快速审阅** —— 客户使用分享密码和审核名称即可进入，无需注册账号；批注只属于当前分享。
- **通用游客体验账号** —— 访客可通过欢迎页的一键填入按钮，使用 `guest@blendproof.itycon.cn`（口令 `tycon`）直接登录平台体验云端功能，无需专属邀请码。
- **封面视频** —— 欢迎卡片可以使用 `public/intro.mp4` 作为视频背景，并保留封面图作为海报、低动态模式和不支持视频浏览器的降级方案。
- **永久演示** —— `/s/suzanne` 提供公开示例模型，访问口令 `tycon`；访客可添加批注，不占配额，也不进入清理。

浏览器端 `.blend` 转换目前以实验适配器形式提供，面向静态 Mesh、基础材质、相机和场景信息；复杂文件仍使用本机 Blender bridge 作为兼容后备。

### 浏览器转换范围与局限

免安装路径目前支持静态 Mesh、对象名称与变换、Scene/Collection 信息、UV、基础 Principled 材质参数、文件相机，以及已评估的 Mirror/Array Modifier。转换时会同步 Blender 的 Z-up → glTF/Three.js Y-up 坐标基准，避免上传后的模型出现整体旋转偏差。Viewer 还提供“平滑/平直”着色切换；转换后会生成 GLB 和 manifest，并复用现有 Viewer 与线上发布流程。

它不是完整的 Blender 网页版。目前不保证动画、骨骼、物理、粒子、流体、布料、模拟、任意 Geometry Nodes、合成器/世界节点、插件数据、链接库和 Cycles/Eevee 像素级还原。旧版本或未测试的 Blender 文件可能自动回退到本机 bridge。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 技术架构

三层结构，信任边界划在 loopback bridge 上。

| 层 | 技术栈 | 位置 | 职责 |
|---|---|---|---|
| Web | React 19、`@react-three/fiber`、`@react-three/drei`、three.js、Vite、TypeScript | `src/` | 上传工作台、Blender 风格 Viewer、Outliner、批注、分享界面 |
| 本机 bridge | Express 5、`multer`、`node:sqlite` | `server/` | 在 loopback 接收 `.blend`、驱动 Blender 后台转换、导出 GLB 与 manifest、提供本地开发 API |
| 云端 | Cloudflare Workers、D1、私有 R2、每小时 cron | `worker/` | 登录、邀请码、上传意图、配额账本、分享、评论、定时清理 |

**发布链路：**

1. 浏览器把 `.blend` 交给 loopback 上的本机 bridge。
2. Blender 后台运行，把 `model.glb` 和 `manifest.json` 写入 `storage/projects/<项目 ID>/`。
3. Viewer 加载 GLB，上传者开始审稿。
4. 点击发布后，Worker 发放上传意图，浏览器只 PUT `model.glb`、裁剪后的 `manifest.json` 和可选 `thumbnail.webp`。
5. D1 先预留配额、finalize 时结算，随后创建分享令牌。
6. 审稿者打开 `/s/<token>`，同一个 Viewer 组件读取派生资产。

**关键不变量：**

- Worker 永不接收或保存 `.blend`、`multipart/form-data`、`application/x-blender` 请求体——见 `worker/index.ts:23`。
- 写操作要求 `Origin` 头与 `APP_ORIGIN` 完全一致，见 `worker/index.ts:56`。
- 公开响应会做递归扫描，确保 owner capability、token、密码 hash、storage namespace 与 R2 object key 不外泄。
- R2 保持私有，只能通过 Worker 的 `ASSETS` binding 访问。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 快速开始

### 环境要求

- **Node.js >= 22.12.0** —— `package.json` 的要求，因为本地数据库使用 `node:sqlite`。
- **Blender** —— 需本机安装。默认查找 macOS 上的 Steam 安装路径，可用 `BLENDER_BIN` 覆盖。
- **macOS** —— 当前 `.blend` 转换链路与默认 Blender 路径仅支持 macOS。

### 安装

```sh
npm install
npm run dev
```

打开 `http://localhost:5173`。涉及三个端口：

| 端口 | 进程 |
|---|---|
| 5173 | Vite Web 应用 |
| 8788 | 本机 Blender bridge |
| 8787 | 本地 Cloudflare Worker（`npm run dev` 会自动启动；账号、分享与管理 API 必需） |

`npm run dev` 会注入固定的本地配对码，让浏览器能访问 bridge。如需指定其他 Blender 版本：

```sh
BLENDER_BIN="/Applications/Blender.app/Contents/MacOS/Blender" npm run dev:server
```

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 使用方式

1. 启动开发服务器，打开 `http://localhost:5173`。
2. 从“文件”菜单打开上传工作台并选择 `.blend` 文件。浏览器优先本地转换；不支持时自动回退到本机 Blender bridge。
3. 检查模型——旋转、平移、独显对象、切换相机与显示模式。
4. 点击「添加批注」进入标注模式；悬停模型表面会显示橙色吸附高光，右键在当前落点创建批注，在弹窗中填写并保存。作者可以解决或重开，新的批注会显示站内未读提示。
5. 创建分享、复制链接，并在第二个浏览器里打开，验证只读或可评论权限。

如需生成一个不依赖 Geometry Nodes 的测试场景（两个网格、地面、灯光、相机）：

```sh
npm run create:test-blend
```

这会写入 `test-assets/simple-review-scene.blend`。导入后点击「创建本地测试分享」，再打开生成的 `/s/<token>` 链接，即可验证客户侧的只读加载。

<details>
  <summary>npm 脚本</summary>

| 脚本 | 用途 |
|---|---|
| `npm run dev` | 同时启动 Web 应用与本机 bridge |
| `npm run dev:web` | 仅 Vite，绑定 `127.0.0.1` |
| `npm run dev:server` | 仅本机 Express bridge（`tsx watch`） |
| `npm run build` | 类型检查并构建 Web 产物到 `dist/` |
| `npm run start` | 以非 watch 模式运行本机 bridge |
| `npm run create:test-blend` | 生成简易审稿场景 |
| `npm run create:viewer-fixtures` | 生成三组 Viewer 验收样例 |
| `npm run check` | 类型检查 Web 与 server 源码 |
| `npm run check:worker` | 按 `tsconfig.worker.json` 类型检查 Worker |
| `npm run test:backend` | 本机后端测试套件（`node:test`） |
| `npm run test:worker` | Worker 测试套件（Vitest + `@cloudflare/vitest-plugin`） |
| `npm run worker:dev` | 用 Miniflare 在本地运行 Worker |
| `npm run worker:dry-run` | 构建 Worker 产物到 `dist-worker/` |
| `npm run worker:types` | 重新生成 `worker-configuration.d.ts` |

</details>

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 开发指南

**目录导览：**

```
blendproof/
├── src/            React Web 应用：Viewer、Outliner、批注、上传工作台
├── server/         本机 Express bridge、Blender 导出脚本、SQLite 数据层
│   └── blender/    后台导出与样例生成的 Python 脚本
├── worker/         Cloudflare Worker：登录、上传、分享、限流、清理
├── migrations/     D1 schema，0001 至 0009
├── tests/          本机后端测试（node:test）
├── docs/           设计、验收与部署长文记录
├── public/         默认演示 GLB、manifest、封面图与可选封面视频
├── test-assets/    开发样例，不进入运行时存储
└── storage/        本地项目数据（已 git 忽略）
```

**验收门禁。** 至少运行：

```sh
npm run check
npm run check:worker
npm run test:backend
npm run test:worker
```

Web 改动上线前运行 `npm run build`；改动 Worker 时运行 `npm run worker:dry-run`，并确认产物中不含 `.blend`、`.dev.vars`、本地数据库或 `storage/` 内容。

**协作约定**记录在 [`AGENTS.md`](AGENTS.md)：稳定产品边界、授权必须由 Worker 而非前端强制、以及真实 Cloudflare 资源、DNS、Secret 与远程 migration 需明确授权。长期状态记录在 [`.planning/STATE.md`](.planning/STATE.md)。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 接口

Worker 优先处理 `/api/*`，其余路径回退到 SPA 静态资源。

<details>
  <summary>Worker 路由</summary>

**公开**

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/health` | 运行时探针：报告 Worker、D1、R2 binding |
| `GET` | `/api/public/stats` | 公开平台指标（缓存 30 秒） |
| `GET` | `/api/me` | 当前身份；匿名调用返回空身份 |
| `GET` | `/api/me/stats` | 个人空间与项目占用 |
| `POST` | `/api/auth/bootstrap-admin` | 一次性管理员初始化；首次成功后永久关闭 |
| `POST` | `/api/auth/register` | 邀请码注册 |
| `POST` | `/api/auth/login` | 密码登录 |
| `POST` | `/api/auth/logout` | 销毁会话 |

**项目与上传**

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/projects` | 创建项目；`.blend` 请求体一律 415 |
| `POST` | `/api/projects/:id/upload-intents` | 预留配额并签发上传意图 |
| `PUT` | `/api/projects/:id/assets/:asset` | 上传 `model.glb`、`manifest.json` 或 `thumbnail.webp` |
| `POST` | `/api/projects/:id/finalize` | 结算配额预留 |

**分享与评论**

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/projects/:id/shares` | 创建分享 |
| `DELETE` | `/api/projects/:id/shares/:token` | 撤销分享 |
| `GET` | `/api/projects/:id/comments` | 创建者侧评论列表 |
| `PATCH`/`DELETE` | `/api/projects/:id/comments/:commentId` | 创建者侧编辑或删除 |
| `POST` | `/api/shares/:token/access` | 解锁带密码的分享 |
| `GET` | `/api/shares/:token/status` | 分享元信息与到期时间 |
| `GET` | `/api/shares/:token/:asset` | 读取 `model.glb` 或 `manifest.json` |
| `GET`/`POST` | `/api/shares/:token/comments` | 访客读取或发表评论（需可评论权限） |

**管理**

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET`/`POST` | `/api/admin/invites` | 列出或创建邀请码 |
| `DELETE` | `/api/admin/invites/:id` | 撤销邀请码 |
| `GET` | `/api/admin/users` | 成员列表与用量 |
| `POST` | `/api/admin/users/:id/disable` | 停用成员 |
| `GET`/`PATCH` | `/api/admin/settings` | 读取或调低平台阈值 |
| `GET` | `/api/admin/stats` | 平台级统计 |

</details>

审稿数据合同见 [`docs/REVIEW_CONTRACT.md`](docs/REVIEW_CONTRACT.md)。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 部署

生产 Worker、D1、私有 R2、每小时 cron 与自定义域 `blendproof.itycon.cn` 均已上线。`wrangler.jsonc` 保存的是真实资源 ID，不再是占位配置。

```sh
npm run build                 # 生成 dist/ 供 Worker 静态资源托管
npx wrangler d1 migrations apply <database> --remote
npx wrangler deploy
```

顺序不能颠倒：先执行 D1 migrations 再部署，并确认 `APP_ORIGIN` 与实际 HTTPS Origin 完全一致、无尾斜杠。Secret（`UPLOAD_SIGNING_SECRET`、`SHARE_ACCESS_SECRET` 与一次性的 `BOOTSTRAP_ADMIN_TOKEN`）通过 Wrangler Secret 配置，绝不提交。

授权闸门、Secret 处理、migration 顺序、双浏览器验收清单与回滚流程见 [`docs/PHASE_4D_DEPLOYMENT_RECOVERY.md`](docs/PHASE_4D_DEPLOYMENT_RECOVERY.md)。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 保留与配额

| 限制项 | 数值 |
|---|---|
| 公益池容量 | 5 GiB |
| 项目最长保留 | 48 小时（即使未创建分享） |
| 分享默认有效期 | 24 小时 |
| 清理周期 | 每小时 cron，`0 * * * *` |

D1 作为原子配额账本：上传意图时预留、finalize 时结算、失败或过期时释放。cron 按精确 R2 key 删除，并重试未完成的账本条目。`/s/suzanne` 演示模型不计配额，也不进入清理。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 已知限制

- **Geometry Nodes Simulation Zone。** `test-assets/zhuzhiliao_geometry_nodes_substep_core.blend` 可以正常导出与加载，但其中的 Simulation Zone 在 Blender 后台模式无法求值，原生 glTF 导出器会省略部分 Stub 网格。下一步是把这类告警提取为转换报告，并提供后台烘焙或「已烘焙模型」的替代路径。
- **生产验收尚未完成。** 管理员登录、真实 `.blend` 发布、跨浏览器评论与过期清理尚未在线上环境验证。
- **`node:sqlite` 仍是实验特性。** 在 Node 22 上可用但会输出 `ExperimentalWarning`；运行时版本已锁定，D1 适配边界保持完整。
- **仅支持 macOS。** Blender bridge 与默认二进制查找目前只面向 macOS。
- **本地配对码仅供开发。** `npm run dev` 中的固定配对码是本地便利，生产仍需带外配对入口。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 常见问题

**服务器会看到我的 `.blend` 吗？**
不会。文件只发往 loopback bridge。Worker 对 `.blend`、`multipart/form-data` 与 `application/x-blender` 请求体一律返回 415，发布时只上传派生出的 GLB、裁剪后的 manifest 和可选缩略图。

**审稿者需要安装 Blender 吗？**
不需要。只需要浏览器和分享链接。Blender 仅用于转换与发布的那台机器。

**分享链接能存活多久？**
默认 24 小时。无论是否创建分享，项目硬上限是 48 小时，每小时 cron 会删除过期的派生资产。

**`/s/suzanne` 是什么？**
一个永久公开演示模型，访问口令为 `tycon`。它不计配额、不进入清理；访客可直接在模型表面添加批注，默认显示为「访客」。

**为什么要求这么新的 Node 版本？**
本地 bridge 用 `node:sqlite` 作为开发数据库，因此要求 `>= 22.12.0`。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 参与贡献

BlendProof 是未配置远端的私有仓库，不接收外部 Pull Request。协作在仓库内进行：遵循 [`AGENTS.md`](AGENTS.md) 的边界约定，跑通上述验收门禁，并在真实浏览器中验证 UI 改动，而不是只看构建是否成功。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 许可证

UNLICENSED —— 保留所有权利。这是没有 `LICENSE` 文件的私有项目，本文档不授予任何使用、复制、修改或分发许可。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>
