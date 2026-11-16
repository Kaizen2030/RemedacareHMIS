// Patient portal data, shared by functions/patient-portal and unit-tested in supabase/tests/edge-portal.test.ts.
// The caller has already turned the session token into the list of patients this phone may see (portal_patients);
// every query here is filtered to one of those patients AND their facility.

// deno-lint-ignore no-explicit-any
type Db = any

export interface PortalPatient {
  patient_id: string
  hospital_id: string
  full_name: string
  patient_number: string | null
  hospital_name: string | null
  show_results: boolean
  allow_requests: boolean
  sensitive_tests: string[]
  welcome_note: string | null
}

export class PortalError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const today = () => new Date().toISOString().slice(0, 10)
const DONE_LAB = /^(completed|verified|reported|released|resulted|final)$/i

async function list(q: Promise<{ data: unknown[] | null, error: unknown }>) {
  try {
    const { data, error } = await q
    return error ? [] : (data || []) as Record<string, any>[]
  } catch {
    return []
  }
}

/** True when a test must not be released online (HIV, viral load … as configured by the facility). */
export function isSensitiveTest(name: string, sensitive: string[]) {
  const n = String(name || '').toLowerCase()
  return (sensitive || []).some((s) => s && n.includes(String(s).toLowerCase()))
}

export function findPatient(patients: PortalPatient[], patientId: unknown) {
  const p = patients.find((x) => String(x.patient_id) === String(patientId))
  if (!p) throw new PortalError(404, 'That record is not linked to your phone number.')
  return p
}

/** Everything the portal shows for one patient. */
export async function patientSummary(db: Db, p: PortalPatient) {
  const scope = (table: string) => db.from(table).select('*').eq('hospital_id', p.hospital_id).eq('patient_id', p.patient_id)
  const since180 = new Date(Date.now() - 180 * 86400000).toISOString()
  const [appts, visits, labs, rx, imm, bills] = await Promise.all([
    list(scope('appointments').gte('appointment_date', today()).order('appointment_date', { ascending: true }).limit(10)),
    list(scope('visits').order('created_at', { ascending: false }).limit(10)),
    p.show_results ? list(scope('lab_tests').order('ordered_at', { ascending: false }).limit(30)) : Promise.resolve([]),
    list(scope('prescriptions').gte('created_at', since180).order('created_at', { ascending: false }).limit(30)),
    list(scope('immunisations').order('given_on', { ascending: true }).limit(60)),
    list(scope('invoices').order('created_at', { ascending: false }).limit(30)),
  ])
  return {
    patient: { id: p.patient_id, name: p.full_name, number: p.patient_number, facility: p.hospital_name, hospital_id: p.hospital_id, can_request: p.allow_requests },
    appointments: appts.filter((a) => !/cancel/i.test(String(a.status || ''))).map((a) => ({
      id: a.id, date: a.appointment_date, time: a.start_time || null, clinician: a.doctor_name || null, department: a.department || null,
      type: a.appointment_type || null, status: a.status, video_link: a.telehealth_url || null,
      can_cancel: ['scheduled', 'confirmed', 'booked', 'pending'].includes(String(a.status || '').toLowerCase()),
    })),
    visits: visits.map((v) => ({ date: v.created_at, type: v.visit_type || v.speciality || 'Visit', status: v.status || null })),
    results: labs.filter((t) => DONE_LAB.test(String(t.status || ''))).map((t) => {
      const name = t.test_name || t.test_type || 'Laboratory test'
      const date = t.results_ready_at || t.updated_at || t.ordered_at
      if (isSensitiveTest(name, p.sensitive_tests)) return { test: name, date, released: false, note: 'Please discuss this result with your clinician.' }
      return { test: name, date, released: true, result: t.result_text || t.result_value || t.result_summary || t.result || null, interpretation: t.interpretation || null }
    }),
    medicines: rx.map((m) => ({ name: m.drug_name || m.generic_name, how: [m.dosage, m.frequency, m.duration].filter(Boolean).join(' · '), date: m.created_at, status: m.status || null })),
    immunisations: imm.map((i) => ({ vaccine: i.vaccine, date: i.given_on })),
    bills: bills
      .filter((b) => Number(b.balance_kes ?? 0) > 0 && !/^(cancelled|canceled|paid|void)$/i.test(String(b.status || '').trim()))
      .map((b) => ({ number: b.invoice_no || null, date: b.created_at, total: Number(b.amount_kes || 0), balance: Number(b.balance_kes || 0) })),
  }
}

export interface AppointmentRequest { department?: string, earliest_date?: string, latest_date?: string, preferred_times?: string, reason?: string }

/** Put a patient's appointment request on the facility's waiting list (Appointments → Waiting list). */
export async function requestAppointment(db: Db, p: PortalPatient, phone: string, body: AppointmentRequest) {
  if (!p.allow_requests) throw new PortalError(403, `${p.hospital_name || 'This facility'} does not take appointment requests online. Please call them.`)
  const d = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  const earliest = d(body.earliest_date) || today()
  const latest = d(body.latest_date)
  if (earliest < today()) throw new PortalError(400, 'Choose a date from today onwards.')
  if (latest && latest < earliest) throw new PortalError(400, 'The last date must be after the first date.')
  const open = await list(db.from('appointment_waitlist').select('id').eq('hospital_id', p.hospital_id).eq('patient_id', p.patient_id).eq('status', 'waiting').ilike('notes', 'Requested in patient portal%'))
  if (open.length >= 3) throw new PortalError(429, 'You already have 3 requests waiting. The facility will contact you.')
  const clean = (s?: string, n = 200) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n)
  const { error } = await db.from('appointment_waitlist').insert({
    hospital_id: p.hospital_id, patient_id: p.patient_id, patient_name: p.full_name, phone,
    department: clean(body.department, 80) || null, earliest_date: earliest, latest_date: latest,
    preferred_times: clean(body.preferred_times, 80) || null, notes: `Requested in patient portal: ${clean(body.reason) || 'no reason given'}`,
  })
  if (error) throw new PortalError(500, 'The request could not be saved. Please try again or call the facility.')
}

/** Cancel one of the patient's own upcoming appointments (frees the slot for the waiting list). */
export async function cancelAppointment(db: Db, p: PortalPatient, appointmentId: string) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(String(appointmentId || ''))) throw new PortalError(400, 'Invalid appointment.')
  const rows = await list(db.from('appointments').select('*').eq('hospital_id', p.hospital_id).eq('patient_id', p.patient_id).eq('id', appointmentId).limit(1))
  const a = rows[0]
  if (!a) throw new PortalError(404, 'Appointment not found.')
  if (String(a.appointment_date) < today()) throw new PortalError(400, 'Past appointments cannot be cancelled.')
  if (!['scheduled', 'confirmed', 'booked', 'pending'].includes(String(a.status || '').toLowerCase())) throw new PortalError(400, `This appointment is ${a.status}.`)
  const { error } = await db.from('appointments').update({ status: 'Cancelled', cancellation_reason: 'Cancelled by the patient in the portal' })
    .eq('id', appointmentId).eq('hospital_id', p.hospital_id).eq('patient_id', p.patient_id)
  if (error) throw new PortalError(500, 'Could not cancel. Please call the facility.')
}
