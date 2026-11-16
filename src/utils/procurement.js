export function needsReorder({ onHand = 0, reorderPoint = 0, avgDailyUsage = 0 }) {
  return Number(onHand || 0) <= Number(reorderPoint || 0) || Number(avgDailyUsage || 0) > 0 && Number(onHand || 0) <= Number(reorderPoint || 0) + Number(avgDailyUsage || 0)
}

export function canApprovePurchase({ requestAmount = 0, budgetLimit = 0, approverLevel = 'unit' }) {
  const amount = Number(requestAmount || 0)
  const limit = Number(budgetLimit || 0)

  if (approverLevel === 'department') {
    return amount <= limit * 1.25
  }

  return amount <= limit
}
