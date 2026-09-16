/**
 * 相机状态快照。
 *
 * 这是一个通用的 3D 视图概念：viewer 用它恢复视角，review 用它把批注锚定到
 * 稳定视角。两个域都需要它，因此位于 shared，且名字不带领域前缀。
 *
 * 线上的字段名仍为 `camera`（见 docs/REVIEW_CONTRACT.md）。
 */

import type { Vec3 } from "./geometry";

export type CameraState = {
  projection: "perspective" | "orthographic";
  position: Vec3;
  quaternion: [number, number, number, number];
  target: Vec3;
  fov?: number;
  zoom?: number;
  orthographicHeight?: number;
};
