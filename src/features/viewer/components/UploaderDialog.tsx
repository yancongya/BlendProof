/**
 * 上传工作台弹窗。
 *
 * 只负责「外壳」：遮罩、对话框语义、焦点边界（Esc 关闭 + Tab 循环）。
 * 弹窗里放什么由调用方以 children 传入 —— 上传流程属于 upload 域。
 */

import { type ReactNode, type RefObject } from "react";
import { t } from "../../../i18n";

export function UploaderDialog({
  children,
  onClose,
  onKeyDown,
  dialogRef,
  closeButtonRef,
}: {
  children: ReactNode;
  onClose?: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  dialogRef: RefObject<HTMLElement | null>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div
      className="uploader-modal-backdrop"
      data-testid="uploader-modal"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        ref={dialogRef}
        id="uploader-dialog"
        className="uploader-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="uploader-dialog-title"
        onKeyDown={onKeyDown}
      >
        <div className="uploader-dialog-bar">
          <h2 id="uploader-dialog-title">{t("文件 / 打开 .blend")}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="uploader-dialog-close"
            data-testid="close-uploader"
            aria-label={t("关闭上传工作台")}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
