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
    throw new Error(await readProxyError(error))
  }

  if (!data) {
    throw new Error('Gemini proxy returned an empty response.')
  }

  return data
}

export function extractGeminiText(data, separator = ' ') {
  return data?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || '')
    .filter(Boolean)
    .join(separator) || ''
}
