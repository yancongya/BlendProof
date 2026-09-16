/**
 * Shared domain types for BlendProof's viewer, workspace, and share pages.
 * Extracted from App.tsx to allow individual page/component files to import
 * only what they need without pulling in the full monolith.
 */

import type { OwnerProject } from "./api/blendProofClient";

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
export type ReviewFilter = "all" | "open" | "resolved";

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

import type { ReviewCameraState } from "./reviewRepository";

export type SharedViewState = {
  version: 1;
  camera: ReviewCameraState;
  displayMode: DisplayMode;
  hidden: string[];
  selected: string[];
};

// ---------------------------------------------------------------------------
// Annotation helpers
// ---------------------------------------------------------------------------

import type { Vec3 } from "./reviewRepository";
import type { ReviewCommentDraft } from "./reviewRepository";

export type PendingReview = Omit<ReviewCommentDraft, "body" | "authorName">;
export type AnnotationHit = {
  position: Vec3;
  normal: Vec3;
  objectName: string | null;
};
