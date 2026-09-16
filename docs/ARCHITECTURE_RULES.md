# BlendProof 前端架构规则

本文是**前端目录与依赖的强制约定**，配合 [`UX_OVERHAUL_AND_DECOUPLING.md`](UX_OVERHAUL_AND_DECOUPLING.md) 使用。

设计目标只有一条：**改一个功能，只需读 ≤ 5 个文件、≤ 600 行。**

`npm run check:arch` 会校验本文的规则，违反即失败。

---

## 1. 目录职责

```
src/
  app/        装配层：createRoot、路由判定、全局 ErrorBoundary
  pages/      路由级页面：只做装配与布局，不写业务规则
  features/   业务域：自治，自带 components/hooks/api/types/i18n/样式/测试
  shared/     跨域复用：无业务语义的 UI 原语、工具、http 封装、i18n 运行时
  styles/     全局 token 与基础样式
```

| 目录 | 允许放 | 禁止放 |
|---|---|---|
| `app/` | 入口、路由、全局边界 | 任何业务逻辑 |
| `pages/` | 组合 feature、传 props、布局 | 直接 fetch、业务规则、领域状态定义 |
| `features/` | 该领域的一切 | 引用其他 feature 的内部文件 |
| `shared/` | 无业务语义的通用能力 | 任何领域概念（如 `ReviewComment`） |
| `styles/` | 设计 token、reset、基础排版 | 单组件样式（就近放） |

## 2. 依赖方向

```
app  →  pages  →  features  →  shared
```

规则：

1. **只能向左依赖**，禁止反向。`shared/` 不得 import `features/` 或 `pages/`。
2. **feature 之间禁止互相 import**（含深路径）。需要协作时二选一：
   - 能力本身无业务语义 → 提升到 `shared/`
   - 有业务语义 → 由 `pages/` 层做编排，各自只暴露 props 与回调
3. **每个 feature 只有一个出口** `features/<name>/index.ts`。跨域引用必须走该出口，禁止 `features/a/components/X` 这类深引用。
4. `pages/` 不得 import `features/*/components/*` 等内部路径，只能用 `features/<name>`。

## 3. 文件行数预算

| 类型 | 软上限 | 硬上限 |
|---|---|---|
| `pages/*.tsx` | 200 | 250 |
| `features/*/components/*.tsx` | 150 | 200 |
| `features/*/hooks/use*.ts` | 120 | 150 |
| `features/*/api/*.ts`、`shared/**/*.ts` | 250 | 300 |
| `index.ts` 桶文件 | 40 | 60 |

超硬上限即必须拆分。**存量例外**在 §6 列出，只减不增。

## 4. 单一职责

1. 一个文件一个导出主体。组件文件不导出工具函数；工具放同目录 `*.logic.ts` 或 `shared/utils`。
2. 组件不写业务规则（判定、权限、状态机），规则放 hook 或 `*.logic.ts`，便于单测。
3. 动效与业务状态分离。动效代码不得持有业务状态。
4. 一个 `useState` 属于哪个域，就放在哪个域的 hook 里；页面层不持有领域状态。

## 5. 样式与测试就近

1. 组件样式与组件同目录（`Panel.tsx` + `panel.css`）。
2. **禁止**在全局 `overrides.css` 新增规则。该文件的存量规则按 §6 归位后清空。
3. 测试与代码同域：`features/review/__tests__/`。不建全局大测试文件。

## 6. 存量例外（只减不增）

以下文件超预算，必须在对应阶段的改造中拆解，**不得新增超限文件**：

| 文件 | 行数 | 拆解归属 | 计划 |
|---|---|---|---|
| `src/workspace/BlenderWorkspace.tsx` | 1370 | `features/viewer` + `features/outliner` + `features/properties` + `features/review` | 阶段 B/D 前置 |
| `landing/src/main.ts` | 1042 | `landing/src/modules/*` | 阶段 C 前置 |
| `src/api/blendProofClient.ts` | 787 | `shared/api` + 各 feature 的 `api/` | 阶段 B 期间 |
| `src/pages/WorkspacePage.tsx` | 760 | `pages/` 装配 + 各 feature hook | 阶段 E 前置 |
| `src/start/StartPage.tsx` | 665 | `pages/StartPage` + `features/auth` + `shared/ui` | 阶段 E 前置 |
| `src/workspace/Model.tsx` | 491 | `features/viewer` | 阶段 B/D 前置 |
| `src/i18n/en.ts` | 383 | 按命名空间拆到各 feature | 阶段 E |
| `src/overrides.css` | 见文件 | 按域归位 | 阶段 E（4.7） |

## 7. 新增代码的检查清单

提交前自查：

- [ ] 新文件没有超过 §3 的硬上限
- [ ] 没有 import 其他 feature 的内部路径
- [ ] 没有在 `overrides.css` 追加规则
- [ ] 组件里没有业务规则（已抽到 hook / logic）
- [ ] 跨域能力要么在 `shared/`，要么由 `pages/` 编排
- [ ] `npm run check:arch` 通过

---

## 附：规则演进

修改本文规则需同时更新 `scripts/check-architecture.mjs` 的校验逻辑，二者必须一致。
