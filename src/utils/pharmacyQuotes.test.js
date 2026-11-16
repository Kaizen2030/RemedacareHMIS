import { describe, expect, it } from 'vitest'
import { buildQuoteMap, checkPaidQuoteMatches, findQuoteFor, isPharmacyQuote, quoteRxIds, quoteState } from './pharmacyQuotes'
import { buildWorkflowInvoiceNote, createServiceLine, SERVICE_SOURCES, stringifyServiceLines } from './workflowBilling'

const quote = (id, rxIds, extra = {}) => ({
  id,
  invoice_no: `INV-${id}`,
  status: 'Pending',
  amount_kes: 300,
  paid_kes: 0,
  balance_kes: 300,
  created_at: '2026-11-14T08:00:00Z',
  notes: buildWorkflowInvoiceNote({ source: SERVICE_SOURCES.PHARMACY, sourceId: `QUOTE-RX-${id}`, visitId: 'v1', summary: 'Pharmacy bill' }),
  services: stringifyServiceLines(rxIds.map(rx => createServiceLine({ label: `Drug ${rx}`, qty: 1, unitPrice: 100, source: SERVICE_SOURCES.PHARMACY, sourceId: rx, meta: { prescription_id: rx } }))),
  ...extra,
})

describe('pharmacy pay-before-dispense', () => {
  it('recognises quotes and their prescriptions', () => {
    const q = quote('1', ['rx-a', 'rx-b'])
    expect(isPharmacyQuote(q)).toBe(true)
    expect(isPharmacyQuote({ notes: buildWorkflowInvoiceNote({ source: SERVICE_SOURCES.PHARMACY, sourceId: 'RX-123' }) })).toBe(false)
    expect(quoteRxIds(q)).toEqual(['rx-a', 'rx-b'])
  })

  it('knows when a bill is paid', () => {
    expect(quoteState(quote('1', ['a']))).toBe('unpaid')
    expect(quoteState(quote('1', ['a'], { paid_kes: 100, balance_kes: 200, status: 'Partial' }))).toBe('partial')
    expect(quoteState(quote('1', ['a'], { paid_kes: 300, balance_kes: 0, status: 'Paid' }))).toBe('paid')
    expect(quoteState(quote('1', ['a'], { status: 'Cancelled' }))).toBe('cancelled')
  })

  it('maps each prescription to its newest live bill and ignores cancelled ones', () => {
    const old = quote('old', ['rx-a'], { created_at: '2026-11-13T08:00:00Z' })
    const cancelled = quote('x', ['rx-a'], { status: 'Cancelled', created_at: '2026-11-15T08:00:00Z' })
    const fresh = quote('new', ['rx-a', 'rx-b'], { created_at: '2026-11-14T09:00:00Z' })
    const map = buildQuoteMap([old, cancelled, fresh])
    expect(map['rx-a'].id).toBe('new')
    expect(map['rx-b'].id).toBe('new')
  })

  it('refuses a cart that mixes bills', () => {
    const map = buildQuoteMap([quote('1', ['rx-a']), quote('2', ['rx-b'])])
    expect(findQuoteFor(map, ['rx-a', 'rx-b']).conflict).toHaveLength(2)
    expect(findQuoteFor(map, ['rx-a']).quote.id).toBe('1')
    expect(findQuoteFor(map, ['rx-z']).quote).toBeNull()
  })

  it('only releases exactly what was paid', () => {
    const paid = quote('1', ['rx-a', 'rx-b'], { status: 'Paid', paid_kes: 300, balance_kes: 0 })
    expect(checkPaidQuoteMatches(paid, ['rx-b', 'rx-a'], 300).ok).toBe(true)
    expect(checkPaidQuoteMatches(paid, ['rx-a'], 300).ok).toBe(false)
    const changed = checkPaidQuoteMatches(paid, ['rx-a', 'rx-b'], 450)
    expect(changed.ok).toBe(false)
    expect(changed.reason).toMatch(/different from what was paid/)
  })
})
