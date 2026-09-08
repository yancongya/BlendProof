# Viewer 阶段 0 运行基线

日期：2026-09-08  
运行入口：`npm run dev`，Web `http://127.0.0.1:5173`，API `http://127.0.0.1:8787`

## 固定参考职责

| 参考项目 | 用途 | 不直接采用的部分 |
| --- | --- | --- |
| Online3DViewer | 相机状态、导航、投影、拾取与模型装载的主参考 | 其完整网站外壳与格式导入器 |
| glTF-Sample-Viewer | GLB 相机、灯光、坐标读取正确性的交叉验证 | 产品 UI |
| BabylonJS | 仅用于评估成熟相机控制/选择的替换成本 | 不并行维护第二套产品 Viewer |
| model-viewer | 仅参考相机过渡和 AR/展示边界 | 不适合作为 Blender 式编辑导航内核 |

## 可重复资产

运行 `npm run create:viewer-fixtures` 可重新生成所有样例。

| 资产 | 文件相机 | 验证目的 |
| --- | --- | --- |
| `viewer-no-camera` | 0 | 默认视图与适配 |
| `viewer-single-camera` | 1，正面透视 | 文件相机稳定切换 |
| `viewer-multi-camera` | 2，低角度透视 + 顶部正交 | 相机枚举、投影和连续切换 |

已从 manifest 实测确认相机数为 0、1、2；多相机文件同时保留 `PERSP` 与 `ORTHO` 投影。`npm run check` 通过。

## 浏览器运行证据

三个样例已通过本地 API 上传并创建分享链接。对 `viewer-multi-camera` 的分享页进行桌面浏览器检查时：

- 分享页能读取场景名、7 个对象、源文件与 GLB 大小；Outliner 能列出“低角度透视相机”和“顶部正交相机”。
- 渲染画布保持空白，且顶部没有渲染后的文件相机按钮。
- 因此文件相机切换、正交/透视保持、点击选择、框选、局部视图和 Blender 导航均不能标记为通过。

这不是“相机切换看起来没变化”的判断问题，而是当前 React Three Fiber Viewer 的 GLB 运行时装载/呈现失败。阶段 1 必须先用这个多相机样例修复或替换内核装载路径，再验收相机状态；不要继续在现有 `BlenderViewControls` 上追加局部补丁。

## 阶段 1 输入

1. 先让 `viewer-multi-camera.glb` 在画布中可见，并断言两个文件相机控制出现。
2. 采用一个单一的成熟 Viewer 内核策略；以 Online3DViewer 的相机与导航模型为主参考。
3. 用三份固定样例按 `VIEWER_ACCEPTANCE_MATRIX.md` 逐项记录浏览器证据。
