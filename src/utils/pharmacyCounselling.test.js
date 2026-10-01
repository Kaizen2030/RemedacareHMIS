import { describe, expect, it } from 'vitest'
import { formatKenyanPhoneForWhatsApp, getDrugCounselling } from './pharmacyCounselling'

describe('pharmacy counselling helpers', () => {
  it('normalizes common Kenyan mobile number formats', () => {
    expect(formatKenyanPhoneForWhatsApp('0712 345 678')).toBe('254712345678')
    expect(formatKenyanPhoneForWhatsApp('+254 712 345 678')).toBe('254712345678')
    expect(formatKenyanPhoneForWhatsApp('invalid')).toBe('')
  })

  it('returns bilingual counselling and preserves the prescribed directions', () => {
    const counselling = getDrugCounselling('Amoxicillin', 'Amoxicillin', {
      dosage: '500 mg',
      frequency: 'Twice daily',
      duration: '5 days',
    })

    expect(counselling.english).toContain('500 mg, Twice daily, 5 days')
    expect(counselling.swahili).toContain('Tumia Amoxicillin')
    expect(counselling.instructions).toMatchObject({ dosage: '500 mg', frequency: 'Twice daily', duration: '5 days' })
  })
})