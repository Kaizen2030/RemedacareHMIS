import { describe, expect, it } from 'vitest'
import {
  canSetBloodUnitStatus,
  canIssueBloodUnit,
  canTransitionBloodUnitStatus,
  determineExpiryAlertState,
  isBloodUnitEligibleForIssue,
  isCompatibleBloodGroup,
} from './bloodBank'

describe('bloodBank compatibility logic', () => {
  it('accepts compatible donor and patient groups', () => {
    expect(isCompatibleBloodGroup('O+', 'A+')).toBe(true)
    expect(isCompatibleBloodGroup('A+', 'AB+')).toBe(true)
    expect(isCompatibleBloodGroup('AB+', 'O-')).toBe(false)
  })

  it('blocks blood units that are expired or quarantined', () => {
    expect(isBloodUnitEligibleForIssue({ status: 'Expired', screening_status: 'clear', expiry_at: '2024-01-01' })).toBe(false)
    expect(isBloodUnitEligibleForIssue({ status: 'Quarantine', screening_status: 'clear', expiry_at: '2099-01-01' })).toBe(false)
    expect(isBloodUnitEligibleForIssue({ status: 'Available', screening_status: 'clear', expiry_at: '2099-01-01' })).toBe(true)
  })

  it('only allows a unit to become available after screening clears', () => {
    expect(canSetBloodUnitStatus('Available', 'pending')).toBe(false)
    expect(canSetBloodUnitStatus('Available', 'recheck')).toBe(false)
    expect(canSetBloodUnitStatus('Available', 'clear')).toBe(true)
    expect(canSetBloodUnitStatus('Quarantine', 'pending')).toBe(true)
    expect(canSetBloodUnitStatus('Issued', 'clear')).toBe(false)
    expect(canSetBloodUnitStatus('Out of stock', 'clear')).toBe(false)
  })

  it('allows only valid next stock states and prevents expired stock becoming available', () => {
    expect(canTransitionBloodUnitStatus({ status: 'Pending', screening_status: 'pending' }, 'Quarantine')).toBe(true)
    expect(canTransitionBloodUnitStatus({ status: 'Pending', screening_status: 'pending' }, 'Reserved')).toBe(false)
    expect(canTransitionBloodUnitStatus({ status: 'Issued', screening_status: 'clear' }, 'Available')).toBe(false)
    expect(canTransitionBloodUnitStatus({ status: 'Pending', screening_status: 'clear', expiry_at: '2000-01-01' }, 'Available')).toBe(false)
  })

  it('blocks incompatible blood groups even when the unit is otherwise available', () => {
    const result = canIssueBloodUnit({
      status: 'Available',
      screening_status: 'clear',
      group: 'AB+',
      expiry_at: '2099-01-01',
    }, 'O-')

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('incompatible')
  })

  it('allows a valid issue when the unit and patient are compatible', () => {
    const result = canIssueBloodUnit({
      status: 'Available',
      screening_status: 'clear',
      group: 'A+',
      expiry_at: '2099-01-01',
    }, 'A+')

    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('Issue allowed')
  })

  it('reports the correct expiry alert state', () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    const result = determineExpiryAlertState({ expiry_at: futureDate })

    expect(result.tone).toBe('warning')
    expect(result.label).toContain('Expires in')
  })
})
