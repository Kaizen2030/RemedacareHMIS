import { describe, expect, it, vi } from 'vitest'
import { cdPreview, cdTypesFor, topUpLines } from './pharmacyControls'
import { controlledShortfalls, fefoIssue, recordControlledIssues } from './pharmacyDispense'

describe('controlled drug register rules (mirror the database)', () => {
  it('entry types depend on the register location', () => {
    expect(cdTypesFor('Pharmacy')).toEqual(['receipt', 'issue_patient', 'issue_ward', 'destruction', 'adjustment', 'balance_check'])
    expect(cdTypesFor('Surgical Ward')).toEqual(['administered', 'return_to_pharmacy', 'destruction', 'adjustment', 'balance_check'])
  })
  it('previews balances and the problems the database will raise', () => {
    expect(cdPreview(18, 'issue_patient', 2, { patient: { id: 'p' }, prescriber: 'Dr M' })).toEqual({ balance: 16, problem: null })
    expect(cdPreview(18, 'issue_patient', 2, { patient: { id: 'p' } }).problem).toMatch(/prescriber/)
    expect(cdPreview(1, 'administered', 2, { patient: { id: 'p' } }).problem).toMatch(/negative/)
    expect(cdPreview(7, 'balance_check', 6, {})).toMatchObject({ discrepancy: -1, problem: expect.stringMatching(/explain/) })
    expect(cdPreview(7, 'balance_check', 6, { reason: 'incident filed' }).problem).toBe(null)
    expect(cdPreview(5, 'adjustment', -2, { reason: 'miscount' })).toEqual({ balance: 3, problem: null })
    expect(cdPreview(5, 'receipt', 10, {})).toEqual({ balance: 15, problem: null })
  })
  it('top-up lines bring each item up to par', () => {
    expect(topUpLines([{ id: 'a', drug_name: 'A', par_level: 40, quantity: 10 }, { id: 'b', drug_name: 'B', par_level: 5, quantity: 5 }])).toEqual([{ ward_stock_id: 'a', drug_name: 'A', requested: 30 }])
  })
})

describe('dispensing helpers', () => {
  const notInstalled = { message: 'Could not find the function public.pharmacy_fefo_issue' }
  it('falls back when the SQL is not installed, and reports real errors', async () => {
    expect(await fefoIssue({ rpc: async () => ({ error: notInstalled }) }, 'i', 1, 'RX')).toEqual({ installed: false })
    expect(await fefoIssue({ rpc: async () => ({ error: { message: 'First expiry, first out: use batch B1' } }) }, 'i', 1, 'RX')).toEqual({ installed: true, error: 'First expiry, first out: use batch B1' })
    expect((await fefoIssue({ rpc: async () => ({ data: { batches: [{ batch_number: 'B1' }] } }) }, 'i', 1, 'RX')).batches).toHaveLength(1)
  })
  it('blocks controlled items the register cannot cover and posts issues after dispensing', async () => {
    const items = [{ quantity: 3, inventoryItem: { id: 'm', drug_name: 'Morphine', controlled_drug: true }, rx: { id: 7, patient_id: 'p', prescribed_by: 'Dr M' } }, { quantity: 9, inventoryItem: { id: 'x', drug_name: 'Amox' } }]
    const db = { rpc: async () => ({ data: [{ inventory_id: 'm', location: 'Pharmacy', balance: 2 }] }) }
    expect((await controlledShortfalls(db, 'h', items))[0]).toMatch(/shows 2, need 3/)
    expect(await controlledShortfalls({ rpc: async () => ({ error: notInstalled }) }, 'h', items)).toEqual([])
    const insert = vi.fn(async () => ({ error: null }))
    expect(await recordControlledIssues({ from: () => ({ insert }) }, 'h', items, { recordedBy: 'Paul' })).toEqual([])
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert.mock.calls[0][0]).toMatchObject({ entry_type: 'issue_patient', inventory_id: 'm', quantity: 3, patient_id: 'p', prescriber: 'Dr M', prescription_id: '7' })
  })
})
