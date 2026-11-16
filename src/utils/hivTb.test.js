import { describe, expect, it } from 'vitest'
import { isEligibleForArt, getAdherenceRisk } from './hivTb'

describe('hiv/tb utils', () => {
  it('allows ART for confirmed HIV positive patients with baseline assessment', () => {
    expect(isEligibleForArt({ hivPositive: true, baselineAssessed: true, activeTb: false })).toBe(true)
  })

  it('blocks ART where active TB is untreated', () => {
    expect(isEligibleForArt({ hivPositive: true, baselineAssessed: true, activeTb: true })).toBe(false)
  })

  it('flags adherence risk for poor follow-up compliance', () => {
    expect(getAdherenceRisk({ missedDoses: 3, adherenceScore: 62 })).toBe('High')
  })
})
