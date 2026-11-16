import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabase', () => ({ default: { rpc: vi.fn(async () => ({ data: [{ slot: '09:00:00', slot_end: '09:30:00', available: false, reason: 'booked' }], error: null })) } }))
const {
  addMinutesToTime, fetchSlots, friendlyScheduleError, insideTemplate, localDateKey, recurrenceDates, telehealthLink,
} = await import('./scheduling')

describe('scheduling helpers', () => {
  it('local date key and time arithmetic', () => {
    expect(localDateKey(new Date(2026, 10, 14, 1, 30))).toBe('2026-11-14')
    expect(addMinutesToTime('09:45', 30)).toBe('10:15')
    expect(addMinutesToTime('23:50', 20)).toBe('00:10')
  })
  it('maps database slots', async () => {
    expect(await fetchSlots({ hospitalId: 'h', clinicianId: 'd', date: '2026-11-16' })).toEqual([{ slot: '09:00', end: '09:30', available: false, reason: 'booked' }])
    expect(await fetchSlots({ hospitalId: 'h', clinicianId: '', date: '2026-11-16' })).toEqual([])
  })
  it('explains refusals and says when an override is allowed', () => {
    expect(friendlyScheduleError('Dr A already has an appointment from 09:00 to 09:30 — choose another time')).toMatchObject({ kind: 'double_booking', needsOverride: false })
    expect(friendlyScheduleError('Dr A is outside working hours (08:00–13:00) on Mon 16 Nov — pick another time')).toMatchObject({ kind: 'outside_schedule', needsOverride: true })
    expect(friendlyScheduleError('Dr A is on leave (Annual) on Tue')).toMatchObject({ needsOverride: true })
    expect(friendlyScheduleError('new row violates row-level security policy').message).toMatch(/permission/)
  })
  it('recurring series dates', () => {
    expect(recurrenceDates('2026-11-16', 2, 3)).toEqual(['2026-11-16', '2026-11-30', '2026-12-14'])
    expect(recurrenceDates('2026-11-16', 4, 1)).toEqual(['2026-11-16'])
  })
  it('telehealth links are unique Jitsi rooms', () => {
    const a = telehealthLink('Jane'), b = telehealthLink('Jane')
    expect(a).toMatch(/^https:\/\/meet\.jit\.si\/remedacare-jane-[a-z0-9]+$/i)
    expect(a).not.toBe(b)
  })
  it('template shading: hours, leave and extra sessions', () => {
    const schedules = [{ staff_id: 'd1', weekday: 1, start_time: '08:00', end_time: '13:00' }]
    const exceptions = [
      { staff_id: 'd1', kind: 'leave', starts_on: '2026-11-23', ends_on: '2026-11-23' },
      { staff_id: 'd1', kind: 'extra', starts_on: '2026-11-17', ends_on: '2026-11-17', start_time: '14:00', end_time: '16:00' },
    ]
    expect(insideTemplate(schedules, exceptions, 'd1', '2026-11-16', '09:00', 30)).toBe(true)
    expect(insideTemplate(schedules, exceptions, 'd1', '2026-11-16', '12:45', 30)).toBe(false)
    expect(insideTemplate(schedules, exceptions, 'd1', '2026-11-23', '09:00', 30)).toBe(false)
    expect(insideTemplate(schedules, exceptions, 'd1', '2026-11-17', '14:30', 30)).toBe(true)
    expect(insideTemplate(schedules, exceptions, 'd2', '2026-11-16', '20:00', 30)).toBeNull()
  })
})
