import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HospitalWorkflowBoard from './HospitalWorkflowBoard'
import { HOSPITAL_WORKFLOW_MODULES } from './hospitalWorkflowModules'

const { state, navigate, realtimeChannel } = vi.hoisted(() => {
  const realtimeChannel = { on: vi.fn(), subscribe: vi.fn() }
  realtimeChannel.on.mockImplementation(() => realtimeChannel)
  realtimeChannel.subscribe.mockImplementation(() => realtimeChannel)
  return {
    state: { patients: [], visits: [], records: [], inserted: null, update: null, from: vi.fn() },
    navigate: vi.fn(),
    realtimeChannel,
  }
})

vi.mock('../supabase', () => ({ default: { from: state.from, channel: vi.fn(() => realtimeChannel), removeChannel: vi.fn() } }))
vi.mock('../context', () => ({
  useHospital: () => ({ hospitalId: 'hospital-1', userRole: 'Admin', navigate }),
}))

function createQuery(table) {
  let operation = ''
  let payload = null
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    insert: vi.fn((value) => { operation = 'insert'; payload = value; return query }),
    update: vi.fn((value) => { operation = 'update'; payload = value; return query }),
    single: vi.fn(async () => {
      if (operation === 'insert') {
        state.inserted = { id: 'record-1', ...payload, created_at: '2026-10-02T10:00:00.000Z' }
        state.records = [state.inserted, ...state.records]
        return { data: state.inserted, error: null }
      }
      const record = state.records.find((item) => item.id === 'record-1')
      Object.assign(record, payload)
      state.update = payload
      return { data: record, error: null }
    }),
    then: (resolve, reject) => Promise.resolve({
      data: table === 'patients' ? state.patients : table === 'visits' ? state.visits : state.records,
      error: null,
    }).then(resolve, reject),
  }
  return query
}

describe('HospitalWorkflowBoard', () => {
  beforeEach(() => {
    state.patients = [{ id: 'patient-1', full_name: 'Jordan Patient', patient_number: 'MRN-1' }]
    state.visits = [{ id: 'visit-1', patient_id: 'patient-1', visit_number: 'OPD-1', visit_type: 'OPD', status: 'Active', created_at: '2026-10-02T09:00:00.000Z' }]
    state.records = []
    state.inserted = null
    state.update = null
    state.from.mockReset().mockImplementation((table) => createQuery(table))
    navigate.mockReset()
  })

  it('saves a hospital patient-linked ICU record, opens the patient chart, and persists status updates', async () => {
    render(<HospitalWorkflowBoard config={HOSPITAL_WORKFLOW_MODULES.icu} />)

    fireEvent.click(await screen.findByRole('button', { name: 'New record' }))
    fireEvent.change(screen.getByLabelText('Patient *'), { target: { value: 'patient-1' } })
    fireEvent.change(screen.getByLabelText('Linked visit (optional)'), { target: { value: 'visit-1' } })
    fireEvent.change(screen.getByLabelText('Severity *'), { target: { value: 'High' } })
    fireEvent.change(screen.getByLabelText('ICU bed reference *'), { target: { value: 'ICU-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))

    await waitFor(() => {
      expect(state.inserted).toMatchObject({
        hospital_id: 'hospital-1',
        module_code: 'icu',
        patient_id: 'patient-1',
        visit_id: 'visit-1',
        title: 'Jordan Patient - ICU admission',
        details: { severity: 'High', bed_reference: 'ICU-01' },
      })
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Open chart' }))
    expect(navigate).toHaveBeenCalledWith('consultation', { patientId: 'patient-1', source: 'icu' })

    fireEvent.change(screen.getByRole('combobox', { name: 'Status for Jordan Patient - ICU admission' }), {
      target: { value: 'Completed' },
    })
    await waitFor(() => expect(state.update).toEqual({ status: 'Completed', updated_at: expect.any(String) }))
  })

  it.each(Object.values(HOSPITAL_WORKFLOW_MODULES))('renders the $title workflow with a real empty state', async (config) => {
    render(<HospitalWorkflowBoard config={config} />)

    expect(screen.getByRole('heading', { name: config.title })).toBeInTheDocument()
    expect(await screen.findByText('No saved records yet. Records will appear here after staff enter them.')).toBeInTheDocument()
  })

  it('blocks theatre conflicts and unsafe theatre, quality, and mortuary status transitions', () => {
    const theatre = HOSPITAL_WORKFLOW_MODULES.theatre
    const candidate = {
      case_reference: 'TH-2',
      procedure: 'Procedure',
      surgeon: 'Dr. A',
      room_id: 'OR-1',
      start_time: '2099-10-02T10:30',
      end_time: '2099-10-02T11:30',
    }
    const schedule = [{ id: 'existing', status: 'Open', details: { room_id: 'OR-1', start_time: '2099-10-02T10:00', end_time: '2099-10-02T11:00' } }]
    expect(theatre.validateRecord(candidate, schedule, { editingId: '', patientId: 'patient-1' })).toContain('already booked')

    const theatreRecord = { patient_id: 'patient-1', details: { surgeon: 'Dr. A', room_id: 'OR-1', start_time: candidate.start_time } }
    expect(theatre.validateStatus(theatreRecord, 'In Progress')).toContain('Sign-in')

    const qualityRecord = { details: { root_cause_identified: 'No', corrective_action_complete: 'No', approved: 'No' } }
    expect(HOSPITAL_WORKFLOW_MODULES['quality-safety'].validateStatus(qualityRecord, 'Completed')).toContain('approval')

    const morgueRecord = { details: { id_verified: false, medico_legal: true } }
    expect(HOSPITAL_WORKFLOW_MODULES.morgue.validateStatus(morgueRecord, 'Released')).toContain('ID verification')
  })
})