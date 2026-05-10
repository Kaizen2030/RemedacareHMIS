import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

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

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400)
  }

  const contents = Array.isArray(payload.contents) ? payload.contents : null
  if (!contents) {
    return jsonResponse({ error: 'Request body must include a contents array' }, 400)
  }

  const model = typeof payload.model === 'string' && payload.model.trim()
    ? payload.model.trim()
    : DEFAULT_MODEL

  const geminiBody: Record<string, unknown> = { contents }

  if (payload.generationConfig) geminiBody.generationConfig = payload.generationConfig
  if (payload.safetySettings) geminiBody.safetySettings = payload.safetySettings
  if (payload.systemInstruction) geminiBody.systemInstruction = payload.systemInstruction
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
