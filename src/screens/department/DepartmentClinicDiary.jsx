// Clinic diary for a department: today's booked patients, the next 7 or 30 days, booking and cancelling right here.
// Appointments match the department by its proper name, so "Psychiatry" bookings show in Mental Health & Psychiatry.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { localDateKey } from '../../utils/scheduling'
import DepartmentBooking from './DepartmentBooking'

const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return localDateKey(new Date(y, m - 1, d + n)) }
const CLOSED = ['Cancelled', 'No Show', 'No-show', 'Missed']
const RANGES = [['today', 'Today', 0], ['week', 'Next 7 days', 7], ['month', 'Next 30 days', 30]]
const TONE = { Scheduled: '#475467', Confirmed: '#0F6E56', Arrived: '#05603A', Completed: '#05603A', Cancelled: '#912018', 'No Show': '#B54708' }

export default function DepartmentClinicDiary({ hospitalId, hospitalName, matchesDepartment, department, staff = [], userRole, navigate, css, SectionCard, EmptyState, onCount }) {
  const [rows, setRows] = useState([])
  const [range, setRange] = useState('today')
  const [error, setError] = useState('')
  const [booking, setBooking] = useState(false)
  const [notice, setNotice] = useState('')
  const [cancelling, setCancelling] = useState(null)
  const [reason, setReason] = useState('')
  const today = localDateKey(new Date())
  const load = useCallback(async () => {
    if (!hospitalId) return
    const { data, error: e } = await supabase.from('appointments')
      .select('*, patients(id,full_name,patient_number,phone)')
      .eq('hospital_id', hospitalId).gte('appointment_date', today).lte('appointment_date', addDays(today, 30))
      .order('appointment_date', { ascending: true })
    if (e) { setError(e.message); return }
    setError('')
    setRows((data || []).filter((a) => matchesDepartment(a.department)))
  }, [hospitalId, today, matchesDepartment])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const refresh = () => void load()
    window.addEventListener('remedacare:workflow_changed', refresh)
    return () => window.removeEventListener('remedacare:workflow_changed', refresh)
  }, [load])

  const days = RANGES.find((r) => r[0] === range)[2]
  const shown = useMemo(() => rows
    .filter((a) => a.appointment_date <= addDays(today, days))
    .sort((a, b) => `${a.appointment_date} ${a.start_time || ''}`.localeCompare(`${b.appointment_date} ${b.start_time || ''}`)), [rows, days, today])
  const todayCount = rows.filter((a) => a.appointment_date === today && !CLOSED.includes(a.status)).length
  useEffect(() => { onCount?.(todayCount) }, [todayCount, onCount])

  async function cancel(a) {
    if (!reason.trim()) { setError('Give the reason for cancelling.'); return }
    const { error: e } = await supabase.from('appointments').update({ status: 'Cancelled', cancellation_reason: reason.trim() }).eq('id', a.id).eq('hospital_id', hospitalId)
    if (e) { setError(e.message); return }
    setCancelling(null); setReason(''); setError(''); void load()
  }

  return (
    <SectionCard title="Clinic diary" count={todayCount}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {RANGES.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={range === k} onClick={() => setRange(k)}
            style={{ ...css.backBtn, padding: '5px 12px', ...(range === k ? { background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' } : {}) }}>{l}</button>
        ))}
        {!booking && (
          <button type="button" style={{ ...css.backBtn, padding: '5px 12px', marginLeft: 'auto', background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' }}
            onClick={() => { setBooking(true); setNotice('') }}>Book appointment</button>
        )}
      </div>
      {booking && (
        <DepartmentBooking hospitalId={hospitalId} hospitalName={hospitalName} department={department} staff={staff} userRole={userRole} css={css}
          onClose={() => setBooking(false)}
          onBooked={(row, p) => { setBooking(false); setNotice(`Booked: ${p.full_name}, ${row.appointment_date} at ${row.start_time} with ${row.doctor_name || 'the clinician'}.`); if (row.appointment_date > addDays(today, days)) setRange('month'); void load() }} />
      )}
      {notice && <div role="status" style={{ color: '#05603A', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{notice}</div>}
      {error && <div role="alert" style={{ color: '#912018', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      {shown.length === 0 ? <EmptyState message={range === 'today' ? 'No patients booked for today.' : `No bookings in the next ${days} days.`} /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={css.table}>
            <thead><tr>{[range === 'today' ? 'Time' : 'Date and time', 'Patient', 'Type', 'Clinician', 'Status', ''].map((h, i) => <th key={i} style={css.th}>{h}</th>)}</tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...css.td, whiteSpace: 'nowrap', fontWeight: 700 }}>{range === 'today' ? '' : `${a.appointment_date} `}{String(a.start_time || '').slice(0, 5) || '—'}</td>
                  <td style={css.td}><div style={{ fontWeight: 700 }}>{a.patients?.full_name || a.patient_name || '—'}</div>{a.patients?.patient_number && <div style={{ fontSize: 12, color: '#475467' }}>{a.patients.patient_number}</div>}</td>
                  <td style={css.td}>{a.appointment_type || '—'}</td>
                  <td style={css.td}>{a.doctor_name || '—'}</td>
                  <td style={css.td}><span style={{ ...css.statusPill(TONE[a.status] || '#475467') }}>{a.status || 'Scheduled'}</span>{a.status === 'Cancelled' && a.cancellation_reason && <div style={{ fontSize: 12, color: '#475467' }}>{a.cancellation_reason}</div>}</td>
                  <td style={{ ...css.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {!CLOSED.includes(a.status) && !['Arrived', 'Completed'].includes(a.status) && (cancelling === a.id ? (
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input aria-label="Reason for cancelling" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason"
                          style={{ padding: '5px 8px', border: '1px solid #D0D5DD', borderRadius: 6, fontSize: 13, minWidth: 160 }} />
                        <button type="button" style={{ ...css.dangerBtn, padding: '4px 10px' }} onClick={() => void cancel(a)}>Confirm cancel</button>
                        <button type="button" style={{ ...css.backBtn, padding: '4px 10px' }} onClick={() => { setCancelling(null); setError('') }}>Keep</button>
                      </span>
                    ) : (
                      <button type="button" style={{ ...css.backBtn, padding: '4px 10px' }} onClick={() => { setCancelling(a.id); setReason('') }}>Cancel</button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 12.5, color: '#475467' }}>
        Patients check in at reception on the day.{' '}
        <button type="button" style={{ border: 'none', background: 'none', padding: 0, color: '#0F6E56', fontWeight: 700, cursor: 'pointer', fontSize: 12.5 }}
          onClick={() => navigate?.('appointments', { department })}>Open the full appointments calendar</button>
      </div>
    </SectionCard>
  )
}
