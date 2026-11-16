// Safaricom M-Pesa (Daraja) — STK Push (Lipa na M-Pesa Online).
// Credentials: consumer_key, consumer_secret, shortcode, passkey,
//              optional till_number (Buy Goods) , environment
import type { Credentials, InitiateContext, InitiateResult, PaymentRow, Provider, VerifyResult } from '../types.ts'
import { fetchJson, need } from './http.ts'
import { normalizeKenyanPhone } from '../phone.ts'

const base = (c: Credentials) =>
  c.environment === 'live' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'

const tokenCache = new Map<string, { token: string; exp: number }>()

async function accessToken(c: Credentials) {
  need(c, 'consumer_key', 'consumer_secret')
  const k = `${c.environment}:${c.consumer_key}`
  const hit = tokenCache.get(k)
  if (hit && hit.exp > Date.now() + 15000) return hit.token
  const r = await fetchJson(`${base(c)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: 'Basic ' + btoa(`${c.consumer_key}:${c.consumer_secret}`) },
  })
  if (!r.ok || !r.body?.access_token) throw new Error('M-Pesa authentication failed — check Daraja credentials')
  tokenCache.set(k, { token: r.body.access_token, exp: Date.now() + (Number(r.body.expires_in) || 3000) * 1000 })
  return r.body.access_token as string
}

/** YYYYMMDDHHmmss in East Africa Time. */
export function nairobiTimestamp(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t: string) => parts.find((p) => p.type === t)!.value
  const hh = g('hour') === '24' ? '00' : g('hour')
  return `${g('year')}${g('month')}${g('day')}${hh}${g('minute')}${g('second')}`
}

export const darajaPassword = (shortcode: string, passkey: string, ts: string) =>
  btoa(`${shortcode}${passkey}${ts}`)

export const daraja: Provider = {
  async initiate(ctx: InitiateContext): Promise<InitiateResult> {
    const c = ctx.creds
    need(c, 'shortcode', 'passkey')
    const phone = normalizeKenyanPhone(ctx.payment.payer_phone)
    if (!phone) throw new Error('Enter a valid Safaricom number (e.g. 0712 345 678)')
    const amount = Number(ctx.payment.amount)
    if (!Number.isInteger(amount) || amount < 1) {
      throw new Error('M-Pesa STK Push accepts whole shillings only (KES 1 or more)')
    }
    const ts = nairobiTimestamp()
    const token = await accessToken(c)
    const till = c.till_number
    const r = await fetchJson(`${base(c)}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: c.shortcode,
        Password: darajaPassword(c.shortcode, c.passkey, ts),
        Timestamp: ts,
        TransactionType: till ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: phone,
        PartyB: till || c.shortcode,
        PhoneNumber: phone,
        CallBackURL: ctx.callbackUrl,
        AccountReference: ctx.payment.id.replace(/-/g, '').slice(0, 12),
        TransactionDesc: 'Hospital bill',
      }),
    })
    if (!r.ok || String(r.body?.ResponseCode) !== '0' || !r.body?.CheckoutRequestID) {
      throw new Error(r.body?.errorMessage || r.body?.ResponseDescription || 'M-Pesa rejected the request')
    }
    return {
      providerReference: r.body.CheckoutRequestID,
      action: { type: 'stk_push', message: r.body.CustomerMessage || 'Prompt sent. Ask the patient to enter their M-Pesa PIN.' },
      safe: { merchantRequestId: r.body.MerchantRequestID },
    }
  },

  async verify(c: Credentials, payment: PaymentRow): Promise<VerifyResult> {
    need(c, 'shortcode', 'passkey')
    if (!payment.provider_reference) return { status: 'pending' }
    const ts = nairobiTimestamp()
    const token = await accessToken(c)
    const r = await fetchJson(`${base(c)}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: c.shortcode,
        Password: darajaPassword(c.shortcode, c.passkey, ts),
        Timestamp: ts,
        CheckoutRequestID: payment.provider_reference,
      }),
    })
    // Daraja answers HTTP 500 / errorCode 500.001.1001 while the customer is still deciding.
    if (!r.ok) return { status: 'pending' }
    const code = String(r.body?.ResultCode ?? '')
    if (code === '') return { status: 'pending' }
    if (code === '0') return { status: 'completed', amount: Number(payment.amount), currency: 'KES' }
    return { status: 'failed', failureReason: friendlyResult(code, r.body?.ResultDesc) }
  },
}

export function friendlyResult(code: string, desc?: string) {
  const map: Record<string, string> = {
    '1': 'Insufficient M-Pesa balance',
    '1001': 'Another M-Pesa transaction is in progress for this number',
    '1019': 'Transaction expired',
    '1025': 'Could not send prompt, try again',
    '1032': 'Patient cancelled the request',
    '1037': 'Prompt timed out — patient did not respond',
    '2001': 'Wrong M-Pesa PIN entered',
    '9999': 'Request could not be completed',
  }
  return map[code] || desc || `M-Pesa declined (code ${code})`
}

/** Parse Safaricom's STK callback body. Returns null when the shape is unexpected. */
export function parseStkCallback(body: any) {
  const cb = body?.Body?.stkCallback
  if (!cb?.CheckoutRequestID) return null
  const items: Array<{ Name: string; Value?: unknown }> = cb.CallbackMetadata?.Item ?? []
  const pick = (n: string) => items.find((i) => i.Name === n)?.Value
  return {
    checkoutRequestId: String(cb.CheckoutRequestID),
    resultCode: String(cb.ResultCode),
    resultDesc: String(cb.ResultDesc ?? ''),
    amount: pick('Amount') != null ? Number(pick('Amount')) : undefined,
    receipt: pick('MpesaReceiptNumber') != null ? String(pick('MpesaReceiptNumber')) : undefined,
    phone: pick('PhoneNumber') != null ? String(pick('PhoneNumber')) : undefined,
  }
}
