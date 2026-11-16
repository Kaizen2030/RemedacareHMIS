// POST { paymentId }            → verify one payment with its gateway (UI polling)
// POST { sweep: true } + header x-cron-secret → reconcile stuck pending payments (schedule every 2–5 min)
import { corsHeaders, errorResponse, HttpError, json } from '../_shared/cors.ts'
import { admin, applyResult, loadCredentials, requireRole, requireUser } from '../_shared/db.ts'
import { timingSafeEqual } from '../_shared/crypto.ts'
import { getProvider } from '../_shared/providers/index.ts'
import type { PaymentRow } from '../_shared/types.ts'

const EXPIRE_AFTER_MIN: Record<string, number> = { mpesa: 15, card_online: 120 }
// Several tabs / cashiers can poll the same payment every few seconds. Gateways rate-limit
// status queries (Daraja's STK query especially), and the webhook is the main signal anyway,
// so ask the gateway at most once per MIN_GAP_MS per payment and otherwise answer from the DB.
const MIN_GAP_MS = 10_000

async function refresh(db: ReturnType<typeof admin>, p: PaymentRow): Promise<PaymentRow> {
  if (p.status !== 'pending' || p.provider === ('manual' as string)) return p
  const last = p.last_checked_at ? new Date(p.last_checked_at).getTime() : 0
  if (Date.now() - last < MIN_GAP_MS) return p
  // claim this check (guarded so concurrent polls don't all hit the gateway)
  let claim = db.from('payments').update({ last_checked_at: new Date().toISOString() }).eq('id', p.id).eq('status', 'pending')
  claim = p.last_checked_at ? claim.eq('last_checked_at', p.last_checked_at) : claim.is('last_checked_at', null)
  const { data: claimed } = await claim.select('id').maybeSingle()
  if (!claimed) return p
  try {
    const creds = await loadCredentials(db, p.hospital_id, p.provider)
    const result = await getProvider(p.provider).verify(creds, p)
    let next = await applyResult(db, p, result)
    if (next.status === 'pending') {
      const ageMin = (Date.now() - new Date(p.created_at).getTime()) / 60000
      if (ageMin > (EXPIRE_AFTER_MIN[p.method] ?? 60)) {
        const { data } = await db.from('payments').update({ status: 'expired', failure_reason: 'No confirmation received' })
          .eq('id', p.id).eq('status', 'pending').select().maybeSingle()
        if (data) next = data as PaymentRow
      }
    }
    return next
  } catch (e) {
    console.error('refresh failed', p.id, (e as Error).message)
    return p
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const db = admin()
    const b = await req.json().catch(() => ({}))

    if (b.sweep) {
      const secret = Deno.env.get('PAYMENTS_CRON_SECRET') || ''
      if (secret.length < 16 || !timingSafeEqual(secret, req.headers.get('x-cron-secret') || '')) throw new HttpError(401, 'Unauthorised')
      const cutoff = new Date(Date.now() - 90 * 1000).toISOString()
      const { data } = await db.from('payments').select('*').eq('status', 'pending').neq('provider', 'manual')
        .eq('kind', 'payment').lt('created_at', cutoff).order('created_at').limit(50)
      let changed = 0
      for (const p of (data || []) as PaymentRow[]) { if ((await refresh(db, p)).status !== 'pending') changed++ }
      return json({ success: true, checked: data?.length || 0, changed })
    }

    const user = await requireUser(req)
    if (!b.paymentId) throw new HttpError(400, 'paymentId is required')
    const { data } = await db.from('payments').select('*').eq('id', b.paymentId).maybeSingle()
    if (!data) throw new HttpError(404, 'Payment not found')
    await requireRole(db, user.id, data.hospital_id, 'member')
    return json({ success: true, payment: await refresh(db, data as PaymentRow) })
  } catch (e) {
    return errorResponse(e)
  }
})
