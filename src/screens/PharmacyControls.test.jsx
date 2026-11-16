import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PharmacyControls from './PharmacyControls'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [], rpcs: [] } }))
vi.mock('../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, is: () => q, in: () => q, order: () => q, limit: () => q,
      insert: (row) => { db.writes.push([t, row]); return Promise.resolve({ error: null }) },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  const rpc = (name, args) => {
    db.rpcs.push([name, args])
    if (name === 'cd_balances') return Promise.resolve({ data: db.tables.balances, error: null })
    if (name === 'pharm_is_staff') return Promise.resolve({ data: true, error: null })
    return Promise.resolve({ data: null, error: null })
  }
  return { default: { from, rpc, auth: { getUser: () => Promise.resolve({ data: { user: { id: 'me' } } }) } } }
})
vi.mock('../context', () => ({ useHospital: () => ({ hospitalId: 'h1' }) }))
vi.mock('../components/PatientSearch', () => ({ default: () => null }))

beforeEach(() => {
  db.writes = []; db.rpcs = []
  db.tables = {
    pharmacy_inventory: [{ id: 'm', drug_name: 'Morphine 10mg', controlled_drug: true }, { id: 'a', drug_name: 'Amoxicillin' }],
    wards: [{ name: 'Surgical Ward' }],
    balances: [{ inventory_id: 'm', drug_name: 'Morphine 10mg', location: 'Pharmacy', balance: 18, unwitnessed: 1, last_check_at: null }],
    cd_register: [{ id: 'e1', drug_name: 'Morphine 10mg', location: 'Pharmacy', entry_type: 'receipt', delta: 20, balance_after: 20, quantity: 20, recorded_by: 'someone', recorded_by_name: 'Paul', created_at: new Date().toISOString() }],
    ward_stock: [{ id: 'w1', drug_name: 'Amoxicillin', par_level: 40, quantity: 10, inventory_id: 'a' }],
  }
})

describe('controlled drugs and ward stock', () => {
  it('shows balances, previews the new balance and records a receipt', async () => {
    render(<PharmacyControls />)
    expect(await screen.findByText('1 not witnessed')).toBeTruthy()
    expect(screen.getByText('Never counted')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } })
    expect(await screen.findByText('New balance 23')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Record entry' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'cd_register')[1]).toMatchObject({ inventory_id: 'm', location: 'Pharmacy', entry_type: 'receipt', quantity: 5 }))
  })

  it('witnesses another person\'s entry with your name', async () => {
    render(<PharmacyControls />)
    fireEvent.change(await screen.findByLabelText('Your name (for signatures)'), { target: { value: 'Nadia' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Waiting for witness' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Witness' }))
    await waitFor(() => expect(db.rpcs.find((r) => r[0] === 'cd_witness')[1]).toEqual({ p_entry: 'e1', p_name: 'Nadia' }))
  })

  it('ward stock below par can be topped up', async () => {
    render(<PharmacyControls />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Ward stock' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Request top-up (1 below par)' }))
    await waitFor(() => expect(db.rpcs.find((r) => r[0] === 'ward_topup_create')[1]).toEqual({ p_hospital: 'h1', p_ward: 'Surgical Ward' }))
  })
})
