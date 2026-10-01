import { describe, expect, it } from 'vitest'
import { inferChronicConditionHint } from './chronicDisease'

describe('inferChronicConditionHint', () => {
  it('recognizes a condition from patient history', () => {
    expect(inferChronicConditionHint('Type 2 diabetes, hypertension')).toBe('Type 2 Diabetes')
  })

  it('checks later clinical text when history has no recognized condition', () => {
    expect(inferChronicConditionHint('No known conditions', 'Review for chronic kidney disease')).toBe('Chronic Kidney Disease')
  })

  it('returns an empty hint when no chronic condition is recognized', () => {
    expect(inferChronicConditionHint('', 'Acute headache and fever')).toBe('')
  })
})