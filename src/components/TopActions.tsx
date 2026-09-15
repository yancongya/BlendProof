import { Globe } from 'lucide-react'
import { useI18n } from '../i18n'

const LANDING_URL =
  (import.meta.env.VITE_LANDING_URL as string | undefined) ??
  'https://blendproof.itycon.cn/landing/'

/**
 * Fixed top-right control group (landing link + language toggle). Mirrors the
 * landing page's top-actions. Only the language toggle is marked
 * data-i18n-ignore so its EN/中文 label is driven by state, not the overlay.
 */
export function TopActions(): React.ReactNode {
  const { lang, toggle } = useI18n()
  return (
    <div className="top-actions">
      <a
        className="top-action"
        href={LANDING_URL}
        target="_blank"
        rel="noreferrer"
        title="查看 BlendProof 落地页"
      >
        <Globe size={14} />
        <span>落地页</span>
      </a>
      <button
        type="button"
        className="top-action"
        onClick={toggle}
        aria-label="切换语言"
        data-i18n-ignore
      >
        {lang === 'zh' ? 'EN' : '中文'}
      </button>
    </div>
  )
}
