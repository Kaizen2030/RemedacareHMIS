const CHRONIC_CONDITIONS = [
  { label: 'Type 2 Diabetes', pattern: /\b(?:type\s*2\s+diabetes|diabetes|diabetic)\b/i },
  { label: 'Hypertension', pattern: /\b(?:hypertension|high blood pressure)\b/i },
  { label: 'Asthma', pattern: /\basthma\b/i },
  { label: 'HIV', pattern: /\bhiv\b/i },
  { label: 'Tuberculosis', pattern: /\b(?:tuberculosis|tb)\b/i },
  { label: 'Chronic Kidney Disease', pattern: /\b(?:chronic kidney disease|ckd|renal failure)\b/i },
  { label: 'COPD', pattern: /\b(?:copd|chronic obstructive pulmonary disease)\b/i },
  { label: 'Epilepsy', pattern: /\b(?:epilepsy|epileptic)\b/i },
  { label: 'Heart Failure', pattern: /\b(?:heart failure|cardiac failure)\b/i },
  { label: 'Sickle Cell Disease', pattern: /\bsickle cell(?: disease)?\b/i },
]

export function inferChronicConditionHint(...values) {
  for (const value of values) {
    const text = String(value || '')
    const match = CHRONIC_CONDITIONS.find(({ pattern }) => pattern.test(text))
    if (match) return match.label
  }

  return ''
}