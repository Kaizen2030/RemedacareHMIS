import { describe, expect, it } from 'vitest'
import { getNutritionStatus, needsDietitianReview } from './nutrition'

describe('nutrition utils', () => {
  it('marks malnourished patients for nutrition support', () => {
    expect(getNutritionStatus({ bmi: 17.1, appetite: 'poor' })).toBe('At risk')
  })

  it('escalates when weight loss is significant', () => {
    expect(needsDietitianReview({ weightLossPercent: 12, appetite: 'poor' })).toBe(true)
  })

  it('keeps stable patients out of urgent nutrition review', () => {
    expect(needsDietitianReview({ weightLossPercent: 4, appetite: 'good' })).toBe(false)
  })
})
