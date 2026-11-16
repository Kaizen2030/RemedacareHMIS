import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PatientPortal from './PatientPortal'
import { summariseBundle } from '../public/SharedReferral'

const record = {
  patient: { id: 'p1', name: 'Jane Wanjiku', facility: 'Hosp A', can_request: true },
  appointments: [{ id: 'a1', date: '2099-01-10', time: '09:00:00', clinician: 'Dr Otieno', department: 'NCD clinic', status: 'Scheduled', can_cancel: true }],
  visits: [],
  results: [{ test: 'Full Hemogram', date: '2026-11-01', released: true, result: 'Hb 12.1' }, { test: 'HIV Rapid Test', date: '2026-11-01', released: false, note: 'Please discuss this result with your clinician.' }],
  medicines: [{ name: 'Amlodipine', how: '5 mg · OD', date: '2026-11-01' }],
  immunisations: [],
  bills: [{ number: 'INV-1', date: '2026-11-01', total: 1500, balance: 500 }],
}

let calls
beforeEach(() => {
  calls = []
  try { sessionStorage.clear() } catch { /* ignore */ }
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ body, auth: init.headers.Authorization })
    const reply = {
      request_code: { ok: true, message: 'If this number is registered, a code is on its way by SMS.' },
      verify: body.code === '123456' ? { ok: true, token: 'rcp_test' } : null,
      summary: { ok: true, records: [record] },
      cancel_appointment: { ok: true, message: 'Appointment cancelled.' },
    }[body.action]
    return reply ? { ok: true, status: 200, json: async () => reply } : { ok: false, status: 401, json: async () => ({ error: 'That code is not right.' }) }
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('patient portal page', () => {
  it('signs in with phone + code and shows the record (sensitive results withheld, bills say pay at cashier)', async () => {
    render(<PatientPortal />)
    fireEvent.change(screen.getByLabelText('Your mobile number'), { target: { value: '0712345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText(/a code is on its way/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Code for/), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('That code is not right.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Code for/), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Hb 12.1')).toBeTruthy()
    expect(screen.getByText('Please discuss this result with your clinician.')).toBeTruthy()
    expect(screen.getByText(/Pay at the cashier at Hosp A/)).toBeTruthy()
    expect(calls.find((c) => c.body.action === 'summary').auth).toBe('Bearer rcp_test')
  })
  it('cancels an appointment after confirming', async () => {
    sessionStorage.setItem('rc-portal-token', 'rcp_test')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<PatientPortal />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Appointment cancelled.')).toBeTruthy()
    expect(calls.find((c) => c.body.action === 'cancel_appointment').body).toMatchObject({ patient_id: 'p1', appointment_id: 'a1' })
  })
})

describe('referral link summary', () => {
  it('turns a FHIR document bundle into readable sections', () => {
    const bundle = { entry: [
      { resource: { resourceType: 'Organization', name: 'Hosp A' } },
      { resource: { resourceType: 'Patient', name: [{ text: 'Jane W' }], gender: 'female', identifier: [{ system: 'https://health.go.ke/identifier/national-id', value: '123' }], extension: [{ url: 'https://remedacare.health/fhir/StructureDefinition/allergies', valueString: 'Penicillin' }] } },
      { resource: { resourceType: 'Condition', code: { text: 'Malaria', coding: [{ code: 'B54' }] } } },
      { resource: { resourceType: 'Observation', code: { text: 'Blood pressure' }, component: [{ valueQuantity: { value: 130 } }, { valueQuantity: { value: 85 } }] } },
    ] }
    const d = summariseBundle(bundle)
    expect(d.facility).toBe('Hosp A')
    expect(d.patient).toMatchObject({ name: 'Jane W', allergies: 'Penicillin', ids: [{ label: 'National ID', value: '123' }] })
    expect(d.diagnoses).toEqual([{ code: 'B54', text: 'Malaria' }])
    expect(d.vitals[0].value).toBe('130/85 mmHg')
  })
})
