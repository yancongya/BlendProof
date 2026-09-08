import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './overrides.css'
import { App, SharePage } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{window.location.pathname.startsWith('/s/') ? <SharePage /> : <App />}</StrictMode>,
)
