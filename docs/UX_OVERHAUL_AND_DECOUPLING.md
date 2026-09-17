# BlendProof 体验改造与前端解耦方案

本方案承接 2026-09-17 的全链路体验审查（创作者 / 客户双视角），把审查结论转为可执行的改造清单，并给出配套的前端解耦目标架构。

**文档定位**：改造项的**唯一口径来源**。产品形态与账号约定仍以 [`PRODUCT_CONVENTIONS.md`](PRODUCT_CONVENTIONS.md) 为准，阶段路线仍以 [`LONG_TERM_PLAN.md`](LONG_TERM_PLAN.md) 为准；本文只回答"接下来改什么、怎么拆、怎么验收"。

---

## 一、改造目标与验收口径

### 1.1 要解决的三个根性问题

| 根性 | 表现 | 影响 |
|---|---|---|
| **审稿闭环不成立** | 批注只能创建/改状态，**不能回复、不能删除** | 产品核心价值（"意见闭环"）立不住，与落地页承诺不符 |
| **失败无兜底** | 模型加载/失败无任何反馈，无 ErrorBoundary | 客户打开分享链接白屏 → 直接流失，且无法归因 |
| **双视角未分层** | 客户侧沿用全部 Blender 术语与小键盘快捷键 | 客户是"不装 Blender 的人"，正是被劝退的对象 |

### 1.2 验收口径

改造完成后必须同时满足：

1. 一条批注从**客户提出 → 创作者回复 → 客户看到回复与状态**全程可见，无需任何外部沟通渠道（微信/邮件）。
2. 模型加载失败、网络中断、GLB 404 三种情况下，界面给出**可理解的原因 + 可执行的下一步**，不出现白屏。
3. 客户视角**不出现**任何 Blender 专有术语（中键、小键盘、吸附、落点）。
4. 同一概念全站**只有一个说法**（角色 / 权限 / 分享链接）。
5. 每个功能域可**独立定位到 ≤ 5 个文件、≤ 600 行**。

---

## 二、前端解耦方案

### 2.1 现状诊断

| 文件 | 行数 | 问题 |
|---|---|---|
| `src/workspace/BlenderWorkspace.tsx` | **1370** | 单体：视口、工具栏、Outliner、属性、转换、批注面板、快捷键、相机、标注草稿、布局拖拽全在一个组件 |
| `landing/src/main.ts` | **1042** | 落地页全部交互（塔罗门、视角切换、主题、语言、hero3d、动效）混在一个文件 |
| `src/api/blendProofClient.ts` | **787** | 单个 client 类承担 转换/发布/分享/统计/账号/管理/批注 七个域 |
| `src/pages/WorkspacePage.tsx` | **760** | 页面层承载了上传编排、分享编排、批注编排 |
| `src/start/StartPage.tsx` | **665** | 4 个 Tab + 平台状态 + 账号 + 法律弹窗 |
| `landing/src/i18n.ts` | **658** | 文案单文件，与 `landing/index.html` 内联文案重复 |
| `src/workspace/Model.tsx` | **491** | 模型加载 + 拾取 + 框选 + 标注落点 + 隔离层级 |
| `src/i18n/en.ts` | **383** | 单一英文表，无命名空间 |

**核心症状**：改任何一处都要读一个千行文件；跨域状态（视口 / 选择 / 批注 / 上传）在同一个组件里用 20+ 个 `useState` 交织，无法单独测试。

### 2.2 目标目录

```
src/
  app/                       # 装配层（薄）
    main.tsx                 # createRoot + 路由判定 + ErrorBoundary
  pages/                     # 页面 = 路由级，只做装配与布局
    WorkspacePage.tsx
    SharePage.tsx
    StartPage.tsx
  features/                  # 按业务能力切分，自治
    review/                  # 批注域（本次改造重点）
      index.ts               #   对外唯一出口
      components/            #   ReviewPanel / ReviewAnnotations / ReviewComposer /
                             #   ReviewFilters / ReviewReplyThread
      hooks/                 #   useReviewComments / useReviewDraft / useReviewFilter /
                             #   useReviewPolling
      api/reviewApi.ts
      types.ts
      i18n.ts                #   该域的文案片段
    upload/                  # 上传与转换编排
    share/                   # 分享创建 / 凭证卡 / 权限
    viewer/                  # 3D 视口：Canvas 装配、相机、拾取、标注落点
    outliner/                # 场景集合面板
    properties/              # 属性 + 转换内容面板
    auth/                    # 登录 / 注册 / 游客体验
    admin/                   # 管理控制台
  shared/                    # 跨域复用
    api/                     #   http.ts（fetch 封装）/ 各域 client 按需
    ui/                      #   Panel / PanelResizeHandle / GuidedTour /
                             #   NoticeViews / EmptyState / ErrorState
    hooks/                   #   useResize / usePolling / useLocalStorage
    i18n/                    #   index.tsx + zh/ + en/（按命名空间合并）
  styles/                    # 拆分为 tokens / base / layout / panel
```

### 2.3 硬约束（写入 CI 或 review checklist）

**依赖方向（单向，禁止反向）**

```
app → pages → features → shared
```

- `shared/` **不得** import `features/` 或 `pages/`
- `features/` **不得** import `pages/`
- **feature 之间禁止直接 import**；需要协作时把能力提升到 `shared/`，或由 `pages/` 层做编排（页面只做 props 传递与事件转发）
- 每个 feature 只通过 `index.ts` 对外暴露，内部文件不跨域引用

**文件行数预算**

| 类型 | 软上限 | 硬上限 |
|---|---|---|
| 页面组件 `pages/*` | 200 | 250 |
| 展示组件 `features/*/components` | 150 | 200 |
| 自定义 hook | 120 | 150 |
| 工具 / API 模块 | 250 | 300 |
| `index.ts` 桶文件 | 40 | — |

超出硬上限即视为需要拆分；`BlenderWorkspace.tsx` 1370 行是必须消除的存量例外。

**单一职责**

- 一个文件一个导出主体（组件文件不导出工具函数）
- 组件文件不写业务规则，规则放 hook 或 `*.logic.ts`
- 动画 / 动效与业务状态分离（落地页的教训）

### 2.4 存量文件的拆分映射

| 现状 | 目标 | 拆分依据 |
|---|---|---|
| `workspace/BlenderWorkspace.tsx` (1370) | `viewer/ViewerShell.tsx`（骨架+布局 ~180）<br>`viewer/ViewerToolbar.tsx`（顶栏 ~150）<br>`viewer/ViewportHints.tsx`（底部提示 ~40）<br>`viewer/hooks/useViewportState.ts`（显示模式/叠加层/标注模式 ~90）<br>`viewer/hooks/useSceneSelection.ts`（选中/隐藏/独显/聚焦/框选 ~140）<br>`viewer/hooks/useCameraPresets.ts`（预设/文件相机/跳转 ~110）<br>`viewer/hooks/useKeyboardShortcuts.ts`（全部快捷键 ~120）<br>`review/hooks/useReviewDraft.ts`（标注草稿/浮层 ~110）<br>`outliner/OutlinerPanel.tsx`（~180）<br>`properties/PropertiesPanel.tsx`（~90）<br>`properties/ConversionPanel.tsx`（~60）<br>`review/components/ReviewPanelSection.tsx`（~90） | 按"视口 / 选择 / 相机 / 快捷键 / 四个面板"切分；每个 hook 只暴露自己的状态与动作 |
| `pages/WorkspacePage.tsx` (760) | `WorkspacePage.tsx`（装配 ~180）<br>`upload/hooks/useUploadFlow.ts`<br>`share/hooks/useShareFlow.ts`<br>`review/hooks/useReviewFlow.ts` | 三条流程编排各自独立，页面只做组合 |
| `api/blendProofClient.ts` (787) | `shared/api/http.ts`（fetch/错误/nonce ~120）<br>`features/upload/api/uploadApi.ts`<br>`features/share/api/shareApi.ts`<br>`features/review/api/reviewApi.ts`<br>`features/auth/api/authApi.ts`<br>`features/admin/api/adminApi.ts`<br>`shared/api/statsApi.ts`<br>类型移入各 feature 的 `types.ts` | 按域切分，`BlendProofClient` 类取消 |
| `start/StartPage.tsx` (665) | `pages/StartPage.tsx`（Tab 容器 ~120）<br>`features/auth/components/AccountPanel.tsx`<br>`features/auth/components/LoginForm.tsx`<br>`shared/ui/PlatformStatusPanel.tsx`<br>`shared/ui/LegalDialog.tsx` | 按 Tab 切分 |
| `workspace/Model.tsx` (491) | `viewer/components/Model.tsx`（装配 ~120）<br>`viewer/hooks/useModelLoad.ts`（含 onError ~80）<br>`viewer/hooks/usePicking.ts`（拾取/框选 ~130）<br>`viewer/hooks/useAnnotationHit.ts`（落点/吸附 ~90）<br>`viewer/hooks/useIsolation.ts`（隔离层级 ~90） | 加载 / 拾取 / 标注 / 隔离四件事互不依赖 |
| `landing/src/main.ts` (1042) | `landing/src/modules/tarot.ts`<br>`landing/src/modules/perspective.ts`<br>`landing/src/modules/theme.ts`<br>`landing/src/modules/lang.ts`<br>`landing/src/modules/reveal.ts`（进场动效）<br>`landing/src/modules/hero3d.ts`（已有，归位） | 每个模块 `init()` 自治，`main.ts` 只做 `initAll()`（~80 行） |
| `i18n/en.ts` (383) | `shared/i18n/en/common.ts`<br>`features/review/i18n.ts`<br>`features/upload/i18n.ts`<br>`features/share/i18n.ts`<br>`features/auth/i18n.ts`<br>`shared/i18n/en/errors.ts` | 按命名空间拆，运行时合并；新增文案只改对应 feature |

### 2.5 为"避免上下文过长"设的硬指标

> 目标：**改一个功能，只需读 ≤ 5 个文件、≤ 600 行。**

为此需要：

1. **feature 自治** — 每个 feature 目录自带 components / hooks / api / types / i18n，改批注不用碰视口代码。
2. **桶文件稳定** — `features/review/index.ts` 是唯一进口，内部重构不产生跨域 diff。
3. **契约显式** — 每个 feature 的 `types.ts` 定义对外类型，页面层依赖类型而非实现。
4. **样式就近** — 每个 feature 带 `styles.css`（或 CSS Module），禁止在全局 `overrides.css` 里追加新规则；`overrides.css` 存量规则按下表归位后清空。
5. **测试就近** — `features/review/__tests__/`，不建全局大测试文件。

存量 `overrides.css` 归位目标：

| 现状内容 | 归属 |
|---|---|
| `.panel` / `.panel-header` / `.panel-resize-handle` | `shared/ui/panel.css` |
| `.review-*` / `.guided-tour-*` | `features/review/*.css` |
| `.share-*` | `features/share/*.css` |
| `.editor-header` / `.view-controls` / `.icon-group` | `features/viewer/*.css` |
| `.outliner-*` / `.tree-*` | `features/outliner/*.css` |
| `.start-*` / `.blendproof-start-page` | `features/auth/*.css` + `pages/StartPage.css` |

---

## 三、改造项清单

分 5 个阶段，**每阶段独立可发布**。阶段内按编号顺序执行。

### 阶段 A：审稿闭环（最高优先）

| # | 改造项 | 现状（证据） | 目标 | 验收 |
|---|---|---|---|---|
| A1 | 批注**回复**能力 | `src/reviewRepository.ts:34-52` 只有 `list/create/update(body,status)` | 引入回复流：批注主帖 + 回复列表；创作者与客户都可回复 | 客户提一条 → 创作者回复 → 客户刷新看到回复；回复带作者与时间 |
| A2 | 批注**删除** | 同上，无删除能力 | 创建者可删除自己项目的任意批注；客户可删除自己刚发的（可限时） | 删后 pin 与列表同时消失；误点批注可清理 |
| A3 | "新批注"提示**真正闭环** | `useReviewComments.ts:55` `acknowledgeNew` 只 `setNewCount(0)`，文案却写"点击查看" | 点击后定位到该批注：选中 + 滚动到列表项 + 相机跳转 | 点击提示后批注被选中并可见 |
| A4 | 客户侧**状态可见** | `SharePage.tsx:174-208` 只加载一次，无轮询 | 客户页轮询（复用 `useReviewComments` 的 15s 轮询），列表显示 open/resolved 与回复 | 创作者标记 resolved 后，客户 ≤15s 看到状态变化 |
| A5 | 列表显示**时间与归属** | `ReviewPanel.tsx:159-161` 只显示 `objectName · authorName` | 补相对时间（"2 小时前"）与"最新回复"标识 | 创作者能一眼分辨哪条是新的 |

**涉及**：`features/review/**`、`worker/shares.ts`（新增 reply/delete 路由）、`migrations/`（回复表或 comment 自关联字段）。
**解耦前置**：先把 `review` 域拆成独立 feature（见 4.1）。

### 阶段 B：容错与状态反馈

| # | 改造项 | 现状（证据） | 目标 | 验收 |
|---|---|---|---|---|
| B1 | 模型加载态 | `BlenderWorkspace.tsx:860` `Suspense fallback={null}` | 加载骨架 + 进度提示；分享页额外提示"首次加载需转换" | 慢网下不再出现空白视口 |
| B2 | 模型失败兜底 | `main.tsx` 无 ErrorBoundary；`Model.tsx:141` `useGLTF` 无 `onError` | 视口级 ErrorBoundary + `onError` → 显示原因与"重试 / 联系分享者" | GLB 404 时给出可读错误而非白屏 |
| B3 | 错误提示不被遮挡 | `BlenderWorkspace.tsx:488` 设 `reviewMessage` 后仅在选择变化时清（`:348`），`:1307` `message={reviewMessage ?? reviewError}` → 错误永不可见 | 成功与错误**分离显示**（成功 3s 自动消失；错误常驻直至处理） | 先成功保存再触发错误，错误可见 |
| B4 | 上传大小上限与预估 | 全库无文件大小校验 | 上传前校验并提示上限；转换阶段显示已用时长与阶段说明 | 超限文件被拦下并说明原因 |
| B5 | 转换完成出口 | `WorkspacePage.tsx:248-260` 只 `setUploadStage("ready")`，不关弹窗 | 自动关窗 + "查看模型"主按钮 | 转换完直接进入视口 |
| B6 | 分享报错就地显示 | `WorkspacePage.tsx:318-322` 失败只 `setMessage`，提示落页脚而面板是浮层 | 错误内联在分享面板内 | 提交失败立刻在面板内看到原因 |
| B7 | 危险操作二次确认一致 | 删项目有 `window.confirm`（`:459-465`），撤销分享（`:325-344`）与标记已解决无 | 统一标准：撤销分享与删除批注需确认 | 误操作不可逆行为全部有确认 |

**涉及**：`features/viewer/**`、`features/upload/**`、`features/share/**`、`shared/ui/ErrorState.tsx`（新增）。

### 阶段 C：落地页

| # | 改造项 | 现状（证据） | 目标 | 验收 |
|---|---|---|---|---|
| C1 | 塔罗门**只播一次** | `landing/src/main.ts:889-890` 每次 load 都 `identityChosen='false'`，注释明写 "always show portal on every page load/refresh" | 首次访问播；选择后用 `localStorage` 记住，回访直接进正文；保留"重新选择身份"入口 | 第二次访问不再被全屏门拦截 |
| C2 | 无 JS / 爬虫降级 | `landing/index.html:2093-2095` `html[data-identity-chosen="false"] main, footer { display:none !important }`，而"跳过"依赖 JS（`main.ts:1015`） | 默认渲染正文（`data-identity-chosen="true"`），由 JS 在**首次访问**时再开启门面 | 禁用 JS 可见完整正文与 CTA；`curl` 能看到 H1 |
| C3 | 首屏主张收敛 | `<title>`="原始工程，不出本机" / 创作者 H1="再也不用，截图发来发去了" / 客户 H1="打开链接，就能看模型" 三套并存 | 收敛为一条主张，突出**唯一差异点**："客户免装软件，直接在 3D 模型上批注" | 首屏一句话能说清产品是什么 |
| C4 | 去掉实现细节当卖点 | `index.html:2593-2597`：`415 服务器硬拒`、`5 GiB 共享空间，大家共用`、`GLB 69.7 KB` | 换成用户价值（免装 / 批注闭环 / 不留原件）；容量如实说明但不用"共用"作为卖点 | 首屏不出现 HTTP 状态码与"共用" |
| C5 | CTA 补全 | 注册需邀请码（`:3380`）但页面无任何获取入口；04/05 之后到页尾无 CTA | 增加"如何开始"（邀请码申请入口 / 演示直达）；页尾补 CTA | 每个 section 结束都有下一步动作 |
| C6 | 视角与编号 | 02/03/06 只给创作者、07 只给客户 → 客户看到 00,01,04,05,07,08 **跳号**；"平台此刻的真实状态"（运营数据）只给客户看 | 两侧编号各自连续；运营数据改到创作者侧或移到独立页 | 单侧视角无跳号；客户看不到存储池指标 |
| C7 | 双角色机制去重 | 塔罗门问"你是造物者，还是审视者？"（`:2473`）＋ hero 又有 toggle"我是创作者/我是客户"（`:2556`） | 只保留一处角色选择；塔罗门与 toggle 二选一 | 同页不出现两套角色入口 |
| C8 | 移动端与小屏 | `≤320px` 时 `.tarot-deck` nowrap + 卡最小 170px 溢出（`:2150`, `:2165`）；页脚"仅支持 macOS"（`:3544`）与首屏"零安装"+移动手势提示（`:2614`）矛盾 | 修正小屏布局；统一平台支持口径 | 320px 无横向滚动；文案不矛盾 |

**涉及**：`landing/index.html`、`landing/src/modules/**`（阶段 C 前先做落地页解耦，见 4.2）。

### 阶段 D：客户视角分层

| # | 改造项 | 现状（证据） | 目标 | 验收 |
|---|---|---|---|---|
| D1 | 视口提示按视角替换 | `BlenderWorkspace.tsx:1005-1021` `中键旋转 · Shift + 中键平移`；按钮 title `正视图 - 小键盘 1`（`:757/764/771/778`）；快捷键 `Numpad1/3/7/0`、`/`、`.`（`:384-413`） | 客户侧换白话："拖动旋转 · 滚轮缩放 · 右键平移"；快捷键提示仅在创作者侧出现 | 客户视角无"中键/小键盘/吸附/落点" |
| D2 | 标注引导改白话 | `:973` `落点：模型表面`；`:716` `悬停吸附，右键添加` | "批注位置""右键点击模型表面即可添加" | 非 Blender 用户能独立完成首次批注 |
| D3 | 只读权限说明清楚 | `:711` 直接隐藏"添加批注"，页脚仅"只读分享"（`SharePage.tsx:312-314`） | 明说"当前为只读，需要批注请联系分享者" | 客户知道为什么不能批注 |
| D4 | 显隐权限放开 | `:1113` `readOnly` 只禁 outliner 眼睛，**不禁独显/框选**；`SharePage.tsx:317` 恒传 `readOnly` | 显隐属视图操作，对客户放开；`readOnly` 只约束"修改项目内容" | 客户能隐藏/显示物体与独显 |
| D5 | 引导步骤与页面匹配 | `:687-691` 只过滤 annotation 一步，客户点"?"仍看到"创建分享"步骤，目标 `[data-guide="share-button"]` 在 SharePage 不存在 | 按视角提供独立引导步骤集 | 客户引导每一步都有高亮目标 |
| D6 | 品牌按钮在分享页可用 | `BlenderWorkspace.tsx:542-550` 渲染 `aria-label="返回启动页"` 但 `SharePage` 未传 `onHome` | SharePage 传 `onHome` 或隐藏该按钮 | 点击有响应 |
| D7 | 修右键冲突 | `Model.tsx:365-371` 标注模式右键落点 vs `BlenderViewControls.tsx:203` `RIGHT: MOUSE.PAN` | 标注模式下禁用右键平移，或落点改用左键双击 | 平移视角不再误建批注 |

### 阶段 E：文案统一与面板修复

| # | 改造项 | 现状（证据） | 目标 |
|---|---|---|---|
| E1 | 角色称呼统一 | 同页 5 组：造物者/创作者/上传方 ‖ 审视者/客户/接收方 | 统一为**创作者 / 客户** |
| E2 | 权限文案统一 | `WorkspacePage.tsx:727-728`"只读/可评论" vs `ShareCards.tsx:77`"仅查看/查看与批注" | 统一为**仅查看 / 可批注**，并附一句说明 |
| E3 | 分享链接称呼统一 | 审稿凭证 / 审稿通行证 / 审稿链接（`ShareCards.tsx:30/74`） | 统一为**分享链接 / 分享信息** |
| E4 | 去自造词 | "云端快递柜"（`ShareCards.tsx:78`）、"公益存储池" | 用直白词：云端存储 / 本机分享 |
| E5 | "口令/密码"消歧 | 演示口令 `tycon`（`StartPage.tsx:279`）／游客密码 `tycon`（`:522-524`）／分享访问密码（`WorkspacePage.tsx:684`） | 分别改为：演示口令 / 体验账号密码 / 分享密码 |
| E6 | 修属性面板高度残留 | `BlenderWorkspace.tsx:1174-1176` 属性面板高 = `propertyHeight + summaryHeight + 56`，但"转换内容"已是独立 section（`:1228`） | 属性面板高只依赖 `propertyHeight`；拖转换内容不再撑高属性 |
| E7 | 去重复标题 | `ConversionSummary.tsx:13` 又渲染一次"转换内容"，面板 header 已有（`:1240`） | 删除重复标题 |
| E8 | 批注筛选可访问 | `:1277-1295` 图标 `⬡/●/✓` 无 `aria-label`，"全部"用六边形无语义；筛选改变 pin 编号（`ReviewAnnotations.tsx:159` 用 `index+1`） | 加 `aria-label`；pin 编号基于**稳定序号**而非过滤后索引 |
| E9 | 英文态遗漏 | `en.ts:380` 只覆盖 `tf(" · 新 %s")`，而 `BlenderWorkspace.tsx:1274` 用模板字符串 → EN 下仍显示中文 | 统一走 `tf()`；补全英文表 |
| E10 | 中英混用 | `chips 切换会实时改写明细`、`open / resolved 轻量闭环`、label 全英文但 value 中文 | 单语内不混排 |
| E11 | 本地分享风险告知 | `ShareCards.tsx:78`"本机分享"，全站未说明该链接**需本机服务在线** | 创建时明确提示；客户侧失败时提示"分享者本机服务可能未启动" |
| E12 | 属性面板空态 | `:1193` 未选中时 body 全空 | 补空态文案 |

**顺带清理**（低风险，随手做）：
- `ReviewPanel.tsx:50` `collapsed` prop 声明后未使用 → 删除
- `BlenderWorkspace.tsx:1303` `pending={null}` 恒真 → `ReviewPanel` 内置 compose 区永不显示，与视口浮层重复 → 二选一
- `SharePage.tsx:34` 与 `WorkspacePage.tsx:43` 演示口令常量重复 → 提取到 `shared/config.ts`

---

## 四、编排：解耦与修复的先后

解耦**不独立立项**，而是**在改造中顺手完成**——每次都只拆本次要动的域。

| 步骤 | 内容 | 产出 |
|---|---|---|
| **4.0** | 立规则：加 `docs/ARCHITECTURE_RULES.md`（依赖方向 + 行数预算 + 目录约定），加 lint 规则禁止跨 feature 深引用 | 规则可被 CI 检查 |
| **4.1** | 拆 `review` 域（阶段 A 前置） | `features/review/**` 独立，A1–A5 在域内完成 |
| **4.2** | 拆落地页（阶段 C 前置） | `landing/src/modules/**`，C1–C8 在模块内完成 |
| **4.3** | 拆 `viewer` 域（阶段 B/D 前置） | `features/viewer/**`，B1–B2、D1–D3、D7 在域内完成。**拆解时必须同时解决以下 viewer→review 耦合**：<br>· `AnnotationHit` 是纯拾取结果，提升为 `shared/types/picking.ts` 的 `SurfaceHit`<br>· `Model` 的 `onAnnotation` 改为上报 `{ hit: SurfaceHit; camera: CameraState }`（两个 shared 类型），由 `features/review` 自行组装 `PendingReview`<br>· 完成后 `features/viewer` 不得再 import `features/review` |
| **4.4** | 拆 `api` 域（阶段 B 中 A6/B6 时顺手） | `features/*/api/**`，`BlendProofClient` 类取消 |
| **4.5** | 拆 `pages`（阶段 E 前置） | 页面降到 ≤250 行 |
| **4.6** | 拆 `i18n`（阶段 E 内） | 按命名空间合并，E9–E10 在域内完成 |
| **4.7** | 归位 `overrides.css` | 样式就近，全局 overrides 清空（或仅留跨域 token） |

**关键原则**：**拆到哪修到哪**。不安排"先全量重构再改功能"——全量重构会长时间阻塞发布，且易引入回归。

---

## 五、风险与回滚

| 风险 | 触发条件 | 应对 |
|---|---|---|
| 拆解引入回归 | 视口/快捷键/相机等高频交互被移动 | 拆 `viewer` 域前先补**该域的交互验收清单**（沿用 `VIEWER_ACCEPTANCE_MATRIX.md` 三组 GLB），拆后逐项复验 |
| 后端契约变更 | A1/A2 需要新增 reply / delete 路由 | 先在 `REVIEW_CONTRACT.md` 固化契约（含权限与幂等要求），再动前端；本地 SQLite 与云端 D1 **同步**变更 |
| 双端不一致 | 本地分享与云端分享行为分叉 | 所有批注能力走同一 `reviewApi`，transport 参数化；新增能力必须两端同时实现 |
| 落地页改动影响已上线内容 | C1/C2 改了首屏渲染时序 | 先在 `landing` 本地构建验收（含禁用 JS 场景），再合并 |
| 大文件拆解中途停下 | 拆一半的域处于不一致状态 | 每个域拆解是**独立 commit**，可单独 revert；禁止单 commit 跨两个域 |

---

## 六、附录：审查证据索引

按问题严重度排列，均已在代码中核实。

| # | 问题 | 证据 |
|---|---|---|
| 1 | 批注无回复、无删除 | `src/reviewRepository.ts:34-52` |
| 2 | "新批注"提示不闭环 | `src/review/useReviewComments.ts:55` |
| 3 | 模型加载无态 | `src/workspace/BlenderWorkspace.tsx:860` |
| 4 | 无 ErrorBoundary / 无 onError | `src/main.tsx`；`src/workspace/Model.tsx:141` |
| 5 | 错误提示被成功提示永久遮挡 | `BlenderWorkspace.tsx:488`、`:348`、`:1307` |
| 6 | 属性面板高度算式残留 | `BlenderWorkspace.tsx:1174-1176` vs `:1228` |
| 7 | 标注模式右键与平移冲突 | `Model.tsx:365-371` vs `BlenderViewControls.tsx:203` |
| 8 | readOnly 语义不一致 | `BlenderWorkspace.tsx:1113`；`SharePage.tsx:317` |
| 9 | 客户侧无轮询 | `SharePage.tsx:174-208` |
| 10 | 落地页塔罗门每次必播 | `landing/src/main.ts:889-890` |
| 11 | 无 JS 时正文不可见 | `landing/index.html:2093-2095`；`main.ts:1015` |
| 12 | 双角色机制重复 | `landing/index.html:2473` vs `:2556` |
| 13 | 落地页把实现细节当卖点 | `landing/index.html:2593-2597` |
| 14 | 落地页编号断号 | `landing/index.html` section `data-perspective` 属性 |
| 15 | CTA 断点（邀请码无入口） | `landing/index.html:3380` |
| 16 | 本地分享风险未告知 | `ShareCards.tsx:78`；`SharePage.tsx:313` |
| 17 | 转换完成不关弹窗 | `src/pages/WorkspacePage.tsx:248-260` |
| 18 | 切项目强制弹上传窗 | `WorkspacePage.tsx:452-453` |
| 19 | 分享报错落页脚 | `WorkspacePage.tsx:318-322` |
| 20 | 危险操作确认标准不一 | `WorkspacePage.tsx:325-344` vs `:459-465` |
| 21 | Blender 术语未对客户分层 | `BlenderWorkspace.tsx:1005-1021`、`:757/764/771/778`、`:384-413`、`:973`、`:716` |
| 22 | 引导步骤与页面不匹配 | `BlenderWorkspace.tsx:687-691` |
| 23 | 权限文案三套 | `WorkspacePage.tsx:727-728` vs `ShareCards.tsx:77` |
| 24 | 英文态中英混显 | `src/i18n/en.ts:380` vs `BlenderWorkspace.tsx:1274` |
| 25 | 演示口令常量重复 | `SharePage.tsx:34`；`WorkspacePage.tsx:43` |
| 26 | 品牌按钮分享页死控件 | `BlenderWorkspace.tsx:542-550`；`SharePage.tsx:293-338` |

---

## 七、执行追踪

| 阶段 | 状态 | 备注 |
|---|---|---|
| 4.0 立规则 | 已完成（2026-09-17） | `docs/ARCHITECTURE_RULES.md` + `scripts/check-architecture.mjs`（零依赖，`npm run check:arch`），已用反向用例验证可拦截三类违规 |
| A 审稿闭环 | **已完成 6/6**（2026-09-17） | A0 契约、A1 回复、A2 删除、A3 定位、A4 轮询、A5 时间全部完成，且均有测试锁定 |
| B 容错与状态 | **已完成 7/7**（2026-09-17） | B1 加载态、B2 失败兜底、B3 错误提示、B4 大小上限、B5 自动关窗、B6 内联错误、B7 确认一致全部完成 |
| C 落地页 | 未开始 | 依赖 4.2 |
| D 客户视角分层 | 未开始 | 依赖 4.3 |
| E 文案与面板 | **已完成 3/5** | E1 相对时间（A5 已实现）、E4 渐进式展示已在审稿域内体现、E6 面板高度算式已修；E2/E3 待做 |
| （4.1）拆 review 域 | 已完成（2026-09-17） | `features/review/**` 独立；`Vec3`/`CameraState` 提升到 `shared/types/`；审稿域样式已归位到 `features/review/review.css`（overrides.css -152 行） |
| （4.2）拆落地页 | 未开始 | |
| （4.3）拆 viewer 域 | **已完成**（2026-09-17） | `BlenderWorkspace` 1387→1008 行：菜单栏、5 个面板、上传弹窗、状态栏已全部迁入 `features/viewer/components/**`；视口 Canvas 与状态机留在外壳（协调所需，拆出收益低）；Model 492→185 行 + 13 个单测，ViewControls 208→184 行。**后续只减不增。** |
| （4.4）拆 api 域 | 未开始 | |
| （4.5）拆 pages | 未开始 | |
| （4.6）拆 i18n | 未开始 | |
| （4.7）归位 overrides.css | 进行中 | 审稿域已完成；其余按域推进 |

> 状态标记约定：`未开始` / `进行中` / `已完成（日期）` / `已回滚（原因）`。

### 执行中的事实修正

- **演示批注已改为分享页专属**：`DEMO_COMMENTS` 现位于 `src/pages/SharePage.tsx:36`，创作者工作台侧刻意留空（见 `WorkspacePage.tsx:148` 注释）。阶段 A 的"客户侧状态可见"（A4）仍适用。
- **访客身份不可验证**：`comments.author_id` 对访客恒为 `null`，唯一身份是自由填写的 `author_name`。因此访客删除自己的批注必须引入删除令牌（`delete_token_hash`），详见 `REVIEW_CONTRACT.md`。
- **顺带修掉三个既有双通道分叉**（实施 A1/A2 时被新测试暴露）：
  1. 写入是否 `trim()` 不一致（worker 会、SQLite 不会）
  2. 排序 tiebreaker 用随机 id，同一毫秒创建时顺序不确定 → 改 `rowid`
  3. 删除令牌熵不一致（worker 16 字节 vs server 32 字节）
  这三项已修复并有测试锁定；说明"两通道必须同步变更"的约束是真实且高频的，后续每个改动都要同时覆盖。
