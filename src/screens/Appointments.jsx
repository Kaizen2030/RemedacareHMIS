import { useEffect, useMemo, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import { executeWithFallback, omitKeys } from '../utils/dbCompat'
import { buildWorkflowInvoiceNote, createServiceLine, SERVICE_SOURCES, stringifyServiceLines } from '../utils/workflowBilling'
import { buildMessage, DEFAULT_TEMPLATES, fetchNotificationConfig, getNotificationSetting, sendPatientNotification } from '../utils/notifications'
import { colors as C, typography } from '../theme'

const APPOINTMENT_TYPES = ['Consultation', 'Follow-up', 'Procedure', 'Lab Review', 'Antenatal', 'Vaccination', 'Dental', 'Other']
const DURATIONS = [15, 30, 45, 60]
const STATUSES = ['Scheduled', 'Confirmed', 'Arrived', 'Completed', 'Cancelled', 'No-Show']
const PRIORITY_DOCTOR_TOKENS = ['doctor', 'clinical officer', 'nurse', 'medical officer', 'gp', 'specialist', 'consultant', 'physician', 'surgeon']
const SLOT_HEIGHT = 44
const PAGE_SIZE = 25

const MODALITY_PRICE_MAP = {
  Consultation: 500,
  'Follow-up': 300,
  Procedure: 2500,
  'Lab Review': 400,
  Antenatal: 800,
  Vaccination: 600,
  Dental: 1200,
  Other: 500,
}

const STATUS_META = {
  Scheduled: { bg: C.primaryL, color: C.primary },
  Confirmed: { bg: C.successL, color: C.success },
  Arrived: { bg: '#E0F2FE', color: '#0E7490' },
  Completed: { bg: '#F3F4F6', color: C.sub },
  Cancelled: { bg: C.dangerL, color: C.danger },
  'No-Show': { bg: C.warnL, color: C.warn },
}

const css = {
  page: { minHeight: '100vh', background: C.bg, color: C.text, fontFamily: typography.fontFamily, fontSize: '13px' },
  wrap: { padding: '20px 24px', maxWidth: '1520px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '18px' },
  h1: { fontSize: '19px', fontWeight: 800, margin: 0 },
  subtext: { fontSize: '12px', color: C.sub, marginTop: '4px' },
  btn: { padding: '9px 14px', borderRadius: '9px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '12px' },
  btnPri: { background: C.primary, color: '#fff' },
  btnGhost: { background: C.surface, color: C.text, border: `1px solid ${C.border}` },
  btnDanger: { background: C.dangerL, color: C.danger },
  btnSoft: { background: C.primaryL, color: C.primary },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '12px', marginBottom: '18px' },
  stat: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '15px 16px' },
  statLbl: { fontSize: '11px', color: C.sub, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.06em' },
  statVal: { fontSize: '27px', fontWeight: 800, marginTop: '5px' },
  statSub: { fontSize: '12px', color: C.sub, marginTop: '6px' },
  toolbar: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '18px' },
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: '14px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: '8px', background: C.surface, fontSize: '13px', color: C.text, outline: 'none' },
  select: { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: '8px', background: C.surface, fontSize: '13px', color: C.text, outline: 'none' },
  label: { fontSize: '11px', color: C.sub, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em', marginBottom: '6px', display: 'block' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '10px 12px', textAlign: 'left', fontSize: '11px', color: C.sub, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em', borderBottom: `1px solid ${C.border}`, background: '#FAFBFD' },
  td: { padding: '11px 12px', borderBottom: `1px solid ${C.border}`, fontSize: '13px', verticalAlign: 'top' },
  pill: { display: 'inline-block', padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 1000 },
  modal: { width: '760px', maxWidth: '96vw', maxHeight: '90vh', overflowY: 'auto', background: C.surface, borderRadius: '18px', boxShadow: '0 24px 70px rgba(15,23,42,.28)', padding: '22px' },
  sidePanel: { width: '420px', maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', background: C.surface, borderRadius: '18px', boxShadow: '0 24px 70px rgba(15,23,42,.28)', padding: '22px' },
  sectionTitle: { fontSize: '12px', color: C.primary, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', margin: '0 0 10px' },
}

function getMonday(date) {
  const source = new Date(date)
  source.setHours(0, 0, 0, 0)
  const day = source.getDay()
  const diff = day === 0 ? -6 : 1 - day
  source.setDate(source.getDate() + diff)
  return source
}

function addDays(date, count) {
  const next = new Date(date)
  next.setDate(next.getDate() + count)
  return next
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDateShort(date) {
  return new Date(date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })
}

function formatDateInput(date) {
  return new Date(date).toISOString().slice(0, 10)
}

function formatTimeDisplay(value) {
  if (!value) return '—'
  const [hours = '00', minutes = '00'] = String(value).split(':')
  const date = new Date()
  date.setHours(Number(hours), Number(minutes), 0, 0)
  return date.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' })
}

function buildTimeSlots() {
  const slots = []
  for (let hour = 8; hour < 18; hour += 1) {
    for (const minute of [0, 30]) {
      slots.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
    }
  }
  return slots
}

const TIME_SLOTS = buildTimeSlots()

function addMinutes(time, minutes) {
  const [hours = '0', mins = '0'] = String(time || '00:00').split(':')
  const total = Number(hours) * 60 + Number(mins) + Number(minutes || 0)
  const nextHours = Math.floor(total / 60)
  const nextMinutes = total % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}`
}

function formatWeekLabel(weekStart) {
  const weekEnd = addDays(weekStart, 6)
  return `Week of ${formatDateShort(weekStart)}–${formatDateShort(weekEnd)}`
}

function appointmentDateTime(appointment) {
  return new Date(`${appointment.appointment_date}T${String(appointment.start_time || '00:00').slice(0, 5)}:00`)
}

function safeJsonParse(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function isClinicalStaff(member) {
  const haystack = [
    member?.role,
    member?.department,
    member?.job_title,
    member?.role_category,
  ].map(normalizeText).join(' ')
  return PRIORITY_DOCTOR_TOKENS.some((token) => haystack.includes(token))
}

function statusBadge(status) {
  return STATUS_META[status] || { bg: '#F3F4F6', color: C.sub }
}

function deriveStatusHistory(record) {
  return [
    record.created_at ? { label: 'Booked', at: record.created_at } : null,
    record.confirmed_at ? { label: 'Confirmed', at: record.confirmed_at } : null,
    record.arrived_at ? { label: 'Arrived', at: record.arrived_at } : null,
    record.completed_at ? { label: 'Completed', at: record.completed_at } : null,
  ].filter(Boolean)
}

async function notifyAppointmentBooked({ appointment, patient, hospitalId, hospitalName }) {
  try {
    if (!patient?.phone) return
    const notificationConfig = await fetchNotificationConfig(hospitalId)
    const setting = getNotificationSetting(notificationConfig, 'appointment_reminder')
    if (!setting.enabled) return

    const message = buildMessage(setting.template || DEFAULT_TEMPLATES.appointment_reminder, {
      patient_name: patient.full_name || 'Patient',
      hospital_name: hospitalName || 'RemedacareHMIS',
      date_time: `${formatDate(appointment.appointment_date)} ${formatTimeDisplay(appointment.start_time)}`,
    })

    const result = await sendPatientNotification({
      phone: patient.phone,
      message,
      hospitalName,
      notificationType: 'appointment_reminder',
      patientId: appointment.patient_id,
      hospitalId,
    })
    if (!result.success && !result.skipped && result.error) {
      console.warn('Appointment notification failed:', result.error)
    }
  } catch (error) {
    console.warn('Appointment notification failed:', error)
  }
}

function buildAppointmentForm(appointment = {}) {
  return {
    patient_id: appointment.patient_id || '',
    patient_name: appointment.patient?.full_name || appointment.patient_name || '',
    patient_number: appointment.patient?.patient_number || '',
    patient_phone: appointment.patient?.phone || '',
    doctor_id: appointment.doctor_id || '',
    doctor_name: appointment.doctor_name || '',
    department: appointment.department || '',
    appointment_type: appointment.appointment_type || APPOINTMENT_TYPES[0],
    appointment_date: appointment.appointment_date || formatDateInput(new Date()),
    start_time: String(appointment.start_time || '').slice(0, 5) || TIME_SLOTS[0],
    duration_minutes: Number(appointment.duration_minutes || 30),
    notes: appointment.notes || '',
    visit_id: appointment.visit_id || '',
  }
}

async function appendVisitInvoiceCharge({ hospitalId, patientId, visitId, patientName, appointmentId, appointmentType, paymentMethod = 'Cash' }) {
  if (!visitId) return

  const amount = Number(MODALITY_PRICE_MAP[appointmentType] || MODALITY_PRICE_MAP.Other || 0)
  const serviceLine = createServiceLine({
    label: `${appointmentType} Appointment`,
    qty: 1,
    unitPrice: amount,
    total: amount,
    source: SERVICE_SOURCES.PROCEDURE,
    sourceId: appointmentId,
    visitId,
    meta: { category: 'Appointments' },
  })

  const { data: existingInvoice } = await supabase
    .from('invoices')
    .select('*')
    .eq('hospital_id', hospitalId)
    .eq('visit_id', visitId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingInvoice) {
    const currentLines = safeJsonParse(existingInvoice.services, [])
    const nextLines = [...currentLines, serviceLine]
    const nextAmount = currentLines.reduce((sum, item) => sum + Number(item.total || 0), 0) + amount
    await supabase
      .from('invoices')
      .update({
        services: stringifyServiceLines(nextLines),
        amount_kes: nextAmount,
        balance_kes: Math.max(0, nextAmount - Number(existingInvoice.paid_kes || 0)),
        notes: buildWorkflowInvoiceNote({
          source: SERVICE_SOURCES.PROCEDURE,
          sourceId: appointmentId,
          visitId,
          summary: `${appointmentType} appointment charge appended`,
        }),
      })
      .eq('id', existingInvoice.id)
      .eq('hospital_id', hospitalId)
    return
  }

  const invoicePayload = {
    hospital_id: hospitalId,
    patient_id: patientId,
    visit_id: visitId,
    patient_name: patientName,
    invoice_no: `INV-${Date.now().toString().slice(-6)}`,
    services: stringifyServiceLines([serviceLine]),
    amount_kes: amount,
    paid_kes: ['Cash', 'M-Pesa'].includes(paymentMethod) ? amount : 0,
    balance_kes: ['Cash', 'M-Pesa'].includes(paymentMethod) ? 0 : amount,
    payment_method: paymentMethod,
    insurer: !['Cash', 'M-Pesa'].includes(paymentMethod) ? paymentMethod : null,
    status: ['Cash', 'M-Pesa'].includes(paymentMethod) ? 'Paid' : 'Pending',
    notes: buildWorkflowInvoiceNote({
      source: SERVICE_SOURCES.PROCEDURE,
      sourceId: appointmentId,
      visitId,
      summary: `${appointmentType} appointment charge`,
    }),
    paid_at: ['Cash', 'M-Pesa'].includes(paymentMethod) ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
  }

  await executeWithFallback(
    () => supabase.from('invoices').insert(invoicePayload),
    async () => supabase.from('invoices').insert(omitKeys(invoicePayload, ['patient_id', 'visit_id'])),
  )
}

export async function getUpcomingAppointmentsForReminders(hospitalId) {
  if (!hospitalId) return []

  const now = new Date()
  const upper = new Date(now.getTime() + 25 * 60 * 60 * 1000)
  const fromDate = formatDateInput(now)
  const toDate = formatDateInput(upper)

  const { data } = await supabase
    .from('appointments')
    .select('*, patients(id,full_name,phone,patient_number)')
    .eq('hospital_id', hospitalId)
    .in('status', ['Scheduled', 'Confirmed'])
    .gte('appointment_date', fromDate)
    .lte('appointment_date', toDate)
    .order('appointment_date', { ascending: true })

  return (data || []).filter((appointment) => {
    const when = appointmentDateTime(appointment)
    return when >= now && when <= upper
  })
}

function PatientSearchField({ value, onChange, results, onSelect, placeholder = 'Search patient...' }) {
  return (
    <div style={{ position: 'relative' }}>
      <input style={css.input} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {results.length > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', zIndex: 5, background: C.surface, border: `1px solid ${C.border}`, borderRadius: '10px', boxShadow: '0 14px 28px rgba(15,23,42,.12)', maxHeight: '220px', overflowY: 'auto' }}>
          {results.map((patient) => (
            <button
              key={patient.id}
              type="button"
              style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}
              onClick={() => onSelect(patient)}
            >
              <div style={{ fontWeight: 700, fontSize: '13px', color: C.text }}>{patient.full_name}</div>
              <div style={{ fontSize: '11px', color: C.sub, marginTop: '3px' }}>{patient.patient_number || 'No number'}{patient.phone ? ` • ${patient.phone}` : ''}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function BookingModal({
  form,
  setForm,
  patientResults,
  patientSearch,
  setPatientSearch,
  onSelectPatient,
  doctors,
  visitOptions,
  slotCounts,
  onClose,
  onSave,
  saving,
  editing,
}) {
  const availableSlots = TIME_SLOTS.map((slot) => {
    const count = slotCounts[slot] || 0
    return { slot, count, disabled: count >= 3 }
  })

  return (
    <div style={css.overlay}>
      <div style={css.modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', marginBottom: '18px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>{editing ? 'Reschedule Appointment' : 'Book Appointment'}</h3>
            <div style={{ fontSize: '12px', color: C.sub, marginTop: '4px' }}>Pick the patient, clinician, and slot details.</div>
          </div>
          <button type="button" style={{ ...css.btn, ...css.btnGhost }} onClick={onClose}>Close</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={css.label}>Patient</label>
            <PatientSearchField value={patientSearch} onChange={setPatientSearch} results={patientResults} onSelect={onSelectPatient} />
            {form.patient_name && (
              <div style={{ fontSize: '12px', color: C.sub, marginTop: '6px' }}>
                Selected: <strong style={{ color: C.text }}>{form.patient_name}</strong>{form.patient_number ? ` • ${form.patient_number}` : ''}
              </div>
            )}
          </div>

          <div style={css.grid2}>
            <div>
              <label style={css.label}>Doctor</label>
              <select
                style={css.select}
                value={form.doctor_id}
                onChange={(event) => {
                  const doctor = doctors.find((entry) => String(entry.id) === event.target.value)
                  setForm((current) => ({
                    ...current,
                    doctor_id: event.target.value,
                    doctor_name: doctor?.full_name || '',
                    department: doctor?.department || current.department,
                  }))
                }}
              >
                <option value="">Select clinician</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>{doctor.full_name} — {doctor.role || doctor.department || 'Clinical'}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={css.label}>Department</label>
              <input style={css.input} value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} />
            </div>
          </div>

          <div style={css.grid2}>
            <div>
              <label style={css.label}>Visit</label>
              <select style={css.select} value={form.visit_id} onChange={(event) => setForm((current) => ({ ...current, visit_id: event.target.value }))}>
                <option value="">No linked visit</option>
                {visitOptions.map((visit) => (
                  <option key={visit.id} value={visit.id}>{visit.visit_number || visit.id} — {visit.status || 'Open'}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={css.label}>Type</label>
              <select style={css.select} value={form.appointment_type} onChange={(event) => setForm((current) => ({ ...current, appointment_type: event.target.value }))}>
                {APPOINTMENT_TYPES.map((option) => <option key={option}>{option}</option>)}
              </select>
            </div>
          </div>

          <div style={css.grid3}>
            <div>
              <label style={css.label}>Date</label>
              <input
                style={css.input}
                type="date"
                min={formatDateInput(new Date())}
                value={form.appointment_date}
                onChange={(event) => setForm((current) => ({ ...current, appointment_date: event.target.value }))}
              />
            </div>
            <div>
              <label style={css.label}>Time Slot</label>
              <select style={css.select} value={form.start_time} onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))}>
                {availableSlots.map((entry) => (
                  <option key={entry.slot} value={entry.slot} disabled={entry.disabled}>
                    {formatTimeDisplay(entry.slot)}{entry.disabled ? ' — full' : entry.count > 0 ? ` — ${entry.count} booked` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={css.label}>Duration</label>
              <select
                style={css.select}
                value={form.duration_minutes}
                onChange={(event) => setForm((current) => ({ ...current, duration_minutes: Number(event.target.value) }))}
              >
                {DURATIONS.map((option) => <option key={option} value={option}>{option} min</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={css.label}>Notes</label>
            <textarea style={{ ...css.input, minHeight: '96px', resize: 'vertical' }} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
          <button type="button" style={{ ...css.btn, ...css.btnGhost }} onClick={onClose}>Cancel</button>
          <button type="button" style={{ ...css.btn, ...css.btnPri }} onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : editing ? 'Save Reschedule' : 'Book Appointment'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AppointmentDetailPanel({ appointment, onClose, onAction, actionBusy, navigate }) {
  if (!appointment) return null
  const statusStyle = statusBadge(appointment.status)
  const history = deriveStatusHistory(appointment)

  return (
    <div style={css.overlay}>
      <div style={css.sidePanel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>{appointment.patient?.full_name || appointment.patient_name || 'Appointment'}</h3>
            <div style={{ fontSize: '12px', color: C.sub, marginTop: '4px' }}>{appointment.patient?.patient_number || 'No patient number'} • {appointment.appointment_type}</div>
          </div>
          <button type="button" style={{ ...css.btn, ...css.btnGhost }} onClick={onClose}>Close</button>
        </div>

        <div style={{ ...css.pill, background: statusStyle.bg, color: statusStyle.color, marginBottom: '14px' }}>{appointment.status}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          {[
            ['Doctor', appointment.doctor_name || '—'],
            ['Department', appointment.department || '—'],
            ['Date', formatDate(appointment.appointment_date)],
            ['Time', `${formatTimeDisplay(appointment.start_time)} (${appointment.duration_minutes || 30} min)`],
          ].map(([label, value]) => (
            <div key={label} style={{ background: '#FAFBFD', border: `1px solid ${C.border}`, borderRadius: '12px', padding: '10px 12px' }}>
              <div style={{ fontSize: '10px', color: C.sub, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em' }}>{label}</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: C.text, marginTop: '5px' }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={css.sectionTitle}>Notes</div>
          <div style={{ fontSize: '13px', color: appointment.notes ? C.text : C.sub, lineHeight: 1.7 }}>{appointment.notes || 'No notes added.'}</div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={css.sectionTitle}>Status History</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {history.length === 0 && <div style={{ fontSize: '12px', color: C.sub }}>No status history captured yet.</div>}
            {history.map((entry) => (
              <div key={`${entry.label}-${entry.at}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontWeight: 700, color: C.text }}>{entry.label}</span>
                <span style={{ color: C.sub }}>{new Date(entry.at).toLocaleString('en-KE')}</span>
              </div>
            ))}
            {appointment.cancellation_reason && (
              <div style={{ fontSize: '12px', color: C.danger, marginTop: '8px' }}>Cancellation reason: {appointment.cancellation_reason}</div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {['Scheduled', 'Confirmed'].includes(appointment.status) && (
            <button type="button" style={{ ...css.btn, ...css.btnSoft }} onClick={() => onAction('confirm')} disabled={actionBusy || appointment.status === 'Confirmed'}>Confirm</button>
          )}
          {['Scheduled', 'Confirmed'].includes(appointment.status) && (
            <button type="button" style={{ ...css.btn, ...css.btnPri }} onClick={() => onAction('arrive')} disabled={actionBusy}>Mark Arrived</button>
          )}
          {appointment.status === 'Arrived' && (
            <button type="button" style={{ ...css.btn, ...css.btnSoft }} onClick={() => onAction('complete')} disabled={actionBusy}>Complete</button>
          )}
          {['Scheduled', 'Confirmed'].includes(appointment.status) && (
            <button type="button" style={{ ...css.btn, ...css.btnGhost }} onClick={() => onAction('noshow')} disabled={actionBusy}>No-Show</button>
          )}
          {['Scheduled', 'Confirmed'].includes(appointment.status) && (
            <button type="button" style={{ ...css.btn, ...css.btnGhost }} onClick={() => onAction('reschedule')} disabled={actionBusy}>Reschedule</button>
          )}
          {['Scheduled', 'Confirmed'].includes(appointment.status) && (
            <button type="button" style={{ ...css.btn, ...css.btnDanger }} onClick={() => onAction('cancel')} disabled={actionBusy}>Cancel</button>
          )}
          {appointment.status === 'Arrived' && appointment.visit_id && (
            <button
              type="button"
              style={{ ...css.btn, ...css.btnPri }}
              onClick={() => navigate('consultation', { visitId: appointment.visit_id, patientId: appointment.patient_id, source: 'appointment-arrival' })}
            >
              Go to Consultation
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Appointments() {
  const { hospitalId, hospitalName, userRole, navigate } = useHospital()
  const [appointments, setAppointments] = useState([])
  const [patients, setPatients] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [view, setView] = useState('week')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [doctorFilter, setDoctorFilter] = useState('all')
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [now, setNow] = useState(() => new Date())
  const [showModal, setShowModal] = useState(false)
  const [selectedAppointment, setSelectedAppointment] = useState(null)
  const [editingAppointment, setEditingAppointment] = useState(null)
  const [rescheduleSource, setRescheduleSource] = useState(null)
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState([])
  const [patientVisits, setPatientVisits] = useState([])
  const [expandedSlot, setExpandedSlot] = useState('')
  const [form, setForm] = useState(() => ({
    patient_id: '',
    patient_name: '',
    patient_number: '',
    patient_phone: '',
    doctor_id: '',
    doctor_name: '',
    department: '',
    appointment_type: APPOINTMENT_TYPES[0],
    appointment_date: formatDateInput(new Date()),
    start_time: TIME_SLOTS[0],
    duration_minutes: 30,
    notes: '',
    visit_id: '',
  }))

  useEffect(() => {
    if (!hospitalId) {
      setLoading(false)
      return
    }
    void fetchAll()
  }, [hospitalId])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!hospitalId) return
    const query = patientSearch.trim().toLowerCase()
    if (query.length < 2) {
      setPatientResults([])
      return
    }

    const timer = window.setTimeout(async () => {
      const { data } = await supabase
        .from('patients')
        .select('id,full_name,phone,patient_number')
        .eq('hospital_id', hospitalId)
        .or(`full_name.ilike.%${query}%,patient_number.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(8)
      setPatientResults(data || [])
    }, 220)

    return () => window.clearTimeout(timer)
  }, [patientSearch, hospitalId])

  useEffect(() => {
    if (!hospitalId || !form.patient_id) {
      setPatientVisits([])
      return
    }
    void (async () => {
      const { data } = await supabase
        .from('visits')
        .select('id,visit_number,status,created_at')
        .eq('hospital_id', hospitalId)
        .eq('patient_id', form.patient_id)
        .in('status', ['OPD', 'Doctor', 'Vitals'])
        .order('created_at', { ascending: false })
        .limit(12)
      setPatientVisits(data || [])
    })()
  }, [form.patient_id, hospitalId])

  async function fetchAll() {
    setLoading(true)
    const [appointmentResponse, patientResponse, staffResponse] = await Promise.all([
      supabase
        .from('appointments')
        .select('*, patients(id,full_name,patient_number,phone,date_of_birth,gender)')
        .eq('hospital_id', hospitalId)
        .order('appointment_date', { ascending: true }),
      supabase
        .from('patients')
        .select('id,full_name,phone,patient_number')
        .eq('hospital_id', hospitalId)
        .order('full_name'),
      supabase
        .from('staff')
        .select('id,full_name,role,department,status,job_title,role_category')
        .eq('hospital_id', hospitalId)
        .eq('status', 'Active')
        .order('full_name'),
    ])
    const appointmentRows = (appointmentResponse.data || []).map((appointment) => ({
      ...appointment,
      patient: appointment.patients || null,
    }))
    setAppointments(appointmentRows)
    setPatients(patientResponse.data || [])
    setStaff(staffResponse.data || [])
    setLoading(false)
    return appointmentRows
  }

  function resetForm(next = {}) {
    setForm({
      patient_id: '',
      patient_name: '',
      patient_number: '',
      patient_phone: '',
      doctor_id: '',
      doctor_name: '',
      department: '',
      appointment_type: APPOINTMENT_TYPES[0],
      appointment_date: formatDateInput(new Date()),
      start_time: TIME_SLOTS[0],
      duration_minutes: 30,
      notes: '',
      visit_id: '',
      ...next,
    })
    setPatientSearch(next.patient_name || '')
    setPatientResults([])
  }

  function openCreateModal() {
    setEditingAppointment(null)
    setRescheduleSource(null)
    resetForm()
    setShowModal(true)
  }

  function openRescheduleModal(appointment) {
    setEditingAppointment(null)
    setRescheduleSource(appointment)
    resetForm(buildAppointmentForm(appointment))
    setShowModal(true)
  }

  const clinicalStaff = useMemo(() => staff.filter(isClinicalStaff), [staff])

  const departments = useMemo(
    () => [...new Set(clinicalStaff.map((member) => member.department).filter(Boolean))].sort(),
    [clinicalStaff],
  )

  const filteredAppointments = useMemo(() => appointments.filter((appointment) => {
    const q = search.trim().toLowerCase()
    const patientName = appointment.patient?.full_name || appointment.patient_name || ''
    const patientNumber = appointment.patient?.patient_number || ''
    const matchSearch = !q || `${patientName} ${patientNumber}`.toLowerCase().includes(q)
    const matchDoctor = doctorFilter === 'all' || String(appointment.doctor_id || '') === doctorFilter
    const matchDepartment = departmentFilter === 'all' || appointment.department === departmentFilter
    const matchStatus = statusFilter === 'all' || appointment.status === statusFilter
    const matchFrom = !dateFrom || appointment.appointment_date >= dateFrom
    const matchTo = !dateTo || appointment.appointment_date <= dateTo
    return matchSearch && matchDoctor && matchDepartment && matchStatus && matchFrom && matchTo
  }), [appointments, search, doctorFilter, departmentFilter, statusFilter, dateFrom, dateTo])

  const paginatedAppointments = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredAppointments.slice(start, start + PAGE_SIZE)
  }, [filteredAppointments, page])

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const weekAppointments = useMemo(() => filteredAppointments.filter((appointment) => {
    const appointmentDay = appointment.appointment_date
    const start = formatDateInput(weekStart)
    const end = formatDateInput(addDays(weekStart, 6))
    return appointmentDay >= start && appointmentDay <= end
  }), [filteredAppointments, weekStart])

  const groupedWeekSlots = useMemo(() => {
    const map = {}
    weekAppointments.forEach((appointment) => {
      const slot = String(appointment.start_time || '').slice(0, 5)
      const key = `${appointment.appointment_date}|${slot}`
      map[key] = map[key] || []
      map[key].push(appointment)
    })
    return map
  }, [weekAppointments])

  const slotCountsForDoctor = useMemo(() => {
    const map = {}
    if (!form.doctor_id || !form.appointment_date) return map
    appointments.forEach((appointment) => {
      if (String(appointment.doctor_id || '') !== String(form.doctor_id) || appointment.appointment_date !== form.appointment_date) return
      if (editingAppointment && appointment.id === editingAppointment.id) return
      if (rescheduleSource && appointment.id === rescheduleSource.id) return
      const slot = String(appointment.start_time || '').slice(0, 5)
      map[slot] = (map[slot] || 0) + 1
    })
    return map
  }, [appointments, form.doctor_id, form.appointment_date, editingAppointment, rescheduleSource])

  const stats = useMemo(() => {
    const today = formatDateInput(new Date())
    const weekStartDate = getMonday(new Date())
    const weekEndDate = formatDateInput(addDays(weekStartDate, 6))
    const weekStartKey = formatDateInput(weekStartDate)
    const thisWeek = appointments.filter((appointment) => appointment.appointment_date >= weekStartKey && appointment.appointment_date <= weekEndDate)
    const cancelled = thisWeek.filter((appointment) => appointment.status === 'Cancelled').length
    const noShows = thisWeek.filter((appointment) => appointment.status === 'No-Show').length
    return {
      today: appointments.filter((appointment) => appointment.appointment_date === today).length,
      confirmed: appointments.filter((appointment) => appointment.status === 'Confirmed').length,
      noShows,
      cancellationRate: thisWeek.length ? Math.round((cancelled / thisWeek.length) * 100) : 0,
    }
  }, [appointments])

  const currentTimeLine = useMemo(() => {
    const todayKey = formatDateInput(now)
    const weekIndex = weekDays.findIndex((day) => formatDateInput(day) === todayKey)
    if (weekIndex < 0) return null
    const minutes = now.getHours() * 60 + now.getMinutes()
    const dayStart = 8 * 60
    const dayEnd = 18 * 60
    if (minutes < dayStart || minutes > dayEnd) return null
    const offset = ((minutes - dayStart) / 30) * SLOT_HEIGHT
    return { dayIndex: weekIndex, top: offset }
  }, [now, weekDays])

  async function handleSaveAppointment() {
    if (!form.patient_id || !form.doctor_id || !form.appointment_date || !form.start_time) {
      window.notifyFromLegacyAlert('Patient, doctor, date, and time are required.')
      return
    }

    setSaving(true)
    const endTime = addMinutes(form.start_time, form.duration_minutes)
    const payload = {
      hospital_id: hospitalId,
      patient_id: form.patient_id,
      doctor_id: form.doctor_id,
      doctor_name: form.doctor_name,
      department: form.department || null,
      appointment_type: form.appointment_type,
      appointment_date: form.appointment_date,
      start_time: form.start_time,
      end_time: endTime,
      duration_minutes: Number(form.duration_minutes || 30),
      status: 'Scheduled',
      notes: form.notes || null,
      visit_id: form.visit_id || null,
      created_by: userRole || 'Staff',
    }

    const isEditing = Boolean(editingAppointment?.id)
    const query = isEditing
      ? supabase.from('appointments').update(payload).eq('id', editingAppointment.id).eq('hospital_id', hospitalId)
      : supabase.from('appointments').insert({ ...payload, created_at: new Date().toISOString() })

    const { error } = await query
    if (error) {
      setSaving(false)
      window.notifyFromLegacyAlert(`Error saving appointment: ${error.message}`)
      return
    }

    if (rescheduleSource?.id && !isEditing) {
      await supabase
        .from('appointments')
        .update({
          status: 'Cancelled',
          cancellation_reason: `Rescheduled to ${form.appointment_date} ${form.start_time}`,
        })
        .eq('id', rescheduleSource.id)
        .eq('hospital_id', hospitalId)
    }

    const patient = patients.find((entry) => entry.id === form.patient_id) || {
      full_name: form.patient_name,
      phone: form.patient_phone,
    }
    const savedAppointment = {
      ...payload,
      appointment_date: form.appointment_date,
      start_time: form.start_time,
      duration_minutes: form.duration_minutes,
      patient_id: form.patient_id,
    }

    void notifyAppointmentBooked({
      appointment: savedAppointment,
      patient,
      hospitalId,
      hospitalName,
    })

    setSaving(false)
    setShowModal(false)
    setEditingAppointment(null)
    setRescheduleSource(null)
    resetForm()
    await fetchAll()
  }

  async function handleDetailAction(action) {
    if (!selectedAppointment) return

    setActionBusy(true)
    const appointment = selectedAppointment

    try {
      if (action === 'confirm') {
        await supabase
          .from('appointments')
          .update({ status: 'Confirmed', confirmed_at: new Date().toISOString() })
          .eq('id', appointment.id)
          .eq('hospital_id', hospitalId)
      }

      if (action === 'arrive') {
        let visitId = appointment.visit_id || null
        if (!visitId) {
          const visitPayload = {
            hospital_id: hospitalId,
            patient_id: appointment.patient_id,
            visit_number: `V-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
            visit_type: appointment.appointment_type || 'Outpatient',
            chief_complaint: appointment.notes || `${appointment.appointment_type} appointment`,
            priority: 'Routine',
            admission_fee: 0,
            admission_payment_method: 'Cash',
            status: 'OPD',
            assigned_doctor_name: appointment.doctor_name || null,
            speciality: appointment.department || null,
          }
          const { data: createdVisit, error } = await supabase
            .from('visits')
            .insert(visitPayload)
            .select('id')
            .single()
          if (error) throw error
          visitId = createdVisit?.id || null
          await appendVisitInvoiceCharge({
            hospitalId,
            patientId: appointment.patient_id,
            visitId,
            patientName: appointment.patient?.full_name || appointment.patient_name || 'Patient',
            appointmentId: appointment.id,
            appointmentType: appointment.appointment_type || 'Appointment',
          })
        }

        await supabase
          .from('appointments')
          .update({ status: 'Arrived', arrived_at: new Date().toISOString(), visit_id: visitId })
          .eq('id', appointment.id)
          .eq('hospital_id', hospitalId)
      }

      if (action === 'complete') {
        await supabase
          .from('appointments')
          .update({ status: 'Completed', completed_at: new Date().toISOString() })
          .eq('id', appointment.id)
          .eq('hospital_id', hospitalId)
      }

      if (action === 'noshow') {
        await supabase
          .from('appointments')
          .update({ status: 'No-Show' })
          .eq('id', appointment.id)
          .eq('hospital_id', hospitalId)
      }

      if (action === 'cancel') {
        const reason = window.prompt('Enter cancellation reason:', appointment.cancellation_reason || '')
        if (reason === null) {
          setActionBusy(false)
          return
        }
        await supabase
          .from('appointments')
          .update({ status: 'Cancelled', cancellation_reason: reason || 'Cancelled' })
          .eq('id', appointment.id)
          .eq('hospital_id', hospitalId)
      }

      if (action === 'reschedule') {
        setActionBusy(false)
        setSelectedAppointment(null)
        openRescheduleModal(appointment)
        return
      }

      const refreshedRows = await fetchAll()
      const refreshed = refreshedRows.find((entry) => entry.id === appointment.id)
      setSelectedAppointment(refreshed ? { ...refreshed } : null)
    } catch (error) {
      window.notifyFromLegacyAlert(`Error updating appointment: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    setActionBusy(false)
  }

  return (
    <div style={css.page}>
      <div style={css.wrap}>
        <div style={css.header}>
          <div>
            <h1 style={css.h1}>Appointment Scheduling</h1>
            <div style={css.subtext}>Plan bookings, track arrivals, and hand off ready patients to consultation.</div>
          </div>
          <button type="button" style={{ ...css.btn, ...css.btnPri }} onClick={openCreateModal}>Book Appointment</button>
        </div>

        <div style={css.statsRow}>
          {[
            ['Today\'s Appointments', stats.today, 'Booked for today', C.primary],
            ['Confirmed', stats.confirmed, 'Across all upcoming bookings', C.success],
            ['No-Shows This Week', stats.noShows, 'Marked this week', C.warn],
            ['Cancellation Rate %', `${stats.cancellationRate}%`, 'Cancelled / total this week', C.danger],
          ].map(([label, value, sub, color]) => (
            <div key={label} style={css.stat}>
              <div style={css.statLbl}>{label}</div>
              <div style={{ ...css.statVal, color }}>{value}</div>
              <div style={css.statSub}>{sub}</div>
            </div>
          ))}
        </div>

        <div style={css.toolbar}>
          <button type="button" style={{ ...css.btn, ...(view === 'week' ? css.btnPri : css.btnGhost) }} onClick={() => setView('week')}>Week View</button>
          <button type="button" style={{ ...css.btn, ...(view === 'list' ? css.btnPri : css.btnGhost) }} onClick={() => setView('list')}>List View</button>
          <button type="button" style={{ ...css.btn, ...css.btnGhost }} onClick={() => setWeekStart((current) => addDays(current, -7))}>←</button>
          <div style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>{formatWeekLabel(weekStart)}</div>
          <button type="button" style={{ ...css.btn, ...css.btnGhost }} onClick={() => setWeekStart((current) => addDays(current, 7))}>→</button>
          <button type="button" style={{ ...css.btn, ...css.btnGhost }} onClick={() => setWeekStart(getMonday(new Date()))}>Today</button>
          <div style={{ minWidth: '240px', flex: 1 }}>
            <input style={css.input} placeholder="Search patient name or patient number" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>

        {view === 'week' ? (
          <div style={{ ...css.card, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `90px repeat(7, minmax(0, 1fr))`, borderBottom: `1px solid ${C.border}`, background: '#FAFBFD' }}>
              <div style={{ padding: '10px 12px', fontSize: '11px', color: C.sub, fontWeight: 700, textTransform: 'uppercase' }}>Time</div>
              {weekDays.map((day) => (
                <div key={day.toISOString()} style={{ padding: '10px 12px', borderLeft: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: '11px', color: C.sub, textTransform: 'uppercase', fontWeight: 700 }}>{day.toLocaleDateString('en-KE', { weekday: 'short' })}</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: C.text, marginTop: '4px' }}>{formatDateShort(day)}</div>
                </div>
              ))}
            </div>

            <div style={{ position: 'relative' }}>
              <div style={{ display: 'grid', gridTemplateColumns: `90px repeat(7, minmax(0, 1fr))` }}>
                {TIME_SLOTS.map((slot) => (
                  <div key={slot} style={{ display: 'contents' }}>
                    <div style={{ height: `${SLOT_HEIGHT}px`, padding: '8px 12px', fontSize: '11px', color: C.sub, borderBottom: `1px solid ${C.border}` }}>
                      {formatTimeDisplay(slot)}
                    </div>
                    {weekDays.map((day) => {
                      const key = `${formatDateInput(day)}|${slot}`
                      const items = groupedWeekSlots[key] || []
                      const expanded = expandedSlot === key
                      const visibleItems = expanded ? items : items.slice(0, 2)

                      return (
                        <div key={key} style={{ position: 'relative', height: `${SLOT_HEIGHT}px`, borderLeft: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: '2px 4px', overflow: 'hidden' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {visibleItems.map((appointment) => {
                              const status = statusBadge(appointment.status)
                              return (
                                <button
                                  key={appointment.id}
                                  type="button"
                                  onClick={() => setSelectedAppointment(appointment)}
                                  style={{ border: 'none', borderRadius: '8px', background: status.bg, color: status.color, textAlign: 'left', padding: '4px 6px', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}
                                >
                                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{appointment.patient?.full_name || appointment.patient_name}</div>
                                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>{appointment.appointment_type}</div>
                                </button>
                              )
                            })}
                            {!expanded && items.length > 2 && (
                              <button type="button" onClick={() => setExpandedSlot(key)} style={{ border: 'none', background: '#EFF6FF', color: '#2563EB', borderRadius: '999px', fontSize: '10px', fontWeight: 700, padding: '2px 6px', cursor: 'pointer', alignSelf: 'flex-start' }}>
                                +{items.length - 2} more
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>

              {currentTimeLine && (
                <div
                  style={{
                    position: 'absolute',
                    left: `calc(90px + (${currentTimeLine.dayIndex} * ((100% - 90px) / 7)))`,
                    width: 'calc((100% - 90px) / 7)',
                    top: `${currentTimeLine.top}px`,
                    height: '2px',
                    background: '#DC2626',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ ...css.card, padding: '14px 16px' }}>
              <div style={css.grid3}>
                <div>
                  <label style={css.label}>From</label>
                  <input style={css.input} type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1) }} />
                </div>
                <div>
                  <label style={css.label}>To</label>
                  <input style={css.input} type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1) }} />
                </div>
                <div>
                  <label style={css.label}>Doctor</label>
                  <select style={css.select} value={doctorFilter} onChange={(event) => { setDoctorFilter(event.target.value); setPage(1) }}>
                    <option value="all">All clinicians</option>
                    {clinicalStaff.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.full_name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ ...css.grid2, marginTop: '12px' }}>
                <div>
                  <label style={css.label}>Department</label>
                  <select style={css.select} value={departmentFilter} onChange={(event) => { setDepartmentFilter(event.target.value); setPage(1) }}>
                    <option value="all">All departments</option>
                    {departments.map((department) => <option key={department}>{department}</option>)}
                  </select>
                </div>
                <div>
                  <label style={css.label}>Status</label>
                  <select style={css.select} value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}>
                    <option value="all">All statuses</option>
                    {STATUSES.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div style={css.card}>
              <div style={{ overflowX: 'auto' }}>
                <table style={css.table}>
                  <thead>
                    <tr>
                      {['Time', 'Patient', 'Doctor', 'Department', 'Type', 'Status', 'Actions'].map((head) => <th key={head} style={css.th}>{head}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedAppointments.length === 0 && (
                      <tr><td colSpan={7} style={{ ...css.td, textAlign: 'center', color: C.sub, padding: '28px' }}>{loading ? 'Loading appointments...' : 'No appointments found for the current filters.'}</td></tr>
                    )}
                    {paginatedAppointments.map((appointment) => {
                      const badge = statusBadge(appointment.status)
                      return (
                        <tr key={appointment.id}>
                          <td style={css.td}>
                            <div style={{ fontWeight: 700 }}>{formatDate(appointment.appointment_date)}</div>
                            <div style={{ fontSize: '12px', color: C.sub }}>{formatTimeDisplay(appointment.start_time)}</div>
                          </td>
                          <td style={css.td}>
                            <div style={{ fontWeight: 700 }}>{appointment.patient?.full_name || appointment.patient_name || 'Patient'}</div>
                            <div style={{ fontSize: '12px', color: C.sub }}>{appointment.patient?.patient_number || 'No patient number'}</div>
                          </td>
                          <td style={css.td}>{appointment.doctor_name || '—'}</td>
                          <td style={css.td}>{appointment.department || '—'}</td>
                          <td style={css.td}><span style={{ ...css.pill, background: '#EFF6FF', color: '#2563EB' }}>{appointment.appointment_type}</span></td>
                          <td style={css.td}><span style={{ ...css.pill, background: badge.bg, color: badge.color }}>{appointment.status}</span></td>
                          <td style={css.td}>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              <button type="button" style={{ ...css.btn, ...css.btnGhost, padding: '6px 10px', fontSize: '11px' }} onClick={() => setSelectedAppointment(appointment)}>View</button>
                              {['Scheduled', 'Confirmed'].includes(appointment.status) && (
                                <button type="button" style={{ ...css.btn, ...css.btnSoft, padding: '6px 10px', fontSize: '11px' }} onClick={() => openRescheduleModal(appointment)}>Reschedule</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '12px 16px' }}>
                <div style={{ fontSize: '12px', color: C.sub }}>Page {page} of {Math.max(1, Math.ceil(filteredAppointments.length / PAGE_SIZE))}</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" style={{ ...css.btn, ...css.btnGhost }} onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Previous</button>
                  <button type="button" style={{ ...css.btn, ...css.btnGhost }} onClick={() => setPage((current) => Math.min(Math.ceil(filteredAppointments.length / PAGE_SIZE) || 1, current + 1))} disabled={page >= Math.ceil(filteredAppointments.length / PAGE_SIZE)}>Next</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showModal && (
          <BookingModal
            form={form}
            setForm={setForm}
            patientResults={patientResults}
            patientSearch={patientSearch}
            setPatientSearch={setPatientSearch}
            onSelectPatient={(patient) => {
              setForm((current) => ({
                ...current,
                patient_id: patient.id,
                patient_name: patient.full_name || '',
                patient_number: patient.patient_number || '',
                patient_phone: patient.phone || '',
              }))
              setPatientSearch(patient.full_name || '')
              setPatientResults([])
            }}
            doctors={clinicalStaff}
            visitOptions={patientVisits}
            slotCounts={slotCountsForDoctor}
            onClose={() => { setShowModal(false); setEditingAppointment(null); setRescheduleSource(null) }}
            onSave={handleSaveAppointment}
            saving={saving}
            editing={Boolean(editingAppointment || rescheduleSource)}
          />
        )}

        <AppointmentDetailPanel
          appointment={selectedAppointment}
          onClose={() => setSelectedAppointment(null)}
          onAction={handleDetailAction}
          actionBusy={actionBusy}
          navigate={navigate}
        />
      </div>
    </div>
  )
}
