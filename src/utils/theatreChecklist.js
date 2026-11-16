// WHO Surgical Safety Checklist (2009) as used by the Theatre screen. The keys and acceptable answers must match
// theatre_phase_items() in 20261203000000_theatre.sql — the database refuses a phase that is not complete.

const YES = [['yes', 'Yes']]
const YES_NA = [['yes', 'Yes'], ['na', 'Not applicable']]

export const WHO_PHASES = {
  sign_in: {
    title: 'Sign in', when: 'Before induction of anaesthesia', who: 'Nurse and anaesthetist',
    items: [
      { key: 'identity_confirmed', label: 'Patient has confirmed identity, site, procedure and consent', options: YES },
      { key: 'site_marked', label: 'Site marked', options: YES_NA },
      { key: 'consent', label: 'Signed consent form in the file', options: YES },
      { key: 'anaesthesia_check', label: 'Anaesthesia machine and medication check complete', options: YES },
      { key: 'pulse_oximeter', label: 'Pulse oximeter on the patient and working', options: YES },
      { key: 'allergy', label: 'Does the patient have a known allergy?', options: [['no', 'No'], ['yes', 'Yes (recorded)']] },
      { key: 'difficult_airway', label: 'Difficult airway or aspiration risk?', options: [['no', 'No'], ['yes_ready', 'Yes, and equipment / assistance available']] },
      { key: 'blood_loss_risk', label: 'Risk of > 500 mL blood loss (7 mL/kg in children)?', options: [['no', 'No'], ['yes_planned', 'Yes, and two IVs / central access and fluids planned']] },
    ],
  },
  time_out: {
    title: 'Time out', when: 'Before skin incision', who: 'Nurse, anaesthetist and surgeon',
    items: [
      { key: 'team_introduced', label: 'All team members have introduced themselves by name and role', options: YES },
      { key: 'patient_site_procedure', label: 'Surgeon, anaesthetist and nurse confirm patient, site and procedure', options: YES },
      { key: 'antibiotics', label: 'Antibiotic prophylaxis given within the last 60 minutes', options: YES_NA },
      { key: 'critical_events', label: 'Anticipated critical events reviewed (surgeon: critical steps, duration, blood loss; anaesthetist: patient concerns)', options: YES },
      { key: 'sterility', label: 'Nursing: sterility (indicator results) confirmed; equipment issues raised', options: YES },
      { key: 'imaging', label: 'Essential imaging displayed', options: YES_NA },
    ],
  },
  sign_out: {
    title: 'Sign out', when: 'Before the patient leaves the operating room', who: 'Nurse, anaesthetist and surgeon',
    items: [
      { key: 'procedure_recorded', label: 'Name of the procedure recorded', options: YES },
      { key: 'counts_correct', label: 'Instrument, sponge and needle counts are correct', options: YES, warn: 'If a count is wrong: search, X-ray if needed, and do not sign out until resolved.' },
      { key: 'specimens_labelled', label: 'Specimens labelled (including patient name)', options: YES_NA },
      { key: 'equipment_problems', label: 'Equipment problems to be addressed', options: [['none', 'None'], ['reported', 'Yes — reported to maintenance']] },
      { key: 'recovery_concerns', label: 'Key concerns for recovery and management reviewed', options: YES },
    ],
  },
}

/** First item of a phase that is missing or not acceptable, or '' when the phase is complete. */
export function phaseProblem(phase, answers = {}) {
  const def = WHO_PHASES[phase]
  const bad = def.items.find((i) => !i.options.some(([v]) => v === answers?.[i.key]))
  return bad ? bad.label : ''
}

/** Modified Aldrete score (0–10): activity, respiration, circulation, consciousness, oxygen saturation (0–2 each). */
export const ALDRETE = [
  { key: 'activity', label: 'Activity', options: ['Unable to move limbs (0)', 'Moves 2 limbs (1)', 'Moves 4 limbs (2)'] },
  { key: 'respiration', label: 'Respiration', options: ['Apnoeic (0)', 'Dyspnoea / limited breathing (1)', 'Breathes deeply and coughs freely (2)'] },
  { key: 'circulation', label: 'Circulation (BP vs pre-op)', options: ['± more than 50% (0)', '± 20–50% (1)', '± up to 20% (2)'] },
  { key: 'consciousness', label: 'Consciousness', options: ['Not responding (0)', 'Arousable on calling (1)', 'Fully awake (2)'] },
  { key: 'spo2', label: 'Oxygen saturation', options: ['< 90% even with oxygen (0)', 'Needs oxygen to keep > 90% (1)', '> 92% on room air (2)'] },
]

export function aldreteTotal(scores = {}) {
  const vals = ALDRETE.map((a) => scores[a.key])
  if (vals.some((v) => v === undefined || v === '' || v === null)) return null
  return vals.reduce((sum, v) => sum + Number(v), 0)
}

export const CLAVIEN_DINDO = {
  none: 'No complication',
  I: 'I — deviation from normal course, no specific treatment',
  II: 'II — needed drugs, blood transfusion or parenteral nutrition',
  IIIa: 'IIIa — intervention without general anaesthesia',
  IIIb: 'IIIb — intervention under general anaesthesia',
  IVa: 'IVa — single-organ dysfunction (ICU)',
  IVb: 'IVb — multi-organ dysfunction (ICU)',
  V: 'V — death',
}

/** Where the case is in its journey, for the board and the step bar. */
export function caseStage(c = {}) {
  if (c.status === 'cancelled' || c.status === 'postponed') return 'cancelled'
  if (c.status === 'completed') return 'completed'
  if (c.out_of_theatre || c.status === 'recovery') return 'recovery'
  if (c.sign_out_at) return 'sign_out_done'
  if (c.knife_to_skin) return 'operating'
  if (c.time_out_at) return 'time_out_done'
  if (c.sign_in_at) return 'sign_in_done'
  return 'booked'
}

export const OP_NOTE_FIELDS = [
  { key: 'procedure_performed', label: 'Procedure performed', required: true },
  { key: 'indication', label: 'Indication / pre-operative diagnosis' },
  { key: 'findings', label: 'Findings', required: true, long: true },
  { key: 'steps', label: 'Procedure details (incision, steps, closure)', long: true },
  { key: 'blood_loss_ml', label: 'Estimated blood loss (mL)', type: 'number' },
  { key: 'drains', label: 'Drains / catheters' },
  { key: 'specimens', label: 'Specimens sent' },
  { key: 'intra_op_complications', label: 'Intra-operative complications' },
  { key: 'post_op_plan', label: 'Post-operative plan and instructions', required: true, long: true },
]
