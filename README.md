# BlendProof

本地运行的 Blender 审稿原型。原始 `.blend` 和派生 GLB 都仅保存在当前电脑。

## 当前闭环

1. 在网页中选择 `.blend`。
2. 本机 Blender 在后台导出 `model.glb` 和 `manifest.json`。
3. 浏览器加载 GLB，支持轨道查看与按对象开关可见性。
4. 同一 Web 的 `/s/<token>` 路由可读取本地分享的模型。

## 运行

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。API 运行在 `http://localhost:8787`。

默认优先使用 Steam Blender；如需指定其他版本：

```bash
BLENDER_BIN="/Applications/Blender.app/Contents/MacOS/Blender" npm run dev:server
```

## 本地数据

- 上传后的原始文件、GLB 和 manifest 位于 `storage/projects/<项目 ID>/`。
- `test-assets/` 只用于开发验证，不参与项目运行时存储。

## 创建与验证简易测试场景

```bash
npm run create:test-blend
```

这会创建 `test-assets/simple-review-scene.blend`，其中包含两个网格、地面、灯光和相机，不依赖 Geometry Nodes。导入后点击“创建本地测试分享”，再在同一个站点打开生成的 `/s/<token>` 链接，即可验证客户侧的只读加载。

## 已验证的测试边界

`test-assets/zhuzhiliao_geometry_nodes_substep_core.blend` 可以成功完成导出及网页加载。
该文件的 Simulation Zone 在 Blender 后台模式不能求值，因而部分 Stub 网格会被原生 glTF 导出器省略。产品下一阶段应把这类告警提取为转换报告，并提供前台 Blender 导出或“已烘焙模型”作为替代路径。
