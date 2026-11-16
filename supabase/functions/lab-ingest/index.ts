import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { validateLabPayload } from '../_shared/labIngestValidation.ts'

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-api-key, authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}
const MAX_BODY_BYTES = 1_000_000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, 'Content-Type': 'application/json' } })
}

function apiKeyFrom(req: Request) {
  const header = req.headers.get('x-api-key') || ''
  if (header.startsWith('rcl_')) return header
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  return bearer.startsWith('rcl_') ? bearer : ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: HEADERS })
  if (req.method !== 'POST') return json({ success: false, message: 'Use POST for analyser results.' }, 405)

  const key = apiKeyFrom(req)
  if (!/^rcl_[a-f0-9]{64}$/i.test(key)) return json({ success: false, message: 'A valid analyser API key is required.' }, 401)

  const contentLength = Number(req.headers.get('Content-Length') || 0)
  if (contentLength > MAX_BODY_BYTES) return json({ success: false, message: 'Request is too large.' }, 413)

  let body: string
  try {
    body = await req.text()
  } catch {
    return json({ success: false, message: 'Could not read the request body.' }, 400)
  }
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return json({ success: false, message: 'Request is too large.' }, 413)

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return json({ success: false, message: 'Request body must be valid JSON.' }, 400)
  }
  const validation = validateLabPayload(parsed)
  if (!validation.ok) return json({ success: false, message: validation.message }, 400)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) {
    console.error('lab-ingest is missing its Supabase service configuration.')
    return json({ success: false, message: 'Analyser ingestion is not configured.' }, 503)
  }

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await admin.rpc('lab_instrument_ingest', { p_key: key, p_payload: validation.payload })
    if (error) {
      if (/unknown or revoked analyser key/i.test(error.message)) return json({ success: false, message: 'Unknown or revoked analyser key.' }, 401)
      console.error('lab-ingest database call failed:', error.message)
      return json({ success: false, message: 'Could not save analyser results.' }, 500)
    }
    return json({ success: true, ...((data && typeof data === 'object') ? data : {}) })
  } catch (error) {
    console.error('lab-ingest request failed:', error)
    return json({ success: false, message: 'Could not save analyser results.' }, 500)
  }
})
