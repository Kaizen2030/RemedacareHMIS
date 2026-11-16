import { describe, expect, it } from 'vitest'
import { canReleaseBody, canRequestBodyRelease, daysInStorage, getOverstayFee } from './morgue'

describe('morgue release rules', () => {
  it('counts storage days from admission date', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    expect(daysInStorage(twoDaysAgo)).toBeGreaterThanOrEqual(2)
  })

  it('blocks release without ID verification', () => {
    const result = canReleaseBody({
      id_verified: false,
      medico_legal: false,
      released_by: 'Jane',
      verified_by: 'John',
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('ID verification missing')
  })

  it('requires authority record for medico-legal releases', () => {
    const result = canReleaseBody({
      id_verified: true,
      medico_legal: true,
      released_by: 'Jane',
      verified_by: 'John',
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('Authority document required for medico-legal release')
  })

  it('allows release when required checks are met', () => {
    const result = canReleaseBody({
      id_verified: true,
      medico_legal: false,
      release_requested_by_user_id: 'user-1',
      release_verified_by_user_id: 'user-2',
    })

    expect(result.allowed).toBe(true)
  })

  it('requires two different staff identities for release', () => {
    const result = canReleaseBody({
      id_verified: true,
      medico_legal: false,
      release_requested_by_user_id: 'user-1',
      release_verified_by_user_id: 'user-1',
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('different staff accounts')
  })

  it('allows release request after identity and legal checks without typed staff names', () => {
    expect(canRequestBodyRelease({ id_verified: true, medico_legal: false }).allowed).toBe(true)
    expect(canReleaseBody({ id_verified: true, medico_legal: false }).allowed).toBe(false)
  })

  it('calculates overstay fees by day count', () => {
    expect(getOverstayFee(3, 1500)).toBe(4500)
  })
})
