// Emergency triage and time-critical pathways.
// Adults (≥ 12 years or > 150 cm): South African Triage Scale (SATS) — the Triage Early Warning Score (TEWS) plus
// emergency signs ("discriminators"); the worst of the two decides the colour.
// Children: ETAT+ (WHO, used in Kenyan paediatric guidelines) — emergency signs → red (treat now), priority signs →
// orange (see first in the queue), otherwise green. The database recomputes the colour (ed_colour) so the two always agree.
// Confirm these against the triage protocol your facility has adopted.

export const COLOURS = {
  red: { label: 'Red — emergency', target: 0, bg: '#FEE4E2', fg: '#B42318' },
  orange: { label: 'Orange — very urgent', target: 10, bg: '#FFEAD5', fg: '#C4320A' },
  yellow: { label: 'Yellow — urgent', target: 60, bg: '#FEF7C3', fg: '#A15C07' },
  green: { label: 'Green — routine', target: 240, bg: '#DCFAE6', fg: '#067647' },
  blue: { label: 'Blue — dead on arrival', target: null, bg: '#EFF8FF', fg: '#175CD3' },
}
const ORDER = ['blue', 'red', 'orange', 'yellow', 'green']

/** Adult TEWS from vitals and observations. Returns { score, parts } — parts explain each point. */
export function tews({ mobility, rr, hr, sbp, temp, avpu, trauma } = {}) {
  const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
  const parts = {}
  parts.mobility = mobility === 'stretcher' ? 2 : mobility === 'with_help' ? 1 : mobility === 'walking' ? 0 : null
  const R = n(rr); parts.rr = R === null ? null : R < 9 ? 2 : R <= 14 ? 0 : R <= 20 ? 1 : R <= 29 ? 2 : 3
  const H = n(hr); parts.hr = H === null ? null : H < 41 ? 2 : H <= 50 ? 1 : H <= 100 ? 0 : H <= 110 ? 1 : H <= 129 ? 2 : 3
  const S = n(sbp); parts.sbp = S === null ? null : S < 71 ? 3 : S <= 80 ? 2 : S <= 100 ? 1 : S <= 199 ? 0 : 2
  const T = n(temp); parts.temp = T === null ? null : T < 35 ? 2 : T <= 38.4 ? 0 : 2
  parts.avpu = { A: 0, V: 1, P: 2, U: 3 }[avpu] ?? null
  parts.trauma = trauma === true ? 1 : trauma === false ? 0 : null
  const missing = Object.entries(parts).filter(([, v]) => v === null).map(([k]) => k)
  const score = Object.values(parts).reduce((sum, v) => sum + (v || 0), 0)
  return { score, parts, missing }
}

export function colourFromScore(score) {
  if (score >= 7) return 'red'
  if (score >= 5) return 'orange'
  if (score >= 3) return 'yellow'
  return 'green'
}

/** SATS adult emergency signs, grouped by the colour they force. */
export const ADULT_SIGNS = {
  red: ['Airway compromised', 'Breathing inadequate', 'Shock', 'Seizure - current', 'Hypoglycaemia (glucose < 3 mmol/L)', 'Burn - facial / inhalation', 'Cardiac arrest'],
  orange: ['Shortness of breath - acute', 'Coughing blood', 'Chest pain', 'Haemorrhage - uncontrolled', 'Seizure - post-ictal', 'Focal neurology - acute', 'Level of consciousness reduced', 'Psychosis / aggression', 'Threatened limb', 'Dislocation of a large joint', 'Fracture - compound', 'Burn > 20% / electrical / circumferential / chemical', 'Poisoning / overdose', 'Diabetic - glucose > 11 mmol/L and ketones', 'Vomiting fresh blood', 'Pregnancy with abdominal trauma or pain', 'Eye injury', 'Pain - severe'],
  yellow: ['Haemorrhage - controlled', 'Fracture - closed', 'Burn - other', 'Abdominal pain', 'Diabetic - glucose > 17 mmol/L, no ketones', 'Vomiting persistently', 'Pregnancy with trauma', 'Pregnancy with vaginal bleeding', 'Pain - moderate'],
}

/** ETAT+ for children: emergency signs → red, priority signs → orange. */
export const CHILD_SIGNS = {
  red: ['Obstructed or absent breathing', 'Severe respiratory distress', 'Central cyanosis', 'Shock (cold hands, capillary refill > 3 s, weak fast pulse)', 'Coma (AVPU P or U)', 'Convulsing now', 'Severe dehydration with lethargy (child with diarrhoea)'],
  orange: ['Tiny baby (< 2 months)', 'Temperature very high (> 39.5 °C)', 'Trauma or other urgent surgical condition', 'Pallor (severe)', 'Poisoning', 'Pain (severe)', 'Restless, irritable or lethargic', 'Respiratory distress', 'Referral (urgent)', 'Malnutrition: visible severe wasting', 'Oedema of both feet', 'Burns (major)'],
  yellow: [],
}

/** Final colour: the worst of the score (adults only) and any ticked sign. signs: ['red:…', 'orange:…'] */
export function triageColour({ score = 0, signs = [], child = false, dead = false }) {
  if (dead) return 'blue'
  const fromSigns = signs.map((s) => String(s).split(':')[0])
  const candidates = [...fromSigns, ...(child ? [] : [colourFromScore(score)]), 'green']
  return ORDER.find((c) => candidates.includes(c)) || 'green'
}

/** Minutes left until the patient should have been seen (negative = late), or null once seen / no target. */
export function minutesToTarget(att, now = new Date()) {
  if (!att?.see_by || att.seen_at) return null
  return Math.round((new Date(att.see_by) - now) / 60000)
}

// ---------------------------------------------------------------- pathways (steps with target minutes from arrival)
export const PATHWAYS = {
  stroke: {
    label: 'Stroke', hint: 'Sudden face droop, arm weakness or speech problem — note the time last seen well.',
    steps: [
      { key: 'last_known_well', label: 'Time last known well recorded', target: 10 },
      { key: 'glucose', label: 'Blood glucose checked', target: 10 },
      { key: 'ct', label: 'CT head done', target: 25 },
      { key: 'ct_reported', label: 'CT reported', target: 45 },
      { key: 'decision', label: 'Thrombolysis decision (eligible / not eligible)', target: 60 },
      { key: 'needle', label: 'Thrombolysis started (if eligible)', target: 60, optional: true },
    ],
  },
  stemi: {
    label: 'Heart attack (STEMI / ACS)', hint: 'Chest pain or equivalent — ECG within 10 minutes of arrival.',
    steps: [
      { key: 'ecg', label: '12-lead ECG done', target: 10 },
      { key: 'ecg_read', label: 'ECG read by a clinician', target: 10 },
      { key: 'aspirin', label: 'Aspirin given (unless contraindicated)', target: 20 },
      { key: 'troponin', label: 'Troponin sent', target: 30 },
      { key: 'reperfusion', label: 'Thrombolysis started / PCI referral made', target: 30, optional: true },
    ],
  },
  sepsis: {
    label: 'Sepsis (hour-1 bundle)', hint: 'Suspected infection with abnormal vital signs — complete the bundle within one hour.',
    steps: [
      { key: 'lactate', label: 'Lactate measured', target: 60 },
      { key: 'cultures', label: 'Blood cultures taken before antibiotics', target: 60 },
      { key: 'antibiotics', label: 'Broad-spectrum antibiotics given', target: 60 },
      { key: 'fluids', label: '30 mL/kg crystalloid (if hypotensive or lactate ≥ 4)', target: 60, optional: true },
      { key: 'vasopressors', label: 'Vasopressors (if still hypotensive after fluids)', target: 60, optional: true },
    ],
  },
  trauma: {
    label: 'Major trauma', hint: 'Primary survey first; complete the trauma sheet.',
    steps: [
      { key: 'primary_survey', label: 'Primary survey (ABCDE) done', target: 5 },
      { key: 'haemorrhage', label: 'Major bleeding controlled', target: 10, optional: true },
      { key: 'fast', label: 'FAST scan', target: 30, optional: true },
      { key: 'imaging', label: 'Imaging requested', target: 30 },
      { key: 'decision', label: 'Definitive plan (theatre / admit / refer)', target: 60 },
    ],
  },
}

/** Status of each pathway step: done (on time / late), pending (minutes left) or overdue. */
export function pathwayStatus(pathway, events = [], arrivalAt, now = new Date()) {
  const def = PATHWAYS[pathway]
  if (!def) return []
  const arrival = new Date(arrivalAt).getTime()
  return def.steps.map((step) => {
    const ev = events.find((e) => e.pathway === pathway && e.step === step.key)
    const dueAt = arrival + step.target * 60000
    if (ev) {
      const mins = Math.round((new Date(ev.done_at).getTime() - arrival) / 60000)
      return { ...step, state: 'done', minutes: mins, onTime: new Date(ev.done_at).getTime() <= dueAt, event: ev }
    }
    const left = Math.round((dueAt - now.getTime()) / 60000)
    return { ...step, state: left < 0 ? 'overdue' : 'pending', minutesLeft: left }
  })
}

/** Glasgow Coma Scale total (E 1–4, V 1–5, M 1–6). */
export function gcs({ e, v, m } = {}) {
  const vals = [Number(e), Number(v), Number(m)]
  if (vals.some((x) => !Number.isFinite(x) || x <= 0)) return null
  return vals[0] + vals[1] + vals[2]
}

export const DISPOSITIONS = {
  admitted: 'Admitted', discharged: 'Discharged home', referred: 'Referred out', theatre: 'To theatre', transferred: 'Transferred',
  died: 'Died', lwbs: 'Left without being seen', left_against_advice: 'Left against medical advice',
}
