// Helpers for screens that create invoices (lab, pharmacy, consultation, registration, appointments)
// and for screens that receive money outside the payment window (Credit).
//
// Rule: an invoice is created UNPAID. Money only becomes "paid" when a row is written to the payments
// ledger (payment window or record_manual_payments). Never set paid_kes on an invoice from a screen.
import supabase from '../../supabase'
import { newIdempotencyKey, recordManualPayments } from './api'
import { isValidMpesaCode, normalizeMpesaCode } from './phone'
import { roundMoney } from './money'

const SELF_PAY = new Set(['cash', 'm-pesa', 'mpesa', 'm pesa', 'card', 'self pay', 'self-pay', 'split', 'split payment'])

/** True when the patient pays the hospital directly (not SHA, an insurer, a company or credit). */
export function isSelfPayMethod(method) {
  const m = String(method || 'Cash').trim().toLowerCase()
  if (SELF_PAY.has(m)) return true
  return /^(cash|m-?pesa)/.test(m)
}

/** Fields every new invoice should use instead of guessing what was paid. */
export function unpaidInvoiceFields(amount) {
  const total = roundMoney(Math.max(0, Number(amount) || 0))
  return { amount_kes: total, paid_kes: 0, balance_kes: total, status: 'Pending', paid_at: null }
}

export async function fetchInvoice(id) {
  if (!id) return null
  const { data } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle()
  return data || null
}

/**
 * Map an old screen's free-text method ('Cash', 'M-Pesa', 'Bank', 'Cheque'…) to a ledger method.
 * Returns { method, reference, note } that the record_manual_payments RPC will accept. Anything that
 * can't be recorded exactly (e.g. M-Pesa with no valid code) becomes 'other' with an explanatory note,
 * so the money is still on a receipt and visible in cash-up.
 */
export function ledgerTenderFromLegacy(label, reference) {
  const m = String(label || '').trim().toLowerCase()
  const ref = String(reference || '').trim()
  const fallback = (why) => ({ method: 'other', reference: null, note: `${label || 'Unspecified'}${ref ? ` ref ${ref}` : ''}${why ? ` (${why})` : ''}` })
  if (!m || /^cash/.test(m)) return { method: 'cash', reference: null, note: null }
  if (/m-?\s?pesa/.test(m)) {
    const code = normalizeMpesaCode(ref)
    return isValidMpesaCode(code) ? { method: 'mpesa_manual', reference: code, note: null } : fallback('no valid M-Pesa code')
  }
  if (/airtel/.test(m)) return ref ? { method: 'airtel_money', reference: ref, note: null } : fallback('no reference')
  if (/cheque|check/.test(m)) return ref ? { method: 'cheque', reference: ref, note: null } : fallback('no cheque number')
  if (/bank|rtgs|eft|pesalink|transfer/.test(m)) return ref.length >= 1 ? { method: 'bank_transfer', reference: ref, note: null } : fallback('no bank reference')
  return fallback(null)
}

/** Hint for the payment window, from what a registration/lab form already captured. */
export function paymentHintFromLegacy(label, reference) {
  const m = String(label || '').toLowerCase()
  if (/m-?\s?pesa/.test(m)) return { method: 'mpesa_manual', reference: normalizeMpesaCode(reference || '') }
  if (/cash/.test(m)) return { method: 'cash' }
  return null
}

/**
 * Find the invoice a credit/debt record belongs to. Only exact links are used — a debt that cannot be
 * tied to an invoice is NOT applied to some other open invoice of the patient.
 */
export async function findInvoiceForDebt(hospitalId, record = {}) {
  const base = () => supabase.from('invoices').select('*').eq('hospital_id', hospitalId)
  if (record.invoice_id) {
    const { data } = await base().eq('id', record.invoice_id).maybeSingle()
    if (data) return data
  }
  const desc = String(record.description || '')
  const invNo = desc.match(/\bINV-[A-Z0-9-]+/i)?.[0]
  if (invNo) {
    const { data } = await base().eq('invoice_no', invNo).limit(1)
    if (data?.[0]) return data[0]
  }
  const rxNo = desc.match(/\b(RX|LAB)-[0-9]+/i)?.[0]
  if (rxNo) {
    const { data } = await base().ilike('notes', `%${rxNo}%`).limit(1)
    if (data?.[0]) return data[0]
  }
  if (record.visit_id) {
    const { data } = await base().eq('visit_id', record.visit_id).in('status', ['Pending', 'Partial'])
      .order('created_at', { ascending: true })
    const open = (data || []).filter((i) => Number(i.balance_kes || 0) > 0)
    if (open.length === 1) return open[0]
    const exact = open.find((i) => roundMoney(i.amount_kes) === roundMoney(record.amount_charged))
    if (exact) return exact
  }
  return null
}

/**
 * Record money received outside the payment window (e.g. on the Credit screen) in the ledger.
 * Returns { ok, invoice, receipts, error }. Never throws.
 */
export async function recordLegacyPayment({ hospitalId, record, amount, method, reference, idempotencyKey }) {
  try {
    const invoice = await findInvoiceForDebt(hospitalId, record)
    if (!invoice) return { ok: false, error: 'No matching invoice was found, so this payment is only in the Credit book.' }
    const open = roundMoney(Number(invoice.balance_kes ?? (Number(invoice.amount_kes || 0) - Number(invoice.paid_kes || 0))))
    const amt = roundMoney(Math.min(Number(amount) || 0, open))
    if (!(amt > 0)) return { ok: true, invoice, receipts: [], skipped: 'invoice already settled' }
    const tender = ledgerTenderFromLegacy(method, reference)
    const receipts = await recordManualPayments({
      invoiceId: invoice.id,
      idempotencyKey: (idempotencyKey || newIdempotencyKey()).slice(0, 120),
      lines: [{
        method: tender.method, amount: amt, reference: tender.reference || '',
        cheque_no: tender.method === 'cheque' ? tender.reference : '',
        notes: ['Received on Credit screen', tender.note].filter(Boolean).join(' — '),
      }],
    })
    return { ok: true, invoice, receipts }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** Money is taken at the cashier only. Tell the user where the patient goes next. */
export function notifySentToCashier(invoice, what = 'Saved') {
  if (!invoice) return
  const amount = Number(invoice.balance_kes ?? invoice.amount_kes ?? 0)
  const msg = `${what}. Send the patient to the CASHIER to pay KES ${amount.toLocaleString('en-KE')} (bill ${invoice.invoice_no || ''}).`
  try { (window.notifyFromLegacyAlert || window.alert)(msg) } catch (_) {}
}
