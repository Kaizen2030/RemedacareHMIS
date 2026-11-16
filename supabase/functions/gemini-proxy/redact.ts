// Strip direct identifiers from text before it is sent to an external AI service (Data Protection Act:
// data minimisation). Clinical content stays; phone numbers, e-mails, ID / passport / NHIF / SHA numbers,
// M-Pesa codes and patient numbers are replaced with placeholders. Names cannot be removed reliably from
// free text — screens must not put the patient's name in AI prompts.

const RULES: Array<[RegExp, string]> = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  [/(?:\+?254|0)\s?[17]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g, '[phone]'],
  [/\b(?:id|i\.d\.|national id|passport|nhif|sha|cr|ccc|mrn|ip|op|patient)\s*(?:no\.?|number|#)?\s*[:#-]?\s*[A-Z0-9/-]{5,}\b/gi, '[identifier]'],
  [/\b(?=[A-Z0-9]{10}\b)(?=[A-Z]*\d)[A-Z]{2}[A-Z0-9]{8}\b/g, '[code]'],   // M-Pesa style codes (must contain a digit)
]

export function redactText(text: string): string {
  let out = String(text ?? '')
  for (const [re, label] of RULES) out = out.replace(re, label)
  return out
}

/** Redacts every text part of a Gemini `contents` array; inline files (images) are passed unchanged. */
export function redactContents(contents: unknown[]): unknown[] {
  return (contents || []).map((c: any) => (c && Array.isArray(c.parts)
    ? { ...c, parts: c.parts.map((p: any) => (typeof p?.text === 'string' ? { ...p, text: redactText(p.text) } : p)) }
    : c))
}

export const ALLOWED_MODELS = new Set(['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'])
export const MAX_REQUEST_CHARS = 200_000
