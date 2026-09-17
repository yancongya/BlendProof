import { Billboard, Text, Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { ReviewComment } from "../types";
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
      {selected && (
        <Html
          position={[0, 0.45, 0]}
          center
          zIndexRange={[100, 0]}
          style={{ pointerEvents: 'auto', width: 'max-content' }}
        >
          <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-md shadow-xl rounded-xl border border-slate-200 dark:border-slate-700 p-4 min-w-[280px] max-w-[320px] pointer-events-auto text-left transform transition-all animate-in zoom-in-95 duration-200">
            <header className="flex justify-between items-center mb-2 gap-4">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                {comment.authorName}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${comment.status === 'resolved' ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'}`}>
                {comment.status === 'resolved' ? '已解决' : '待处理'}
              </span>
            </header>
            <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
              {comment.body}
            </p>
            {comment.replies && comment.replies.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                包含 {comment.replies.length} 条回复
              </div>
            )}
          </div>
        </Html>
      )}
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
