// RemedacareHMS FHIR R4 read API.
//   GET /functions/v1/fhir/metadata                      CapabilityStatement (no key needed)
//   GET /functions/v1/fhir/Patient?identifier=…|name=…   search
//   GET /functions/v1/fhir/Patient/<id>                   read
//   GET /functions/v1/fhir/Patient/<id>/$everything       the patient's record
//   GET /functions/v1/fhir/<Encounter|Observation|Condition|MedicationRequest|DiagnosticReport|Immunization>?patient=<id>
// Read-only. Every call is logged (fhir_audit_log) and every patient returned is written to patient_access_log.
import {
  canRead, capabilityStatement, FhirError, operationOutcome, parsePath, parseSearch, patientEverything, runQuery, searchSet,
  type Caller, type ResourceType,
} from '../_shared/fhirCore.ts'
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
  if (req.method !== 'GET') return fhirJson(operationOutcome(405, 'not-supported', 'This API is read-only (GET).'), 405)

  const url = new URL(req.url)
  // The public base URL clients should use (Supabase forwards to /<function>/…)
  const base = `${Deno.env.get('SUPABASE_URL') || url.origin}/functions/v1/fhir`
  const admin = serviceClient()
  let caller: Caller | null = null
  let route = { type: null as string | null, id: null as string | null, operation: null as string | null }

  try {
    route = parsePath(url.pathname)
    if (!route.type || route.type === 'metadata') return fhirJson(capabilityStatement(base))

    const auth = await authenticate(req, admin, url)
    caller = auth.caller
    const type = route.type as ResourceType
    if (!canRead(caller, type)) {
      throw new FhirError(403, 'forbidden', caller.kind === 'client'
        ? `This API key is not allowed to read ${type}. An administrator can change it in Settings → FHIR API.`
        : `Your role cannot read ${type} records.`)
    }

    const selfUrl = `${base}/${route.type}${route.id ? `/${route.id}` : ''}${route.operation ? `/${route.operation}` : ''}${url.search}`
    if (route.operation === '$everything') {
      const r = await patientEverything(auth.db, caller, String(route.id))
      await logCall(admin, req, caller, caller.hospitalId, { resource_type: 'Patient', resource_id: route.id, action: 'everything', status: 'ok', result_count: r.resources.length, touched: r.touched })
      const bundle = searchSet(r.resources, base, selfUrl, { patient: null, identifier: null, name: null, date: {}, category: null, count: r.resources.length || 1, offset: 0 })
      return fhirJson(bundle)
    }

    const search = parseSearch(type, route.id ? new URLSearchParams() : url.searchParams)
    const r = await runQuery(auth.db, caller, type, route.id, search)
    await logCall(admin, req, caller, caller.hospitalId, {
      resource_type: type, resource_id: route.id, action: route.id ? 'read' : 'search', status: 'ok',
      result_count: r.resources.length, touched: r.touched, query: route.id ? undefined : url.search.slice(0, 500),
    })
    return route.id ? fhirJson(r.resources[0]) : fhirJson(searchSet(r.resources, base, selfUrl, search, r.total))
  } catch (e) {
    const err = e instanceof FhirError ? e : new FhirError(500, 'exception', 'Unexpected server error.')
    if (!(e instanceof FhirError)) console.error('fhir failed:', e)
    await logCall(admin, req, caller, caller?.hospitalId ?? null, {
      resource_type: route.type, resource_id: route.id, action: route.id ? 'read' : 'search', status: `error ${err.status}`, details: { message: err.message },
    })
    return fhirJson(operationOutcome(err.status, err.code, err.message), err.status)
  }
})
