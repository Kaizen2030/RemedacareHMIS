// Run with vitest (see supabase/tests/README.md). Exercises the gateway adapters and the
// "apply provider result" logic with a mocked fetch and an in-memory fake database.
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyResult } from '../functions/_shared/db.ts'
import { hmacHex, signPaymentToken, timingSafeEqual, verifyPaymentToken } from '../functions/_shared/crypto.ts'
import { normalizeKenyanPhone } from '../functions/_shared/phone.ts'
import { daraja, darajaPassword, friendlyResult, nairobiTimestamp, parseStkCallback } from '../functions/_shared/providers/daraja.ts'
import { paystack } from '../functions/_shared/providers/paystack.ts'
import { flutterwave } from '../functions/_shared/providers/flutterwave.ts'
import { pesapal } from '../functions/_shared/providers/pesapal.ts'

const payment = (over: Record<string, unknown> = {}) => ({
  id: 'pay-1', hospital_id: 'h1', invoice_id: 'inv-1', patient_id: null, visit_id: null, kind: 'payment', method: 'card_online',
  provider: 'paystack', status: 'pending', amount: 1500, currency: 'KES', reference: null, provider_reference: 'pay-1',
  payer_name: 'Jane', payer_phone: '0712345678', payer_email: 'j@x.co', provider_payload: null, created_at: new Date().toISOString(), ...over,
}) as any

function fakeDb({ selectRows = null as any[] | null } = {}) {
  const updates: Array<{ table: string; patch: any }> = []
  const filters: Array<[string, string, unknown]> = []
  const from = (table: string) => {
    const q: any = { _patch: null }
    q.update = (p: any) => { q._patch = p; return q }
    const f = (op: string) => (col: string, val: unknown) => { filters.push([op, col, val]); return q }
    q.select = () => q; q.eq = f('eq'); q.in = f('in'); q.neq = f('neq'); q.is = f('is'); q.limit = () => q
    q.insert = async () => ({ error: null })
    q.maybeSingle = async () => { if (q._patch) updates.push({ table, patch: q._patch }); return { data: q._patch ? { ...payment(), ...q._patch } : null, error: null } }
    q.then = (res: any) => { if (q._patch) updates.push({ table, patch: q._patch }); return Promise.resolve({ data: q._patch ? null : selectRows, error: null }).then(res) }
    return q
  }
  return { db: { from } as any, updates, filters }
}
const paymentUpdates = (u: Array<{ table: string; patch: any }>) => u.filter((x) => x.table === 'payments').map((x) => x.patch)

describe('applyResult', () => {
  it('completes on matching amount', async () => {
    const { db, updates } = fakeDb()
    const out = await applyResult(db, payment(), { status: 'completed', amount: 1500, currency: 'KES', receipt: 'ABC123', cardBrand: 'visa', cardLast4: '4242' })
    expect(out.status).toBe('completed')
    expect(paymentUpdates(updates)[0]).toMatchObject({ status: 'completed', reference: 'ABC123', card_last4: '4242' })
    expect(paymentUpdates(updates)[0].needs_review).toBeUndefined()
  })
  it('NEVER completes when the provider amount differs — flags for review', async () => {
    const { db, updates } = fakeDb()
    const out = await applyResult(db, payment(), { status: 'completed', amount: 15, currency: 'KES' })
    expect(out.status).toBe('pending')
    const p = paymentUpdates(updates)
    expect(p).toHaveLength(1)
    expect(p[0].status).toBeUndefined()
    expect(p[0].needs_review).toBe(true)
  })
  it('flags currency mismatch', async () => {
    const { db, updates } = fakeDb()
    await applyResult(db, payment(), { status: 'completed', amount: 1500, currency: 'USD' })
    expect(paymentUpdates(updates)[0]).toMatchObject({ needs_review: true })
  })
  it('late success after cancellation is recorded but flagged', async () => {
    const { db, updates } = fakeDb()
    await applyResult(db, payment({ status: 'cancelled' }), { status: 'completed', amount: 1500, receipt: 'LATE1' })
    expect(paymentUpdates(updates)[0]).toMatchObject({ status: 'completed', needs_review: true })
  })
  it('is idempotent for completed payments', async () => {
    const { db, updates } = fakeDb()
    await applyResult(db, payment({ status: 'completed' }), { status: 'completed', amount: 1500 })
    expect(updates).toHaveLength(0)
  })
  it('records failures once and ignores pending', async () => {
    const { db, updates } = fakeDb()
    await applyResult(db, payment(), { status: 'pending' })
    expect(updates).toHaveLength(0)
    await applyResult(db, payment(), { status: 'failed', failureReason: 'Wrong PIN' })
    expect(paymentUpdates(updates)[0]).toMatchObject({ status: 'failed', failure_reason: 'Wrong PIN' })
  })
  it('fills in the M-Pesa receipt when the callback arrives after a poll already completed the payment', async () => {
    const { db, updates, filters } = fakeDb()
    const out = await applyResult(db, payment({ status: 'completed', method: 'mpesa', provider: 'daraja', reference: null }),
      { status: 'completed', amount: 1500, receipt: 'RKT9XYZ123' })
    expect(paymentUpdates(updates)[0]).toEqual({ reference: 'RKT9XYZ123' })
    expect(filters).toContainEqual(['is', 'reference', null]) // never overwrites an existing receipt
    expect(out.reference).toBe('RKT9XYZ123')
  })
  it('does not touch a completed payment that already has its receipt', async () => {
    const { db, updates } = fakeDb()
    await applyResult(db, payment({ status: 'completed', reference: 'OLD1234567' }), { status: 'completed', amount: 1500, receipt: 'NEW1234567' })
    expect(updates).toHaveLength(0)
  })
  it('flags a gateway receipt that a cashier already typed in by hand (double count)', async () => {
    const { db, updates, filters } = fakeDb({ selectRows: [{ id: 'manual-1', invoice_id: 'inv-9' }] })
    await applyResult(db, payment({ method: 'mpesa', provider: 'daraja' }), { status: 'completed', amount: 1500, receipt: 'qwe1rty2ui' })
    expect(paymentUpdates(updates)[0]).toMatchObject({ status: 'completed', needs_review: true })
    expect(paymentUpdates(updates)[0].review_note).toMatch(/probable duplicate/)
    expect(filters).toContainEqual(['in', 'method', ['mpesa', 'mpesa_manual']])
    expect(filters).toContainEqual(['eq', 'reference', 'QWE1RTY2UI'])
  })
  it('strips unknown provider payload fields (no card tokens stored)', async () => {
    const { db, updates } = fakeDb()
    await applyResult(db, payment(), { status: 'completed', amount: 1500, extra: { id: 7, channel: 'card' } })
    expect(paymentUpdates(updates)[0].provider_payload).toEqual({ id: 7, channel: 'card' })
  })
})

describe('crypto helpers', () => {
  beforeEach(() => vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'PAYMENTS_WEBHOOK_SECRET' ? 'x'.repeat(32) : undefined) } }))
  afterEach(() => vi.unstubAllGlobals())
  it('HMAC-SHA512 matches node crypto (Paystack signature)', async () => {
    const body = '{"event":"charge.success","data":{"reference":"abc"}}'
    expect(await hmacHex('SHA-512', 'sk_test_123', body)).toBe(createHmac('sha512', 'sk_test_123').update(body).digest('hex'))
  })
  it('timingSafeEqual', () => { expect(timingSafeEqual('abc', 'abc')).toBe(true); expect(timingSafeEqual('abc', 'abd')).toBe(false); expect(timingSafeEqual('abc', 'abcd')).toBe(false) })
  it('callback token binds to the payment id', async () => {
    const t = await signPaymentToken('pay-1')
    expect(await verifyPaymentToken('pay-1', t)).toBe(true)
    expect(await verifyPaymentToken('pay-2', t)).toBe(false)
    expect(await verifyPaymentToken('pay-1', '')).toBe(false)
    expect(await verifyPaymentToken('pay-1', t.slice(0, -1) + (t.endsWith('a') ? 'b' : 'a'))).toBe(false)
  })
  it('refuses to run without a strong webhook secret', async () => {
    vi.stubGlobal('Deno', { env: { get: () => 'short' } })
    await expect(signPaymentToken('p')).rejects.toThrow(/PAYMENTS_WEBHOOK_SECRET/)
    expect(await verifyPaymentToken('p', 'anything')).toBe(false)
  })
})

describe('Daraja', () => {
  const creds = { environment: 'sandbox', consumer_key: 'ck', consumer_secret: 'cs', shortcode: '174379', passkey: 'PASS' } as any
  const calls: Array<{ url: string; body: any }> = []
  beforeEach(() => {
    calls.length = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      if (String(url).includes('oauth')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: '3599' }))
      calls.push({ url: String(url), body: JSON.parse(init.body) })
      if (String(url).includes('stkpushquery')) return new Response(JSON.stringify({ ResultCode: '0' }))
      return new Response(JSON.stringify({ ResponseCode: '0', CheckoutRequestID: 'ws_CO_X', MerchantRequestID: 'm1', CustomerMessage: 'ok' }))
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('timestamp is 14 digits and password is base64(shortcode+passkey+ts)', () => {
    const ts = nairobiTimestamp(new Date('2026-11-14T06:05:09Z')) // 09:05:09 EAT
    expect(ts).toBe('20261114090509')
    expect(darajaPassword('174379', 'PASS', ts)).toBe(Buffer.from('174379PASS20261114090509').toString('base64'))
  })
  it('midnight is 00 not 24', () => expect(nairobiTimestamp(new Date('2026-11-13T21:00:00Z'))).toBe('20261114000000'))

  it('sends a PayBill STK request with normalised phone and integer amount', async () => {
    const r = await daraja.initiate({ creds, payment: payment({ method: 'mpesa', provider: 'daraja', amount: 1500 }), callbackUrl: 'https://cb', returnUrl: '', email: '', description: 'x' })
    expect(r.providerReference).toBe('ws_CO_X')
    const b = calls[0].body
    expect(b).toMatchObject({ TransactionType: 'CustomerPayBillOnline', Amount: 1500, PartyA: '254712345678', PhoneNumber: '254712345678', PartyB: '174379', CallBackURL: 'https://cb' })
    expect(b.AccountReference.length).toBeLessThanOrEqual(12)
  })
  it('uses Buy Goods when a till is configured', async () => {
    await daraja.initiate({ creds: { ...creds, till_number: '5551234' }, payment: payment({ method: 'mpesa', provider: 'daraja', amount: 100 }), callbackUrl: 'https://cb', returnUrl: '', email: '', description: 'x' })
    expect(calls[0].body).toMatchObject({ TransactionType: 'CustomerBuyGoodsOnline', PartyB: '5551234', BusinessShortCode: '174379' })
  })
  it('rejects fractional shillings and bad phones before calling Safaricom', async () => {
    await expect(daraja.initiate({ creds, payment: payment({ amount: 10.5 }), callbackUrl: '', returnUrl: '', email: '', description: '' })).rejects.toThrow(/whole shillings/)
    await expect(daraja.initiate({ creds, payment: payment({ payer_phone: '123' }), callbackUrl: '', returnUrl: '', email: '', description: '' })).rejects.toThrow(/Safaricom number/)
    expect(calls).toHaveLength(0)
  })
  it('parses callbacks and maps failure codes', () => {
    const ok = parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: 'c1', ResultCode: 0, ResultDesc: 'ok', CallbackMetadata: { Item: [{ Name: 'Amount', Value: 1500 }, { Name: 'MpesaReceiptNumber', Value: 'RKT1ABCDE2' }, { Name: 'PhoneNumber', Value: 254712345678 }] } } } })
    expect(ok).toMatchObject({ checkoutRequestId: 'c1', resultCode: '0', amount: 1500, receipt: 'RKT1ABCDE2' })
    expect(parseStkCallback({ Body: {} })).toBeNull()
    expect(parseStkCallback(null)).toBeNull()
    expect(friendlyResult('1032')).toMatch(/cancelled/i)
    expect(friendlyResult('2001')).toMatch(/PIN/)
    expect(friendlyResult('7777', 'Some text')).toBe('Some text')
  })
  it('query: success → completed, 5xx "still processing" → pending, other codes → failed', async () => {
    expect((await daraja.verify(creds, payment({ provider_reference: 'ws_CO_X' }))).status).toBe('completed')
    ;(fetch as any).mockImplementation(async (url: string) => String(url).includes('oauth') ? new Response(JSON.stringify({ access_token: 't' })) : new Response(JSON.stringify({ errorCode: '500.001.1001' }), { status: 500 }))
    expect((await daraja.verify(creds, payment({ provider_reference: 'ws_CO_Y' }))).status).toBe('pending')
    ;(fetch as any).mockImplementation(async (url: string) => String(url).includes('oauth') ? new Response(JSON.stringify({ access_token: 't2', expires_in: 1 })) : new Response(JSON.stringify({ ResultCode: '1032' })))
    const r = await daraja.verify({ ...creds, consumer_key: 'other' }, payment({ provider_reference: 'ws_CO_Z' }))
    expect(r).toMatchObject({ status: 'failed' })
  })
})

describe('Paystack / Flutterwave / Pesapal verification mapping', () => {
  afterEach(() => vi.unstubAllGlobals())
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })

  it('Paystack converts minor units and never exposes the authorization token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ status: true, data: { status: 'success', amount: 150000, currency: 'KES', channel: 'card', fees: 4500, id: 99, authorization: { brand: 'visa', last4: '4242', authorization_code: 'AUTH_secret', signature: 'SIG', bin: '411111' } } })))
    const r = await paystack.verify({ environment: 'live', secret_key: 'sk' } as any, payment())
    expect(r).toMatchObject({ status: 'completed', amount: 1500, currency: 'KES', fee: 45, channelMethod: 'card_online', cardLast4: '4242' })
    expect(JSON.stringify(r)).not.toMatch(/AUTH_secret|SIG|411111/)
  })
  it('Paystack: abandoned stays pending, failed is failed, 404 is pending', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { status: 'abandoned' } })))
    expect((await paystack.verify({ secret_key: 'sk' } as any, payment())).status).toBe('pending')
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { status: 'failed', gateway_response: 'Declined' } })))
    expect(await paystack.verify({ secret_key: 'sk' } as any, payment())).toMatchObject({ status: 'failed', failureReason: 'Declined' })
    vi.stubGlobal('fetch', vi.fn(async () => json({ status: false }, 404)))
    expect((await paystack.verify({ secret_key: 'sk' } as any, payment())).status).toBe('pending')
  })
  it('Paystack M-Pesa charge sends +254 phone and KES minor units', async () => {
    const f = vi.fn(async () => json({ status: true, data: { display_text: 'Enter PIN' } })); vi.stubGlobal('fetch', f)
    const r = await paystack.initiate({ creds: { secret_key: 'sk' } as any, payment: payment({ method: 'mpesa' }), callbackUrl: '', returnUrl: 'https://r', email: 'j@x.co', description: 'd' })
    expect(r.action.type).toBe('stk_push')
    const body = JSON.parse((f.mock.calls[0] as any)[1].body)
    expect(body).toMatchObject({ amount: 150000, currency: 'KES', reference: 'pay-1', mobile_money: { phone: '+254712345678', provider: 'mpesa' } })
  })
  it('Flutterwave maps successful / failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { status: 'successful', amount: 1500, currency: 'KES', payment_type: 'mpesa', flw_ref: 'FLW1', id: 5 } })))
    expect(await flutterwave.verify({ secret_key: 'sk' } as any, payment())).toMatchObject({ status: 'completed', amount: 1500, channelMethod: 'mpesa', receipt: 'FLW1', extra: { flw_id: 5 } })
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { status: 'failed', processor_response: 'Insufficient funds' } })))
    expect(await flutterwave.verify({ secret_key: 'sk' } as any, payment())).toMatchObject({ status: 'failed', failureReason: 'Insufficient funds' })
  })
  it('Pesapal status codes', async () => {
    const mk = (d: unknown) => vi.fn(async (u: string) => String(u).includes('RequestToken') ? json({ token: 't' }) : json(d))
    const c = { environment: 'sandbox', consumer_key: 'k' + Math.random(), consumer_secret: 's' } as any
    vi.stubGlobal('fetch', mk({ status_code: 1, amount: 1500, currency: 'KES', payment_method: 'MpesaKE', confirmation_code: 'PP1' }))
    expect(await pesapal.verify(c, payment({ provider_reference: 'trk' }))).toMatchObject({ status: 'completed', channelMethod: 'mpesa', receipt: 'PP1' })
    vi.stubGlobal('fetch', mk({ status_code: 2, description: 'Declined' }))
    expect((await pesapal.verify({ ...c, consumer_key: 'k2' + Math.random() }, payment({ provider_reference: 'trk' }))).status).toBe('failed')
    vi.stubGlobal('fetch', mk({ status_code: 0 }))
    expect((await pesapal.verify({ ...c, consumer_key: 'k3' + Math.random() }, payment({ provider_reference: 'trk' }))).status).toBe('pending')
  })
})

describe('phone parity with the browser helper', () => {
  it.each([['0712345678', '254712345678'], ['+254112345678', '254112345678'], ['0212345678', null], ['', null]])('%s', (i, o) => expect(normalizeKenyanPhone(i)).toBe(o))
})
