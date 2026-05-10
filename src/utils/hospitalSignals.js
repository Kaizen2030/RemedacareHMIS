import { normalizeDrugText } from './pharmacy'

const MATCHABLE_STATUSES = new Set(['pending', 'approved', 'released', 'dispensed'])

function isSIR(value) {
  return ['S', 'I', 'R', 'NT'].includes(String(value || '').trim().toUpperCase())
}

export function formatAntibioticLabel(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

export function normalizeSusceptibilityKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeProfileEntry(key, value) {
  const normalizedKey = normalizeSusceptibilityKey(value?.key || key)
  const sir = String(value?.sir ?? value ?? '').trim().toUpperCase()
  if (!normalizedKey || !isSIR(sir)) return null

  const label = String(value?.label || formatAntibioticLabel(normalizedKey)).trim() || formatAntibioticLabel(normalizedKey)
  return { key: normalizedKey, label, sir }
}

export function normalizeSusceptibilityProfile(profile) {
  const rawEntries = Array.isArray(profile)
    ? profile.map(entry => [entry?.key || entry?.label || '', entry])
    : Object.entries(profile || {})

  return rawEntries.reduce((acc, [key, value]) => {
    const entry = normalizeProfileEntry(key, value)
    if (entry) acc[entry.key] = entry
    return acc
  }, {})
}

function safeTime(value) {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function getSusceptibilityEntries(result, { includeNotTested = false } = {}) {
  const merged = new Map()

  Object.values(normalizeSusceptibilityProfile(result?.susceptibility_profile)).forEach(entry => {
    if (!includeNotTested && entry.sir === 'NT') return
    merged.set(entry.key, entry)
  })

  Object.entries(result || {}).forEach(([key, value]) => {
    const sir = String(value || '').trim().toUpperCase()
    if (!isSIR(sir)) return
    if (!includeNotTested && sir === 'NT') return

    const normalizedKey = normalizeSusceptibilityKey(key)
    const existing = merged.get(normalizedKey)
    merged.set(normalizedKey, {
      key: normalizedKey,
      label: existing?.label || formatAntibioticLabel(normalizedKey),
      sir,
    })
  })

  return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label))
}

export function getSusceptibilityProfile(result) {
  const entries = getSusceptibilityEntries(result, { includeNotTested: true })
  return {
    entries,
    resistant: entries.filter(entry => entry.sir === 'R').map(entry => entry.label),
    sensitive: entries.filter(entry => entry.sir === 'S').map(entry => entry.label),
    intermediate: entries.filter(entry => entry.sir === 'I').map(entry => entry.label),
    notTested: entries.filter(entry => entry.sir === 'NT').map(entry => entry.label),
  }
}

function antibioticMatchesDrug(antibiotic, drugName) {
  const agent = normalizeDrugText(antibiotic)
  const drug = normalizeDrugText(drugName)
  if (!agent || !drug) return false
  return agent === drug || agent.includes(drug) || drug.includes(agent)
}

function collectHighRiskFlags(result) {
  const flags = []
  if (result?.esbl) flags.push('ESBL')
  if (result?.mrsa) flags.push('MRSA')
  if (result?.vre) flags.push('VRE')
  if (result?.carbapenem_r) flags.push('Carbapenem-R')
  return flags
}

function matchesPatient(result, prescription) {
  const resultPatientId = result?.patient_id ? String(result.patient_id) : ''
  const rxPatientId = prescription?.patient_id ? String(prescription.patient_id) : String(prescription?.patients?.id || '')
  if (resultPatientId && rxPatientId && resultPatientId === rxPatientId) return true

  const resultName = normalizeDrugText(result?.patient_name)
  const rxName = normalizeDrugText(prescription?.patient_name || prescription?.patients?.full_name)
  return !!resultName && !!rxName && resultName === rxName
}

function buildSuggestedNote(item) {
  const parts = []
  const organism = item.organism || 'culture isolate'
  const sample = item.sampleType ? `${item.sampleType.toLowerCase()} ` : ''

  parts.push(`Reviewed ${sample}${organism} result`)
  if (item.highRiskFlags.length > 0) parts.push(`flags: ${item.highRiskFlags.join(', ')}`)
  if (item.resistantMatches.length > 0) {
    parts.push(`current therapy shows resistance to ${item.resistantMatches.map(match => match.drugName).join(', ')}`)
  } else if (item.activePrescriptionMatches.length > 0) {
    parts.push(`checked active therapy: ${item.activePrescriptionMatches.map(match => `${match.drugName} (${match.classification})`).join(', ')}`)
  }
  if (item.sensitiveAgents.length > 0) {
    parts.push(`susceptible options include ${item.sensitiveAgents.slice(0, 4).join(', ')}`)
  }
  parts.push('please review with prescriber for stewardship action')

  return parts.join('; ')
}

function latestInterventionByResult(interventions = []) {
  return (interventions || []).reduce((acc, row) => {
    const key = String(row?.microbiology_result_id || '')
    if (!key) return acc

    const current = acc[key]
    const currentTime = safeTime(current?.updated_at || current?.created_at)
    const nextTime = safeTime(row?.updated_at || row?.created_at)
    if (!current || nextTime >= currentTime) acc[key] = row
    return acc
  }, {})
}

export function getMicrobiologyResultTimestamp(result) {
  return result?.reported_date || result?.updated_at || result?.created_at || result?.collection_date || null
}

export function buildAmrInterventions({ results = [], prescriptions = [], interventions = [], maxAgeDays = 21 } = {}) {
  const threshold = maxAgeDays == null ? 0 : Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000)
  const activePrescriptions = (prescriptions || []).filter(rx => {
    const status = String(rx?.status || '').trim().toLowerCase()
    return MATCHABLE_STATUSES.has(status)
  })
  const interventionIndex = latestInterventionByResult(interventions)

  return (results || [])
    .filter(result => result?.organism_identified && (result?.patient_id || result?.patient_name))
    .map(result => {
      const reportedAt = getMicrobiologyResultTimestamp(result)
      const reportedTime = safeTime(reportedAt)
      const highRiskFlags = collectHighRiskFlags(result)
      const susceptibility = getSusceptibilityProfile(result)
      const resistant = susceptibility.resistant
      const sensitive = susceptibility.sensitive
      const intermediate = susceptibility.intermediate
      const relatedPrescriptions = activePrescriptions.filter(rx => matchesPatient(result, rx))
      const latestIntervention = interventionIndex[String(result.id)] || null

      const activePrescriptionMatches = relatedPrescriptions.map(rx => {
        const resistantMatch = resistant.find(agent => antibioticMatchesDrug(agent, rx.drug_name))
        if (resistantMatch) {
          return { id: rx.id, drugName: rx.drug_name, status: rx.status, classification: 'resistant', antibiotic: resistantMatch, visitId: rx.visit_id || null }
        }

        const sensitiveMatch = sensitive.find(agent => antibioticMatchesDrug(agent, rx.drug_name))
        if (sensitiveMatch) {
          return { id: rx.id, drugName: rx.drug_name, status: rx.status, classification: 'sensitive', antibiotic: sensitiveMatch, visitId: rx.visit_id || null }
        }

        const intermediateMatch = intermediate.find(agent => antibioticMatchesDrug(agent, rx.drug_name))
        if (intermediateMatch) {
          return { id: rx.id, drugName: rx.drug_name, status: rx.status, classification: 'intermediate', antibiotic: intermediateMatch, visitId: rx.visit_id || null }
        }

        return { id: rx.id, drugName: rx.drug_name, status: rx.status, classification: 'unmatched', antibiotic: null, visitId: rx.visit_id || null }
      })

      const resistantMatches = activePrescriptionMatches.filter(match => match.classification === 'resistant')
      const currentAdvice = latestIntervention?.recommendation || result.ai_suggestion || ''
      const decisionText = String(latestIntervention?.prescriber_decision || latestIntervention?.status || '').trim().toLowerCase()
      const awaitingPrescriber = !!latestIntervention && !['accepted', 'rejected', 'actioned', 'closed', 'completed'].includes(decisionText)
      const requiresReview = !latestIntervention && !String(result?.ai_suggestion || '').trim()
      const requiresAttention = (requiresReview || awaitingPrescriber) && (highRiskFlags.length > 0 || resistantMatches.length > 0 || activePrescriptionMatches.length > 0)
      const isRecent = reportedTime === 0 || reportedTime >= threshold
      const severity = highRiskFlags.length > 0 || resistantMatches.length > 0
        ? 'high'
        : activePrescriptionMatches.length > 0
          ? 'medium'
          : 'info'

      const item = {
        id: result.id,
        patientId: result.patient_id || null,
        patientName: result.patient_name || 'Unknown patient',
        organism: result.organism_identified,
        sampleType: result.sample_type || null,
        department: result.ward_department || null,
        reportedAt,
        visitId: result.visit_id || activePrescriptionMatches.find(match => match.visitId)?.visitId || null,
        highRiskFlags,
        resistantAgents: resistant,
        sensitiveAgents: sensitive,
        intermediateAgents: intermediate,
        notTestedAgents: susceptibility.notTested,
        susceptibilityEntries: susceptibility.entries,
        activePrescriptionMatches,
        resistantMatches,
        currentAdvice,
        latestIntervention,
        awaitingPrescriber,
        severity,
        requiresReview,
        requiresAttention,
        isRecent,
      }

      return {
        ...item,
        suggestedNote: buildSuggestedNote(item),
      }
    })
    .filter(item => item.isRecent)
    .sort((a, b) => safeTime(b.reportedAt) - safeTime(a.reportedAt))
}

export function summarizeAmrInterventions(items = []) {
  return {
    total: items.length,
    pendingReview: items.filter(item => item.requiresReview).length,
    needingAttention: items.filter(item => item.requiresAttention).length,
    awaitingPrescriber: items.filter(item => item.awaitingPrescriber).length,
    highSeverity: items.filter(item => item.severity === 'high').length,
    resistantOverlap: items.reduce((sum, item) => sum + item.resistantMatches.length, 0),
  }
}
