import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Bedside, Requests } from './BloodLoop'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [] } }))
vi.mock('../../supabase', () => {
  const from = (t) => {
    let filter = null
    const q = {
      select: () => q, eq: (k, v) => { if (k === 'status' || k === 'request_id') filter = [k, v]; return q }, in: () => q, gte: () => q, order: () => q, limit: () => q, is: () => q,
      insert: (row) => { db.writes.push([t, 'insert', row]); return Promise.resolve({ error: null }) },
      update: (p) => { db.writes.push([t, 'update', p]); return { eq: () => Promise.resolve({ error: null }) } },
      then: (res, rej) => {
        let rows = db.tables[t] || []
        if (filter) rows = rows.filter((r) => r[filter[0]] === filter[1])
        return Promise.resolve({ data: rows, error: null }).then(res, rej)
      },
    }
    return q
  }
  return { default: { from, rpc: () => Promise.resolve({ data: true, error: null }) } }
})
vi.mock('../../components/PatientSearch', () => ({ default: () => null }))

const future = new Date(Date.now() + 10 * 86400000).toISOString()
beforeEach(() => {
  db.writes = []
  db.tables = {
    blood_requests: [{ id: 'r1', hospital_id: 'h1', patient_id: 'p1', component: 'Packed Red Cells', units: 1, urgency: 'urgent', indication: 'Hb 6', consent: 'obtained', status: 'ready', created_at: new Date().toISOString(), patients: { full_name: 'Jane Wanjiku', patient_number: 'P-1' } }],
    blood_group_tests: [{ id: 'g1', patient_id: 'p1', sample_ref: 'S1', result_group: 'A+', antibody_screen: 'negative', tested_at: new Date().toISOString() }],
    blood_bank_units: [
      { id: 'u1', hospital_id: 'h1', unit_reference: 'KNBTS-001', blood_group: 'A+', component: 'Packed Red Cells', status: 'Reserved', reserved_for_patient_id: 'p1', screening_status: 'clear', expiry_at: future },
      { id: 'u9', hospital_id: 'h1', unit_reference: 'KNBTS-009', blood_group: 'A+', component: 'Packed Red Cells', status: 'Issued', issued_to_patient_id: 'p1', issued_at: new Date(Date.now() - 10 * 60000).toISOString(), screening_status: 'clear', expiry_at: future, patients: { full_name: 'Jane Wanjiku', patient_number: 'P-1' } },
    ],
    blood_crossmatches: [{ id: 'x1', blood_unit_id: 'u1', patient_id: 'p1', request_id: 'r1', result: 'Compatible', method: 'Gel card', expires_at: future }],
    blood_transfusions: [],
  }
})

describe('blood closed loop screens', () => {
  it('a request shows the single-sample warning and issues the crossmatched unit with its crossmatch', async () => {
    render(<Requests hospitalId="h1" staff />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    expect(await screen.findByText(/second, separately collected sample/)).toBeTruthy()
    expect(await screen.findByText(/KNBTS-001/, { selector: 'b' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Issue' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'blood_bank_units')[2]).toEqual({ status: 'Issued', issued_to_patient_id: 'p1', request_id: 'r1', issued_crossmatch_id: 'x1' }))
  })

  it('the bedside check refuses a bag that does not match and starts the right one', async () => {
    render(<Bedside hospitalId="h1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Bedside check' }))
    fireEvent.change(screen.getByLabelText(/Bag number/), { target: { value: 'KNBTS-001' } })
    fireEvent.change(screen.getByLabelText(/Patient number on identity band/), { target: { value: 'P-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start transfusion' }))
    expect(await screen.findByText(/bag number does not match/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Bag number/), { target: { value: 'knbts-009' } })
    fireEvent.click(screen.getByLabelText(/Name, number and date of birth match/))
    fireEvent.change(screen.getByLabelText('Nurse 1'), { target: { value: 'Nora' } })
    fireEvent.change(screen.getByLabelText(/Nurse \/ doctor 2/), { target: { value: 'Mary' } })
    for (const [l, v] of [['Temp °C', '36.8'], ['Pulse', '88'], ['Systolic BP', '118']]) fireEvent.change(screen.getByLabelText(l), { target: { value: v } })
    fireEvent.click(screen.getByRole('button', { name: 'Start transfusion' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'blood_transfusions')[2]).toMatchObject({ unit_id: 'u9', patient_id: 'p1', scanned_unit_ref: 'knbts-009', checker2_name: 'Mary', baseline: { temp: '36.8' } }))
  })
})
