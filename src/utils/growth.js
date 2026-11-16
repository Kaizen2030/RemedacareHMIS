// WHO growth z-scores for children 0–5 years (mirrors growth_z / growth_measurements_before in
// 20261213000000_growth_ortho_oncology.sql). LMS method; weight-based indicators use WHO's restricted method beyond ±3 SD.
import { WHO } from './growthReference'

const sexKey = (sex) => (/^f/i.test(String(sex || '')) ? '2' : /^m/i.test(String(sex || '')) ? '1' : null)

/** Linear interpolation of L, M, S between reference rows. */
export function lmsAt(table, x) {
  if (!table?.length || x === null || x === undefined || Number.isNaN(x) || x < table[0][0] || x > table[table.length - 1][0]) return null
  const i = table.findIndex((r) => r[0] >= x)
  if (table[i][0] === x) return table[i].slice(1)
  const a = table[i - 1], b = table[i], t = (x - a[0]) / (b[0] - a[0])
  return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
}

export function zFromLms(value, lms, restricted = false) {
  if (!lms || !(Number(value) > 0)) return null
  const [L, M, S] = lms, v = Number(value)
  let z = L === 0 ? Math.log(v / M) / S : ((v / M) ** L - 1) / (L * S)
  if (restricted && Math.abs(z) > 3) {
    const sd = (k) => M * (1 + L * S * k) ** (1 / L)
    z = z > 3 ? 3 + (v - sd(3)) / (sd(3) - sd(2)) : -3 + (v - sd(-3)) / (sd(-2) - sd(-3))
  }
  return Math.round(z * 100) / 100
}

/** Value at a given z (for drawing the reference curves). */
export function valueAtZ(lms, z) {
  const [L, M, S] = lms
  return L === 0 ? M * Math.exp(S * z) : M * (1 + L * S * z) ** (1 / L)
}

export function ageInDays(dob, on = new Date()) {
  if (!dob) return null
  return Math.floor((new Date(on).setHours(12) - new Date(dob).setHours(12)) / 86400000)
}

/**
 * m: { sex, age_days, weight_kg, length_cm, measured ('length' | 'height'), hc_cm, muac_cm, oedema }
 * Returns { waz, haz, whz, hcz, flags } — same rules as the database.
 */
export function growthAssess(m = {}) {
  const sex = sexKey(m.sex), age = Number(m.age_days)
  const out = { waz: null, haz: null, whz: null, hcz: null, flags: [] }
  if (!sex || m.age_days === null || m.age_days === undefined || m.age_days === '' || age < 0 || age > 1856) return out
  let len = m.length_cm === '' || m.length_cm === null || m.length_cm === undefined ? null : Number(m.length_cm)
  if (len !== null) {
    if (age < 731 && m.measured === 'height') len += 0.7      // standing height under 2 years: add 0.7 cm
    if (age >= 731 && m.measured === 'length') len -= 0.7     // lying length from 2 years: subtract 0.7 cm
  }
  out.waz = zFromLms(m.weight_kg, lmsAt(WHO.wfa[sex], age), true)
  out.haz = len === null ? null : zFromLms(len, lmsAt(WHO.lhfa[sex], age))
  out.hcz = zFromLms(m.hc_cm, lmsAt(WHO.hcfa[sex], age))
  if (len !== null) out.whz = zFromLms(m.weight_kg, lmsAt(age < 731 ? WHO.wfl[sex] : WHO.wfh[sex], Math.round(len * 10) / 10), true)
  const muac = m.muac_cm === '' || m.muac_cm === null || m.muac_cm === undefined ? null : Number(m.muac_cm)
  const f = out.flags
  if (m.oedema) f.push('Bilateral pitting oedema: severe acute malnutrition (kwashiorkor) — admit / OTP per IMAM protocol')
  else if ((out.whz !== null && out.whz < -3) || (muac !== null && age >= 183 && muac < 11.5)) f.push('Severe acute malnutrition (WHZ < −3 or MUAC < 11.5 cm): check appetite and complications; OTP or inpatient care')
  else if ((out.whz !== null && out.whz < -2) || (muac !== null && age >= 183 && muac < 12.5)) f.push('Moderate acute malnutrition (WHZ < −2 or MUAC < 12.5 cm): supplementary feeding programme')
  if (out.haz !== null && out.haz < -3) f.push('Severe stunting (HAZ < −3)')
  else if (out.haz !== null && out.haz < -2) f.push('Stunting (HAZ < −2): nutrition counselling and follow-up')
  if (out.waz !== null && out.waz < -2) f.push('Underweight (WAZ < −2)')
  if (out.whz !== null && out.whz > 3) f.push('Obesity (WHZ > +3)')
  else if (out.whz !== null && out.whz > 2) f.push('Overweight (WHZ > +2)')
  if (out.hcz !== null && out.hcz < -2) f.push('Small head circumference (HCZ < −2): assess for microcephaly')
  if (out.hcz !== null && out.hcz > 2) f.push('Large head circumference (HCZ > +2): assess for hydrocephalus')
  return out
}

export function referenceCurve(indicator, sex, zs = [-3, -2, 0, 2, 3]) {
  const t = WHO[indicator]?.[sexKey(sex)] || []
  return zs.map((z) => ({ z, points: t.map((r) => [r[0], valueAtZ(r.slice(1), z)]) }))
}
