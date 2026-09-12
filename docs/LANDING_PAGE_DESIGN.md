# BlendProof 落地页设计蓝图

方向 A《边界》创意简报与设计系统，风格基线为 **Blender 界面还原**。本文件是 `gh-pages-landing` skill 的 Stage A–E 产出，供后续实现与部署使用。

状态：**设计已定，尚未实现、尚未部署**。落地页与生产站的分工是——落地页负责说服，生产站负责使用。

> 凭据纪律：本文件及仓库内任何文件都不得出现管理员密码、邀请码、session 或 Secret。生产验证用的临时凭据只存在于当次会话，用后即弃。

---

## 1. Evidence Dossier

页面上每一句话、每一个数字都必须能回到这张表。

### 已核实事实（带出处）

| 事实 | 出处 |
|---|---|
| 云端永不接收 `.blend`，直接返回 HTTP 415 | `worker/index.ts:23`（`multipart/form-data` 与 `application/x-blender` 都拒） |
| 写操作要求 `Origin` 与 `APP_ORIGIN` 完全一致 | `worker/index.ts:56` |
| 上传工作台与 `/s/<token>` 复用同一 Viewer 组件 | `src/App.tsx`，`docs/LONG_TERM_PLAN.md` 阶段 2 |
| 分享支持只读/可评论、密码、到期、撤销 | `worker/shares.ts` 路由表 |
| 批注锚定模型表面，含稳定相机重放 | `docs/LOCAL_MILESTONE_ACCEPTANCE.md` |
| 5 GiB 公益池，项目硬上限 48 小时，分享默认 24 小时 | `docs/PRODUCT_CONVENTIONS.md`、`worker/cleanup.ts` |
| 清理为每小时 cron `0 * * * *` | `wrangler.jsonc` 的 `triggers.crons` |
| 技术栈：React 19 / R3F 9 / three 0.180 / Vite 7；Express 5 / `node:sqlite`；Workers + D1 + 私有 R2 | `package.json`、`wrangler.jsonc` |
| 源码规模 9114 行 TS/TSX（`src` + `server` + `worker`） | `wc -l` 实测 |
| D1 schema 共 9 个 migration | `migrations/0001`–`0009` |
| 演示模型 `default-monkey.glb` 为 69,708 字节 | `public/default-monkey.glb` |
| 生产入口 `https://blendproof.itycon.cn`，首页与 `/api/health` 均 200 | 实测 `curl` |
| 公开演示 `/s/suzanne` 返回 200，口令 `tycon` | `src/App.tsx:108`（`DEMO_SHARE_TOKEN`） |

### 可用资产

- `public/blendproof-splash-v1.png` —— 唯一的正式视觉资产，暗背景暖橙金爆炸视图，与主色 `#e87d0d` 天然协调
- **产品本身的完整 UI 组件库**（见第 5 节），这是本次设计最重要的资产
- `src/components/BlenderLogo.tsx` —— Blender logo，三色 `#E87D0D` / `#fff` / `#265787`

### 调性信号

| 信号 | 采集结果 | 影响 |
|---|---|---|
| 项目命名 | `BlendProof` 直白组合词（Blender + Proof） | 文案不宜俏皮，不用俚语 |
| commit message | 全部规整 conventional commits | 工程可信感，语气克制 |
| README 行文 | 无营销腔，陈述事实为主 | 禁用形容词堆砌 |
| UI 尺度 | 圆角 2–3px、chrome 字号 9–11px、零阴影 | token 照搬，不美化 |
| 产品类型 | 带桌面应用质感的 Web 工具 | 走工具感，不走消费级 SaaS |
| 目标用户 | 3D 美术、技术美术、外包审稿的甲方 | 可用行业术语，不必降门槛 |

### 红线：不能宣称的内容

- 用户数、采用量、企业客户、用户评价——**一个都没有**
- 性能数字（加载耗时、并发量）——无基准测试证据
- 跨平台——**当前仅支持 macOS**，不得暗示 Windows/Linux 可用
- "已在生产完整验证"——端到端验收尚未完成，措辞必须诚实

---

## 2. Stage B 创意简报

### 2.1 叙事弧

5 步，每一屏只服务其中一步。

1. **进场（0–5 秒）** —— 访客的顾虑是"把 `.blend` 发出去审稿，等于把工程交出去"。首屏用一句话给出结论，并让访客立刻看见一个**真的能操作的 Blender 窗口**。
2. **展开一：本机侧** —— 文件从本机出发，逼近边界。建立"这是你的机器，你说了算"的认知。
3. **高潮：跨越** —— 边界处发生形态转换。`.blend` 被挡回并亮起真实的 415 拒绝，GLB 与裁剪后的 manifest 通过。这是签名时刻。
4. **展开二：落地** —— GLB 落成可看的视口，批注 pin 逐个锚定到模型表面。
5. **收束** —— 真实数字（5 GiB / 48 小时 / 每小时清理）+ 单一 CTA。

### 2.2 声音系统

**调性光谱定位：2 / 5**（1 = 克制专业，5 = 自信俏皮）。理由：命名直白、commit 规整、README 无营销腔，产品又涉及数据边界——轻佻会削弱可信度。

**声音指南（全页遵守）：**

- 人称：对"你"说话。产品名做主语时用"它"，每屏最多一次。
- 动词力度：标题与 CTA 用强动词——**留下、挡住、跨越、锚定**。说明文字用中性动词。
- 句长节奏：标题 ≤14 字，导语 1–2 句，正文每段 ≤3 行。
- 禁词：赋能、一站式、极致、革命性、优雅、强大，以及一切 README 里不会出现的词。

**双语：** 本期**不写第二语言**，但按第 8 节预留 i18n 接口。中英不是直译关系，是同一叙事弧的两次地道化——英文更短促（"Your .blend stays home."），中文可用口语节奏（"原始工程，不出本机。"）。

### 2.3 交互概念

产品核心动作 = **一个文件越过一条边界，并在越界时被改变形态**。

页面化预演：滚动驱动文件从左侧（本机）向边界线移动，在边界处完成"被拒绝—被转换—被放行"三段状态。访客不是读到一个关于安全边界的说明，而是**亲眼看到边界生效**。

在此之上，按老板要求叠加第二层交互——**Blender 界面本身是可玩的**（详见第 5 节）。两层的关系是：Blender 窗口负责"让你相信这是个真工具"，边界叙事负责"让你记住它凭什么不同"。

### 2.4 Signature moment 四问

| 问 | 答 |
|---|---|
| **隐喻** | 把"信任边界"这个抽象的安全概念，变成一道可见的物理关卡 |
| **时机** | 第 3 屏，滚动约 60% 处——"云端会不会拿到我的工程"这个怀疑被彻底消除的位置 |
| **不可截图性** | 高，核心体验依赖滚动时序。**静态降级必须成立**：边界左右同时呈现对比构图（左侧 `.blend` 带拒绝标记，右侧 GLB 带放行标记），完全不动画也能读懂 |
| **成本** | CSS `transform` + `clip-path` 为主；桌面端可选 GSAP ScrollTrigger 做 pin。移动端 ≤768px 给静态对比构图 + 简单淡入 |

按 skill 的规则，签名时刻可以多花 3 倍开发时间——它是全页唯一的记忆点。

---

## 3. Stage C 设计系统

### 3.1 Design Read

> **一个把信任边界可视化了的审稿台——工程可信、克制，用 Blender 工作台的语言说话。**

| 量化值 | 取值 | 依据 |
|---|---|---|
| design variance（版式变化度） | 0.6 | 需要张弛，但服务工程叙事，不做每屏异构的花活 |
| motion intensity（动效强度） | 0.65 | 签名时刻 + 可玩的组件交互，但不引入 Three.js |
| visual density（信息密度） | 0.7 | 按老板要求还原 Blender 界面，密度天然偏高 |

### 3.2 Token 集

风格家族归属 **沉浸叙事（Immersive）**，但 token **全部照搬产品的真实取值**，不是另起一套。这是"落地页与生产站像一家人"最省力也最彻底的做法。

```css
/* 背景与面板 —— 取自 src/styles.css :root 与 .blender-menubar */
--bg:            #1d1d1d;  /* 产品根背景 */
--panel:         #2a2a2a;  /* 菜单栏背景 */
--input:         #202020;  /* 输入控件背景 */
--subtle:        #161616;

/* 边框 —— 产品的分隔靠 1px 边框，不靠阴影 */
--border:        #111111;  /* 菜单栏下沿 */
--border-soft:   #414141;  /* 控件分隔 */
--border-strong: #4a4a4a;  /* 输入框描边 */

/* 文字 */
--ink:           #d8d8d8;  /* 产品正文色 */
--ink-bright:    #eeeeee;
--muted:         #a9a9a9;
--faint:         #8f8f8f;
--dim:           #777777;

/* 强调 —— 全页唯一主色 */
--accent:        #e87d0d;  /* 项目最高频色值 */
--accent-soft:   color-mix(in srgb, var(--accent) 14%, transparent);
--accent-warm:   #f39a35;  /* 产品里用于强调图标 */
--accent-edge:   #76501f;  /* 强调元素描边 */
--accent-well:   #33291d;  /* 强调元素底 */

/* 次级强调：Blender logo 蓝。原色不可用作文字，见下方对照表 */
--blue:          #265787;  /* 只作背景块 / 描边 / 边界线填充 */
--blue-ink:      #5b9ee0;  /* 蓝色侧的可用文字色（提亮版） */
--blue-well:     #16283d;  /* 蓝色侧的浅底 */

/* 几何与尺度 —— 照搬产品实测值 */
--radius:        3px;   /* 产品最高频圆角（18 次） */
--radius-sm:     2px;   /* 次高频（14 次） */
--fs-micro:      9px;   /* 产品最高频字号（37 次） */
--fs-chrome:     10px;  /* 次高频（40 次） */
--fs-label:      11px;
```

**双色分工。** 老板决定启用 Blender logo 蓝 `#265787` 作为第二强调色。它不是"第二个品牌色"，而是从 Blender logo 自身三色（橙／白／蓝）里取出的语义色，分工如下：

| 色 | 语义 | 用在哪 |
|---|---|---|
| `#e87d0d` 橙 | **本机侧 / 你掌控的部分** / 主 CTA | 标题强调、主按钮、本机侧文件、活跃态 |
| `#265787` 蓝 | **云端侧 / 受控的部分** / 边界 | 云端侧区块底色、边界线填充、信息态标签 |

这个映射不是硬凑的——它让《边界》的核心叙事获得了一条天然的视觉分界线：**橙的一侧是你的机器，蓝的一侧是云端，中间那条边界线就是本设计反复强调的那道关卡。**

**但蓝色有一个必须先解决的对比度问题。** 实测数据：

| 用法 | 对比度 | 判定 |
|---|---|---|
| `#265787` 作文字 on `#1d1d1d` | **2.24:1** | ❌ **不可用**，远低于 4.5 |
| `#2f6ba3` 作文字 | 3.01:1 | ⚠️ 仅大字号 |
| `#3d7ab5` 作文字 | 3.73:1 | ⚠️ 仅大字号 |
| `#4a8ad0` 作文字 | 4.69:1 | ✅ 可作正文 |
| **`#5b9ee0` 作文字** | **5.95:1** | ✅ **推荐作为蓝色侧文字色** |
| `#6fb0f0` 作文字 | 7.34:1 | ✅ 可作正文 |
| `#265787` 作底 + `#fff` 文字 | 7.51:1 | ✅ 可作反白块 |
| `#265787` 作底 + `#d8d8d8` 文字 | 5.27:1 | ✅ |
| `#e87d0d` 作底 + `#265787` 文字 | 2.64:1 | ❌ 橙蓝不可直接叠字 |

**结论性规则（三条，实现时必须遵守）：**

1. **`#265787` 只作背景块、描边、边界线填充，永不作文字色。** 需要蓝色文字时一律用 `#5b9ee0`。
2. **橙与蓝不同时出现在同一元素上**——橙字压蓝底只有 2.64:1。两者靠"分居边界两侧"来协作，不靠叠色。
3. 橙蓝的视觉权重天然不对等（橙在深色背景上是"亮"的 5.92:1，蓝是"暗"的 2.24:1）。**不要试图让两侧看起来同等醒目**——本机侧天然是主角，云端侧是配角，这恰好符合产品叙事的重心，顺势而为即可。


**字号的可访问性张力（必须处理）：** 产品的 9–11px 是 Blender 桌面 UI 的真实密度，但**不能用于落地页正文**——低于 12px 的长文本可读性与对比度都不达标。处理方式：

- **chrome 层（窗口菜单栏、状态栏、面板标签、Outliner 行）**：照搬 9–11px，还原密度
- **内容层（标题、导语、正文、CTA）**：正文 ≥14px，导语 ≥16px，标题按第 3.3 节

这条分界线是本设计最重要的一条纪律——**还原的是"质感"，不是"像素级的小字"**。

### 3.3 字体搭配

- 全局：`-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif`（与产品 `:root` 完全一致）
- 标签/路径/数字/命令：`ui-monospace`，大写 + `letter-spacing: .08em` 的小标签，这是工具感的核心
- **不引入第二显示字体，不用衬线**——衬线属于编辑排版风，与 token 家族冲突
- Hero 标题 `clamp(2.4rem, 6.5vw, 4.2rem)`，字重 700。不用 Immersive 配方的 `8vw` 极限值——调性光谱只有 2/5，克制优先

### 3.4 几何语言

- **圆角 2–3px，不用更大**。这是产品实测的主导值，也是 Blender 界面的近直角质感
- `1px` 边框分层，**全程不用阴影**（产品 CSS 里几乎没有 box-shadow）
- 边界线是全页唯一贯穿的长元素，形状一致性锁定在它身上
- 允许元素出血到屏幕外，但每页 ≤2 处
- 背景光晕 ≤2 处，只用 accent 低透明度版本

### 3.5 结构推导

构图在"左右分栏 / 全宽宣言 / 网格 / 表格 / 出血大图 / 窗口嵌板"之间轮换，节奏服务叙事（密 → 疏 → 密）。

| 屏 | 对应叙事步 | 消除什么怀疑 | 证据形态 | 构图 |
|---|---|---|---|---|
| 1 | 进场 | "这是什么" | 一句话 + 可操作的 Blender 窗口 | 全宽宣言 + 窗口嵌板 |
| 2 | 展开一 | "文件从哪来" | 真实路径文字 + 文件卡片 | 左右分栏 |
| 3 | **高潮** | "云端会不会拿到我的工程" | 真实 415 响应 + 边界关卡 | **出血大图** |
| 4 | 展开二 | "审稿方看到什么" | 实拍截图 + 复用组件面板 | 窗口嵌板 |
| 5 | 展开二续 | "审稿效率如何" | mockup 面板组（Outliner / 批注 / 分享） | 网格 |
| 6 | 收束 | "成本和风险" | 真实数字表格 | 表格 |
| 7 | 收束 | "我该做什么" | 单一 CTA | 全宽宣言 |

7 屏，展示型屏之间隔开了表格，无连续重复构图。每屏对应叙事弧一步，无孤儿屏。

### 3.6 反默认清单核对

| 项 | 是否出现 | 判定 |
|---|---|---|
| dark terminal | 出现 | **有叙事理由**——产品本身就是深色 3D 工作台，不是跟风深色 |
| marquee 跑马灯 | 无 | ✅ |
| 编号分区（01/02/03） | 无 | ✅ |
| bento 拼版 | 无 | ✅ |
| 三等分卡片行 | 无 | ✅ |

五件套只出现 1 件且有正当理由，通过。eyebrow 小标签计划只在第 3、6 屏使用，7 屏共 2 个，未超"每 3 屏最多 1 个"。

---

## 4. 视觉一致性策略

老板的要求是"共用 token 但不用局限太死"。落地方案分三层：

| 层级 | 策略 | 理由 |
|---|---|---|
| **色值与几何** | 100% 照搬产品（第 3.2 节） | 色值是最强的家族感来源，改一处就会"不像一家人" |
| **组件形态** | 复用产品组件类名与结构（第 5 节） | 让 mockup 面板天然就是产品的一部分 |
| **尺度与节奏** | 允许落地页放大 | 落地页是营销语境，字号、留白、屏高都可以比桌面 UI 更舒展 |

一句话：**颜色和形状不许改，尺寸和节奏可以放开。**

---

## 5. Blender 界面还原规格

这是本次设计相对通用落地页的核心增量。项目已经有一套完整的 Blender 风格 UI 实现，落地页**不重新发明，直接复用**。

### 5.1 骨架

产品 `src/styles.css` 的 `.blender-shell` 是标准 Blender 三行布局：

```
┌─────────────────────────────────────────────┐
│ .blender-menubar                    32px    │  ← 菜单栏 + 工作区标签
├─────────────────────────────────────────────┤
│                                             │
│ .blender-main                      minmax   │  ← 编辑器区域
│   ├── .editor (viewport / outliner / ...)   │
│                                             │
├─────────────────────────────────────────────┤
│ .blender-status                     22px    │  ← 状态栏
└─────────────────────────────────────────────┘
```

**落地页的处理方式**：把这个 shell 做成 hero 里的一个**窗口嵌板**，窗口内部保持产品的固定三行布局；窗口外部是正常滚动的落地页内容。这样既完整还原 Blender 的界面语言，又不牺牲落地页必需的滚动性——**不把整个页面做成 `overflow: hidden` 的应用。**

### 5.2 可复用的组件清单

落地页第 1、4、5 屏的 mockup 面板从这里取。

**骨架与导航**

| 组件类 | 还原什么 |
|---|---|
| `.blender-menubar` | 顶部菜单栏（32px，#2a2a2a 底，1px #111 下沿） |
| `.workspace-tabs` | 工作区标签（Layout / Modeling / …），底部对齐 |
| `.blender-status` | 底部状态栏（22px） |
| `.brand-mark` | Blender logo + 产品名 |
| `.project-name` + `.project-share-status` | 居中项目名与圆形分享状态徽标 |

**菜单与交互**

| 组件类 | 还原什么 |
|---|---|
| `.file-menu` / `.file-menu-trigger` | File 菜单 |
| `.file-menu-item-with-submenu` + `.file-recent-submenu` | **悬停展开的二级菜单**（"最近项目"） |
| `.menu-item` / `.file-menu-separator` | 菜单项与分隔线 |
| `.overlay-toggle` | 网格/轴线的叠加层开关 |
| `.view-controls` / `.viewport-hints` | 视口控制与操作提示 |
| `.panel-resize-handle` | **可拖拽的面板分隔条** |
| `.selection-box` | 框选矩形 |

**编辑器区域**

| 组件类 | 还原什么 |
|---|---|
| `.outliner` / `.outliner-search` / `.outliner-focus` | Outliner 面板 + 搜索 + 聚焦 |
| `.tree-root` / `.tree-row` / `.tree-children` / `.tree-icon` | 场景树与展开折叠 |
| `.properties` / `.property-body` / `.property-kicker` | 属性面板 |
| `.timeline` | 时间线 |
| `.axis-widget` | 坐标轴指示器 |
| `.tool-strip` / `.tool` | 左侧工具栏 |
| `.camera-group` / `.file-camera` | 相机切换 |

**状态与反馈**

| 组件类 | 还原什么 |
|---|---|
| `.upload-progress` + `-active` / `-done` / `-error` | **上传进度三态** |
| `.storage-meter` / `.storage-reading` | 空间计量条 |
| `.spin` | 加载旋转 |
| `.notice` / `.review-status` | 提示与审稿状态 |
| `.share-credential-card` / `.receiver-card` | 发送方凭证卡 / 接收方通行证卡 |
| `.review-panel` / `.review-list` / `.review-item` | 审稿面板 |
| `.admin-table` / `.invite-table` | 管理后台表格 |

### 5.3 交互动画清单（趣味性来源）

老板强调"组件交互动画要有趣味性、交互性"。以下每一项都**在产品里有真实实现**，落地页是还原而非杜撰——这是趣味性最可靠的来源：它们已经是这个产品的肌肉记忆。

| 交互 | 趣味点 | 实现手段 | 意图分类 |
|---|---|---|---|
| **中键拖拽旋转模型** | 访客下意识会试着转它 | R3F `OrbitControls`（已定，规格见第 6 节） | compare |
| **悬停展开二级菜单** | 菜单项向右滑出，"最近项目"带缩进层级 | CSS `:hover` + `transform: translateX` + 轻微延迟 | reveal |
| **拖拽面板分隔条** | 拖动时面板实时改变宽度，光标换形 | `pointerdown/move` + CSS 变量驱动宽度 | compare |
| **切换工作区标签** | 标签底部高亮滑动到新位置 | `transform` 位移 + 下划线跟随 | orient |
| **切换叠加层开关** | 网格与坐标轴淡入淡出 | `opacity` 过渡 | compare |
| **Outliner 树展开** | 三角图标旋转 90°，子节点高度展开 | `rotate` + `height` 过渡 | reveal |
| **Outliner 行悬停/选中** | 行背景在原生的 `#3d3d3d` 上亮起 | 与产品 `nav button:hover` 同值 | confirm |
| **批注 pin 落定** | 从悬浮到吸附到表面的回弹 | 回弹曲线 `cubic-bezier(.34,1.56,.64,1)` | reveal |
| **上传进度三态流转** | active → done 时标记点连成线 | `width` 过渡 + 状态色切换 | confirm |
| **存储计量条** | 数字与条长同步增长 | `scaleX` + 数字滚动 | reveal |
| **框选矩形** | 拖拽时出现半透明选择框 | `pointer` 事件 + 边框绘制 | compare |
| **相机切换** | 视口内容随相机切换平移 | `transform` 或预渲染帧切换 | orient |

**克制原则**：不是 12 项全上。按第 3.5 节的结构，第 1 屏放 2 项（旋转 + 悬停菜单），第 4 屏放 3 项（树展开 + 叠加层 + 相机），第 5 屏放 2 项（pin 落定 + 进度三态）。**其余按需**。堆满交互等于没有交互。

### 5.4 组件 mock 的真实性要求

按 `mock-craft.md` 的密度法则，所有 mockup 面板：

- 列表条目 **≥7 条**（3 条像示例，7 条像产品）
- **状态要杂**：不要全绿。混合已解决/待处理/已过期
- **文案要具体**：用真实的 `default-monkey.manifest.json` 对象名、真实路径、真实数字，不用 "Item 1"
- **层级三层**：概览（名称+状态）→ 详情（路径+时间）→ 交互（可复制按钮）
- 每一条数据都要能追回源码里的一个真实字段

---

## 6. Stage D 动效编舞

实现前先写死这张表。意图只有 `orient` / `reveal` / `compare` / `confirm` 四类合法，其余一律砍掉。

| 幕 | 内容 | 意图 | 触发 | 曲线 | 时长 | 降级 |
|---|---|---|---|---|---|---|
| 1 | Hero 标题与边界线入画 | reveal | 加载 | ease-out | 0.6s | 直接显示 |
| 2 | Blender 窗口嵌板展开 | reveal | 加载后 | ease-out | 0.5s | 直接显示 |
| 3 | 文件卡片自左侧滑入 | reveal | 进入视口 | ease-out | 0.5s | 静态定位 |
| 4 | **跨越：`.blend` 被挡回，415 亮起** | confirm | 滚动至 60% | cubic-bezier(.2,.8,.2,1) | 1.2s | 静态对比构图 |
| 5 | GLB 通过并落成视口 | reveal | 滚动触发 | ease-out | 0.8s | 直接显示 |
| 6 | 批注 pin 逐个锚定 | reveal | 进入视口 | cubic-bezier(.34,1.56,.64,1) | 每个 0.25s，错峰 0.12s | 全显 |
| 7 | 组件微交互（第 5.3 节清单） | compare / confirm | 用户手势 | 产品同款 | 0.15–0.3s | 静态 |
| 8 | 数字滚动到真实值 | reveal | 进入视口 | linear | 1.5s | 静态数字 |
| 9 | 复制链接按钮反馈 | confirm | 点击 | ease-out | 0.2s | 文字变化 |

### 技术选型

**CSS 为底，R3F 只用在 hero 的 3D 视口，不引入 GSAP。**

- 幕 1–3、6、8、9 与全部组件微交互：纯 CSS + `IntersectionObserver`，零依赖
- 幕 4：CSS `transform` + `clip-path` 实现形态转换。若滚动时序需精确控制，桌面端（`min-width: 769px`）升级为 GSAP ScrollTrigger + pin
- hero 模型：**R3F 实时渲染**（老板决定），规格见下

### 三类降级

1. **`prefers-reduced-motion: reduce`**：位移与时长归零，opacity 直接到终态。内容不隐藏，只是不动。
2. **无 JS**：CSS 动画不受影响；幕 4 靠默认展开态兜底。
3. **移动端 ≤768px**：幕 4 降级为静态对比构图；拖拽分隔条改为点击切换预设宽度；hero 模型**保留交互**但降 dpr 上限并暂停离屏渲染。

### Hero 3D：R3F 实时渲染规格

老板决定 hero 的模型用 R3F 实时渲染，换取可交互性。代价与对策如下。

**为什么这个选择是合理的**：产品本身就是 R3F 应用（React 19 + `@react-three/fiber` 9 + three 0.180），落地页与之同技术栈意味着 hero 的 Canvas 可以**直接复用产品的相机与控制器逻辑**，视觉行为天然一致。这比预渲染序列帧更贴合"参考已有项目的 UI 组件"这个要求。

**WebGL 技术栈对比**

| 方案 | gzip 体积 | 能否复用产品逻辑 | 适用场景 |
|---|---|---|---|
| three.js 裸用 | ~150 KB | 需重写相机与控制器 | 高度定制，不打算复用产品组件 |
| **R3F + drei（选定）** | ~250–280 KB | ✅ 可直接 import 产品组件 | 要与产品 UI 联动 |
| Babylon.js | ~700 KB+ | 否 | 复杂场景、游戏化交互 |
| `<model-viewer>` | ~200–280 KB | 否（声明式 Web Component） | 只需展示一个可旋转模型 |
| OGL | ~30 KB | 否 | 极轻量自定义渲染 |
| CSS 3D | 0 | — | 伪 3D，交互质量不足 |

选 R3F 的决定性理由只有一条：**它能让 hero 与产品的 Outliner、菜单、叠加层开关真正联动**。若 hero 只需要"一个能转的模型"，`<model-viewer>` 体积相近而代码量少一个数量级——但它承接不了产品已有的相机与选择逻辑，做不出本设计要的"可玩工作台"。

**体积预算**（gzip 后估算）

| 包 | 约 |
|---|---|
| React 19 + ReactDOM | ~48 KB |
| three.js | ~150 KB |
| `@react-three/fiber` | ~15 KB |
| `@react-three/drei`（按需，只取 `OrbitControls` 等） | ~20–40 KB |
| 落地页自身 | ~20 KB |
| **合计** | **~250–280 KB** |

模型 `default-monkey.glb` 为 69,708 字节，走 fetch 加载，不计入 JS bundle。

`drei` 必须**按需导入**——全量 `import { ... } from '@react-three/drei'` 会拖进几十个用不到的组件。

**LCP 策略**：不要把 hero 交给"静态图 → Canvas"的替换——那会有可见的跳变，也削弱 3D 的冲击力。正确做法是**让 LCP 由标题文本承担，hero 从头到尾就是 3D**：

1. `<h1>` 是标准 HTML 文本，随文档立即渲染，**它本身就是 LCP 元素**
2. `<Canvas>` 作为 hero 的主体层，与 H1 叠在同一容器（grid 叠层或绝对定位），视口从首帧就在
3. 模型 `default-monkey.glb` 异步加载；加载期间 Canvas 先渲染**极简等价物**（低模猴头或线框），让视口一开始就有内容
4. 模型就绪后淡入替换低模——**视口从不消失，页面从不留白**

静态图只作为 WebGL 不可用时的异常兜底（见降级链），不是首屏常态。

**降级链**

| 情况 | 表现 |
|---|---|
| 正常 | R3F Canvas，可拖拽旋转、滚轮缩放 |
| `prefers-reduced-motion: reduce` | Canvas 照常渲染但**不自动旋转**；交互保留——这是用户主动操作，不属于需降级的自动动画 |
| WebGL 不可用 | 保留静态图 + 一行说明文字，不报错、不留白 |
| 移动端 ≤768px | 保留 Canvas 交互，`dpr` 上限降到 1.5 |
| JS 加载失败 | 静态图兜底 |

**性能纪律**

- `<Canvas>` 设 `frameloop="demand"`，只在交互时渲染，不做常驻 60fps 循环
- 离开视口即暂停（`IntersectionObserver` + `invalidate()`）
- `dpr` 上限 2，移动端 1.5
- 不上后处理（bloom / SSAO 之类）——体积与性能都不划算

**构建约束（与校验器的交互）**

`validate_page.py` **禁止** `<link rel="modulepreload">` 和 `<link rel="stylesheet">`，而 Vite 默认产物两者都会生成。构建必须：

1. CSS 内联进 `<style>`
2. 移除全部 `modulepreload` 链接
3. JS 输出为**单个本地文件** `./app.js`（`<script type="module" src="./app.js">`），禁用代码分割

第 3 条同时规避了 `node --check` 的版本风险：校验器只用正则抽取**内联** `<script>` 内容做语法检查，外置文件不参与。本机实测 Node v22.22 对 ESM 语法的 `node --check` 是通过的，但外置 JS 能让构建不依赖这个行为。

**资产单一真源**：复用主仓库的 `public/default-monkey.glb`，构建时复制到 `dist/landing/assets/`，不手工维护第二份。

### 已知工程坑（来自 skill 实战经验）

- **`.blend` 被挡回**若做成可重试，必须用独立 generation counter 判断存活，不能复用步数计数器——否则多步演示会在第一步后自我取消。
- **JS 每次改动都要 bump `?v=N`**。这是 skill 记录的最高成本陷阱：改了 `app.js` 不 bump，Chromium 继续喂缓存脚本，你会反复调一个已经修好的 bug。
- **`getBoundingClientRect()` 不能跨时间缓存**。用合成 pointer 事件驱动拖拽/框选时，必须在 dispatch 时重算——中间任何 `focus()` 都可能滚动页面并悄悄弄坏坐标。

---

## 7. Stage E 证明面：实拍 + mockup 混合

按老板要求，**不把全部功能做成截图**。混合策略如下。

### 7.1 分工原则

| 用**实拍截图** | 用**组件 mockup 面板** |
|---|---|
| 需要证明"这是真跑起来的产品" | 需要展示多状态或信息密度 |
| 3D 视口内容（真实模型、材质、网格） | Outliner 树（需 ≥7 条 + 多种状态） |
| 整体界面观感 | 批注列表（需混合已解决/待处理） |
| 移动端响应式真实表现 | 上传进度三态 |
| | 管理后台表格 |

理由与 `mock-craft.md` 的 E5 决策表一致：**截图只能捕捉一个状态，mock 能展示信息架构**；但**截图的可信度高于制作**。两者各取所长。

### 7.2 实拍清单

来源：生产站 `https://blendproof.itycon.cn`，公开演示 `/s/suzanne`（口令 `tycon`）+ 管理员登录后的界面。

| 编号 | 内容 | 采集方式 | 用途 |
|---|---|---|---|
| S1 | Viewer 全视图（网格、坐标轴、猴头模型） | 公开演示，无需登录 | 第 1 屏窗口嵌板底图 + 第 4 屏主图 |
| S2 | 批注 pin 锚定在模型表面的特写 | 公开演示 | 第 5 屏 |
| S3 | 启动页欢迎封面 | 公开访问根页 | 第 1 屏备选 |
| S4 | 移动端 390px 视口 | 公开演示 | 响应式对照 |
| S5 | 管理员视角：邀请码列表 / 成员用量 | **需登录** | 第 5 屏网格单元 |
| S6 | 分享凭证卡（发送方） | **需登录** | 第 6 屏佐证 |

S5、S6 需登录。**登录仅在当次会话内进行，凭据不落盘、不写入任何文件。**

### 7.3 拍摄纪律（skill 明确警告过的坑）

- **高于视口的区块不能用元素截图**——会返回正确尺寸但只有几 KB 纯色的空白图。做法：先把 `scroll-behavior` 设为 `auto`，`window.scrollTo` 到精确偏移，断言目标元素的 `getBoundingClientRect().top`，然后截**视口**图。
- **每张图按文件大小自检**：真实内容一般 >30 KB，几 KB 的必是空白。
- **截图前显式设置语言与主题**（`localStorage` + reload），否则拍到的是你本机浏览器的语言/主题，不是目标受众看到的。
- 截图必须来自**已部署地址**，不是 localhost。

### 7.4 mockup 面板的真实性

第 5 节 5.4 的密度法则适用于全部 mockup：条目 ≥7、状态要杂、文案要具体、三层信息、可溯源。

**宁缺毋滥**：若某个 mockup 的信息密度撑不起来，宁可撤掉那一格用文字和数字代替，也不放低质量面板。

---

## 8. 交付与路由

老板要求落地页**既能上 GitHub Pages，也能通过 Worker 路由访问**。下面是按行业规范的设计。

### 8.1 双入口架构（已定）

| 入口 | 地址 | 用途 |
|---|---|---|
| 生产 Worker | `https://blendproof.itycon.cn/landing/` | **主入口**。已有用户与访客从站内进入，同源、无跳转；同时是 SEO 正本 |
| GitHub Pages | `https://yancongya.github.io/BlendProof/` | 镜像与对外分发，独立于生产基础设施 |

**不使用独立子域。** 老板决定改用主域下的路径，好处是不多占 DNS 记录、不必配 CNAME 与证书，也避开 Cloudflare 代理与 GitHub 自定义域校验的冲突。代价见 8.2。

**路由命名用 `/landing`**，不用 `/star`——后者在行业里没有先例，访客无法从路径推断内容，还容易被误读为"收藏/星标"功能。

**仓库**：新建**公开**仓库 `BlendProof`，落地页作为项目内的一部分存在，不另建 landing 仓库。

> [!CAUTION]
> 仓库公开意味着全部源码、`docs/`、`.planning/` 以及全部 commit 历史对任何人可见。公开前必须完成 8.6 的清理清单——其中**git 历史层面的清理尚未执行**。

### 8.2 关键陷阱：两个入口都不是根路径

这正是不用独立子域带来的连带代价，必须在写第一行 HTML 之前就知道。

| 入口 | 页面实际路径 | `./app.js` 解析到 | 结果 |
|---|---|---|---|
| Pages | `/BlendProof/` | `/BlendProof/app.js` | ✅ |
| Worker | `/landing/` | `/landing/app.js` | ✅ |
| Worker（**漏写尾斜杠**） | `/landing` | `/app.js` | ❌ **破图** |

三条硬约束：

1. **全部资源用相对路径**（`./app.js`、`./assets/foo.webp`），**绝不用绝对路径**（`/app.js`）——后者在 Pages 项目站上必然 404。
2. **产出目录形式** `dist/landing/index.html`，让 Workers 静态资源把 `/landing` 规范化并命中正确文件。不要产出扁平的 `dist/landing.html`。
3. 传播出去的链接**一律带尾斜杠** `/landing/`，文档、CTA、二维码都用这个形式。

好消息是，两侧因此**共用同一份产物、同一套相对路径，不需要 base 配置差异**——这个约束反而消除了"两套构建"的风险。

### 8.3 避免与 SPA fallback 冲突

`wrangler.jsonc` 当前配置：

```jsonc
"assets": {
  "directory": "./dist",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*"]
}
```

`single-page-application` 会让未匹配路径回退到应用的 `index.html`。`/landing/index.html` 是**真实存在的文件**，理论上静态资源服务会优先命中、不走 fallback——但**这一点必须实测确认，不能假设**。

预期产出结构：

```
dist/
├── index.html            ← 应用（SPA）
├── assets/               ← 应用资源
└── landing/
    ├── index.html        ← 落地页（CSS 内联）
    ├── app.js            ← 落地页 bundle（React + R3F）
    └── assets/           ← 模型、截图
```

部署后逐条验证：

```bash
# 1. 带尾斜杠能拿到 200，且最终 URL 未被重定向到根
curl -s -o /dev/null -w "%{http_code} %{url_effective}\n" -L https://blendproof.itycon.cn/landing/

# 2. 返回的确实是落地页，不是应用壳（必须 >0）
curl -s https://blendproof.itycon.cn/landing/ | grep -c '<落地页特征串>'

# 3. 资源能被解析到
curl -s -o /dev/null -w "%{http_code}\n" https://blendproof.itycon.cn/landing/app.js
```

若第 2 条命中的是应用特征串，说明被 fallback 吃掉，改为在 `worker/index.ts` 里显式处理 `/landing`。


### 8.4 GitHub Pages 部署

用 `github-pages-legacy-deploy` skill。仓库 `BlendProof`，**不配自定义域**，直接用默认项目站域名 `https://yancongya.github.io/BlendProof/`（账号下 `auto_tinify`、`iSparta-web`、`mac-dev-cleanup` 都走这个模式）。

**必须用 `branch` 模式，不能用 `docs` 模式。** 原因：Pages 的 `docs` 模式会把 `/docs` 整个目录作为站点根，那么 `docs/` 下的全部内部文档（部署细节、验收记录、产品约定、本设计文档）都会变成公网可直接访问的页面。`branch` 模式只发布指定的构建产物，内部文档不进站点。

```bash
<skill>/scripts/deploy-gh-pages-legacy.sh \
  --owner yancongya --repo BlendProof \
  --mode branch \
  --source-dir dist/landing \
  --include index.html --include app.js --include assets \
  --expect "<落地页静态 HTML 中真实存在的字符串>"
```

`branch` 模式会创建 `.nojekyll`，且**替换已存在的远端分支需要显式 `--force`**。首次部署前先跑 `--dry-run` 确认包含的文件范围。

前置条件与坑：

- 本机 `gh` 已登录 `yancongya`（keyring token，scopes 含 `repo`/`workflow`）✅
- **`--expect` 必须是静态 HTML 里真实存在的文本**，不能用只在 JS bundle 或 i18n 字典里的字符串——服务端返回的 HTML 里没有它，验证会超时并报 HTTP 200
- **沙箱可能 SIGKILL（exit 137）**：脚本在验证等待期会被内存上限杀掉，需后台运行再读日志
- **`gh` 与 SSH 是两套独立凭据**：本机能 push 不等于能配 Pages API
- Pages 只有一个 active source，**切换 source 前必须先问**，不能擅自替换

### 8.5 单一源与同步

落地页源码放**一个地方**——主仓库的 `landing/`。理由：落地页要 `import` 产品的 `BlenderLogo.tsx` 等组件、复用同一套 CSS token，只有同仓库才能真做到"不分叉"。

```
BlendProof/landing/                  ← 唯一源（React + R3F 源码）
        ↓ npm run build:landing
├── dist/landing/index.html          → Worker 的 /landing/
├── dist/landing/app.js                    （连同 assets/ 一起进 dist）
└── gh-pages 分支（branch 模式推送） → yancongya.github.io/BlendProof/
                                          只推产物；源码与 docs/ 不进 Pages
```

避免"两份手抄"导致漂移——这是 skill 反复强调的资产单一真源原则。

---

### 8.6 公开仓库前的清理清单

仓库一旦公开，全部 53 个 commit 的历史都可被克隆，因此清理必须同时覆盖**当前文件**与**历史版本**。

**已完成（当前文件）**

| 项 | 处理 |
|---|---|
| `wrangler.jsonc` 的 `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_NAME` | 已移除，改由 Cloudflare 控制台的 Worker 变量配置 |
| `docs/PHASE_4D_DEPLOYMENT_RECOVERY.md` 中"密钥保存在 NAS `已隐去`" | 已改为"密钥仅保存在 Cloudflare Secret 中" |
| 同文件"管理员 `admin@itycon.cn`，密码保存为…" | 已改为不含账号与存放位置的表述 |
| `.planning/STATE.md` 中"登录密码及 Worker 密钥只保存在 NAS `已隐去`" | 已同上改写 |

**未完成（git 历史）**

`git grep` 确认以下内容仍存在于历史 commit `1a4ad79` 与 `ce11f07` 中：

- `.planning/STATE.md:37`
- `docs/PHASE_4D_DEPLOYMENT_RECOVERY.md:3` 与 `:11`

本项目**从未配置 remote、从未推送**，所以重写历史不影响任何协作者。两个方案：

| 方案 | 做法 | 取舍 |
|---|---|---|
| **精确替换（推荐）** | `git filter-repo --replace-text` 或 `git filter-branch --tree-filter` 只替换上述字符串 | 保留 53 个 commit 的演进历史；需先提交当前改动（filter 要求工作区干净） |
| **压平历史** | `git checkout --orphan` 后重新提交为单一初始 commit | 一步彻底、无需额外工具；但丢失全部 commit 历史 |

**关于 `admin@itycon.cn` 的单独判断**：该邮箱在 `src/App.tsx:872` 的平台状态页、隐私政策与服务条款中**已主动向所有访问者公开**，用作联系邮箱。因此它在历史里出现不构成新的泄露。真正需要从历史移除的是 **`已隐去` 这个凭据存放位置**——它等于告诉攻击者去哪里找密码。

**清理后仍需注意**

- `wrangler.jsonc` 保留 D1 `database_id` 与 R2 `bucket_name`。二者是**标识符而非凭据**，无法用于访问（仍需 Cloudflare 账户凭据）。若连基础设施结构都不愿暴露，可将其移出仓库、改由本地配置或 CI 变量注入。
- 公开后定期确认 `dist/`、`dist-worker/`、`storage/`、`.dev.vars` 未被误提交（`.gitignore` 已覆盖，但新增路径时要复核）。

## 9. i18n 接口预留

老板要求"留有接口，到时候再补充"。本期只写一种语言，但结构上预留。

**做法**：所有可翻译文案走 `data-i18n` 属性，字典集中在一处，初始只填当前语言。

```html
<!-- 纯文本 -->
<h1 data-i18n="hero.title">原始工程，不出本机。</h1>

<!-- 含标签的文案，必须走 innerHTML 路径 -->
<p data-i18n-html="hero.lead">本机 Blender 转换，云端只收 <code>model.glb</code>。</p>

<script>
const messages = {
  "zh-CN": {
    "hero.title": "原始工程，不出本机。",
    "hero.lead": "本机 Blender 转换，云端只收 <code>model.glb</code>。"
  }
  // "en": { ... }  ← 后续补充，不改结构
};
</script>
```

**必须遵守的坑（skill 实战记录）**：含 HTML 标签的文案用 `data-i18n-html`（`innerHTML`），纯文本用 `data-i18n`（`textContent`）。**两种属性必须在同一代码路径上并行处理**——遗漏任何一种都会导致一端显示标签原文。审计方法：`grep` 所有 `data-i18n` 与 `data-i18n-html`，确认无遗漏。

**语言切换**：探测 `navigator.language`，回退到 `zh-CN`。切换按钮放在窗口嵌板的菜单栏里，与 Blender 的语言菜单位置一致。

---

## 10. 实现约束

`gh-pages-landing` 的校验器 `validate_page.py` 是**自包含检查**。已通读其源码，完整检查项如下——这些不是建议，是硬性失败条件：

**必需元素**

- `<html>`、`<head>`、`<body>`、`<title>`、`<main>`、`<h1>` 一个都不能少
- 必须有 `<meta name="viewport">`

**禁止的外部资源**

- `<script|img|iframe|video|audio|source>` 的 `src` 若为远程（带 scheme 或以 `//` 开头）→ 失败
- `<link rel="stylesheet">`、`<link rel="preload">`、`<link rel="modulepreload">` → **一律失败**，包括指向同目录的 `./styles.css`
- 相对路径的本地资源（`./app.js`、`./assets/x.png`）**允许**

**必须在 HTML 文本里出现的字符串**

- `prefers-reduced-motion`
- `:focus-visible`

校验器是用 grep 扫**原始 HTML 文本**找这两个串，所以它们必须出现在内联 `<style>` 或 HTML 里，放在外部 CSS 文件里不算。

**交互与可访问性**

- 任何 `class` 含 `copy` 的 `<button>` 必须有 `aria-label`
- 若存在 copy 按钮，HTML 里必须出现 `navigator.clipboard`

**JS 语法**

- 校验器用正则抽取**内联** `<script>…</script>` 的内容，交给 `node --check` 校验。外置引用（有 `src`）的脚本内容为空、不参与检查

**构建侧结论**

Vite 默认产物会同时踩中 `<link rel="stylesheet">` 和 `<link rel="modulepreload">` 两个禁止项，因此构建必须：CSS 内联、移除全部 preload/modulepreload、JS 输出为单个本地 `./app.js`。详细规格见第 6 节的"Hero 3D"小节。

```bash
python3 ~/.workbuddy/skills/gh-pages-landing/scripts/validate_page.py /path/to/index.html
```

### 可访问性验收

- 语义化标题层级、可见焦点、键盘可达
- **正文对比度 ≥4.5:1**。在 `--bg: #1d1d1d` 上实测各前景色：

  | 色值 | 对比度 | 可用范围 |
  |---|---|---|
  | `#eeeeee` | 14.53:1 | 任意字号 |
  | `#d8d8d8` | 11.83:1 | 任意字号（产品正文色） |
  | `#f39a35` | 7.61:1 | 任意字号 |
  | `#a9a9a9` | 7.17:1 | 任意字号 |
  | `#e87d0d` | 5.92:1 | 正文及以上（主强调色） |
  | `#8f8f8f` | 5.21:1 | 仅 ≥18px 或 ≥14px 粗体 |
  | `#777777` | **3.76:1** | **不达标，不得用于任何正文** |

  > 注意最后一个：`--dim: #777777` 在产品 UI 里用于 4 处小字（桌面应用语境可接受），但**落地页正文绝不能沿用**，这是照搬 token 时最容易踩的坑。
- 触控目标 ≥44px（注意：产品的 9–11px chrome 行高不足，交互元素需扩热区）
- 入场动画结束后测桌面 + 390px + 768px，检查溢出、裁切与 CTA 清晰度
- 复制按钮把精确内容放 `data-text`，带剪贴板降级

---

## 11. SEO 与可索引性

老板要求落地页可被搜索引擎索引。这对设计有实质约束，不是加几个 meta 就完事。

### 11.1 WebGL 内容对爬虫不可见（最关键）

**canvas 里渲染的一切——模型、文字、材质效果——搜索引擎都读不到**，爬虫只解析 HTML 文本。由此：

- hero 的核心卖点必须是**真实 HTML 文本**（`<h1>` + 导语），不能只存在于 3D 视觉里
- 第 2、4、5、6 屏每屏都要有可读的 HTML 文案，不能是"图片／Canvas + 无文字"
- 特性列表、保留策略数字、FAQ 全部用文本承载

这与第 6 节"把 `<h1>` 作为 LCP 元素"的方案**方向一致**——两项要求互相加强，不冲突。

### 11.2 双入口的重复内容问题

`blendproof.itycon.cn/landing/` 与 `yancongya.github.io/BlendProof/` 是同一份内容，搜索引擎会判定重复并稀释权重。必须声明正本：

```html
<link rel="canonical" href="https://blendproof.itycon.cn/landing/">
```

**canonical 指向生产入口**（主域、品牌一致、长期稳定）；GitHub Pages 那份作为镜像存在。

### 11.3 必需的基础设施

| 项 | 内容 |
|---|---|
| `robots.txt` | 允许抓取，`Sitemap:` 指向 sitemap 地址 |
| `sitemap.xml` | 至少含 `/landing/`，`lastmod` 随构建更新 |
| `<title>` | ≤60 字符，含核心词（Blender、3D 审稿） |
| `<meta name="description">` | ≤155 字符，写清"本机转换、云端只收 GLB"这个差异点 |
| Open Graph | `og:title`／`og:description`／`og:image`（可用 splash 图）／`og:url` |
| JSON-LD | `SoftwareApplication` 结构化数据，标注 `applicationCategory`、`operatingSystem`（macOS）、`offers`（免费） |
| `lang` | `<html lang="zh-CN">`；i18n 切换时同步更新 |

### 11.4 诚实性约束（与 SEO 的张力）

SEO 天然诱导夸大措辞，但第 1 节的三条红线不能破：无用户数、无评价、**当前仅支持 macOS**。meta description 与 OG 文案里不得出现"跨平台""多端支持"之类的表述。宁可少几个关键词，也不写与事实不符的话。

## 12. 决策记录与未决项

### 已定

| 决策项 | 结论 |
|---|---|
| 创意方向 | A《边界》 |
| 风格基线 | Blender 界面还原，参考已有 UI 组件 |
| 证明面 | 实拍 + mockup 面板混合 |
| 仓库 | **新建公开仓库 `BlendProof`**；落地页是项目内的一部分，不另建 landing 仓库 |
| 生产入口 | `blendproof.itycon.cn/landing/`，不用独立子域 |
| GitHub Pages | `yancongya.github.io/BlendProof/`，不配自定义域，**必须用 `branch` 模式**（避免 docs 模式暴露内部文档） |
| hero 3D | **R3F 实时渲染**；LCP 由 `<h1>` 文本承担，hero 全程是 3D，不做图片替换 |
| 第二强调色 | 启用 Blender logo 蓝 `#265787`；背景／描边用原色，文字必须用提亮版 `#5b9ee0` |
| SEO | **需要被索引**；canvas 内容不可索引，核心卖点必须落在 HTML 文本；双入口用 canonical 指向生产入口 |
| i18n | 留 `data-i18n` / `data-i18n-html` 接口，本期只写一种语言 |
| 视觉一致性 | 色值与几何 100% 照搬，尺度与节奏放开 |
| 安全清理 | 当前文件已清理；**git 历史待处理**，见 8.6 |

### 仍待确认

1. **git 历史怎么处理** —— 精确替换（保留 53 个 commit 的演进历史）还是压平为单一初始 commit？见 8.6。这是公开前的最后一道关卡，且两者都要求先提交当前改动。
2. **`/landing` 会不会被生产 Worker 的既有规则吞掉** —— `not_found_handling: "single-page-application"` 理论上不吃真实文件，但必须实测。
3. **`BlendProof` 仓库尚未创建** —— 需要在 GitHub 新建公开仓库并推送。
4. **hero 的低模占位用什么** —— 低面数猴头，还是纯线框？前者更接近最终观感，后者更轻。
5. **D1 ID 与 R2 bucket 名是否也要移出仓库** —— 它们是标识符而非凭据，但会暴露基础设施结构。


---

*设计基于 `gh-pages-landing` skill 的 Stage A–E 方法论；所有事实、色值、圆角、字号与组件类名均取自本项目源码，未使用任何外部素材或编造数据。*
