export function daysInStorage(admissionDate) {
  if (!admissionDate) return 0
  const start = new Date(admissionDate).getTime()
  const now = Date.now()
  return Math.max(0, Math.ceil((now - start) / (1000 * 60 * 60 * 24)))
}

export function getOverstayFee(dayCount, dailyRate = 1500) {
  return Math.max(0, dayCount * dailyRate)
}

export function canRequestBodyRelease(record = {}) {
  const hasIdVerified = record.id_verified === true || record.idVerified === true
  const legalCase = record.medico_legal === true || record.medicoLegal === true
  const hasAuthority = record.authority_document || record.authorityDocument

  if (!hasIdVerified) {
    return { allowed: false, reason: 'ID verification missing' }
  }

  if (legalCase && !hasAuthority) {
    return { allowed: false, reason: 'Authority document required for medico-legal release' }
  }

  return { allowed: true, reason: 'Release can be requested' }
}

export function canReleaseBody(record = {}) {
  const requestCheck = canRequestBodyRelease(record)
  if (!requestCheck.allowed) return requestCheck
  const requestedBy = String(record.release_requested_by_user_id || '').trim()
  const verifiedBy = String(record.release_verified_by_user_id || '').trim()

  if (!requestedBy || !verifiedBy) {
    return { allowed: false, reason: 'A second authenticated staff approval is required' }
  }
  if (requestedBy === verifiedBy) {
    return { allowed: false, reason: 'Release request and approval must use different staff accounts' }
  }

  return { allowed: true, reason: 'Release allowed' }
}

export function getReleaseStatus(record = {}) {
  const outcome = canReleaseBody(record)
  return outcome.allowed ? 'Ready to release' : outcome.reason
}
