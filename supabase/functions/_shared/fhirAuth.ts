// Who is calling the FHIR API, and with which database client.
//   * Outside systems: an API key from Settings → FHIR API (Authorization: Bearer rcf_… or X-API-Key). The key is
//     checked by fhir_client_by_key (hash lookup, active, not expired); queries use the service client but are always
//     filtered to the key's hospital and resource scopes.
//   * Staff apps: the signed-in user's token plus ?hospital=<id>. Queries run as that user, so row-level security
//     applies on top of the hospital filter. Clinical resources need a clinical role (clin_can_access).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { CLINICAL_TYPES, FhirError, RESOURCE_TYPES, type Caller } from './fhirCore.ts'

const URL_ = () => Deno.env.get('SUPABASE_URL') || ''

export function serviceClient() {
  return createClient(URL_(), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false, autoRefreshToken: false } })
}

export function apiKeyFrom(req: Request) {
  const header = req.headers.get('x-api-key') || ''
  if (header.startsWith('rcf_')) return header
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  return bearer.startsWith('rcf_') ? bearer : null
}

// deno-lint-ignore no-explicit-any
export async function authenticate(req: Request, admin: any, url: URL): Promise<{ caller: Caller, db: any }> {
  const key = apiKeyFrom(req)
  if (key) {
    const { data, error } = await admin.rpc('fhir_client_by_key', { p_key: key })
    if (error) throw new FhirError(500, 'exception', 'Could not check the API key.')
    const client = Array.isArray(data) ? data[0] : data
    if (!client) throw new FhirError(401, 'login', 'Unknown, revoked or expired API key.')
    return {
      db: admin,
      caller: {
        kind: 'client', hospitalId: String(client.hospital_id), scopes: client.scopes || [], allowConfidential: Boolean(client.allow_confidential),
        clientId: client.id, name: client.name,
      },
    }
  }

  const authz = req.headers.get('Authorization') || ''
  if (!/^Bearer\s+\S+/i.test(authz)) throw new FhirError(401, 'login', 'Send an API key (Authorization: Bearer rcf_…) or a RemedacareHMS sign-in token.')
  const userDb = createClient(URL_(), Deno.env.get('SUPABASE_ANON_KEY') || '', {
    global: { headers: { Authorization: authz } }, auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: u, error: ue } = await userDb.auth.getUser()
  if (ue || !u?.user) throw new FhirError(401, 'login', 'Your sign-in has expired. Sign in again.')
  const hospitalId = url.searchParams.get('hospital') || url.searchParams.get('hospitalId') || req.headers.get('x-hospital-id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(hospitalId)) throw new FhirError(400, 'required', 'Add ?hospital=<your hospital id>.')
  const [member, clinical, isAdmin] = await Promise.all([
    userDb.rpc('pay_is_member', { p_hospital: hospitalId }),
    userDb.rpc('clin_can_access', { p_hospital: hospitalId }),
    userDb.rpc('priv_is_admin', { p_hospital: hospitalId }),
  ])
  if (!member.data) throw new FhirError(403, 'forbidden', 'You do not belong to this hospital.')
  const scopes = clinical.data ? [...RESOURCE_TYPES] : RESOURCE_TYPES.filter((t) => !CLINICAL_TYPES.includes(t))
  return {
    db: userDb,
    caller: { kind: 'user', hospitalId, scopes, allowConfidential: Boolean(isAdmin.data), userId: u.user.id, name: u.user.email || u.user.id },
  }
}

export function callerIp(req: Request) {
  return (req.headers.get('x-forwarded-for') || '').split(',').map((v) => v.trim()).find(Boolean) || req.headers.get('x-real-ip') || ''
}

/** Call log + patient access log. Never throws: logging problems must not hide the answer, but they are reported. */
// deno-lint-ignore no-explicit-any
export async function logCall(admin: any, req: Request, caller: Caller | null, hospitalId: string | null, entry: {
  resource_type: string | null, resource_id: string | null, action: string, status: string, result_count?: number, details?: unknown, touched?: string[], query?: string,
}) {
  try {
    await admin.from('fhir_audit_log').insert({
      hospital_id: hospitalId, resource_type: entry.resource_type, resource_id: entry.resource_id, action: entry.action, status: entry.status,
      caller_ip: callerIp(req), details: entry.details ?? null, result_count: entry.result_count ?? null, query: entry.query ?? null,
      client_id: caller?.clientId ?? null, client_name: caller?.kind === 'client' ? caller.name : null, user_id: caller?.userId ?? null,
    })
    const touched = (entry.touched || []).slice(0, 100)
    if (caller && hospitalId && touched.length) {
      await admin.from('patient_access_log').insert(touched.map((patient_id) => ({
        hospital_id: hospitalId, patient_id, action: 'export', context: `FHIR API ${entry.resource_type || ''}`.trim(),
        user_id: caller.userId ?? null, user_email: caller.kind === 'user' ? caller.name : null,
        api_client_id: caller.clientId ?? null, api_client_name: caller.kind === 'client' ? caller.name : null,
      })))
    }
  } catch (e) {
    console.error('FHIR audit logging failed:', e)
  }
}
