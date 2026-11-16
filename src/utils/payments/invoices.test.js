import { beforeEach, describe, expect, it, vi } from 'vitest'

// Minimal chainable Supabase stub: every query resolves to the rows queued for that table.
const tables = {}
const rpc = vi.fn()
vi.mock('../../supabase', () => {
  const query = (table) => {
    const state = { filters: [] }
    const result = () => {
      let rows = [...(tables[table] || [])]
      for (const [op, col, val] of state.filters) {
        if (op === 'eq') rows = rows.filter((r) => r[col] === val)
        if (op === 'in') rows = rows.filter((r) => val.includes(r[col]))
        if (op === 'ilike') rows = rows.filter((r) => String(r[col] || '').includes(val.replace(/%/g, '')))
      }
      return rows
    }
    const q = {
      select: () => q, order: () => q, limit: () => q,
      eq: (c, v) => { state.filters.push(['eq', c, v]); return q },
      in: (c, v) => { state.filters.push(['in', c, v]); return q },
      ilike: (c, v) => { state.filters.push(['ilike', c, v]); return q },
      maybeSingle: async () => ({ data: result()[0] || null, error: null }),
      then: (res) => res({ data: result(), error: null }),
    }
    return q
  }
  return { default: { from: query, rpc: (...a) => rpc(...a) } }
})

const { findInvoiceForDebt, isSelfPayMethod, ledgerTenderFromLegacy, paymentHintFromLegacy, recordLegacyPayment, unpaidInvoiceFields } = await import('./invoices')

const H = 'hosp-1'
beforeEach(() => {
  rpc.mockReset()
  tables.invoices = [
    { id: 'a', hospital_id: H, invoice_no: 'INV-111', visit_id: 'v1', status: 'Pending', amount_kes: 500, paid_kes: 0, balance_kes: 500, notes: 'WF|pharmacy|RX-12345678|v1|x', created_at: '2026-01-01' },
    { id: 'b', hospital_id: H, invoice_no: 'INV-222', visit_id: 'v1', status: 'Pending', amount_kes: 300, paid_kes: 0, balance_kes: 300, notes: 'WF|laboratory|t1|v1|x', created_at: '2026-01-02' },
    { id: 'c', hospital_id: H, invoice_no: 'INV-333', visit_id: 'v2', status: 'Pending', amount_kes: 900, paid_kes: 0, balance_kes: 900, notes: '', created_at: '2026-01-03' },
  ]
})

describe('new invoices are never pre-paid', () => {
  it('unpaidInvoiceFields', () => {
    expect(unpaidInvoiceFields(1500)).toEqual({ amount_kes: 1500, paid_kes: 0, balance_kes: 1500, status: 'Pending', paid_at: null })
    expect(unpaidInvoiceFields('abc').amount_kes).toBe(0)
  })
  it('isSelfPayMethod', () => {
    for (const m of ['Cash', 'M-Pesa', 'mpesa', undefined, 'Split Payment']) expect(isSelfPayMethod(m)).toBe(true)
    for (const m of ['SHA', 'SHA (Social Health Authority)', 'NHIF', 'AAR Insurance', 'Credit']) expect(isSelfPayMethod(m)).toBe(false)
  })
})

describe('legacy method mapping', () => {
  it('maps what the RPC accepts and falls back to other with a note', () => {
    expect(ledgerTenderFromLegacy('Cash')).toMatchObject({ method: 'cash' })
    expect(ledgerTenderFromLegacy('M-Pesa', 'sgh7k2l9qx')).toMatchObject({ method: 'mpesa_manual', reference: 'SGH7K2L9QX' })
    expect(ledgerTenderFromLegacy('M-Pesa', '123')).toMatchObject({ method: 'other' })
    expect(ledgerTenderFromLegacy('M-Pesa', '123').note).toMatch(/no valid M-Pesa code/)
    expect(ledgerTenderFromLegacy('Bank Transfer', 'FT2611')).toMatchObject({ method: 'bank_transfer', reference: 'FT2611' })
    expect(ledgerTenderFromLegacy('Cheque', '000123')).toMatchObject({ method: 'cheque', reference: '000123' })
    expect(ledgerTenderFromLegacy('Cheque', '')).toMatchObject({ method: 'other' })
    expect(ledgerTenderFromLegacy('Card')).toMatchObject({ method: 'other' })
  })
  it('payment hints', () => {
    expect(paymentHintFromLegacy('M-Pesa', 'abc')).toEqual({ method: 'mpesa_manual', reference: 'ABC' })
    expect(paymentHintFromLegacy('Cash')).toEqual({ method: 'cash' })
    expect(paymentHintFromLegacy('SHA')).toBeNull()
  })
})

describe('findInvoiceForDebt uses exact links only', () => {
  it('by invoice number in the description', async () => {
    expect((await findInvoiceForDebt(H, { description: 'Invoice INV-222' }))?.id).toBe('b')
  })
  it('by pharmacy receipt number', async () => {
    expect((await findInvoiceForDebt(H, { description: 'Pharmacy receipt RX-12345678' }))?.id).toBe('a')
  })
  it('by visit when the amount identifies the bill', async () => {
    expect((await findInvoiceForDebt(H, { visit_id: 'v1', amount_charged: 300 }))?.id).toBe('b')
  })
  it('a single open bill on the visit', async () => {
    expect((await findInvoiceForDebt(H, { visit_id: 'v2', amount_charged: 50 }))?.id).toBe('c')
  })
  it('never guesses between several bills or by patient alone', async () => {
    expect(await findInvoiceForDebt(H, { visit_id: 'v1', amount_charged: 999 })).toBeNull()
    expect(await findInvoiceForDebt(H, { patient_id: 'p1', amount_charged: 900 })).toBeNull()
  })
})

describe('recordLegacyPayment', () => {
  it('posts to the ledger, capped at the open balance', async () => {
    rpc.mockResolvedValue({ data: [{ receipt_no: 'RCP-1' }], error: null })
    const r = await recordLegacyPayment({ hospitalId: H, record: { description: 'Invoice INV-222' }, amount: 1000, method: 'M-Pesa', reference: 'SGH7K2L9QX' })
    expect(r.ok).toBe(true)
    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe('record_manual_payments')
    expect(args.p_invoice_id).toBe('b')
    expect(args.p_lines[0]).toMatchObject({ method: 'mpesa_manual', amount: 300, reference: 'SGH7K2L9QX' })
  })
  it('does nothing to billing when no bill matches', async () => {
    const r = await recordLegacyPayment({ hospitalId: H, record: { patient_id: 'p1' }, amount: 100, method: 'Cash' })
    expect(r.ok).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('reports RPC errors instead of throwing', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Payment (300) exceeds the open balance (0)' } })
    const r = await recordLegacyPayment({ hospitalId: H, record: { description: 'Invoice INV-222' }, amount: 300, method: 'Cash' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/exceeds/)
  })
})

describe('cashier-only flow helpers', () => {
  it('tells staff to send the patient to the cashier with the amount and bill number', async () => {
    const { notifySentToCashier } = await import('./invoices')
    const spy = vi.fn()
    window.notifyFromLegacyAlert = spy
    notifySentToCashier({ invoice_no: 'INV-9', balance_kes: 1500 }, 'Test ordered')
    expect(spy.mock.calls[0][0]).toMatch(/Test ordered\. Send the patient to the CASHIER to pay KES 1,500 \(bill INV-9\)/)
  })
  it('Kenyan calendar day does not flip at midnight UTC', async () => {
    const { nairobiDay } = await import('./money')
    expect(nairobiDay('2026-11-14T22:30:00Z')).toBe('2026-11-15') // 01:30 in Nairobi
    expect(nairobiDay('2026-11-14T20:59:00Z')).toBe('2026-11-14')
  })
})
