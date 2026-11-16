import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CaseItems, PreferenceCards, findCard } from './PreferenceCards'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [] } }))
vi.mock('../../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, order: () => q, limit: () => q,
      insert: (row) => { db.writes.push([t, 'insert', row]); const r = { error: null, data: { id: 'inv9', invoice_no: 'TH-1' } }; const p = Promise.resolve(r); p.select = () => ({ single: () => Promise.resolve(r) }); return p },
      update: (patch) => { db.writes.push([t, 'update', patch]); return { eq: () => Promise.resolve({ error: null }) } },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from } }
})

beforeEach(() => {
  db.writes = []
  db.tables = {
    pharmacy_inventory: [{ id: 'sut', drug_name: 'Vicryl 2-0', quantity_in_stock: 20, selling_price: 450 }],
    theatre_preference_cards: [{ id: 'pc1', surgeon: 'Dr Mwangi', procedure: 'DHS fixation', glove_size: '7.5', position: 'Supine, traction table', items: [{ kind: 'consumable', name: 'Vicryl 2-0', inventory_id: 'sut', quantity: 3 }, { kind: 'implant', name: 'DHS plate', quantity: 1 }] }],
  }
})

describe('theatre preference cards', () => {
  it('matches a card regardless of case and spacing', () => {
    expect(findCard(db.tables.theatre_preference_cards, ' dr mwangi', 'DHS FIXATION')?.id).toBe('pc1')
    expect(findCard(db.tables.theatre_preference_cards, 'Dr Otieno', 'DHS fixation')).toBe(null)
  })

  it('creates a card with a pick list from stock', async () => {
    db.tables.theatre_preference_cards = []
    render(<PreferenceCards hospitalId="h1" />)
    fireEvent.click(await screen.findByRole('button', { name: '+ New card' }))
    fireEvent.change(screen.getByLabelText('Surgeon *'), { target: { value: 'Dr Achieng' } })
    fireEvent.change(screen.getByLabelText('Procedure *'), { target: { value: 'Caesarean section' } })
    await screen.findByRole('option', { name: 'Vicryl 2-0' })
    fireEvent.change(screen.getByLabelText('Stock item'), { target: { value: 'sut' } })
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }))
    await waitFor(() => expect(db.writes[0][2]).toMatchObject({ surgeon: 'Dr Achieng', procedure: 'Caesarean section', items: [{ kind: 'consumable', name: 'Vicryl 2-0', inventory_id: 'sut', quantity: 2 }] }))
  })

  it('case items: shows the card, adds non-implant items from it, and bills unbilled items once', async () => {
    const reload = vi.fn()
    const c = { id: 'case1', hospital_id: 'h1', patient_id: 'p1', surgeon: 'Dr Mwangi', procedure: 'DHS fixation', patients: { full_name: 'Jane' } }
    const items = [{ id: 'i1', kind: 'consumable', name: 'Vicryl 2-0', quantity: 3, unit_price: 450, stock_issue: { batches: [{ batch_number: 'V-SOON' }] } }, { id: 'i2', kind: 'implant', name: 'Screw', serial: 'S9', quantity: 1, unit_price: 2500, invoice_id: 'old' }]
    render(<CaseItems c={c} items={items} reload={reload} closed={false} />)
    expect(await screen.findByText(/Preference card — Dr Mwangi, DHS fixation/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add items from card' }))
    await waitFor(() => expect(db.writes.filter((w) => w[0] === 'theatre_items' && w[1] === 'insert')).toHaveLength(1))
    expect(db.writes[0][2]).toMatchObject({ kind: 'consumable', name: 'Vicryl 2-0', inventory_id: 'sut', quantity: 3, case_id: 'case1' })
    expect(await screen.findByText(/Add implants one by one/)).toBeTruthy()
    expect(screen.getByText('V-SOON')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send items bill to cashier' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'invoices')[2]).toMatchObject({ patient_id: 'p1', amount_kes: 1350, balance_kes: 1350, status: 'Pending' }))
    await waitFor(() => expect(db.writes.filter((w) => w[0] === 'theatre_items' && w[1] === 'update')).toEqual([['theatre_items', 'update', { invoice_id: 'inv9' }]]))
  })
})
