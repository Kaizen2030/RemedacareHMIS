import { describe, expect, it } from 'vitest'
import { bradenTotal, ewsResponse, fluidChart, morseTotal, news2, pews } from './wardScores'

describe('ward scores (mirror the database)', () => {
  it('NEWS2 matches the database test cases', () => {
    expect(news2({ rr: 16, spo2: 97, sbp: 125, hr: 75, consciousness: 'A', temp: 36.8 }).score).toBe(0)
    const sick = news2({ rr: 26, spo2: 90, oxygen: true, sbp: 88, hr: 135, consciousness: 'C', temp: 39.5 })
    expect(sick.parts).toEqual({ rr: 3, spo2: 3, oxygen: 2, sbp: 3, hr: 3, consciousness: 3, temp: 2 })
    expect(sick.score).toBe(19)
    expect(news2({ spo2: 97, spo2_scale: 2, oxygen: true }).parts.spo2).toBe(3)
    expect(news2({ spo2: 89, spo2_scale: 2, oxygen: true }).parts.spo2).toBe(0)
  })
  it('response levels', () => {
    expect(ewsResponse('news2', 7, false).level).toBe('high')
    expect(ewsResponse('news2', 2, true).level).toBe('low_medium')
    expect(ewsResponse('pews', 4, false).level).toBe('medium')
    expect(pews({ behaviour: 1, cardiovascular: 1, respiratory: 1, nebs: true }).score).toBe(5)
  })
  it('Braden, Morse and the fluid chart', () => {
    expect(bradenTotal({ sensory: 2, moisture: 2, activity: 1, mobility: 2, nutrition: 2, friction: 1 })).toBe(10)
    expect(bradenTotal({ sensory: 2 })).toBe(null)
    expect(morseTotal({ history: '25', iv: '20' })).toBe(45)
    const chart = fluidChart([
      { entry_type: 'IV Fluid', volume_ml: 1000, recorded_at: '2026-11-15T08:00:00' },
      { entry_type: 'Urine Output', volume_ml: 600, recorded_at: '2026-11-15T20:00:00' },
      { entry_type: 'Oral Intake', volume_ml: 200, recorded_at: '2026-11-16T05:00:00' },
      { entry_type: 'Urine Output', volume_ml: 300, recorded_at: '2026-11-16T09:00:00' },
    ])
    expect(chart.map((d) => [d.day, d.intake, d.output, d.balance, d.cumulative])).toEqual([['2026-11-15', 1200, 600, 600, 600], ['2026-11-16', 0, 300, -300, 300]])
  })
})
