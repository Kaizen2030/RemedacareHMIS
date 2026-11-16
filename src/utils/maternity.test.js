import { describe, expect, it } from 'vitest'
import { getMaternalRiskLevel, canAdmitForDelivery } from './maternity'
import { ancSchedule, eddFromLmp, gestation, immunisationStatus, partographAnalysis } from './maternity'

describe('maternity rules', () => {
  it('EDD and gestation', () => {
    expect(eddFromLmp('2026-01-01')).toBe('2026-10-08')
    expect(gestation('2026-01-01', '2026-03-12')).toMatchObject({ weeks: 10, days: 0, label: '10w 0d' })
    expect(gestation('2026-05-01', '2026-03-12')).toBeNull()
  })
  it('8-contact schedule: done, missed and upcoming', () => {
    const lmp = '2026-01-01'
    const s = ancSchedule(lmp, [{ ga_weeks: 11 }, { ga_weeks: 21 }], '2026-07-10') // ~27 weeks
    expect(s.map((c) => c.state)).toEqual(['done', 'done', 'missed', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
    expect(s[2]).toMatchObject({ contact: 3, week: 26, due: '2026-07-02' })
  })
  it('partograph alert and action lines', () => {
    const t0 = new Date('2026-11-14T06:00:00Z').getTime()
    const at = (h, cm, extra = {}) => ({ recorded_at: new Date(t0 + h * 3600000).toISOString(), cervix_cm: cm, ...extra })
    expect(partographAnalysis([at(0, 3)]).status).toBe('latent')
    expect(partographAnalysis([at(0, 4), at(4, 8)]).status).toBe('normal')
    expect(partographAnalysis([at(0, 4), at(4, 6)]).status).toBe('alert')
    const late = partographAnalysis([at(0, 4), at(8, 6, { fetal_heart_rate: 100, liquor: 'M' })])
    expect(late.status).toBe('action')
    expect(late.warnings.join(' ')).toMatch(/ACTION line/)
    expect(late.warnings.join(' ')).toMatch(/Fetal heart rate/)
    expect(late.warnings.join(' ')).toMatch(/Meconium/)
    expect(partographAnalysis([at(0, 5), at(3, 10)]).status).toBe('fully_dilated')
  })
  it('KEPI immunisation status', () => {
    const s = immunisationStatus('2026-01-01', [{ vaccine: 'BCG', given_on: '2026-01-01' }], '2026-03-01')
    const by = Object.fromEntries(s.map((v) => [v.code, v.state]))
    expect(by.BCG).toBe('given')
    expect(by.OPV0).toBe('window_passed')
    expect(by.PENTA1).toBe('due')
    expect(by.PENTA2).toBe('upcoming')
    expect(by.MR1).toBe('upcoming')
  })
})

// ── Original tests (kept from the previous version)


describe('maternity utils', () => {
  it('classifies high-risk deliveries correctly', () => {
    expect(getMaternalRiskLevel({ age: 16, bloodPressure: 165, gestationWeeks: 35, previousCesarean: true })).toBe('High')
  })

  it('allows emergency admission when delivery is imminent', () => {
    expect(canAdmitForDelivery({ dilationCm: 6, contractions: 3, riskLevel: 'Medium' })).toBe(true)
  })

  it('blocks routine admission when the patient is not yet in active labour', () => {
    expect(canAdmitForDelivery({ dilationCm: 2, contractions: 1, riskLevel: 'Low' })).toBe(false)
  })
})
