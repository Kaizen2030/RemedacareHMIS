// Waiting list. When a future booking is cancelled the database offers the freed slot to the first matching
// patient here (and SMSes them). Staff then book the offered slot in one click, or release it.
import { useEffect, useState } from 'react'
import supabase from '../../supabase'
import { colors as C } from '../../theme'

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 },
  modal: { width: 820, maxWidth: '97vw', maxHeight: '92vh', overflowY: 'auto', background: C.surface, borderRadius: 16, boxShadow: '0 24px 70px rgba(15,23,42,.28)', padding: 20, color: C.text, fontSize: 13 },
  label: { fontSize: 11, color: C.sub, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em', marginBottom: 5, display: 'block' },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, fontSize: 13, color: C.text },
  btn: { padding: '8px 13px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12 },
  pri: { background: C.primary, color: '#fff' },
  ghost: { background: C.surface, color: C.text, border: `1px solid ${C.border}` },
  danger: { background: C.dangerL, color: C.danger },
  err: { background: C.dangerL, color: C.danger, borderRadius: 8, padding: '8px 11px', marginTop: 10, fontSize: 12 },
  item: { border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' },
  tag: { borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 800 },
}
const blank = { patient_id: '', patient_name: '', phone: '', staff_id: '', department: '', appointment_type: '', earliest_date: '', latest_date: '', preferred_times: '', priority: 0, notes: '' }

export default function WaitlistPanel({ hospitalId, clinicians = [], patients = [], onClose, onBookOffer, onChanged }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(blank)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data, error: e } = await supabase.from('appointment_waitlist').select('*')
      .eq('hospital_id', hospitalId).in('status', ['waiting', 'offered']).order('status', { ascending: false }).order('priority', { ascending: false }).order('created_at')
    if (e) setError(e.message)
    setRows(data || [])
  }
  useEffect(() => { void load() }, [hospitalId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn) {
    setBusy(true); setError('')
    try { await fn(); await load(); onChanged?.() } catch (e) { setError(e.message || String(e)) }
    setBusy(false)
  }
  const add = () => run(async () => {
    if (!form.patient_name.trim()) throw new Error('Enter the patient name')
    const { error: e } = await supabase.from('appointment_waitlist').insert({
      ...form, hospital_id: hospitalId, patient_id: form.patient_id || null, staff_id: form.staff_id || null,
      department: form.department || null, appointment_type: form.appointment_type || null,
      earliest_date: form.earliest_date || null, latest_date: form.latest_date || null, priority: Number(form.priority) || 0,
    })
    if (e) throw e
    setForm(blank)
  })
  const setStatus = (id, status, extra = {}) => run(async () => {
    const { error: e } = await supabase.from('appointment_waitlist').update({ status, ...extra }).eq('id', id)
    if (e) throw e
  })
  const pickPatient = (id) => {
    const p = patients.find((x) => String(x.id) === String(id))
    setForm((f) => ({ ...f, patient_id: id, patient_name: p?.full_name || f.patient_name, phone: p?.phone || f.phone }))
  }

  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-label="Waiting list">
      <div style={s.modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Waiting list</h3>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>When a booking is cancelled, the first matching patient is offered the slot by SMS automatically. Offers lapse after 4 hours.</div>
          </div>
          <button type="button" style={{ ...s.btn, ...s.ghost, alignSelf: 'flex-start' }} onClick={onClose}>Close</button>
        </div>
        {error && <div style={s.err} role="alert">{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          {rows.length === 0 && <div style={{ color: C.sub, fontSize: 12 }}>No one is waiting.</div>}
          {rows.map((w) => {
            const offered = w.status === 'offered' && w.offered_slot
            const doc = clinicians.find((c) => String(c.id) === String(w.staff_id))
            return (
              <div key={w.id} style={{ ...s.item, borderColor: offered ? C.success : C.border, background: offered ? C.successL : C.surface }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800 }}>{w.patient_name} {w.priority > 0 && <span style={{ ...s.tag, background: C.warnL, color: C.warn }}>priority</span>}</div>
                  <div style={{ fontSize: 12, color: C.sub }}>
                    {[w.phone, doc ? doc.full_name : 'Any clinician', w.department, w.appointment_type,
                      w.earliest_date || w.latest_date ? `${w.earliest_date || '…'} → ${w.latest_date || '…'}` : null, w.preferred_times].filter(Boolean).join(' · ')}
                  </div>
                  {offered && (
                    <div style={{ fontSize: 12, color: C.success, fontWeight: 700, marginTop: 4 }}>
                      Offered: {w.offered_slot.appointment_date} at {String(w.offered_slot.start_time || '').slice(0, 5)}{w.offered_slot.doctor_name ? ` with ${w.offered_slot.doctor_name}` : ''}
                      {w.offer_expires_at ? ` · until ${new Date(w.offer_expires_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {offered && <button type="button" style={{ ...s.btn, ...s.pri }} disabled={busy} onClick={() => onBookOffer?.(w)}>Book this slot</button>}
                  {offered && <button type="button" style={{ ...s.btn, ...s.ghost }} disabled={busy} onClick={() => setStatus(w.id, 'waiting', { offered_slot: null, offered_at: null, offer_expires_at: null })}>Patient declined</button>}
                  <button type="button" style={{ ...s.btn, ...s.danger }} disabled={busy} onClick={() => setStatus(w.id, 'cancelled')}>Remove</button>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 16, paddingTop: 14 }}>
          <div style={{ fontSize: 12, color: C.primary, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Add to waiting list</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
            <div><label style={s.label} htmlFor="wl-pat">Registered patient</label>
              <select id="wl-pat" style={s.input} value={form.patient_id} onChange={(e) => pickPatient(e.target.value)}>
                <option value="">— not registered / type below —</option>
                {patients.slice(0, 500).map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.patient_number ? ` · ${p.patient_number}` : ''}</option>)}
              </select>
            </div>
            <div><label style={s.label} htmlFor="wl-name">Name</label><input id="wl-name" style={s.input} value={form.patient_name} onChange={(e) => setForm((f) => ({ ...f, patient_name: e.target.value }))} /></div>
            <div><label style={s.label} htmlFor="wl-phone">Phone</label><input id="wl-phone" style={s.input} value={form.phone} placeholder="07…" onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
            <div><label style={s.label} htmlFor="wl-doc">Clinician</label>
              <select id="wl-doc" style={s.input} value={form.staff_id} onChange={(e) => setForm((f) => ({ ...f, staff_id: e.target.value }))}>
                <option value="">Any</option>
                {clinicians.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </div>
            <div><label style={s.label} htmlFor="wl-dept">Department</label><input id="wl-dept" style={s.input} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} /></div>
            <div><label style={s.label} htmlFor="wl-from">Earliest</label><input id="wl-from" type="date" style={s.input} value={form.earliest_date} onChange={(e) => setForm((f) => ({ ...f, earliest_date: e.target.value }))} /></div>
            <div><label style={s.label} htmlFor="wl-to">Latest</label><input id="wl-to" type="date" style={s.input} value={form.latest_date} onChange={(e) => setForm((f) => ({ ...f, latest_date: e.target.value }))} /></div>
            <div><label style={s.label} htmlFor="wl-times">Preferred times</label><input id="wl-times" style={s.input} value={form.preferred_times} placeholder="mornings" onChange={(e) => setForm((f) => ({ ...f, preferred_times: e.target.value }))} /></div>
            <div><label style={s.label} htmlFor="wl-prio">Priority</label>
              <select id="wl-prio" style={s.input} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}>
                <option value={0}>Normal</option><option value={1}>High</option><option value={2}>Urgent</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" style={{ ...s.btn, ...s.pri }} disabled={busy} onClick={add}>Add to list</button>
          </div>
        </div>
      </div>
    </div>
  )
}
