export function canAssignICUBed({ patientSeverity = 'Stable', availableBeds = 0 }) {
  const severityMap = { Critical: 3, High: 2, Moderate: 1, Stable: 0 }
  return Number(availableBeds || 0) > 0 && (severityMap[String(patientSeverity)] || 0) >= 2
}

export function getICUAlertLevel({ oxygenNeed = 0, hemodynamicStability = 'Stable', nurseRatio = 3 }) {
  const oxygen = Number(oxygenNeed || 0)
  const ratio = Number(nurseRatio || 3)
  if (oxygen >= 6 || String(hemodynamicStability).toLowerCase() === 'unstable' || ratio <= 1) return 'Critical'
  if (oxygen >= 4 || String(hemodynamicStability).toLowerCase() === 'borderline') return 'High'
  return 'Routine'
}
