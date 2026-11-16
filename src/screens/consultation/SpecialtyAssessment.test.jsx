import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SpecialtyAssessment from './SpecialtyAssessment'

const { db } = vi.hoisted(() => ({ db: { writes: [], rows: [] } }))
vi.mock('../../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, order: () => q, limit: () => q,
      insert: (row) => { db.writes.push([t, row]); return Promise.resolve({ error: null }) },
      then: (res, rej) => Promise.resolve({ data: db.rows, error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from } }
})

beforeEach(() => { db.writes = []; db.rows = [{ id: 'old', created_at: '2026-10-01T09:00:00Z', scores: { phq9: 21 }, flags: ['x'] }] })

describe('specialty assessment panel', () => {
  it('opens the mental health template for the psychiatry clinic, scores live and saves', async () => {
    const onInsert = vi.fn()
    render(<SpecialtyAssessment hospitalId="h1" patientId="p1" visitId="v1" speciality="Mental Health & Psychiatry" onInsertSummary={onInsert} />)
    expect(screen.getByText('Mental health assessment', { selector: 'b' })).toBeTruthy()
    expect(await screen.findByText(/phq9 21/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Thoughts that you would be better off dead, or of hurting yourself'), { target: { value: '2' } })
    expect(screen.getByText(/item 9 positive/)).toBeTruthy()
    const yes = screen.getAllByRole('radio', { name: 'Yes' })
    fireEvent.click(yes[4])   // c5: plan with intent
    expect(screen.getByRole('alert').textContent).toMatch(/HIGH suicide risk/)
    fireEvent.click(screen.getByRole('button', { name: 'Copy summary to findings' }))
    expect(onInsert.mock.calls[0][0]).toMatch(/suicide risk: high/)
    fireEvent.click(screen.getByRole('button', { name: 'Save assessment' }))
    await waitFor(() => expect(db.writes[0][1]).toMatchObject({ hospital_id: 'h1', patient_id: 'p1', visit_id: 'v1', template: 'mental_health', data: { q9: '2', c5: 'yes' } }))
  })

  it('other clinics can add a template; the dental chart cycles tooth status and counts DMFT', async () => {
    render(<SpecialtyAssessment hospitalId="h1" patientId="p1" speciality="OPD / Outpatient" />)
    fireEvent.change(screen.getByLabelText('Specialty template'), { target: { value: 'dental' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Tooth 36: Sound' }))
    expect(screen.getByRole('button', { name: 'Tooth 36: Caries (D)' })).toBeTruthy()
    expect(screen.getByText('DMFT: 1')).toBeTruthy()
  })
})
