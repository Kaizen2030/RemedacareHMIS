import supabase from '../supabase'

const DEFAULT_MODEL = 'gemini-2.5-flash-lite'

async function readProxyError(error) {
  if (!error) return 'Failed to reach the Gemini proxy.'

  if (error.context && typeof error.context.text === 'function') {
    const raw = await error.context.text()

    try {
      const parsed = JSON.parse(raw)
      return parsed?.error || parsed?.message || raw || error.message
    } catch {
      return raw || error.message
    }
  }

  return error.message || 'Failed to reach the Gemini proxy.'
}

export async function generateGeminiContent({
  model = DEFAULT_MODEL,
  contents,
  generationConfig,
  safetySettings,
  systemInstruction,
  tools,
}) {
  const body = { model, contents }

  if (generationConfig) body.generationConfig = generationConfig
  if (safetySettings) body.safetySettings = safetySettings
  if (systemInstruction) body.systemInstruction = systemInstruction
  if (tools) body.tools = tools

  const { data, error } = await supabase.functions.invoke('gemini-proxy', { body })

  if (error) {
    throw new Error(friendlyAiError(await readProxyError(error)))
  }

  if (!data) {
    throw new Error('Gemini proxy returned an empty response.')
  }

  return data
}

function friendlyAiError(message) {
  const text = String(message || '')
  if (/No AI provider is set up|GEMINI_API_KEY/i.test(text)) return 'No AI provider is set up yet. An administrator can add one in Settings > AI providers.'
  if (/All AI providers are busy/i.test(text)) return 'Every AI provider that is switched on is busy right now (rate limit). Wait about a minute and ask again, or add another provider in Settings > AI providers.'
  if (/failed to fetch|network/i.test(text)) return 'Could not reach the AI. Check your internet connection and try again.'
  return text || 'Failed to connect to AI.'
}

/**
 * Same request as generateGeminiContent, but the answer arrives word by word. The server tries each AI provider the
 * hospital switched on (Gemini, Claude, ChatGPT...) and moves to the next if one is busy, slow to start or fails.
 * onUpdate(text, providerLabel) runs as words arrive ('' when a provider starts over). Resolves { text, provider }.
 */
export async function streamGeminiContent({ model = DEFAULT_MODEL, contents, generationConfig, systemInstruction, hospitalId }, onUpdate = () => {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) throw new Error('Your session has expired. Sign in again to use the AI.')
    const body = { model, contents, stream: true }
    if (generationConfig) body.generationConfig = generationConfig
    if (systemInstruction) body.systemInstruction = systemInstruction
    if (hospitalId) body.hospital_id = hospitalId

    let response
    try {
      response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-proxy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new Error(friendlyAiError(error?.message || 'network'))
    }
    if (!response.ok || !response.body) {
      let message = `AI error ${response.status}`
      try { const parsed = await response.json(); message = parsed?.error || message } catch { /* not JSON */ }
      throw new Error(friendlyAiError(message))
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = '', text = '', label = '', finished = false, failure = ''
    while (!finished) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let split
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)
        const line = block.split('\n').find((row) => row.startsWith('data:'))
        if (!line) continue
        let event
        try { event = JSON.parse(line.slice(5)) } catch { continue }
        if (event.type === 'provider') { label = event.label || label; onUpdate(text, label) }
        else if (event.type === 'delta') { text += event.text; onUpdate(text, label) }
        else if (event.type === 'reset') { text = ''; onUpdate('', label) }
        else if (event.type === 'done') { finished = true; label = event.label || label }
        else if (event.type === 'error') { failure = event.error || 'No AI provider could answer.'; finished = true }
      }
    }
    if (failure) {
      if (!text && attempt === 0 && /busy|rate/i.test(failure)) { await new Promise((resolve) => setTimeout(resolve, 5000)); continue }
      throw new Error(friendlyAiError(failure))
    }
    if (!text.trim()) throw new Error('I could not generate a response. Please ask again.')
    return { text: text.trim(), provider: label }
  }
  throw new Error(friendlyAiError('All AI providers are busy'))
}

export function extractGeminiText(data, separator = ' ') {
  return data?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || '')
    .filter(Boolean)
    .join(separator) || ''
}
