// Maternity and child-health rules (pure, tested in maternity.test.js).
// ANC: WHO 2016 model, 8 contacts. Partograph: WHO alert line from 4 cm at 1 cm/hour, action line 4 hours to
// the right. Immunisation: Kenya KEPI schedule.

const DAY = 86400000
const toDate = (v) => (v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T12:00:00`))
export const isoDate = (d) => {
  const x = toDate(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
export const addDays = (d, n) => isoDate(new Date(toDate(d).getTime() + n * DAY))

export const eddFromLmp = (lmp) => (lmp ? addDays(lmp, 280) : null)
export function gestation(lmp, on = new Date()) {
  if (!lmp) return null
  const days = Math.floor((toDate(on).getTime() - toDate(lmp).getTime()) / DAY)
  if (days < 0) return null
  return { weeks: Math.floor(days / 7), days: days % 7, label: `${Math.floor(days / 7)}w ${days % 7}d` }
}

export const ANC_WEEKS = [12, 20, 26, 30, 34, 36, 38, 40]
/** The 8 contacts with due date and whether one was recorded in that window. */
export function ancSchedule(lmp, contacts = [], today = new Date()) {
  if (!lmp) return []
  const gaOf = (c) => (c.ga_weeks != null ? Number(c.ga_weeks) : gestation(lmp, c.visit_date)?.weeks)
  const done = contacts.map(gaOf).filter((w) => w != null).sort((a, b) => a - b)
  const used = new Set()
  return ANC_WEEKS.map((week, i) => {
    const prev = i === 0 ? 0 : ANC_WEEKS[i - 1]
    const matchIdx = done.findIndex((w, j) => !used.has(j) && w > prev && w <= week + 1)
    if (matchIdx >= 0) used.add(matchIdx)
    const due = addDays(lmp, week * 7)
    const met = matchIdx >= 0
    const state = met ? 'done' : toDate(due) < toDate(today) ? 'missed' : 'upcoming'
    return { contact: i + 1, week, due, state }
  })
}

/** Partograph: active phase from the first reading ≥ 4 cm. Each point gets alert/action status. */
export function partographAnalysis(entries = []) {
  const pts = entries.filter((e) => e.cervix_cm != null && e.cervix_cm !== '').map((e) => ({ ...e, t: new Date(e.recorded_at).getTime(), cm: Number(e.cervix_cm) }))
    .sort((a, b) => a.t - b.t)
  const start = pts.find((p) => p.cm >= 4)
  if (!start) return { activeFrom: null, points: pts.map((p) => ({ ...p, hours: null, alertCm: null, status: 'latent' })), status: pts.length ? 'latent' : 'no_readings' }
  const points = pts.map((p) => {
    if (p.t < start.t) return { ...p, hours: null, alertCm: null, status: 'latent' }
    const hours = (p.t - start.t) / 3600000
    const alertCm = Math.min(10, start.cm + hours)            // 1 cm / hour from the first active reading
    const actionCm = Math.min(10, start.cm + Math.max(0, hours - 4))
    const status = p.cm >= 10 ? 'fully_dilated' : p.cm < actionCm ? 'action' : p.cm < alertCm ? 'alert' : 'normal'
    return { ...p, hours: Math.round(hours * 10) / 10, alertCm: Math.round(alertCm * 10) / 10, status }
  })
  const last = points[points.length - 1]
  const fhrBad = entries.some((e) => e.fetal_heart_rate && (e.fetal_heart_rate < 110 || e.fetal_heart_rate > 160))
  const bpBad = entries.some((e) => (e.bp_sys && e.bp_sys >= 140) || (e.bp_dia && e.bp_dia >= 90))
  const feverBad = entries.some((e) => e.temp_c && e.temp_c >= 38)
  const meconium = entries.some((e) => /^m/i.test(String(e.liquor || '')))
  return { activeFrom: new Date(start.t).toISOString(), points, status: last.status, warnings: [
    fhrBad && 'Fetal heart rate outside 110–160',
    bpBad && 'Maternal BP 140/90 or above',
    feverBad && 'Maternal temperature 38 °C or above',
    meconium && 'Meconium-stained liquor',
    last.status === 'alert' && 'Labour progress crossed the ALERT line — reassess, consider referral / augmentation',
    last.status === 'action' && 'Labour progress crossed the ACTION line — act now (obstetric review)',
  ].filter(Boolean) }
}

/** Kenya Expanded Programme on Immunization (KEPI). ageDays = due age. */
export const KEPI = [
  { code: 'BCG', label: 'BCG', ageDays: 0 },
  { code: 'OPV0', label: 'OPV 0 (birth)', ageDays: 0, lastDays: 14 },
  { code: 'OPV1', label: 'OPV 1', ageDays: 42 }, { code: 'PENTA1', label: 'Pentavalent 1', ageDays: 42 },
  { code: 'PCV1', label: 'PCV10 1', ageDays: 42 }, { code: 'ROTA1', label: 'Rotavirus 1', ageDays: 42 },
  { code: 'OPV2', label: 'OPV 2', ageDays: 70 }, { code: 'PENTA2', label: 'Pentavalent 2', ageDays: 70 },
  { code: 'PCV2', label: 'PCV10 2', ageDays: 70 }, { code: 'ROTA2', label: 'Rotavirus 2', ageDays: 70 },
  { code: 'OPV3', label: 'OPV 3', ageDays: 98 }, { code: 'PENTA3', label: 'Pentavalent 3', ageDays: 98 },
  { code: 'PCV3', label: 'PCV10 3', ageDays: 98 }, { code: 'IPV', label: 'IPV', ageDays: 98 },
  { code: 'VITA1', label: 'Vitamin A (6 months)', ageDays: 182 },
  { code: 'MR1', label: 'Measles-Rubella 1', ageDays: 274 },
  { code: 'YF', label: 'Yellow fever (designated counties)', ageDays: 274, optional: true },
  { code: 'MR2', label: 'Measles-Rubella 2', ageDays: 548 },
]

export function immunisationStatus(dob, given = [], today = new Date()) {
  if (!dob) return []
  const byCode = Object.fromEntries(given.map((g) => [g.vaccine, g]))
  return KEPI.map((v) => {
    const due = addDays(dob, v.ageDays)
    const g = byCode[v.code]
    let state = g ? 'given' : toDate(due) > toDate(today) ? 'upcoming' : 'due'
    if (!g && v.lastDays != null && toDate(addDays(dob, v.lastDays)) < toDate(today)) state = 'window_passed'
    if (!g && state === 'due' && (toDate(today).getTime() - toDate(due).getTime()) / DAY > 28) state = 'overdue'
    return { ...v, due, state, givenOn: g?.given_on || null }
  })
}

// ── Original helpers (kept from the previous version)
export function getMaternalRiskLevel({ age = 0, bloodPressure = 0, gestationWeeks = 0, previousCesarean = false, parity = 0 }) {
  if (Number(age || 0) < 18 || Number(bloodPressure || 0) >= 160 || Number(gestationWeeks || 0) < 37 || previousCesarean || Number(parity || 0) >= 5) {
    return 'High'
  }

  if (Number(age || 0) > 35 || Number(bloodPressure || 0) >= 140 || Number(gestationWeeks || 0) <= 38 || Number(parity || 0) >= 3) {
    return 'Medium'
  }

  return 'Low'
}

export function canAdmitForDelivery({ dilationCm = 0, contractions = 0, riskLevel = 'Low' }) {
  const activeLabour = Number(dilationCm || 0) >= 4 || Number(contractions || 0) >= 3
  if (riskLevel === 'High') {
    return activeLabour || Number(dilationCm || 0) >= 2
  }
  return activeLabour
}
