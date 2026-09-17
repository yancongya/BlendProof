/**
 * 标注模式下的悬停吸附点。
 *
 * 从 Model.tsx 抽出：它是纯展示组件，与模型的加载、材质、拾取都无关。
 */

import { useMemo } from "react";
import { DoubleSide, Vector3 } from "three";
import type { SurfaceHit } from "../../../shared/types/picking";

export function AnnotationHoverMarker({ hit }: { hit: SurfaceHit }) {
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
