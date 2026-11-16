export const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+']
export const BLOOD_UNIT_STATUSES = ['Pending', 'Quarantine', 'Available', 'Reserved', 'Issued', 'Discarded']
export const BLOOD_SCREENING_STATUSES = ['pending', 'recheck', 'clear']
export const BLOOD_UNIT_TRANSITIONS = {
  Pending: ['Pending', 'Quarantine', 'Available', 'Discarded'],
  Quarantine: ['Quarantine', 'Available', 'Discarded'],
  Available: ['Available', 'Reserved', 'Quarantine', 'Discarded'],
  Reserved: ['Reserved', 'Available', 'Quarantine', 'Discarded'],
  Issued: ['Issued'],
  Discarded: ['Discarded'],
}

export function canSetBloodUnitStatus(status, screeningStatus) {
  return BLOOD_UNIT_STATUSES.includes(status)
    && status !== 'Issued'
    && (status !== 'Available' || ['clear', 'negative'].includes(String(screeningStatus || '').trim().toLowerCase()))
}

export function canTransitionBloodUnitStatus(unit = {}, nextStatus) {
  if (!(BLOOD_UNIT_TRANSITIONS[unit.status] || []).includes(nextStatus) || nextStatus === 'Issued') return false
  if (['Available', 'Reserved'].includes(nextStatus)) {
    const screening = String(unit.screening_status || '').trim().toLowerCase()
    if (!['clear', 'negative'].includes(screening)) return false
    if (unit.expiry_at && new Date(unit.expiry_at).getTime() <= Date.now()) return false
  }
  return true
}

export const BLOOD_COMPATIBILITY = {
  'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  'O+': ['O+', 'A+', 'B+', 'AB+'],
  'A-': ['A-', 'A+', 'AB-', 'AB+'],
  'A+': ['A+', 'AB+'],
  'B-': ['B-', 'B+', 'AB-', 'AB+'],
  'B+': ['B+', 'AB+'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB+'],
}

export function normalizeBloodGroup(group = '') {
  return String(group || '').trim().toUpperCase().replace(/\s+/g, '')
}

export function isCompatibleBloodGroup(donorGroup, patientGroup) {
  const donor = normalizeBloodGroup(donorGroup)
  const patient = normalizeBloodGroup(patientGroup)

  if (!donor || !patient) return false
  if (donor === patient) return true

  return (BLOOD_COMPATIBILITY[donor] || []).includes(patient)
}

export function isBloodUnitEligibleForIssue(unit = {}) {
  if (!unit) return false
  const status = String(unit.status || '').trim()
  const screeningStatus = String(unit.screening_status || unit.screeningStatus || '').trim().toLowerCase()

  if (status === 'Expired' || status === 'Discarded' || status === 'Quarantine') return false

  const expiry = unit.expiry_at || unit.expiryAt
  if (expiry && new Date(expiry).getTime() < Date.now()) return false

  if (screeningStatus && screeningStatus !== 'clear' && screeningStatus !== 'negative') return false

  if (status !== 'Available' && status !== 'Reserved') return false

  return true
}

export function canIssueBloodUnit(unit = {}, patientGroup = '') {
  const donorGroup = normalizeBloodGroup(unit.group || unit.blood_group)
  const patient = normalizeBloodGroup(patientGroup)

  if (!isBloodUnitEligibleForIssue(unit)) {
    return {
      allowed: false,
      reason: 'Unit is not valid for issue',
    }
  }

  if (!donorGroup || !patient) {
    return {
      allowed: false,
      reason: 'Donor and patient blood groups are required',
    }
  }

  if (!isCompatibleBloodGroup(donorGroup, patient)) {
    return {
      allowed: false,
      reason: 'Blood group is incompatible for this patient',
    }
  }

  return {
    allowed: true,
    reason: 'Issue allowed',
  }
}

export function determineExpiryAlertState(unit = {}) {
  const expiry = unit.expiry_at || unit.expiryAt
  if (!expiry) {
    return { label: 'No expiry', tone: 'neutral' }
  }

  const expiryDate = new Date(expiry)
  const differenceInDays = Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

  if (differenceInDays <= 0) {
    return { label: 'Expired', tone: 'danger' }
  }

  if (differenceInDays <= 7) {
    return { label: `Expires in ${differenceInDays} day(s)`, tone: 'warning' }
  }

  return { label: `Expires in ${differenceInDays} day(s)`, tone: 'ok' }
}
