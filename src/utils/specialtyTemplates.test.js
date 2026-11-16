import { describe, expect, it } from 'vitest'
import { scoreAssessment, summarise, templateFor, vaDecimal, whoVisionCategory } from './specialtyTemplates'

describe('specialty templates', () => {
  it('picks the template from the clinic name', () => {
    expect(templateFor('Mental Health & Psychiatry')).toBe('mental_health')
    expect(templateFor('Eye Clinic')).toBe('eye')
    expect(templateFor('Ophthalmology')).toBe('eye')
    expect(templateFor('Dental')).toBe('dental')
    expect(templateFor('ENT')).toBe('ent')
    expect(templateFor('Physiotherapy')).toBe('physio')
    expect(templateFor('Cardiology')).toBe('cardiology')
    expect(templateFor('Dermatology')).toBe('dermatology')
    expect(templateFor('OPD / Outpatient')).toBe(null)
  })
  it('PHQ-9 bands and the suicide flags', () => {
    const r = scoreAssessment('mental_health', { q1: 3, q2: 3, q3: 2, q4: 2, q5: 1, q6: 2, q7: 1, q8: 1, q9: 1, c1: 'yes', c4: 'yes' })
    expect(r.scores).toMatchObject({ phq9: 16, phq9_band: 'Moderately severe', suicide_risk: 'high' })
    expect(r.flags[0]).toMatch(/^HIGH suicide risk/)
    expect(scoreAssessment('mental_health', { q9: 1 }).flags[0]).toMatch(/item 9 positive/)
    expect(scoreAssessment('mental_health', { q1: 1 }).scores.phq9).toBeUndefined()
  })
  it('visual acuity and WHO categories', () => {
    expect(vaDecimal('6/18')).toBe(0.333)
    expect(vaDecimal('20/40')).toBe(0.5)
    expect(vaDecimal('CF')).toBe(0.02)
    expect(whoVisionCategory(0.333)).toBe('Mild impairment')
    expect(whoVisionCategory(0.04)).toBe('Blindness')
    const e = scoreAssessment('eye', { va_r: '6/60', va_l: '6/36', ph_l: '6/9', iop_l: 30 })
    expect(e.scores.who_category).toBe('Moderate impairment')
    expect(e.flags).toEqual(['Raised intraocular pressure left (30 mmHg): glaucoma assessment', 'Moderate impairment (better eye): refer / register for low-vision services', 'Pinhole improves the left eye: refractive error — refraction needed'])
  })
  it('DMFT, Barthel, CHA2DS2-VASc and the summary', () => {
    expect(scoreAssessment('dental', { teeth: { 16: 'caries', 36: 'missing', 46: 'filled', 21: 'rct' } }).scores).toEqual({ D: 1, M: 1, F: 1, DMFT: 3 })
    const all = { feeding: 10, bathing: 5, grooming: 5, dressing: 10, bowels: 10, bladder: 10, toilet: 10, transfers: 15, mobility: 15, stairs: 10 }
    expect(scoreAssessment('physio', all).scores).toEqual({ barthel: 100, barthel_band: 'Independent' })
    const c = scoreAssessment('cardiology', { af: 'yes', age: 70, sex: 'male', htn: true })
    expect(c.scores).toEqual({ cha2ds2_vasc: 2, anticoagulation: 'Recommended' })
    expect(summarise('cardiology', { af: 'yes', ecg: 'AF, rate 110' }, c)).toMatch(/Cardiology assessment\. cha2ds2 vasc: 2; anticoagulation: Recommended\. ECG: AF, rate 110\. Alerts: CHA₂DS₂-VASc 2/)
  })
})
