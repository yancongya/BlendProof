/**
 * Conversion summary panel — displays stats about the last Blender → GLB
 * conversion: scene name, counts, source/GLB sizes.
 */

import type { Manifest } from "../types";

export function ConversionSummary({ manifest }: { manifest: Manifest | null }) {
  const size = (bytes?: number) =>
    bytes !== undefined ? `${(bytes / 1024).toFixed(1)} KB` : "准备导入后显示";
  return (
    <div className="conversion-summary">
      <p className="property-kicker">转换内容</p>
      <span>
        场景 <b>{manifest?.scene ?? "-"}</b>
      </span>
      <span>
        集合 <b>{manifest?.collections?.length ?? 0}</b>
      </span>
      <span>
        对象{" "}
        <b>{manifest?.export?.objectCount ?? manifest?.objects.length ?? 0}</b>
      </span>
      <span>
        相机 <b>{manifest?.cameras?.length ?? (manifest?.camera ? 1 : 0)}</b>
      </span>
      <span>
        材质{" "}
        <b>
          {Array.isArray(manifest?.materials)
            ? manifest.materials.length
            : manifest?.materials ?? 0}
        </b>
      </span>
      <span>
        原始文件{" "}
        <b>{size(manifest?.export?.sourceBytes ?? manifest?.sourceBytes)}</b>
      </span>
      <span>
        Web GLB{" "}
        <b>{size(manifest?.export?.glbBytes ?? manifest?.glbBytes)}</b>
      </span>
    </div>
  );
}
