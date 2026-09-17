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
  });
}
