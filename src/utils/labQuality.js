// Laboratory quality rules. The database applies them (lab_tests_quality in 20261216000000_lab_quality.sql, with the same
// defaults seeded into lab_analyte_rules); this file mirrors them for display, trends and worklists.

export const DEFAULT_LAB_RULES = [
  { template_key: 'fbc', analyte: 'haemoglobin', low: 11.5, high: 17.5, critical_low: 6, critical_high: 22, delta_abs: 2, delta_pct: null, delta_days: 7 },
  { template_key: 'fbc', analyte: 'wbc', low: 4, high: 11, critical_low: 1, critical_high: 50, delta_abs: null, delta_pct: 50, delta_days: 7 },
  { template_key: 'fbc', analyte: 'platelets', low: 150, high: 400, critical_low: 20, critical_high: 1000, delta_abs: null, delta_pct: 50, delta_days: 7 },
  { template_key: 'rfts', analyte: 'urea', low: 2.5, high: 7.8, critical_low: null, critical_high: null, delta_abs: null, delta_pct: 50, delta_days: 7 },
  { template_key: 'rfts', analyte: 'creatinine', low: 45, high: 110, critical_low: null, critical_high: null, delta_abs: null, delta_pct: 50, delta_days: 7 },
  { template_key: 'rfts', analyte: 'sodium', low: 135, high: 145, critical_low: 120, critical_high: 160, delta_abs: 8, delta_pct: null, delta_days: 7 },
  { template_key: 'rfts', analyte: 'potassium', low: 3.5, high: 5.1, critical_low: 2.5, critical_high: 6.5, delta_abs: 1, delta_pct: null, delta_days: 7 },
  { template_key: 'rfts', analyte: 'chloride', low: 98, high: 107, critical_low: null, critical_high: null, delta_abs: 10, delta_pct: null, delta_days: 7 },
  { template_key: 'rfts', analyte: 'egfr', low: null, high: null, critical_low: null, critical_high: null, delta_abs: null, delta_pct: 25, delta_days: 7 },
  { template_key: 'lft', analyte: 'alt', low: 0, high: 56, critical_low: null, critical_high: null, delta_abs: null, delta_pct: 100, delta_days: 14 },
  { template_key: 'lft', analyte: 'ast', low: 0, high: 40, critical_low: null, critical_high: null, delta_abs: null, delta_pct: 100, delta_days: 14 },
  { template_key: 'lft', analyte: 'bilirubin', low: 5, high: 21, critical_low: null, critical_high: null, delta_abs: null, delta_pct: 50, delta_days: 14 },
  { template_key: 'lft', analyte: 'albumin', low: 35, high: 50, critical_low: null, critical_high: null, delta_abs: 8, delta_pct: null, delta_days: 14 },
]

export const TEMPLATE_LABELS = { fbc: 'Full blood count', rfts: 'Renal function', lft: 'Liver function' }
export const ANALYTE_LABELS = { haemoglobin: 'Haemoglobin', wbc: 'WBC', platelets: 'Platelets', urea: 'Urea', creatinine: 'Creatinine', sodium: 'Sodium', potassium: 'Potassium', chloride: 'Chloride', egfr: 'eGFR', alt: 'ALT', ast: 'AST', bilirubin: 'Bilirubin', albumin: 'Albumin' }

const num = (v) => (/^-?\d+(\.\d+)?$/.test(String(v ?? '').trim()) ? Number(String(v).trim()) : null)

/** Effective rules: a hospital row replaces the default for that analyte. */
export function effectiveRules(hospitalRules = [], template) {
  const own = new Map(hospitalRules.filter((r) => r.template_key === template).map((r) => [r.analyte, r]))
  return DEFAULT_LAB_RULES.filter((r) => r.template_key === template).map((r) => own.get(r.analyte) || r)
}

/** Same logic as the database: delta flags and whether the result could be auto-validated. */
export function assessResult(template, values = {}, previous = null, { rules = DEFAULT_LAB_RULES.filter((r) => r.template_key === template), now = new Date(), autoverify = false } = {}) {
  const flags = []
  let ok = true, any = false
  for (const r of rules) {
    const v = num(values[r.analyte])
    if (v === null) continue
    any = true
    if ((r.low !== null && v < r.low) || (r.high !== null && v > r.high)) ok = false
    if ((r.critical_low !== null && v <= r.critical_low) || (r.critical_high !== null && v >= r.critical_high)) ok = false
    const p = previous ? num(previous.values?.[r.analyte]) : null
    if (p !== null && new Date(previous.at) >= new Date(new Date(now).getTime() - r.delta_days * 86400000)
      && ((r.delta_abs !== null && Math.abs(v - p) >= r.delta_abs) || (r.delta_pct !== null && p !== 0 && (Math.abs(v - p) / Math.abs(p)) * 100 >= r.delta_pct))) {
      flags.push({ analyte: r.analyte, previous: p, current: v, change: Math.round((v - p) * 100) / 100 })
      ok = false
    }
  }
  return { delta_flags: flags, validation_status: autoverify && ok && any ? 'auto_validated' : 'needs_review' }
}

/** Points for a trend chart: [{ at, value }] for one analyte across a patient's results. */
export function trendSeries(tests = [], template, analyte) {
  return tests.filter((t) => t.result_template_key === template && t.result_json && num(t.result_json[analyte]) !== null)
    .map((t) => ({ at: t.results_ready_at || t.resulted_at || t.created_at, value: num(t.result_json[analyte]) }))
    .sort((a, b) => new Date(a.at) - new Date(b.at))
}

const PRIORITY_ORDER = { STAT: 0, Urgent: 1, Routine: 2 }
/** Worklist for a section: unfinished tests, most urgent and oldest first. */
export function sectionWorklist(tests = [], section) {
  return tests.filter((t) => (!section || t.category === section) && !(t.results_ready_at || t.resulted_at) && !/^(cancel|reject|referred)/i.test(t.status || ''))
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2) || new Date(a.created_at) - new Date(b.created_at))
}
