import { describe, expect, it } from 'vitest'
import { needsIncidentReview, canCloseSafetyEvent } from './qualitySafety'

describe('quality safety utils', () => {
  it('requires review when rates exceed acceptable thresholds', () => {
    expect(needsIncidentReview({ sepsisRate: 11, fallRate: 4, medicationErrorRate: 2, threshold: 10 })).toBe(true)
  })

  it('allows closure only after root cause and corrective action are complete', () => {
    expect(canCloseSafetyEvent({ rootCauseIdentified: true, correctiveActionComplete: true, approved: true })).toBe(true)
  })

  it('blocks closure while corrective action remains pending', () => {
    expect(canCloseSafetyEvent({ rootCauseIdentified: true, correctiveActionComplete: false, approved: true })).toBe(false)
  })
})
