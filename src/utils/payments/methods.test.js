import { describe, expect, it } from 'vitest'
import { availableMethods, DEFAULT_ENABLED, toRpcLines, validateLine, validateTenders } from './methods'

const cash = (amount, extra = {}) => ({ method: 'cash', amount, ...extra })

describe('validateLine', () => {
  it('requires a positive amount with ≤ 2 decimals', () => {
    expect(validateLine(cash(''))).toMatch(/amount/i)
    expect(validateLine(cash('0'))).toMatch(/amount/i)
    expect(validateLine(cash('-5'))).toMatch(/amount/i)
    expect(validateLine(cash('10.555'))).toMatch(/2 decimals/)
    expect(validateLine(cash('10.55'))).toBeNull()
  })

  it('cash: tendered must cover the amount', () => {
    expect(validateLine(cash(500, { tendered: 400 }))).toMatch(/less than/)
    expect(validateLine(cash(500, { tendered: 1000 }))).toBeNull()
    expect(validateLine(cash(500))).toBeNull()
  })

  it('mpesa STK: whole shillings + valid phone', () => {
    expect(validateLine({ method: 'mpesa', amount: 100.5, phone: '0712345678' })).toMatch(/whole shillings/)
    expect(validateLine({ method: 'mpesa', amount: 100, phone: '12345' })).toMatch(/Safaricom/)
    expect(validateLine({ method: 'mpesa', amount: 100, phone: '0712345678' })).toBeNull()
  })

  it('manual m-pesa needs a 10-char code', () => {
    expect(validateLine({ method: 'mpesa_manual', amount: 100, reference: 'ABC' })).toMatch(/10 letters/)
    expect(validateLine({ method: 'mpesa_manual', amount: 100, reference: 'sgh7k2l9qx' })).toBeNull()
  })

  it('card POS needs approval code + last4', () => {
    expect(validateLine({ method: 'card_pos', amount: 100, reference: '12', card_last4: '4242' })).toMatch(/approval/i)
    expect(validateLine({ method: 'card_pos', amount: 100, reference: '123456', card_last4: '42' })).toMatch(/last 4/)
    expect(validateLine({ method: 'card_pos', amount: 100, reference: '123456', card_last4: '4242' })).toBeNull()
  })

  it('bank + cheque + online card', () => {
    expect(validateLine({ method: 'bank_transfer', amount: 100, reference: '' })).toMatch(/reference/i)
    expect(validateLine({ method: 'cheque', amount: 100, cheque_no: '' })).toMatch(/cheque number/i)
    expect(validateLine({ method: 'cheque', amount: 100, cheque_no: '0045' })).toBeNull()
    expect(validateLine({ method: 'card_online', amount: 100, email: 'not-an-email' })).toMatch(/email/i)
    expect(validateLine({ method: 'card_online', amount: 100, email: '' })).toBeNull() // server falls back to the hospital email
  })

  it('unknown method', () => expect(validateLine({ method: 'bitcoin', amount: 1 })).toMatch(/method/i))
})

describe('validateTenders (split payments)', () => {
  it('accepts a valid split that equals the balance', () => {
    expect(validateTenders([cash(2000), { method: 'mpesa_manual', amount: 1500, reference: 'SGH7K2L9QX' }], 3500)).toEqual([])
  })
  it('rejects overpayment', () => {
    expect(validateTenders([cash(3600)], 3500).join()).toMatch(/more than the open balance/)
  })
  it('rejects partial when disabled', () => {
    expect(validateTenders([cash(100)], 500, { allowPartial: false }).join()).toMatch(/Partial/)
    expect(validateTenders([cash(100)], 500, { allowPartial: true })).toEqual([])
  })
  it('rejects the same M-Pesa code twice in one split', () => {
    const l = { method: 'mpesa_manual', amount: 100, reference: 'SGH7K2L9QX' }
    expect(validateTenders([l, { ...l, reference: 'sgh7k2l9qx' }], 1000).join()).toMatch(/twice/)
  })
  it('rejects empty and labels line numbers', () => {
    expect(validateTenders([], 100)).toHaveLength(1)
    expect(validateTenders([cash(10), cash('')], 100)[0]).toMatch(/^Line 2/)
  })
})

describe('helpers', () => {
  it('availableMethods falls back to defaults', () => {
    expect(availableMethods([]).map((m) => m.id)).toEqual(expect.arrayContaining(DEFAULT_ENABLED))
    expect(availableMethods(['cash']).map((m) => m.id)).toEqual(['cash'])
  })
  it('toRpcLines normalises payloads', () => {
    const [l] = toRpcLines([{ method: 'mpesa_manual', amount: '1,500', reference: ' sgh7k2l9qx', phone: '0712345678' }])
    expect(l).toMatchObject({ method: 'mpesa_manual', amount: 1500, reference: 'SGH7K2L9QX', payer_phone: '254712345678', tendered: null })
    const [c] = toRpcLines([{ method: 'cash', amount: 500, tendered: '1000' }])
    expect(c).toMatchObject({ tendered: 1000, reference: null })
  })
})
