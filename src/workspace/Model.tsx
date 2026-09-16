/**
 * Model — Three.js GLTF scene node that handles:
 *   - material display mode (material / gray / wire) and flat/smooth shading
 *   - selection highlight (orange emissive)
 *   - isolation (Blender-style local view)
 *   - annotation raycast (right-click to place a comment)
 *   - camera collection
 *
 * BoxSelectionController — rubber-band selection using pointer events on the
 * Canvas DOM element.
 *
 * AnnotationHoverMarker — orange sphere + ring that snaps to the hovered
 * surface during annotation mode.
 *
 * selectableAncestorName / belongsToAnySelected / objectIdentity — pure
 * scene-graph helpers.
 */

import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  Box3,
  DoubleSide,
  Matrix3,
  Vector3,
  type Camera as ThreeCamera,
  type Object3D,
} from "three";
import { blendProofClient } from "../api/blendProofClient";
import type { DisplayMode, ShadingMode, SelectionBox } from "../types";
import type { AnnotationHit, PendingReview } from "../features/review";
import type { Vec3 } from "../shared/types/geometry";

// ---------------------------------------------------------------------------
// objectIdentity / selectableAncestorName / belongsToAnySelected
// ---------------------------------------------------------------------------

export function objectIdentity(node: Object3D) {
  return typeof node.userData?.name === "string" && node.userData.name
    ? node.userData.name
    : node.name;
}

export function selectableAncestorName(
  node: Object3D,
  selectableNames: Set<string>,
): string | null {
  let current: Object3D | null = node;
  while (current) {
    const identity = objectIdentity(current);
    if (selectableNames.has(identity)) return identity;
    current = current.parent;
  }
  return null;
}

export function belongsToAnySelected(node: Object3D, selected: Set<string>) {
  let current: Object3D | null = node;
  while (current) {
    if (selected.has(objectIdentity(current))) return true;
    current = current.parent;
  }
  return false;
}

// ---------------------------------------------------------------------------
// AnnotationHoverMarker
// ---------------------------------------------------------------------------

export function AnnotationHoverMarker({ hit }: { hit: AnnotationHit }) {
  const position = useMemo(() => new Vector3(...hit.position), [hit.position]);
  const normal = useMemo(
    () => new Vector3(...hit.normal).normalize(),
    [hit.normal],
  );
  return (
    <group position={position} userData={{ annotationHover: true }} raycast={() => null}>
      <mesh position={normal.clone().multiplyScalar(0.025)} renderOrder={20}>
        <sphereGeometry args={[0.075, 16, 16]} />
        <meshBasicMaterial color="#f59e0b" depthTest={false} depthWrite={false} />
      </mesh>
      <mesh position={normal.clone().multiplyScalar(0.02)} renderOrder={19}>
        <ringGeometry args={[0.1, 0.125, 24]} />
        <meshBasicMaterial
          color="#f59e0b"
          transparent
          opacity={0.9}
          depthTest={false}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}

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
  onHoverAnnotation: (hit: AnnotationHit | null) => void;
  onAnnotation: (draft: PendingReview, screen: { x: number; y: number }) => void;
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

  const selectedInScene = useMemo(() => {
    const names = new Set<string>();
    scene.traverse((node) => {
      const identity = objectIdentity(node);
      if (selected.has(identity)) names.add(identity);
    });
    return names;
  }, [scene, selected]);

  const isolationHierarchy = useMemo(() => {
    const nodes = new Set<Object3D>();
    if (!isolated || selectedInScene.size === 0) return nodes;
    scene.traverse((node) => {
      if (!selected.has(objectIdentity(node))) return;
      // A visible descendant still needs every parent in the render tree to
      // remain visible. Include both directions around every selected node.
      node.traverse((descendant) => nodes.add(descendant));
      let ancestor: Object3D | null = node;
      while (ancestor) {
        nodes.add(ancestor);
        ancestor = ancestor.parent;
      }
    });
    return nodes;
  }, [isolated, scene, selected, selectedInScene]);

  // A stale manifest/outliner name must not turn local view into an empty scene.
  const hasRenderableIsolation = useMemo(
    () =>
      [...isolationHierarchy].some(
        (node) =>
          "isMesh" in node &&
          Boolean((node as Object3D & { isMesh?: boolean }).isMesh),
      ),
    [isolationHierarchy],
  );
  const effectiveIsolation =
    isolated && selectedInScene.size > 0 && hasRenderableIsolation;

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
    scene.traverse((node: Object3D & { material?: unknown }) => {
      const belongsToIsolation = isolationHierarchy.has(node);
      // In Blender-style local view the selected target remains visible even
      // if it was hidden in the global outliner before entering local view.
      node.visible = effectiveIsolation
        ? belongsToIsolation
        : !hidden.has(objectIdentity(node));
      const materials = Array.isArray(node.material)
        ? node.material
        : node.material
        ? [node.material]
        : [];
      for (const material of materials as Array<{
        userData: Record<string, unknown>;
        color?: { getHex: () => number; setHex: (value: number) => void };
        emissive?: { getHex: () => number; setHex: (value: number) => void };
        emissiveIntensity?: number;
        wireframe?: boolean;
        needsUpdate: boolean;
      }>) {
        const original = material.userData.blendProofOriginal as
          | {
              color?: number;
              emissive?: number;
              emissiveIntensity?: number;
              wireframe?: boolean;
            }
          | undefined;
        if (!original)
          material.userData.blendProofOriginal = {
            color: material.color?.getHex(),
            emissive: material.emissive?.getHex(),
            emissiveIntensity: material.emissiveIntensity,
            wireframe: material.wireframe,
          };
        const saved = material.userData.blendProofOriginal as {
          color?: number;
          emissive?: number;
          emissiveIntensity?: number;
          wireframe?: boolean;
        };
        if (displayMode === "wire") {
          material.wireframe = true;
          material.color?.setHex(0xe87d0d);
        } else if (displayMode === "gray") {
          material.wireframe = false;
          material.color?.setHex(0xaeb4b7);
        } else {
          material.wireframe = saved.wireframe;
          if (saved.color !== undefined) material.color?.setHex(saved.color);
        }
        const meshMaterial = material as typeof material & {
          flatShading?: boolean;
        };
        if (meshMaterial.flatShading !== (shadingMode === "flat")) {
          meshMaterial.flatShading = shadingMode === "flat";
          material.needsUpdate = true;
        }
        if (
          belongsToAnySelected(node, selected) ||
          (hoveredName !== null && objectIdentity(node) === hoveredName)
        ) {
          material.emissive?.setHex(0xe87d0d);
          material.emissiveIntensity =
            hoveredName === objectIdentity(node) ? 0.75 : 0.52;
        } else {
          if (saved.emissive !== undefined)
            material.emissive?.setHex(saved.emissive);
          material.emissiveIntensity = saved.emissiveIntensity;
        }
        material.needsUpdate = true;
      }
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
    const node = resolveSelectableNode(event.object);
    const normal = event.face?.normal
      ? event.face.normal
          .clone()
          .applyMatrix3(
            new Matrix3().getNormalMatrix(event.object.matrixWorld),
          )
          .normalize()
      : new Vector3().copy(camera.position).sub(event.point).normalize();
    const towardCamera = new Vector3()
      .copy(camera.position)
      .sub(event.point)
      .normalize();
    if (normal.dot(towardCamera) < 0) normal.negate();
    const perspective = (camera as any).isPerspectiveCamera;
    onAnnotation(
      {
        objectName: node ? objectIdentity(node) : null,
        position: event.point.toArray() as Vec3,
        normal: normal.toArray() as Vec3,
        camera: {
          projection: perspective ? "perspective" : "orthographic",
          position: camera.position.toArray() as Vec3,
          quaternion: camera.quaternion.toArray() as [
            number,
            number,
            number,
            number,
          ],
          target: navigationTarget,
          ...(perspective
            ? { fov: (camera as any).fov }
            : {
                zoom: (camera as any).zoom,
                orthographicHeight:
                  (camera as any).top - (camera as any).bottom,
              }),
        },
      },
      {
        x: event.nativeEvent?.offsetX ?? event.clientX ?? 0,
        y: event.nativeEvent?.offsetY ?? event.clientY ?? 0,
      },
    );
    return true;
  };

  return (
    <primitive
      object={scene}
      onPointerMove={(event: any) => {
        if (!annotationMode || !event.point) return onHoverAnnotation(null);
        const normal = event.face?.normal
          ? event.face.normal
              .clone()
              .applyMatrix3(
                new Matrix3().getNormalMatrix(event.object.matrixWorld),
              )
              .normalize()
          : new Vector3().copy(camera.position).sub(event.point).normalize();
        const node = resolveSelectableNode(event.object);
        onHoverAnnotation({
          position: event.point.toArray() as Vec3,
          normal: normal.toArray() as Vec3,
          objectName: node ? objectIdentity(node) : null,
        });
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

// ---------------------------------------------------------------------------
// BoxSelectionController
// ---------------------------------------------------------------------------

export function BoxSelectionController({
  scene,
  selectableNames,
  onSelectMany,
  onBoxChange,
}: {
  scene: Object3D | null;
  selectableNames: Set<string>;
  onSelectMany: (names: string[]) => void;
  onBoxChange: (box: SelectionBox) => void;
}) {
  const { camera, gl, size } = useThree();
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    const element = gl.domElement;
    const point = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      start.current = point(event);
      dragged.current = false;
    };
    const onMove = (event: PointerEvent) => {
      if (!start.current) return;
      const end = point(event);
      const left = Math.min(start.current.x, end.x);
      const top = Math.min(start.current.y, end.y);
      if (
        Math.abs(end.x - start.current.x) >= 8 ||
        Math.abs(end.y - start.current.y) >= 8
      )
        dragged.current = true;
      onBoxChange({
        left,
        top,
        width: Math.abs(end.x - start.current.x),
        height: Math.abs(end.y - start.current.y),
      });
    };
    const onUp = (event: PointerEvent) => {
      const box = start.current;
      start.current = null;
      onBoxChange(null);
      if (!box || !scene) return;
      const end = point(event);
      const left = Math.min(box.x, end.x);
      const right = Math.max(box.x, end.x);
      const top = Math.min(box.y, end.y);
      const bottom = Math.max(box.y, end.y);
      if (right - left < 8 || bottom - top < 8) return;
      const selected = new Set<string>();
      scene.updateWorldMatrix(true, true);
      scene.traverse((node) => {
        const name = selectableAncestorName(node, selectableNames);
        if (!name || !(node as { isMesh?: boolean }).isMesh) return;
        const bounds = new Box3().setFromObject(node);
        if (bounds.isEmpty()) return;
        let objectLeft = Number.POSITIVE_INFINITY;
        let objectRight = Number.NEGATIVE_INFINITY;
        let objectTop = Number.POSITIVE_INFINITY;
        let objectBottom = Number.NEGATIVE_INFINITY;
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y])
            for (const z of [bounds.min.z, bounds.max.z]) {
              const projected = new Vector3(x, y, z).project(camera);
              const screenX = ((projected.x + 1) / 2) * size.width;
              const screenY = ((1 - projected.y) / 2) * size.height;
              objectLeft = Math.min(objectLeft, screenX);
              objectRight = Math.max(objectRight, screenX);
              objectTop = Math.min(objectTop, screenY);
              objectBottom = Math.max(objectBottom, screenY);
            }
        if (
          objectRight >= left &&
          objectLeft <= right &&
          objectBottom >= top &&
          objectTop <= bottom
        )
          selected.add(name);
      });
      onSelectMany([...selected]);
    };
    const onClickCapture = (event: MouseEvent) => {
      if (!dragged.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dragged.current = false;
    };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("click", onClickCapture, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [camera, gl, onBoxChange, onSelectMany, scene, selectableNames, size]);

  return null;
}
