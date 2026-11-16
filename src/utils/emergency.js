export function triageEmergency({ severity = 'Green', vitals = {} }) {
  const systolic = vitals.systolic === '' || vitals.systolic == null ? null : Number(vitals.systolic)
  const pulse = vitals.pulse === '' || vitals.pulse == null ? null : Number(vitals.pulse)
  const normalized = String(severity).toLowerCase()

  if (normalized === 'red' || (systolic !== null && systolic <= 80) || (pulse !== null && pulse >= 140)) return 'Immediate'
  if (normalized === 'yellow' || (systolic !== null && systolic <= 100) || (pulse !== null && pulse >= 120)) return 'Urgent'
  return 'Routine'
}

export function canTransferToWard({ stable = false, acuteRisk = false, oxygenNeed = 0 }) {
  return Boolean(stable && !acuteRisk && Number(oxygenNeed || 0) <= 2)
}
