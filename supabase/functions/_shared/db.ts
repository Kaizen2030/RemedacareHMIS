// Supabase clients, authz, credentials and the single "apply provider result" routine.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { HttpError } from './cors.ts'
import type { Credentials, PaymentRow, VerifyResult } from './types.ts'

export const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

// Roles are resolved by the database (pay_access_level / pay_user_context in the migration),
// so the browser RPCs and these functions can never disagree about who may do what.
const LEVELS = ['member', 'take', 'manage'] as const
type Level = typeof LEVELS[number]

export async function requireUser(req: Request) {
  const authz = req.headers.get('Authorization') || ''
  if (!authz.toLowerCase().startsWith('bearer ')) throw new HttpError(401, 'Sign in required')
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authz } }, auth: { persistSession: false },
  })
  const { data, error } = await userClient.auth.getUser()
  if (error || !data?.user) throw new HttpError(401, 'Session expired — sign in again')
  return data.user
}

export async function accessLevel(db: ReturnType<typeof admin>, userId: string, hospitalId: string): Promise<Level | null> {
  const { data, error } = await db.rpc('pay_access_level', { p_hospital: hospitalId, p_user: userId })
  if (error) throw new HttpError(500, 'Could not check your permissions')
  return (LEVELS as readonly string[]).includes(data) ? data as Level : null
}

export async function requireRole(db: ReturnType<typeof admin>, userId: string, hospitalId: string, level: Level) {
  const have = await accessLevel(db, userId, hospitalId)
  if (!have) throw new HttpError(403, 'You do not belong to this hospital')
  if (LEVELS.indexOf(have) < LEVELS.indexOf(level)) {
    throw new HttpError(403, level === 'take' ? 'Your role cannot take payments' : 'Only finance/admin can do this')
  }
  return have
}

/** Map a Postgres RAISE from one of our RPCs to a clean 4xx with the human message. */
export function rpcError(error: { message?: string; code?: string } | null, fallback: string): HttpError {
  const msg = String(error?.message || '').replace(/^.*?exception:?\s*/i, '').trim()
  if (error?.code === 'P0001' && msg) return new HttpError(409, msg)
  return new HttpError(500, fallback)
}

export async function loadCredentials(db: ReturnType<typeof admin>, hospitalId: string, provider: string): Promise<Credentials> {
  const { data } = await db.from('hospital_payment_credentials')
    .select('environment, credentials').eq('hospital_id', hospitalId).eq('provider', provider).maybeSingle()
  if (data) return { environment: data.environment, ...(data.credentials || {}) } as Credentials
  // Single-tenant fallback: PAYMENT_CREDENTIALS_DARAJA='{"consumer_key":"..",...,"environment":"live"}'
  const raw = Deno.env.get(`PAYMENT_CREDENTIALS_${provider.toUpperCase()}`)
  if (raw) {
    try { const c = JSON.parse(raw); return { environment: 'sandbox', ...c } as Credentials } catch { /* fallthrough */ }
  }
  throw new HttpError(400, `${provider} is not configured for this hospital (Settings → Payments)`)
}

export async function loadSettings(db: ReturnType<typeof admin>, hospitalId: string) {
  const { data } = await db.from('hospital_payment_settings').select('*').eq('hospital_id', hospitalId).maybeSingle()
  return {
    enabled_methods: ['cash', 'mpesa_manual', 'card_pos', 'bank_transfer', 'cheque'] as string[],
    mpesa_provider: 'daraja', card_provider: 'paystack', fallback_email: null as string | null,
    ...(data || {}),
  }
}

export function functionsBase() {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1`
}

/** Only redirect the browser back to origins we trust (prevents open-redirect via gateway). */
export function safeReturnUrl(candidate: string | undefined, paymentId: string) {
  const allowed = (Deno.env.get('PAYMENTS_ALLOWED_ORIGINS') || Deno.env.get('SITE_URL') || '')
    .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
  let origin = allowed[0]
  try {
    const u = new URL(candidate || '')
    if (allowed.includes(u.origin)) origin = u.origin
  } catch { /* use default */ }
  if (!origin) throw new HttpError(500, 'SITE_URL / PAYMENTS_ALLOWED_ORIGINS is not configured')
  return `${origin}/billing?payment=${paymentId}`
}

export async function logEvent(db: ReturnType<typeof admin>, row: {
  hospital_id?: string | null; payment_id?: string | null; provider: string; event_id?: string | null
  verified: boolean; payload: unknown; error?: string | null }) {
  const { error } = await db.from('payment_events').insert({ ...row, processed_at: new Date().toISOString() })
  // 23505 = duplicate event (provider retry) — expected
  if (error && error.code !== '23505') console.error('payment_events insert failed', error.message)
  return !(error && error.code === '23505')
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01

/**
 * Apply a verified provider result to a payment row. Idempotent and race-safe:
 * the UPDATE is guarded by the previous status so a webhook + poll cannot double-complete.
 */
export async function applyResult(db: ReturnType<typeof admin>, payment: PaymentRow, r: VerifyResult): Promise<PaymentRow> {
  if (payment.status === 'completed' || payment.status === 'reversed') {
    // A status poll (Daraja STK query) can complete a payment before the callback that carries
    // the M-Pesa receipt arrives. Fill the receipt in when it shows up later.
    if (payment.status === 'completed' && r.status === 'completed' && r.receipt && !payment.reference) {
      const { data } = await db.from('payments').update({ reference: r.receipt }).eq('id', payment.id)
        .is('reference', null).select().maybeSingle()
      if (data) { await mirrorMpesa(db, data as PaymentRow, 'Completed'); return data as PaymentRow }
    }
    return payment
  }
  if (r.status === 'pending') return payment

  if (r.status === 'failed') {
    if (payment.status !== 'pending') return payment
    const { data } = await db.from('payments').update({ status: 'failed', failure_reason: r.failureReason || 'Payment failed' })
      .eq('id', payment.id).eq('status', 'pending').select().maybeSingle()
    if (data) await mirrorMpesa(db, data as PaymentRow, 'Failed')
    return (data as PaymentRow) || payment
  }

  // completed — never trust a mismatching amount/currency
  const expected = Number(payment.amount)
  const amountOk = r.amount == null || near(r.amount, expected)
  const currencyOk = !r.currency || r.currency.toUpperCase() === (payment.currency || 'KES').toUpperCase()
  if (!amountOk || !currencyOk) {
    const note = `Provider reported ${r.amount} ${r.currency ?? ''} but expected ${expected} ${payment.currency}`
    await db.from('payments').update({ needs_review: true, review_note: note }).eq('id', payment.id)
    return { ...payment }
  }

  const late = payment.status !== 'pending' // money arrived after cancel/expiry/failure
  const notes: string[] = []
  if (late) notes.push(`Payment confirmed after the request was ${payment.status}. Check the invoice is not over-paid.`)
  if (r.receipt) {
    // The same code typed in by hand on another payment = the same money counted twice.
    const m = r.channelMethod ?? payment.method
    const family = m === 'mpesa' || m === 'mpesa_manual' ? ['mpesa', 'mpesa_manual'] : [m]
    // manual references are stored upper-case by record_manual_payments()
    const { data: dupes } = await db.from('payments').select('id, invoice_id').eq('hospital_id', payment.hospital_id)
      .eq('kind', 'payment').in('status', ['pending', 'completed']).in('method', family)
      .eq('reference', r.receipt.toUpperCase()).neq('id', payment.id).limit(3)
    if (dupes?.length) notes.push(`Receipt ${r.receipt} was also recorded manually — probable duplicate; refund or reverse one of them.`)
  }
  const patch: Record<string, unknown> = {
    status: 'completed',
    reference: r.receipt ?? payment.reference,
    fee_amount: r.fee ?? null,
    card_brand: r.cardBrand ?? null,
    card_last4: r.cardLast4 && /^\d{4}$/.test(r.cardLast4) ? r.cardLast4 : null,
    provider_payload: { ...(payment.provider_payload || {}), ...(r.extra || {}) },
    failure_reason: null,
    ...(notes.length ? { needs_review: true, review_note: notes.join(' ') } : {}),
    ...(r.channelMethod ? { method: r.channelMethod } : {}),
  }
  const { data, error } = await db.from('payments').update(patch).eq('id', payment.id)
    .in('status', ['pending', 'cancelled', 'expired', 'failed']).select().maybeSingle()
  if (error) {
    // e.g. unique violation: the gateway reported a receipt that is already on another
    // gateway payment. Do NOT complete (that would count the money twice) — flag it.
    await db.from('payments').update({ needs_review: true, review_note: `Could not finalise: ${error.message}` }).eq('id', payment.id)
    return payment
  }
  if (data) await mirrorMpesa(db, data as PaymentRow, 'Completed')
  return (data as PaymentRow) || payment
}

/** Keep the legacy mpesa_transactions screen/reports in step. Best-effort only. */
export async function mirrorMpesa(db: ReturnType<typeof admin>, p: PaymentRow, status: 'Pending' | 'Completed' | 'Failed') {
  if (p.method !== 'mpesa') return
  try {
    const base = {
      hospital_id: p.hospital_id, phone: p.payer_phone, amount_kes: Number(p.amount),
      drug_or_service: 'Hospital bill (STK Push)', status, transacted_at: new Date().toISOString(),
    }
    // payment_id marks the row as gateway-managed: the M-Pesa screen shows it read-only
    const full = { ...base, patient_id: p.patient_id, visit_id: p.visit_id, invoice_id: p.invoice_id, payment_id: p.id }
    const stk = p.provider_reference || p.id
    const { data: existing } = await db.from('mpesa_transactions').select('id')
      .eq('hospital_id', p.hospital_id).in('reference', [stk, p.reference || '~']).limit(1).maybeSingle()
    const ref = status === 'Completed' && p.reference ? p.reference : stk
    if (existing) {
      const up = await db.from('mpesa_transactions').update({ status, reference: ref, payment_id: p.id }).eq('id', existing.id)
      if (up.error) await db.from('mpesa_transactions').update({ status, reference: ref }).eq('id', existing.id)
    } else {
      const ins = await db.from('mpesa_transactions').insert({ ...full, reference: ref })
      if (ins.error) await db.from('mpesa_transactions').insert({ ...base, reference: ref })
    }
  } catch (e) {
    console.error('mirrorMpesa failed', (e as Error).message)
  }
}
