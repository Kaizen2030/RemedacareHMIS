// AI providers for the HMIS assistant, with automatic fallback. Every request is already redacted (redact.ts)
// before it reaches this file. Gemini receives the original Gemini-format body; the others receive the same
// question as plain text (+ photo where the provider can read photos).
// deno-lint-ignore-file no-explicit-any
import Anthropic from 'npm:@anthropic-ai/sdk'

export const PROVIDERS = ['gemini', 'claude', 'openai', 'grok', 'deepseek', 'groq', 'mistral', 'openrouter'] as const
export const LABELS: Record<string, string> = {
  gemini: 'Gemini', claude: 'Claude', openai: 'ChatGPT', grok: 'Grok', deepseek: 'DeepSeek', groq: 'Groq', mistral: 'Mistral', openrouter: 'OpenRouter',
}
export const OPENAI_STYLE: Record<string, { url: string; model: string; vision: boolean }> = {
  openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini', vision: true },
  grok: { url: 'https://api.x.ai/v1/chat/completions', model: 'grok-3-mini', vision: false },
  deepseek: { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', vision: false },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', vision: false },
  mistral: { url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest', vision: false },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openrouter/auto', vision: true },
}
export const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-2.5-flash-lite',
  claude: 'claude-opus-5-5',
  ...Object.fromEntries(Object.entries(OPENAI_STYLE).map(([k, v]) => [k, v.model])),
}

const FIRST_TEXT_TIMEOUT_MS = 20_000         // Gemini, ChatGPT and the others must start answering within this
const CLAUDE_FIRST_TEXT_TIMEOUT_MS = 45_000  // Claude thinks before writing, so it gets longer
const IDLE_TIMEOUT_MS = 45_000               // a provider that goes silent mid-answer is replaced
const CLAUDE_EFFORT = 'high'                 // clinical answers must be right

export type Provider = { provider: string; model?: string | null; api_key: string }
// geminiBody: the redacted Gemini request. text/images: the same question for the other providers.
export type Ask = { geminiBody: Record<string, any>; text: string; images: { mimeType: string; data: string }[]; maxTokens: number; json: boolean }
export type Emit = (event: Record<string, unknown>) => void

export class ProviderFailure extends Error {
  constructor(message: string, public status = 0) { super(message) }
}

/** Build the provider-neutral question from a Gemini-format body. */
export function toAsk(geminiBody: Record<string, any>): Ask {
  const texts: string[] = []
  const images: { mimeType: string; data: string }[] = []
  for (const part of geminiBody.systemInstruction?.parts || []) if (typeof part?.text === 'string') texts.push(part.text)
  for (const content of geminiBody.contents || []) {
    for (const part of content?.parts || []) {
      if (typeof part?.text === 'string') texts.push(part.text)
      else if (part?.inlineData?.data) images.push({ mimeType: part.inlineData.mimeType || 'image/jpeg', data: part.inlineData.data })
    }
  }
  const json = /json/i.test(String(geminiBody.generationConfig?.responseMimeType || ''))
  if (json) texts.push('Reply with valid JSON only: no markdown, no code fences, no text before or after the JSON.')
  return { geminiBody, text: texts.join('\n\n'), images, maxTokens: Number(geminiBody.generationConfig?.maxOutputTokens) || 4096, json }
}

// ---------------------------------------------------------------------------------------------------------------
// Server-Sent Events reader with first-words and silence time limits
// ---------------------------------------------------------------------------------------------------------------
async function* sseData(response: Response, controller: AbortController, firstMs = FIRST_TEXT_TIMEOUT_MS): AsyncGenerator<string> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let idle = setTimeout(() => controller.abort(), firstMs)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      clearTimeout(idle)
      idle = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS)
      buffer += decoder.decode(value, { stream: true })
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('data:')) yield line.slice(5).trim()
      }
    }
    if (buffer.startsWith('data:')) yield buffer.slice(5).trim()
  } finally { clearTimeout(idle) }
}

async function openStream(url: string, init: RequestInit, controller: AbortController): Promise<Response> {
  const first = setTimeout(() => controller.abort(), FIRST_TEXT_TIMEOUT_MS)
  let response: Response
  try { response = await fetch(url, { ...init, signal: controller.signal }) } catch { throw new ProviderFailure('took too long to answer', 504) } finally { clearTimeout(first) }
  if (!response.ok) {
    const data: any = await response.json().catch(() => ({}))
    throw new ProviderFailure(`${response.status} ${data?.error?.message || data?.message || 'request failed'}`.slice(0, 200), response.status)
  }
  return response
}

// ---------------------------------------------------------------------------------------------------------------
// Streaming per provider. Each returns the number of characters written; throws ProviderFailure.
// ---------------------------------------------------------------------------------------------------------------
async function streamGemini(p: Provider, ask: Ask, emit: Emit): Promise<number> {
  const controller = new AbortController()
  const response = await openStream(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model || DEFAULT_MODELS.gemini)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(p.api_key)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ask.geminiBody) }, controller)
  let chars = 0, reason = ''
  try {
    for await (const data of sseData(response, controller)) {
      const chunk: any = JSON.parse(data)
      if (chunk?.error) throw new ProviderFailure(String(chunk.error.message || 'stream error').slice(0, 200), Number(chunk.error.code) || 0)
      reason = chunk?.promptFeedback?.blockReason || chunk?.candidates?.[0]?.finishReason || reason
      const text = (chunk?.candidates?.[0]?.content?.parts || []).map((part: any) => part?.text || '').join('')
      if (text) { chars += text.length; emit({ type: 'delta', text }) }
    }
  } catch (error) {
    if (error instanceof ProviderFailure) throw error
    throw new ProviderFailure(controller.signal.aborted ? 'stopped answering' : 'stream broke off')
  }
  if (!chars) throw new ProviderFailure(`gave no answer (${reason || 'empty'})`)
  return chars
}

async function streamClaude(p: Provider, ask: Ask, emit: Emit): Promise<number> {
  const client = new Anthropic({ apiKey: p.api_key, maxRetries: 0, timeout: 10 * 60_000 })
  const content: any[] = ask.images.map(image => ({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } }))
  content.push({ type: 'text', text: ask.text })
  const controller = new AbortController()
  const firstText = setTimeout(() => controller.abort(), CLAUDE_FIRST_TEXT_TIMEOUT_MS)
  let chars = 0
  try {
    const stream: any = client.beta.messages.stream({
      model: p.model || DEFAULT_MODELS.claude,
      max_tokens: Math.max(16000, ask.maxTokens), // thinking counts toward max_tokens on this model
      output_config: { effort: CLAUDE_EFFORT },
      // If Claude's safety check declines a professional clinical question, the API retries it on a fallback Claude model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content }],
    } as any, { signal: controller.signal })
    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block?.type === 'fallback') {
        if (chars) { emit({ type: 'reset' }); chars = 0 }
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        clearTimeout(firstText)
        chars += event.delta.text.length
        emit({ type: 'delta', text: event.delta.text })
      }
    }
    const final: any = await stream.finalMessage()
    if (final?.stop_reason === 'refusal' && !chars) throw new ProviderFailure('declined to answer')
  } catch (error) {
    if (error instanceof ProviderFailure) throw error
    if (controller.signal.aborted) throw new ProviderFailure('took too long to start answering', 504)
    if (error instanceof Anthropic.APIError) throw new ProviderFailure(`${error.status ?? ''} ${error.message}`.trim().slice(0, 200), Number(error.status) || 0)
    throw new ProviderFailure(error instanceof Error ? error.message : 'stream broke off')
  } finally { clearTimeout(firstText) }
  if (!chars) throw new ProviderFailure('gave no answer')
  return chars
}

async function streamOpenAiStyle(p: Provider, ask: Ask, emit: Emit): Promise<number> {
  const spec = OPENAI_STYLE[p.provider]
  if (ask.images.length && !spec.vision && !p.model) throw new ProviderFailure('cannot read photos')
  const content: any = ask.images.length
    ? [{ type: 'text', text: ask.text }, ...ask.images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }))]
    : ask.text
  const controller = new AbortController()
  const response = await openStream(spec.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: p.model || spec.model, max_tokens: Math.max(ask.maxTokens, 1024), stream: true, messages: [{ role: 'user', content }] }),
  }, controller)
  let chars = 0
  try {
    for await (const data of sseData(response, controller)) {
      if (data === '[DONE]') break
      const chunk: any = JSON.parse(data)
      if (chunk?.error) throw new ProviderFailure(String(chunk.error.message || 'stream error').slice(0, 200))
      const text = chunk?.choices?.[0]?.delta?.content
      if (typeof text === 'string' && text) { chars += text.length; emit({ type: 'delta', text }) }
    }
  } catch (error) {
    if (error instanceof ProviderFailure) throw error
    throw new ProviderFailure(controller.signal.aborted ? 'stopped answering' : 'stream broke off')
  }
  if (!chars) throw new ProviderFailure('gave no answer')
  return chars
}

export function streamProvider(p: Provider, ask: Ask, emit: Emit) {
  if (p.provider === 'gemini') return streamGemini(p, ask, emit)
  if (p.provider === 'claude') return streamClaude(p, ask, emit)
  if (OPENAI_STYLE[p.provider]) return streamOpenAiStyle(p, ask, emit)
  throw new ProviderFailure('unknown provider')
}

/** Whole answer from the first provider that succeeds (collects the stream). */
export async function answer(providers: Provider[], ask: Ask): Promise<{ text: string; provider: string; attempts: { provider: string; error: string }[] }> {
  const attempts: { provider: string; error: string }[] = []
  for (const p of providers) {
    let text = ''
    try {
      await streamProvider(p, ask, event => {
        if (event.type === 'delta') text += String(event.text)
        else if (event.type === 'reset') text = ''
      })
      if (ask.json) text = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi, '')
      return { text: text.trim(), provider: p.provider, attempts }
    } catch (error) {
      attempts.push({ provider: p.provider, error: error instanceof Error ? error.message : 'failed' })
      console.error(`AI provider ${p.provider} failed:`, attempts[attempts.length - 1].error)
    }
  }
  throw Object.assign(new Error(summarise(attempts)), { attempts, status: allBusy(attempts) ? 429 : 503 })
}

const allBusy = (attempts: { error: string }[]) => attempts.length > 0 && attempts.every(a => /^429|rate|quota|exceeded/i.test(a.error))
export function summarise(attempts: { provider: string; error: string }[]) {
  return `${allBusy(attempts) ? 'All AI providers are busy (rate limit)' : 'No AI provider could answer'}: ` +
    attempts.map(a => `${LABELS[a.provider] || a.provider} - ${a.error}`).join('; ')
}

/** Streaming response for the app: provider / delta / reset / done / error events. */
export function streamWithFallback(providers: Provider[], ask: Ask, headers: Record<string, string>): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    async start(controller) {
      const emit: Emit = event => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(': keep-alive\n\n')), 15_000)
      const attempts: { provider: string; error: string }[] = []
      try {
        for (const p of providers) {
          emit({ type: 'provider', provider: p.provider, label: LABELS[p.provider] })
          let wrote = false
          try {
            await streamProvider(p, ask, event => { if (event.type === 'delta') wrote = true; emit(event) })
            emit({ type: 'done', provider: p.provider, label: LABELS[p.provider] })
            return
          } catch (error) {
            const message = error instanceof Error ? error.message : 'failed'
            console.error(`AI provider ${p.provider} failed while streaming:`, message)
            attempts.push({ provider: p.provider, error: message })
            if (wrote) emit({ type: 'reset' })
          }
        }
        emit({ type: 'error', status: allBusy(attempts) ? 429 : 503, error: summarise(attempts), attempts })
      } finally {
        clearInterval(heartbeat)
        controller.close()
      }
    },
  })
  return new Response(body, { headers: { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}

// ---------------------------------------------------------------------------------------------------------------
// Model lists for the Settings dropdown (the provider's own list for this key)
// ---------------------------------------------------------------------------------------------------------------
const NOT_CHAT = /embed|tts|whisper|transcri|dall-e|image|moderation|realtime|audio|search|computer-use|babbage|davinci|guard|ocr/i

export async function listModels(provider: string, apiKey: string): Promise<{ id: string; name?: string }[]> {
  if (provider === 'gemini') {
    const models: any[] = []
    let pageToken = ''
    do {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}${pageToken ? `&pageToken=${pageToken}` : ''}`)
      const data: any = await response.json().catch(() => ({}))
      if (!response.ok) throw new ProviderFailure(`${response.status} ${data?.error?.message || 'request failed'}`, response.status)
      models.push(...(data.models || []))
      pageToken = data.nextPageToken || ''
    } while (pageToken)
    return models.filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && !NOT_CHAT.test(m.name))
      .map(m => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName }))
  }
  if (provider === 'claude') {
    const client = new Anthropic({ apiKey, maxRetries: 1 })
    const models: { id: string; name?: string }[] = []
    try {
      for await (const model of client.models.list()) models.push({ id: model.id, name: model.display_name })
    } catch (error) {
      if (error instanceof Anthropic.APIError) throw new ProviderFailure(`${error.status ?? ''} ${error.message}`.trim(), Number(error.status) || 0)
      throw error
    }
    return models
  }
  const spec = OPENAI_STYLE[provider]
  if (!spec) throw new ProviderFailure('unknown provider')
  const response = await fetch(spec.url.replace(/\/chat\/completions$/, '/models'), { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} })
  const data: any = await response.json().catch(() => ({}))
  if (!response.ok) throw new ProviderFailure(`${response.status} ${data?.error?.message || data?.message || 'request failed'}`, response.status)
  return (data.data || []).filter((m: any) => m?.id && !NOT_CHAT.test(m.id))
    .sort((a: any, b: any) => (Number(b.created) || 0) - (Number(a.created) || 0))
    .map((m: any) => ({ id: String(m.id), name: m.name }))
}
