/**
 * BlenderViewportGrid — infinite Blender-style ground grid with X/Z axis lines.
 * Used inside the Canvas in BlenderWorkspace.
 */

import { DoubleSide } from "three";
import { Grid, Line } from "@react-three/drei";

export function BlenderViewportGrid() {
  return (
    <group>
      <Grid
        position={[0, -0.003, 0]}
        args={[10, 10]}
        cellSize={1}
        cellThickness={0.65}
        cellColor="#5a5a5a"
        sectionSize={10}
        sectionThickness={0.8}
        sectionColor="#707070"
        fadeDistance={150}
        fadeStrength={1}
        infiniteGrid
        followCamera
        side={DoubleSide}
      />
      <Line points={[[-1000, 0, 0], [1000, 0, 0]]} color="#b84b55" lineWidth={1.15} />
      <Line points={[[0, 0, -1000], [0, 0, 1000]]} color="#5b9b46" lineWidth={1.15} />
    </group>
  );
}
