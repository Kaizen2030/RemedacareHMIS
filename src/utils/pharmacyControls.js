// Controlled-drug register and ward imprest rules (the database enforces them: 20261208000000_pharmacy_controls.sql).

export const CD_TYPES = {
  receipt: { label: 'Received from supplier', sign: 1, where: 'pharmacy' },
  issue_patient: { label: 'Issued to patient', sign: -1, where: 'pharmacy', patient: true, prescriber: true },
  issue_ward: { label: 'Issued to ward', sign: -1, where: 'pharmacy', counterpart: true },
  return_from_ward: { label: 'Returned from ward', sign: 1, where: 'pharmacy', auto: true },
  received_from_pharmacy: { label: 'Received from pharmacy', sign: 1, where: 'ward', auto: true },
  administered: { label: 'Given to patient', sign: -1, where: 'ward', patient: true },
  return_to_pharmacy: { label: 'Returned to pharmacy', sign: -1, where: 'ward' },
  destruction: { label: 'Destroyed / wasted', sign: -1, where: 'any', reason: true, pharmacistWitness: true },
  adjustment: { label: 'Adjustment (pharmacist)', sign: 0, where: 'any', reason: true, pharmacistWitness: true },
  balance_check: { label: 'Balance check (count)', sign: 0, where: 'any' },
}

export const isPharmacy = (location) => String(location || '').trim().toLowerCase() === 'pharmacy'

/** Entry types a user can record at this location (auto-posted ones excluded). */
export function cdTypesFor(location) {
  const ph = isPharmacy(location)
  return Object.entries(CD_TYPES).filter(([, t]) => !t.auto && (t.where === 'any' || (t.where === 'pharmacy') === ph)).map(([k]) => k)
}

/** What the database will do with the entry: new balance, or the problem that will stop it. */
export function cdPreview(balance, type, qty, extra = {}) {
  const t = CD_TYPES[type]
  const q = Number(qty)
  const bal = Number(balance) || 0
  if (!t) return { problem: 'Choose the entry type' }
  if (qty === '' || qty === null || qty === undefined || Number.isNaN(q)) return { problem: 'Enter the quantity' }
  if (type === 'balance_check') {
    const discrepancy = q - bal
    if (q < 0) return { problem: 'The count cannot be negative' }
    return { balance: bal, discrepancy, problem: discrepancy !== 0 && !String(extra.reason || '').trim() ? `The count differs from the register (${bal}): explain the discrepancy` : null }
  }
  if (type === 'adjustment' ? q === 0 : q <= 0) return { problem: 'Quantity must be more than zero' }
  if (t.patient && !extra.patient) return { problem: 'Name the patient' }
  if (t.prescriber && !String(extra.prescriber || '').trim()) return { problem: 'Record the prescriber' }
  if (t.counterpart && !String(extra.counterpart || '').trim()) return { problem: 'Name the ward' }
  if (t.reason && !String(extra.reason || '').trim()) return { problem: 'Give the reason' }
  const delta = type === 'adjustment' ? q : t.sign * q
  if (bal + delta < 0) return { problem: `Register balance is ${bal}: this would make it negative` }
  return { balance: bal + delta, problem: null }
}

/** Lines for a top-up: everything below par, requested up to par. */
export function topUpLines(stock = []) {
  return stock.filter((s) => s.active !== false && Number(s.quantity) < Number(s.par_level))
    .map((s) => ({ ward_stock_id: s.id, drug_name: s.drug_name, requested: Number(s.par_level) - Number(s.quantity) }))
}
