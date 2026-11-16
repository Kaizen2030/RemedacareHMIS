// Submit one invoice to the SHA FHIR endpoint as a Claim (SHA Claims screen).
// Replaces the May 2026 version, which accepted requests from anyone and put the invoice id straight into a
// database filter. Now: a signed-in member who may take payments (cashier / accountant / admin) at that hospital.
import { invoiceToFHIRClaim } from '../_shared/mappers.ts'
import { errorResponse, HttpError, json } from '../_shared/cors.ts'
import { admin as serviceDb, requireRole, requireUser } from '../_shared/db.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, message: 'Use POST.' }, 405)
  try {
    const user = await requireUser(req)
    const body = await req.json().catch(() => ({}))
    const hospitalId = String(body?.hospitalId || '').trim()
    const invoiceId = String(body?.invoiceId || '').trim()
    if (!/^[0-9a-f-]{36}$/i.test(hospitalId) || !/^[A-Za-z0-9\-_.]{1,64}$/.test(invoiceId)) throw new HttpError(400, 'hospitalId and invoiceId are required.')
    const db = serviceDb()
    await requireRole(db, user.id, hospitalId, 'take')

    const { data: hospital, error: hErr } = await db.from('hospitals').select('*').eq('id', hospitalId).maybeSingle()
    if (hErr) throw hErr
    // Endpoint and client id: Settings → Integrations → SHA HIE (older installs: columns on hospitals)
    const cfg = hospital?.system_settings?.integrations_config || {}
    const endpoint = String(cfg.sha_fhir_endpoint || hospital?.sha_fhir_endpoint || '')
    const clientId = String(cfg.sha_fhir_client_id || hospital?.sha_fhir_client_id || '')
    // The client secret is server-only (hospital_secrets / Vault), never in a table staff can read
    const { data: clientSecret } = await db.rpc('hospital_secret_get', { p_hospital: hospitalId, p_name: 'sha_fhir_client_secret' })
    if (!endpoint) throw new HttpError(400, 'The SHA FHIR endpoint is not set for this hospital (Settings → Integrations → SHA HIE).')
    if (!/^https:\/\//i.test(endpoint)) throw new HttpError(400, 'The SHA FHIR endpoint must start with https://')

    const { data: invoice, error: iErr } = await db.from('invoices').select('*').eq('hospital_id', hospitalId).eq('id', invoiceId).maybeSingle()
    if (iErr) throw iErr
    if (!invoice) throw new HttpError(404, 'Invoice not found.')
    // two parameterised lookups instead of an interpolated .or() filter
    let { data: shaClaim } = await db.from('sha_claims').select('*').eq('hospital_id', hospitalId).eq('invoice_id', invoice.id).limit(1).maybeSingle()
    if (!shaClaim && invoice.invoice_no) {
      ({ data: shaClaim } = await db.from('sha_claims').select('*').eq('hospital_id', hospitalId).eq('invoice_no', invoice.invoice_no).limit(1).maybeSingle())
    }
    const { data: patient } = invoice.patient_id ? await db.from('patients').select('*').eq('hospital_id', hospitalId).eq('id', invoice.patient_id).maybeSingle() : { data: null }
    const { data: visit } = invoice.visit_id ? await db.from('visits').select('*').eq('hospital_id', hospitalId).eq('id', invoice.visit_id).maybeSingle() : { data: null }

    const claim = invoiceToFHIRClaim(invoice, patient, visit, hospitalId, shaClaim)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/fhir+json', Accept: 'application/fhir+json',
        ...(clientId ? { 'X-Client-Id': clientId } : {}),
        ...(clientSecret ? { 'X-Client-Secret': String(clientSecret) } : {}),
      },
      body: JSON.stringify(claim),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    let parsed: unknown = text
    try { parsed = text ? JSON.parse(text) : {} } catch { /* keep text */ }

    if (shaClaim?.id) {
      await db.from('sha_claims').update({ fhir_response: parsed, fhir_status: response.ok ? 'Submitted' : 'Rejected', fhir_submitted_at: new Date().toISOString() }).eq('id', shaClaim.id)
    }
    await db.from('fhir_audit_log').insert({
      hospital_id: hospitalId, resource_type: 'Claim', resource_id: String(shaClaim?.id || invoice.id), action: 'submit', user_id: user.id,
      status: response.ok ? 'ok' : `error ${response.status}`, details: { invoice_id: invoice.id, http_status: response.status },
    }).then(() => null, () => null)
    return json({ success: response.ok, claimId: shaClaim?.id || invoice.id, shaResponse: parsed }, response.ok ? 200 : 502)
  } catch (e) {
    return errorResponse(e)
  }
})
