import { describe, expect, it } from 'vitest'
import { activeInfusions, infusionRate, isHighAlert, pbw, sofa, ventCheck } from './icuScores'

describe('ICU scores (mirror the database)', () => {
  it('SOFA matches the database test cases', () => {
    const sick = sofa({ pao2: 80, fio2: 50, resp_support: true, platelets: 40, bilirubin: 110, noradrenaline: 0.2, gcs: 8, creatinine: 350 })
    expect(sick.parts).toEqual({ respiration: 3, coagulation: 3, liver: 3, cardiovascular: 4, cns: 3, renal: 3 })
    expect(sick.total).toBe(19)
    expect(sick.pf_ratio).toBe(160)
    expect(sofa({ pao2_kpa: 13, fio2: 0.21, platelets: 250, bilirubin: 10, map: 85, gcs: 15, creatinine: 70 }).total).toBe(0)
    expect(sofa({ pao2: 150, fio2: 0.8 }).parts.respiration).toBe(2)
    expect(sofa({ urine_24h: 150 }).parts.renal).toBe(4)
    expect(sofa({ gcs: 15, platelets: 90 }).total).toBe(2)
  })
  it('PBW, ventilator checks and pump rates', () => {
    expect(pbw(170, 'male')).toBe(66)
    const v = ventCheck({ vt: 600, peep: 5, pplat: 32, fio2: 70 }, { height_cm: 170, sex: 'male' })
    expect(v.calc).toMatchObject({ vt_ml_kg: 9.1, driving_pressure: 27, target_vt: [396, 528] })
    expect(v.flags).toHaveLength(4)
    expect(infusionRate({ dose: 0.1, dose_unit: 'mcg/kg/min', amount: 4, volume_ml: 50, weight_kg: 70 })).toBe(5.3)
    expect(infusionRate({ dose: 1000, dose_unit: 'mg/h', amount: 1000, volume_ml: 100 })).toBe(100)
    expect(infusionRate({ dose: 2, dose_unit: 'units/h', amount: 50, volume_ml: 50 })).toBe(2)
    expect(infusionRate({ dose: 2, dose_unit: 'units/h' })).toBe(null)
    expect(isHighAlert('Noradrenaline')).toBe(true)
    expect(isHighAlert('Ceftriaxone')).toBe(false)
  })
  it('active infusions ignore stopped and struck-out drugs', () => {
    const e = (drug, action, t, extra = {}) => ({ kind: 'infusion', recorded_at: `2026-11-15T0${t}:00:00Z`, data: { drug, action }, ...extra })
    const act = activeInfusions([e('Noradrenaline', 'start', 1), e('Noradrenaline', 'stop', 3), e('Midazolam', 'start', 2), e('Fentanyl', 'start', 2, { struck_out_at: 'x' })])
    expect(act.map((x) => x.data.drug)).toEqual(['Midazolam'])
  })
})
