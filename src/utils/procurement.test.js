import { describe, expect, it } from 'vitest'
import { canApprovePurchase, needsReorder } from './procurement'

describe('procurement utils', () => {
  it('flags inventory items below reorder point', () => {
    expect(needsReorder({ onHand: 12, reorderPoint: 30, avgDailyUsage: 2 })).toBe(true)
  })

  it('blocks a purchase request above the finance threshold without approval', () => {
    expect(canApprovePurchase({ requestAmount: 820000, budgetLimit: 500000, approverLevel: 'unit' })).toBe(false)
  })

  it('allows approval when the request sits within the approved threshold', () => {
    expect(canApprovePurchase({ requestAmount: 180000, budgetLimit: 500000, approverLevel: 'unit' })).toBe(true)
  })
})
