/**
 * 演示项目常量。
 *
 * 工作区（无项目的猴头演示）与分享页（`/s/suzanne`）共用同一份模型与清单，
 * 避免两处各写一份、改一处漏一处。批注数据属于审稿域概念，见
 * `features/review/demoComments.ts`。
 */

import type { Manifest } from "../types";

export const DEFAULT_MONKEY_MODEL_URL = "/default-monkey.glb";

export const DEFAULT_MONKEY_MANIFEST: Manifest = {
  scene: "Suzanne 演示",
  camera: null,
  cameras: [],
  objects: [{ name: "苏珊娜", type: "MESH", collections: ["Collection"] }],
  collections: ["Collection"],
  materials: ["Material"],
  export: { glbBytes: 69708, objectCount: 1 },
};
