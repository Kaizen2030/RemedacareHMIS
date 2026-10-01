import supabase from '../supabase'
import { executeMicrobiologyQuery } from './microbiologyResults'
import { getSusceptibilityEntries } from './hospitalSignals'
import { normalizeDrugText } from './pharmacy'

function matchesDrug(drugName, antibioticName) {
  const drug = normalizeDrugText(drugName).replace(/\s+/g, '')
  const antibiotic = normalizeDrugText(antibioticName).replace(/\s+/g, '')
  return !!drug && !!antibiotic && (drug === antibiotic || drug.includes(antibiotic) || antibiotic.includes(drug))
}

export async function checkAMRAlert(drugName, patientId, hospitalId) {
  if (!String(drugName || '').trim() || !patientId || !hospitalId) return null

  const { data, error } = await executeMicrobiologyQuery(select =>
    supabase
      .from('microbiology_results')
      .select(select)
      .eq('hospital_id', hospitalId)
      .eq('patient_id', patientId)
      .order('reported_date', { ascending: false })
      .limit(16),
  )

  if (error) throw error

  for (const result of data || []) {
    const matches = getSusceptibilityEntries(result)
      .filter(entry => ['R', 'I'].includes(entry.sir) && matchesDrug(drugName, entry.label))
      .sort((left, right) => (left.sir === 'R' ? -1 : 0) - (right.sir === 'R' ? -1 : 0))

    if (matches.length === 0) continue

    const match = matches[0]
    const susceptibility = match.sir === 'R' ? 'resistant' : 'intermediate susceptibility'
    return {
      alertLevel: match.sir === 'R' ? 'critical' : 'warning',
      message: `${match.label} showed ${susceptibility} for ${result.organism_identified || 'a recent isolate'}.`,
      antibiotic: match.label,
      susceptibility: match.sir,
      organism: result.organism_identified || null,
      reportedAt: result.reported_date || result.updated_at || result.created_at || null,
    }
  }

  return null
}