/**
 * 场景节点判定：把 outliner 的名字与 three.js 对象对应起来。
 *
 * 纯函数，不依赖 React 与 R3F，因此可以单独推敲——从 Model.tsx 抽出。
 */

import type { Object3D } from "three";

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
