import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Emergency from './Emergency'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [] } }))
vi.mock('../context', () => ({ useHospital: () => ({ hospitalId: 'h1' }) }))
vi.mock('../hooks/useAccessLog', () => ({ default: () => true }))
vi.mock('../components/PatientSearch', () => ({ default: () => null }))
vi.mock('../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, or: () => q, order: () => q, limit: () => q, gte: () => q,
      insert: (row) => { db.writes.push([t, 'insert', row]); q._row = { id: 'new1', ...row }; return q },
      update: (p) => { db.writes.push([t, 'update', p]); return q },
      delete: () => q,
      single: async () => ({ data: q._row || { id: 'x' }, error: null }),
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from, rpc: vi.fn(async () => ({ data: {}, error: null })) } }
})

beforeEach(() => {
  db.writes = []
  const arrival = new Date(Date.now() - 15 * 60000).toISOString()
  db.tables = {
    ed_attendances: [
      { id: 'a1', hospital_id: 'h1', unknown_label: 'Unknown male', complaint: 'Chest pain', triage_colour: 'orange', arrival_at: arrival, see_by: new Date(Date.now() - 5 * 60000).toISOString(), pathways: ['stemi'], vitals: {}, discriminators: ['orange:Chest pain'] },
      { id: 'a2', hospital_id: 'h1', unknown_label: 'Child with cough', complaint: 'Cough', triage_colour: 'green', arrival_at: arrival, see_by: new Date(Date.now() + 200 * 60000).toISOString(), pathways: [], vitals: {}, discriminators: [], age_group: 'child' },
    ],
    ed_pathway_events: [],
  }
})

describe('emergency department screen', () => {
  it('orders the board by colour and shows who is past their target time and late pathway steps', async () => {
    render(<Emergency />)
    expect(await screen.findByText('5 min late')).toBeTruthy()
    expect(screen.getByText(/1 past their target time/)).toBeTruthy()
    expect(screen.getByText(/steps? late/)).toBeTruthy()
    const names = screen.getAllByText(/Unknown male|Child with cough/).map((n) => n.textContent)
    expect(names[0]).toBe('Unknown male')
  })
  it('triages from vital signs: TEWS and emergency signs give the colour, pathways are suggested', async () => {
    render(<Emergency />)
    fireEvent.click(await screen.findByRole('tab', { name: '+ New arrival / triage' }))
    fireEvent.change(screen.getByLabelText('…or unidentified patient'), { target: { value: 'Unknown female, RTA' } })
    for (const [l, v] of [['Resp. rate /min', '24'], ['Pulse /min', '118'], ['Systolic BP', '95'], ['Temp °C', '37']]) fireEvent.change(screen.getByLabelText(l), { target: { value: v } })
    fireEvent.change(screen.getByLabelText('Mobility'), { target: { value: 'stretcher' } })
    fireEvent.change(screen.getByLabelText('AVPU'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('Trauma'), { target: { value: 'yes' } })
    expect(screen.getByText('Red — emergency')).toBeTruthy() // RR 24→2, HR 118→2, SBP 95→1, temp 0, stretcher 2, alert 0, trauma 1 = 8
    expect(screen.getByText(/TEWS 8/)).toBeTruthy()
    expect(screen.getAllByText('suggested').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Save triage' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'ed_attendances' && w[1] === 'insert')).toBeTruthy())
    const row = db.writes.find((w) => w[1] === 'insert')[2]
    expect(row).toMatchObject({ hospital_id: 'h1', unknown_label: 'Unknown female, RTA', tews_score: 8, age_group: 'adult' })
  })
})
