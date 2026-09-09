import { Billboard, Text } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { ReviewComment } from "../reviewRepository";

export type ReviewAnnotationsProps = {
  comments: ReviewComment[];
  selectedId: string | null;
  onSelect: (commentId: string) => void;
};

type ReviewPinProps = {
  comment: ReviewComment;
  index: number;
  selected: boolean;
  onSelect: (commentId: string) => void;
};

const PIN_OFFSET = 0.018;

/** Keep a pin readable without making it grow unbounded at extreme distances. */
function pinScale(camera: THREE.Camera, anchor: THREE.Vector3) {
  if (camera instanceof THREE.OrthographicCamera) {
    const zoom = Math.max(camera.zoom, 0.01);
    return THREE.MathUtils.clamp(0.62 / zoom, 0.16, 0.72);
  }

  const distance = camera.position.distanceTo(anchor);
  return THREE.MathUtils.clamp(distance * 0.028, 0.1, 0.72);
}

function ReviewPin({ comment, index, selected, onSelect }: ReviewPinProps) {
  const visual = useRef<THREE.Group>(null);
  const selectedRing = useRef<THREE.Mesh>(null);
  const { camera } = useThree();

  const anchor = useMemo(
    () => new THREE.Vector3(...comment.position),
    [comment.position],
  );
  const position = useMemo(() => {
    const normal = new THREE.Vector3(...comment.normal);
    if (normal.lengthSq() === 0) return anchor.clone();
    return anchor
      .clone()
      .add(normal.normalize().multiplyScalar(PIN_OFFSET));
  }, [anchor, comment.normal]);

  const resolved = comment.status === "resolved";
  const color = resolved ? "#64748b" : "#f59e0b";
  const fill = resolved ? "#e2e8f0" : "#ffffff";
  const opacity = resolved ? 0.58 : 1;

  useFrame(() => {
    if (visual.current) {
      const scale = pinScale(camera, anchor) * (selected ? 1.16 : 1);
      visual.current.scale.setScalar(scale);
    }

    if (selectedRing.current) {
      selectedRing.current.scale.setScalar(selected ? 1.08 : 1);
      const material = selectedRing.current.material as THREE.MeshBasicMaterial;
      material.opacity = selected ? 0.32 : 0;
    }
  });

  return (
    <group position={position} userData={{ reviewCommentId: comment.id }}>
      <Billboard follow>
        <group ref={visual}>
          {/* The transparent hit target is deliberately larger than the artwork. */}
          <mesh
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelect(comment.id);
            }}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onPointerOver={(event) => event.stopPropagation()}
          >
            <sphereGeometry args={[0.82, 16, 16]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>

          <mesh ref={selectedRing} position={[0, 0, -0.03]} renderOrder={1}>
            <ringGeometry args={[0.62, 0.78, 32]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0}
              depthWrite={false}
              depthTest={false}
              side={THREE.DoubleSide}
            />
          </mesh>

          <mesh position={[0, -0.06, -0.04]} renderOrder={1}>
            <circleGeometry args={[0.53, 32]} />
            <meshBasicMaterial
              color="#000000"
              transparent
              opacity={0.24 * opacity}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>

          <mesh position={[0, 0, 0]} renderOrder={2}>
            <ringGeometry args={[0.44, 0.59, 32]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={opacity}
              depthWrite={false}
              depthTest={false}
              side={THREE.DoubleSide}
            />
          </mesh>

          <mesh position={[0, 0, 0.01]} renderOrder={3}>
            <circleGeometry args={[0.44, 32]} />
            <meshBasicMaterial
              color={fill}
              transparent
              opacity={opacity}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>

          <Text
            position={[0, 0, 0.03]}
            fontSize={0.36}
            color={resolved ? "#475569" : "#0f172a"}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.025}
            outlineColor={fill}
            fillOpacity={opacity}
            renderOrder={4}
          >
            {String(index)}
          </Text>
        </group>
      </Billboard>
    </group>
  );
}

/** Render review comments as selectable world-anchored, screen-sized pins. */
export function ReviewAnnotations({
  comments,
  selectedId,
  onSelect,
}: ReviewAnnotationsProps) {
  return (
    <group name="review-annotations">
      {comments.map((comment, index) => (
        <ReviewPin
          key={comment.id}
          comment={comment}
          index={index + 1}
          selected={selectedId === comment.id}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

export default ReviewAnnotations;
