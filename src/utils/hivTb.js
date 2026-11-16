export function isEligibleForArt({ hivPositive = false, baselineAssessed = false, activeTb = false }) {
  return Boolean(hivPositive && baselineAssessed && !activeTb)
}

export function getAdherenceRisk({ missedDoses = 0, adherenceScore = 100 }) {
  const missed = Number(missedDoses || 0)
  const score = Number(adherenceScore || 100)

  if (missed >= 3 || score < 70) return 'High'
  if (missed >= 1 || score < 85) return 'Medium'
  return 'Low'
}

// Mirrors of the database rules in 20261219000000_hiv_programme.sql (parity-tested against PGlite).

/** Kenya serial HTS algorithm. Returns 'negative' | 'positive' | 'inconclusive', or null when it cannot be recorded yet. */
export function htsFinalResult(test1, test2) {
  if (test1 === 'non_reactive' && !test2) return 'negative'
  if (test1 === 'reactive' && test2 === 'reactive') return 'positive'
  if (test1 === 'reactive' && test2 === 'non_reactive') return 'inconclusive'
  return null
}

/** TB symptom screen (cough, fever, weight loss, night sweats). null = partly answered. */
export function tbScreenResult({ cough = null, fever = null, weightLoss = null, nightSweats = null } = {}, onTreatment = false) {
  const answers = [cough, fever, weightLoss, nightSweats]
  if (onTreatment) return 'on_tb_treatment'
  if (answers.some((a) => a === true)) return 'presumptive'
  if (answers.every((a) => a === false)) return 'no_signs'
  if (answers.every((a) => a === null || a === undefined)) return 'not_screened'
  return null
}

/** Days past a missed ART appointment -> 'missed' (1–7), 'defaulter' (8–30), 'iit' (> 30). */
export function defaulterBand(days) {
  if (days == null || days < 1) return null
  if (days <= 7) return 'missed'
  if (days <= 30) return 'defaulter'
  return 'iit'
}
