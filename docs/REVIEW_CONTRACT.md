# BlendProof 审稿数据合同

## 参考结论

BlendProof 采用 Open3DInspection 的“世界坐标落点 + 世界法线”作为锚点基础，并采用 Share 的“标记与评论分离、评论可链接到稳定视角”原则。参考代码只用于确定边界，不复制其完整 UI、账户或 GitHub issue 流程。

## 最小数据结构

```ts
type Vec3 = [number, number, number]

interface ReviewCameraState {
  projection: 'perspective' | 'orthographic'
  position: Vec3
  quaternion: [number, number, number, number]
  target: Vec3
  fov?: number
  zoom?: number
  orthographicHeight?: number
}

interface ReviewComment {
  id: string
  projectId: string
  objectName: string | null
  position: Vec3
  normal: Vec3
  camera: ReviewCameraState
  body: string
  authorName: string
  status: 'open' | 'resolved'
  createdAt: string
  updatedAt: string
}
```

## 行为合同

1. 创建者先进入“添加批注”模式，再点击模型表面；普通导航/选择状态下不得误建评论。
2. 射线只命中模型 Mesh，忽略批注 pin、灯光、相机和辅助 UI。
3. `position` 保存命中的世界坐标；`normal` 转换到世界空间并朝向当前相机，pin 沿法线轻微偏移以避免闪烁。
4. 创建评论时同时保存当前活动相机和 OrbitControls target；点击评论时恢复投影、位置、四元数、target、fov/zoom。
5. pin 采用 Billboard，在缩放时保持近似固定屏幕尺寸；选中 pin 与选中评论列表必须是同一个状态。
6. 上传/项目页允许创建、编辑、解决；`/s/:token` 默认只读，只允许查看并重放。阶段 3 再根据分享权限开放访客评论。
7. 评论不能只存本地 React 状态。阶段 2 可先使用项目级 JSON API 合同，阶段 3 无损迁移到 SQLite。

## 组件边界

- `ReviewAnnotations`：渲染 pin、选择 pin，不负责持久化。
- `AnnotationPlacement`：管理批注模式、模型射线和表面命中。
- `ReviewPanel`：列表、编辑、解决状态与“回到视角”。
- `ReviewCameraController`：捕获和恢复相机状态，与文件相机/预设相机共用同一 active camera。
- `ReviewRepository`：隐藏 JSON 与后续 SQLite 的差异。

## 参考文件

- `temp/3D-Review-Research/03-review/Open3DInspection/src/types.ts`
- `temp/3D-Review-Research/03-review/Open3DInspection/src/lib/raycastAnnotate.ts`
- `temp/3D-Review-Research/03-review/Open3DInspection/src/components/Annotations3D.tsx`
- `temp/3D-Review-Research/03-review/Open3DInspection/src/components/Scene.tsx`
- `temp/3D-Review-Research/03-review/Share/src/Infrastructure/PlaceMark.js`
- `temp/3D-Review-Research/03-review/Share/src/Components/Notes/hashState.js`

## 首轮验收

- 创建者在模型表面建立一个评论，pin 与列表同时出现。
- 移动镜头后点击评论，恢复到保存时的视角且不闪回。
- 刷新项目页后评论仍存在。
- 新浏览器会话打开分享链接，可看到同一 pin 和正文但没有编辑入口。
- 点击 pin 不会穿透并选择其后的模型，也不会产生第二个评论。
