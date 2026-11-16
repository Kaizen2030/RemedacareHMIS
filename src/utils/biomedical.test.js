import { describe, expect, it } from 'vitest'
import { needsMaintenance, canUseEquipment } from './biomedical'

describe('biomedical utils', () => {
  it('requires preventive maintenance for aging equipment', () => {
    expect(needsMaintenance({ ageMonths: 30, status: 'Working', lastServiceMonths: 14 })).toBe(true)
  })

  it('allows safe equipment use when it is calibrated and not overdue', () => {
    expect(canUseEquipment({ status: 'Working', calibrationDue: false, safetyCheckPassed: true })).toBe(true)
  })

  it('blocks use if safety checks have not been passed', () => {
    expect(canUseEquipment({ status: 'Working', calibrationDue: false, safetyCheckPassed: false })).toBe(false)
  })
})
