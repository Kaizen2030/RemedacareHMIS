import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DepartmentReport, { ageAt, buildDepartmentReport, reportCsv } from './DepartmentReport'

const db = { tables: {} }
vi.mock('../../supabase', () => {
  const from = (table) => {
    const q = {}
    for (const m of ['select', 'eq', 'in', 'gte', 'lt', 'lte', 'like', 'order']) q[m] = () => q
    q.then = (res, rej) => Promise.resolve({ data: db.tables[table] || [], error: null }).then(res, rej)
    return q
  }
  return { default: { from } }
})

const MONTH = '2026-10'
const yearsAgo = (n, extraDays = 0) => { const d = new Date('2026-10-15T00:00:00'); d.setFullYear(d.getFullYear() - n); d.setDate(d.getDate() - extraDays); return d.toISOString().slice(0, 10) }
const PATIENTS = [
  { id: 'p1', gender: 'Female', dob: yearsAgo(3) },
  { id: 'p2', gender: 'Male', age: 30 },
  { id: 'p3', gender: '' },
]
const CONS = [
  { id: 'c1', patient_id: 'p1', speciality: 'Paediatrics', created_at: '2026-10-02T09:00:00', diagnosis: 'Malaria', icd10_code: 'b54' },
  { id: 'c2', patient_id: 'p1', speciality: 'paediatrics', created_at: '2026-10-09T09:00:00', diagnosis: 'Malaria, follow-up', icd10_code: 'B54' },
  { id: 'c3', patient_id: 'p2', speciality: 'Paediatrics', created_at: '2026-10-05T09:00:00', icd10_description: 'Essential hypertension', icd10_code: 'I10' },
  { id: 'c4', patient_id: 'p3', speciality: 'Paediatrics', created_at: '2026-10-20T09:00:00', diagnosis: 'Headache' },
]
const PRIOR = [{ patient_id: 'p2', speciality: 'Paediatrics', created_at: '2026-08-01T09:00:00' }]
const INVOICES = [{ id: 'i1', notes: 'WF|Procedure|c1|v1|Paediatrics: Nebulisation', services: JSON.stringify([{ label: 'Nebulisation', qty: 2, total: 1000, source: 'Procedure' }, { label: 'Consultation', qty: 1, total: 500, source: 'Consultation' }]) }]

describe('department monthly report', () => {
  it('counts new and re-attendances by age band, sex and patients', () => {
    const r = buildDepartmentReport({ consultations: CONS, prior: PRIOR, patients: PATIENTS, department: 'Paediatrics', invoices: INVOICES,
      referralsIn: [{ status: 'Received', referring_department: 'Emergency' }, { status: 'Declined', referring_department: 'Emergency' }], referralsOut: [{ receiving_department: 'Surgery' }], admissions: [{}, {}] })
    expect(r.workload).toEqual({ total: 4, newUnder5: 1, newOver5: 0, revisitUnder5: 1, revisitOver5: 1, ageUnknown: 1, female: 2, male: 1, patients: 3 })
    expect(r.diagnoses.map((d) => [d.code, d.total, d.under5, d.over5])).toEqual([['B54', 2, 2, 0], ['I10', 1, 0, 1], ['', 1, 0, 0]]) // equal counts sort by name; unknown age counts in the total only
    expect(r.referrals).toMatchObject({ in: 2, out: 1, declinedIn: 1, inFrom: [['Emergency', 2]], outTo: [['Surgery', 1]] })
    expect(r.admissions).toBe(2)
    expect(r.services).toEqual([{ label: 'Nebulisation', qty: 2, amount: 1000 }])
    const csv = reportCsv(r, 'October 2026', 'Test Hospital')
    expect(csv).toMatch(/^Test Hospital — Paediatrics monthly report,October 2026/)
    expect(csv).toMatch(/New attendances,1,0,1/)
    expect(csv).toMatch(/Re-attendances,1,1,2/)
    expect(csv).toMatch(/Malaria,B54,2,0,2/)
  })

  it('age is taken from the date of birth on the day of the visit', () => {
    expect(ageAt({ dob: '2021-10-20' }, '2026-10-19')).toBe(4)
    expect(ageAt({ dob: '2021-10-20' }, '2026-10-20')).toBe(5)
    expect(ageAt({ age: 7 }, '2026-10-20')).toBe(7)
    expect(ageAt({}, '2026-10-20')).toBeNull()
  })

  it('builds the report for this department only and offers the CSV', async () => {
    db.tables = { consultations: [...CONS, { id: 'c9', patient_id: 'p2', speciality: 'Cardiology', created_at: '2026-10-03T09:00:00', diagnosis: 'AF' }], patients: PATIENTS, referrals: [], admissions: [], invoices: [] }
    const css = new Proxy({}, { get: () => ({}) })
    render(<DepartmentReport hospitalId="h1" department="Paediatrics" matchesDepartment={(n) => String(n || '').toLowerCase() === 'paediatrics'} css={css}
      SectionCard={({ title, children }) => <section aria-label={title}>{children}</section>} />)
    const box = screen.getByRole('region', { name: 'Monthly report' })
    fireEvent.change(within(box).getByLabelText('Month'), { target: { value: MONTH } })
    fireEvent.click(within(box).getByRole('button', { name: 'Build report' }))
    expect(await within(box).findByText('Workload — October 2026')).toBeTruthy()
    expect(within(box).queryByText('AF')).toBeNull()
    expect(within(box).getByText('Malaria')).toBeTruthy()
    expect(within(box).getByRole('button', { name: 'Download CSV (Excel)' })).toBeTruthy()
  })
})
