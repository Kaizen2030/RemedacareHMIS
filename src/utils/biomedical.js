export function needsMaintenance({ ageMonths = 0, status = 'Working', lastServiceMonths = 0 }) {
  const age = Number(ageMonths || 0)
  const serviceGap = Number(lastServiceMonths || 0)
  const isWorking = String(status).toLowerCase() === 'working'
  return isWorking && (age >= 24 || serviceGap >= 12)
}

export function canUseEquipment({ status = 'Working', calibrationDue = false, safetyCheckPassed = false }) {
  const safeStatus = String(status).toLowerCase() === 'working'
  return Boolean(safeStatus && !calibrationDue && safetyCheckPassed)
}
