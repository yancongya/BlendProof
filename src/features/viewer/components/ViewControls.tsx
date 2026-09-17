/**
 * BlenderViewControls — OrbitControls wrapper that implements Blender-style
 * middle-drag orbit, Shift+middle-drag pan, and camera preset / review-camera
 * playback.
 *
 * Also exports captureCameraState (pure function, also in utils.ts but
 * re-exported here for co-location convenience).
 */

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  Box3,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  type Camera as ThreeCamera,
  type Object3D,
} from "three";
import type { CameraPreset } from "../../../types";
import { cloneFileCamera, fileCameraTarget, frameScene } from "../cameraPresets";
import type { CameraState } from "../../../shared/types/camera";
import type { Vec3 } from "../../../shared/types/geometry";
import { captureCameraState } from "../../../utils";

export type { CameraState };

export function BlenderViewControls({
  preset,
  fileCameras,
  scene,
  onTargetChange,
  reviewCameraRequest,
  focusRequest,
  onViewStateChange,
}: {
  preset: CameraPreset;
  fileCameras: ThreeCamera[];
  scene: Object3D | null;
  onTargetChange: (target: Vec3) => void;
  reviewCameraRequest: { camera: CameraState; nonce: number } | null;
  focusRequest: { names: string[]; nonce: number } | null;
  onViewStateChange?: (camera: CameraState) => void;
}) {
  const { camera, gl, set, size } = useThree();
  const controls = useRef<any>(null);
  const navigationCamera = useRef<ThreeCamera | null>(null);
  if (!navigationCamera.current) navigationCamera.current = camera;

  useEffect(() => {
    const source = preset.startsWith("file:")
      ? fileCameras.find((item) => item.uuid === preset.slice(5))
      : undefined;
    if (source) {
      const fileCamera = cloneFileCamera(source, size);
      set({ camera: fileCamera as never });
      if (controls.current) {
        controls.current.object = fileCamera;
        controls.current.target.copy(fileCameraTarget(fileCamera));
      }
    } else {
      const activeCamera = navigationCamera.current!;
      set({ camera: activeCamera as never });
      if (controls.current) controls.current.object = activeCamera;
      const { center, position } = frameScene(scene, preset);
      activeCamera.position.set(...position);
      controls.current?.target.copy(center);
      activeCamera.lookAt(center);
      (activeCamera as ThreeCamera & { updateProjectionMatrix: () => void }).updateProjectionMatrix();
    }
    controls.current?.update();
    if (controls.current) onTargetChange(controls.current.target.toArray() as Vec3);
  }, [fileCameras, onTargetChange, preset, scene, set, size]);

  useEffect(() => {
    if (!reviewCameraRequest) return;
    const saved = reviewCameraRequest.camera;
    const aspect = size.width / size.height;
    const replayCamera: ThreeCamera =
      saved.projection === "orthographic"
        ? new OrthographicCamera(
            -(saved.orthographicHeight ?? 10) * aspect * 0.5,
            (saved.orthographicHeight ?? 10) * aspect * 0.5,
            (saved.orthographicHeight ?? 10) * 0.5,
            -(saved.orthographicHeight ?? 10) * 0.5,
            0.01,
            10000,
          )
        : new PerspectiveCamera(saved.fov ?? 45, aspect, 0.01, 10000);
    replayCamera.position.fromArray(saved.position);
    replayCamera.quaternion.fromArray(saved.quaternion);
    if ((replayCamera as OrthographicCamera).isOrthographicCamera)
      (replayCamera as OrthographicCamera).zoom = saved.zoom ?? 1;
    (replayCamera as PerspectiveCamera | OrthographicCamera).updateProjectionMatrix();
    set({ camera: replayCamera as any });
    if (controls.current) {
      controls.current.object = replayCamera;
      controls.current.target.fromArray(saved.target);
      controls.current.update();
    }
    onTargetChange(saved.target);
  }, [onTargetChange, reviewCameraRequest, set, size.height, size.width]);

  useEffect(() => {
    if (!focusRequest || !scene || !controls.current) return;
    const bounds = new Box3();
    let found = false;
    const wanted = new Set(focusRequest.names);
    scene.traverse((node) => {
      if (!wanted.has(node.name)) return;
      const nodeBounds = new Box3().setFromObject(node);
      if (!nodeBounds.isEmpty()) {
        bounds.union(nodeBounds);
        found = true;
      }
    });
    if (!found || bounds.isEmpty()) return;
    const activeCamera = controls.current.object as ThreeCamera;
    const center = bounds.getCenter(new Vector3());
    const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.1);
    const direction = activeCamera.position.clone().sub(controls.current.target).normalize();
    if ((activeCamera as OrthographicCamera).isOrthographicCamera) {
      const orthographic = activeCamera as OrthographicCamera;
      const height = Math.abs(orthographic.top - orthographic.bottom);
      orthographic.zoom = Math.max(0.01, height / (radius * 2.4));
      orthographic.updateProjectionMatrix();
    } else {
      const perspective = activeCamera as PerspectiveCamera;
      const distance =
        (radius / Math.tan((perspective.fov * Math.PI) / 360)) * 1.25;
      activeCamera.position.copy(center).add(direction.multiplyScalar(distance));
    }
    controls.current.target.copy(center);
    controls.current.update();
    onTargetChange(center.toArray() as Vec3);
  }, [focusRequest, onTargetChange, scene]);

  useEffect(() => {
    const current = controls.current;
    if (!current) return;
    const onChange = () => {
      const target = current.target.toArray() as Vec3;
      onTargetChange(target);
      if (onViewStateChange)
        onViewStateChange(captureCameraState(current.object as ThreeCamera, target));
    };
    current.addEventListener("change", onChange);
    return () => current.removeEventListener("change", onChange);
  }, [onTargetChange, onViewStateChange]);

  useEffect(() => {
    const element = gl.domElement;
    const chooseMiddleAction = (event: PointerEvent) => {
      if (!controls.current || event.button !== 1) return;
      // OrbitControls reverses ROTATE/PAN when a modifier is present. Keep
      // Shift on ROTATE so its internal modifier branch yields PAN; invert
      // only Ctrl/Meta so they keep Blender's ordinary MMB rotation.
      controls.current.mouseButtons.MIDDLE =
        !event.shiftKey && (event.ctrlKey || event.metaKey)
          ? MOUSE.PAN
          : MOUSE.ROTATE;
    };
    const restoreMiddleAction = () => {
      if (controls.current) controls.current.mouseButtons.MIDDLE = MOUSE.ROTATE;
    };
    element.addEventListener("pointerdown", chooseMiddleAction, true);
    window.addEventListener("pointerup", restoreMiddleAction);
    return () => {
      element.removeEventListener("pointerdown", chooseMiddleAction, true);
      window.removeEventListener("pointerup", restoreMiddleAction);
    };
  }, [gl]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      mouseButtons={{ LEFT: undefined, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN }}
    />
  );
}
