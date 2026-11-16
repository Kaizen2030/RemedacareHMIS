// Renal function and TDM helpers. Mirrors egfr_ckd_epi_2021, crcl_cockcroft_gault and tdm_classify in
// supabase/migrations/20261222000000_critical_results.sql (parity-tested). The system never calculates doses.

/** eGFR, CKD-EPI 2021 (race-free). Creatinine in µmol/L; adults only. */
export function egfrCkdEpi2021(creatinineUmol, age, female) {
  if (!(creatinineUmol > 0) || age == null || age < 18) return null
  const scr = creatinineUmol / 88.4
  const k = female ? 0.7 : 0.9
  const a = female ? -0.241 : -0.302
  const v = 142 * Math.min(scr / k, 1) ** a * Math.max(scr / k, 1) ** -1.2 * 0.9938 ** age * (female ? 1.012 : 1)
  return Math.round(v)
}

/** Creatinine clearance (Cockcroft–Gault), mL/min. Creatinine in µmol/L, weight in kg. */
export function crclCockcroftGault(creatinineUmol, age, female, weightKg) {
  if (!(creatinineUmol > 0) || age == null || weightKg == null) return null
  return Math.round(((140 - age) * weightKg * (female ? 0.85 : 1)) / (72 * (creatinineUmol / 88.4)))
}

/** 'subtherapeutic' | 'therapeutic' | 'supratherapeutic' | 'toxic' for a value in the target unit. */
export function tdmClassify(value, low, high, highExclusive = false, critical = null) {
  if (value == null) return null
  if (critical != null && (value > critical || (highExclusive && value >= critical))) return 'toxic'
  if (high != null && (value > high || (highExclusive && value >= high))) return 'supratherapeutic'
  if (low != null && value < low) return 'subtherapeutic'
  return 'therapeutic'
}

const SAME = { 'µg/L': ['ng/ml', 'ug/l', 'mcg/l', 'µg/l'], 'mg/L': ['mcg/ml', 'ug/ml', 'µg/ml', 'mg/l'], 'mmol/L': ['meq/l', 'mmol/l'] }

/** Convert an entered value to the target's unit (null when the unit is not recognised). */
export function toTargetUnit(value, unit, target) {
  if (value == null || !target) return null
  const u = String(unit || '').toLowerCase()
  if (u === String(target.unit).toLowerCase() || (SAME[target.unit] || []).includes(u)) return Number(value)
  if (target.si_unit && u === String(target.si_unit).toLowerCase()) return Math.round(Number(value) * Number(target.si_factor) * 100) / 100
  return null
}

export const TDM_TONE = { subtherapeutic: 'yellow', therapeutic: 'green', supratherapeutic: 'red', toxic: 'red', no_target: 'gray' }
