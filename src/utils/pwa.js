// Installable web app (iPhone "Add to Home Screen", Android "Install app"): register public/sw.js.
// Relative to the page so it also works under a sub-path such as GitHub Pages (/RemedacareHMIS/).
// Not in the desktop app: it loads its own local copy of the files.
export function registerPwaServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  if (typeof window !== 'undefined' && window.electronAPI) return
  const register = () => navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {})
  // called from React after mount, which can be after the page's load event
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
