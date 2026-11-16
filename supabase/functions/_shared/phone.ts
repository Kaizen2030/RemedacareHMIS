/** Normalise Kenyan numbers to 2547XXXXXXXX / 2541XXXXXXXX (what Daraja expects). */
export function normalizeKenyanPhone(input: string | null | undefined): string | null {
  const digits = String(input ?? '').replace(/[^\d]/g, '')
  let n = digits
  if (n.startsWith('254')) n = n.slice(3)
  else if (n.startsWith('0')) n = n.slice(1)
  if (!/^[17]\d{8}$/.test(n)) return null
  return '254' + n
}
