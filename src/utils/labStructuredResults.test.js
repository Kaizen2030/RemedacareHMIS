import { describe, expect, it } from 'vitest'
import {
  buildCriticalAlerts,
  buildStructuredDefaults,
  calculateEgfr,
  evaluateStructuredValue,
  matchStructuredTemplate,
  normalizeSusceptibilityChoice,
  summarizeStructuredResult,
} from './labStructuredResults'

describe('structured lab result helpers', () => {
  it('matches a renal panel and initializes its fields', () => {
    const template = matchStructuredTemplate('Urea & Electrolytes', 'Biochemistry')
    expect(template.key).toBe('rfts')
    expect(buildStructuredDefaults(template)).toHaveProperty('egfr', '')
  })

  it('evaluates values and returns critical alerts in structured summaries', () => {
    const renalTemplate = matchStructuredTemplate('Urea & Electrolytes')
    const bloodCountTemplate = matchStructuredTemplate('Full Blood Count')
    expect(evaluateStructuredValue(renalTemplate.fields.find(field => field.key === 'potassium'), 7)).toMatchObject({ status: 'high', critical: true })
    expect(buildCriticalAlerts(bloodCountTemplate, { platelets: 10 })).toHaveLength(1)
    expect(summarizeStructuredResult(bloodCountTemplate, { haemoglobin: 12.4 }).resultText).toContain('12.4')
  })

  it('calculates eGFR from patient and creatinine values and normalizes S/I/R results', () => {
    expect(calculateEgfr({ creatinine: 88.4 }, { age: 40, gender: 'Male' })).toBeGreaterThan(0)
    expect(normalizeSusceptibilityChoice('susceptible')).toBe('S')
    expect(normalizeSusceptibilityChoice('intermediate')).toBe('I')
    expect(normalizeSusceptibilityChoice('R')).toBe('R')
  })
})