import { StrictMode, Suspense, lazy, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './overrides.css'
import { I18nProvider, I18nLayer, useI18n, t } from './i18n'

// Route-level code splitting. A share reviewer used to download the upload
// workspace, admin console and start page, and `/dev/` downloaded the share-only
// gate views, because both pages were imported statically into one 1.48 MB
// bundle. Only the branch that actually renders is fetched now.
const WorkspacePage = lazy(() =>
  import('./pages/WorkspacePage').then((module) => ({ default: module.WorkspacePage })))
const SharePage = lazy(() =>
  import('./pages/SharePage').then((module) => ({ default: module.SharePage })))

/** Transient shell shown while the route chunk loads. Must not pull in three.js. */
function RouteFallback(): ReactNode {
  // Subscribe so a language switch re-renders this label instead of freezing it.
  useI18n()
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span className="route-loading__spinner" aria-hidden="true" />
      <span>{t('正在载入 BlendProof…')}</span>
    </div>
  )
}

const isShareRoute = window.location.pathname.startsWith('/s/')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <Suspense fallback={<RouteFallback />}>
        {isShareRoute ? <SharePage /> : <WorkspacePage />}
      </Suspense>
      <I18nLayer />
    </I18nProvider>
  </StrictMode>,
)
