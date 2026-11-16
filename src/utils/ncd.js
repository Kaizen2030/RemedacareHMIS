// NCD registry helpers. The database computes control status, recall and LTFU; these mirror the rules for
// instant feedback in forms, and describe which measurements each condition records.

export const NCD_FIELDS = {
  bp_sys: { label: 'BP systolic', unit: 'mmHg', step: 1 },
  bp_dia: { label: 'BP diastolic', unit: 'mmHg', step: 1 },
  fbs: { label: 'Fasting glucose', unit: 'mmol/L', step: 0.1 },
  rbs: { label: 'Random glucose', unit: 'mmol/L', step: 0.1 },
  hba1c: { label: 'HbA1c', unit: '%', step: 0.1 },
  weight_kg: { label: 'Weight', unit: 'kg', step: 0.1 },
  height_cm: { label: 'Height', unit: 'cm', step: 1 },
  viral_load: { label: 'Viral load', unit: 'copies/ml (LDL = 0)', step: 1 },
  act_score: { label: 'Asthma control test', unit: '5–25', step: 1 },
  peak_flow: { label: 'Peak flow', unit: 'L/min', step: 1 },
  seizures: { label: 'Seizures since last visit', unit: '', step: 1 },
  crises: { label: 'Pain crises since last visit', unit: '', step: 1 },
  egfr: { label: 'eGFR', unit: 'ml/min/1.73m²', step: 1 },
}

const BP = ['bp_sys', 'bp_dia']
export const CONDITION_FIELDS = {
  htn: BP,
  dm: [...BP, 'fbs', 'rbs', 'hba1c'],
  ckd: [...BP, 'egfr'],
  hf: BP,
  asthma: ['act_score', 'peak_flow'],
  copd: ['peak_flow'],
  epilepsy: ['seizures'],
  sickle: ['crises'],
  hiv: ['viral_load'],
  tb: [],
  cancer: [],
  mental: [],
}
export const SCREENINGS = {
  dm: [['eye_exam', 'Eye exam done'], ['foot_exam', 'Foot exam done'], ['urine_albumin', 'Urine albumin checked']],
  htn: [['urine_albumin', 'Urine albumin checked']],
  ckd: [['urine_albumin', 'Urine albumin checked']],
}
export const fieldsFor = (code) => [...(CONDITION_FIELDS[code] || BP), 'weight_kg', 'height_cm']

export const STATUS_LABEL = {
  active: 'Active', ltfu: 'Lost to follow-up', transferred_out: 'Transferred out', died: 'Died', discharged: 'Discharged', refused: 'Refused care',
}
export const CONTROL_STYLE = {
  controlled: { label: 'Controlled', tone: 'green' },
  uncontrolled: { label: 'Uncontrolled', tone: 'red' },
  unknown: { label: 'No reading', tone: 'gray' },
}

/** Same rule as ncd_evaluate() in the database: every comparable target must pass. */
export function evaluateControl(values = {}, targets = {}) {
  let compared = 0, failed = 0
  for (const [key, limit] of Object.entries(targets || {})) {
    const m = /^(.*)_(max|min)$/.exec(key)
    if (!m) continue
    const raw = values[m[1]]
    if (raw === '' || raw === null || raw === undefined || Number.isNaN(Number(raw))) continue
    compared++
    const v = Number(raw)
    if ((m[2] === 'max' && v > Number(limit)) || (m[2] === 'min' && v < Number(limit))) failed++
  }
  return compared === 0 ? 'unknown' : failed ? 'uncontrolled' : 'controlled'
}

/** Human description of a target set, e.g. "BP systolic < 140, BP diastolic < 90". */
export function describeTargets(targets = {}) {
  return Object.entries(targets || {}).map(([key, limit]) => {
    const m = /^(.*)_(max|min)$/.exec(key)
    if (!m) return null
    const f = NCD_FIELDS[m[1]]?.label || m[1]
    const n = Number(limit)
    // stored inclusive (139) → shown as the guideline wording (< 140) for whole-number limits
    return m[2] === 'max' ? (Number.isInteger(n) ? `${f} < ${n + 1}` : `${f} ≤ ${n}`) : `${f} ≥ ${n}`
  }).filter(Boolean).join(', ')
}

export function mergeTargets(defaults = {}, hospital = {}, patient = {}) {
  return { ...(defaults || {}), ...(hospital || {}), ...(patient || {}) }
}

export const daysBetween = (from, to = new Date()) => Math.floor((new Date(to).setHours(12) - new Date(`${from}T12:00:00`).getTime()) / 86400000)

/** Where an active patient stands today: on time, due soon, overdue (7+ days late) or due to become LTFU. */
export function recallState(enrolment, today = new Date(), { overdueAfter = 7, ltfuAfter = 28 } = {}) {
  if (!enrolment?.next_visit_due || !['active', 'ltfu'].includes(enrolment.status)) return null
  const late = daysBetween(enrolment.next_visit_due, today)
  if (enrolment.status === 'ltfu') return { key: 'ltfu', label: `Lost to follow-up (${late} days late)`, tone: 'red' }
  if (late > ltfuAfter) return { key: 'ltfu_soon', label: `${late} days late — becomes LTFU`, tone: 'red' }
  if (late > overdueAfter) return { key: 'overdue', label: `Overdue ${late} days`, tone: 'red' }
  if (late > 0) return { key: 'late', label: `Due ${late} day${late === 1 ? '' : 's'} ago`, tone: 'yellow' }
  if (late >= -7) return { key: 'due_soon', label: late === 0 ? 'Due today' : `Due in ${-late} days`, tone: 'yellow' }
  return { key: 'ok', label: `Next visit ${enrolment.next_visit_due}`, tone: 'green' }
}

export const pct = (part, whole) => (whole ? Math.round((Number(part) / Number(whole)) * 100) : 0)
