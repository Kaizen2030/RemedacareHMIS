// Where the password-reset and account-activation emails send people back to.
// Desktop app: its own link (remedacarehms://), which reopens the app. Web and iPhone home-screen app: the address
// the app is served from, including a sub-path such as GitHub Pages /RemedacareHMIS/. Supabase adds the token after
// "#", so the link must not contain a "#" route of its own. Each address must be listed in Supabase → Authentication
// → URL Configuration → Redirect URLs.
function getAppBase() {
  if (typeof window === 'undefined' || !/^https?:$/.test(window.location.protocol)) return ''
  const dir = window.location.pathname.replace(/[^/]*$/, '') // /RemedacareHMIS/index.html -> /RemedacareHMIS/
  return `${window.location.origin}${dir}`
}

function getElectronRedirect(path) {
  if (typeof window === 'undefined' || !window.electronAPI?.onDeepLink) return null
  return `remedacarehms://${path}`
}

export function getAuthResetRedirectUrl() {
  const electronRedirect = getElectronRedirect('reset')
  if (electronRedirect) return electronRedirect
  const base = getAppBase()
  return base ? `${base}?type=recovery` : 'remedacarehms://reset'
}

export function getAuthConfirmRedirectUrl() {
  const electronRedirect = getElectronRedirect('activate')
  if (electronRedirect) return electronRedirect
  const base = getAppBase()
  return base ? `${base}?type=signup` : 'remedacarehms://activate'
}
