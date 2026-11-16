import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { ALLOWED_MODELS, MAX_REQUEST_CHARS, redactContents, redactText } from './redact.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DEFAULT_MODEL = 'gemini-2.5-flash-lite'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY')

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: 'Supabase environment variables are missing' }, 500)
  }

  if (!geminiApiKey) {
    return jsonResponse({ error: 'GEMINI_API_KEY secret is not configured' }, 500)
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  })

  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser()

  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  // Only staff linked to a hospital may use the hospital's AI quota (a bare sign-up account may not).
  const { data: link } = await authClient.from('hospital_users').select('hospital_id').eq('user_id', user.id).limit(1).maybeSingle()
  if (!link) {
    return jsonResponse({ error: 'Your account is not linked to a hospital' }, 403)
  }

  const rawBody = await req.text()
  if (rawBody.length > MAX_REQUEST_CHARS) {
    return jsonResponse({ error: 'Request too large' }, 413)
  }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400)
  }

  const contents = Array.isArray(payload.contents) ? payload.contents : null
  if (!contents) {
    return jsonResponse({ error: 'Request body must include a contents array' }, 400)
  }

  const requested = typeof payload.model === 'string' ? payload.model.trim() : ''
  const model = ALLOWED_MODELS.has(requested) ? requested : DEFAULT_MODEL

  // Data minimisation: identifiers never leave for the AI provider.
  const geminiBody: Record<string, unknown> = { contents: redactContents(contents) }

  if (payload.generationConfig) geminiBody.generationConfig = payload.generationConfig
  if (payload.safetySettings) geminiBody.safetySettings = payload.safetySettings
  if (payload.systemInstruction) geminiBody.systemInstruction = redactContents([payload.systemInstruction])[0]
  if (payload.tools) geminiBody.tools = payload.tools

  const geminiResponse = await fetch(
    `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiBody),
    },
  )

  const raw = await geminiResponse.text()

  return new Response(raw, {
    status: geminiResponse.status,
    headers: {
      ...corsHeaders,
      'Content-Type': geminiResponse.headers.get('content-type') || 'application/json',
    },
  })
})
