import { describe, expect, it } from 'vitest'
import { canScheduleVideoConsult, triagePriorityLevel } from './telemedicine'

describe('telemedicine utils', () => {
  it('blocks remote consultation when the patient has no device or poor internet', () => {
    expect(canScheduleVideoConsult({ patientDeviceReady: false, networkStable: true, clinicianAvailable: true })).toBe(false)
  })

  it('allows a scheduled video consult when prerequisites are met', () => {
    expect(canScheduleVideoConsult({ patientDeviceReady: true, networkStable: true, clinicianAvailable: true })).toBe(true)
  })

  it('prioritizes unstable patients ahead of routine review', () => {
    expect(triagePriorityLevel({ vitals: { pulse: 132, spo2: 89, systolic: 80 }, symptoms: ['shortness of breath'] })).toBe('Critical')
  })
})
