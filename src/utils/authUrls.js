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

  // The app is expected to reopen through the RemedacareHMS custom URL scheme
  // so recovery tokens can be processed by the desktop/mobile client.
  return 'remedacarehms://reset'
}

export function getAuthConfirmRedirectUrl() {
  const electronRedirect = getElectronRedirect('activate')
  if (electronRedirect) return electronRedirect

  return 'remedacarehms://activate'
}
