import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LabQuality from './LabQuality'
import { assessResult, effectiveRules, sectionWorklist, trendSeries } from '../../utils/labQuality'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [] } }))
vi.mock('../../supabase', () => {
  const from = (t) => {
    let f = null
    const q = {
      select: () => q, eq: (k, v) => { if (k === 'validation_status') f = v; return q }, order: () => q, limit: () => q,
      update: (p) => { db.writes.push([t, 'update', p]); return { eq: () => Promise.resolve({ error: null }) } },
      then: (res, rej) => Promise.resolve({ data: (db.tables[t] || []).filter((r) => !f || r.validation_status === f), error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from, rpc: () => Promise.resolve({ data: null, error: null }) } }
})
vi.mock('../../components/PatientSearch', () => ({ default: () => null }))

const ago = (m) => new Date(Date.now() - m * 60000).toISOString()
beforeEach(() => {
  db.writes = []
  db.tables = {
    lab_tests: [
      { id: 't1', test_type: 'Full Blood Count (FBC)', category: 'Haematology', priority: 'STAT', patient_name: 'Jane', created_at: ago(90), status: 'In Progress' },
      { id: 't2', test_type: 'Malaria RDT', category: 'Parasitology', priority: 'Routine', patient_name: 'Bob', created_at: ago(30), status: 'Pending' },
      { id: 't3', test_type: 'Urea & Electrolytes', patient_name: 'Amina', validation_status: 'needs_review', result_text: 'Potassium: 5.4', resulted_at: ago(5),
        delta_flags: [{ analyte: 'potassium', previous: 4.2, current: 5.4, change: 1.2, previous_at: ago(2880) }], critical_flags: [] },
    ],
    lab_quality_settings: [],
  }
})

describe('lab quality rules (mirror the database)', () => {
  it('delta checks, auto-validation, worklist order and trends', () => {
    const prev = { values: { potassium: '4.2', sodium: '138' }, at: ago(60 * 24) }
    expect(assessResult('rfts', { potassium: '5.4', sodium: '139' }, prev).delta_flags.map((f) => f.analyte)).toEqual(['potassium'])
    expect(assessResult('rfts', { potassium: '4.5', sodium: '139' }, prev, { autoverify: true }).validation_status).toBe('auto_validated')
    expect(assessResult('rfts', { potassium: '4.5', sodium: '139' }, prev).validation_status).toBe('needs_review')
    expect(assessResult('rfts', { potassium: '5.4' }, { ...prev, at: ago(60 * 24 * 10) }, { autoverify: false }).delta_flags).toEqual([])   // older than the window
    expect(effectiveRules([{ template_key: 'rfts', analyte: 'potassium', delta_abs: 0.5, hospital_id: 'h1' }], 'rfts').find((r) => r.analyte === 'potassium').delta_abs).toBe(0.5)
    expect(sectionWorklist(db.tables.lab_tests).map((t) => t.id)).toEqual(['t1', 't2'])
    expect(trendSeries([{ result_template_key: 'fbc', result_json: { haemoglobin: '9.1' }, resulted_at: ago(10) }, { result_template_key: 'fbc', result_json: { haemoglobin: '8' }, resulted_at: ago(100) }], 'fbc', 'haemoglobin').map((p) => p.value)).toEqual([8, 9.1])
  })
})

describe('lab quality panel', () => {
  it('shows section worklists with overdue STAT tests, and validates from the review queue', async () => {
    render(<LabQuality hospitalId="h1" />)
    expect(await screen.findByRole('button', { name: 'Haematology (1)' })).toBeTruthy()
    expect(screen.getByText('1.5 h').style.fontWeight).toBe('800')   // STAT target 1 h exceeded
    fireEvent.click(screen.getByRole('tab', { name: 'Review queue' }))
    expect(await screen.findByText(/Δ Potassium: 4.2 → 5.4/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))
    await waitFor(() => expect(db.writes[0][2]).toHaveProperty('reviewed_at'))
  })
})
