// Mirrors of the database rules in supabase/migrations/20261220000000_safety_checks.sql (parity-tested on PGlite).

export const WATER_PARAMETERS = [
  { key: 'total_chlorine', label: 'Total chlorine', unit: 'mg/L', limit: '< 0.1', everyDays: 1 },
  { key: 'hardness', label: 'Hardness', unit: 'mg/L', limit: '≤ 17.1', everyDays: 1 },
  { key: 'conductivity', label: 'RO conductivity', unit: 'µS/cm', limit: '< 10 (10–20 action)', everyDays: 1 },
  { key: 'bacteria', label: 'Bacteria', unit: 'CFU/mL', limit: '< 50 (50–99 action)', everyDays: 30 },
  { key: 'endotoxin', label: 'Endotoxin', unit: 'EU/mL', limit: '< 0.125 (to 0.249 action)', everyDays: 30 },
]

/** 'pass' | 'action' | 'fail' for a dialysis water result (ISO 23500 / AAMI). */
export function dialysisWaterGrade(parameter, value) {
  const v = Number(value)
  switch (parameter) {
    case 'total_chlorine': return v < 0.1 ? 'pass' : 'fail'
    case 'hardness': return v <= 17.1 ? 'pass' : 'fail'
    case 'conductivity': return v < 10 ? 'pass' : v <= 20 ? 'action' : 'fail'
    case 'bacteria': return v < 50 ? 'pass' : v < 100 ? 'action' : 'fail'
    case 'endotoxin': return v < 0.125 ? 'pass' : v < 0.25 ? 'action' : 'fail'
    default: return null
  }
}

/** What an isolated patient needs that this bed lacks (null = suitable). */
export function bedIsolationProblem(bedIsolation, precautions = []) {
  const p = precautions || []
  if (p.length === 0) return null
  if (p.includes('airborne') && !['negative_pressure', 'single_room'].includes(bedIsolation || '')) return 'airborne isolation: a negative-pressure or single room'
  if (p.includes('protective') && bedIsolation !== 'single_room') return 'protective isolation: a single room'
  if ((p.includes('contact') || p.includes('droplet')) && !bedIsolation) return 'contact / droplet isolation: a single room or cohort bay'
  return null
}

/** Is HH:MM inside one of the visiting windows [{from, to}]? */
export function inVisitingHours(windows, hhmm) {
  return (windows || []).some((w) => hhmm >= w.from && hhmm < w.to)
}
