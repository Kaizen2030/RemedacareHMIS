import { afterEach, describe, expect, it } from 'vitest'
import { getAuthConfirmRedirectUrl, getAuthResetRedirectUrl } from './authUrls'

const at = (href) => window.history.replaceState(null, '', href)

describe('email links (password reset, account activation)', () => {
  afterEach(() => { delete window.electronAPI; at('/') })

  it('the web and iPhone app send people back to the address it is served from, including a sub-path', () => {
    at('/RemedacareHMIS/')
    expect(getAuthResetRedirectUrl()).toBe(`${window.location.origin}/RemedacareHMIS/?type=recovery`)
    expect(getAuthConfirmRedirectUrl()).toBe(`${window.location.origin}/RemedacareHMIS/?type=signup`)
    at('/RemedacareHMIS/index.html')
    expect(getAuthResetRedirectUrl()).toBe(`${window.location.origin}/RemedacareHMIS/?type=recovery`)
    at('/')
    expect(getAuthResetRedirectUrl()).toBe(`${window.location.origin}/?type=recovery`)
  })

  it('the desktop app reopens itself through its own link', () => {
    window.electronAPI = { onDeepLink: () => {} }
    expect(getAuthResetRedirectUrl()).toBe('remedacarehms://reset')
    expect(getAuthConfirmRedirectUrl()).toBe('remedacarehms://activate')
  })
})
