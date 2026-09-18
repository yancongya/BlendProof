/**
 * 按显示模式、显隐、独显与选中状态改写场景材质的实际外观。
 *
 * 这段逻辑此前内联在 Model 的 useEffect 里，占了将近 90 行，
 * 把「模型怎么加载」和「材质怎么变」两件事搅在一起。抽出后可单独推敲：
 * 每次都要先保存原始材质，否则切换模式会不可逆地丢掉源文件的外观。
 */

import type { Object3D } from "three";
import type { DisplayMode, ShadingMode } from "../../types";
import { belongsToAnySelected, objectIdentity } from "./modelPicking";

export function applyModelAppearance(
  scene: Object3D,
  options: {
    displayMode: DisplayMode;
    shadingMode: ShadingMode;
    hidden: Set<string>;
    selected: Set<string>;
    isolationHierarchy: Set<Object3D>;
    effectiveIsolation: boolean;
    hoveredName: string | null;
  },
): void {
  const { displayMode, shadingMode, hidden, selected, isolationHierarchy, effectiveIsolation, hoveredName } = options;
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
      // 只有结构性变化（wireframe / flatShading）才需要重编译 shader。
      // 颜色和自发光是 uniform，直接赋值即可；无条件置 needsUpdate 会让每次
      // hover 都重编译整个场景的材质，主线程会被打满。
      let needsUpdate = false;
      const targetWireframe =
        displayMode === "wire" ? true : displayMode === "gray" ? false : saved.wireframe ?? false;
      if (material.wireframe !== targetWireframe) {
        material.wireframe = targetWireframe;
        needsUpdate = true;
      }
      const targetColor =
        displayMode === "wire" ? 0xe87d0d : displayMode === "gray" ? 0xaeb4b7 : saved.color;
      if (targetColor !== undefined) material.color?.setHex(targetColor);

      const meshMaterial = material as typeof material & {
        flatShading?: boolean;
      };
      if (meshMaterial.flatShading !== (shadingMode === "flat")) {
        meshMaterial.flatShading = shadingMode === "flat";
        needsUpdate = true;
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
      if (needsUpdate) material.needsUpdate = true;
    }
  });
}
