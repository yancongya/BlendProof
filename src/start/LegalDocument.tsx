/**
 * LegalDocument — modal overlay that displays either the Privacy Policy
 * or Terms of Service for BlendProof.
 */

export function LegalDocument({
  kind,
  onClose,
}: {
  kind: "privacy" | "terms";
  onClose: () => void;
}) {
  const privacy = kind === "privacy";
  return (
    <div
      className="uploader-modal-backdrop legal-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article
        className="legal-modal"
        role="dialog"
        aria-modal="true"
        aria-label={privacy ? "隐私政策" : "服务条款"}
      >
        <header className="account-modal-head">
          <strong>BlendProof {privacy ? "隐私政策" : "服务条款"}</strong>
          <button type="button" aria-label="关闭协议" onClick={onClose}>
            ×
          </button>
        </header>
        {privacy ? (
          <div className="legal-copy">
            <p>生效日期：2026 年 9 月 12 日</p>
            <h2>数据处理范围</h2>
            <p>
              原始 .blend 文件仅在您的本机 Blender bridge
              中读取和转换，不会上传至 BlendProof 云端。您确认发布后，云端仅保存用于审阅的轻量
              GLB、裁剪后的 manifest、可选缩略图、分享设置和批注。
            </p>
            <h2>账号与日志</h2>
            <p>
              邀请码注册会处理邮箱、显示名称、账号角色、会话与邀请码使用记录。为保障安全、容量控制和故障排查，服务会保留必要的访问、发布、分享和清理日志。
            </p>
            <h2>保留与删除</h2>
            <p>
              普通审阅资产默认建议在 24
              小时内使用，最长保留时间受平台配置限制（默认不超过 48
              小时），到期后自动清理。管理员维护的公开演示模型不适用该临时保留规则。
            </p>
            <h2>联系</h2>
            <p>
              如需隐私相关协助，请联系{" "}
              <a href="mailto:admin@itycon.cn">admin@itycon.cn</a>。
            </p>
          </div>
        ) : (
          <div className="legal-copy">
            <p>生效日期：2026 年 9 月 12 日</p>
            <h2>服务定位</h2>
            <p>
              BlendProof 是轻量 3D 审阅工具，不替代 Blender、专业归档、备份或法律存证服务。分享访问者应依分享人设置的权限使用审阅内容。
            </p>
            <h2>允许与禁止</h2>
            <p>
              您须确保拥有上传、转换、发布和分享内容的必要权利。严禁上传或传播色情、暴力、恐怖主义、违法、侵权、恶意程序或其他可能危害他人的文件与内容。
            </p>
            <h2>账号与邀请码</h2>
            <p>
              注册仅可使用管理员发放的邀请码。您应妥善保管账号和分享密码；管理员可基于安全、容量或违规情况撤销邀请码、停用账号或清理相关审阅资产。
            </p>
            <h2>免责声明</h2>
            <p>
              用户提交、评论和分享的内容仅代表其作者，不代表 BlendProof
              立场。平台在法律允许的范围内按现状提供服务，不保证临时审阅资产的永久保存或所有格式的转换结果。
            </p>
          </div>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            我已了解
          </button>
        </footer>
      </article>
    </div>
  );
}
