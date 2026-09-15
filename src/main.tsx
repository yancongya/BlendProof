import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './overrides.css'
import { App, SharePage } from './App'
import { I18nProvider, I18nLayer } from './i18n'
import { TopActions } from './components/TopActions'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      {window.location.pathname.startsWith('/s/') ? <SharePage /> : <App />}
      <TopActions />
      <I18nLayer />
    </I18nProvider>
  </StrictMode>,
)
