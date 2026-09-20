/**
 * 标注模式下的悬停吸附点。
 *
 * 从 Model.tsx 抽出：它是纯展示组件，与模型的加载、材质、拾取都无关。
 */

import { useMemo } from "react";
import { Billboard } from "@react-three/drei";
import { DoubleSide, Vector3 } from "three";
import type { SurfaceHit } from "../../../shared/types/picking";

export function AnnotationHoverMarker({ hit }: { hit: SurfaceHit }) {
  const position = useMemo(() => new Vector3(...hit.position), [hit.position]);
  const normal = useMemo(
    () => new Vector3(...hit.normal).normalize(),
    [hit.normal],
  );
  const markerPosition = useMemo(
    () => position.clone().add(normal.clone().multiplyScalar(0.035)),
    [normal, position],
  );
  return (
    <Billboard
      position={markerPosition}
      follow
      userData={{ annotationHover: true }}
      raycast={() => null}
    >
      <mesh renderOrder={18}>
        <ringGeometry args={[0.083, 0.098, 32]} />
        <meshBasicMaterial
          color="#151515"
          transparent
          opacity={0.72}
          depthTest={false}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      <mesh renderOrder={20}>
        <ringGeometry args={[0.068, 0.078, 32]} />
        <meshBasicMaterial
          color="#f0a34a"
          transparent
          opacity={0.95}
          depthTest={false}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      <mesh renderOrder={21}>
        <circleGeometry args={[0.015, 20]} />
        <meshBasicMaterial color="#fff4dd" depthTest={false} depthWrite={false} />
      </mesh>
      {[
        { position: [0, 0.105, 0] as const, rotation: 0 },
        { position: [0, -0.105, 0] as const, rotation: 0 },
        { position: [0.105, 0, 0] as const, rotation: Math.PI / 2 },
        { position: [-0.105, 0, 0] as const, rotation: Math.PI / 2 },
      ].map((tick, index) => (
        <mesh
          key={index}
          position={tick.position}
          rotation={[0, 0, tick.rotation]}
          renderOrder={20}
        >
          <planeGeometry args={[0.034, 0.007]} />
          <meshBasicMaterial
            color="#f0a34a"
            transparent
            opacity={0.9}
            depthTest={false}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      ))}
    </Billboard>
  );
}
