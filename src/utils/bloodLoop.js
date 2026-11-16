// Transfusion closed loop rules. The database enforces all of these (20261207000000_blood_transfusion.sql); this file
// mirrors them so the screens can show what is allowed before the user presses the button.
import { isCompatibleBloodGroup } from './bloodBank'

export const COMPONENTS = ['Packed Red Cells', 'Whole Blood', 'Fresh Frozen Plasma', 'Platelets', 'Cryoprecipitate']
export const RED_CELLS = ['Packed Red Cells', 'Whole Blood']

const abo = (g) => String(g || '').toUpperCase().replace(/\s+/g, '').replace(/[+-]$/, '')

/** Plasma / cryo: AB plasma suits everyone; O plasma only O patients. Rh ignored. */
export function plasmaCompatible(donor, recipient) {
  const d = abo(donor), r = abo(recipient)
  if (d === 'AB') return true
  if (d === 'A') return ['A', 'O'].includes(r)
  if (d === 'B') return ['B', 'O'].includes(r)
  if (d === 'O') return r === 'O'
  return false
}

/** Lab grouping status from the patient's (non-voided) group tests. */
export function groupStatus(tests = []) {
  const live = tests.filter((t) => !t.void_reason)
  const groups = [...new Set(live.map((t) => t.result_group))]
  if (!live.length) return { status: 'none', group: null, samples: 0 }
  if (groups.length > 1) return { status: 'discrepant', group: null, samples: live.length }
  return { status: live.length === 1 ? 'single' : 'confirmed', group: groups[0], samples: live.length }
}

export const GROUP_STATUS_LABEL = {
  none: ['Not grouped', 'red'], single: ['Grouped once — send a second sample to confirm', 'yellow'],
  confirmed: ['Confirmed (2 samples)', 'green'], discrepant: ['DISCREPANCY — recollect', 'red'],
}

/** Units the blood bank may issue for this request (mirrors enforce_blood_bank_unit_safety). */
export function issuableUnits(request, units = [], crossmatches = [], gs = { status: 'none' }, now = Date.now()) {
  if (!request || ['completed', 'cancelled'].includes(request.status)) return []
  const ok = (u) => u.screening_status === 'clear' && new Date(u.expiry_at).getTime() > now && ['Available', 'Reserved'].includes(u.status)
    && (u.status !== 'Reserved' || u.reserved_for_patient_id === request.patient_id)
  const comp = request.component
  const sameComponent = (u) => u.component === comp || (comp === 'Packed Red Cells' && u.component === 'Whole Blood')
  return units.filter((u) => ok(u) && sameComponent(u)).map((u) => {
    if (RED_CELLS.includes(u.component)) {
      const xm = crossmatches.find((x) => x.blood_unit_id === u.id && x.patient_id === request.patient_id && x.result === 'Compatible' && new Date(x.expires_at).getTime() > now)
      if (xm && gs.status !== 'discrepant' && gs.group && isCompatibleBloodGroup(u.blood_group, gs.group)) return { unit: u, crossmatch: xm }
      if (request.emergency_release && (u.blood_group === 'O-' || (u.blood_group === 'O+' && gs.group && !gs.group.endsWith('-')))) return { unit: u, crossmatch: null, emergency: true }
      return null
    }
    if (/plasma|cryo/i.test(u.component)) return gs.group && gs.status !== 'discrepant' && plasmaCompatible(u.blood_group, gs.group) ? { unit: u } : null
    return { unit: u }
  }).filter(Boolean)
}

/** Possible reaction at 15 minutes (same thresholds as the database). */
export function possibleReaction(baseline = {}, obs = {}) {
  const n = (v) => (v === '' || v === undefined || v === null ? null : Number(v))
  const [bt, bh, bs, ot, oh, os] = [n(baseline.temp), n(baseline.hr), n(baseline.sbp), n(obs.temp), n(obs.hr), n(obs.sbp)]
  if ([ot, oh, os].some((v) => v === null)) return false
  return ot - bt >= 1 || ot >= 39 || bs - os >= 30 || oh - bh >= 30
}

export const REACTION_TYPES = [
  ['febrile_non_haemolytic', 'Febrile non-haemolytic'], ['allergic_minor', 'Allergic (urticaria, itch)'], ['anaphylaxis', 'Anaphylaxis'],
  ['acute_haemolytic', 'Acute haemolytic (ABO incompatible)'], ['delayed_haemolytic', 'Delayed haemolytic'], ['taco', 'Circulatory overload (TACO)'],
  ['trali', 'Lung injury (TRALI)'], ['bacterial_contamination', 'Bacterial contamination / sepsis'], ['hypotensive', 'Hypotensive'], ['other', 'Other'],
]
export const SEVERITIES = [['non_severe', 'Non-severe'], ['severe', 'Severe'], ['life_threatening', 'Life-threatening'], ['death', 'Death']]
export const SYMPTOMS = ['Fever / rigors', 'Urticaria / itch', 'Breathlessness', 'Wheeze', 'Hypotension', 'Tachycardia', 'Chest / loin pain', 'Dark urine', 'Bleeding / oozing', 'Restlessness / anxiety']

/** Donor eligibility (KNBTS / WHO), same rules as blood_donation_problem(). Returns null when eligible. */
export function donationProblem(donor = {}, f = {}, at = new Date()) {
  if (donor.permanently_deferred) return `Permanently deferred: ${donor.deferral_reason || 'see donor record'}`
  if (donor.deferred_until && new Date(donor.deferred_until) > at) return `Deferred until ${donor.deferred_until}`
  const age = (at - new Date(donor.date_of_birth)) / (365.25 * 86400000)
  if (!(age >= 16 && age < 66)) return 'Age must be 16 to 65'
  const next = nextEligible(donor)
  if (next && next > at) return `Too soon since the last donation: next eligible ${next.toLocaleDateString('en-KE')}`
  const n = (v) => (v === '' || v === undefined || v === null ? null : Number(v))
  if (!(n(f.weight_kg) >= 50)) return 'Weight must be at least 50 kg'
  if (!(n(f.hb) >= 12.5)) return 'Haemoglobin must be at least 12.5 g/dL'
  if ((n(f.bp_sys) !== null && (n(f.bp_sys) < 100 || n(f.bp_sys) > 180)) || (n(f.bp_dia) !== null && (n(f.bp_dia) < 60 || n(f.bp_dia) > 100))) return 'Blood pressure outside 100–180 / 60–100'
  if (n(f.temp) !== null && n(f.temp) > 37.5) return 'Temperature above 37.5 °C'
  if (!f.questionnaire_ok) return 'Complete the donor health questionnaire'
  return null
}

export function nextEligible(donor = {}) {
  if (!donor.last_donation_at) return null
  return new Date(new Date(donor.last_donation_at).getTime() + (donor.sex === 'female' ? 112 : 84) * 86400000)
}
