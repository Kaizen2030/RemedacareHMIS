// Department pages connected to the clinic: specialty forms inside Review patient, follow-up booked into the diary,
// the clinic diary on the page, and clinical resources.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HospitalContext } from '../../context'
import { localDateKey } from '../../utils/scheduling'

const H = '11111111-1111-1111-1111-111111111111'
const TODAY = localDateKey(new Date())
const db = { tables: {}, writes: [], rpc: {} }

vi.mock('../../supabase', () => {
  const from = (table) => {
    const st = { op: 'select', payload: null }
    const result = () => {
      if (st.op !== 'select') { db.writes.push([table, st.op, st.payload]); return { data: st.op === 'insert' ? { id: 'new' } : null, error: null } }
      return { data: db.tables[table] || [], error: null }
    }
    const q = {}
    for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'ilike', 'like', 'or', 'not', 'order', 'limit', 'range']) q[m] = () => q
    q.insert = (p) => { st.op = 'insert'; st.payload = p; return q }
    q.update = (p) => { st.op = 'update'; st.payload = p; return q }
    q.upsert = (p) => { st.op = 'upsert'; st.payload = p; return q }
    q.delete = () => { st.op = 'delete'; return q }
    q.single = () => Promise.resolve(result()).then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] || null : r.data }))
    q.maybeSingle = q.single
    q.then = (res, rej) => Promise.resolve(result()).then(res, rej)
    return q
  }
  const channel = () => { const c = { on: () => c, subscribe: () => c, unsubscribe: () => {} }; return c }
  const storage = { from: (bucket) => ({
    upload: (path) => { db.writes.push(['storage', 'upload', { bucket, path }]); return Promise.resolve({ data: { path }, error: null }) },
    remove: (paths) => { db.writes.push(['storage', 'remove', { bucket, paths }]); return Promise.resolve({ data: [], error: null }) },
    createSignedUrl: (path) => Promise.resolve({ data: { signedUrl: `https://files.test/${path}` }, error: null }),
  }) }
  const auth = { getUser: () => Promise.resolve({ data: { user: { id: 'u-me' } } }) }
  return { default: { from, rpc: (name) => Promise.resolve({ data: db.rpc[name] ?? null, error: null }), channel, removeChannel: () => {}, storage, auth } }
})

// the whole department page mounts in each test (every tab stays mounted for its count); allow for a busy parallel run
vi.setConfig({ testTimeout: 15000 })
const DepartmentDetail = (await import('./index')).default
const navigate = vi.fn()
const show = (department, role = 'Doctor') => render(
  <HospitalContext.Provider value={{ hospitalId: H, hospitalName: 'Test Hospital', userRole: role, refreshDepartments: () => {}, navigate,
    departments: [{ id: 'd1', name: department, dept_type: 'clinical' }, { id: 'd2', name: 'Cardiology', dept_type: 'clinical' }] }}>
    <MemoryRouter><DepartmentDetail department={department} onBack={() => {}} /></MemoryRouter>
  </HospitalContext.Provider>)

// sections are tabs now: open the tab that holds a section before looking inside it
const TAB_OF = { Staff: 'Staff', Inpatients: 'Inpatients', 'Services and prices': 'Services', Referrals: 'Referrals', 'Clinic diary': 'Clinic diary', 'Clinical resources': 'Overview' }
const openTab = async (label) => fireEvent.click(await screen.findByRole('tab', { name: new RegExp('^' + label) }))
const region = async (name) => { await openTab(TAB_OF[name]); return screen.findByRole('region', { name }) }
const reviewButton = async () => { await openTab('Queue'); return screen.findByRole('button', { name: 'Review patient' }) }

beforeEach(() => {
  db.writes = []
  db.rpc = {}
  navigate.mockReset()
  db.tables = {
    visits: [{ id: 'v1', visit_id: 'VIS-1', patient_id: 'p1', status: 'Doctor', speciality: 'Neurology', patients: { full_name: 'TEST PATIENT 08', age: 70, gender: 'Male' }, chief_complaint: 'Sudden right-sided weakness', created_at: new Date().toISOString() }],
    appointments: [
      { id: 'a1', appointment_date: TODAY, start_time: '10:30:00', department: 'Neurology', appointment_type: 'Review', doctor_name: 'Dr N', status: 'Scheduled', patients: { full_name: 'TEST PATIENT 20', patient_number: 'P-20' } },
      { id: 'a2', appointment_date: TODAY, start_time: '11:00:00', department: 'Cardiology', appointment_type: 'Review', doctor_name: 'Dr C', status: 'Scheduled', patients: { full_name: 'OTHER CLINIC PATIENT' } },
    ],
    consultations: [], staff: [], specialty_assessments: [], referrals: [],
  }
})

const REFERRAL = { id: 'r1', visit_id: 'v9', patient_name: 'TEST PATIENT 30', referring_department: 'Neurology', referring_doctor: 'Dr N', receiving_department: 'Cardiology',
  referral_reason: 'New atrial fibrillation', urgency: 'Urgent', status: 'Sent', status_notes: [], created_at: new Date().toISOString() }

describe('large staff lists', () => {
  it('shows 25 at a time with pages, a role filter with counts and a search', async () => {
    db.tables.staff = [
      ...Array.from({ length: 52 }, (_, i) => ({ id: `n${i}`, full_name: `Nurse ${String(i).padStart(2, '0')} (test)`, job_title: 'Nursing Officer', status: 'Active' })),
      ...Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, full_name: `Doctor ${i} (test)`, job_title: 'Medical Officer', status: 'Active' })),
    ]
    show('Neurology')
    const box = await region('Staff')
    const rows = () => within(box).getAllByRole('row').length - 1
    await waitFor(() => expect(rows()).toBe(25))
    expect(within(box).getByText('1–25 of 60')).toBeTruthy()
    fireEvent.click(within(box).getByRole('button', { name: 'Next ›' }))
    expect(within(box).getByText('26–50 of 60')).toBeTruthy()
    fireEvent.click(within(box).getByRole('button', { name: 'Doctors (8)' }))
    expect(rows()).toBe(8)
    expect(within(box).queryByText('1–25 of 60')).toBeNull()
    fireEvent.click(within(box).getByRole('button', { name: 'All (60)' }))
    fireEvent.change(within(box).getByLabelText('Search staff'), { target: { value: 'nurse 07' } })
    expect(rows()).toBe(1)
  })
})

describe('inpatients under the department', () => {
  const past = (d) => localDateKey(new Date(Date.now() - d * 86400000))
  it('lists active admissions under this department with days in and overdue discharge', async () => {
    db.tables.admissions = [
      { id: 'ad1', patient_id: 'p1', status: 'Active', admitting_department: 'Neurology', ward: 'Medical Ward', bed_no: 'M-04', admission_date: new Date(Date.now() - 5 * 86400000).toISOString(), admitting_doctor: 'Dr N', target_discharge_date: past(1), resuscitation_status: 'DNACPR' },
      { id: 'ad2', patient_id: 'p2', status: 'Active', admitting_department: 'neurology clinic', ward: 'HDU', bed_no: 'H-1', admission_date: new Date().toISOString() },
      { id: 'ad3', patient_id: 'p3', status: 'Active', admitting_department: 'Cardiology', ward: 'CCU', bed_no: 'C-2' },
      { id: 'ad4', patient_id: 'p4', status: 'Discharged', admitting_department: 'Neurology' },
    ]
    db.tables.patients = [{ id: 'p1', full_name: 'TEST PATIENT 50', patient_number: 'P-50', age: 68 }, { id: 'p2', full_name: 'TEST PATIENT 51' }]
    show('Neurology')
    const box = await region('Inpatients')
    expect(await within(box).findByText('TEST PATIENT 50')).toBeTruthy()
    expect(within(box).getByText('TEST PATIENT 51')).toBeTruthy()
    expect(within(box).getAllByRole('row').length).toBe(3)
    expect(within(box).getByText('Medical Ward · Bed M-04')).toBeTruthy()
    expect(within(box).getByText(/\(overdue\)/)).toBeTruthy()
    expect(within(box).getByText(/Resus: DNACPR/)).toBeTruthy()
    expect(within(box).getByText(/1 past the expected discharge date/)).toBeTruthy()
  })
})

describe('department services and prices', () => {
  const CODES = [
    { id: 'cc1', code: 'CONS-NEURO', name: 'Neurology consultation', department: 'Neurology', category: 'Consultation', unit_price_kes: 2500, is_active: true },
    { id: 'cc2', code: 'PROC-NEURO-EEG', name: 'Electroencephalogram (EEG)', department: 'neurology ', category: 'Procedure', unit_price_kes: 3500, is_active: true },
    { id: 'cc3', code: 'PROC-NEURO-LUMBAR-PUNCTURE', name: 'Lumbar puncture', department: 'Neurology', category: 'Procedure', unit_price_kes: 2000, is_active: true },
    { id: 'cc4', code: 'PROC-CARDIO-ECG', name: 'Resting ECG (12-lead)', department: 'Cardiology', category: 'Procedure', unit_price_kes: 1500, is_active: true },
  ]

  it('services ticked in Review patient go on one unpaid invoice for the cashier', async () => {
    db.tables.charge_codes = CODES
    show('Neurology')
    fireEvent.click(await reviewButton())
    expect(await screen.findByLabelText(/Electroencephalogram \(EEG\)/)).toBeTruthy()
    expect(screen.queryByLabelText(/Neurology consultation/)).toBeNull()
    expect(screen.queryByLabelText(/Resting ECG/)).toBeNull()
    fireEvent.click(screen.getByLabelText(/Electroencephalogram \(EEG\)/))
    fireEvent.click(screen.getByLabelText(/Lumbar puncture/))
    fireEvent.change(screen.getByLabelText('Quantity of Lumbar puncture'), { target: { value: '2' } })
    fireEvent.change(screen.getByPlaceholderText('Dr. — Neurology'), { target: { value: 'Dr N' } })
    fireEvent.change(screen.getByPlaceholderText('Primary diagnosis...'), { target: { value: 'Seizure disorder' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete specialist consultation' }))
    await waitFor(() => expect(db.writes.some(([t, op, p]) => t === 'invoices' && op === 'insert' && /^WF\|Procedure/.test(p.notes))).toBe(true))
    const inv = db.writes.find(([t, op, p]) => t === 'invoices' && /^WF\|Procedure/.test(p.notes))[2]
    const lines = JSON.parse(inv.services)
    expect(lines.map((l) => [l.label, l.qty, l.total])).toEqual([['Electroencephalogram (EEG)', 1, 3500], ['Lumbar puncture', 2, 4000]])
    expect(inv).toMatchObject({ patient_id: 'p1', visit_id: 'v1', payment_method: 'Cash' })
    expect(Number(inv.balance_kes ?? inv.total_kes ?? inv.amount_kes)).toBe(7500)
  })

  it('administrators add common services for the department with their own price', async () => {
    db.tables.charge_codes = []
    db.rpc = { services_can_manage: true }
    show('Dental', 'Admin')
    const box = await region('Services and prices')
    fireEvent.click(await within(box).findByRole('button', { name: /Add common Dental services/ }))
    fireEvent.click(within(box).getAllByRole('button', { name: 'Add' })[0])
    expect(within(box).getByRole('alert').textContent).toMatch(/Enter a price/)
    fireEvent.change(within(box).getByLabelText('Price for Simple tooth extraction'), { target: { value: '1500' } })
    fireEvent.click(within(box).getAllByRole('button', { name: 'Add' })[0])
    await waitFor(() => expect(db.writes.some(([t]) => t === 'charge_codes')).toBe(true))
    expect(db.writes.find(([t]) => t === 'charge_codes')[2]).toMatchObject({ code: 'PROC-DENT-SIMPLE-TOOTH-EXTRACTION', name: 'Simple tooth extraction', department: 'Dental', category: 'Procedure', unit_price_kes: 1500, is_active: true })
  })

  it('clinicians see the price list but cannot add services', async () => {
    db.tables.charge_codes = CODES
    show('Neurology')
    const box = await region('Services and prices')
    expect(await within(box).findByText('Lumbar puncture')).toBeTruthy()
    expect(within(box).queryByRole('button', { name: /Add common/ })).toBeNull()
  })
})

describe('department referrals', () => {
  it('referring from Review patient creates a referral record for the receiving department', async () => {
    show('Neurology')
    fireEvent.click(await reviewButton())
    fireEvent.change(screen.getByPlaceholderText('Dr. — Neurology'), { target: { value: 'Dr N' } })
    fireEvent.change(screen.getByPlaceholderText('Primary diagnosis...'), { target: { value: 'Stroke with new AF' } })
    fireEvent.click(screen.getByRole('button', { name: 'Refer to Specialist' }))
    fireEvent.change(screen.getByLabelText('Refer to Department *'), { target: { value: 'Cardiology' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete specialist consultation' }))
    await waitFor(() => expect(db.writes.some(([t, op]) => t === 'referrals' && op === 'insert')).toBe(true))
    const ref = db.writes.find(([t, op]) => t === 'referrals' && op === 'insert')[2]
    expect(ref).toMatchObject({ visit_id: 'v1', patient_id: 'p1', patient_name: 'TEST PATIENT 08', referring_department: 'Neurology', receiving_department: 'Cardiology',
      status: 'Sent', referring_doctor: 'Dr N', receiving_facility: 'Test Hospital', diagnosis_label: 'Stroke with new AF' })
    const visit = db.writes.find(([t, op]) => t === 'visits' && op === 'update')[2]
    expect(visit).toMatchObject({ speciality: 'Cardiology', status: 'Doctor' })
  })

  it('the receiving department sees it in its inbox and accepts it', async () => {
    db.tables.referrals = [REFERRAL]
    show('Cardiology')
    const box = await region('Referrals')
    expect(await within(box).findByText('TEST PATIENT 30')).toBeTruthy()
    expect(within(box).getByText('Waiting to be accepted')).toBeTruthy()
    fireEvent.click(within(box).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(db.writes.some(([t, op, p]) => t === 'referrals' && op === 'update' && p.status === 'Received')).toBe(true))
  })

  it('declining needs a reason and sends the patient back to the referring department', async () => {
    db.tables.referrals = [REFERRAL]
    show('Cardiology')
    const box = await region('Referrals')
    fireEvent.click(await within(box).findByRole('button', { name: 'Decline' }))
    fireEvent.click(within(box).getByRole('button', { name: 'Confirm decline' }))
    expect(db.writes.some(([t]) => t === 'referrals')).toBe(false)
    fireEvent.change(within(box).getByLabelText('Reason for declining'), { target: { value: 'Rate controlled; manage in Neurology, echo booked' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Confirm decline' }))
    await waitFor(() => expect(db.writes.some(([t, op]) => t === 'visits' && op === 'update')).toBe(true))
    expect(db.writes.find(([t]) => t === 'referrals')[2]).toMatchObject({ status: 'Declined', declined_reason: 'Rate controlled; manage in Neurology, echo booked' })
    expect(db.writes.find(([t]) => t === 'visits')[2]).toMatchObject({ speciality: 'Neurology', status: 'Doctor', assigned_doctor_name: 'Dr N' })
  })

  it('when the receiving department completes the consultation, the referral is closed as seen', async () => {
    db.tables.referrals = [{ ...REFERRAL, status: 'Received' }]
    db.tables.visits = [{ id: 'v9', visit_id: 'VIS-9', patient_id: 'p9', status: 'Doctor', speciality: 'Cardiology', patients: { full_name: 'TEST PATIENT 30' }, created_at: new Date().toISOString() }]
    show('Cardiology')
    fireEvent.click(await reviewButton())
    fireEvent.change(screen.getByPlaceholderText('Dr. — Cardiology'), { target: { value: 'Dr C' } })
    fireEvent.change(screen.getByPlaceholderText('Primary diagnosis...'), { target: { value: 'Atrial fibrillation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete specialist consultation' }))
    await waitFor(() => expect(db.writes.some(([t, op, p]) => t === 'referrals' && op === 'update' && p.status === 'Completed')).toBe(true))
  })

  it('the referring department follows it under "Sent from here"; other departments do not see it', async () => {
    db.tables.referrals = [{ ...REFERRAL, status: 'Declined', declined_reason: 'Manage in Neurology' }]
    show('Neurology')
    const box = await region('Referrals')
    fireEvent.click(within(box).getByRole('tab', { name: /Sent from here \(1\)/ }))
    expect(within(box).getByText('Declined: Manage in Neurology')).toBeTruthy()
    expect(within(box).getByRole('tab', { name: 'Incoming (0)' })).toBeTruthy()
  })
})

describe('connected department page', () => {
  it('shows today\'s clinic diary for this department only, and books inside the department', async () => {
    db.tables.staff = [{ id: 'doc1', full_name: 'Dr Neuro (test)', job_title: 'Medical Officer', status: 'Active' }, { id: 'sup1', full_name: 'Cleaner (test)', job_title: 'Cleaner', status: 'Active' }]
    db.tables.patients = [{ id: 'p5', full_name: 'TEST PATIENT 50', patient_number: 'P-50', phone: '' }]
    show('Neurology')
    const diary = await region('Clinic diary')
    expect(await within(diary).findByText('TEST PATIENT 20')).toBeTruthy()
    expect(within(diary).queryByText('OTHER CLINIC PATIENT')).toBeNull()
    expect(within(diary).getByText('10:30')).toBeTruthy()
    fireEvent.click(within(diary).getByRole('button', { name: 'Book appointment' }))
    const form = within(diary).getByRole('group', { name: 'Book an appointment' })
    expect(within(form).getByLabelText('Clinician').textContent).not.toContain('Cleaner') // clinicians of this department only
    fireEvent.click(within(form).getByRole('button', { name: 'Book appointment' }))
    expect(within(form).getByRole('alert').textContent).toContain('Choose the patient, clinician, date and time')
    fireEvent.change(within(form).getByLabelText('Patient'), { target: { value: 'TEST' } })
    fireEvent.click(await within(form).findByRole('option', { name: /TEST PATIENT 50/ }))
    fireEvent.change(within(form).getByLabelText('Clinician'), { target: { value: 'doc1' } })
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2099-03-02' } })
    fireEvent.change(within(form).getByLabelText('Time'), { target: { value: '09:30' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Book appointment' }))
    await waitFor(() => expect(db.writes.some(([t, op]) => t === 'appointments' && op === 'insert')).toBe(true))
    expect(db.writes.find(([t, op]) => t === 'appointments' && op === 'insert')[2]).toMatchObject({
      hospital_id: H, patient_id: 'p5', doctor_id: 'doc1', doctor_name: 'Dr Neuro (test)', department: 'Neurology',
      appointment_date: '2099-03-02', start_time: '09:30', end_time: '10:00', status: 'Scheduled', appointment_type: 'Follow-up' })
    expect(await within(diary).findByText(/Booked: TEST PATIENT 50, 2099-03-02 at 09:30/)).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('cancelling a booking in the diary needs a reason', async () => {
    show('Neurology')
    const diary = await region('Clinic diary')
    await within(diary).findByText('TEST PATIENT 20')
    fireEvent.click(within(diary).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(diary).getByRole('button', { name: 'Confirm cancel' }))
    expect(within(diary).getByRole('alert').textContent).toContain('Give the reason for cancelling')
    fireEvent.change(within(diary).getByLabelText('Reason for cancelling'), { target: { value: 'Patient travelling' } })
    fireEvent.click(within(diary).getByRole('button', { name: 'Confirm cancel' }))
    await waitFor(() => expect(db.writes.some(([t, op]) => t === 'appointments' && op === 'update')).toBe(true))
    expect(db.writes.find(([t]) => t === 'appointments')[2]).toEqual({ status: 'Cancelled', cancellation_reason: 'Patient travelling' })
  })

  it('Review patient opens the neurology form, and a follow-up is booked into the diary on save', async () => {
    show('Neurology')
    fireEvent.click(await reviewButton())
    expect((await screen.findAllByText('Neurology assessment')).length).toBeGreaterThan(0)
    expect(screen.getByText(/NIH Stroke Scale/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Dr. — Neurology'), { target: { value: 'Dr N' } })
    fireEvent.change(screen.getByPlaceholderText('Primary diagnosis...'), { target: { value: 'Ischaemic stroke' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Home' }))
    fireEvent.change(screen.getByLabelText('Follow-up date (if needed)'), { target: { value: '2026-12-01' } })
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '14:15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete specialist consultation' }))
    await waitFor(() => expect(db.writes.some(([t, op]) => t === 'appointments' && op === 'insert')).toBe(true))
    const appt = db.writes.find(([t]) => t === 'appointments')[2]
    expect(appt).toMatchObject({ patient_id: 'p1', department: 'Neurology', appointment_type: 'Follow-up', appointment_date: '2026-12-01', start_time: '14:15', end_time: '14:45', status: 'Scheduled', doctor_name: 'Dr N', visit_id: 'v1' })
    expect(appt.notes).toMatch(/Ischaemic stroke/)
  })

  it('a follow-up is not booked when the box is unticked', async () => {
    show('Neurology')
    fireEvent.click(await reviewButton())
    fireEvent.change(screen.getByPlaceholderText('Dr. — Neurology'), { target: { value: 'Dr N' } })
    fireEvent.change(screen.getByPlaceholderText('Primary diagnosis...'), { target: { value: 'Migraine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Home' }))
    fireEvent.change(screen.getByLabelText('Follow-up date (if needed)'), { target: { value: '2026-12-01' } })
    fireEvent.click(screen.getByLabelText(/Book it in the Neurology clinic diary/))
    fireEvent.click(screen.getByRole('button', { name: 'Complete specialist consultation' }))
    await waitFor(() => expect(db.writes.some(([t]) => t === 'consultations')).toBe(true))
    expect(db.writes.some(([t]) => t === 'appointments')).toBe(false)
  })

  it('clinical departments link their care pathways and guides', async () => {
    show('Paediatrics')
    const res = await region('Clinical resources')
    expect(within(res).getByRole('button', { name: 'Pneumonia in children 2 months to 5 years' })).toBeTruthy()
    fireEvent.click(within(res).getByRole('button', { name: 'Diarrhoea and dehydration in children' }))
    expect(navigate).toHaveBeenCalledWith('care-pathways', { suggestedProtocol: 'diarrhoea-child', source: 'department' })
  })
})

describe('department tabs', () => {
  it('shows one section at a time; the buttons carry counts and the overview links to waiting work', async () => {
    db.tables.referrals = [{ ...REFERRAL, receiving_department: 'Neurology' }]
    show('Neurology')
    const tabs = await screen.findByRole('tablist', { name: 'Department sections' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent.replace(/\d+$/, ''))).toEqual(
      ['Overview', 'Queue', 'Referrals', 'Results', 'Inpatients', 'Clinic diary', 'Duty roster', 'Leave', 'Staff', 'Services', 'Protocols', 'Report'])
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('region', { name: 'Referrals' })).toBeNull() // hidden until its tab is chosen
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Referrals/ }).textContent).toBe('Referrals1'))
    fireEvent.click(await screen.findByRole('button', { name: /referrals to accept/ }))
    expect(screen.getByRole('tab', { name: /^Referrals/ }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('region', { name: 'Referrals' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Clinic diary' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('tab', { name: /^Referrals/ }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /^Results/ }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('department-run duty roster and leave', () => {
  const STAFF = [
    { id: 's1', full_name: 'Ina In-Charge (test)', job_title: 'Ward In-Charge', status: 'Active' },
    { id: 's2', full_name: 'Kevin Nurse (test)', job_title: 'Nursing Officer', status: 'Active' },
  ]
  beforeEach(() => {
    db.tables.staff = STAFF
    db.tables.hr_shift_types = [{ code: 'D', label: 'Day', hours: 12 }, { code: 'N', label: 'Night', hours: 12 }, { code: 'OFF', label: 'Off', hours: 0 }]
    db.tables.staff_shifts = []
  })

  it('a department manager sets shifts on the weekly roster; the shift is filed under the department', async () => {
    db.rpc = { dept_manages: true }
    show('Neurology')
    fireEvent.click(await screen.findByRole('tab', { name: /^Duty roster/ }))
    const box = await screen.findByRole('region', { name: 'Duty roster' })
    const cells = await within(box).findAllByRole('combobox', { name: /^Kevin Nurse \(test\), / })
    expect(cells).toHaveLength(7)
    fireEvent.change(cells[0], { target: { value: 'N' } })
    await waitFor(() => expect(db.writes.some(([t, op]) => t === 'staff_shifts' && op === 'insert')).toBe(true))
    expect(db.writes.find(([t, op]) => t === 'staff_shifts' && op === 'insert')[2]).toMatchObject({ hospital_id: H, staff_id: 's2', shift_code: 'N', unit: 'Neurology' })
    expect(screen.queryByRole('region', { name: 'Department managers' })).toBeNull() // only HR or an administrator appoints managers
  })

  it('staff who do not run the department see the roster but cannot change it', async () => {
    db.tables.staff_shifts = [{ id: 'x1', staff_id: 's2', shift_date: TODAY, shift_code: 'D' }]
    show('Neurology', 'Nurse')
    fireEvent.click(await screen.findByRole('tab', { name: /^Duty roster/ }))
    const box = await screen.findByRole('region', { name: 'Duty roster' })
    expect(await within(box).findByText(/Only Neurology's managers, HR or an administrator/)).toBeTruthy()
    expect(within(box).queryAllByRole('combobox')).toHaveLength(0)
  })

  it('HR appoints department managers who run the roster and approve leave', async () => {
    db.rpc = { dept_manages: true, hr_can_manage: true }
    db.tables.department_managers = []
    show('Neurology', 'Admin')
    fireEvent.click(await screen.findByRole('tab', { name: /^Duty roster/ }))
    const box = await screen.findByRole('region', { name: 'Department managers' })
    fireEvent.change(within(box).getByLabelText('Staff member to make a manager'), { target: { value: 's1' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Make manager' }))
    await waitFor(() => expect(db.writes.some(([t, op]) => t === 'department_managers' && op === 'insert')).toBe(true))
    expect(db.writes.find(([t]) => t === 'department_managers')[2]).toMatchObject({ department: 'Neurology', staff_id: 's1', can_roster: true, can_approve_leave: true })
  })

  it('the leave approver decides requests in the department; rejecting needs a reason', async () => {
    db.rpc = { dept_manages: true }
    db.tables.staff_leave = [
      { id: 'l1', staff_id: 's2', leave_type: 'Annual', start_date: '2099-01-05', end_date: '2099-01-09', days: 5, status: 'requested' },
      { id: 'l2', staff_id: 's1', leave_type: 'Annual', start_date: '2099-02-05', end_date: '2099-02-09', days: 5, status: 'requested' },
    ]
    show('Neurology')
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Leave/ }).textContent).toBe('Leave2'))
    fireEvent.click(screen.getByRole('tab', { name: /^Leave/ }))
    const box = await screen.findByRole('region', { name: 'Leave requests' })
    fireEvent.click(within(box).getAllByRole('button', { name: 'Approve' })[0])
    await waitFor(() => expect(db.writes.some(([t, op, p]) => t === 'staff_leave' && op === 'update' && p.status === 'approved')).toBe(true))
    fireEvent.click(within(box).getAllByRole('button', { name: 'Reject' })[1])
    fireEvent.click(within(box).getByRole('button', { name: 'Confirm reject' }))
    expect((await within(box).findByRole('alert')).textContent).toContain('Give the reason for rejecting.')
    fireEvent.change(within(box).getByLabelText('Reason for rejecting'), { target: { value: 'Two others already away that week' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Confirm reject' }))
    await waitFor(() => expect(db.writes.some(([t, , p]) => t === 'staff_leave' && p?.status === 'rejected')).toBe(true))
    expect(db.writes.find(([, , p]) => p?.status === 'rejected')[2]).toMatchObject({ decision_note: 'Two others already away that week' })
  })
})

describe('my leave on the department page', () => {
  it('staff see days left, apply for leave and cancel a waiting request', async () => {
    db.tables.staff = [{ id: 's2', full_name: 'Kevin Nurse (test)', job_title: 'Nursing Officer', status: 'Active' }]
    db.tables.staff_leave = [{ id: 'm1', staff_id: 's2', leave_type: 'Sick Leave', start_date: '2099-01-02', end_date: '2099-01-03', working_days: 2, status: 'requested' }]
    db.tables.hr_leave_entitlements = [{ leave_type: 'Annual Leave', hospital_id: null }, { leave_type: 'Sick Leave', hospital_id: null }]
    db.rpc = { hr_my_staff_id: 's2', leave_balances: { 'Annual Leave': { entitled: 21, used: 5, pending: 0 } } }
    show('Neurology', 'Nurse')
    fireEvent.click(await screen.findByRole('tab', { name: /^Leave/ }))
    const box = await screen.findByRole('region', { name: 'My leave' })
    expect(within(box).getByText('Annual Leave')).toBeTruthy()
    expect(within(box).getByText('16')).toBeTruthy() // 21 - 5 days left
    fireEvent.click(within(box).getByRole('button', { name: 'Apply for leave' }))
    fireEvent.click(within(box).getByRole('button', { name: 'Send request' }))
    expect(within(box).getByRole('alert').textContent).toContain('Choose the first and last day')
    fireEvent.change(within(box).getByLabelText('First day'), { target: { value: '2099-04-06' } })
    fireEvent.change(within(box).getByLabelText('Last day'), { target: { value: '2099-04-10' } })
    fireEvent.change(within(box).getByLabelText('Reason (optional)'), { target: { value: 'Family travel' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Send request' }))
    await waitFor(() => expect(db.writes.some(([t, op]) => t === 'staff_leave' && op === 'insert')).toBe(true))
    expect(db.writes.find(([t, op]) => t === 'staff_leave' && op === 'insert')[2]).toMatchObject({
      hospital_id: H, staff_id: 's2', leave_type: 'Annual Leave', start_date: '2099-04-06', end_date: '2099-04-10', reason: 'Family travel', status: 'requested' })
    expect(await within(box).findByText(/Leave requested/)).toBeTruthy()
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(db.writes.some(([t, op, p]) => t === 'staff_leave' && op === 'update' && p.status === 'cancelled')).toBe(true))
  })

  it('a login without a staff record is told to ask HR', async () => {
    show('Neurology', 'Nurse')
    fireEvent.click(await screen.findByRole('tab', { name: /^Leave/ }))
    const box = await screen.findByRole('region', { name: 'My leave' })
    expect(within(box).getByText(/not linked to a staff record/)).toBeTruthy()
    expect(within(box).queryByRole('button', { name: 'Apply for leave' })).toBeNull()
  })
})

describe('leave approvers and their own requests', () => {
  it('an approver sees their own request without Approve or Reject', async () => {
    db.tables.staff = [{ id: 's1', full_name: 'Ina In-Charge (test)', job_title: 'Ward In-Charge', status: 'Active' }, { id: 's2', full_name: 'Kevin Nurse (test)', job_title: 'Nursing Officer', status: 'Active' }]
    db.tables.staff_leave = [
      { id: 'o1', staff_id: 's1', leave_type: 'Annual Leave', start_date: '2099-05-04', end_date: '2099-05-08', status: 'requested' },
      { id: 'o2', staff_id: 's2', leave_type: 'Annual Leave', start_date: '2099-06-01', end_date: '2099-06-05', status: 'requested' },
    ]
    db.rpc = { dept_manages: true, hr_my_staff_id: 's1' }
    show('Neurology', 'Nurse')
    fireEvent.click(await screen.findByRole('tab', { name: /^Leave/ }))
    const box = await screen.findByRole('region', { name: 'Leave requests' })
    expect(await within(box).findByText(/Your own request: another approver decides/)).toBeTruthy()
    expect(within(box).getAllByRole('button', { name: 'Approve' })).toHaveLength(1) // only Kevin's
  })
})

describe('managing department services', () => {
  const CODES = [
    { id: 'cc2', code: 'PROC-NEURO-EEG', name: 'Electroencephalogram (EEG)', department: 'Neurology', category: 'Procedure', unit_price_kes: 3500, is_active: true },
    { id: 'cc3', code: 'PROC-NEURO-LUMBAR-PUNCTURE', name: 'Lumbar puncture', department: 'Neurology', category: 'Procedure', unit_price_kes: 2000, is_active: true },
    { id: 'cc5', code: 'PROC-NEURO-OLD', name: 'Old procedure', department: 'Neurology', category: 'Procedure', unit_price_kes: 900, is_active: false, retired_reason: 'Not offered' },
  ]
  const open = async () => { db.tables.charge_codes = CODES; db.rpc = { services_can_manage: true, service_remove: 'retired' }; show('Neurology', 'Accountant'); return region('Services and prices') }

  it('adds a new service of the department with its own code, category, price and description', async () => {
    const box = await open()
    fireEvent.click(await within(box).findByRole('button', { name: 'Add a service' }))
    const form = within(box).getByRole('group', { name: 'New service' })
    fireEvent.click(within(form).getByRole('button', { name: 'Save service' }))
    expect(within(box).getByRole('alert').textContent).toContain('Give the service a name')
    fireEvent.change(within(form).getByLabelText('Service name'), { target: { value: 'Nerve conduction study' } })
    expect(within(form).getByLabelText('Code').value).toBe('PROC-NEURO-NERVE-CONDUCTION-STUDY')
    fireEvent.change(within(form).getByLabelText('Category'), { target: { value: 'Therapy' } })
    fireEvent.change(within(form).getByLabelText('Cash price (KES)'), { target: { value: '4500' } })
    fireEvent.change(within(form).getByLabelText('Description or preparation (optional)'), { target: { value: 'Both arms' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save service' }))
    await waitFor(() => expect(db.writes.some(([t, op]) => t === 'charge_codes' && op === 'insert')).toBe(true))
    expect(db.writes.find(([t]) => t === 'charge_codes')[2]).toMatchObject({ hospital_id: H, department: 'Neurology', name: 'Nerve conduction study', code: 'PROC-NEURO-NERVE-CONDUCTION-STUDY', category: 'Therapy', unit_price_kes: 4500, description: 'Both arms', is_active: true })
  })

  it('edits the name, price and description; the code stays so old bills still match', async () => {
    const box = await open()
    fireEvent.click(await within(box).findByRole('button', { name: 'Edit Lumbar puncture' }))
    const form = within(box).getByRole('group', { name: 'Edit Lumbar puncture' })
    expect(within(form).getByLabelText('Code').readOnly).toBe(true)
    fireEvent.change(within(form).getByLabelText('Cash price (KES)'), { target: { value: '2600' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(db.writes.some(([t, op]) => t === 'charge_codes' && op === 'update')).toBe(true))
    expect(db.writes.find(([t]) => t === 'charge_codes')[2]).toMatchObject({ name: 'Lumbar puncture', unit_price_kes: 2600 })
    expect(db.writes.find(([t]) => t === 'charge_codes')[2]).not.toHaveProperty('code')
  })

  it('removing a billed service retires it; retired services can be restored', async () => {
    const box = await open()
    fireEvent.click(await within(box).findByRole('button', { name: 'Remove Electroencephalogram (EEG)' }))
    fireEvent.change(within(box).getByLabelText('Reason for removing Electroencephalogram (EEG)'), { target: { value: 'Machine sold' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Confirm remove' }))
    expect(await within(box).findByText(/already on patients' bills, so it is retired instead/)).toBeTruthy()
    fireEvent.click(within(box).getByRole('button', { name: /^Retired \(1\)/ }))
    expect(within(box).getByText('Retired: Not offered')).toBeTruthy()
    fireEvent.click(within(box).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(db.writes.some(([t, op, p]) => t === 'charge_codes' && op === 'update' && p.is_active === true)).toBe(true))
  })

  it('staff without the right see the list without edit buttons', async () => {
    db.tables.charge_codes = CODES
    show('Neurology')
    const box = await region('Services and prices')
    expect(await within(box).findByText('Lumbar puncture')).toBeTruthy()
    expect(within(box).queryByRole('button', { name: 'Add a service' })).toBeNull()
    expect(within(box).queryByRole('button', { name: /^Edit / })).toBeNull()
    expect(within(box).queryByRole('button', { name: /^Remove / })).toBeNull()
  })
})

describe('department protocols', () => {
  const DOC = { id: 'pd1', hospital_id: H, department: 'Neurology', title: 'Status epilepticus protocol', kind: 'protocol', summary: 'Adults in the ward', body: '1. Lorazepam 4 mg IV.', revision: 2, must_read: true, status: 'active', file_path: `${H}/pd1/se.pdf`, file_name: 'se.pdf', review_on: '2020-01-01' }

  it('a manager publishes a protocol with written rules and a file', async () => {
    db.tables.department_documents = []
    db.rpc = { dept_can_publish: true }
    show('Neurology')
    fireEvent.click(await screen.findByRole('tab', { name: /^Protocols/ }))
    const box = await screen.findByRole('region', { name: 'Protocols and rules' })
    fireEvent.click(await within(box).findByRole('button', { name: 'Add protocol or document' }))
    const form = within(box).getByRole('group', { name: 'New document' })
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Stroke thrombolysis checklist' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Publish' }))
    expect(within(box).getByRole('alert').textContent).toContain('Attach a file or write the rules')
    fireEvent.change(within(form).getByLabelText(/Written rules or steps/), { target: { value: 'Door to needle under 60 minutes.' } })
    const file = new File(['%PDF-1.4'], 'stroke checklist.pdf', { type: 'application/pdf' })
    fireEvent.change(within(form).getByLabelText(/Attach a file/), { target: { files: [file] } })
    fireEvent.click(within(form).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(db.writes.some(([t, op]) => t === 'department_documents' && op === 'update')).toBe(true))
    expect(db.writes.find(([t, op]) => t === 'department_documents' && op === 'insert')[2]).toMatchObject({ hospital_id: H, department: 'Neurology', title: 'Stroke thrombolysis checklist', kind: 'protocol', must_read: true, body: 'Door to needle under 60 minutes.' })
    const up = db.writes.find(([t]) => t === 'storage')[2]
    expect(up.bucket).toBe('department-documents')
    expect(up.path).toMatch(new RegExp(`^${H}/new/\\d+-stroke-checklist\\.pdf$`))
    expect(db.writes.find(([t, op]) => t === 'department_documents' && op === 'update')[2]).toMatchObject({ file_name: 'stroke checklist.pdf', file_type: 'pdf' })
  })

  it('staff open a protocol, read it in the page and confirm reading the current revision', async () => {
    db.tables.department_documents = [DOC]
    db.tables.department_document_reads = []
    db.tables.department_document_history = [{ id: 'h1', document_id: 'pd1', revision: 1, title: 'Status epilepticus protocol', change_note: null, changed_at: '2026-01-01T08:00:00Z' }]
    show('Neurology', 'Nurse')
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Protocols/ }).textContent).toBe('Protocols1'))
    fireEvent.click(screen.getByRole('tab', { name: /^Protocols/ }))
    const list = await screen.findByRole('region', { name: 'Protocols and rules' })
    expect(within(list).getByText('Not read yet')).toBeTruthy()
    expect(within(list).getByText(/Review overdue since/)).toBeTruthy()
    expect(within(list).queryByRole('button', { name: 'Add protocol or document' })).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: 'Open Status epilepticus protocol' }))
    const reader = await screen.findByRole('region', { name: 'Status epilepticus protocol' })
    expect(within(reader).getByText('1. Lorazepam 4 mg IV.')).toBeTruthy()
    expect(await within(reader).findByTitle('PDF preview: se.pdf')).toBeTruthy()
    expect(within(reader).getByText('Earlier revisions')).toBeTruthy()
    expect(within(reader).queryByRole('button', { name: 'Update' })).toBeNull()
    fireEvent.click(within(reader).getByRole('button', { name: 'I have read and understood this' }))
    await waitFor(() => expect(db.writes.some(([t, op]) => t === 'department_document_reads' && op === 'insert')).toBe(true))
    expect(db.writes.find(([t]) => t === 'department_document_reads')[2]).toMatchObject({ document_id: 'pd1', revision: 2 })
  })
})
