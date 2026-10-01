import { describe, expect, it } from 'vitest'
import {
  buildBilingualInstruction,
  getAbnormalVitalAlerts,
  getAwareClassification,
  getBmiSummary,
  hasMalariaDiagnosis,
  hasTuberculosisDiagnosis,
  needsPregnancyPrompt,
} from './consultationClinical'

describe('consultation clinical helpers', () => {
  it('builds bilingual use instructions and classifies common AWaRe antibiotics', () => {
    expect(buildBilingualInstruction({ drug_name: 'Amoxicillin', dosage: '500 mg', frequency: 'Twice daily', duration: '5 days' }))
      .toContain('mara mbili kwa siku')
    expect(getAwareClassification('Ceftriaxone 1g')).toBe('Watch')
    expect(getAwareClassification('Unknown medicine')).toBe('')
  })

  it('summarizes valid BMI and flags markedly abnormal vital signs', () => {
    expect(getBmiSummary({ weight_kg: 70, height_cm: 175 })).toMatchObject({ bmi: 22.9, category: 'Healthy range' })
    expect(getAbnormalVitalAlerts({ spo2: 88 })).toContainEqual(expect.objectContaining({ vital: 'Oxygen saturation', severity: 'critical' }))
  })

  it('identifies diagnosis prompts and restricts pregnancy prompts to the intended age range', () => {
    expect(hasMalariaDiagnosis([{ description: 'Uncomplicated malaria' }])).toBe(true)
    expect(hasTuberculosisDiagnosis([{ description: 'Pulmonary TB' }])).toBe(true)
    expect(needsPregnancyPrompt({ sex: 'Female', age: 28 })).toBe(true)
    expect(needsPregnancyPrompt({ sex: 'Female', age: 50 })).toBe(false)
  })
})