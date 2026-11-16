export function canScheduleVideoConsult({ patientDeviceReady = false, networkStable = false, clinicianAvailable = false }) {
  return Boolean(patientDeviceReady && networkStable && clinicianAvailable)
}

export function triagePriorityLevel({ vitals = {}, symptoms = [] }) {
  const pulse = Number(vitals.pulse || 0)
  const spo2 = Number(vitals.spo2 || 0)
  const systolic = Number(vitals.systolic || 0)
  const symptomText = (symptoms || []).join(' ').toLowerCase()

  if (
    pulse >= 120 ||
    spo2 <= 89 ||
    systolic <= 90 ||
    symptomText.includes('shortness of breath') ||
    symptomText.includes('collapse') ||
    symptomText.includes('chest pain') ||
    symptomText.includes('unconscious')
  ) {
    return 'Critical'
  }

  if (pulse >= 100 || spo2 <= 94 || systolic <= 100) {
    return 'Urgent'
  }

  return 'Routine'
}
