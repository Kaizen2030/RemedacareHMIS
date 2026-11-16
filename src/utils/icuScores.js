// ICU scores and checks. The database computes and stores these (sofa_score / icu_pbw / icu_infusion_rate /
// icu_entries_before in 20261206000000_icu.sql); this file mirrors them for the live preview while the nurse types.

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
const round = (v, dp = 1) => (v === null || Number.isNaN(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp)

/** SOFA (Vincent 1996) in SI units: bilirubin and creatinine in µmol/L, platelets ×10⁹/L, PaO₂ in mmHg or kPa. */
export function sofa(d = {}) {
  const pao2 = num(d.pao2) ?? (num(d.pao2_kpa) === null ? null : num(d.pao2_kpa) * 7.50062)
  let fio2 = num(d.fio2)
  if (fio2 !== null && fio2 > 1) fio2 /= 100
  const support = Boolean(d.resp_support)
  const pf = pao2 !== null && fio2 > 0 ? pao2 / fio2 : null
  const plt = num(d.platelets), bili = num(d.bilirubin), map = num(d.map), gcs = num(d.gcs), cr = num(d.creatinine), uo = num(d.urine_24h)
  const dopa = num(d.dopamine) || 0, dobu = num(d.dobutamine) || 0, adr = num(d.adrenaline) || 0, nor = num(d.noradrenaline) || 0
  const parts = {
    respiration: pf === null ? null : pf < 100 && support ? 4 : pf < 200 && support ? 3 : pf < 300 ? 2 : pf < 400 ? 1 : 0,
    coagulation: plt === null ? null : plt < 20 ? 4 : plt < 50 ? 3 : plt < 100 ? 2 : plt < 150 ? 1 : 0,
    liver: bili === null ? null : bili > 204 ? 4 : bili >= 102 ? 3 : bili >= 33 ? 2 : bili >= 20 ? 1 : 0,
    cardiovascular: dopa > 15 || adr > 0.1 || nor > 0.1 ? 4 : dopa > 5 || adr > 0 || nor > 0 ? 3 : dopa > 0 || dobu > 0 ? 2 : map === null ? null : map < 70 ? 1 : 0,
    cns: gcs === null ? null : gcs < 6 ? 4 : gcs <= 9 ? 3 : gcs <= 12 ? 2 : gcs <= 14 ? 1 : 0,
    renal: cr === null && uo === null ? null
      : (cr !== null && cr > 440) || (uo !== null && uo < 200) ? 4
        : (cr !== null && cr >= 300) || (uo !== null && uo < 500) ? 3
          : cr === null ? null : cr >= 171 ? 2 : cr >= 110 ? 1 : 0,
  }
  return {
    parts, pf_ratio: pf === null ? null : Math.round(pf),
    total: Object.values(parts).reduce((s, v) => s + (v || 0), 0),
    missing: Object.keys(parts).filter((k) => parts[k] === null),
  }
}

/** Predicted body weight (ARDSNet). */
export function pbw(heightCm, sex) {
  const h = num(heightCm)
  if (h === null || h < 100) return null
  return round((sex === 'female' ? 45.5 : 50) + 0.91 * (h - 152.4))
}

export const DOSE_UNITS = ['mcg/kg/min', 'mcg/min', 'mg/h', 'mg/kg/h', 'units/h', 'mL/h']

/** Pump rate (mL/h) from the dose, the amount (mg or units) in the syringe/bag, its volume and the weight. */
export function infusionRate({ dose, dose_unit: unit, amount, volume_ml: vol, weight_kg: w } = {}) {
  const d = num(dose), a = num(amount), v = num(vol), kg = num(w)
  if (d === null) return null
  if (unit === 'mL/h') return round(d)
  if (!(a > 0) || !(v > 0)) return null
  const perMl = a / v
  if (unit === 'mcg/kg/min') return kg > 0 ? round((d * kg * 60) / (perMl * 1000)) : null
  if (unit === 'mcg/min') return round((d * 60) / (perMl * 1000))
  if (unit === 'mg/h' || unit === 'units/h') return round(d / perMl)
  if (unit === 'mg/kg/h') return kg > 0 ? round((d * kg) / perMl) : null
  return null
}

export const HIGH_ALERT = /(noradrenalin|norepinephrin|adrenalin|epinephrin|dopamin|dobutamin|vasopressin|insulin|heparin|potassium|kcl|magnesium|midazolam|fentanyl|morphine|propofol|ketamine|oxytocin)/i
export const isHighAlert = (drug) => HIGH_ALERT.test(drug || '')

/** Ventilator checks (same thresholds as the database). */
export function ventCheck(d = {}, admission = {}) {
  const p = pbw(admission.height_cm, admission.sex)
  const vt = num(d.vt), pplat = num(d.pplat), peep = num(d.peep)
  let fio2 = num(d.fio2)
  if (fio2 !== null && fio2 <= 1) fio2 *= 100
  const calc = { pbw: p, vt_ml_kg: vt !== null && p ? round(vt / p) : null, driving_pressure: pplat !== null && peep !== null ? pplat - peep : null,
    target_vt: p ? [Math.round(p * 6), Math.round(p * 8)] : null }
  const flags = []
  if (calc.vt_ml_kg > 8) flags.push('Tidal volume above 8 mL/kg predicted body weight (lung-protective 6–8)')
  if (pplat > 30) flags.push('Plateau pressure above 30 cmH₂O')
  if (calc.driving_pressure > 15) flags.push('Driving pressure above 15 cmH₂O')
  if (fio2 >= 60) flags.push('FiO₂ 60% or more')
  return { calc, flags }
}

export const RASS = [
  ['4', '+4 Combative'], ['3', '+3 Very agitated'], ['2', '+2 Agitated'], ['1', '+1 Restless'], ['0', '0 Alert and calm'],
  ['-1', '-1 Drowsy (eyes open to voice > 10 s)'], ['-2', '-2 Light sedation (< 10 s)'], ['-3', '-3 Moderate (movement to voice, no eye contact)'],
  ['-4', '-4 Deep (no response to voice, moves to touch)'], ['-5', '-5 Unrousable'],
]

/** CPOT: four items scored 0–2. */
export const CPOT = [
  { key: 'face', label: 'Facial expression', options: ['Relaxed (0)', 'Tense (1)', 'Grimacing (2)'] },
  { key: 'body', label: 'Body movements', options: ['Absent / normal (0)', 'Protection (1)', 'Restless / agitated (2)'] },
  { key: 'tension', label: 'Muscle tension', options: ['Relaxed (0)', 'Tense, rigid (1)', 'Very tense or rigid (2)'] },
  { key: 'vent', label: 'Ventilator compliance (or vocalisation if extubated)', options: ['Tolerating / normal tone (0)', 'Coughing but tolerating / sighing, moaning (1)', 'Fighting ventilator / crying out (2)'] },
]

/** Daily goals — FAST HUGS BID. */
export const DAILY_GOALS = [
  ['feeding', 'Feeding started / goal reached (enteral if possible)'],
  ['analgesia', 'Analgesia adequate (CPOT < 3 or pain score < 4)'],
  ['sedation', 'Sedation at target; daily sedation hold done'],
  ['thromboprophylaxis', 'Thromboprophylaxis (heparin / stockings) given'],
  ['head_up', 'Head of bed raised 30–45°'],
  ['ulcer', 'Stress-ulcer prophylaxis reviewed'],
  ['glucose', 'Glucose 6–10 mmol/L'],
  ['sbt', 'Spontaneous breathing trial / weaning assessed'],
  ['bowels', 'Bowels opened / bowel care'],
  ['lines', 'Lines, catheter and tubes — still needed? (remove if not)'],
  ['antibiotics', 'Antibiotics reviewed / de-escalated against cultures'],
  ['mobilise', 'Physiotherapy / early mobilisation'],
]

export const SOFA_FIELDS = [
  ['pao2', 'PaO₂ (mmHg)'], ['fio2', 'FiO₂ (% or 0.21–1)'], ['platelets', 'Platelets ×10⁹/L'], ['bilirubin', 'Bilirubin µmol/L'],
  ['map', 'MAP mmHg'], ['dopamine', 'Dopamine mcg/kg/min'], ['dobutamine', 'Dobutamine mcg/kg/min'], ['adrenaline', 'Adrenaline mcg/kg/min'],
  ['noradrenaline', 'Noradrenaline mcg/kg/min'], ['gcs', 'GCS'], ['creatinine', 'Creatinine µmol/L'], ['urine_24h', 'Urine output 24 h (mL)'],
]

/** Active infusions: the latest start/change per drug that has not been stopped (struck-out entries ignored). */
export function activeInfusions(entries = []) {
  const latest = new Map()
  for (const e of [...entries].filter((x) => x.kind === 'infusion' && !x.struck_out_at).sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))) {
    latest.set(String(e.data?.drug || '').trim().toLowerCase(), e)
  }
  return [...latest.values()].filter((e) => e.data?.action !== 'stop')
}

export const daysIn = (admittedAt, until = new Date()) => Math.max(0, Math.floor((new Date(until) - new Date(admittedAt)) / 86400000)) + 1
