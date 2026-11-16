import { describe, expect, it } from 'vitest'
import { changeDue, formatKES, invoiceTotalsFromLedger, openAmount, parseAmountInput, refundableAmount, roundMoney, sumAmounts, toMinor } from './money'

describe('money', () => {
  it('avoids float drift', () => {
    expect(sumAmounts([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3)
    expect(roundMoney(1.005 * 100) / 100).toBeCloseTo(1.0, 1)
    expect(toMinor('1200.50')).toBe(120050)
  })

  it('parses cashier input', () => {
    expect(parseAmountInput('1,200.50')).toBe(1200.5)
    expect(parseAmountInput(' KES 300 ')).toBe(300)
    expect(parseAmountInput('abc')).toBeNaN()
    expect(parseAmountInput('')).toBeNaN()
    expect(parseAmountInput('12.3.4')).toBeNaN()
    expect(parseAmountInput(-5)).toBe(-5) // sign is rejected later by validateLine (amount > 0)
  })

  it('computes cash change', () => {
    expect(changeDue(2000, 1350)).toBe(650)
    expect(changeDue(1000, 1350)).toBe(0)
  })

  it('open amount counts completed + pending, minus refunds', () => {
    const inv = { amount_kes: 5000 }
    const pays = [
      { kind: 'payment', status: 'completed', amount: 2000 },
      { kind: 'payment', status: 'pending', amount: 1000 }, // reserved
      { kind: 'payment', status: 'failed', amount: 999 },   // ignored
      { kind: 'refund', status: 'completed', amount: 500 },
    ]
    expect(openAmount(inv, pays)).toBe(2500)
    expect(openAmount({ amount_kes: 100 }, [{ kind: 'payment', status: 'completed', amount: 500 }])).toBe(0)
  })

  it('a pending refund does not re-open the balance until the money has gone back', () => {
    const inv = { amount_kes: 1000 }
    const paid = { kind: 'payment', status: 'completed', amount: 1000 }
    expect(openAmount(inv, [paid, { kind: 'refund', status: 'pending', amount: 400 }])).toBe(0)
    expect(openAmount(inv, [paid, { kind: 'refund', status: 'completed', amount: 400 }])).toBe(400)
  })

  it('derives invoice totals from the ledger like the database does', () => {
    const rows = [
      { kind: 'payment', status: 'completed', amount: 3000 },
      { kind: 'payment', status: 'pending', amount: 1000 },
      { kind: 'refund', status: 'completed', amount: 500 },
    ]
    expect(invoiceTotalsFromLedger({ amount_kes: 5000, status: 'Pending' }, rows)).toMatchObject({ paid_kes: 2500, balance_kes: 2500, status: 'Partial' })
    expect(invoiceTotalsFromLedger({ amount_kes: 2500, status: 'Partial' }, rows)).toMatchObject({ status: 'Paid', balance_kes: 0 })
    expect(invoiceTotalsFromLedger({ amount_kes: 5000, status: 'Cancelled' }, rows).status).toBe('Cancelled')
  })

  it('refundable amount accounts for earlier refunds', () => {
    const p = { id: 'p1', kind: 'payment', status: 'completed', amount: 2000 }
    const all = [p, { kind: 'refund', refund_of: 'p1', status: 'completed', amount: 500 }, { kind: 'refund', refund_of: 'other', status: 'completed', amount: 900 }]
    expect(refundableAmount(p, all)).toBe(1500)
    expect(refundableAmount({ ...p, status: 'pending' }, all)).toBe(0)
  })

  it('formats KES', () => {
    expect(formatKES(1234.5)).toBe('KES 1,234.5')
    expect(formatKES(null)).toBe('KES 0')
  })
})
