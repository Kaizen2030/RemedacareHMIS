export function needsIncidentReview({ sepsisRate = 0, fallRate = 0, medicationErrorRate = 0, threshold = 10 }) {
  return Number(sepsisRate || 0) > Number(threshold || 0) || Number(fallRate || 0) > Number(threshold || 0) || Number(medicationErrorRate || 0) > Number(threshold || 0)
}

export function canCloseSafetyEvent({ rootCauseIdentified = false, correctiveActionComplete = false, approved = false }) {
  return Boolean(rootCauseIdentified && correctiveActionComplete && approved)
}
