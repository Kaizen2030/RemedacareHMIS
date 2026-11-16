// fetch wrapper with timeout + JSON parsing. Never logs secrets.
export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 20000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const text = await res.text()
    let body: any = null
    try { body = text ? JSON.parse(text) : null } catch { body = { raw: text.slice(0, 500) } }
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Payment provider timed out')
    throw new Error('Could not reach the payment provider')
  } finally {
    clearTimeout(t)
  }
}

export function need(creds: Record<string, string>, ...keys: string[]) {
  const missing = keys.filter((k) => !creds[k])
  if (missing.length) throw new Error(`Payment provider not fully configured (missing: ${missing.join(', ')})`)
}
