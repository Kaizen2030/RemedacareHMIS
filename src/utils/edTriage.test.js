import { describe, expect, it } from 'vitest'
import { colourFromScore, gcs, minutesToTarget, pathwayStatus, tews, triageColour } from './edTriage'

describe('adult TEWS (SATS)', () => {
  it('scores each vital sign by the SATS bands', () => {
    expect(tews({ mobility: 'walking', rr: 16, hr: 88, sbp: 120, temp: 37, avpu: 'A', trauma: false })).toMatchObject({ score: 1, missing: [] })
    const sick = tews({ mobility: 'stretcher', rr: 32, hr: 135, sbp: 68, temp: 39, avpu: 'P', trauma: true })
    expect(sick.parts).toEqual({ mobility: 2, rr: 3, hr: 3, sbp: 3, temp: 2, avpu: 2, trauma: 1 })
    expect(sick.score).toBe(16)
    expect(tews({ hr: 40 }).parts.hr).toBe(2)
    expect(tews({ hr: 45 }).parts.hr).toBe(1)
    expect(tews({ sbp: 205 }).parts.sbp).toBe(2)
    expect(tews({ rr: 8 }).parts.rr).toBe(2)
    expect(tews({}).missing).toHaveLength(7)
  })
  it('maps the score to colours and lets emergency signs override upwards only', () => {
    expect([2, 3, 5, 7].map(colourFromScore)).toEqual(['green', 'yellow', 'orange', 'red'])
    expect(triageColour({ score: 1, signs: ['orange:Chest pain'] })).toBe('orange')
    expect(triageColour({ score: 8, signs: ['yellow:Abdominal pain'] })).toBe('red')
    expect(triageColour({ score: 9, signs: [], child: true })).toBe('green')
    expect(triageColour({ signs: ['red:Convulsing now'], child: true })).toBe('red')
    expect(triageColour({ dead: true })).toBe('blue')
  })
})

describe('timers', () => {
  const arrival = '2026-11-15T10:00:00Z'
  it('counts down to the see-by time', () => {
    expect(minutesToTarget({ see_by: '2026-11-15T10:10:00Z' }, new Date('2026-11-15T10:04:00Z'))).toBe(6)
    expect(minutesToTarget({ see_by: '2026-11-15T10:10:00Z' }, new Date('2026-11-15T10:15:00Z'))).toBe(-5)
    expect(minutesToTarget({ see_by: '2026-11-15T10:10:00Z', seen_at: '2026-11-15T10:05:00Z' })).toBe(null)
  })
  it('tracks pathway steps against their targets', () => {
    const st = pathwayStatus('stemi', [{ pathway: 'stemi', step: 'ecg', done_at: '2026-11-15T10:12:00Z' }], arrival, new Date('2026-11-15T10:25:00Z'))
    expect(st[0]).toMatchObject({ key: 'ecg', state: 'done', minutes: 12, onTime: false })
    expect(st[2]).toMatchObject({ key: 'aspirin', state: 'overdue' })
    expect(st[3]).toMatchObject({ key: 'troponin', state: 'pending', minutesLeft: 5 })
  })
  it('adds up the Glasgow Coma Scale', () => {
    expect(gcs({ e: 4, v: 5, m: 6 })).toBe(15)
    expect(gcs({ e: 2, v: 2, m: '' })).toBe(null)
  })
})
