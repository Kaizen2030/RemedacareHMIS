// Book an appointment from the department's own clinic diary: the patient, one of this department's clinicians,
// a free slot from that clinician's schedule, type and notes. The database refuses double bookings; booking outside
// the clinician's hours or during their leave needs a reason (same rules as the Appointments screen).
import { useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { fetchSlots, friendlyScheduleError, localDateKey } from '../../utils/scheduling'
import { staffRoleGroup } from '../../utils/staffRoles'
import { notifyBooking } from '../../utils/appointmentNotify'

const TYPES = ['Consultation', 'Follow-up', 'Review', 'Procedure', 'Lab Review', 'Other']
const GRID = Array.from({ length: 20 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`) // 08:00–17:30
const addMinutes = (hhmm, min) => { const [h, m] = hhmm.split(':').map(Number); const t = h * 60 + m + Number(min || 0); return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` }
const CLINICAL = ['Doctors', 'Clinical officers', 'Nurses & midwives', 'Allied health']

export default function DepartmentBooking({ hospitalId, hospitalName, department, staff = [], userRole, css, onBooked, onClose }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])
  const [patient, setPatient] = useState(null)
  const [types, setTypes] = useState(TYPES)
  const [form, setForm] = useState({ clinician: '', type: 'Follow-up', date: localDateKey(new Date()), time: '', minutes: 30, notes: '', override: '' })
  const [slots, setSlots] = useState(null)
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const clinicians = useMemo(() => {
    const active = staff.filter((s) => String(s.status || 'Active') === 'Active')
    const clinical = active.filter((s) => CLINICAL.includes(staffRoleGroup(s)))
    return (clinical.length ? clinical : active).sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))
  }, [staff])

  useEffect(() => {
    if (!hospitalId) return
    void supabase.from('appointment_types').select('name').eq('hospital_id', hospitalId).eq('active', true).order('name')
      .then(({ data }) => { if (data?.length) setTypes(data.map((t) => t.name)) })
  }, [hospitalId])

  // patient search: name, patient number or phone
  useEffect(() => {
    const term = q.trim().replace(/[,()%*]/g, ' ').trim()
    if (patient || term.length < 2) { setFound([]); return undefined }
    const id = setTimeout(async () => {
      const { data } = await supabase.from('patients').select('id, full_name, patient_number, phone').eq('hospital_id', hospitalId)
        .or(`full_name.ilike.%${term}%,patient_number.ilike.%${term}%,phone.ilike.%${term}%`).limit(8)
      setFound(data || [])
    }, 250)
    return () => clearTimeout(id)
  }, [q, hospitalId, patient])

  // the clinician's free slots for the chosen day (their schedule); without a schedule, the plain half-hour grid
  useEffect(() => {
    let live = true
    setSlots(null)
    if (!form.clinician || !form.date) return undefined
    fetchSlots({ hospitalId, clinicianId: form.clinician, date: form.date, minutes: form.minutes })
      .then((rows) => { if (live) setSlots(rows) }).catch(() => { if (live) setSlots([]) })
    return () => { live = false }
  }, [hospitalId, form.clinician, form.date, form.minutes])
  const slotList = slots?.length ? slots : GRID.map((slot) => ({ slot, available: true }))
  const today = localDateKey(new Date())
  const nowHHMM = new Date().toTimeString().slice(0, 5)

  async function save() {
    if (!patient || !form.clinician || !form.date || !form.time) { setErr({ message: 'Choose the patient, clinician, date and time.' }); return }
    if (err?.needsOverride && !form.override.trim()) { setErr({ ...err, message: `${err.message} Give a reason to book anyway.` }); return }
    setSaving(true); setErr(null)
    const doc = clinicians.find((c) => String(c.id) === String(form.clinician))
    const row = {
      hospital_id: hospitalId, patient_id: patient.id, doctor_id: form.clinician, doctor_name: doc?.full_name || '', department,
      appointment_type: form.type, appointment_date: form.date, start_time: form.time, end_time: addMinutes(form.time, form.minutes),
      duration_minutes: Number(form.minutes), status: 'Scheduled', notes: form.notes.trim() || null, created_by: userRole || 'Staff',
      schedule_override_reason: form.override.trim() || null, created_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('appointments').insert(row).select('id').single()
    setSaving(false)
    if (error) { setErr(friendlyScheduleError(error.message)); return }
    void notifyBooking({ appointment: row, patient, hospitalId, hospitalName })
    window.dispatchEvent(new CustomEvent('remedacare:workflow_changed'))
    onBooked?.(row, patient)
  }

  const input = { padding: '7px 10px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', background: '#fff', color: '#101828' }
  const label = { display: 'block', fontSize: 12.5, fontWeight: 700, color: '#344054', marginBottom: 4 }
  return (
    <div role="group" aria-label="Book an appointment" style={{ border: '1px solid #D0D5DD', borderRadius: 10, padding: 14, marginBottom: 12, background: '#FCFCFD' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 14.5, color: '#101828' }}>Book a {department} appointment</strong>
        <button type="button" style={{ ...css.backBtn, padding: '4px 10px' }} onClick={onClose}>Close</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <div style={{ position: 'relative' }}>
          <label style={label} htmlFor="db-patient">Patient</label>
          {patient ? (
            <div style={{ ...input, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><strong>{patient.full_name}</strong>{patient.patient_number ? ` · ${patient.patient_number}` : ''}</span>
              <button type="button" style={{ border: 'none', background: 'none', color: '#0F6E56', fontWeight: 700, cursor: 'pointer', fontSize: 12.5 }} onClick={() => { setPatient(null); setQ('') }}>Change</button>
            </div>
          ) : (
            <>
              <input id="db-patient" style={input} placeholder="Name, patient number or phone" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
              {found.length > 0 && (
                <div role="listbox" aria-label="Matching patients" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, background: '#fff', border: '1px solid #D0D5DD', borderRadius: 8, marginTop: 2, boxShadow: '0 4px 12px rgba(16,24,40,.12)' }}>
                  {found.map((p) => (
                    <button key={p.id} type="button" role="option" aria-selected="false" onClick={() => { setPatient(p); setFound([]) }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', borderBottom: '1px solid #EAECF0', background: 'none', cursor: 'pointer', fontSize: 13 }}>
                      <strong>{p.full_name}</strong><span style={{ color: '#475467' }}>{p.patient_number ? ` · ${p.patient_number}` : ''}{p.phone ? ` · ${p.phone}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div>
          <label style={label} htmlFor="db-clin">Clinician</label>
          <select id="db-clin" style={input} value={form.clinician} onChange={(e) => { set('clinician', e.target.value); set('time', '') }}>
            <option value="">Choose a clinician</option>
            {clinicians.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.job_title || c.role ? ` · ${c.job_title || c.role}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="db-type">Type</label>
          <select id="db-type" style={input} value={form.type} onChange={(e) => set('type', e.target.value)}>
            {[...new Set([...types, form.type])].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="db-date">Date</label>
          <input id="db-date" type="date" min={today} style={input} value={form.date} onChange={(e) => { set('date', e.target.value); set('time', '') }} />
        </div>
        <div>
          <label style={label} htmlFor="db-time">Time</label>
          <select id="db-time" style={input} value={form.time} onChange={(e) => { set('time', e.target.value); setErr(null) }}>
            <option value="">{form.clinician && slots === null ? 'Loading free times…' : 'Choose a time'}</option>
            {slotList.map((s) => {
              const past = form.date === today && s.slot < nowHHMM
              return <option key={s.slot} value={s.slot} disabled={past || s.reason === 'booked'}>{s.slot}{past ? ' (past)' : !s.available ? ` (${s.reason || 'not free'})` : ''}</option>
            })}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="db-min">Length</label>
          <select id="db-min" style={input} value={form.minutes} onChange={(e) => set('minutes', Number(e.target.value))}>
            {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={label} htmlFor="db-notes">Notes for the clinic</label>
        <input id="db-notes" style={input} placeholder="e.g. bring previous results" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      {err?.needsOverride && (
        <div style={{ marginTop: 10 }}>
          <label style={label} htmlFor="db-override">Reason to book outside the clinician's hours</label>
          <input id="db-override" style={input} value={form.override} onChange={(e) => set('override', e.target.value)} placeholder="e.g. urgent review agreed with the consultant" />
        </div>
      )}
      {err && <div role="alert" style={{ color: '#912018', fontSize: 13, fontWeight: 600, marginTop: 8 }}>{err.message}</div>}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" disabled={saving} onClick={() => void save()}
          style={{ ...css.backBtn, background: '#0F6E56', color: '#fff', borderColor: '#0F6E56', padding: '7px 16px' }}>{saving ? 'Booking…' : 'Book appointment'}</button>
        <span style={{ fontSize: 12.5, color: '#475467' }}>The patient gets the usual SMS reminder if reminders are switched on. Payment is taken at the cashier on the day.</span>
      </div>
    </div>
  )
}
