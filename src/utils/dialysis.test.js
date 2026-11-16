import { describe, expect, it } from 'vitest'
import { adequacy, canScheduleDialysis, calculateSessionRisk } from './dialysis'

describe('dialysis adequacy (mirrors the database)', () => {
  it('URR and Daugirdas II Kt/V', () => {
    expect(adequacy(150, 50, 240, 3, 70)).toEqual({ urr: 66.7, ktv: 1.32 })
    expect(adequacy(150, 60, 240, 3, 70).urr).toBe(60)
    expect(adequacy(150, '', 240, 3, 70)).toEqual({ urr: null, ktv: null })
    expect(adequacy(50, 60)).toEqual({ urr: null, ktv: null })
  })
})

describe('dialysis utils', () => {
  it('denies dialysis when vascular access is compromised', () => {
    expect(canScheduleDialysis({ accessStatus: 'inadequate', weightGainKg: 1.2, potassium: 5.4 })).toBe(false)
  })

  it('allows dialysis for stable patients with valid access', () => {
    expect(canScheduleDialysis({ accessStatus: 'good', weightGainKg: 1.2, potassium: 5.4 })).toBe(true)
  })

  it('escalates risk for hyperkalaemia and unstable vitals', () => {
    expect(calculateSessionRisk({ potassium: 6.8, bloodPressure: 84, heartRate: 120 })).toBe('High')
  })
})
