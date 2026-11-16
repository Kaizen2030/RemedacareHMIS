// Ward nursing scores. The database computes the stored score (news2_score / pews_score / ward_risk_before in
// 20261205000000_ward_nursing.sql); these mirror it for the live preview while the nurse types.

export const INTAKE_TYPES = ['Oral Intake', 'IV Fluid', 'Blood']
export const OUTPUT_TYPES = ['Urine Output', 'Drain Output', 'Vomit', 'Other']

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v))

/** NEWS2 (Royal College of Physicians 2017). */
export function news2(o = {}) {
  const rr = num(o.rr), sp = num(o.spo2), sbp = num(o.sbp), hr = num(o.hr), t = num(o.temp)
  const oxygen = Boolean(o.oxygen), scale2 = String(o.spo2_scale || '1') === '2', c = String(o.consciousness || 'A').toUpperCase()
  const parts = {
    rr: rr === null ? null : rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3,
    spo2: sp === null ? null : !scale2 ? (sp <= 91 ? 3 : sp <= 93 ? 2 : sp <= 95 ? 1 : 0)
      : sp <= 83 ? 3 : sp <= 85 ? 2 : sp <= 87 ? 1 : (sp <= 92 || !oxygen) ? 0 : sp <= 94 ? 1 : sp <= 96 ? 2 : 3,
    oxygen: oxygen ? 2 : 0,
    sbp: sbp === null ? null : sbp <= 90 ? 3 : sbp <= 100 ? 2 : sbp <= 110 ? 1 : sbp <= 219 ? 0 : 3,
    hr: hr === null ? null : hr <= 40 ? 3 : hr <= 50 ? 1 : hr <= 90 ? 0 : hr <= 110 ? 1 : hr <= 130 ? 2 : 3,
    consciousness: c === 'A' ? 0 : 3,
    temp: t === null ? null : t <= 35 ? 3 : t <= 36 ? 1 : t <= 38 ? 0 : t <= 39 ? 1 : 2,
  }
  const score = Object.values(parts).reduce((s, v) => s + (v || 0), 0)
  return { score, parts, anyThree: Object.values(parts).includes(3), missing: Object.keys(parts).filter((k) => parts[k] === null) }
}

/** Brighton PEWS (nurse picks 0–3 per domain against age norms) + 2 for quarter-hourly nebs + 2 for post-op vomiting. */
export function pews(o = {}) {
  const v = (k) => (o[k] === '' || o[k] === undefined ? null : Number(o[k]))
  const doms = ['behaviour', 'cardiovascular', 'respiratory']
  const score = doms.reduce((s, k) => s + (v(k) || 0), 0) + (o.nebs ? 2 : 0) + (o.vomiting ? 2 : 0)
  return { score, anyThree: doms.some((k) => v(k) === 3), missing: doms.filter((k) => v(k) === null) }
}

/** Same thresholds as ews_response() in the database. */
export function ewsResponse(scale, score, anyThree) {
  if (scale === 'news2') {
    if (score >= 7) return { level: 'high', minutes: 15, response: 'Emergency response: critical-care-skilled clinician now; continuous monitoring.' }
    if (score >= 5) return { level: 'medium', minutes: 60, response: 'Urgent review by the doctor in charge; observations at least hourly.' }
    if (anyThree) return { level: 'low_medium', minutes: 60, response: 'A single parameter scores 3: urgent ward-based review; hourly observations.' }
    if (score >= 1) return { level: 'low', minutes: 240, response: 'Inform the nurse in charge; observations at least 4-hourly.' }
    return { level: 'routine', minutes: 720, response: 'Routine monitoring; observations at least 12-hourly.' }
  }
  if (score >= 5 || anyThree) return { level: 'high', minutes: 15, response: 'Urgent medical review now; consider HDU/ICU.' }
  if (score === 4) return { level: 'medium', minutes: 30, response: 'Doctor to review within 30 minutes; observations every 30 minutes.' }
  if (score === 3) return { level: 'low_medium', minutes: 60, response: 'Inform the nurse in charge; hourly observations.' }
  if (score >= 1) return { level: 'low', minutes: 240, response: 'Observations 4-hourly.' }
  return { level: 'routine', minutes: 240, response: 'Routine observations.' }
}

export const LEVEL_STYLE = {
  routine: { label: 'Routine', bg: '#DCFAE6', fg: '#067647' },
  low: { label: 'Low', bg: '#FEF7C3', fg: '#A15C07' },
  low_medium: { label: 'Low–medium', bg: '#FFEAD5', fg: '#C4320A' },
  medium: { label: 'Medium', bg: '#FFEAD5', fg: '#C4320A' },
  high: { label: 'High', bg: '#FEE4E2', fg: '#B42318' },
}

export const PEWS_DOMAINS = {
  behaviour: ['Playing / appropriate (0)', 'Sleeping (1)', 'Irritable (2)', 'Lethargic, confused or reduced response to pain (3)'],
  cardiovascular: ['Pink, capillary refill 1–2 s (0)', 'Pale, or refill 3 s (1)', 'Grey, or refill 4 s, or HR 20 above normal (2)', 'Grey and mottled, or refill ≥ 5 s, or HR 30 above normal or bradycardia (3)'],
  respiratory: ['Within normal, no recession (0)', '> 10 above normal, accessory muscles, or ≥ 30% / 3 L oxygen (1)', '> 20 above normal, recession, or ≥ 40% / 6 L oxygen (2)', '5 below normal with recession / grunting, or ≥ 50% / 8 L oxygen (3)'],
}

export const BRADEN = [
  { key: 'sensory', label: 'Sensory perception', options: ['Completely limited (1)', 'Very limited (2)', 'Slightly limited (3)', 'No impairment (4)'] },
  { key: 'moisture', label: 'Moisture', options: ['Constantly moist (1)', 'Very moist (2)', 'Occasionally moist (3)', 'Rarely moist (4)'] },
  { key: 'activity', label: 'Activity', options: ['Bedfast (1)', 'Chairfast (2)', 'Walks occasionally (3)', 'Walks frequently (4)'] },
  { key: 'mobility', label: 'Mobility', options: ['Completely immobile (1)', 'Very limited (2)', 'Slightly limited (3)', 'No limitation (4)'] },
  { key: 'nutrition', label: 'Nutrition', options: ['Very poor (1)', 'Probably inadequate (2)', 'Adequate (3)', 'Excellent (4)'] },
  { key: 'friction', label: 'Friction and shear', options: ['Problem (1)', 'Potential problem (2)', 'No apparent problem (3)'] },
]
export const MORSE = [
  { key: 'history', label: 'History of falling (last 3 months)', options: [['0', 'No (0)'], ['25', 'Yes (25)']] },
  { key: 'secondary_dx', label: 'More than one diagnosis', options: [['0', 'No (0)'], ['15', 'Yes (15)']] },
  { key: 'aid', label: 'Walking aid', options: [['0', 'None / bed rest / nurse assists (0)'], ['15', 'Crutches, stick, frame (15)'], ['30', 'Holds on to furniture (30)']] },
  { key: 'iv', label: 'IV line / heparin lock', options: [['0', 'No (0)'], ['20', 'Yes (20)']] },
  { key: 'gait', label: 'Gait', options: [['0', 'Normal / bed rest / wheelchair (0)'], ['10', 'Weak (10)'], ['20', 'Impaired (20)']] },
  { key: 'mental', label: 'Mental status', options: [['0', 'Knows own limits (0)'], ['15', 'Overestimates / forgets limits (15)']] },
]
export function bradenTotal(a = {}) {
  const vals = BRADEN.map((q) => a[q.key])
  if (vals.some((v) => v === undefined || v === '')) return null
  return vals.reduce((s, v) => s + Number(v), 0)
}
export function morseTotal(a = {}) {
  return MORSE.reduce((s, q) => s + Number(a[q.key] || 0), 0)
}

/** Common nursing problems with a goal and standard interventions (edit before saving). */
export const CARE_PLAN_TEMPLATES = [
  { problem: 'Risk of pressure injury', goal: 'Skin remains intact; no new pressure areas', interventions: ['Reposition at least 2-hourly and record', 'Pressure-relieving mattress if Braden ≤ 12', 'Inspect heels, sacrum and bony points each shift', 'Keep skin clean and dry; barrier cream if incontinent', 'Encourage nutrition and fluids'] },
  { problem: 'Risk of falls', goal: 'No falls during admission', interventions: ['Bed at lowest height, brakes on, call bell in reach', 'Non-slip footwear; clear the floor', 'Assist with mobilising and toileting', 'Review medicines that cause drowsiness or dizziness', 'Falls-risk sign at the bedside'] },
  { problem: 'Acute pain', goal: 'Pain score ≤ 3/10 at rest within 24 hours', interventions: ['Assess pain score 4-hourly and after analgesia', 'Give prescribed analgesia and record the effect', 'Positioning and non-drug comfort measures', 'Report uncontrolled pain to the doctor'] },
  { problem: 'Risk of infection (lines, wounds, catheter)', goal: 'No signs of infection', interventions: ['Hand hygiene before and after contact', 'Inspect IV site each shift (VIP score); date dressings', 'Aseptic wound care as prescribed', 'Catheter care; review the need daily', 'Monitor temperature and report fever'] },
  { problem: 'Fluid volume deficit / overload', goal: 'Balanced intake and output; stable weight', interventions: ['Strict intake–output chart', 'Daily weight', 'Monitor for oedema, breathlessness, dry mucosa', 'Report urine output < 0.5 mL/kg/h for 2 hours'] },
  { problem: 'Imbalanced nutrition: less than body requirements', goal: 'Eats ≥ 75% of meals; weight stable', interventions: ['Nutrition screening (e.g. MUST)', 'Food chart', 'Refer to the dietitian', 'Assist with feeding; supplements as prescribed'] },
  { problem: 'Impaired physical mobility', goal: 'Mobilises with minimal assistance before discharge', interventions: ['Physiotherapy referral', 'Passive / active range-of-motion exercises', 'DVT prevention as prescribed', 'Encourage sitting out of bed'] },
  { problem: 'Unstable blood glucose', goal: 'Glucose 6–10 mmol/L; no hypoglycaemia', interventions: ['Capillary glucose as prescribed (e.g. before meals and at night)', 'Hypoglycaemia protocol at the bedside', 'Insulin / oral agents as prescribed', 'Diabetes education before discharge'] },
  { problem: 'Anxiety / knowledge deficit', goal: 'Patient and family understand the plan of care', interventions: ['Explain procedures and the plan in the patient\'s language', 'Involve family in care and discharge planning', 'Allow time for questions'] },
]

/** Intake–output by 24-hour period starting 07:00 (common ward chart day). */
export function fluidChart(entries = [], dayStartHour = 7) {
  const days = new Map()
  for (const e of entries) {
    const at = new Date(e.recorded_at || e.created_at)
    const shifted = new Date(at.getTime() - dayStartHour * 3600000)
    const key = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`
    const d = days.get(key) || { day: key, intake: 0, output: 0, byType: {} }
    const ml = Number(e.volume_ml) || 0
    if (INTAKE_TYPES.includes(e.entry_type)) d.intake += ml
    else d.output += ml
    d.byType[e.entry_type] = (d.byType[e.entry_type] || 0) + ml
    days.set(key, d)
  }
  let running = 0
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => {
    running += d.intake - d.output
    return { ...d, balance: d.intake - d.output, cumulative: running }
  })
}
