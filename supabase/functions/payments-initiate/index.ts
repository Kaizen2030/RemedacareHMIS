// POST { invoiceId, method: 'mpesa'|'card_online', amount, phone?, email?, payerName?, idempotencyKey, returnUrl? }
// Creates a PENDING ledger row, calls the configured gateway, returns what the UI must do next.
import { corsHeaders, errorResponse, HttpError, json } from '../_shared/cors.ts'
import { admin, functionsBase, loadCredentials, loadSettings, mirrorMpesa, requireRole, requireUser, rpcError, safeReturnUrl } from '../_shared/db.ts'
import { signPaymentToken } from '../_shared/crypto.ts'
import { normalizeKenyanPhone } from '../_shared/phone.ts'
import { getProvider } from '../_shared/providers/index.ts'
import type { PaymentRow, ProviderName } from '../_shared/types.ts'

const ONLINE = new Set(['mpesa', 'card_online'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only')
    const user = await requireUser(req)
    const b = await req.json().catch(() => null)
    if (!b) throw new HttpError(400, 'Invalid JSON')

    const method = String(b.method || '')
    const amount = Math.round(Number(b.amount) * 100) / 100
    const key = String(b.idempotencyKey || '')
    if (!UUID.test(String(b.invoiceId || ''))) throw new HttpError(400, 'invoiceId is required')
    if (!ONLINE.has(method)) throw new HttpError(400, 'Unsupported online method')
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Amount must be greater than zero')
    if (key.length < 8 || key.length > 80) throw new HttpError(400, 'idempotencyKey is required')

    const db = admin()
    const { data: inv } = await db.from('invoices').select('*').eq('id', b.invoiceId).maybeSingle()
    if (!inv) throw new HttpError(404, 'Invoice not found')
    await requireRole(db, user.id, inv.hospital_id, 'take')
    if (inv.status === 'Cancelled') throw new HttpError(409, 'Invoice is cancelled')

    const settings = await loadSettings(db, inv.hospital_id)
    if (!settings.enabled_methods.includes(method)) throw new HttpError(400, 'This payment method is not enabled for your hospital')
    const providerName = (method === 'mpesa' ? settings.mpesa_provider : settings.card_provider) as ProviderName
    if (method === 'mpesa' && !['daraja', 'paystack', 'flutterwave'].includes(providerName)) {
      throw new HttpError(400, `${providerName} cannot send M-Pesa prompts — choose Daraja, Paystack or Flutterwave in Settings → Payments`)
    }

    const phone = normalizeKenyanPhone(b.phone)
    if (method === 'mpesa' && !phone) throw new HttpError(400, 'Enter a valid Safaricom number (e.g. 0712 345 678)')

    const { data: patient } = await db.from('patients').select('full_name, email, phone').eq('id', inv.patient_id).maybeSingle()
      .then((r: any) => r, () => ({ data: null }))
    const email = String(b.email || patient?.email || settings.fallback_email || '').trim()
    if (providerName !== 'daraja' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpError(400, 'An email address is required by the card gateway. Enter one or set a fallback email in Settings → Payments.')
    }

    // Balance check + insert happen in ONE locked transaction (create_online_payment), so two
    // cashiers — or a double-click — can never reserve more than the open balance.
    const { data: created, error: createErr } = await db.rpc('create_online_payment', {
      p_invoice_id: inv.id, p_user: user.id, p_method: method, p_provider: providerName, p_amount: amount,
      p_idempotency_key: key,
      p_payer_name: String(b.payerName || patient?.full_name || inv.patient_name || ''),
      p_payer_phone: phone, p_payer_email: email || null, p_allow_partial: settings.allow_partial !== false,
    })
    if (createErr) throw rpcError(createErr, 'Could not create the payment record')
    // Replay of the same request (double-click / retry) → return the existing row
    if (created.replay) return json({ success: true, replay: true, payment: created.payment })
    const payment = created.payment as PaymentRow

    try {
      const creds = await loadCredentials(db, inv.hospital_id, providerName)
      const token = await signPaymentToken(payment.id)
      const hook = `${functionsBase()}/payments-webhook?provider=${providerName}`
      const callbackUrl = providerName === 'daraja'
        ? `${hook}&p=${payment.id}&s=${token}`
        : providerName === 'pesapal' ? `${hook}&h=${inv.hospital_id}` : hook
      const result = await getProvider(providerName).initiate({
        creds, payment, callbackUrl,
        returnUrl: safeReturnUrl(b.returnUrl, payment.id),
        email: email || 'noreply@invalid.local',
        description: `Invoice ${inv.invoice_no || inv.id}`,
      })
      const { data: updated } = await db.from('payments').update({
        provider_reference: result.providerReference,
        provider_payload: { init: result.safe || null },
      }).eq('id', payment.id).select().single()
      await mirrorMpesa(db, updated as PaymentRow, 'Pending')
      return json({ success: true, payment: updated, action: result.action })
    } catch (e) {
      await db.from('payments').update({ status: 'failed', failure_reason: (e as Error).message.slice(0, 300) }).eq('id', payment.id)
      throw new HttpError(502, (e as Error).message)
    }
  } catch (e) {
    return errorResponse(e)
  }
})
