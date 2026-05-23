import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Prevent the browser from auto-restoring the previous scroll position on
// reload — the intro phase locks scroll at 0 and resumes the animation from
// the start, so any restored offset jumps the user mid-page once the lock
// is released.
if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}
window.scrollTo(0, 0)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
