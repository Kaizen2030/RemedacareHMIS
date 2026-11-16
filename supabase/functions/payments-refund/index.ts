// POST { paymentId, amount, reason } — gateway-backed refunds (Paystack, Flutterwave).
// Everything else (cash, M-Pesa, bank, Pesapal, Daraja) is refunded outside the app and
// recorded with the record_manual_refund() RPC from the UI.
//
// Order matters: the refund is first RESERVED as a pending ledger row (create_gateway_refund,
// row-locked, so two refunds at once cannot exceed what was paid), THEN the gateway is called,
// THEN the row is completed or failed. A crash in between leaves a visible pending refund
// for finance to check — never money sent with no record.
import { corsHeaders, errorResponse, HttpError, json } from '../_shared/cors.ts'
import { admin, loadCredentials, requireRole, requireUser, rpcError } from '../_shared/db.ts'
import { getProvider } from '../_shared/providers/index.ts'
import type { PaymentRow } from '../_shared/types.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await requireUser(req)
    const b = await req.json().catch(() => null)
    const amount = Math.round(Number(b?.amount) * 100) / 100
    const reason = String(b?.reason || '').trim()
    if (!b?.paymentId || !(amount > 0)) throw new HttpError(400, 'paymentId and a positive amount are required')
    if (!reason) throw new HttpError(400, 'A refund reason is required')

    const db = admin()
    const { data } = await db.from('payments').select('*').eq('id', b.paymentId).maybeSingle()
    if (!data) throw new HttpError(404, 'Payment not found')
    const p = data as PaymentRow
    await requireRole(db, user.id, p.hospital_id, 'manage')
    const provider = getProvider(p.provider === ('manual' as string) ? 'paystack' : p.provider)
    if (p.provider === ('manual' as string) || !provider.refund) {
      throw new HttpError(400, 'This gateway has no refund API here — refund outside the app and record it as a manual refund')
    }

    const { data: reserved, error: reserveErr } = await db.rpc('create_gateway_refund', {
      p_payment_id: p.id, p_user: user.id, p_amount: amount, p_reason: reason,
    })
    if (reserveErr) throw rpcError(reserveErr, 'Could not reserve the refund')
    const pending = reserved as PaymentRow

    let providerRef: string
    try {
      const creds = await loadCredentials(db, p.hospital_id, p.provider)
      providerRef = (await provider.refund(creds, p, amount, reason)).providerReference
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300)
      await db.from('payments').update({ status: 'failed', failure_reason: msg }).eq('id', pending.id).eq('status', 'pending')
      throw new HttpError(502, `The gateway refused the refund: ${msg}`)
    }

    const { data: row, error } = await db.from('payments')
      .update({ status: 'completed', provider_reference: `refund:${providerRef}` })
      .eq('id', pending.id).eq('status', 'pending').select().maybeSingle()
    if (error || !row) {
      await db.from('payments').update({ needs_review: true, review_note: `Gateway accepted refund ${providerRef} but it could not be marked completed${error ? ': ' + error.message : ''}` }).eq('id', pending.id)
      throw new HttpError(500, `The gateway accepted the refund (ref ${providerRef}) but it could not be finalised — it is flagged for finance to review`)
    }
    return json({ success: true, refund: row })
  } catch (e) {
    return errorResponse(e)
  }
})
