// Payment method catalogue + client-side validation. The database re-validates everything:
// this exists to give cashiers instant, friendly errors — never as the only check.
import { isValidMpesaCode, normalizeKenyanPhone, normalizeMpesaCode } from './phone'
import { parseAmountInput, toMinor, sumAmounts } from './money'

export const ONLINE_METHODS = ['mpesa', 'card_online']

export const PAYMENT_METHODS = {
  cash:          { id: 'cash',          label: 'Cash',                         icon: '💵', kind: 'manual', hint: 'Enter cash received; change is calculated.' },
  mpesa:         { id: 'mpesa',         label: 'M-Pesa (STK Push)',            icon: '📲', kind: 'online', hint: 'A prompt is sent to the patient’s phone.', wholeShillings: true },
  mpesa_manual:  { id: 'mpesa_manual',  label: 'M-Pesa (code from till/paybill)', icon: '🧾', kind: 'manual', hint: 'Use when the patient already paid and shows an SMS.' },
  airtel_money:  { id: 'airtel_money',  label: 'Airtel Money (reference)',     icon: '📱', kind: 'manual', hint: 'Record the Airtel Money transaction ID.' },
  card_online:   { id: 'card_online',   label: 'Card / Online checkout',       icon: '💳', kind: 'online', hint: 'Secure hosted page: Visa, Mastercard, bank & mobile money.' },
  card_pos:      { id: 'card_pos',      label: 'Card (POS terminal)',          icon: '🏧', kind: 'manual', hint: 'Swipe on the bank POS, then record the approval code.' },
  bank_transfer: { id: 'bank_transfer', label: 'Bank transfer / RTGS / PesaLink', icon: '🏦', kind: 'manual', hint: 'Record the bank reference after funds are confirmed.' },
  cheque:        { id: 'cheque',        label: 'Cheque',                       icon: '📄', kind: 'manual', hint: 'Stays pending until finance marks it cleared.' },
  other:         { id: 'other',         label: 'Other',                        icon: '➕', kind: 'manual', hint: 'Anything else — add a note.' },
}

export const METHOD_LABELS = Object.fromEntries(Object.values(PAYMENT_METHODS).map((m) => [m.id, m.label]))
export const DEFAULT_ENABLED = ['cash', 'mpesa_manual', 'card_pos', 'bank_transfer', 'cheque']

export const CARD_BRANDS = ['Visa', 'Mastercard', 'Amex', 'Other']
export const KENYAN_BANKS = [
  'KCB', 'Equity', 'Co-operative Bank', 'NCBA', 'Stanbic', 'Absa Kenya', 'Standard Chartered',
  'I&M', 'DTB', 'Family Bank', 'Sidian', 'Housing Finance', 'National Bank', 'Other',
]

export function availableMethods(enabled = DEFAULT_ENABLED) {
  const set = new Set(enabled && enabled.length ? enabled : DEFAULT_ENABLED)
  return Object.values(PAYMENT_METHODS).filter((m) => set.has(m.id))
}

/** First error message for a single tender line, or null when valid. */
export function validateLine(line) {
  const m = PAYMENT_METHODS[line?.method]
  if (!m) return 'Choose a payment method'
  const amount = parseAmountInput(line.amount)
  if (!(amount > 0)) return `${m.label}: enter an amount greater than zero`
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return `${m.label}: amount can have at most 2 decimals`

  switch (m.id) {
    case 'cash': {
      if (line.tendered !== undefined && line.tendered !== '') {
        const t = parseAmountInput(line.tendered)
        if (!(t >= amount)) return 'Cash received is less than the amount due'
      }
      return null
    }
    case 'mpesa':
      if (!Number.isInteger(amount)) return 'M-Pesa STK Push works in whole shillings — adjust the amount or pay the remainder in cash'
      if (!normalizeKenyanPhone(line.phone)) return 'Enter a valid Safaricom number (e.g. 0712 345 678)'
      return null
    case 'mpesa_manual':
      return isValidMpesaCode(line.reference) ? null : 'M-Pesa code must be 10 letters/digits (e.g. SGH7K2L9QX)'
    case 'airtel_money':
    case 'bank_transfer':
      return String(line.reference || '').trim().length >= 4 ? null : `${m.label}: enter the transaction reference`
    case 'card_pos':
      if (String(line.reference || '').trim().length < 4) return 'Enter the POS approval / RRN code'
      if (!/^\d{4}$/.test(String(line.card_last4 || ''))) return 'Enter the last 4 digits of the card'
      return null
    case 'cheque':
      return String(line.cheque_no || '').trim() ? null : 'Enter the cheque number'
    case 'card_online': {
      const email = String(line.email || '').trim()
      return !email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? null : 'Enter a valid email address'
    }
    default:
      return null
  }
}

/** Validate a whole split. Returns an array of error strings (empty = OK). */
export function validateTenders(lines, openAmountKes, { allowPartial = true } = {}) {
  const errors = []
  if (!lines?.length) return ['Add at least one payment line']
  lines.forEach((l, i) => {
    const e = validateLine(l)
    if (e) errors.push(lines.length > 1 ? `Line ${i + 1} — ${e}` : e)
  })
  const total = sumAmounts(lines)
  if (toMinor(total) > toMinor(openAmountKes)) errors.push('Total is more than the open balance')
  if (!allowPartial && toMinor(total) < toMinor(openAmountKes)) errors.push('Partial payments are disabled — collect the full balance')
  // the same M-Pesa code twice in one split
  const codes = lines.filter((l) => l.method === 'mpesa_manual').map((l) => normalizeMpesaCode(l.reference))
  if (new Set(codes).size !== codes.length) errors.push('The same M-Pesa code is used twice')
  return errors
}

/** Shape accepted by the record_manual_payments RPC. */
export function toRpcLines(lines) {
  return lines.map((l) => ({
    method: l.method,
    amount: parseAmountInput(l.amount),
    tendered: l.method === 'cash' && l.tendered !== '' && l.tendered != null ? parseAmountInput(l.tendered) : null,
    reference: l.method === 'mpesa_manual' ? normalizeMpesaCode(l.reference) : (l.reference || '').trim() || null,
    bank_name: l.bank_name || null,
    cheque_no: l.cheque_no || null,
    card_brand: l.card_brand || null,
    card_last4: l.card_last4 || null,
    terminal_id: l.terminal_id || null,
    payer_name: l.payer_name || null,
    payer_phone: normalizeKenyanPhone(l.phone) || null,
    notes: l.notes || null,
  }))
}

export const STATUS_STYLE = {
  completed: { label: 'Completed', tone: 'green' },
  pending:   { label: 'Pending',   tone: 'yellow' },
  failed:    { label: 'Failed',    tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
  expired:   { label: 'Expired',   tone: 'gray' },
  reversed:  { label: 'Reversed',  tone: 'red' },
}
