function getAppOrigin() {
  if (typeof window === 'undefined') return ''
  return window.location.origin
}

function getElectronRedirect(path) {
  if (typeof window === 'undefined' || !window.electronAPI?.onDeepLink) return null
  return `remedacarehms://${path}`
}

export function getAuthResetRedirectUrl() {
  const electronRedirect = getElectronRedirect('reset')
  if (electronRedirect) return electronRedirect

  const origin = getAppOrigin()
  // Supabase appends the recovery token in the URL fragment. A HashRouter path
  // would create a second fragment and prevent the token from being restored.
  return origin ? `${origin}/?type=recovery` : undefined
}

export function getAuthConfirmRedirectUrl() {
  const electronRedirect = getElectronRedirect('activate')
  if (electronRedirect) return electronRedirect

  const origin = getAppOrigin()
  return origin ? `${origin}/?type=signup` : undefined
}
