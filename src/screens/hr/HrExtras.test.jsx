import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HrLicences, HrRoster, LeaveBalances, LeaveStatusCell } from './HrExtras'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [], rpc: {} } }))
vi.mock('../../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, gte: () => q, lte: () => q, order: () => q,
      insert: (row) => { db.writes.push([t, 'insert', row]); return Promise.resolve({ error: null }) },
      update: (p) => { db.writes.push([t, 'update', p]); return { eq: () => Promise.resolve({ error: null }) } },
      delete: () => { db.writes.push([t, 'delete']); return { eq: () => Promise.resolve({ error: null }) } },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from, rpc: (fn) => Promise.resolve({ data: db.rpc[fn] ?? null, error: null }) } }
})
vi.mock('../../confirmDialog', () => ({ openPromptDialog: () => Promise.resolve('Ward short-staffed that week') }))

const staff = [{ id: 's1', full_name: 'Nora', role: 'Nurse', department: 'Medical', status: 'Active' }]
beforeEach(() => {
  db.writes = []
  db.tables = { staff_shifts: [], hr_shift_types: [{ code: 'D', label: 'Day', hospital_id: null }, { code: 'N', label: 'Night', hospital_id: null }, { code: 'OFF', label: 'Off', hospital_id: null }] }
  db.rpc = {
    leave_balances: { 'Annual Leave': { entitled: 21, used: 10, pending: 3 } },
    hr_compliance: { expired: [{ staff: 'Dr Otieno', body: 'KMPDC', number: 'A9', expires_on: '2026-11-01' }], expiring: [], no_licence: [{ staff: 'Ina', role: 'Clinical Officer' }], cpd: [{ staff: 'Nora', points: 5, required: 20 }] },
  }
})

describe('HR additions', () => {
  it('roster: picking a code saves a shift for that person and day', async () => {
    render(<HrRoster hospitalId="h1" staff={staff} />)
    const cells = await screen.findAllByRole('combobox', { name: /^Nora / })
    await screen.findAllByRole('option', { name: 'N' })
    fireEvent.change(cells[0], { target: { value: 'N' } })
    await waitFor(() => expect(db.writes.find((w) => w[1] === 'insert')[2]).toMatchObject({ hospital_id: 'h1', staff_id: 's1', shift_code: 'N', unit: 'Medical' }))
  })
  it('leave: HR approves or rejects with a reason; balances show what is left', async () => {
    const onChanged = vi.fn()
    render(<LeaveStatusCell leave={{ id: 'l1', status: 'requested' }} canDecide onChanged={onChanged} />)
    expect(screen.getByText('Waiting for HR')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(db.writes[0][2]).toEqual({ status: 'rejected', decision_note: 'Ward short-staffed that week' }))
    render(<LeaveBalances hospitalId="h1" staffId="s1" />)
    expect(await screen.findByText('Annual Leave: 11 of 21 left (3 pending)')).toBeTruthy()
  })
  it('licences: compliance lists and recording a licence', async () => {
    render(<HrLicences hospitalId="h1" staff={staff} />)
    expect(await screen.findByText(/expired 2026-11-01/)).toBeTruthy()
    expect(screen.getByText('5 / 20')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Staff', { selector: '#lic-staff' }), { target: { value: 's1' } })
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: 'NCK/123' } })
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2027-06-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save licence' }))
    await waitFor(() => expect(db.writes[0]).toEqual(['staff_licences', 'insert', expect.objectContaining({ staff_id: 's1', body: 'NCK', number: 'NCK/123', expires_on: '2027-06-30' })]))
  })
})
