import {
  AlertTriangle,
  Check,
  FileBox,
  FolderOpen,
  Link2,
  LoaderCircle,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useRef, useState } from "react";

export type UploadStage = "idle" | "selected" | "converting" | "ready" | "uploading" | "published" | "publish_error" | "error";

type ManifestLike = {
  scene?: string | null;
  collections?: unknown[] | null;
  objects?: unknown[] | null;
  camera?: string | null;
  cameras?: unknown[] | null;
  materials?: unknown[] | number | null;
  sourceBytes?: number;
  glbBytes?: number;
  export?: {
    sourceBytes?: number;
    glbBytes?: number;
    objectCount?: number;
  };
};

export function UploaderPanel({
  file,
  stage,
  message,
  manifest,
  processing,
  shareUrl,
  shareExpiresAt,
  onFile,
  onConvert,
  recentProjects = [],
  onProjectSelect,
  publishTitle = "",
  onPublishTitle,
  onPublish,
}: {
  file: File | null;
  stage: UploadStage;
  message: string;
  manifest: ManifestLike | null;
  processing: boolean;
  shareUrl?: string | null;
  shareExpiresAt?: string | null;
  onFile: (file: File | null) => void;
  onConvert: () => void;
  recentProjects?: Array<{ id: string; name: string; modelUrl: string; manifestUrl: string; ownerCapability: string }>;
  onProjectSelect?: (project: { id: string; name: string; modelUrl: string; manifestUrl: string; ownerCapability: string }) => void;
  publishTitle?: string;
  onPublishTitle?: (title: string) => void;
  onPublish?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  function chooseFile(next: File | null) {
    if (!next) return;
    if (!next.name.toLowerCase().endsWith(".blend")) {
      setFileError("文件格式不受支持，请选择 .blend 文件。");
      if (input.current) input.current.value = "";
      onFile(null);
      return;
    }
    setFileError(null);
    onFile(next);
  }

  function clearFile() {
    if (input.current) input.current.value = "";
    setFileError(null);
    onFile(null);
  }

  const statusStage = fileError ? "error" : stage;

  return (
    <aside className="uploader-panel" data-testid="uploader-panel" aria-label="上传工作台">
      <header className="uploader-panel-header">
        <div className="uploader-panel-title">
          <UploadCloud size={16} />
          <strong>上传工作台</strong>
        </div>
        <span className="uploader-panel-badge">本机</span>
      </header>
      <p className="uploader-panel-intro">
        在本机转换 Blender 文件，生成可审阅的 Web 预览。
      </p>

      {recentProjects.length > 0 && onProjectSelect && (
        <label className="recent-project-picker">
          <span>最近本地项目</span>
          <select
            aria-label="切换最近本地项目"
            defaultValue=""
            onChange={(event) => {
              const next = recentProjects.find((item) => item.id === event.target.value);
              if (next) onProjectSelect(next);
              event.currentTarget.value = "";
            }}
          >
            <option value="">选择项目…</option>
            {recentProjects.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id.slice(0, 6)}</option>)}
          </select>
        </label>
      )}

      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept=".blend,application/x-blender"
        data-testid="blend-file-input"
        onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        className={`blend-dropzone ${dragging ? "dragging" : ""}`}
        data-testid="blend-dropzone"
        aria-label="打开 Blender 文件或拖放 .blend 文件"
        onClick={() => input.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            input.current?.click();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          chooseFile(event.dataTransfer.files[0] ?? null);
        }}
      >
        <span className="blend-dropzone-icon"><FolderOpen size={21} /></span>
        <strong>打开 .blend</strong>
        <span>或将文件拖放到这里</span>
        <small>仅支持 Blender 原生工程文件</small>
      </button>

      {file ? (
        <div className="selected-blend-file" data-testid="selected-blend-file">
          <span className="selected-blend-icon"><FileBox size={17} /></span>
          <span className="selected-blend-details">
            <strong title={file.name}>{file.name}</strong>
            <small>{formatBytes(file.size)} · .blend</small>
          </span>
          <button
            type="button"
            className="selected-blend-remove"
            aria-label="移除已选择的 Blender 文件"
            disabled={processing}
            onClick={clearFile}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <p className="uploader-empty-hint">尚未选择文件</p>
      )}

      <button
        type="button"
        className="uploader-convert-button"
        data-testid="convert-button"
        disabled={!file || processing}
        onClick={onConvert}
      >
        {processing ? <LoaderCircle className="spin" size={15} /> : <UploadCloud size={15} />}
        {processing ? "正在转换…" : stage === "ready" ? "重新转换" : "导入审稿模型"}
      </button>

      <section className="upload-progress" aria-label="转换进度" data-testid="upload-progress">
        <div className="uploader-section-label">处理阶段</div>
        <ProgressRow label="文件已选择" state={progressState(stage, "selected")} />
        <ProgressRow label="本机 Blender 转换" state={progressState(stage, "converting")} />
        <ProgressRow label="生成 Web 审阅资产" state={progressState(stage, "ready")} />
        <ProgressRow label="发布云端快递柜" state={progressState(stage, "published")} />
      </section>

      <p className={`uploader-status uploader-status-${statusStage}`} role={statusStage === "error" || statusStage === "publish_error" ? "alert" : "status"}>
        {statusStage === "error" || statusStage === "publish_error" ? <AlertTriangle size={13} /> : statusStage === "ready" || statusStage === "published" ? <Check size={13} /> : null}
        <span>{fileError ?? message}</span>
      </p>

      {(stage === "ready" || stage === "uploading" || stage === "published" || stage === "publish_error") && (
        <ManifestSummary manifest={manifest} />
      )}

      {(stage === "ready" || stage === "uploading" || stage === "published" || stage === "publish_error") && onPublish && onPublishTitle && (
        <section className="cloud-publish-card" data-testid="cloud-publish-card">
          <div className="uploader-section-label">云端发布</div>
          <label>
            审稿项目名称
            <input
              aria-label="云端审稿项目名称"
              value={publishTitle}
              maxLength={256}
              disabled={stage === "uploading" || stage === "published"}
              onChange={(event) => onPublishTitle(event.target.value)}
            />
          </label>
          <button type="button" disabled={!manifest || !publishTitle.trim() || stage === "uploading" || stage === "published"} onClick={onPublish}>
            {stage === "uploading" ? <LoaderCircle className="spin" size={13} /> : <UploadCloud size={13} />}
            {stage === "uploading" ? "正在上传派生资产…" : stage === "published" ? "已发布到云端" : "发布 GLB 到云端"}
          </button>
          <small>只上传 GLB 与裁剪后的清单，原始 .blend 不会离开本机。</small>
        </section>
      )}

      {(stage === "ready" || stage === "published") && shareUrl && (
        <section className="uploader-share-card" data-testid="uploader-share-status">
          <div className="uploader-section-label"><Link2 size={13} /> 分享状态</div>
          <strong>分享链接已建立</strong>
          <small>{formatExpiry(shareExpiresAt)}</small>
          <a href={shareUrl} target="_blank" rel="noreferrer">打开分享审稿</a>
        </section>
      )}

      <p className="uploader-local-note">
        源文件只发送到本机转换桥，不会上传到云端。
      </p>
    </aside>
  );
}

function ProgressRow({ label, state }: { label: string; state: "todo" | "active" | "done" | "error" }) {
  return (
    <div className={`upload-progress-row upload-progress-${state}`}>
      <span className="upload-progress-marker">
        {state === "done" ? <Check size={11} /> : state === "active" ? <LoaderCircle className="spin" size={11} /> : state === "error" ? <AlertTriangle size={11} /> : null}
      </span>
      <span>{label}</span>
      <small>{state === "done" ? "完成" : state === "active" ? "进行中" : state === "error" ? "失败" : "等待"}</small>
    </div>
  );
}

function progressState(stage: UploadStage, milestone: "selected" | "converting" | "ready" | "published") {
  if (stage === "error") return milestone === "selected" ? "done" : milestone === "converting" ? "error" : "todo";
  if (stage === "idle") return "todo";
  if (stage === "selected") return milestone === "selected" ? "done" : "todo";
  if (stage === "converting") return milestone === "selected" ? "done" : milestone === "converting" ? "active" : "todo";
  if (stage === "ready") return milestone === "published" ? "todo" : "done";
  if (stage === "uploading") return milestone === "published" ? "active" : "done";
  if (stage === "publish_error") return milestone === "published" ? "error" : "done";
  return "done";
}

function ManifestSummary({ manifest }: { manifest: ManifestLike | null }) {
  if (!manifest) {
    return (
      <section className="manifest-summary" data-testid="manifest-summary">
        <div className="uploader-section-label">解析清单</div>
        <p className="manifest-loading"><LoaderCircle className="spin" size={13} /> 正在读取 manifest…</p>
      </section>
    );
  }
  const objectCount = manifest.export?.objectCount ?? manifest.objects?.length ?? 0;
  const cameraCount = manifest.cameras?.length ?? (manifest.camera ? 1 : 0);
  const materialCount = Array.isArray(manifest.materials)
    ? manifest.materials.length
    : typeof manifest.materials === "number"
      ? manifest.materials
      : 0;
  const sourceBytes = manifest.export?.sourceBytes ?? manifest.sourceBytes;
  const glbBytes = manifest.export?.glbBytes ?? manifest.glbBytes;
  return (
    <section className="manifest-summary" data-testid="manifest-summary" aria-label="Blender 清单摘要">
      <div className="uploader-section-label">转换摘要</div>
      <dl className="manifest-summary-grid">
        <SummaryItem label="Scene" value={manifest.scene || "未命名场景"} wide />
        <SummaryItem label="Collection" value={manifest.collections?.length ?? 0} />
        <SummaryItem label="Object" value={objectCount} />
        <SummaryItem label="Camera" value={cameraCount} />
        <SummaryItem label="Material" value={materialCount} />
      </dl>
      {sourceBytes !== undefined && (
        <p className="manifest-size-note">
          源文件 {formatBytes(sourceBytes)}
          {glbBytes !== undefined
            ? ` · GLB ${formatBytes(glbBytes)}`
            : ""}
        </p>
      )}
    </section>
  );
}

function SummaryItem({ label, value, wide = false }: { label: string; value: string | number; wide?: boolean }) {
  return (
    <div className={wide ? "manifest-summary-item manifest-summary-wide" : "manifest-summary-item"}>
      <dt>{label}</dt>
      <dd title={String(value)}>{value}</dd>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "未知大小";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatExpiry(value?: string | null) {
  if (!value) return "有效期：不限";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return `有效期：${value}`;
  return `有效期至 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(timestamp)}`;
}
