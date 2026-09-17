/**
 * 框选：按住左键拖拽，选中投影落在矩形内的对象。
 *
 * 从 Model.tsx 抽出 —— 它完全不参与模型渲染，只是挂在 gl.domElement
 * 上的指针监听，混在 Model 里会让「模型怎么画」这件事难以阅读。
 */

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Box3, Vector3 } from "three";
import type { Object3D } from "three";
import type { SelectionBox } from "../../../types";
import { selectableAncestorName } from "../modelPicking";

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
