import { describe, expect, it } from 'vitest'
import { PPB_DRUG_CATALOGUE, validatePrescriptionPpb } from './ppbCatalogue'

describe('PPB prescription validation', () => {
  it('does not claim approval when no authoritative catalogue data is bundled', () => {
    expect(PPB_DRUG_CATALOGUE).toEqual([])
    expect(validatePrescriptionPpb([{ drug_name: 'Example medicine', generic_name: 'example' }])).toEqual([{
      drug_name: 'Example medicine',
      generic_name: 'example',
      approved: null,
      sha_reimbursable: null,
      ppb_reg_number: null,
      catalogue_status: 'unverified',
    }])
  })

  it('returns an empty result for an empty prescription list', () => {
    expect(validatePrescriptionPpb()).toEqual([])
  })
})