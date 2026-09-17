/**
 * Model — 把 GLTF 场景挂进 R3F 树，并把交互事件翻译成上层能懂的回调。
 *
 * 已按职责拆出（见 ARCHITECTURE_RULES 行数预算）：
 *   - modelPicking.ts        节点名与 three 对象的对应
 *   - modelAppearance.ts     显示模式 / 显隐 / 独显 / 选中高亮
 *   - modelInteraction.ts    指针事件 → 表面命中与相机快照
 *   - AnnotationHoverMarker  悬停吸附点
 *   - BoxSelectionController 框选
 *
 * 本文件不再依赖 review 域：落点只上报 SurfaceHit + CameraState，
 * 「批注草稿」由调用方组装。
 */

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import type { Camera as ThreeCamera, Object3D } from "three";
import { blendProofClient } from "../../../api/blendProofClient";
import type { DisplayMode, ShadingMode } from "../../../types";
import type { CameraState } from "../../../shared/types/camera";
import type { Vec3 } from "../../../shared/types/geometry";
import type { SurfaceHit } from "../../../shared/types/picking";
import { applyModelAppearance } from "../modelAppearance";
import {
  cameraStateFromCamera,
  screenFromEvent,
  surfaceHitFromEvent,
} from "../modelInteraction";
import {
  collectIsolationHierarchy,
  collectSelectedInScene,
  hasRenderableMesh,
} from "../modelIsolation";
import { objectIdentity, selectableAncestorName } from "../modelPicking";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export function Model({
  url,
  hidden,
  displayMode,
  shadingMode,
  selected,
  isolated,
  onIsolationInvalid,
  selectableNames,
  onObjectClick,
  onCameras,
  onSceneReady,
  annotationMode,
  hoveredName,
  navigationTarget,
  onHoverAnnotation,
  onAnnotation,
}: {
  url: string;
  hidden: Set<string>;
  displayMode: DisplayMode;
  shadingMode: ShadingMode;
  selected: Set<string>;
  isolated: boolean;
  onIsolationInvalid: () => void;
  selectableNames: Set<string>;
  onObjectClick: (name: string | null) => void;
  onCameras: (cameras: ThreeCamera[]) => void;
  onSceneReady: (scene: Object3D) => void;
  annotationMode: boolean;
  hoveredName: string | null;
  navigationTarget: Vec3;
  onHoverAnnotation: (hit: SurfaceHit | null) => void;
  onAnnotation: (
    hit: SurfaceHit,
    camera: CameraState,
    screen: { x: number; y: number },
  ) => void;
}) {
  const { camera } = useThree();
  const requestHeaders = useMemo(
    () => blendProofClient.assetRequestHeaders(url),
    [url],
  );
  const gltf = useGLTF(url, true, true, (loader) =>
    loader.setRequestHeader(requestHeaders),
  );
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  const selectedInScene = useMemo(
    () => collectSelectedInScene(scene, selected),
    [scene, selected],
  );

  const isolationHierarchy = useMemo(
    () => collectIsolationHierarchy(scene, selected, selectedInScene),
    [scene, selected, selectedInScene],
  );

  // 过期的 outliner 名字不能让本地视图变成空场景。
  const hasRenderableIsolation = useMemo(
    () => hasRenderableMesh(isolationHierarchy),
    [isolationHierarchy],
  );
  const effectiveIsolation = isolated && selectedInScene.size > 0 && hasRenderableIsolation;

  useEffect(() => {
    if (
      isolated &&
      selected.size > 0 &&
      (selectedInScene.size === 0 || !hasRenderableIsolation)
    )
      onIsolationInvalid();
  }, [hasRenderableIsolation, isolated, onIsolationInvalid, selected.size, selectedInScene]);

  useEffect(() => {
    const cameras: ThreeCamera[] = [];
    scene.traverse((node) => {
      if ((node as ThreeCamera).isCamera) cameras.push(node as ThreeCamera);
    });
    onCameras(cameras);
    onSceneReady(scene);
  }, [onCameras, onSceneReady, scene]);

  useEffect(() => {
    applyModelAppearance(scene, {
      displayMode,
      shadingMode,
      hidden,
      selected,
      isolationHierarchy,
      effectiveIsolation,
      hoveredName,
    });
  }, [
    displayMode,
    shadingMode,
    effectiveIsolation,
    hidden,
    isolationHierarchy,
    scene,
    selected,
    hoveredName,
  ]);

  const resolveSelectableNode = (object: Object3D | null) => {
    let node = object;
    while (node && !selectableNames.has(objectIdentity(node))) node = node.parent;
    return node;
  };

  const placeAnnotation = (event: any) => {
    if (!annotationMode || !event.point) return false;
    event.stopPropagation();
    const hit = surfaceHitFromEvent(event, camera, resolveSelectableNode);
    if (!hit) return false;
    onAnnotation(hit, cameraStateFromCamera(camera, navigationTarget), screenFromEvent(event));
    return true;
  };

  return (
    <primitive
      object={scene}
      onPointerMove={(event: any) => {
        if (!annotationMode) return;
        onHoverAnnotation(surfaceHitFromEvent(event, camera, resolveSelectableNode));
      }}
      onPointerOut={() => onHoverAnnotation(null)}
      onPointerDown={(event: any) => {
        if (
          annotationMode &&
          (event.button === 2 || event.nativeEvent?.button === 2)
        )
          placeAnnotation(event);
      }}
      onClick={(event: any) => {
        event.stopPropagation();
        if (annotationMode) return;
        const node = resolveSelectableNode(event.object);
        onObjectClick(node ? objectIdentity(node) : null);
      }}
    />
  );
}
