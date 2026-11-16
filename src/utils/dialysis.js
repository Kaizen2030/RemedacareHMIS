// Dialysis adequacy (mirrors dialysis_adequacy() in 20261211000000_dialysis_mortuary.sql).
// URR = (1 − post/pre urea) × 100; spKt/V (Daugirdas II) = −ln(R − 0.008 t) + (4 − 3.5 R) × UF / W.
export function adequacy(pre, post, minutes = 240, ufLitres = 0, postWeight = null) {
  const a = Number(pre), b = Number(post)
  if (!(a > 0) || !(b > 0) || b >= a || pre === '' || post === '') return { urr: null, ktv: null }
  const r = b / a, t = (Number(minutes) || 240) / 60
  const inner = r - 0.008 * t
  const ktv = inner > 0 ? -Math.log(inner) + (Number(postWeight) > 0 ? ((4 - 3.5 * r) * (Number(ufLitres) || 0)) / Number(postWeight) : 0) : null
  return { urr: Math.round((1 - r) * 1000) / 10, ktv: ktv === null ? null : Math.round(ktv * 100) / 100 }
}

export const COMPLICATIONS = ['hypotension', 'cramps', 'nausea / vomiting', 'headache', 'chest pain', 'itching', 'fever / rigors', 'clotted circuit', 'access bleeding', 'arrhythmia']
export const ACCESS_LABEL = { AVF: 'AV fistula', AVG: 'AV graft', tunneled_cvc: 'Tunnelled catheter', temporary_cvc: 'Temporary catheter', pd_catheter: 'PD catheter' }
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Original helpers (kept unchanged)
export function canScheduleDialysis({ accessStatus = 'good', weightGainKg = 0, potassium = 0 }) {
  return String(accessStatus).toLowerCase() === 'good' && Number(weightGainKg || 0) <= 3 && Number(potassium || 0) <= 6
}

export function calculateSessionRisk({ potassium = 0, bloodPressure = 0, heartRate = 0 }) {
  if (Number(potassium || 0) >= 6 || Number(bloodPressure || 0) < 90 || Number(heartRate || 0) > 110) {
    return 'High'
  }

  if (Number(potassium || 0) >= 5.5 || Number(bloodPressure || 0) < 100 || Number(heartRate || 0) > 100) {
    return 'Medium'
  }

  return 'Low'
}
