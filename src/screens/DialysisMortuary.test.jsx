import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dialysis from './Dialysis'
import Mortuary from './Mortuary'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [], rpc: {} } }))
vi.mock('./../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
      insert: (row) => { db.writes.push([t, 'insert', row]); const r = { error: null, data: { id: 'inv1', invoice_no: 'MRT-1', balance_kes: 4500 } }; const p = Promise.resolve(r); p.select = () => ({ single: () => Promise.resolve(r) }); return p },
      update: (patch) => { db.writes.push([t, 'update', patch]); return { eq: () => Promise.resolve({ error: null }) } },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from, rpc: (fn) => Promise.resolve({ data: db.rpc[fn] ?? null, error: null }) } }
})
vi.mock('./../context', () => ({ useHospital: () => ({ hospitalId: 'h1' }) }))
vi.mock('./../components/PatientSearch', () => ({ default: () => null }))

beforeEach(() => {
  db.writes = []
  const today = new Date(); const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(today.getDay() + 6) % 7]
  db.tables = {
    dialysis_patients: [
      { id: 'dp1', patient_id: 'p1', active: true, modality: 'HD', schedule_days: [wd], hbsag: 'positive', dry_weight_kg: 60, access_type: 'AVF', patients: { full_name: 'Jane Wanjiku' } },
      { id: 'dp2', patient_id: 'p2', active: true, modality: 'HD', schedule_days: [wd], hbsag: 'negative', dry_weight_kg: 70, access_type: 'tunneled_cvc', standing_orders: { duration_min: 240 }, patients: { full_name: 'Bob Otieno' } },
    ],
    dialysis_machines: [{ id: 'm1', name: 'HD-1', active: true }],
    dialysis_sessions: [{ id: 's1', dialysis_patient_id: 'dp2', status: 'in_progress', pre_weight_kg: 73, machine_id: 'm1', flags: ['Access infection signs: blood cultures and antibiotics per protocol'], session_date: '2026-11-15' }],
    mortuary_bodies: [{ id: 'b1', hospital_id: 'h1', body_number: 'MRT-2026-0001', deceased_name: 'John Kamau', sex: 'male', place_of_death: 'ward', chamber: 'C1', status: 'in_storage', admitted_at: new Date(Date.now() - 2.5 * 86400000).toISOString(), cause_of_death: {}, next_of_kin: {}, identified_by: {}, personal_effects: [], post_mortem: 'not_required' }],
  }
  db.rpc = { mortuary_blockers: ['Identity not verified', 'Mortuary bill: send it to the cashier and link the invoice'] }
})

describe('dialysis unit', () => {
  it('lists unbooked patients due today, flags, and previews URR / Kt/V in the session', async () => {
    render(<Dialysis />)
    expect(await screen.findByText('Jane Wanjiku')).toBeTruthy()
    expect(screen.getByText('HBsAg+')).toBeTruthy()
    expect(screen.getByText(/Access infection signs/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Book' }))
    await waitFor(() => expect(db.writes[0]).toEqual(['dialysis_sessions', 'insert', expect.objectContaining({ dialysis_patient_id: 'dp1' })]))
    fireEvent.click(screen.getByText('Bob Otieno').closest('button'))
    fireEvent.change(await screen.findByLabelText('Post weight kg'), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText('Pre urea mmol/L'), { target: { value: '150' } })
    fireEvent.change(screen.getByLabelText('Post urea mmol/L'), { target: { value: '50' } })
    expect(screen.getByText('66.7%')).toBeTruthy()
    expect(screen.getByText('1.32')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Complete session' }))
    await waitFor(() => expect(db.writes.find((w) => w[1] === 'update')[2]).toMatchObject({ status: 'completed', post_weight_kg: 70, pre_urea: 150, post_urea: 50 }))
  })
})

describe('mortuary', () => {
  it('shows what blocks release and sends the bill to the cashier', async () => {
    render(<Mortuary />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    expect(await screen.findByText('• Identity not verified')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Request release' }).disabled).toBe(true)
    expect(screen.getByText(/3 day\(s\) = KES 4,500/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send bill to cashier' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'invoices')[2]).toMatchObject({ patient_name: 'John Kamau', amount_kes: 4500, balance_kes: 4500, status: 'Pending' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'mortuary_bodies')[2]).toEqual({ invoice_id: 'inv1' }))
  })
})
