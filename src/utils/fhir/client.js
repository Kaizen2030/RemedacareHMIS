import supabase from '../../supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export function buildFunctionUrl(functionName, params = {}) {
  const url = new URL(`/functions/v1/${functionName}`, SUPABASE_URL)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  return url.toString()
}

export async function fetchFhirBundle({ hospitalId, visitId }) {
  if (!hospitalId || !visitId) {
    throw new Error('Hospital and visit are required to export a FHIR bundle.')
  }

  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError

  const response = await fetch(buildFunctionUrl('fhir-bundle', { hospitalId, visitId }), {
    headers: {
      Accept: 'application/fhir+json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
    },
  })

  const responseText = await response.text()
  let payload
  try {
    payload = responseText ? JSON.parse(responseText) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message = payload?.issue?.[0]?.diagnostics || payload?.message || `FHIR bundle request failed (${response.status}).`
    throw new Error(message)
  }

  if (!payload) throw new Error('FHIR bundle endpoint returned an empty response.')
  return payload
}