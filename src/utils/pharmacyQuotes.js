// Pay-before-dispense for self-paying pharmacy patients.
//
//   1. Pharmacist prices the approved prescriptions → a pharmacy bill ("quote") goes to the cashier.
//      Nothing leaves the shelf and stock is not touched.
//   2. Patient pays at the cashier (Billing → Waiting to pay).
//   3. Pharmacy sees "Paid" and releases exactly what was paid for.
//
// A quote is an ordinary invoice whose workflow note is WF|Pharmacy|QUOTE-…; each service line carries
// the prescription_id it covers. Cancelling the invoice in Billing cancels the quote.
import { parseWorkflowInvoiceNote, SERVICE_SOURCES } from './workflowBilling'

export const QUOTE_PREFIX = 'QUOTE-'
export const QUOTE_NOTE_PATTERN = `WF|${SERVICE_SOURCES.PHARMACY}|${QUOTE_PREFIX}%`

const money = (v) => Math.round((Number(v) || 0) * 100)

export function isPharmacyQuote(invoice) {
  const note = parseWorkflowInvoiceNote(invoice?.notes)
  return note?.source === SERVICE_SOURCES.PHARMACY && String(note.sourceId || '').startsWith(QUOTE_PREFIX)
}

export function quoteRxIds(invoice) {
  let lines = []
  try { lines = typeof invoice?.services === 'string' ? JSON.parse(invoice.services || '[]') : (invoice?.services || []) } catch (_) { lines = [] }
  return [...new Set((Array.isArray(lines) ? lines : [])
    .map(line => line?.prescription_id ?? line?.source_id)
    .filter(id => id !== null && id !== undefined && id !== '')
    .map(String))]
}

/** 'paid' | 'unpaid' | 'partial' | 'cancelled' */
export function quoteState(invoice) {
  if (!invoice) return null
  if (invoice.status === 'Cancelled') return 'cancelled'
  if (invoice.status === 'Paid' || (money(invoice.amount_kes) > 0 && money(invoice.balance_kes) <= 0)) return 'paid'
  return money(invoice.paid_kes) > 0 ? 'partial' : 'unpaid'
}

/** prescription id → newest live (not cancelled) quote that covers it. */
export function buildQuoteMap(invoices = []) {
  const map = {}
  const sorted = [...invoices].filter(isPharmacyQuote).filter(inv => inv.status !== 'Cancelled')
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
  for (const inv of sorted) for (const id of quoteRxIds(inv)) if (!map[id]) map[id] = inv
  return map
}

/** The single live quote covering these prescriptions, or { conflict } if they are split over several. */
export function findQuoteFor(quoteMap, rxIds = []) {
  const found = [...new Set(rxIds.map(id => quoteMap[String(id)]).filter(Boolean))]
  if (found.length === 0) return { quote: null }
  if (found.length > 1) return { quote: null, conflict: found }
  return { quote: found[0] }
}

/** A paid quote may only be dispensed exactly as paid: same prescriptions, same total. */
export function checkPaidQuoteMatches(quote, rxIds = [], amount = 0) {
  const paidIds = quoteRxIds(quote).sort()
  const cartIds = [...new Set(rxIds.map(String))].sort()
  if (paidIds.join(',') !== cartIds.join(',')) {
    return { ok: false, reason: `The patient paid for ${paidIds.length} item(s) on bill ${quote.invoice_no || ''}, but the cart has ${cartIds.length}. Dispense exactly what was paid.` }
  }
  if (money(amount) !== money(quote.amount_kes)) {
    return { ok: false, reason: `The cart total (KES ${(money(amount) / 100).toLocaleString('en-KE')}) is different from what was paid (KES ${(money(quote.amount_kes) / 100).toLocaleString('en-KE')}). Use the same quantities, or ask the cashier to cancel the bill and send a new one.` }
  }
  return { ok: true }
}
