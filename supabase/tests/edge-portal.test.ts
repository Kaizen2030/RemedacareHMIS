import { describe, expect, it } from 'vitest'
import { cancelAppointment, findPatient, isSensitiveTest, patientSummary, PortalError, requestAppointment, type PortalPatient } from '../functions/_shared/portalCore.ts'

const H = 'h1', OTHER = 'h2'
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

function fakeDb(tables: Record<string, any[]>) {
  const writes: any[] = []
  const from = (table: string) => {
    const filters: ((r: any) => boolean)[] = []
    let op: 'select' | 'update' = 'select'
    let patch: any = null
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push((r) => String(r[c]) === String(v)); return b },
      gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return b },
      ilike: (c: string, pat: string) => { const pre = pat.replace(/%$/, '').toLowerCase(); filters.push((r) => String(r[c] || '').toLowerCase().startsWith(pre)); return b },
      order: () => b, limit: () => b,
      insert: (row: any) => { writes.push([table, 'insert', row]); (tables[table] ||= []).push(row); return Promise.resolve({ error: null }) },
      update: (p: any) => { op = 'update'; patch = p; return b },
      then: (res: any, rej: any) => {
        const rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)))
        if (op === 'update') { rows.forEach((r) => Object.assign(r, patch)); writes.push([table, 'update', patch, rows.length]); return Promise.resolve({ error: null }).then(res, rej) }
        return Promise.resolve({ data: rows, error: null }).then(res, rej)
      },
    }
    return b
  }
  return { from, writes, tables }
}

const jane: PortalPatient = { patient_id: 'p1', hospital_id: H, full_name: 'Jane', patient_number: 'A-1', hospital_name: 'Hosp A', show_results: true, allow_requests: true, sensitive_tests: ['hiv', 'viral load'], welcome_note: null }

const data = () => ({
  appointments: [
    { id: 'a1', hospital_id: H, patient_id: 'p1', appointment_date: day(3), start_time: '09:00', doctor_name: 'Dr Otieno', status: 'Scheduled' },
    { id: 'a2', hospital_id: H, patient_id: 'p1', appointment_date: day(-3), status: 'Completed' },
    { id: 'a3', hospital_id: H, patient_id: 'p1', appointment_date: day(5), status: 'Cancelled' },
    { id: 'a9', hospital_id: OTHER, patient_id: 'p1', appointment_date: day(2), status: 'Scheduled' },
  ],
  lab_tests: [
    { id: 'l1', hospital_id: H, patient_id: 'p1', test_type: 'Full Hemogram', status: 'Completed', result_text: 'Hb 12.1' },
    { id: 'l2', hospital_id: H, patient_id: 'p1', test_type: 'HIV Rapid Test', status: 'Completed', result_text: 'Non-reactive' },
    { id: 'l3', hospital_id: H, patient_id: 'p1', test_type: 'Malaria RDT', status: 'Pending' },
  ],
  invoices: [
    { id: 'i1', hospital_id: H, patient_id: 'p1', invoice_no: 'INV-1', amount_kes: 1500, balance_kes: 500, status: 'Partially Paid' },
    { id: 'i2', hospital_id: H, patient_id: 'p1', invoice_no: 'INV-2', amount_kes: 800, balance_kes: 0, status: 'Paid' },
  ],
  prescriptions: [{ id: 'r1', hospital_id: H, patient_id: 'p1', drug_name: 'Amlodipine', dosage: '5 mg', frequency: 'OD', created_at: new Date().toISOString() }],
  immunisations: [{ id: 'm1', hospital_id: H, patient_id: 'p1', vaccine: 'MR1', given_on: '2026-01-10' }],
  visits: [],
  appointment_waitlist: [],
})

describe('patient portal data', () => {
  it('shows upcoming appointments, released results, medicines and open bills for this facility only', async () => {
    const s = await patientSummary(fakeDb(data()), jane)
    expect(s.appointments.map((a) => a.id)).toEqual(['a1'])
    expect(s.appointments[0]).toMatchObject({ clinician: 'Dr Otieno', can_cancel: true })
    expect(s.results).toEqual([
      expect.objectContaining({ test: 'Full Hemogram', released: true, result: 'Hb 12.1' }),
      expect.objectContaining({ test: 'HIV Rapid Test', released: false }),
    ])
    expect(JSON.stringify(s.results)).not.toContain('Non-reactive')
    expect(s.bills).toEqual([expect.objectContaining({ number: 'INV-1', balance: 500 })])
    expect(s.medicines[0]).toMatchObject({ name: 'Amlodipine', how: '5 mg · OD' })
    expect(s.immunisations).toEqual([{ vaccine: 'MR1', date: '2026-01-10' }])
  })
  it('hides all results when the facility does not show them', async () => {
    expect((await patientSummary(fakeDb(data()), { ...jane, show_results: false })).results).toEqual([])
    expect(isSensitiveTest('HIV-1 Viral Load', ['viral load'])).toBe(true)
  })
  it('only lets a phone act on its own patients', () => {
    expect(() => findPatient([jane], 'someone-else')).toThrow(PortalError)
    expect(findPatient([jane], 'p1')).toBe(jane)
  })
  it('puts appointment requests on the waiting list, at most 3 open', async () => {
    const db = fakeDb(data())
    await requestAppointment(db, jane, '254712345678', { department: 'NCD clinic', earliest_date: day(1), reason: 'BP review' })
    expect(db.writes[0][2]).toMatchObject({ hospital_id: H, patient_id: 'p1', department: 'NCD clinic', notes: 'Requested in patient portal: BP review' })
    db.tables.appointment_waitlist.forEach((r: any) => { r.status = 'waiting' })
    await requestAppointment(db, jane, '254712345678', {}); db.tables.appointment_waitlist.forEach((r: any) => { r.status = 'waiting' })
    await requestAppointment(db, jane, '254712345678', {}); db.tables.appointment_waitlist.forEach((r: any) => { r.status = 'waiting' })
    await expect(requestAppointment(db, jane, '254712345678', {})).rejects.toThrow(/3 requests/)
    await expect(requestAppointment(fakeDb(data()), jane, 'x', { earliest_date: day(-1) })).rejects.toThrow(/from today/)
    await expect(requestAppointment(fakeDb(data()), { ...jane, allow_requests: false }, 'x', {})).rejects.toThrow(/does not take/)
  })
  it('cancels only the patient\'s own future, active appointments', async () => {
    const db = fakeDb(data())
    await cancelAppointment(db, jane, 'a1')
    expect(db.tables.appointments.find((a: any) => a.id === 'a1').status).toBe('Cancelled')
    await expect(cancelAppointment(db, jane, 'a2')).rejects.toThrow(/Past/)
    await expect(cancelAppointment(db, jane, 'a9')).rejects.toThrow(/not found/)
    await expect(cancelAppointment(db, jane, "a1' or 1=1")).rejects.toThrow(/Invalid/)
  })
})
