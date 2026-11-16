import { describe, expect, it } from 'vitest'
import { growthAssess, lmsAt, referenceCurve, valueAtZ, zFromLms } from './growth'
import { WHO } from './growthReference'
import { scoreAssessment, templateFor } from './specialtyTemplates'

describe('WHO growth z-scores', () => {
  it('reference medians match the WHO standard', () => {
    expect(WHO.wfa['1'][0]).toEqual([0, 0.3487, 3.3464, 0.14602])   // boys, birth: median 3.3464 kg
    expect(lmsAt(WHO.wfa['1'], 0)[1]).toBe(3.3464)
    expect(zFromLms(3.3464, lmsAt(WHO.wfa['1'], 0), true)).toBe(0)
  })
  it('LMS round trip and the restricted method beyond ±3 SD', () => {
    const lms = lmsAt(WHO.wfa['2'], 365)
    expect(zFromLms(valueAtZ(lms, -2), lms, true)).toBe(-2)
    const sd3 = valueAtZ(lms, 3), sd2 = valueAtZ(lms, 2)
    expect(zFromLms(sd3 + (sd3 - sd2), lms, true)).toBe(4)   // WHO: one (SD3 − SD2) step beyond +3 is +4
  })
  it('classifies malnutrition, stunting and head size', () => {
    const sam = growthAssess({ sex: 'male', age_days: 400, weight_kg: 7.2, length_cm: 70, muac_cm: 11.3 })
    expect(sam.flags[0]).toMatch(/^Severe acute malnutrition/)
    expect(growthAssess({ sex: 'female', age_days: 200, weight_kg: 6, oedema: true }).flags[0]).toMatch(/oedema/)
    const ok = growthAssess({ sex: 'female', age_days: 365, weight_kg: 8.9, length_cm: 74, measured: 'length', hc_cm: 45 })
    expect(ok.flags).toEqual([])
    expect(Math.abs(ok.waz)).toBeLessThan(0.5)
    expect(growthAssess({ sex: 'male', age_days: 3000, weight_kg: 20 }).waz).toBe(null)
    expect(referenceCurve('wfa', 'male')).toHaveLength(5)
  })
  it('standing height under 2 years is converted to length (+0.7 cm)', () => {
    const a = growthAssess({ sex: 'male', age_days: 500, length_cm: 79.3, measured: 'height' })
    const b = growthAssess({ sex: 'male', age_days: 500, length_cm: 80, measured: 'length' })
    expect(a.haz).toBe(b.haz)
  })
})

describe('orthopaedic and oncology templates', () => {
  it('picks the templates and scores them', () => {
    expect(templateFor('Orthopaedics')).toBe('orthopaedics')
    expect(templateFor('Oncology')).toBe('oncology')
    const o = scoreAssessment('orthopaedics', { fracture_type: 'open', gustilo: 'IIIA', passive_stretch_pain: 'yes' })
    expect(o.scores.fracture).toBe('open IIIA')
    expect(o.flags).toHaveLength(3)
    const c = scoreAssessment('oncology', { height_cm: 170, weight_kg: 70, dose_mg_m2: 60, platelets: 90 })
    expect(c.scores).toMatchObject({ bsa: 1.82, planned_dose_mg: 109 })
    expect(c.flags).toEqual(['Platelets below 100 ×10⁹/L: delay the cycle'])
  })
})
