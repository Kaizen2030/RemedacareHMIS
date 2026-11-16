import { describe, expect, it } from 'vitest'
import { formatKenyanPhone, isValidMpesaCode, normalizeKenyanPhone, normalizeMpesaCode } from './phone'

describe('Kenyan phone', () => {
  it.each([
    ['0712345678', '254712345678'], ['+254 712 345 678', '254712345678'], ['254712345678', '254712345678'],
    ['712345678', '254712345678'], ['0112345678', '254112345678'], ['07 12-345-678', '254712345678'],
  ])('normalises %s', (input, out) => expect(normalizeKenyanPhone(input)).toBe(out))

  it.each(['', null, undefined, '0212345678', '07123', '25471234567890', 'abc', '+1 415 555 0100'])('rejects %s', (input) => {
    expect(normalizeKenyanPhone(input)).toBeNull()
  })

  it('formats for display', () => expect(formatKenyanPhone('254712345678')).toBe('0712 345 678'))
})

describe('M-Pesa code', () => {
  it('validates and normalises', () => {
    expect(isValidMpesaCode(' sgh7k2l9qx ')).toBe(true)
    expect(normalizeMpesaCode(' sgh7k2l9qx ')).toBe('SGH7K2L9QX')
    expect(isValidMpesaCode('SGH7K2L9Q')).toBe(false)
    expect(isValidMpesaCode('SGH7K2L9Q!')).toBe(false)
  })
})
