import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WardObservations from './WardObservations'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [] } }))
vi.mock('../../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
      insert: (row) => { db.writes.push([t, 'insert', row]); return Promise.resolve({ error: null }) },
      update: (p) => { db.writes.push([t, 'update', p]); return q },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from } }
})

beforeEach(() => {
  db.writes = []
  db.tables = {
    ward_observations: [{ id: 'o1', scale: 'news2', score: 8, level: 'high', response: 'Emergency response', observed_at: new Date(Date.now() - 30 * 60000).toISOString(), next_due_at: new Date(Date.now() - 15 * 60000).toISOString(), obs: { rr: 26 }, escalated_to: null }],
    ward_risk_assessments: [], ward_care_plans: [],
  }
})

describe('ward observations', () => {
  it('shows overdue observations and an escalation that must be recorded', async () => {
    render(<WardObservations hospitalId="h1" patient={{ id: 'p1', age: 60 }} visitId="v1" bedId="b1" />)
    expect(await screen.findByText(/OVERDUE/)).toBeTruthy()
    expect(screen.getByText('Escalation needed')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Informed'), { target: { value: 'Dr Otieno' } })
    fireEvent.click(screen.getByLabelText('Patient reviewed'))
    fireEvent.click(screen.getByRole('button', { name: 'Record escalation' }))
    await waitFor(() => expect(db.writes.find((w) => w[1] === 'update')[2]).toMatchObject({ escalated_to: 'Dr Otieno' }))
  })
  it('previews NEWS2 live and refuses an incomplete set', async () => {
    render(<WardObservations hospitalId="h1" patient={{ id: 'p1', age: 60 }} visitId="v1" bedId="b1" />)
    await screen.findByText('Escalation needed')
    fireEvent.click(screen.getByRole('button', { name: 'Save observations' }))
    expect(await screen.findByText(/Record every parameter/)).toBeTruthy()
    for (const [l, v] of [['Resp. rate /min', '22'], ['SpO₂ %', '95'], ['Systolic BP', '105'], ['Pulse /min', '95'], ['Temp °C', '38.4']]) fireEvent.change(screen.getByLabelText(l), { target: { value: v } })
    expect(screen.getByText(/^6 · /)).toBeTruthy() // RR 2 + SpO2 1 + BP 1 + HR 1 + temp 1
    fireEvent.click(screen.getByRole('button', { name: 'Save observations' }))
    await waitFor(() => expect(db.writes.find((w) => w[1] === 'insert')[2]).toMatchObject({ scale: 'news2', patient_id: 'p1', obs: { rr: '22', consciousness: 'A' } }))
  })
  it('picks PEWS for children', async () => {
    render(<WardObservations hospitalId="h1" patient={{ id: 'p2', age: 4 }} />)
    expect((await screen.findByLabelText('Scale')).value).toBe('pews')
  })
})
