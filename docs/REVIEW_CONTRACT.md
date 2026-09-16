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
  authorType: 'owner' | 'guest'
  status: 'open' | 'resolved'
  createdAt: string
  updatedAt: string
  /** 列表响应中始终省略；仅在创建者自己的创建响应里返回一次 */
  replies: ReviewReply[]
}

interface ReviewReply {
  id: string
  commentId: string
  body: string
  authorName: string
  authorType: 'owner' | 'guest'
  createdAt: string
}
```

**回复不带锚点。** 回复继承所属评论的 `position` / `normal` / `camera`，因此存储在独立表，不占用 `comments` 的 `NOT NULL` 锚点列。一条评论必须对应模型上的一个 pin，回复只是该 pin 下的对话。

## 作者身份与删除令牌

访客批注的 `author_id` 为 `null`，唯一身份是客户端自由填写的 `authorName` —— **无法据此判定归属**。因此删除权限按下述方式实现：

- `comments.delete_token` / `comment_replies.delete_token`：仅当 `author_type = 'guest'` 时写入一个随机令牌。
- 访客创建评论或回复时，响应中**只向创建者本人返回一次** `deleteToken`；客户端存入 `localStorage`（键 `bp-review-tokens`，映射 `<commentId|replyId> -> token`）。
- 列表响应**永不返回** `delete_token`，否则任何拿到分享链接的人都能删除他人批注。
- 删除请求必须携带令牌，服务端做常量时间比较。

**不设删除时间窗。** 作者删除自己的批注是正当行为（例如误点、重复、已解决后清理），与创建者的删除权限对等。审稿留痕不属现阶段目标（见 `PRODUCT_CONVENTIONS.md` 的“轻量审稿闭环”）。

## 接口契约

### 创建者通道（需 owner capability）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:projectId/comments` | 列出评论（含内联 `replies`） |
| POST | `/api/projects/:projectId/comments` | 创建评论 |
| PATCH | `/api/projects/:projectId/comments/:commentId` | 改 `body` / `status` |
| **DELETE** | `/api/projects/:projectId/comments/:commentId` | **删除评论（级联删除其回复）** |
| **POST** | `/api/projects/:projectId/comments/:commentId/replies` | **新增回复** |
| **DELETE** | `/api/projects/:projectId/comments/:commentId/replies/:replyId` | **删除回复** |

### 访客通道（需分享 `comments_permission = 'comment'`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/shares/:token/comments` | 创建评论（响应含 `deleteToken`） |
| **DELETE** | `/api/shares/:token/comments/:commentId` | **删除自己的评论**（需令牌） |
| **POST** | `/api/shares/:token/comments/:commentId/replies` | **新增回复**（响应含 `deleteToken`） |
| **DELETE** | `/api/shares/:token/comments/:commentId/replies/:replyId` | **删除自己的回复**（需令牌） |

### 权限矩阵

| 操作 | 创建者 | 访客（可批注） | 访客（只读） |
|---|---|---|---|
| 查看评论与回复 | ✅ | ✅ | ✅ |
| 创建评论 | ✅ | ✅ | ❌ |
| 创建回复 | ✅ | ✅ | ❌ |
| 改正文 / 改状态 | ✅ | ❌ | ❌ |
| 删除评论 | ✅ 任意 | ⚠️ 仅自己（需令牌） | ❌ |
| 删除回复 | ✅ 任意 | ⚠️ 仅自己（需令牌） | ❌ |

**访客不得改状态。** `open`/`resolved` 是审稿方的裁决，只能由创建者变更；否则客户可以自行把意见标记为已解决。

### 令牌传递

删除请求通过请求头传递，不放进 URL：

```
X-BlendProof-Delete-Token: <token>
```

缺失或不匹配一律返回 `403`，且**不区分“不存在”与“无权限”**（避免探测他人批注 id）。

### 幂等与重复

- 重复 DELETE 同一评论：第二次返回 `204`（不报错），避免客户端重试产生噪音。
- 回复的 `POST` 不做去重；同一正文可多次回复。

## 行为合同

1. 创建者先进入“添加批注”模式，再点击模型表面；普通导航/选择状态下不得误建评论。
2. 射线只命中模型 Mesh，忽略批注 pin、灯光、相机和辅助 UI。
3. `position` 保存命中的世界坐标；`normal` 转换到世界空间并朝向当前相机，pin 沿法线轻微偏移以避免闪烁。
4. 创建评论时同时保存当前活动相机和 OrbitControls target；点击评论时恢复投影、位置、四元数、target、fov/zoom。
5. pin 采用 Billboard，在缩放时保持近似固定屏幕尺寸；选中 pin 与选中评论列表必须是同一个状态。
6. 上传/项目页允许创建、编辑、解决、回复、删除；`/s/:token` 按分享权限开放查看，以及（当权限为 `comment` 时）创建、回复与删除自己的内容。
7. 评论不能只存本地 React 状态。阶段 2 可先使用项目级 JSON API 合同，阶段 3 无损迁移到 SQLite。
8. **标注模式下不得用右键平移视角。** 右键已被“落点”占用，平移需改用中键或显式导航模式，避免误建批注。
9. **删除评论必须级联删除其回复**，不得留下孤儿回复。
10. **访客不能看到 `deleteToken`**，除非该令牌是自己创建时收到的。

## 迁移

新增 D1 / SQLite 迁移 `0010_comment_replies.sql`：

```sql
CREATE TABLE comment_replies (
  id TEXT PRIMARY KEY NOT NULL,
  comment_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  body TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'owner'
    CHECK (author_type IN ('owner', 'guest')),
  delete_token TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX comment_replies_comment_created_idx
  ON comment_replies(comment_id, created_at, id);

ALTER TABLE comments ADD COLUMN delete_token TEXT;
```

说明：

- 删除评论时依赖 `ON DELETE CASCADE` 清理回复；**D1 需显式开启外键**，否则用应用层事务删除。
- 本地 SQLite 与 D1 必须同时应用该迁移，避免两条通道行为分叉。

## 组件边界

- `ReviewAnnotations`：渲染 pin、选择 pin，不负责持久化。
- `AnnotationPlacement`：管理批注模式、模型射线和表面命中。
- `ReviewPanel`：列表、编辑、解决状态与“回到视角”。
- `ReviewReplyThread`：单条评论下的回复列表与回复输入。
- `ReviewCameraController`：捕获和恢复相机状态，与文件相机/预设相机共用同一 active camera。
- `ReviewRepository`：隐藏 JSON、SQLite 与 D1 的差异，统一暴露评论与回复的读写。

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

## 回复与删除验收

- 访客回复创建者的评论，创建者刷新后能看到回复及其作者与时间。
- 创建者回复后，访客在分享页能看到回复（≤1 个轮询周期）。
- 创建者删除一条评论，其回复与 3D pin 一并消失。
- 访客用本机 `localStorage` 中的令牌能删除自己刚发的评论；清掉 `localStorage` 后不能删除（返回 403）。
- 访客尝试删除他人评论：返回 403，且响应不泄漏该评论是否存在。
- 访客尝试用 `PATCH` 改状态：返回 403。
- 重复 DELETE 同一评论：第二次返回 204。
