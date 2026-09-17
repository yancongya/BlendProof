/**
 * 模型表面拾取结果。
 *
 * 纯几何数据，不含业务语义：viewer 用它做吸附与落点反馈，
 * review 用它构造批注锚点。两个域都需要，因此位于 shared。
 */

import type { Vec3 } from "./geometry";

export type SurfaceHit = {
  position: Vec3;
  normal: Vec3;
  objectName: string | null;
};
