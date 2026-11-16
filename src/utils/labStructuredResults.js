export const MICRO_ANTIBIOTIC_OPTIONS = [
  'Amoxicillin', 'Amoxicillin/Clavulanate', 'Ampicillin', 'Ciprofloxacin', 'Levofloxacin',
  'Gentamicin', 'Amikacin', 'Ceftriaxone', 'Cefuroxime', 'Ceftazidime', 'Cefepime',
  'Meropenem', 'Imipenem', 'Piperacillin/Tazobactam', 'Nitrofurantoin', 'Tetracycline',
  'Doxycycline', 'Clindamycin', 'Erythromycin', 'Azithromycin', 'Vancomycin', 'Linezolid',
  'Chloramphenicol', 'Metronidazole', 'Cotrimoxazole',
]

const RESULT_TEMPLATES = [
  {
    key: 'rfts',
    label: 'Renal Function Tests',
    matches: /renal|rft|urea|electrolyte|creatinine|kidney function/i,
    fields: [
      { key: 'urea', label: 'Urea', unit: 'mmol/L', reference: '2.5-7.8', low: 2.5, high: 7.8 },
      { key: 'creatinine', label: 'Creatinine', unit: 'µmol/L', reference: 'Adult range varies by laboratory', low: 45, high: 110 },
      { key: 'sodium', label: 'Sodium', unit: 'mmol/L', reference: '135-145', low: 135, high: 145, criticalLow: 120, criticalHigh: 160 },
      { key: 'potassium', label: 'Potassium', unit: 'mmol/L', reference: '3.5-5.1', low: 3.5, high: 5.1, criticalLow: 2.5, criticalHigh: 6.5 },
      { key: 'chloride', label: 'Chloride', unit: 'mmol/L', reference: '98-107', low: 98, high: 107 },
      { key: 'egfr', label: 'eGFR', unit: 'mL/min/1.73m²', reference: 'Calculated from age, sex, and creatinine', readOnly: true },
    ],
  },
  {
    key: 'fbc',
    label: 'Full Blood Count',
    matches: /full blood count|full blood|fbc|cbc|haemogram|hemogram/i,
    fields: [
      { key: 'haemoglobin', label: 'Haemoglobin', unit: 'g/dL', reference: 'Adult range varies by laboratory', low: 11.5, high: 17.5, criticalLow: 6, criticalHigh: 22 },
      { key: 'wbc', label: 'White blood cells', unit: '×10⁹/L', reference: '4.0-11.0', low: 4, high: 11, criticalLow: 1, criticalHigh: 50 },
      { key: 'platelets', label: 'Platelets', unit: '×10⁹/L', reference: '150-400', low: 150, high: 400, criticalLow: 20, criticalHigh: 1000 },
    ],
  },
  {
    key: 'lft',
    label: 'Liver Function Tests',
    matches: /liver function|lft|hepatic panel/i,
    fields: [
      { key: 'alt', label: 'ALT', unit: 'U/L', reference: 'Laboratory-specific range', low: 0, high: 56 },
      { key: 'ast', label: 'AST', unit: 'U/L', reference: 'Laboratory-specific range', low: 0, high: 40 },
      { key: 'bilirubin', label: 'Total bilirubin', unit: 'µmol/L', reference: '5-21', low: 5, high: 21 },
      { key: 'albumin', label: 'Albumin', unit: 'g/L', reference: '35-50', low: 35, high: 50 },
    ],
  },
]

export function matchStructuredTemplate(testType = '', category = '') {
  const text = `${testType} ${category}`
  return RESULT_TEMPLATES.find(template => template.matches.test(text)) || null
}

export function buildStructuredDefaults(template) {
  return Object.fromEntries((template?.fields || []).map(field => [field.key, '']))
}

export function evaluateStructuredValue(field = {}, value) {
  const numericValue = Number.parseFloat(value)
  if (!Number.isFinite(numericValue)) return { status: 'empty', critical: false }

  const status = numericValue < field.low ? 'low' : numericValue > field.high ? 'high' : 'normal'
  const critical = (Number.isFinite(field.criticalLow) && numericValue <= field.criticalLow)
    || (Number.isFinite(field.criticalHigh) && numericValue >= field.criticalHigh)
  return { status, critical, value: numericValue }
}

export function calculateEgfr(values = {}, patient = {}) {
  const age = Number.parseFloat(patient.age)
  let creatinine = Number.parseFloat(values.creatinine)
  if (!Number.isFinite(age) || age <= 0 || !Number.isFinite(creatinine) || creatinine <= 0) return ''
  if (creatinine > 25) creatinine /= 88.4

  const isFemale = /female|^f$/i.test(String(patient.gender || patient.sex || ''))
  const kappa = isFemale ? 0.7 : 0.9
  const alpha = isFemale ? -0.241 : -0.302
  const egfr = 142
    * (Math.min(creatinine / kappa, 1) ** alpha)
    * (Math.max(creatinine / kappa, 1) ** -1.2)
    * (0.9938 ** age)
    * (isFemale ? 1.012 : 1)
  return Number.isFinite(egfr) ? Math.round(egfr) : ''
}

export function buildCriticalAlerts(template, values = {}) {
  return (template?.fields || [])
    .filter(field => evaluateStructuredValue(field, values[field.key]).critical)
    .map(field => `${field.label} is in a critical range (${values[field.key]} ${field.unit || ''}).`)
}

export function normalizeSusceptibilityChoice(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (['s', 'sensitive', 'susceptible'].includes(normalized)) return 'S'
  if (['i', 'intermediate'].includes(normalized)) return 'I'
  if (['r', 'resistant'].includes(normalized)) return 'R'
  if (['nt', 'not tested', 'not_tested'].includes(normalized)) return 'NT'
  return ''
}

export function getMicroEmpiricRecommendation(organism, susceptibilityProfile = {}) {
  const susceptible = Object.entries(susceptibilityProfile || {})
    .filter(([, value]) => normalizeSusceptibilityChoice(value) === 'S')
    .map(([drug]) => drug)
  if (susceptible.length === 0) return `No susceptible agents are recorded for ${organism || 'this isolate'}. Review the culture report and local treatment guidance.`
  return `The isolate (${organism || 'organism not recorded'}) is reported susceptible to: ${susceptible.join(', ')}. Confirm patient factors and local treatment guidance before selecting therapy.`
}

export function summarizeStructuredResult(template, values = {}) {
  const entries = (template?.fields || [])
    .filter(field => values[field.key] !== undefined && values[field.key] !== null && String(values[field.key]).trim() !== '')
    .map(field => `${field.label}: ${values[field.key]}${field.unit ? ` ${field.unit}` : ''}`)
  const alerts = buildCriticalAlerts(template, values)
  return {
    resultText: entries.join('\n'),
    resultValue: entries.length ? entries.join('; ') : '',
    interpretation: alerts.length ? `Critical value requires clinician notification: ${alerts.join(' ')}` : '',
  }
}