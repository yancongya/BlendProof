/**
 * 相机取景与文件相机的计算。
 *
 * 从 BlenderViewControls 抽出：这里是纯几何计算（包围盒 → 距离 → 机位），
 * 和设备、指针、R3F 上下文都无关，独立出来才能单独推敲。
 *
 * 取景统一用包围盒半径的 2.4 倍距离：固定距离会在小模型上看太远、
 * 在大模型上看太近。
 */

import { Box3, Vector3, type Camera as ThreeCamera, type Object3D } from "three";
import type { CameraPreset } from "../../types";

/** 让相机框住整个场景，返回目标点与机位。 */
export function frameScene(
  scene: Object3D | null,
  preset: CameraPreset,
): { center: Vector3; position: [number, number, number] } {
  const bounds = scene ? new Box3().setFromObject(scene) : null;
  const empty = !bounds || bounds.isEmpty();
  const center = empty ? new Vector3() : bounds!.getCenter(new Vector3());
  const radius = empty ? 4 : Math.max(bounds!.getSize(new Vector3()).length() / 2, 1);
  const distance = radius * 2.4;
  const position: [number, number, number] =
    preset === "front"
      ? [center.x, center.y - distance, center.z]
      : preset === "right"
        ? [center.x + distance, center.y, center.z]
        : preset === "top"
          ? [center.x, center.y, center.z + distance]
          : [
              center.x + distance * 0.62,
              center.y - distance * 0.62,
              center.z + distance * 0.5,
            ];
  return { center, position };
}

/** 复制 .blend 内嵌相机并适配当前画布宽高比。 */
export function cloneFileCamera(
  source: ThreeCamera,
  size: { width: number; height: number },
): ThreeCamera {
  source.updateWorldMatrix(true, false);
  const fileCamera = source.clone() as ThreeCamera;
  source.getWorldPosition(fileCamera.position);
  source.getWorldQuaternion(fileCamera.quaternion);
  if (fileCamera.type === "PerspectiveCamera") {
    (fileCamera as ThreeCamera & { aspect: number }).aspect = size.width / size.height;
  }
  (fileCamera as ThreeCamera & { updateProjectionMatrix: () => void }).updateProjectionMatrix();
  return fileCamera;
}

/** 文件相机看向哪里：沿自身朝向 10 个单位，作为轨道控制的目标点。 */
export function fileCameraTarget(fileCamera: ThreeCamera): Vector3 {
  const forward = new Vector3(0, 0, -1).applyQuaternion(fileCamera.quaternion);
  return fileCamera.position.clone().add(forward.multiplyScalar(10));
}
