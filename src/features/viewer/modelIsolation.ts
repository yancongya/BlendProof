/**
 * Blender 式「独显」（local view）的可见性计算。
 *
 * 这里有几处容易踩的坑，因此值得独立成模块而不是内联在渲染组件里：
 *   1. 被选中节点的**父链必须保留**，否则子节点再可见也画不出来；
 *   2. outliner 里的名字可能已经过期（模型被替换），此时不能让视口变空
 *     —— 需要 `hasRenderableIsolation` 兜底并通知上层退出独显。
 */

import type { Object3D } from "three";
import { objectIdentity } from "./modelPicking";

/** 场景中确实存在、且被 outliner 选中的名字。 */
export function collectSelectedInScene(scene: Object3D, selected: Set<string>): Set<string> {
  const names = new Set<string>();
  scene.traverse((node) => {
    const identity = objectIdentity(node);
    if (selected.has(identity)) names.add(identity);
  });
  return names;
}

/** 独显时需要保持可见的节点集合（选中节点的子树 + 其父链）。 */
export function collectIsolationHierarchy(
  scene: Object3D,
  selected: Set<string>,
  selectedInScene: Set<string>,
): Set<Object3D> {
  const nodes = new Set<Object3D>();
  if (selectedInScene.size === 0) return nodes;
  scene.traverse((node) => {
    if (!selected.has(objectIdentity(node))) return;
    node.traverse((descendant) => nodes.add(descendant));
    let ancestor: Object3D | null = node;
    while (ancestor) {
      nodes.add(ancestor);
      ancestor = ancestor.parent;
    }
  });
  return nodes;
}

/** 独显结果里是否真有可渲染的 Mesh——没有就说明选中的名字已过期。 */
export function hasRenderableMesh(nodes: Set<Object3D>): boolean {
  for (const node of nodes) {
    if ((node as Object3D & { isMesh?: boolean }).isMesh) return true;
  }
  return false;
}
