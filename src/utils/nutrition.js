export function getNutritionStatus({ bmi = 20, appetite = 'good' }) {
  const effectiveBmi = Number(bmi || 20)
  const normalizedAppetite = String(appetite || 'good').toLowerCase()

  if (effectiveBmi < 18.5 || normalizedAppetite === 'poor') return 'At risk'
  if (effectiveBmi < 20 || normalizedAppetite === 'fair') return 'Monitor'
  return 'Stable'
}

export function needsDietitianReview({ weightLossPercent = 0, appetite = 'good' }) {
  const weightLoss = Number(weightLossPercent || 0)
  const normalizedAppetite = String(appetite || 'good').toLowerCase()
  return weightLoss >= 10 || normalizedAppetite === 'poor' && weightLoss >= 5
}
