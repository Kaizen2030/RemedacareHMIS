import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SupportDesk from './SupportDesk'
import { SUPPORT_DEPARTMENTS, checklistFor, nextPpm, summarise, tempAlert } from './supportConfig'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [] } }))
vi.mock('../../components/PatientSearch', () => ({ default: () => null }))
vi.mock('../../components/DiagnosisPicker', () => ({ default: () => null }))
vi.mock('../../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, order: () => q, limit: () => q, gte: () => q, is: () => q, not: () => q,
      maybeSingle: async () => ({ data: (db.tables[t] || [])[0] || null, error: null }),
      insert: (row) => { db.writes.push([t, 'insert', row]); (db.tables[t] ||= []).unshift({ id: `n${db.writes.length}`, status: 'open', created_at: new Date().toISOString(), due_at: new Date(Date.now() + 3600e3).toISOString(), ...row }); return Promise.resolve({ error: null }) },
      update: (p) => { db.writes.push([t, 'update', p]); q._patch = p; return q },
      upsert: (p) => { db.writes.push([t, 'upsert', p]); return Promise.resolve({ error: null }) },
      single: async () => {
        if (q._patch?.status === 'done' && (db.tables[t][0].checklist || []).some((i) => i.required && !i.done)) return { data: null, error: { message: 'Tick every required checklist item before marking this done' } }
        Object.assign(db.tables[t][0], q._patch); return { data: { ...db.tables[t][0] }, error: null }
      },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from, rpc: vi.fn(async () => ({ data: {}, error: null })), auth: { getUser: async () => ({ data: { user: { email: 'mary@a.ke' } } }) } } }
})

beforeEach(() => { db.tables = { service_requests: [], service_settings: [{ hold_beds_for_cleaning: false }] }; db.writes = [] })

describe('support config', () => {
  it('flags unsafe food temperatures', () => {
    expect(tempAlert('Fridge 1', 9)).toMatch(/Fridge/)
    expect(tempAlert('Fridge 1', 5)).toBe('')
    expect(tempAlert('Freezer', -10)).toMatch(/Freezer/)
    expect(tempAlert('Hot holding', 55)).toMatch(/63/)
  })
  it('builds checklists, PPM dates and the report summary', () => {
    const hk = SUPPORT_DEPARTMENTS.Housekeeping
    expect(checklistFor(hk, 'routine_clean', { area_type: 'Isolation room' }).every((i) => i.done === false)).toBe(true)
    expect(checklistFor(hk, 'spill', { spill_type: 'Blood / body fluid' })[2].label).toMatch(/chlorine/i)
    expect(nextPpm({ ppm_every_days: 90, last_ppm_on: '2026-01-01' })).toBe('2026-04-01')
    expect(nextPpm({ ppm_every_days: null })).toBe(null)
    const now = new Date('2026-11-15T12:00:00Z')
    const s = summarise([
      { kind: 'job', status: 'open', due_at: '2026-11-15T10:00:00Z', created_at: '2026-11-15T08:00:00Z' },
      { kind: 'job', status: 'verified', created_at: '2026-11-14T08:00:00Z', completed_at: '2026-11-14T10:00:00Z', due_at: '2026-11-14T12:00:00Z' },
      { kind: 'job', status: 'done', created_at: '2026-11-14T08:00:00Z', completed_at: '2026-11-14T14:00:00Z', due_at: '2026-11-14T12:00:00Z' },
    ], now)
    expect(s).toMatchObject({ open: 1, overdue: 1, done30: 2, avgHours: 4, onTimePct: 50, unverified: 1 })
  })
  it('gives every support department a desk', () => {
    expect(Object.keys(SUPPORT_DEPARTMENTS).sort()).toEqual(['Administration', 'Housekeeping', 'IT & Systems', 'Kitchen / Catering', 'Maintenance & Engineering', 'Medical Records', 'Security', 'Transport'])
  })
})

describe('support desk', () => {
  it('creates a cleaning job with its checklist, then refuses "done" until the checklist is ticked', async () => {
    render(<SupportDesk department="Housekeeping" hospitalId="h1" />)
    fireEvent.click(await screen.findByRole('button', { name: '+ New request' }))
    fireEvent.change(screen.getByLabelText('Area type *'), { target: { value: 'Toilets / bathrooms' } })
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Ward 3 toilets' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create request' }))
    await waitFor(() => expect(db.writes.find((w) => w[1] === 'insert')).toBeTruthy())
    const row = db.writes.find((w) => w[1] === 'insert')[2]
    expect(row).toMatchObject({ department: 'housekeeping', kind: 'routine_clean', title: 'Routine clean — Toilets / bathrooms', location: 'Ward 3 toilets' })
    expect(row.checklist).toHaveLength(5)
    fireEvent.click(await screen.findByText('Routine clean — Toilets / bathrooms'))
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(await screen.findByText(/Tick every required checklist item/)).toBeTruthy()
  })
  it('shows the right sections for each department', async () => {
    render(<SupportDesk department="Security" hospitalId="h1" />)
    for (const t of ['Requests', 'Visitors', 'Patrols', 'Shift handover', 'Report']) expect(await screen.findByRole('tab', { name: t })).toBeTruthy()
  })
})
