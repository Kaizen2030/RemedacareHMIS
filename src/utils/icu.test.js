import { describe, expect, it } from 'vitest'
import { canAssignICUBed, getICUAlertLevel } from './icu'

describe('icu utils', () => {
  it('allows ICU assignment with an available bed for critical patients', () => {
    expect(canAssignICUBed({ patientSeverity: 'Critical', availableBeds: 2 })).toBe(true)
  })

  it('blocks ICU assignment when no bed exists', () => {
    expect(canAssignICUBed({ patientSeverity: 'Critical', availableBeds: 0 })).toBe(false)
  })

  it('escalates alert level for unstable high-dependency transfer', () => {
    expect(getICUAlertLevel({ oxygenNeed: 8, hemodynamicStability: 'Unstable', nurseRatio: 1 })).toBe('Critical')
  })
})
