# Phase 2 Plan 01 Summary: Anchored Review Comments

## Outcome

同一 Viewer 已支持模型表面批注、编号 pin、评论列表、正文编辑、解决/重开、相机状态重放和 token 只读分享。

## Browser Verification

- 从根页面真实上传 `simple-review-scene.blend`，点击模型表面创建“请检查顶部结构”，pin 与列表同时出现。
- 将正文改为“已修改的审稿意见”并解决；刷新根页面后项目、模型、正文和 resolved 状态仍存在。
- 移动相机后点击评论，回放后 300 ms 与 1200 ms 截图 SHA-256 完全一致，且与移动后截图不同。
- 隔离浏览器会话打开 `/s/:token`，读到同一评论和模型，添加、保存、编辑及解决入口数量均为 0。
- 分享页相机回放两张延时截图 SHA-256 完全一致，控制台 0 error、0 warning。

## API and Security Verification

- `npm run test:review-api`：5/5 通过，覆盖创建、读取、更新、非法输入、路径、token 分享与文件白名单。
- 分享响应与评论 DTO 不暴露 `projectId`，模型通过 token-scoped URL 读取。
- `/files/:projectId/source.blend` 与 `/files/:projectId/share.json` 均返回 404。
- 评论写入串行化且采用临时文件原子替换；非 ENOENT 存储错误不会被吞掉。

## Review

- Luna 分支实现 pin 组件、API 测试和浏览器验收矩阵。
- Sol 完成两轮只读审查；分享能力泄露、正交 zoom 重复和异步竞态均已修复。

## Next

进入阶段 3：用 SQLite 替换项目级 JSON 索引，加入 owner capability、分享密码、有效期和评论权限，不改变 Viewer repository 调用边界。
