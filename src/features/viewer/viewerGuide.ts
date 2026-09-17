/**
 * 视图域操作指南步骤。
 *
 * 从 BlenderWorkspace 抽出：这只是一份常量数据，混在 1400 行的组件里
 * 会让人误以为它参与了渲染逻辑。
 */

import type { GuidedTourStep } from "../../components/GuidedTour";

export const VIEWER_GUIDE_STEPS: GuidedTourStep[] = [
  {
    id: "file",
    title: "打开 Blender 文件",
    description: "从文件菜单选择 .blend，文件会先在本机转换。",
    target: '[data-guide="file-menu"]',
    placement: "bottom",
    group: "开始",
  },
  {
    id: "viewport",
    title: "操作 3D 视图",
    description: "中键旋转，Shift + 中键平移，滚轮缩放；空白区域取消选择。",
    target: '[data-guide="viewport"]',
    placement: "right",
    group: "视图",
  },
  {
    id: "outliner",
    title: "查看场景结构",
    description: "在 Outliner 中选择对象、控制显隐，按 / 可独显。",
    target: '[data-guide="outliner"]',
    placement: "left",
    group: "场景",
  },
  {
    id: "annotation",
    title: "添加批注",
    description:
      "进入标注模式，悬停模型表面查看吸附点，右键在当前视角位置创建批注。",
    target: '[data-guide="annotation-tool"]',
    placement: "bottom",
    group: "审稿",
  },
  {
    id: "share",
    title: "创建分享",
    description: "选择只读或可评论，设置密码和有效期后复制链接给客户。",
    target: '[data-guide="share-button"]',
    placement: "bottom",
    group: "协作",
  },
];
