// Money helpers. All arithmetic is done in integer cents to avoid float drift
// (0.1 + 0.2 !== 0.3 is how till-short-by-5-cents bugs are born).

export const toMinor = (value) => Math.round((Number(value) || 0) * 100)
export const fromMinor = (minor) => minor / 100
export const roundMoney = (value) => fromMinor(toMinor(value))

export function formatKES(value) {
  return `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

/** Parse what a cashier typed ("1,200.50", " 300 ") → number, or NaN. */
export function parseAmountInput(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN
  const cleaned = String(raw ?? '').replace(/[,\sKESksh]/gi, '')
  if (!cleaned || !/^\d*\.?\d+$/.test(cleaned)) return NaN
  return Number(cleaned)
}

export function sumAmounts(lines) {
  return fromMinor((lines || []).reduce((s, l) => s + toMinor(l?.amount), 0))
}

/** Change due for a cash line. tendered < amount → 0 (validation reports the error). */
export function changeDue(tendered, amount) {
  return fromMinor(Math.max(0, toMinor(tendered) - toMinor(amount)))
}

/**
 * Open balance of an invoice, given ledger rows. Pending payments reserve money so two
 * cashiers cannot both collect the same balance; only COMPLETED refunds give it back
 * (same rule as invoice_open_amount() in the database).
 */
export function openAmount(invoice, payments = []) {
  const total = toMinor(invoice?.amount_kes)
  const settled = (payments || [])
    .filter((p) => (p.kind === 'refund' ? p.status === 'completed' : ['completed', 'pending'].includes(p.status)))
    .reduce((s, p) => s + (p.kind === 'refund' ? -toMinor(p.amount) : toMinor(p.amount)), 0)
  return fromMinor(Math.max(0, total - settled))
}

/** Paid / balance / status after these ledger rows — what the database trigger will write. */
export function invoiceTotalsFromLedger(invoice, payments = []) {
  const total = toMinor(invoice?.amount_kes)
  const paid = Math.max(0, (payments || []).filter((p) => p.status === 'completed')
    .reduce((s, p) => s + (p.kind === 'refund' ? -toMinor(p.amount) : toMinor(p.amount)), 0))
  const keep = ['Cancelled', 'Approved'].includes(invoice?.status)
  const status = keep ? invoice.status : total > 0 && paid >= total ? 'Paid' : paid > 0 ? 'Partial' : 'Pending'
  return { ...invoice, paid_kes: fromMinor(paid), balance_kes: fromMinor(Math.max(0, total - paid)), status }
}

/** Remaining refundable amount on a completed payment. */
export function refundableAmount(payment, payments = []) {
  if (!payment || payment.kind !== 'payment' || payment.status !== 'completed') return 0
  const refunded = (payments || [])
    .filter((p) => p.kind === 'refund' && p.refund_of === payment.id && ['completed', 'pending'].includes(p.status))
    .reduce((s, p) => s + toMinor(p.amount), 0)
  return fromMinor(Math.max(0, toMinor(payment.amount) - refunded))
}

/** Calendar day (YYYY-MM-DD) in Kenya time, so "today" doesn't flip at 3 a.m. like UTC does. */
export const nairobiDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date(d))
/** Start of a Kenyan calendar day as an ISO timestamp, for database range filters. */
export const nairobiDayStart = (day) => `${day}T00:00:00+03:00`
