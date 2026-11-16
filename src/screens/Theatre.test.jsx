import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Theatre from './Theatre'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [] } }))
vi.mock('../context', () => ({ useHospital: () => ({ hospitalId: 'h1' }) }))
vi.mock('../hooks/useAccessLog', () => ({ default: () => true }))
vi.mock('../components/PatientSearch', () => ({ default: () => null }))
vi.mock('../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, gte: () => q, lt: () => q, order: () => q, limit: () => q, not: () => q, neq: () => q,
      insert: (row) => { db.writes.push([t, 'insert', row]); return Promise.resolve({ error: null }) },
      update: (p) => { db.writes.push([t, 'update', p]); return q },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from, rpc: vi.fn(async () => ({ data: {}, error: null })) } }
})

beforeEach(() => {
  db.writes = []
  const start = new Date(); start.setHours(9, 0, 0, 0)
  db.tables = {
    theatre_rooms: [{ id: 'r1', name: 'Theatre 1', active: true }],
    theatre_cases: [{ id: 'c1', hospital_id: 'h1', patient_id: 'p1', room_id: 'r1', procedure: 'Appendicectomy', surgeon: 'Dr Mwangi', urgency: 'emergency', status: 'booked', scheduled_start: start.toISOString(), scheduled_end: new Date(start.getTime() + 3600e3).toISOString(), sign_in: {}, time_out: {}, sign_out: {}, op_note: {}, recovery: [], patients: { full_name: 'Jane W', allergies: 'Penicillin' } }],
    theatre_items: [],
  }
})

describe('theatre screen', () => {
  it('lists the day by room and runs the WHO sign in item by item', async () => {
    render(<Theatre />)
    fireEvent.click(await screen.findByText(/Appendicectomy/))
    expect(screen.getByText('Allergies: Penicillin')).toBeTruthy()
    expect(screen.getAllByText(/Still open:/)[0].textContent).toMatch(/identity/)
    const answer = (label, choice) => {
      const row = screen.getByText(label).parentElement
      fireEvent.click(Array.from(row.querySelectorAll('label')).find((l) => l.textContent === choice).querySelector('input'))
    }
    answer('Patient has confirmed identity, site, procedure and consent', 'Yes')
    answer('Site marked', 'Not applicable')
    answer('Signed consent form in the file', 'Yes')
    answer('Anaesthesia machine and medication check complete', 'Yes')
    answer('Pulse oximeter on the patient and working', 'Yes')
    answer('Does the patient have a known allergy?', 'Yes (recorded)')
    answer('Difficult airway or aspiration risk?', 'No')
    answer('Risk of > 500 mL blood loss (7 mL/kg in children)?', 'No')
    expect(screen.getAllByText('Complete').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Save sign in' }))
    await waitFor(() => expect(db.writes.find((w) => w[1] === 'update')).toBeTruthy())
    expect(db.writes.find((w) => w[1] === 'update')[2].sign_in).toMatchObject({ identity_confirmed: 'yes', site_marked: 'na', allergy: 'yes' })
  })
})
