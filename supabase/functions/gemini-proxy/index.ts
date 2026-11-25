// HMIS AI proxy (AI Clinical Assist, Antibiogram, Insurance) with automatic fallback across AI providers.
//
// Each hospital's administrator chooses providers in Settings > AI providers: keys are saved with
// hospital_secret_set (encrypted in Supabase Vault) as ai_<provider>_key, and the order / models as ai_providers.
// The providers are tried in that order; if one is busy (rate limit), out of credit, slow to start or down, the next
// one answers. A hospital with nothing set up uses the GEMINI_API_KEY server secret, as before.
//
// Unchanged: only staff linked to a hospital may use it, and identifiers are removed (redact.ts) before anything
// leaves for any AI provider.
//
// Body: Gemini format { contents, generationConfig?, systemInstruction?, model?, stream? }
//       or { action: 'ai_settings' | 'models' | 'test', hospital_id, provider?, api_key? } (administrators)
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { ALLOWED_MODELS, MAX_REQUEST_CHARS, redactContents } from './redact.ts'
import { DEFAULT_MODELS, LABELS, PROVIDERS, type Provider, answer, listModels, streamWithFallback, toAsk } from './providers.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !supabaseAnonKey || !serviceKey) return jsonResponse({ error: 'Supabase environment variables are missing' }, 500)

  const authClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } })
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error: authError } = await authClient.auth.getUser()
  if (authError || !user) return jsonResponse({ error: 'Unauthorized' }, 401)

  const rawBody = await req.text()
  if (rawBody.length > MAX_REQUEST_CHARS) return jsonResponse({ error: 'Request too large' }, 413)
  let payload: Record<string, any>
  try { payload = JSON.parse(rawBody) } catch { return jsonResponse({ error: 'Invalid JSON request body' }, 400) }

  // Only staff linked to a hospital may use the hospital's AI quota (a bare sign-up account may not).
  let linkQuery = authClient.from('hospital_users').select('hospital_id').eq('user_id', user.id)
  if (typeof payload.hospital_id === 'string' && payload.hospital_id) linkQuery = linkQuery.eq('hospital_id', payload.hospital_id)
  const { data: link } = await linkQuery.limit(1).maybeSingle()
  if (!link) return jsonResponse({ error: 'Your account is not linked to a hospital' }, 403)
  const hospitalId = String(link.hospital_id)

  const secret = async (name: string) => {
    const { data } = await admin.rpc('hospital_secret_get', { p_hospital: hospitalId, p_name: name })
    return typeof data === 'string' && data ? data : ''
  }
  const readConfig = async (): Promise<{ provider: string; enabled: boolean; model?: string }[]> => {
    try {
      const parsed = JSON.parse(await secret('ai_providers') || '[]')
      return Array.isArray(parsed) ? parsed.filter(row => (PROVIDERS as readonly string[]).includes(row?.provider)) : []
    } catch { return [] }
  }

  // ---- Settings > AI providers (hospital administrators) ------------------------------------------------------
  if (['ai_settings', 'models', 'test'].includes(String(payload.action || ''))) {
    const { data: isAdmin } = await authClient.rpc('priv_is_admin', { p_hospital: hospitalId })
    if (!isAdmin) return jsonResponse({ error: 'Only hospital administrators can manage AI providers.' }, 403)
    const config = await readConfig()

    if (payload.action === 'ai_settings') {
      const saved = await Promise.all(PROVIDERS.map(async p => [p, Boolean(await secret(`ai_${p}_key`))] as const))
      return jsonResponse({ providers: config, keys_saved: Object.fromEntries(saved), defaults: DEFAULT_MODELS })
    }

    const provider = String(payload.provider || '')
    if (!(PROVIDERS as readonly string[]).includes(provider)) return jsonResponse({ error: 'Unknown AI provider.' }, 400)
    const apiKey = String(payload.api_key || '').trim() || await secret(`ai_${provider}_key`)
    if (!apiKey && provider !== 'openrouter') return jsonResponse({ error: 'Paste the API key first.' }, 409)

    if (payload.action === 'models') {
      try { return jsonResponse({ models: await listModels(provider, apiKey) }) } catch (error) {
        return jsonResponse({ error: `${LABELS[provider]}: ${error instanceof Error ? error.message : 'could not list models'}` }, 502)
      }
    }
    // test: one provider, a tiny question, no fallback
    const model = String(payload.model || '') || config.find(row => row.provider === provider)?.model || null
    const testBody = { contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }], generationConfig: { maxOutputTokens: 50 } }
    try {
      const result = await answer([{ provider, model, api_key: apiKey }], toAsk(testBody))
      return jsonResponse({ ok: true, message: `${LABELS[provider]} answered: ${result.text.slice(0, 40)}` })
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : 'Test failed.' }, 502)
    }
  }

  // ---- A question from the app -------------------------------------------------------------------------------
  const contents = Array.isArray(payload.contents) ? payload.contents : null
  if (!contents) return jsonResponse({ error: 'Request body must include a contents array' }, 400)

  // Data minimisation: identifiers never leave for any AI provider.
  const geminiBody: Record<string, unknown> = { contents: redactContents(contents) }
  if (payload.generationConfig) geminiBody.generationConfig = payload.generationConfig
  if (payload.safetySettings) geminiBody.safetySettings = payload.safetySettings
  if (payload.systemInstruction) geminiBody.systemInstruction = redactContents([payload.systemInstruction])[0]
  if (payload.tools) geminiBody.tools = payload.tools
  const ask = toAsk(geminiBody)

  const requested = typeof payload.model === 'string' ? payload.model.trim() : ''
  const requestedGemini = ALLOWED_MODELS.has(requested) ? requested : null
  const providers: Provider[] = []
  for (const row of await readConfig()) {
    if (!row.enabled) continue
    const key = await secret(`ai_${row.provider}_key`)
    if (key) providers.push({ provider: row.provider, model: row.model || (row.provider === 'gemini' ? requestedGemini : null), api_key: key })
  }
  if (!providers.length && Deno.env.get('GEMINI_API_KEY')) providers.push({ provider: 'gemini', model: requestedGemini, api_key: Deno.env.get('GEMINI_API_KEY')! })
  if (!providers.length) return jsonResponse({ error: 'No AI provider is set up. An administrator can add one in Settings > AI providers.' }, 503)

  if (payload.stream) return streamWithFallback(providers, ask, corsHeaders)

  try {
    const result = await answer(providers, ask)
    return jsonResponse({
      candidates: [{ content: { parts: [{ text: result.text }], role: 'model' }, finishReason: 'STOP' }],
      provider: result.provider, provider_label: LABELS[result.provider], attempts: result.attempts,
    })
  } catch (error: any) {
    return jsonResponse({ error: error?.message || 'No AI provider could answer.', attempts: error?.attempts || [] }, error?.status || 503)
  }
})
