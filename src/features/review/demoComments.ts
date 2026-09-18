/**
 * 演示批注数据。
 *
 * 工作区（无项目的猴头演示）与分享页（`/s/suzanne`）共用同一份，
 * 这样「本地看到什么、远程就是什么」，不会因为页面不同而漂移。
 * 三条数据刻意覆盖三种形态：待处理、已解决（含回复闭环）、无对象名的整体评价。
 */

import type { ReviewComment } from "./types";

export const DEMO_SHARE_TOKEN = "suzanne";
export const DEMO_SHARE_PASSWORD = "tycon";

export const DEMO_COMMENTS: ReviewComment[] = [
  {
    id: "demo-1",
    projectId: "demo",
    objectName: "苏珊娜",
    position: [0, 0.5, 1.2],
    normal: [0, 0, 1],
    camera: {
      projection: "perspective",
      position: [0, 0, 3],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
    },
    body: "头顶多边形密度偏高，建议减面以降低 Web 端渲染负担。",
    authorName: "张工",
    authorType: "guest",
    status: "open",
    createdAt: "2026-09-14T10:30:00Z",
    updatedAt: "2026-09-14T10:30:00Z",
    replies: [],
  },
  {
    id: "demo-2",
    projectId: "demo",
    objectName: "苏珊娜",
    position: [0.8, 0.2, 0.3],
    normal: [1, 0, 0],
    camera: {
      projection: "perspective",
      position: [2, 1, 2],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
    },
    body: "右耳边缘法线翻转，渲染时出现黑色伪影。",
    authorName: "李审核",
    authorType: "guest",
    status: "resolved",
    createdAt: "2026-09-13T15:12:00Z",
    updatedAt: "2026-09-14T09:00:00Z",
    // 演示闭环：客户提出 → 创作者回复 → 标记已解决，双方都能看到全过程。
    replies: [
      {
        id: "demo-2-reply-1",
        commentId: "demo-2",
        body: "已确认是右耳法线方向反了，重算后发现同样影响左耳内侧，一并修好了。",
        authorName: "平台管理员",
        authorType: "owner",
        createdAt: "2026-09-13T18:40:00Z",
      },
    ],
  },
  {
    id: "demo-3",
    projectId: "demo",
    objectName: null,
    position: [0, -0.3, 0.8],
    normal: [0, -1, 0],
    camera: {
      projection: "perspective",
      position: [0, 0.5, 3],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
    },
    body: "整体模型质量不错，可直接用于审稿演示。",
    authorName: "阿烟",
    authorType: "guest",
    status: "open",
    createdAt: "2026-09-15T08:00:00Z",
    updatedAt: "2026-09-15T08:00:00Z",
    replies: [],
  },
];

/**
 * 深拷贝一份演示数据。
 *
 * `replies` 与几何字段都是嵌套结构，浅拷贝会让本地新增的回复污染模块级常量，
 * 造成「刷新后演示数据被改过」的假象。
 */
export function cloneDemoComments(): ReviewComment[] {
  return structuredClone(DEMO_COMMENTS);
}
