import { describe, expect, it } from 'vitest'
import { findIcd10ByCode, searchIcd10Diagnoses } from './icd10Kenya'

describe('Kenya ICD-10 lookup', () => {
  it('finds a diagnosis by code without regard to case', () => {
    expect(findIcd10ByCode('i10')).toEqual({
      code: 'I10',
      description: 'Essential (primary) hypertension',
    })
  })

  it('searches by code or diagnosis description', () => {
    expect(searchIcd10Diagnoses('malaria')).toContainEqual({
      code: 'B50.9',
      description: 'Malaria, unspecified',
    })
  })

  it('returns no results for an aborted or too-short search', () => {
    expect(searchIcd10Diagnoses('i')).toEqual([])
    expect(searchIcd10Diagnoses('malaria', { signal: { aborted: true } })).toEqual([])
  })
})