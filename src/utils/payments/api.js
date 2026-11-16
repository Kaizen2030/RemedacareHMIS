// Browser → Supabase payments API. All money-changing work happens server-side
// (RPCs + edge functions); this file only calls them and normalises errors.
import supabase from '../../supabase'
import { toRpcLines } from './methods'

export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** Pull a human message out of supabase-js / edge-function errors. */
export async function errorMessage(error, fallback = 'Something went wrong') {
  if (!error) return fallback
  try {
    if (error.context && typeof error.context.json === 'function') {
      const body = await error.context.json()
      if (body?.message) return body.message
    }
  } catch { /* ignore */ }
  const msg = error.message || fallback
  if (/row-level security|permission denied/i.test(msg)) {
    return 'Your account is not allowed to do this. Payment settings and refunds need an administrator or finance role.'
  }
  return msg.replace(/^.*?exception:?\s*/i, '') // strip "ERROR: ..." Postgres noise
}

export async function getPaymentSettings(hospitalId) {
  const { data } = await supabase.from('hospital_payment_settings').select('*').eq('hospital_id', hospitalId).maybeSingle()
  return data || null
}

export async function listInvoicePayments(invoiceId) {
  const { data, error } = await supabase.from('payments').select('*').eq('invoice_id', invoiceId).order('created_at', { ascending: false })
  if (error) throw new Error(await errorMessage(error))
  return data || []
}

export async function recordManualPayments({ invoiceId, lines, idempotencyKey }) {
  const { data, error } = await supabase.rpc('record_manual_payments', {
    p_invoice_id: invoiceId,
    p_lines: toRpcLines(lines),
    p_idempotency_key: idempotencyKey || newIdempotencyKey(),
  })
  if (error) throw new Error(await errorMessage(error))
  return data || []
}

export async function startOnlinePayment({ invoiceId, method, amount, phone, email, payerName, idempotencyKey }) {
  const { data, error } = await supabase.functions.invoke('payments-initiate', {
    body: {
      invoiceId, method, amount, phone, email, payerName,
      idempotencyKey: idempotencyKey || newIdempotencyKey(),
      returnUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  })
  if (error) throw new Error(await errorMessage(error, 'Could not start the payment'))
  if (!data?.success) throw new Error(data?.message || 'Could not start the payment')
  return data // { payment, action }
}

export async function fetchPaymentStatus(paymentId) {
  const { data, error } = await supabase.functions.invoke('payments-status', { body: { paymentId } })
  if (error) throw new Error(await errorMessage(error))
  return data?.payment
}

/**
 * Poll until the payment leaves 'pending' (or timeout / abort). Calls onUpdate for each poll.
 * Resolves with the last known payment row.
 */
export async function pollUntilSettled(paymentId, { intervalMs = 3000, timeoutMs = 120000, onUpdate, signal } = {}) {
  const started = Date.now()
  let last = null
  while (!signal?.aborted && Date.now() - started < timeoutMs) {
    try {
      last = await fetchPaymentStatus(paymentId)
      onUpdate?.(last)
      if (last && last.status !== 'pending') return last
    } catch { /* transient — keep polling */ }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return last
}

export async function cancelPendingPayment(paymentId, reason) {
  const { data, error } = await supabase.rpc('cancel_pending_payment', { p_payment_id: paymentId, p_reason: reason || null })
  if (error) throw new Error(await errorMessage(error))
  return data
}

export async function resolvePendingPayment(paymentId, outcome, note) {
  const { data, error } = await supabase.rpc('resolve_pending_payment', { p_payment_id: paymentId, p_outcome: outcome, p_note: note || null })
  if (error) throw new Error(await errorMessage(error))
  return data
}

/** Gateway-backed refund for Paystack/Flutterwave card & online payments; manual RPC for the rest. */
export async function refundPayment({ payment, amount, reason, reference }) {
  const viaGateway = ['paystack', 'flutterwave'].includes(payment.provider)
  if (viaGateway) {
    const { data, error } = await supabase.functions.invoke('payments-refund', {
      body: { paymentId: payment.id, amount, reason },
    })
    if (error) throw new Error(await errorMessage(error))
    if (!data?.success) throw new Error(data?.message || 'Refund failed')
    return data.refund
  }
  const { data, error } = await supabase.rpc('record_manual_refund', {
    p_payment_id: payment.id, p_amount: amount, p_reason: reason, p_reference: reference || null,
  })
  if (error) throw new Error(await errorMessage(error))
  return data
}

export async function fetchDailySummary(hospitalId, fromDay, toDay) {
  const { data, error } = await supabase.from('payment_daily_summary').select('*')
    .eq('hospital_id', hospitalId).gte('day', fromDay).lte('day', toDay).order('day', { ascending: false })
  if (error) throw new Error(await errorMessage(error))
  return data || []
}
