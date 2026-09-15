import { Globe } from 'lucide-react'
import { t, useI18n } from '../i18n'

const LANDING_URL =
  (import.meta.env.VITE_LANDING_URL as string | undefined) ??
  'https://blendproof.itycon.cn/landing/'

/**
 * Landing-page link + language toggle. Rendered *in place* (inside the Blender
 * menubar, or the welcome page's tab strip) rather than floating, so it lines up
 * with the surrounding buttons instead of overlapping them. Only the language
 * toggle is marked data-i18n-ignore so its EN/中文 label follows React state
 * instead of the overlay dictionary.
 */
function Controls({ variant }: { variant: 'menubar' | 'splash' }): React.ReactNode {
  const { lang, toggle } = useI18n()
  return (
    <div className={`top-actions top-actions--${variant}`}>
      <a
        className="top-action"
        href={LANDING_URL}
        target="_blank"
        rel="noreferrer"
        title={t('查看 BlendProof 落地页')}
      >
        <Globe size={13} />
        <span>落地页</span>
      </a>
      <button
        type="button"
        className="top-action"
        onClick={toggle}
        aria-label={t('切换语言')}
        data-i18n-ignore
      >
        {lang === 'zh' ? 'EN' : '中文'}
      </button>
    </div>
  )
}

/** For the Blender menubar, styled to match the neighbouring menu items. */
export function MenubarActions(): React.ReactNode {
  return <Controls variant="menubar" />
}

/** For the welcome / cover page tab strip. */
export function SplashActions(): React.ReactNode {
  return <Controls variant="splash" />
}
