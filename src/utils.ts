/**
 * Pure utility functions shared across BlendProof's viewer, workspace,
 * and share pages. All functions are side-effect-free.
 */

import { getLang } from "./i18n";
import type { SharedViewState, DisplayMode } from "./types";
import type { CameraState } from "./shared/types/camera";
import type { Vec3 } from "./shared/types/geometry";
import { OrthographicCamera, PerspectiveCamera } from "three";
import type { Camera as ThreeCamera } from "three";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatShareExpiry(expiresAt: string | null) {
  if (!expiresAt) return "不限时";
  return new Intl.DateTimeFormat(getLang() === "en" ? "en-US" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(expiresAt));
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, bytes)} B`;
}

/**
 * 相对时间，用于批注与回复的「多久之前」。
 * 超过 30 天回退到具体日期，避免"87 天前"这类难以换算的表述。
 */
export function formatRelativeTime(iso: string, now = Date.now()) {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "—";
  const english = getLang() === "en";
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 60) return english ? "just now" : "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return english ? `${minutes}m ago` : `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return english ? `${hours}h ago` : `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return english ? `${days}d ago` : `${days} 天前`;
  return new Intl.DateTimeFormat(english ? "en-US" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function formatDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (getLang() === "en") {
    return days > 0
      ? `${days}d ${hours}h ${minutes}m`
      : `${hours}h ${minutes}m ${remainingSeconds}s`;
  }
  return days > 0
    ? `${days} 天 ${hours} 时 ${minutes} 分`
    : `${hours} 时 ${minutes} 分 ${remainingSeconds} 秒`;
}

// ---------------------------------------------------------------------------
// Shared view (URL fragment) encoding / decoding
// ---------------------------------------------------------------------------

export function encodeSharedView(state: SharedViewState) {
  return `#view=${encodeURIComponent(JSON.stringify(state))}`;
}

export function isFiniteTuple(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

export function readSharedView(): SharedViewState | null {
  const raw = new URLSearchParams(window.location.hash.slice(1)).get("view");
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SharedViewState>;
    const camera = value.camera;
    const validNames = (items: unknown) =>
      Array.isArray(items) &&
      items.length <= 10000 &&
      items.every(
        (item) => typeof item === "string" && item.length <= 256,
      );
    if (
      value.version !== 1 ||
      !camera ||
      !["perspective", "orthographic"].includes(camera.projection) ||
      !isFiniteTuple(camera.position, 3) ||
      !isFiniteTuple(camera.quaternion, 4) ||
      !isFiniteTuple(camera.target, 3) ||
      !["material", "gray", "wire"].includes(value.displayMode ?? "") ||
      !validNames(value.hidden) ||
      !validNames(value.selected)
    )
      return null;
    return value as SharedViewState;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Project guard helpers (used in workspace page)
// ---------------------------------------------------------------------------

export function isLocalBridgeResource(value: string) {
  if (value.startsWith("/api/local/")) return true;
  try {
    const url = new URL(value);
    return (
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "::1") &&
      url.pathname.startsWith("/api/local/")
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Camera state capture (used by BlenderViewControls)
// ---------------------------------------------------------------------------

export function captureCameraState(
  camera: ThreeCamera,
  target: Vec3,
): CameraState {
  const base = {
    position: camera.position.toArray() as Vec3,
    quaternion: camera.quaternion.toArray() as [number, number, number, number],
    target,
  };
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    const value = camera as OrthographicCamera;
    return {
      ...base,
      projection: "orthographic",
      zoom: value.zoom,
      orthographicHeight: Math.abs(value.top - value.bottom),
    };
  }
  return {
    ...base,
    projection: "perspective",
    fov: (camera as PerspectiveCamera).fov,
  };
}

