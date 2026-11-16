import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Radiology from './Radiology'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [] } }))
vi.mock('../context', () => ({ useHospital: () => ({ hospitalId: 'h1', userRole: 'Doctor' }) }))
vi.mock('../hooks/useAccessLog', () => ({ default: () => true }))
vi.mock('../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q, neq: () => q, not: () => q,
      maybeSingle: async () => ({ data: { system_settings: { integrations_config: { pacs_viewer_url: 'https://pacs.example/view?acc={accession}' } } }, error: null }),
      update: (p) => { db.writes.push([t, 'update', p]); return q },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from, rpc: vi.fn(async () => ({ data: { ionising_exams: 0 }, error: null })) } }
})

beforeEach(() => {
  db.writes = []
  db.tables = {
    radiology_orders: [
      { id: 'o1', hospital_id: 'h1', patient_id: 'p1', modality: 'Ultrasound', body_region: 'Obstetric', clinical_indication: 'Reduced fetal movements', status: 'In Progress', priority: 'Urgent', accession_number: 'RAD261115-00001', created_at: new Date().toISOString() },
      { id: 'o2', hospital_id: 'h1', patient_id: 'p1', modality: 'X-Ray', body_region: 'Chest', status: 'Reported', critical: true, critical_finding: 'Tension pneumothorax', critical_notified_at: new Date(Date.now() - 20 * 60000).toISOString(), created_at: new Date().toISOString() },
    ],
    patients: [{ id: 'p1', full_name: 'Jane W', patient_number: 'A-1', gender: 'F' }],
    lab_tests: [], visits: [],
  }
})

describe('radiology screen', () => {
  it('flags unacknowledged critical results and lets a clinician acknowledge them', async () => {
    render(<Radiology />)
    expect(await screen.findByText(/1 critical result not yet acknowledged/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Critical results (1)' }))
    fireEvent.change(screen.getByLabelText('Clinician informed'), { target: { value: 'Dr Otieno' } })
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledged' }))
    await waitFor(() => expect(db.writes[0][2]).toMatchObject({ critical_ack_name: 'Dr Otieno' }))
  })
  it('reports with the obstetric template, suggests critical, and links to PACS by accession', async () => {
    render(<Radiology />)
    fireEvent.click(await screen.findByRole('button', { name: /In progress \(1\)/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    expect(screen.getByRole('link', { name: 'Images (PACS)' }).getAttribute('href')).toBe('https://pacs.example/view?acc=RAD261115-00001')
    fireEvent.change(screen.getByLabelText('Fetal cardiac activity'), { target: { value: 'Absent' } })
    expect(screen.getByText(/looks like a critical finding/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Write findings from the fields above/ }))
    expect(screen.getByLabelText('Findings').value).toBe('Fetal cardiac activity: Absent')
    fireEvent.click(screen.getByLabelText('Critical result'))
    fireEvent.change(screen.getByLabelText('Critical finding'), { target: { value: 'No fetal heart activity' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }))
    await waitFor(() => expect(db.writes.find((w) => w[2].status === 'Reported')).toBeTruthy())
    expect(db.writes.find((w) => w[2].status === 'Reported')[2]).toMatchObject({ template: 'obstetric_us', critical: true, critical_finding: 'No fetal heart activity', structured: { cardiac: 'Absent' } })
  })
})
