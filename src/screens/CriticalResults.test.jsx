import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CriticalResults from './CriticalResults'
import ClinicalReferences from './ClinicalReferences'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [], rpc: {}, rpcCalls: [], storageOps: [] } }))
vi.mock('../supabase', () => {
  const from = (t) => {
    let upserted
    const q = {
      select: () => q, eq: () => q, neq: () => q, is: () => q, gte: () => q, order: () => q, limit: () => q,
      single: () => Promise.resolve({ data: upserted, error: null }),
      insert: (row) => {
        db.writes.push([t, 'insert', row])
        if (t === 'clinical_content_documents') {
          const saved = { ...row, id: 'doc1', created_at: new Date().toISOString() }
          db.tables[t] = [...(db.tables[t] || []), saved]
          return Promise.resolve({ error: null })
        }
        return { select: () => ({ single: () => Promise.resolve({ data: { ...row, id: 'l1', interpretation: 'toxic', advice: 'Trough too high: hold the next dose', warnings: [], target_text: 'Gentamicin trough: < 2 mg/L' }, error: null }) }) }
      },
      upsert: (row) => {
        db.writes.push([t, 'upsert', row])
        const rows = db.tables[t] || []
        const index = rows.findIndex((item) => item.hospital_id === row.hospital_id && item.content_type === row.content_type && item.content_id === row.content_id)
        const saved = { ...row, revision: index < 0 ? 1 : rows[index].revision + 1 }
        if (index < 0) rows.push(saved)
        else rows[index] = saved
        db.tables[t] = rows
        upserted = saved
        return q
      },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  const storage = {
    from: (bucket) => ({
      upload: (path, file, options) => { db.storageOps.push([bucket, 'upload', path, file.name, options]); return Promise.resolve({ error: null }) },
      createSignedUrl: (path) => Promise.resolve({ data: { signedUrl: `https://storage.test/${path}` }, error: null }),
      remove: (paths) => { db.storageOps.push([bucket, 'remove', paths]); return Promise.resolve({ error: null }) },
    }),
  }
  return { default: { from, storage, rpc: (fn, args) => { db.rpcCalls.push([fn, args]); return Promise.resolve({ data: db.rpc[fn] ?? null, error: null }) } } }
})
vi.mock('../context', () => ({ useHospital: () => ({ hospitalId: 'h1' }) }))
vi.mock('../components/PatientSearch', () => ({ default: ({ onPick }) => <button type="button" onClick={() => onPick({ id: 'p1', full_name: 'Bob' })}>pick patient</button> }))

const ALERT = { id: 'a1', kind: 'critical', status: 'open', patient_name: 'Jane', test_name: 'Urea & Electrolytes', ordered_by: 'Dr Achieng', message: 'Potassium 6.9 is critically high (critical ≥ 6.5)',
  drug_notes: [{ drug: 'Lisinopril', message: 'Raises potassium' }], detected_at: new Date(Date.now() - 600000).toISOString(), notify_due_at: new Date(Date.now() + 1200000).toISOString(), escalation_level: 0 }

beforeEach(() => {
  db.writes = []; db.rpcCalls = []; db.storageOps = []
  db.tables = { lab_critical_alerts: [ALERT], tdm_targets: [{ drug: 'Gentamicin', sample: 'trough', indication: 'traditional dosing', low: null, high: 2, high_exclusive: true, critical_high: 2, unit: 'mg/L' }], tdm_levels: [], clinical_content_documents: [] }
  db.rpc = { critical_escalate: 0, guide_can_approve: true }
})

describe('critical results screen', () => {
  it('shows the alert with the drug and requires read-back before the report is saved', async () => {
    render(<MemoryRouter><CriticalResults /></MemoryRouter>)
    expect(await screen.findByText('Potassium 6.9 is critically high (critical ≥ 6.5)')).toBeTruthy()
    expect(screen.getByText('Lisinopril')).toBeTruthy()
    expect(db.rpcCalls[0]).toEqual(['critical_escalate', { p_hospital: 'h1' }])
    fireEvent.click(screen.getByRole('button', { name: 'Record report' }))
    fireEvent.change(screen.getByLabelText('Told (name and ward)'), { target: { value: 'Sr Wanjiru' } })
    const save = screen.getByRole('button', { name: 'Save report' })
    expect(save.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('They read the result back to me'))
    fireEvent.click(save)
    await waitFor(() => expect(db.rpcCalls.find((c) => c[0] === 'critical_notify')[1]).toEqual({ p_alert: 'a1', p_notified_to: 'Sr Wanjiru', p_method: 'phone', p_read_back: true }))
  })

  it('TDM previews the interpretation and shows the saved advice', async () => {
    render(<MemoryRouter><CriticalResults /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Drug levels (TDM)' }))
    fireEvent.click(screen.getByRole('button', { name: 'pick patient' }))
    await screen.findByRole('option', { name: 'Gentamicin' })
    fireEvent.change(screen.getByLabelText('Drug'), { target: { value: 'Gentamicin' } })
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: '2.4' } })
    expect(screen.getByText('toxic')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save level' }))
    expect(await screen.findByText('Trough too high: hold the next dose')).toBeTruthy()
    expect(db.writes[0][2]).toMatchObject({ patient_id: 'p1', drug: 'Gentamicin', sample: 'trough', value: 2.4, unit: 'mg/L' })
  })

  it('staff without approval rights see the draft notice but no Approve or Edit buttons', async () => {
    db.rpc.guide_can_approve = false
    render(<MemoryRouter initialEntries={['/references?guide=sepsis']}><ClinicalReferences /></MemoryRouter>)
    expect(await screen.findByText(/Draft — not yet approved by this hospital/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit guide' })).toBeNull()
  })

  it('clinical guides open as drafts and a lead can approve the current version', async () => {
    db.rpc.guide_can_approve = true
    render(<MemoryRouter initialEntries={['/references?guide=sepsis']}><ClinicalReferences /></MemoryRouter>)
    expect(screen.getByRole('article', { name: /Sepsis: recognition/ })).toBeTruthy()
    expect(await screen.findByText(/Draft — not yet approved by this hospital/)).toBeTruthy()
    expect(screen.getByText(/FEAST trial/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve…' }))
    fireEvent.change(screen.getByLabelText('Approver name'), { target: { value: 'Dr Kamau' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve this version' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'clinical_guide_approvals')[2]).toMatchObject({ hospital_id: 'h1', guide_id: 'sepsis', version: '2026-11', approver_name: 'Dr Kamau' }))
  })

  it('saves guide edits as a new draft version and keeps the editor on the selected guide', async () => {
    render(<MemoryRouter initialEntries={['/references?guide=malaria']}><ClinicalReferences /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit guide' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Sepsis: revised local guide' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }))
    expect(await screen.findByRole('heading', { name: 'Sepsis: revised local guide' })).toBeTruthy()
    expect(screen.getAllByText(/version 2026-11-r1/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Draft — not yet approved/)).toBeTruthy()
    expect(db.writes.find((w) => w[0] === 'clinical_content_revisions')[2]).toMatchObject({
      hospital_id: 'h1', content_type: 'guide', content_id: 'malaria',
      content: { title: 'Sepsis: revised local guide', version: '2026-11' },
    })
  })

  it('creates a new hospital guide that can be reviewed and approved', async () => {
    render(<MemoryRouter><ClinicalReferences /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Add guide' }))
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Local policy' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Local antimicrobial policy' } })
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Hospital-specific treatment guidance.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
    fireEvent.change(screen.getByLabelText('Section heading'), { target: { value: 'Stewardship' } })
    fireEvent.change(screen.getByLabelText('Points (one per line)'), { target: { value: 'Review antibiotics after 48 hours.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create guide' }))
    expect(await screen.findByRole('heading', { name: 'Local antimicrobial policy' })).toBeTruthy()
    expect(screen.getByRole('article', { name: 'Local antimicrobial policy' })).toBeTruthy()
    expect(screen.getAllByText(/version 1.0/).length).toBeGreaterThan(0)
    expect(db.writes.find((w) => w[0] === 'clinical_content_revisions')[2]).toMatchObject({
      content_type: 'guide',
      content: { customGuide: true, title: 'Local antimicrobial policy', topic: 'Local policy', version: '1.0' },
    })
  })

  it('uploads a private PDF and opens its in-app preview', async () => {
    render(<MemoryRouter initialEntries={['/references?guide=sepsis']}><ClinicalReferences /></MemoryRouter>)
    const file = new File(['%PDF-1.4 example'], 'local-sepsis-guide.pdf', { type: 'application/pdf' })
    fireEvent.change(await screen.findByLabelText('Upload file'), { target: { files: [file] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Read: local-sepsis-guide.pdf' }))
    expect(await screen.findByTitle('PDF preview: local-sepsis-guide.pdf')).toBeTruthy()
    expect(db.storageOps[0][0]).toBe('clinical-content-files')
    expect(db.storageOps[0][1]).toBe('upload')
    expect(db.writes.find((w) => w[0] === 'clinical_content_documents')[2]).toMatchObject({
      hospital_id: 'h1', guide_id: 'sepsis', file_name: 'local-sepsis-guide.pdf', content_type: 'application/pdf',
    })
  })

  it('references page lists sources with links and filters by topic', async () => {
    render(<MemoryRouter initialEntries={['/references?topic=microbiology']}><ClinicalReferences /></MemoryRouter>)
    await screen.findAllByRole('button', { name: 'Edit' })
    const eucast = screen.getByRole('link', { name: /EUCAST Clinical Breakpoint Tables, version 16.1/ })
    expect(eucast.getAttribute('href')).toBe('https://www.eucast.org/clinical_breakpoints/')
    expect(screen.queryByText(/NEWS2/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'vancomycin' } })
    expect(screen.getByText(/Therapeutic monitoring of vancomycin/)).toBeTruthy()
  })

  it('persists hospital-specific reference edits without changing shipped reference data', async () => {
    render(<MemoryRouter initialEntries={['/references?topic=microbiology']}><ClinicalReferences /></MemoryRouter>)
    const editButtons = await screen.findAllByRole('button', { name: 'Edit' })
    fireEvent.click(editButtons[0])
    fireEvent.change(screen.getByLabelText('Publisher'), { target: { value: 'Local clinical library' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reference' }))
    await waitFor(() => expect(db.tables.clinical_content_revisions?.[0]?.content?.publisher).toBe('Local clinical library'))
    expect(await screen.findByText(/Local clinical library/)).toBeTruthy()
    expect(db.writes.find((w) => w[0] === 'clinical_content_revisions')[2]).toMatchObject({
      hospital_id: 'h1', content_type: 'reference',
      content: { publisher: 'Local clinical library' },
    })
  })
})
