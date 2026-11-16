// One visit as a FHIR document bundle (used by Referrals → "FHIR bundle").
// Replaces the May 2026 version, which answered anyone with no sign-in check. Now: a staff sign-in token with a
// clinical role at that hospital, or an API key allowed to read Patient + Encounter. Every call is logged.
import { FhirError, operationOutcome, visitDocument, type Caller } from '../_shared/fhirCore.ts'
import { authenticate, logCall, serviceClient } from '../_shared/fhirAuth.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, x-hospital-id, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}
const fhirJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/fhir+json; charset=utf-8', 'Cache-Control': 'no-store' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'GET') return fhirJson(operationOutcome(405, 'not-supported', 'Use GET.'), 405)
  const url = new URL(req.url)
  const admin = serviceClient()
  const visitId = (url.searchParams.get('visitId') || '').trim()
  let caller: Caller | null = null
  try {
    // Referral letter QR code: ?share=rcs_… opens exactly the visit it was created for, nothing else
    const share = url.searchParams.get('share') || ''
    if (share) {
      const { data, error } = await admin.rpc('referral_share_resolve', { p_token: share })
      const s = Array.isArray(data) ? data[0] : data
      if (error || !s) throw new FhirError(404, 'not-found', 'This referral link has expired, was revoked or is not valid. Ask the referring facility for a new letter.')
      caller = {
        kind: 'client', hospitalId: String(s.hospital_id), allowConfidential: true, clientId: s.id, name: 'Referral letter link',
        scopes: ['Patient', 'Encounter', 'Observation', 'Condition', 'MedicationRequest', 'DiagnosticReport'],
      }
      const { bundle, touched } = await visitDocument(admin, caller, String(s.visit_id))
      await logCall(admin, req, caller, caller.hospitalId, { resource_type: 'Bundle', resource_id: String(s.visit_id), action: 'referral-link', status: 'ok', result_count: bundle.entry.length, touched })
      return fhirJson({ ...bundle, meta: { tag: [{ system: 'https://remedacare.health/referral-link', code: 'expires', display: String(s.expires_at) }] } })
    }

    const auth = await authenticate(req, admin, url)
    caller = auth.caller
    if (!caller.scopes.includes('Patient') || !caller.scopes.includes('Encounter')) throw new FhirError(403, 'forbidden', 'Not allowed to read visit records.')
    const requested = url.searchParams.get('hospitalId') || url.searchParams.get('hospital')
    if (requested && requested !== caller.hospitalId) throw new FhirError(403, 'forbidden', 'That visit belongs to another hospital.')
    if (['1', 'true', 'yes'].includes(String(url.searchParams.get('ping') || '').toLowerCase())) {
      return fhirJson({ resourceType: 'Bundle', type: 'collection', timestamp: new Date().toISOString(), entry: [] })
    }
    if (!/^[A-Za-z0-9\-.]{1,64}$/.test(visitId)) throw new FhirError(400, 'required', 'visitId is required.')
    const { bundle, touched } = await visitDocument(auth.db, caller, visitId)
    await logCall(admin, req, caller, caller.hospitalId, { resource_type: 'Bundle', resource_id: visitId, action: 'read', status: 'ok', result_count: bundle.entry.length, touched })
    return fhirJson(bundle)
  } catch (e) {
    const err = e instanceof FhirError ? e : new FhirError(500, 'exception', 'Unexpected server error.')
    if (!(e instanceof FhirError)) console.error('fhir-bundle failed:', e)
    await logCall(admin, req, caller, caller?.hospitalId ?? null, { resource_type: 'Bundle', resource_id: visitId || null, action: 'read', status: `error ${err.status}`, details: { message: err.message } })
    return fhirJson(operationOutcome(err.status, err.code, err.message), err.status)
  }
})
