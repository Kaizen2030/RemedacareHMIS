import { describe, expect, it } from 'vitest'
import { ALLOWED_MODELS, redactContents, redactText } from '../functions/gemini-proxy/redact.ts'

describe('AI prompt redaction', () => {
  it('removes phone numbers, e-mails, ID numbers and transaction codes but keeps clinical content', () => {
    const text = 'Patient no: OP-2026-00451, phone 0712 345 678 or +254 733-111-222, email jane@mail.co.ke, ID 23456789, paid SGH7K2L9QX. BP 150/95, Hb 9.8, on TDF/3TC/DTG.'
    const out = redactText(text)
    expect(out).not.toMatch(/0712|733|jane@|23456789|SGH7K2L9QX|OP-2026-00451/)
    expect(out).toMatch(/BP 150\/95, Hb 9\.8, on TDF\/3TC\/DTG/)
    expect(out).toContain('[phone]')
    expect(out).toContain('[email]')
  })
  it('redacts text parts of every message and leaves images alone', () => {
    const contents = [{ role: 'user', parts: [{ text: 'Call 0722000111' }, { inlineData: { mimeType: 'image/png', data: 'AAA' } }] }]
    const [c] = redactContents(contents) as any[]
    expect(c.parts[0].text).toBe('Call [phone]')
    expect(c.parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: 'AAA' } })
  })
  it('only known models are allowed', () => {
    expect(ALLOWED_MODELS.has('gemini-2.5-flash-lite')).toBe(true)
    expect(ALLOWED_MODELS.has('gemini-ultra-expensive')).toBe(false)
  })
})

describe('redaction keeps clinical numbers and words', () => {
  it('does not touch viral loads, counts or upper-case drug names', () => {
    expect(redactText('VL 1200000 copies/ml, platelets 250000, PARACETAMOL, AMOXICILLIN 500mg')).toBe('VL 1200000 copies/ml, platelets 250000, PARACETAMOL, AMOXICILLIN 500mg')
  })
})
