/**
 * 指针事件 → 世界空间命中 / 相机快照。
 *
 * 从 Model.tsx 抽出：法线计算在「落点」与「悬停吸附」两处完全重复，
 * 而且容易写错方向（法线要朝向当前相机，否则落点提示会埋在模型里）。
 */

import { Matrix3, Vector3, type Camera as ThreeCamera, type Object3D } from "three";
import type { CameraState } from "../../shared/types/camera";
import type { Vec3 } from "../../shared/types/geometry";
import type { SurfaceHit } from "../../shared/types/picking";
import { objectIdentity } from "./modelPicking";

/** R3F 指针事件里我们真正用到的字段。 */
export type SurfacePointerEvent = {
  point?: Vector3 | null;
  face?: { normal: Vector3 } | null;
  object?: Object3D | null;
  nativeEvent?: { offsetX?: number; offsetY?: number };
  clientX?: number;
  clientY?: number;
};

/**
 * 计算表面命中点与法线。
 * 法线统一翻转到朝向相机的一侧，透视与正交相机都适用。
 */
export function surfaceHitFromEvent(
  event: SurfacePointerEvent,
  camera: ThreeCamera,
  resolveNode: (object: Object3D | null) => Object3D | null,
): SurfaceHit | null {
  if (!event.point) return null;
  const normal = event.face?.normal
    ? event.face.normal
        .clone()
        .applyMatrix3(new Matrix3().getNormalMatrix(event.object!.matrixWorld))
        .normalize()
    : new Vector3().copy(camera.position).sub(event.point).normalize();
  const towardCamera = new Vector3().copy(camera.position).sub(event.point).normalize();
  if (normal.dot(towardCamera) < 0) normal.negate();
  const node = resolveNode(event.object ?? null);
  return {
    position: event.point.toArray() as Vec3,
    normal: normal.toArray() as Vec3,
    objectName: node ? objectIdentity(node) : null,
  };
}

/** 事件在视口中的像素位置，用于定位批注输入浮层。 */
export function screenFromEvent(event: SurfacePointerEvent) {
  return {
    x: event.nativeEvent?.offsetX ?? event.clientX ?? 0,
    y: event.nativeEvent?.offsetY ?? event.clientY ?? 0,
  };
}

/** 当前相机与导航目标的可复现快照。 */
export function cameraStateFromCamera(
  camera: ThreeCamera,
  target: Vec3,
): CameraState {
  const perspective = (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera;
  const values = camera as ThreeCamera & {
    fov?: number;
    zoom?: number;
    top?: number;
    bottom?: number;
  };
  return {
    projection: perspective ? "perspective" : "orthographic",
    position: camera.position.toArray() as Vec3,
    quaternion: camera.quaternion.toArray() as [number, number, number, number],
    target,
    ...(perspective
      ? { fov: values.fov }
      : {
          zoom: values.zoom,
          orthographicHeight: (values.top ?? 0) - (values.bottom ?? 0),
        }),
  };
}
