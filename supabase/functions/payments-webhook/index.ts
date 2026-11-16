// Public endpoint (deploy with --no-verify-jwt). Handles gateway callbacks:
//   ?provider=daraja&p=<paymentId>&s=<hmac>      (Daraja has no signature → HMAC token in the URL)
//   ?provider=paystack                             (x-paystack-signature = HMAC-SHA512 of raw body)
//   ?provider=flutterwave                          (verif-hash header = your secret hash)
//   ?provider=pesapal&h=<hospitalId>               (IPN GET → we re-query GetTransactionStatus)
// Every result is confirmed with the gateway (or HMAC-verified) before money is recorded.
import { corsHeaders } from '../_shared/cors.ts'
import { admin, applyResult, loadCredentials, logEvent } from '../_shared/db.ts'
import { hmacHex, timingSafeEqual, verifyPaymentToken } from '../_shared/crypto.ts'
import { getProvider } from '../_shared/providers/index.ts'
import { friendlyResult, parseStkCallback } from '../_shared/providers/daraja.ts'
import type { PaymentRow } from '../_shared/types.ts'

const ok = () => new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
  status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const reject = (status = 401) => new Response(JSON.stringify({ ResultCode: 1, ResultDesc: 'Rejected' }), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

async function getPayment(db: ReturnType<typeof admin>, col: 'id' | 'provider_reference', val: string) {
  const { data } = await db.from('payments').select('*').eq(col, val).eq('kind', 'payment').maybeSingle()
  return (data as PaymentRow) || null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const url = new URL(req.url)
  const provider = url.searchParams.get('provider') || ''
  const db = admin()
  const raw = req.method === 'POST' ? await req.text() : ''
  let body: any = null
  try { body = raw ? JSON.parse(raw) : null } catch { /* GET / non-JSON */ }

  try {
    // ---------------- Daraja ----------------
    if (provider === 'daraja') {
      const paymentId = url.searchParams.get('p') || ''
      if (!(await verifyPaymentToken(paymentId, url.searchParams.get('s') || ''))) return reject()
      const cb = parseStkCallback(body)
      if (!cb) return reject(400)
      const payment = await getPayment(db, 'id', paymentId)
      if (!payment || payment.provider_reference !== cb.checkoutRequestId) return reject(404)
      const fresh = await logEvent(db, { hospital_id: payment.hospital_id, payment_id: payment.id, provider, event_id: cb.checkoutRequestId, verified: true, payload: body })
      if (!fresh) return ok() // duplicate callback
      if (cb.resultCode === '0') {
        await applyResult(db, payment, { status: 'completed', amount: cb.amount, currency: 'KES', receipt: cb.receipt })
      } else {
        await applyResult(db, payment, { status: 'failed', failureReason: friendlyResult(cb.resultCode, cb.resultDesc) })
      }
      return ok()
    }

    // ---------------- Paystack ----------------
    if (provider === 'paystack') {
      const ref = body?.data?.reference
      const payment = ref ? await getPayment(db, 'id', String(ref)) : null
      if (!payment) return ok() // not ours / unknown: ack so the gateway stops retrying
      const creds = await loadCredentials(db, payment.hospital_id, 'paystack')
      const sig = req.headers.get('x-paystack-signature') || ''
      if (!timingSafeEqual(await hmacHex('SHA-512', creds.secret_key, raw), sig)) return reject()
      const fresh = await logEvent(db, { hospital_id: payment.hospital_id, payment_id: payment.id, provider, event_id: `${body.event}:${body.data?.id ?? ref}`, verified: true, payload: { event: body.event, reference: ref } })
      if (!fresh) return ok()
      if (['charge.success', 'charge.failed'].includes(body.event)) {
        await applyResult(db, payment, await getProvider('paystack').verify(creds, payment)) // re-verify with API
      }
      return ok()
    }

    // ---------------- Flutterwave ----------------
    if (provider === 'flutterwave') {
      const ref = body?.data?.tx_ref || body?.txRef
      const payment = ref ? await getPayment(db, 'id', String(ref)) : null
      if (!payment) return ok()
      const creds = await loadCredentials(db, payment.hospital_id, 'flutterwave')
      if (!creds.webhook_hash || !timingSafeEqual(creds.webhook_hash, req.headers.get('verif-hash') || '')) return reject()
      const fresh = await logEvent(db, { hospital_id: payment.hospital_id, payment_id: payment.id, provider, event_id: `${body?.event}:${body?.data?.id ?? ref}`, verified: true, payload: { event: body?.event, tx_ref: ref } })
      if (!fresh) return ok()
      await applyResult(db, payment, await getProvider('flutterwave').verify(creds, payment))
      return ok()
    }

    // ---------------- Pesapal (IPN) ----------------
    if (provider === 'pesapal') {
      const tracking = url.searchParams.get('OrderTrackingId') || ''
      const merchantRef = url.searchParams.get('OrderMerchantReference') || ''
      const payment = (tracking && await getPayment(db, 'provider_reference', tracking)) || (merchantRef && await getPayment(db, 'id', merchantRef)) || null
      const echo = { orderNotificationType: 'IPNCHANGE', orderTrackingId: tracking, orderMerchantReference: merchantRef, status: 200 }
      if (!payment) return new Response(JSON.stringify(echo), { headers: { 'Content-Type': 'application/json' } })
      const creds = await loadCredentials(db, payment.hospital_id, 'pesapal')
      await logEvent(db, { hospital_id: payment.hospital_id, payment_id: payment.id, provider, event_id: null, verified: true, payload: { tracking, merchantRef } })
      await applyResult(db, payment, await getProvider('pesapal').verify(creds, payment)) // authoritative status call
      return new Response(JSON.stringify(echo), { headers: { 'Content-Type': 'application/json' } })
    }

    return reject(400)
  } catch (e) {
    console.error('webhook error', provider, (e as Error).message)
    await logEvent(db, { provider: provider || 'unknown', verified: false, payload: { query: url.search }, error: (e as Error).message.slice(0, 300) })
    return new Response(JSON.stringify({ ResultCode: 1 }), { status: 500, headers: corsHeaders }) // gateway will retry
  }
})
