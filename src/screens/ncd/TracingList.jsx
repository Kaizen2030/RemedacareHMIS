// Defaulter tracing: open tasks created by the recall engine (overdue, lost to follow-up, missed appointment).
// Log each call / SMS / CHW home visit, then close with an outcome.
import { useEffect, useState } from 'react'
import supabase from '../../supabase'
import { Chip, s } from './ui'

const REASON = { overdue: ['Overdue', 'yellow'], ltfu: ['Lost to follow-up', 'red'], missed_appointment: ['Missed appointment', 'yellow'], uncontrolled: ['Uncontrolled', 'red'], lab_due: ['Lab due', 'blue'] }
const RESULT = { reached: 'Reached', no_answer: 'No answer', wrong_number: 'Wrong number', switched_off: 'Phone off', message_left: 'Message left', visited: 'Home visited' }
const OUTCOME = { rebooked: 'Rebooked', returned: 'Came back', transferred: 'Transferred out', died: 'Died', refused: 'Refused care', not_found: 'Could not be found', other: 'Other' }

export default function TracingList({ hospitalId, canEdit, onOpenEnrolment, onChanged, navigate }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({}) // taskId -> { method, result, notes, outcome, outcome_note }

  async function load() {
    setLoading(true)
    const { data, error: e } = await supabase.from('ncd_tracing_tasks')
      .select('*, ncd_tracing_attempts(method, result, notes, attempted_at), ncd_enrolments(id, condition_label, condition_code, next_visit_due, status, control_status, patient_id, hospital_id, enrolled_on, targets, care_plan, risk_class, refill_due, last_values, clinician_id, clinician_name, patients(full_name, phone, patient_number))')
      .eq('hospital_id', hospitalId).eq('status', 'open').order('due_since', { ascending: true }).limit(200)
    if (e) setError(e.message)
    setTasks(data || [])
    setLoading(false)
  }
  useEffect(() => { void load() }, [hospitalId]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = (id) => draft[id] || { method: 'call', result: 'no_answer', notes: '', outcome: '', outcome_note: '' }
  const set = (id, patch) => setDraft((x) => ({ ...x, [id]: { ...d(id), ...patch } }))

  async function logAttempt(t) {
    const x = d(t.id)
    const { error: e } = await supabase.from('ncd_tracing_attempts').insert({ task_id: t.id, hospital_id: hospitalId, method: x.method, result: x.result, notes: x.notes || null })
    if (e) { setError(e.message); return }
    set(t.id, { notes: '' })
    await load()
  }
  async function close(t) {
    const x = d(t.id)
    if (!x.outcome) { setError('Choose an outcome before closing the task.'); return }
    const { error: e } = await supabase.from('ncd_tracing_tasks').update({ status: 'closed', outcome: x.outcome, outcome_note: x.outcome_note || null, closed_at: new Date().toISOString() }).eq('id', t.id)
    if (e) { setError(e.message); return }
    const statusFor = { died: 'died', transferred: 'transferred_out', refused: 'refused' }[x.outcome]
    if (statusFor) await supabase.from('ncd_enrolments').update({ status: statusFor, status_reason: x.outcome_note || OUTCOME[x.outcome] }).eq('id', t.enrolment_id)
    await load(); onChanged?.()
  }

  if (loading) return <div style={s.sub}>Loading tracing list…</div>
  return (
    <div>
      {error && <div role="alert" style={s.err}>{error}</div>}
      {tasks.length === 0 && <div style={{ ...s.card, textAlign: 'center', color: '#667085' }}>Nobody needs tracing right now. 🎉</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {tasks.map((t) => {
          const e = t.ncd_enrolments || {}
          const p = e.patients || {}
          const [rLabel, rTone] = REASON[t.reason] || [t.reason, 'gray']
          const x = d(t.id)
          return (
            <div key={t.id} style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <button type="button" onClick={() => onOpenEnrolment?.(e)} style={{ border: 'none', background: 'none', padding: 0, fontWeight: 800, fontSize: 14, cursor: 'pointer', color: 'inherit' }}>{p.full_name || 'Patient'}</button>
                  <div style={s.sub}>{[p.phone, e.condition_label, t.due_since ? `due since ${t.due_since}` : null].filter(Boolean).join(' · ')}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <Chip tone={rTone}>{rLabel}</Chip>
                  <Chip>{(t.ncd_tracing_attempts || []).length} attempt(s)</Chip>
                  {p.phone && <a href={`tel:${p.phone}`} style={{ ...s.btn, ...s.soft, textDecoration: 'none' }}>Call</a>}
                  {navigate && <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => navigate('appointments', { patientId: e.patient_id, patientName: p.full_name, followUpInDays: 2, appointmentType: 'Chronic care review', notes: `${e.condition_label} — rebooked after tracing`, carePlanRef: e.id, source: 'ncd-tracing' })}>Rebook</button>}
                </div>
              </div>
              {(t.ncd_tracing_attempts || []).length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  {[...t.ncd_tracing_attempts].sort((a, b) => a.attempted_at.localeCompare(b.attempted_at)).map((a, i) => (
                    <div key={i} style={{ color: '#475467' }}>{new Date(a.attempted_at).toLocaleString('en-KE')} · {a.method.replace('_', ' ')} · <strong>{RESULT[a.result]}</strong>{a.notes ? ` — ${a.notes}` : ''}</div>
                  ))}
                </div>
              )}
              {canEdit && (
                <div style={{ ...s.grid(140), marginTop: 10, alignItems: 'end' }}>
                  <div><label style={s.label} htmlFor={`m-${t.id}`}>How</label>
                    <select id={`m-${t.id}`} style={s.input} value={x.method} onChange={(ev) => set(t.id, { method: ev.target.value })}>
                      <option value="call">Phone call</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="chw">CHW</option><option value="home_visit">Home visit</option>
                    </select></div>
                  <div><label style={s.label} htmlFor={`r-${t.id}`}>Result</label>
                    <select id={`r-${t.id}`} style={s.input} value={x.result} onChange={(ev) => set(t.id, { result: ev.target.value })}>
                      {Object.entries(RESULT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></div>
                  <div style={{ gridColumn: 'span 2' }}><label style={s.label} htmlFor={`n-${t.id}`}>Note</label><input id={`n-${t.id}`} style={s.input} value={x.notes} onChange={(ev) => set(t.id, { notes: ev.target.value })} /></div>
                  <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => logAttempt(t)}>Log attempt</button>
                  <div><label style={s.label} htmlFor={`o-${t.id}`}>Outcome</label>
                    <select id={`o-${t.id}`} style={s.input} value={x.outcome} onChange={(ev) => set(t.id, { outcome: ev.target.value })}>
                      <option value="">—</option>{Object.entries(OUTCOME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></div>
                  <div style={{ gridColumn: 'span 2' }}><label style={s.label} htmlFor={`on-${t.id}`}>Outcome note</label><input id={`on-${t.id}`} style={s.input} value={x.outcome_note} onChange={(ev) => set(t.id, { outcome_note: ev.target.value })} /></div>
                  <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => close(t)}>Close task</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
