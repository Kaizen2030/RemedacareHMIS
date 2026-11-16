export const PPB_DRUG_CATALOGUE = []

function normalizeDrugName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function validatePrescriptionPpb(drugs = []) {
  return (Array.isArray(drugs) ? drugs : []).map(drug => {
    const drugName = String(drug?.drug_name || '').trim()
    const genericName = String(drug?.generic_name || '').trim()
    const searchName = normalizeDrugName(genericName || drugName)
    const match = PPB_DRUG_CATALOGUE.find(entry => {
      const names = [entry.name, entry.generic_name, ...(entry.aliases || [])].map(normalizeDrugName)
      return searchName && names.includes(searchName)
    })

    if (match) {
      return {
        drug_name: drugName,
        generic_name: genericName,
        approved: Boolean(match.approved),
        sha_reimbursable: Boolean(match.sha_reimbursable),
        ppb_reg_number: match.ppb_reg_number || null,
        catalogue_status: 'verified',
      }
    }

    return {
      drug_name: drugName,
      generic_name: genericName,
      approved: null,
      sha_reimbursable: null,
      ppb_reg_number: null,
      catalogue_status: 'unverified',
    }
  })
}