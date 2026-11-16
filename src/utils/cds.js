// Clinical decision support for prescribing and dispensing.
//   runCds({ rows, patient, activeMeds, labs, extraInteractions }) → alerts
//   alert = { rowIndex, rule, severity: 'danger' | 'warning' | 'info', title, message }
// 'danger' alerts need an acknowledgement and a written override reason (logged to the audit trail).
// Pure functions: no network, so it runs on every keystroke in Consultation and at the pharmacy counter.
import { ALLERGY_GROUPS, DRUGS, DUPLICATE_CLASSES, INTERACTIONS } from '../data/clinicalReference'

const norm = (v) => ` ${String(v || '').toLowerCase().replace(/[^a-z0-9/+.\- ]+/g, ' ').replace(/\s+/g, ' ').trim()} `
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordRe = (w) => new RegExp(`(^|[^a-z0-9])${escapeRe(w.trim().toLowerCase())}([^a-z0-9]|$)`)
const NAME_RES = DRUGS.map((d) => ({ d, res: d.names.map(wordRe) }))
const RES_BY_ID = Object.fromEntries(NAME_RES.map(({ d, res }) => [d.id, res]))
const GROUP_RES = ALLERGY_GROUPS.map((g) => ({ g, res: g.words.map(wordRe) }))

/** All reference drugs mentioned in a free-text drug name (combinations like "TLD" or "RHZE" give several). */
export function identifyDrugs(name) {
  const text = norm(name)
  if (!text.trim()) return []
  return NAME_RES.filter(({ res }) => res.some((re) => re.test(text))).map(({ d }) => d)
}

const FREQ = [
  [/\b(qid|qds|6\s*-?\s*hourly|6\s*hrly|q6h|four times)\b/, 4],
  [/\b(tds|tid|8\s*-?\s*hourly|8\s*hrly|q8h|three times|thrice)\b/, 3],
  [/\b(bd|bid|12\s*-?\s*hourly|12\s*hrly|q12h|twice)\b/, 2],
  [/\b(4\s*-?\s*hourly|q4h)\b/, 6],
  [/\b(od|once daily|daily|mane|nocte|24\s*-?\s*hourly|q24h|once a day|at night|in the morning)\b/, 1],
  [/\b(stat|single dose|once only)\b/, 1],
  [/\b(weekly|once a week)\b/, 1 / 7],
]
/** Doses per day from a frequency string; null when unknown (PRN or free text). */
export function timesPerDay(frequency) {
  const f = String(frequency || '').toLowerCase()
  if (/as needed|\bprn\b/.test(f)) return null
  const every = /(?:every|q)\s*(\d{1,2})\s*(?:-\s*)?h(?:ou)?r?s?\b/.exec(f)
  if (every && Number(every[1]) > 0) return 24 / Number(every[1])
  for (const [re, n] of FREQ) if (re.test(f)) return n
  return null
}

/** Milligrams in one dose from "500mg", "1 g", "250mg/5ml 10ml", "125 mcg". null when not stated in mass units. */
export function doseMg(dosage) {
  const t = String(dosage || '').toLowerCase().replace(/,/g, '.')
  const conc = /(\d+(?:\.\d+)?)\s*mg\s*\/\s*(\d+(?:\.\d+)?)\s*ml/.exec(t)
  if (conc) {
    const rest = t.slice(conc.index + conc[0].length)
    const vol = /(\d+(?:\.\d+)?)\s*ml/.exec(rest)
    return vol ? (Number(conc[1]) / Number(conc[2])) * Number(vol[1]) : null
  }
  const m = /(\d+(?:\.\d+)?)\s*(mg|g|gm|grams?|mcg|µg|ug)\b/.exec(t)
  if (!m) return null
  const n = Number(m[1])
  return /^g/.test(m[2]) ? n * 1000 : /mcg|µg|ug/.test(m[2]) ? n / 1000 : n
}

/** CKD-EPI 2021 (race-free) eGFR from creatinine in µmol/L. */
export function egfrCkdEpi2021(creatinineUmolL, ageYears, sex) {
  const scr = Number(creatinineUmolL) / 88.4
  const age = Number(ageYears)
  if (!(scr > 0) || !(age >= 18)) return null
  const female = /^f/i.test(String(sex || ''))
  const k = female ? 0.7 : 0.9
  const a = female ? -0.241 : -0.302
  const egfr = 142 * Math.min(scr / k, 1) ** a * Math.max(scr / k, 1) ** -1.2 * 0.9938 ** age * (female ? 1.012 : 1)
  return Math.round(egfr)
}

export function ageInYears(patient = {}) {
  if (patient.age_years != null && patient.age_years !== '') return Number(patient.age_years)
  if (patient.date_of_birth || patient.dob) {
    const dob = new Date(patient.date_of_birth || patient.dob)
    if (!Number.isNaN(dob.getTime())) return (Date.now() - dob.getTime()) / (365.25 * 86400000)
  }
  const a = String(patient.age ?? '').toLowerCase()
  const n = parseFloat(a)
  if (Number.isNaN(n)) return null
  if (/month|mo\b|mths?/.test(a)) return n / 12
  if (/week|wk/.test(a)) return n / 52
  if (/day/.test(a)) return n / 365
  return n
}

const hasClass = (drugs, cls) => drugs.some((d) => d.classes.includes(cls))
const matches = (drugs, key) => (key.startsWith('class:') ? hasClass(drugs, key.slice(6)) : drugs.some((d) => d.id === key))
const label = (key) => (key.startsWith('class:') ? key.slice(6).replace(/_/g, ' ') : key)

/**
 * rows: [{ drug_name, dosage, frequency }] being prescribed / dispensed now.
 * patient: { age | age_years | date_of_birth, sex | gender, weight_kg, allergies, pregnant }
 * activeMeds: drug names the patient is already taking (for interactions and duplicates).
 * labs: { egfr, creatinine (µmol/L), potassium (mmol/L) }
 * extraInteractions: hospital rules from the database, same shape as INTERACTIONS rows or objects {a,b,severity,message}.
 */
export function runCds({ rows = [], patient = {}, activeMeds = [], labs = {}, extraInteractions = [] } = {}) {
  const alerts = []
  const push = (rowIndex, rule, severity, title, message) => alerts.push({ rowIndex, rule, severity, title, message })
  const age = ageInYears(patient)
  const weight = Number(patient.weight_kg || patient.weight || 0) || null
  const pregnant = patient.pregnant === true || /^(yes|pregnant|true)/i.test(String(patient.pregnant ?? patient.pregnancy_status ?? ''))
  const egfr = labs.egfr != null && labs.egfr !== '' ? Number(labs.egfr)
    : labs.creatinine ? egfrCkdEpi2021(labs.creatinine, age, patient.sex || patient.gender) : null
  const allergyText = norm(patient.allergies)
  const noAllergy = /^\s*(nil|none|nkda|no known|n\/a|-)?\s*$/i.test(String(patient.allergies || '').trim())

  const items = rows.map((r, rowIndex) => ({ rowIndex, row: r, drugs: identifyDrugs(r?.drug_name) })).filter((x) => String(x.row?.drug_name || '').trim())
  const active = activeMeds.map((name) => ({ name, drugs: identifyDrugs(name) })).filter((x) => x.drugs.length)

  for (const { rowIndex, row, drugs } of items) {
    const name = row.drug_name
    // ── allergies (direct, class, cross-reactive)
    if (!noAllergy && allergyText.trim()) {
      const direct = drugs.find((d) => RES_BY_ID[d.id].some((re) => re.test(allergyText)))
      const named = GROUP_RES.filter(({ res }) => res.some((re) => re.test(allergyText))).map(({ g }) => g)
      const group = named.find((g) => g.classes.some((c) => hasClass(drugs, c)))
      const cross = !group && named.find((g) => (g.crossClasses || []).some((c) => hasClass(drugs, c)))
      if (direct || group) push(rowIndex, 'allergy', 'danger', 'Allergy', `${name}: patient allergy recorded (“${String(patient.allergies).trim()}”).`)
      else if (cross) push(rowIndex, 'allergy_cross', 'warning', 'Possible cross-allergy', `${name}: patient is allergic to ${cross.classes[0]}s — small cross-reactivity risk. Avoid if the reaction was anaphylaxis.`)
    }

    for (const d of drugs) {
      // ── age
      if (d.minAge && age != null && age < d.minAge) {
        push(rowIndex, `min_age:${d.id}`, 'danger', 'Age', `${name}: not recommended under ${d.minAge < 1 ? `${Math.round(d.minAge * 12)} months` : `${d.minAge} years`}${d.minAgeNote ? ` — ${d.minAgeNote}` : ''}.`)
      }
      // ── pregnancy
      if (pregnant && d.pregnancy === 'avoid') push(rowIndex, `pregnancy:${d.id}`, 'danger', 'Pregnancy', `${name}: avoid in pregnancy${d.pregnancyNote ? ` — ${d.pregnancyNote}` : ''}.`)
      else if (pregnant && d.pregnancy === 'caution') push(rowIndex, `pregnancy:${d.id}`, 'warning', 'Pregnancy', `${name}: use with caution in pregnancy${d.pregnancyNote ? ` — ${d.pregnancyNote}` : ''}.`)
      // ── kidney function
      if (egfr != null && d.renal) {
        const rule = [...d.renal].sort((a, b) => a.below - b.below).find((r) => egfr < r.below)
        if (rule) push(rowIndex, `renal:${d.id}`, rule.action === 'avoid' ? 'danger' : 'warning', 'Kidney function',
          `${name}: eGFR ${egfr} (below ${rule.below}) — ${rule.action === 'avoid' ? 'avoid' : 'dose adjustment needed'}: ${rule.note}.`)
      }
    }

    // ── dose (only when the line is a single known drug and the dose is in mg)
    if (drugs.length === 1) {
      const d = drugs[0]
      const mg = doseMg(row.dosage)
      const perDay = timesPerDay(row.frequency)
      if (mg != null) {
        const paedRange = age != null && age < 12
        if (paedRange && d.paed && weight) {
          const perKg = mg / weight
          if (perKg > d.paed.dose * 1.1) push(rowIndex, `dose_paed:${d.id}`, 'danger', 'Dose (child)', `${name}: ${Math.round(perKg * 10) / 10} mg/kg per dose — maximum about ${d.paed.dose} mg/kg (${Math.round(d.paed.dose * weight)} mg for ${weight} kg).`)
          else if (perDay && perKg * perDay > d.paed.day * 1.1) push(rowIndex, `dose_paed_day:${d.id}`, 'danger', 'Dose (child)', `${name}: ${Math.round(perKg * perDay)} mg/kg/day — maximum about ${d.paed.day} mg/kg/day.`)
        } else if (paedRange && d.paed && !weight) {
          push(rowIndex, `dose_paed_weight:${d.id}`, 'info', 'Dose (child)', `${name}: record the child's weight to check the dose.`)
        }
        if (d.adult) {
          if (mg > d.adult.single * 1.001) push(rowIndex, `dose_single:${d.id}`, 'danger', 'Dose', `${name}: ${mg} mg per dose is above the usual maximum of ${d.adult.single} mg.`)
          else if (perDay && mg * perDay > d.adult.daily * 1.001) push(rowIndex, `dose_daily:${d.id}`, 'danger', 'Dose', `${name}: ${Math.round(mg * perDay)} mg/day is above the maximum of ${d.adult.daily} mg/day.`)
        }
      }
    }

    // ── abnormal results that matter for this drug
    const k = Number(labs.potassium)
    if (k >= 5.5 && drugs.some((d) => d.classes.some((c) => ['ace_inhibitor', 'arb', 'potassium_sparing', 'potassium'].includes(c)))) {
      push(rowIndex, 'lab_potassium', 'danger', 'Abnormal result', `${name}: latest potassium is ${k} mmol/L — this drug raises potassium further.`)
    }
  }

  // ── interactions and duplicates (new × new and new × already taking)
  const rules = [
    ...INTERACTIONS.map(([a, b, severity, message]) => ({ a, b, severity, message })),
    ...[...extraInteractions, ...HOSPITAL_RULES].map((r) => (Array.isArray(r) ? { a: r[0], b: r[1], severity: r[2], message: r[3] } : r)),
  ]
  const pool = [
    ...items.map((x) => ({ key: `row${x.rowIndex}`, rowIndex: x.rowIndex, name: x.row.drug_name, drugs: x.drugs, current: false })),
    ...active.map((x, i) => ({ key: `active${i}`, rowIndex: null, name: x.name, drugs: x.drugs, current: true })),
  ]
  const seen = new Set()
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const A = pool[i], B = pool[j]
      if (A.current && B.current) continue
      const target = A.current ? B : A
      const other = A.current ? A : B
      for (const r of rules) {
        if (!((matches(A.drugs, r.a) && matches(B.drugs, r.b)) || (matches(A.drugs, r.b) && matches(B.drugs, r.a)))) continue
        const id = `ix:${target.rowIndex}:${r.a}:${r.b}`
        if (seen.has(id)) continue
        seen.add(id)
        const sev = r.severity === 'moderate' ? 'warning' : 'danger'
        push(target.rowIndex, `interaction:${label(r.a)}+${label(r.b)}`, sev, r.severity === 'contraindicated' ? 'Contraindicated combination' : 'Interaction',
          `${target.name} + ${other.name}${other.current ? ' (already taking)' : ''}: ${r.message}`)
      }
      for (const [cls, text] of Object.entries(DUPLICATE_CLASSES)) {
        if (!hasClass(A.drugs, cls) || !hasClass(B.drugs, cls)) continue
        // the same combination product on one line (e.g. TLD) is not a duplicate of itself
        const id = `dup:${target.rowIndex}:${cls}`
        if (seen.has(id)) continue
        seen.add(id)
        push(target.rowIndex, `duplicate:${cls}`, 'warning', 'Duplicate therapy', `${target.name} + ${other.name}${other.current ? ' (already taking)' : ''}: ${text}. Is this intended?`)
      }
    }
  }
  return alerts
}

/** Group alerts by prescription row: { [rowIndex]: alert[] } (the shape Consultation already uses). */
export function alertsByRow(alerts = []) {
  return alerts.reduce((acc, a) => {
    const k = a.rowIndex ?? -1
    ;(acc[k] = acc[k] || []).push(a)
    return acc
  }, {})
}

export const SEVERITY_ORDER = { danger: 0, warning: 1, info: 2 }

/** Counter checks for the pharmacy release window. items: [{ rx, inventoryItem }]; group: the patient card. */
export function pharmacyCdsAlerts(group = {}, items = []) {
  const ids = new Set(items.map((i) => i?.rx?.id).filter(Boolean))
  const recent = (group?.drugs || []).filter((rx) => !ids.has(rx.id) && (rx.status === 'Released' || rx.dispensed_at)
    && Date.now() - new Date(rx.dispensed_at || rx.created_at || 0).getTime() < 30 * 86400000)
  return runCds({
    rows: items.map((i) => ({ drug_name: i?.inventoryItem?.drug_name || i?.rx?.drug_name, dosage: i?.rx?.dosage, frequency: i?.rx?.frequency })),
    patient: { allergies: group?.allergies, age: group?.age, sex: group?.gender, weight_kg: group?.latestVitals?.weight_kg },
    activeMeds: recent.map((rx) => rx.drug_name),
  })
}

// Hospital interaction rules (drug_interactions table), loaded once per screen and used by every check.
let HOSPITAL_RULES = []
export function setHospitalInteractions(rows = []) {
  HOSPITAL_RULES = (rows || []).filter((r) => r && r.active !== false && r.a && r.b)
    .map((r) => ({ a: String(r.a).toLowerCase(), b: String(r.b).toLowerCase(), severity: r.severity, message: r.message }))
}
export const hospitalInteractions = () => HOSPITAL_RULES
export async function loadHospitalInteractions(supabase, hospitalId) {
  if (!hospitalId) return
  try {
    const { data } = await supabase.from('drug_interactions').select('a, b, severity, message, active').eq('hospital_id', hospitalId)
    setHospitalInteractions(data || [])
  } catch (_) { /* table not installed yet */ }
}
