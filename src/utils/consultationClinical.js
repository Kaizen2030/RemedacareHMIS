const DEPARTMENT_DIAGNOSES = {
  'general medicine': ['Malaria', 'Upper respiratory tract infection', 'Hypertension', 'Type 2 diabetes'],
  paediatrics: ['Malaria', 'Pneumonia', 'Diarrhoeal disease'],
  'obstetrics & gynaecology': ['Antenatal review', 'Urinary tract infection', 'Malaria'],
  emergency: ['Malaria', 'Pneumonia', 'Acute gastroenteritis'],
}

const AWARE_GROUPS = {
  Access: ['amoxicillin', 'ampicillin', 'penicillin', 'cloxacillin', 'doxycycline', 'nitrofurantoin', 'metronidazole', 'gentamicin'],
  Watch: ['ceftriaxone', 'ceftazidime', 'cefepime', 'ciprofloxacin', 'levofloxacin', 'azithromycin', 'clarithromycin', 'vancomycin'],
  Reserve: ['meropenem', 'imipenem', 'colistin', 'linezolid', 'tigecycline', 'daptomycin'],
}

const FREQUENCY_SW = {
  'once daily': 'mara moja kwa siku',
  'twice daily': 'mara mbili kwa siku',
  'three times daily': 'mara tatu kwa siku',
  'four times daily': 'mara nne kwa siku',
  'every 8 hours': 'kila baada ya saa 8',
  'every 6 hours': 'kila baada ya saa 6',
  'at night': 'usiku',
  'as needed': 'inapohitajika',
  'stat (once)': 'dozi moja sasa',
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function readNumber(value) {
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : null
}

function getAgeYears(patient = {}) {
  const recordedAge = readNumber(patient.age)
  if (recordedAge !== null) return recordedAge
  if (!patient.date_of_birth) return null

  const dateOfBirth = new Date(patient.date_of_birth)
  if (Number.isNaN(dateOfBirth.getTime())) return null
  const today = new Date()
  return today.getFullYear() - dateOfBirth.getFullYear() - (
    today < new Date(today.getFullYear(), dateOfBirth.getMonth(), dateOfBirth.getDate()) ? 1 : 0
  )
}

export function buildBilingualInstruction(row = {}) {
  const details = [row.drug_name, row.dosage, row.frequency, row.duration].map(value => String(value || '').trim()).filter(Boolean)
  if (details.length === 0) return ''

  const frequency = String(row.frequency || '').trim()
  const swahiliFrequency = FREQUENCY_SW[frequency.toLowerCase()]
  const english = `Use ${details.join(', ')} as directed by your clinician.`
  const swahili = swahiliFrequency
    ? `Tumia ${[row.drug_name, row.dosage].filter(Boolean).join(' ')} ${swahiliFrequency}${row.duration ? ` kwa ${row.duration}` : ''}.`
    : 'Tumia dawa hii kama ulivyoelekezwa na mhudumu wako wa afya.'

  return `${english} ${swahili}`
}

export function getAwareClassification(value) {
  const drugName = normalizeText(value)
  if (!drugName) return ''

  for (const [classification, agents] of Object.entries(AWARE_GROUPS)) {
    if (agents.some(agent => drugName.includes(agent))) return classification
  }

  return ''
}

export function isAntibioticDrug(value) {
  const drugName = normalizeText(value)
  return Boolean(drugName) && Object.values(AWARE_GROUPS).flat().some(agent => drugName.includes(agent))
}

export function getAbnormalVitalAlerts(vitals = {}) {
  if (!vitals || typeof vitals !== 'object') return []

  const alerts = []
  const systolic = readNumber(vitals.bp_systolic)
  const diastolic = readNumber(vitals.bp_diastolic)
  const pulse = readNumber(vitals.pulse)
  const temperature = readNumber(vitals.temperature ?? vitals.temp_c)
  const oxygen = readNumber(vitals.spo2)
  const respiratoryRate = readNumber(vitals.respiratory_rate ?? vitals.rr)

  if (systolic !== null && systolic >= 180 || diastolic !== null && diastolic >= 120) {
    alerts.push({ vital: 'Blood pressure', severity: 'critical', message: 'Blood pressure is in a critical range.' })
  } else if (systolic !== null && systolic >= 140 || diastolic !== null && diastolic >= 90) {
    alerts.push({ vital: 'Blood pressure', severity: 'warning', message: 'Blood pressure is elevated.' })
  } else if (systolic !== null && systolic < 90 || diastolic !== null && diastolic < 60) {
    alerts.push({ vital: 'Blood pressure', severity: 'warning', message: 'Blood pressure is low.' })
  }

  if (pulse !== null && (pulse < 50 || pulse > 120)) alerts.push({ vital: 'Pulse', severity: 'warning', message: 'Pulse is outside the usual adult range.' })
  if (temperature !== null && temperature >= 38) alerts.push({ vital: 'Temperature', severity: 'warning', message: 'Temperature is elevated.' })
  if (oxygen !== null && oxygen < 92) alerts.push({ vital: 'Oxygen saturation', severity: 'critical', message: 'Oxygen saturation is low.' })
  if (respiratoryRate !== null && (respiratoryRate < 10 || respiratoryRate > 24)) alerts.push({ vital: 'Respiratory rate', severity: 'warning', message: 'Respiratory rate is outside the usual adult range.' })

  return alerts
}

export function getBmiSummary(vitals = {}) {
  const weightKg = readNumber(vitals?.weight_kg ?? vitals?.weight)
  const heightCm = readNumber(vitals?.height_cm ?? vitals?.height)
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) return null

  const bmi = Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10
  const category = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Healthy range' : bmi < 30 ? 'Overweight' : 'Obesity range'
  return { bmi, category }
}

export function detectPrescriptionInteractions(prescriptions = []) {
  const drugs = (prescriptions || []).map(row => normalizeText(row?.drug_name)).filter(Boolean)
  const warnings = []
  const includes = value => drugs.some(drug => drug.includes(value))

  if (includes('warfarin') && ['ibuprofen', 'diclofenac', 'naproxen', 'aspirin'].some(includes)) {
    warnings.push({ severity: 'warning', message: 'Warfarin with an NSAID or aspirin may increase bleeding risk. Review before prescribing.' })
  }
  if (includes('warfarin') && includes('metronidazole')) {
    warnings.push({ severity: 'warning', message: 'Metronidazole may increase the anticoagulant effect of warfarin. Review and monitor.' })
  }
  if (includes('sildenafil') && ['nitroglycerin', 'isosorbide'].some(includes)) {
    warnings.push({ severity: 'critical', message: 'PDE5 inhibitors with nitrates can cause a dangerous drop in blood pressure. Do not co-administer without specialist direction.' })
  }

  return warnings
}

export function getCommonDiagnosesForDepartment(department = '') {
  const normalizedDepartment = normalizeText(department)
  const match = Object.entries(DEPARTMENT_DIAGNOSES).find(([name]) => normalizedDepartment.includes(name))
  return match ? [...match[1]] : []
}

export function hasMalariaDiagnosis(diagnoses = []) {
  return (diagnoses || []).some(item => normalizeText(item?.description || item).includes('malaria'))
}

export function hasTuberculosisDiagnosis(diagnoses = []) {
  return (diagnoses || []).some(item => /\btuberculosis\b|\btb\b/i.test(String(item?.description || item || '')))
}

export function needsPregnancyPrompt(patient = {}) {
  const sex = normalizeText(patient.sex || patient.gender)
  const age = getAgeYears(patient)
  return ['female', 'f', 'woman'].includes(sex) && age !== null && age >= 15 && age <= 49
}