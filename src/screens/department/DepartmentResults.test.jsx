import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DepartmentResults, { buildResultsBoard } from './DepartmentResults'

const db = { tables: {} }
vi.mock('../../supabase', () => {
  const from = (table) => {
    const q = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'gte', 'lte']) q[m] = () => q
    q.then = (res, rej) => Promise.resolve({ data: db.tables[table] || [], error: null }).then(res, rej)
    return q
  }
  return { default: { from } }
})

const NOW = Date.now()
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString()
const VISITS = [
  { id: 'v1', patient_id: 'p1', visit_number: 'VIS-1', created_at: iso(300), patients: { full_name: 'TEST PATIENT 40' } },
  { id: 'v2', patient_id: 'p2', visit_number: 'VIS-2', created_at: iso(200), patients: { full_name: 'TEST PATIENT 41' } },
  { id: 'v3', patient_id: 'p3', visit_number: 'VIS-3', created_at: iso(100), patients: { full_name: 'TEST PATIENT 42' } },
]
const DATA = {
  labs: [
    { id: 'l1', visit_id: 'v1', test_type: 'Full blood count', status: 'Complete', resulted_at: iso(30), result_text: 'Hb 7.1 g/dL' },
    { id: 'l2', visit_id: 'v1', test_type: 'Urea & electrolytes', status: 'Complete', resulted_at: iso(250) },
    { id: 'l3', visit_id: 'v2', test_type: 'Malaria RDT', status: 'Pending' },
    { id: 'l4', visit_id: 'v3', test_type: 'Culture', status: 'Cancelled' },
  ],
  imaging: [{ id: 'i1', visit_id: 'v1', modality: 'X-ray', body_region: 'Chest', status: 'Reported', reported_at: iso(20), impression: 'Right lower lobe consolidation' }],
  prescriptions: [{ id: 'r1', visit_id: 'v2', drug_name: 'Amoxicillin', status: 'Rejected' }, { id: 'r2', visit_id: 'v2', drug_name: 'Paracetamol', status: 'Pending' }],
  alerts: [{ id: 'a1', patient_id: 'p2', status: 'open', message: 'Potassium 6.9 mmol/L is critically high' }],
  // the department saw patient 1 two hours ago: FBC and the X-ray came back after that, U&E before
  consultations: [{ id: 'c1', visit_id: 'v1', created_at: iso(120) }],
}

describe('results board logic', () => {
  it('counts ready and pending, finds results new since the last review, and puts critical first', () => {
    const board = buildResultsBoard({ visits: VISITS, ...DATA })
    expect(board.map((r) => r.visit.id)).toEqual(['v2', 'v1'])
    const p1 = board.find((r) => r.visit.id === 'v1')
    expect([p1.labReady, p1.labPending, p1.imgReady, p1.newCount]).toEqual([2, 0, 1, 2])
    expect([...p1.newIds].sort()).toEqual(['i1', 'l1'])
    const p2 = board.find((r) => r.visit.id === 'v2')
    expect([p2.labPending, p2.rxPending, p2.rxRejected, p2.critical.length]).toEqual([1, 1, 1, 1])
    expect(board.some((r) => r.visit.id === 'v3')).toBe(false)
  })

  it('without a consultation by the department, every returned result is new', () => {
    const board = buildResultsBoard({ visits: VISITS, ...DATA, consultations: [] })
    expect(board.find((r) => r.visit.id === 'v1').newCount).toBe(3)
  })
})

describe('Results and orders section', () => {
  const css = new Proxy({}, { get: () => ({}) })
  const SectionCard = ({ title, children }) => <section aria-label={title}>{children}</section>
  const EmptyState = ({ message }) => <p>{message}</p>
  beforeEach(() => {
    db.tables = { lab_tests: DATA.labs, radiology_orders: DATA.imaging, prescriptions: DATA.prescriptions, lab_critical_alerts: DATA.alerts }
  })

  it('lists patients to review, shows details and links to critical results', async () => {
    const navigate = vi.fn()
    render(<DepartmentResults hospitalId="h1" visits={VISITS} consultations={DATA.consultations} css={css} SectionCard={SectionCard} EmptyState={EmptyState} navigate={navigate} />)
    const box = screen.getByRole('region', { name: 'Results and orders' })
    expect(await within(box).findByText('TEST PATIENT 40')).toBeTruthy()
    expect(within(box).getByText('2 new since last seen')).toBeTruthy()
    expect(within(box).getByText('Critical result not acknowledged (1)')).toBeTruthy()
    expect(within(box).getByText('1 rejected by pharmacy')).toBeTruthy()
    fireEvent.click(within(box).getAllByRole('button', { name: 'Details' })[1])
    expect(within(box).getByText('Right lower lobe consolidation')).toBeTruthy()
    expect(within(box).getAllByText('NEW').length).toBe(2)
    fireEvent.click(within(box).getByRole('button', { name: 'Act on critical' }))
    expect(navigate).toHaveBeenCalledWith('critical-results')
    fireEvent.click(within(box).getByRole('tab', { name: /Still waiting \(1\)/ }))
    await waitFor(() => expect(within(box).queryByText('TEST PATIENT 40')).toBeNull())
    expect(within(box).getByText('TEST PATIENT 41')).toBeTruthy()
  })
})
