import { describe, expect, it } from 'vitest'
import { buildPaymentReceiptHtml } from './receipt'

const base = { id: 'p1', kind: 'payment', method: 'cash', status: 'completed', amount: 1350, tendered: 2000, change_given: 650, receipt_no: 'RCP-2026-000042', created_at: '2026-11-14T08:00:00Z' }
const inv = { patient_name: 'Jane <b>Doe</b>', invoice_no: 'INV-1', amount_kes: 5000, paid_kes: 1350, balance_kes: 3650 }

describe('receipt', () => {
  it('shows receipt number, change and totals', () => {
    const html = buildPaymentReceiptHtml({ payment: base, invoice: inv })
    expect(html).toContain('RCP-2026-000042')
    expect(html).toContain('Change given')
    expect(html).toContain('KES 3,650')
  })
  it('escapes HTML in patient names (XSS-safe)', () => {
    const html = buildPaymentReceiptHtml({ payment: base, invoice: inv })
    expect(html).not.toContain('<b>Doe</b>')
    expect(html).toContain('&lt;b&gt;Doe&lt;/b&gt;')
  })
  it('prints every tender of a split on one receipt', () => {
    const lines = [
      { ...base, amount: 3500, tendered: 4000, change_given: 500, receipt_no: 'RCP-2026-000010' },
      { ...base, method: 'mpesa_manual', amount: 1500, tendered: null, change_given: null, reference: 'SGH7K2L9QX', receipt_no: 'RCP-2026-000011' },
    ]
    const html = buildPaymentReceiptHtml({ payment: lines[0], lines, invoice: { ...inv, paid_kes: 5000, balance_kes: 0 } })
    expect(html).toContain('RCP-2026-000010, RCP-2026-000011')
    expect(html).toContain('SGH7K2L9QX')
    expect(html).toContain('KES 5,000') // total received + total paid
    expect(html).toContain('Change given')
    expect(html).toMatch(/Balance<\/span><strong[^>]*>KES 0</)
  })
  it('escapes references too', () => {
    const html = buildPaymentReceiptHtml({ payment: { ...base, method: 'bank_transfer', reference: '<img src=x>' }, lines: [{ ...base }, { ...base, method: 'bank_transfer', reference: '<img src=x>' }] })
    expect(html).not.toContain('<img')
  })
  it('masks cards and labels refunds', () => {
    const html = buildPaymentReceiptHtml({ payment: { ...base, kind: 'refund', method: 'card_pos', card_brand: 'Visa', card_last4: '4242', notes: 'Overcharged' }, invoice: inv })
    expect(html).toContain('REFUND VOUCHER')
    expect(html).toContain('Visa •••• 4242')
    expect(html).toContain('Overcharged')
  })
})
