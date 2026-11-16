export const COMMON_ICD10 = [
  { code: 'J18.9', desc: 'Pneumonia, unspecified' },
  { code: 'A09', desc: 'Diarrhoea and gastroenteritis' },
  { code: 'B50.9', desc: 'Malaria, unspecified' },
  { code: 'J06.9', desc: 'Acute upper respiratory infection' },
  { code: 'K29.7', desc: 'Gastritis, unspecified' },
  { code: 'I10', desc: 'Essential (primary) hypertension' },
  { code: 'E11.9', desc: 'Type 2 diabetes mellitus' },
  { code: 'J45.9', desc: 'Asthma, unspecified' },
  { code: 'N39.0', desc: 'Urinary tract infection' },
  { code: 'Z34.9', desc: 'Supervision of normal pregnancy' },
  { code: 'O80', desc: 'Normal delivery' },
  { code: 'S09.9', desc: 'Unspecified injury of head' },
  { code: 'R50.9', desc: 'Fever, unspecified' },
  { code: 'A15.0', desc: 'Tuberculosis of lung' },
  { code: 'B24', desc: 'HIV disease' },
]

function toDiagnosis(item) {
  return { code: item.code, description: item.desc }
}

export function findIcd10ByCode(code) {
  const normalizedCode = String(code || '').trim().toLowerCase()
  const match = COMMON_ICD10.find(item => item.code.toLowerCase() === normalizedCode)
  return match ? toDiagnosis(match) : null
}

export function searchIcd10Diagnoses(query, { signal } = {}) {
  if (signal?.aborted) return []

  const term = String(query || '').trim().toLowerCase()
  if (term.length < 2) return []

  return COMMON_ICD10
    .filter(item => item.code.toLowerCase().includes(term) || item.desc.toLowerCase().includes(term))
    .map(toDiagnosis)
}
/**
 * Full search against the ICD-10 reference table (icd_search RPC, includes ICD-11 codes where mapped).
 * Falls back to the built-in common list when offline or before the reference migration is installed.
 * Returns [{ code, description, icd11_code }].
 */
export async function searchDiagnoses(query, { signal, limit = 20 } = {}) {
  const term = String(query || '').trim()
  if (term.length < 2 || signal?.aborted) return []
  try {
    const { default: supabase } = await import('../supabase')
    const { data, error } = await supabase.rpc('icd_search', { p_query: term, p_limit: limit })
    if (signal?.aborted) return []
    if (!error && Array.isArray(data) && data.length) {
      return data.map(row => ({ code: row.code, description: row.title, icd11_code: row.icd11_code || null }))
    }
  } catch (_) { /* offline or not installed */ }
  return searchIcd10Diagnoses(term, { signal })
}
