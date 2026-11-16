import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RecordsDesk from './RecordsDesk'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [], rpc: [] } }))
vi.mock('../../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
      insert: (row) => { db.writes.push([t, row]); return Promise.resolve({ error: null }) },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from, rpc: () => Promise.resolve({ data: db.rpc, error: null }) } }
})
vi.mock('../../components/PatientSearch', () => ({ default: ({ onPick }) => <button type="button" onClick={() => onPick({ id: 'p1', full_name: 'Jane', patient_number: 'MR-1' })}>pick patient</button> }))

beforeEach(() => {
  db.writes = []
  db.tables = {
    record_files: [{ id: 'f1', hospital_id: 'h1', patient_id: 'p1', file_number: 'MR-1', volume: 1, shelf: 'A-12', status: 'out', holder: 'Dr Dee', holder_location: 'OPD 4', out_since: new Date(Date.now() - 2 * 86400000).toISOString(), due_back: new Date(Date.now() - 86400000).toISOString(), patients: { full_name: 'Jane' } }],
    record_file_movements: [{ id: 1, file_id: 'f1', action: 'issued', to_holder: 'Dr Dee', moved_at: new Date().toISOString() }],
  }
  db.rpc = [{ kind: 'admission', record_id: 'a1', patient: 'Bob', ward: 'Surgical', clinician: 'Dr Kim', days_since: 5, missing: ['Discharge summary'] }]
})

describe('records desk', () => {
  it('shows where a file is, flags it overdue, and records a return', async () => {
    render(<RecordsDesk hospitalId="h1" />)
    fireEvent.click(screen.getByRole('button', { name: 'pick patient' }))
    expect(await screen.findByText(/With/)).toBeTruthy()
    expect(screen.getByText('Dr Dee', { selector: 'b' })).toBeTruthy()
    expect(screen.getByText('Overdue')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Returned to registry' }))
    await waitFor(() => expect(db.writes[0]).toEqual(['record_file_movements', expect.objectContaining({ file_id: 'f1', action: 'returned' })]))
  })
  it('lists overdue files and the incomplete records', async () => {
    render(<RecordsDesk hospitalId="h1" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Files out / overdue' }))
    expect(await screen.findByText('1 overdue or missing')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Incomplete records' }))
    expect(await screen.findByText('Discharge summary')).toBeTruthy()
    expect(screen.getByText('Dr Kim: 1')).toBeTruthy()
  })
})
