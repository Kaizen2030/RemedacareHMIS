import { describe, expect, it } from 'vitest'
import { canCompleteCase, canStartCase, hasChecklistCompleted, hasRoomDoubleBooking } from './theatre'

describe('theatre workflow logic', () => {
  it('requires all safety checklist stages before case completion', () => {
    expect(hasChecklistCompleted({ sign_in: true, time_out: true, sign_out: false })).toBe(false)
    expect(hasChecklistCompleted({ sign_in: true, time_out: true, sign_out: true })).toBe(true)
  })

  it('blocks case start without patient, surgeon or pre-op checklist', () => {
    const result = canStartCase({ patient_id: null, surgeon: '', room_id: 'R1', start_time: '2026-10-02T10:00:00Z', checklist: { sign_in: true, time_out: true, sign_out: false } })
    expect(result.allowed).toBe(false)
  })

  it('allows a case to start after sign-in and time-out without requiring sign-out', () => {
    const result = canStartCase({ patient_id: 'PT-1', surgeon: 'Dr. Njeri', room_id: 'R1', start_time: '2026-10-02T10:00:00Z', checklist: { sign_in: true, time_out: true, sign_out: false } })
    expect(result.allowed).toBe(true)
  })

  it('requires sign-out before case completion', () => {
    const result = canCompleteCase({ patient_id: 'PT-1', surgeon: 'Dr. Njeri', room_id: 'R1', start_time: '2026-10-02T10:00:00Z', checklist: { sign_in: true, time_out: true, sign_out: false } })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Sign-out')
  })

  it('detects overlapping bookings in the same theatre room', () => {
    const schedule = [
      { id: 'A', room_id: 'R1', start_time: '2026-10-02T09:00:00Z', end_time: '2026-10-02T10:30:00Z' },
    ]

    const next = { id: 'B', room_id: 'R1', start_time: '2026-10-02T10:00:00Z', end_time: '2026-10-02T11:00:00Z' }
    expect(hasRoomDoubleBooking(schedule, next)).toBe(true)
  })
})
