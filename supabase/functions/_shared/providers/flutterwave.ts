// Flutterwave v3: hosted checkout (cards, M-Pesa, Airtel, bank) + direct M-Pesa STK charge.
// Credentials: secret_key (FLWSECK-…), webhook_hash (the "secret hash" set on the dashboard)
import type { Credentials, InitiateContext, InitiateResult, PaymentRow, Provider, VerifyResult } from '../types.ts'
import { fetchJson, need } from './http.ts'
import { normalizeKenyanPhone } from '../phone.ts'

const API = 'https://api.flutterwave.com/v3'
const headers = (c: Credentials) => ({ Authorization: `Bearer ${c.secret_key}`, 'Content-Type': 'application/json' })

export const flutterwave: Provider = {
  async initiate(ctx: InitiateContext): Promise<InitiateResult> {
    const c = ctx.creds
    need(c, 'secret_key')
    const p = ctx.payment
    const phone = normalizeKenyanPhone(p.payer_phone)
    const customer = { email: ctx.email, name: p.payer_name || 'Patient', phonenumber: phone ? '+' + phone : undefined }

    if (p.method === 'mpesa') {
      if (!phone) throw new Error('Enter a valid Safaricom number (e.g. 0712 345 678)')
      const r = await fetchJson(`${API}/charges?type=mpesa`, {
        method: 'POST', headers: headers(c),
        body: JSON.stringify({
          tx_ref: p.id, amount: Number(p.amount), currency: 'KES',
          email: ctx.email, phone_number: phone, fullname: customer.name,
          meta: { payment_id: p.id, hospital_id: p.hospital_id },
        }),
      })
      if (!r.ok || r.body?.status !== 'success') throw new Error(r.body?.message || 'Flutterwave rejected the request')
      return { providerReference: p.id, action: { type: 'stk_push', message: 'Prompt sent. Ask the patient to enter their M-Pesa PIN.' } }
    }

    const r = await fetchJson(`${API}/payments`, {
      method: 'POST', headers: headers(c),
      body: JSON.stringify({
        tx_ref: p.id, amount: Number(p.amount), currency: 'KES', redirect_url: ctx.returnUrl,
        payment_options: 'card,mpesa,account,banktransfer,mobilemoneykenya',
        customer, customizations: { title: 'Hospital bill', description: ctx.description },
        meta: { payment_id: p.id, hospital_id: p.hospital_id, invoice_id: p.invoice_id },
      }),
    })
    if (!r.ok || !r.body?.data?.link) throw new Error(r.body?.message || 'Flutterwave rejected the request')
    return { providerReference: p.id, action: { type: 'redirect', url: r.body.data.link, message: 'Open the secure checkout to complete payment.' } }
  },

  async verify(c: Credentials, payment: PaymentRow): Promise<VerifyResult> {
    need(c, 'secret_key')
    const r = await fetchJson(
      `${API}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(payment.provider_reference || payment.id)}`,
      { headers: headers(c) })
    if (!r.ok || !r.body?.data) return { status: 'pending' } // not found yet
    const d = r.body.data
    if (d.status === 'successful') {
      const t = String(d.payment_type || '')
      return {
        status: 'completed', amount: Number(d.amount), currency: d.currency,
        receipt: d.flw_ref || undefined, fee: d.app_fee != null ? Number(d.app_fee) : undefined,
        channelMethod: t === 'mpesa' ? 'mpesa' : t === 'card' ? 'card_online' : t.startsWith('bank') || t === 'account' ? 'bank_transfer' : undefined,
        cardBrand: d.card?.type, cardLast4: d.card?.last_4digits,
        extra: { flw_id: d.id, payment_type: d.payment_type, created_at: d.created_at, processor_response: d.processor_response },
      }
    }
    if (d.status === 'failed' || d.status === 'cancelled') {
      return { status: 'failed', failureReason: d.processor_response || d.status }
    }
    return { status: 'pending' }
  },

  async refund(c: Credentials, payment: PaymentRow, amount: number, _reason: string) {
    need(c, 'secret_key')
    const flwId = (payment.provider_payload as any)?.flw_id
    if (!flwId) throw new Error('Flutterwave transaction id missing — issue a manual refund')
    const r = await fetchJson(`${API}/transactions/${flwId}/refund`, {
      method: 'POST', headers: headers(c), body: JSON.stringify({ amount }),
    })
    if (!r.ok || r.body?.status !== 'success') throw new Error(r.body?.message || 'Flutterwave refused the refund')
    return { providerReference: String(r.body?.data?.id ?? flwId) }
  },
}
