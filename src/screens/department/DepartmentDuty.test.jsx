import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { localDateKey } from '../../utils/scheduling'
import DepartmentDuty, { dutyBoard } from './DepartmentDuty'

const db = { tables: {} }
vi.mock('../../supabase', () => {
  const from = (table) => {
    const q = {}
    for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order']) q[m] = () => q
    q.then = (res, rej) => Promise.resolve({ data: db.tables[table] || [], error: null }).then(res, rej)
    return q
  }
  return { default: { from } }
})

const at = (dayOffset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d }
const TODAY = localDateKey(new Date())
const YDAY = localDateKey(at(-1, 12))
const TYPES = [
  { code: 'D', label: 'Day 07:00–19:00', hours: 12, counts_as_work: true }, { code: 'N', label: 'Night 19:00–07:00', hours: 12, counts_as_work: true },
  { code: 'PM', label: 'Afternoon 13:00–19:00', hours: 6, counts_as_work: true }, { code: 'OC', label: 'On call (24 h)', hours: 24, counts_as_work: false },
  { code: 'OFF', label: 'Off duty', hours: 0, counts_as_work: false },
]
const STAFF = ['Amina', 'Brian', 'Chebet', 'Daudi', 'Esther', 'Faith', 'Gitau', 'Halima'].map((n, i) => ({ id: `s${i + 1}`, full_name: `${n} (test)`, job_title: 'Nurse', status: 'Active' }))
const shift = (id, staff, date, code, start, end, unit = 'Neurology') => ({ id, staff_id: staff, shift_date: date, shift_code: code, unit, starts_at: start?.toISOString(), ends_at: end?.toISOString() })
const SHIFTS = [
  shift('x1', 's1', TODAY, 'D', at(0, 7), at(0, 19)),
  shift('x2', 's2', YDAY, 'N', at(-1, 19), at(0, 7)),
  shift('x3', 's3', TODAY, 'PM', at(0, 13), at(0, 19)),
  shift('x4', 's4', TODAY, 'OC', at(0, 7), at(1, 7)),
  shift('x5', 's5', TODAY, 'OFF', null, null),
  shift('x6', 's6', TODAY, 'D', at(0, 7), at(0, 19)),
  shift('x7', 'o1', TODAY, 'D', at(0, 7), at(0, 19), 'neurology'),
  shift('x8', 'o2', TODAY, 'D', at(0, 7), at(0, 19), 'Cardiology'),
]
const LEAVE = [{ id: 'l1', staff_id: 's6', leave_type: 'Annual', start_date: TODAY, end_date: TODAY, status: 'approved' }]
const matches = (u) => String(u || '').toLowerCase() === 'neurology'

describe('duty board', () => {
  it('sorts the roster into on duty now, later, on call, on leave and not rostered', () => {
    const b = dutyBoard({ shifts: SHIFTS, types: TYPES, leave: LEAVE, staff: STAFF, extraStaff: [{ id: 'o1', full_name: 'Omondi (test)' }], matchesDepartment: matches, now: at(0, 10) })
    expect(b.nowOn.map((r) => r.staff.full_name)).toEqual(['Amina (test)', 'Omondi (test)'])
    expect(b.later.map((r) => r.staff.full_name)).toEqual(['Chebet (test)'])
    expect(b.oncall.map((r) => r.staff.full_name)).toEqual(['Daudi (test)'])
    expect(b.onLeave.map((l) => l.staff.full_name)).toEqual(['Faith (test)'])
    expect(b.notRostered.map((s) => s.full_name)).toEqual(['Brian (test)', 'Gitau (test)', 'Halima (test)']) // Esther is rostered OFF; Brian's night shift ended at 07:00
  })

  it('a night shift that started yesterday is on duty before 07:00 today', () => {
    const b = dutyBoard({ shifts: SHIFTS, types: TYPES, staff: STAFF, matchesDepartment: matches, now: at(0, 5) })
    expect(b.nowOn.map((r) => r.staff.full_name)).toContain('Brian (test)')
    expect(b.nowOn.map((r) => r.staff.full_name)).not.toContain('Amina (test)')
    expect(b.later.map((r) => r.staff.full_name)).toEqual(expect.arrayContaining(['Amina (test)', 'Chebet (test)']))
  })
})

describe('On duty today section', () => {
  it('shows the groups and links to the roster', async () => {
    db.tables = { staff_shifts: SHIFTS, hr_shift_types: TYPES, staff_leave: LEAVE, staff: [{ id: 'o1', full_name: 'Omondi (test)' }] }
    const css = new Proxy({}, { get: () => ({}) })
    const navigate = vi.fn()
    render(<DepartmentDuty hospitalId="h1" staff={STAFF} matchesDepartment={matches} navigate={navigate} css={css}
      SectionCard={({ title, children }) => <section aria-label={title}>{children}</section>} EmptyState={({ message }) => <p>{message}</p>} />)
    const box = screen.getByRole('region', { name: 'On duty today' })
    expect(await within(box).findByText('Faith (test)')).toBeTruthy()
    expect(within(box).getByText(/Not on today's roster/)).toBeTruthy()
    within(box).getByRole('button', { name: 'Go to the weekly roster' }).click()
    expect(navigate).toHaveBeenCalledWith('hr')
  })
})

describe('large departments', () => {
  it('summarises by role, shows 6 per group until "Show all", and searches by name', async () => {
    const big = [
      ...Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, full_name: `Nurse ${String(i).padStart(2, '0')} (test)`, job_title: 'Nursing Officer', status: 'Active' })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `d${i}`, full_name: `Doctor ${i} (test)`, job_title: 'Medical Officer', status: 'Active' })),
    ]
    db.tables = { staff_shifts: big.map((s, i) => shift(`b${i}`, s.id, TODAY, 'D', at(0, 0, 1), at(0, 23, 59))), hr_shift_types: TYPES, staff_leave: [], staff: [] }
    const css = new Proxy({}, { get: () => ({}) })
    render(<DepartmentDuty hospitalId="h1" staff={big} matchesDepartment={matches} navigate={() => {}} css={css}
      SectionCard={({ title, children }) => <section aria-label={title}>{children}</section>} EmptyState={({ message }) => <p>{message}</p>} />)
    const box = screen.getByRole('region', { name: 'On duty today' })
    expect(await within(box).findByText('3 Doctors · 40 Nurses & midwives')).toBeTruthy()
    expect(within(box).getAllByText(/^Nurse \d+ \(test\)$|^Doctor \d \(test\)$/).length).toBe(6)
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.click(within(box).getByRole('button', { name: 'Show all 43' }))
    expect(within(box).getAllByText(/^Nurse \d+ \(test\)$|^Doctor \d \(test\)$/).length).toBe(43)
    fireEvent.change(within(box).getByLabelText('Search the duty list'), { target: { value: 'doctor' } })
    expect(within(box).getAllByText(/^Nurse \d+ \(test\)$|^Doctor \d \(test\)$/).length).toBe(3)
  })
})
