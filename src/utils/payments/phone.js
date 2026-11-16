// Kenyan phone + M-Pesa reference helpers (mirrors supabase/functions/_shared/phone.ts).

/** → '2547XXXXXXXX' / '2541XXXXXXXX', or null when it is not a valid Kenyan mobile. */
export function normalizeKenyanPhone(input) {
  let n = String(input ?? '').replace(/[^\d]/g, '')
  if (n.startsWith('254')) n = n.slice(3)
  else if (n.startsWith('0')) n = n.slice(1)
  return /^[17]\d{8}$/.test(n) ? `254${n}` : null
}

export function formatKenyanPhone(input) {
  const n = normalizeKenyanPhone(input)
  return n ? `0${n.slice(3, 6)} ${n.slice(6, 9)} ${n.slice(9)}` : String(input || '')
}

/** M-Pesa confirmation codes are 10 uppercase letters/digits, e.g. SGH7K2L9QX. */
export const normalizeMpesaCode = (code) => String(code || '').trim().toUpperCase()
export const isValidMpesaCode = (code) => /^[A-Z0-9]{10}$/.test(normalizeMpesaCode(code))
