// Paystack (Kenya): cards, M-Pesa (direct STK via Charge API), bank — hosted checkout.
// Credentials: secret_key (sk_live_… / sk_test_…)
import type { Credentials, InitiateContext, InitiateResult, PaymentRow, Provider, VerifyResult } from '../types.ts'
import { fetchJson, need } from './http.ts'
import { normalizeKenyanPhone } from '../phone.ts'

const API = 'https://api.paystack.co'
const headers = (c: Credentials) => ({ Authorization: `Bearer ${c.secret_key}`, 'Content-Type': 'application/json' })
const minor = (amount: number | string) => Math.round(Number(amount) * 100)

export const paystack: Provider = {
  async initiate(ctx: InitiateContext): Promise<InitiateResult> {
    const c = ctx.creds
    need(c, 'secret_key')
    const p = ctx.payment

    if (p.method === 'mpesa') {
      const phone = normalizeKenyanPhone(p.payer_phone)
      if (!phone) throw new Error('Enter a valid Safaricom number (e.g. 0712 345 678)')
      const r = await fetchJson(`${API}/charge`, {
        method: 'POST', headers: headers(c),
        body: JSON.stringify({
          email: ctx.email, amount: minor(p.amount), currency: 'KES', reference: p.id,
          mobile_money: { phone: '+' + phone, provider: 'mpesa' },
          metadata: { payment_id: p.id, hospital_id: p.hospital_id, invoice_id: p.invoice_id },
        }),
      })
      if (!r.ok || r.body?.status !== true) throw new Error(r.body?.message || 'Paystack rejected the request')
      return {
        providerReference: p.id,
        action: { type: 'stk_push', message: r.body?.data?.display_text || 'Prompt sent. Ask the patient to enter their M-Pesa PIN.' },
      }
    }

    const r = await fetchJson(`${API}/transaction/initialize`, {
      method: 'POST', headers: headers(c),
      body: JSON.stringify({
        email: ctx.email, amount: minor(p.amount), currency: 'KES', reference: p.id,
        callback_url: ctx.returnUrl, channels: ['card', 'bank', 'bank_transfer', 'mobile_money'],
        metadata: { payment_id: p.id, hospital_id: p.hospital_id, invoice_id: p.invoice_id, description: ctx.description },
      }),
    })
    if (!r.ok || !r.body?.data?.authorization_url) throw new Error(r.body?.message || 'Paystack rejected the request')
    return { providerReference: p.id, action: { type: 'redirect', url: r.body.data.authorization_url, message: 'Open the secure checkout to complete payment.' } }
  },

  async verify(c: Credentials, payment: PaymentRow): Promise<VerifyResult> {
    need(c, 'secret_key')
    const r = await fetchJson(`${API}/transaction/verify/${encodeURIComponent(payment.provider_reference || payment.id)}`, { headers: headers(c) })
    // 404 "Transaction reference not found" = customer has not opened checkout yet
    if (!r.ok) return { status: 'pending' }
    const d = r.body?.data
    if (!d) return { status: 'pending' }
    if (d.status === 'success') {
      const ch = String(d.channel || '')
      return {
        status: 'completed', amount: Number(d.amount) / 100, currency: d.currency,
        receipt: d.receipt_number || undefined,
        fee: d.fees != null ? Number(d.fees) / 100 : undefined,
        channelMethod: ch === 'mobile_money' ? 'mpesa' : ch === 'card' ? 'card_online' : ch.startsWith('bank') ? 'bank_transfer' : undefined,
        cardBrand: d.authorization?.brand, cardLast4: d.authorization?.last4,
        // whitelist: no authorization_code / signature / bin (reusable-token data)
        extra: { id: d.id, channel: d.channel, paid_at: d.paid_at, gateway_response: d.gateway_response },
      }
    }
    if (['failed', 'abandoned', 'reversed'].includes(d.status)) {
      return { status: d.status === 'abandoned' ? 'pending' : 'failed', failureReason: d.gateway_response || d.status }
    }
    return { status: 'pending' } // ongoing / pending / pay_offline / queued
  },

  async refund(c: Credentials, payment: PaymentRow, amount: number, reason: string) {
    need(c, 'secret_key')
    const r = await fetchJson(`${API}/refund`, {
      method: 'POST', headers: headers(c),
      body: JSON.stringify({ transaction: payment.provider_reference || payment.id, amount: minor(amount), merchant_note: reason }),
    })
    if (!r.ok || r.body?.status !== true) throw new Error(r.body?.message || 'Paystack refused the refund')
    return { providerReference: String(r.body?.data?.id ?? r.body?.data?.refund_reference ?? payment.id) }
  },
}
