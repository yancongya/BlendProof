/**
 * 模型缓存控制。
 *
 * 「重试」必须真的重新下载：只清错误状态会因为 useGLTF 缓存的 rejected
 * promise 立刻再次抛同一个错，用户看起来像按钮没反应。
 */

import { useGLTF } from "@react-three/drei";

export function clearModelCache(url: string): void {
  useGLTF.clear(url);
}
