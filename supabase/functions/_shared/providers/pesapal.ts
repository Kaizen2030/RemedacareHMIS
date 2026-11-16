// Pesapal v3: hosted checkout (cards, M-Pesa, Airtel, bank) — IPN-driven.
// Credentials: consumer_key, consumer_secret
import type { Credentials, InitiateContext, InitiateResult, PaymentRow, Provider, VerifyResult } from '../types.ts'
import { fetchJson, need } from './http.ts'
import { normalizeKenyanPhone } from '../phone.ts'

const base = (c: Credentials) =>
  c.environment === 'live' ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3'

const tokenCache = new Map<string, { token: string; exp: number }>()
const ipnCache = new Map<string, string>()

async function token(c: Credentials) {
  need(c, 'consumer_key', 'consumer_secret')
  const k = `${c.environment}:${c.consumer_key}`
  const hit = tokenCache.get(k)
  if (hit && hit.exp > Date.now() + 15000) return hit.token
  const r = await fetchJson(`${base(c)}/api/Auth/RequestToken`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ consumer_key: c.consumer_key, consumer_secret: c.consumer_secret }),
  })
  if (!r.ok || !r.body?.token) throw new Error('Pesapal authentication failed — check credentials')
  tokenCache.set(k, { token: r.body.token, exp: Date.now() + 4 * 60 * 1000 }) // tokens last 5 min
  return r.body.token as string
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Accept: 'application/json' })

async function ipnId(c: Credentials, t: string, url: string) {
  const hit = ipnCache.get(url)
  if (hit) return hit
  const r = await fetchJson(`${base(c)}/api/URLs/RegisterIPN`, {
    method: 'POST', headers: auth(t), body: JSON.stringify({ url, ipn_notification_type: 'GET' }),
  })
  if (!r.ok || !r.body?.ipn_id) throw new Error('Could not register Pesapal IPN URL')
  ipnCache.set(url, r.body.ipn_id)
  return r.body.ipn_id as string
}

export const pesapal: Provider = {
  async initiate(ctx: InitiateContext): Promise<InitiateResult> {
    const c = ctx.creds
    const p = ctx.payment
    const t = await token(c)
    const notification_id = await ipnId(c, t, ctx.callbackUrl)
    const phone = normalizeKenyanPhone(p.payer_phone)
    const [first, ...rest] = String(p.payer_name || 'Patient').split(' ')
    const r = await fetchJson(`${base(c)}/api/Transactions/SubmitOrderRequest`, {
      method: 'POST', headers: auth(t),
      body: JSON.stringify({
        id: p.id, currency: 'KES', amount: Number(p.amount), description: ctx.description.slice(0, 100),
        callback_url: ctx.returnUrl, notification_id,
        billing_address: { email_address: ctx.email, phone_number: phone || '', country_code: 'KE', first_name: first, last_name: rest.join(' ') },
      }),
    })
    if (!r.ok || !r.body?.redirect_url) throw new Error(r.body?.error?.message || 'Pesapal rejected the request')
    return {
      providerReference: r.body.order_tracking_id,
      action: { type: 'redirect', url: r.body.redirect_url, message: 'Open the secure checkout to complete payment.' },
    }
  },

  async verify(c: Credentials, payment: PaymentRow): Promise<VerifyResult> {
    if (!payment.provider_reference) return { status: 'pending' }
    const t = await token(c)
    const r = await fetchJson(
      `${base(c)}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(payment.provider_reference)}`,
      { headers: auth(t) })
    if (!r.ok || !r.body) return { status: 'pending' }
    const d = r.body
    const code = Number(d.status_code) // 0 invalid, 1 completed, 2 failed, 3 reversed
    if (code === 1) {
      const pm = String(d.payment_method || '').toLowerCase()
      return {
        status: 'completed', amount: Number(d.amount), currency: d.currency,
        receipt: d.confirmation_code || undefined,
        channelMethod: pm.includes('mpesa') ? 'mpesa' : pm.includes('airtel') ? 'airtel_money'
          : pm.includes('visa') || pm.includes('master') || pm.includes('card') ? 'card_online' : undefined,
        extra: { payment_method: d.payment_method, created_date: d.created_date },
      }
    }
    if (code === 2 || code === 3) {
      return { status: 'failed', failureReason: d.description || d.payment_status_description || 'Payment failed' }
    }
    return { status: 'pending' }
  },
}
