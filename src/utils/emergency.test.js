import { describe, expect, it } from 'vitest'
import { triageEmergency, canTransferToWard } from './emergency'

describe('emergency utils', () => {
  it('prioritizes immediate care for red-code patients', () => {
    expect(triageEmergency({ severity: 'Red', vitals: { systolic: 80, pulse: 140 } })).toBe('Immediate')
  })

  it('flags urgent patients who need prompt review', () => {
    expect(triageEmergency({ severity: 'Yellow', vitals: { systolic: 100, pulse: 120 } })).toBe('Urgent')
  })

  it('does not treat missing observations as zero or automatically immediate', () => {
    expect(triageEmergency({ severity: 'Green', vitals: {} })).toBe('Routine')
  })

  it('allows ward transfer when patient is stable and no acute risks remain', () => {
    expect(canTransferToWard({ stable: true, acuteRisk: false, oxygenNeed: 2 })).toBe(true)
  })
})
