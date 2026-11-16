// HMAC / constant-time helpers (Web Crypto, no dependencies).
const enc = new TextEncoder()

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hmacHex(algo: 'SHA-256' | 'SHA-512', secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: algo }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

export function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Signed token embedded in callback URLs for gateways that do not sign callbacks (Daraja). */
export async function signPaymentToken(paymentId: string) {
  const secret = Deno.env.get('PAYMENTS_WEBHOOK_SECRET')
  if (!secret || secret.length < 24) {
    throw new Error('PAYMENTS_WEBHOOK_SECRET must be set (min 24 chars)')
  }
  return (await hmacHex('SHA-256', secret, `payment:${paymentId}`)).slice(0, 40)
}

export async function verifyPaymentToken(paymentId: string, token: string) {
  try {
    return timingSafeEqual(await signPaymentToken(paymentId), token || '')
  } catch {
    return false
  }
}
