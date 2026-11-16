import { describe, expect, it } from 'vitest'
import { facilityBadge } from './Login'

describe('login facility badge', () => {
  it('never repeats "Kenya" and reads naturally for every stored level', () => {
    expect(facilityBadge('Kenya')).toBe('Kenya')
    expect(facilityBadge('')).toBe('Kenya')
    expect(facilityBadge(undefined)).toBe('Kenya')
    expect(facilityBadge('4')).toBe('Kenya · Level 4 facility')
    expect(facilityBadge('Level 5')).toBe('Kenya · Level 5 facility')
    expect(facilityBadge('Level 4 Hospital')).toBe('Kenya · Level 4 Hospital')
    expect(facilityBadge('Kenya Level 6')).toBe('Kenya Level 6')
    expect(facilityBadge('Private clinic')).toBe('Kenya · Private clinic')
  })
})
