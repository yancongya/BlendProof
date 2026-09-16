/**
 * Shared domain types for BlendProof's viewer, workspace, and share pages.
 *
 * 正在按域迁出（见 docs/UX_OVERHAUL_AND_DECOUPLING.md）：
 * 审稿相关类型已迁至 features/review，相机与几何基础类型已迁至 shared/types。
 */

import type { OwnerProject } from "./api/blendProofClient";
import type { CameraState } from "./shared/types/camera";

// ---------------------------------------------------------------------------
// Core domain aliases
// ---------------------------------------------------------------------------

export type Project = OwnerProject;

export type SceneObject = { name: string; type: string; collections: string[] };

export type Manifest = {
  scene: string;
  camera?: string | null;
  cameras?: Array<{ name?: string; projection?: string }>;
  objects: SceneObject[];
  collections?: string[];
  materials?: Array<unknown> | number | null;
  sourceBytes?: number;
  glbBytes?: number;
  export?: { sourceBytes?: number; glbBytes?: number; objectCount?: number };
};

// ---------------------------------------------------------------------------
// Viewer state
// ---------------------------------------------------------------------------

export type DisplayMode = "material" | "gray" | "wire";
export type ShadingMode = "smooth" | "flat";

export type CameraPreset =
  | "perspective"
  | "front"
  | "right"
  | "top"
  | `file:${string}`;

export type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
} | null;

export type ActiveShareStatus = {
  expiresAt: string | null;
  permission: "read_only" | "comment";
};

// ---------------------------------------------------------------------------
// Shared view (URL fragment)
// ---------------------------------------------------------------------------

export type SharedViewState = {
  version: 1;
  camera: CameraState;
  displayMode: DisplayMode;
  hidden: string[];
  selected: string[];
};
