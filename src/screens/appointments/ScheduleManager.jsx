// Clinic hours per clinician: weekly template + leave / off / extra sessions.
// The database uses these to refuse bookings outside working hours (unless an override reason is given).
import { useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { colors as C } from '../../theme'
import { WEEKDAYS } from '../../utils/scheduling'

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 },
  modal: { width: 860, maxWidth: '97vw', maxHeight: '92vh', overflowY: 'auto', background: C.surface, borderRadius: 16, boxShadow: '0 24px 70px rgba(15,23,42,.28)', padding: 20, color: C.text, fontSize: 13 },
  h: { margin: 0, fontSize: 18, fontWeight: 800 },
  sub: { fontSize: 12, color: C.sub, marginTop: 4 },
  label: { fontSize: 11, color: C.sub, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em', marginBottom: 5, display: 'block' },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, fontSize: 13, color: C.text },
  btn: { padding: '8px 13px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12 },
  pri: { background: C.primary, color: '#fff' },
  ghost: { background: C.surface, color: C.text, border: `1px solid ${C.border}` },
  danger: { background: C.dangerL, color: C.danger },
  section: { border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginTop: 14 },
  title: { fontSize: 12, color: C.primary, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 10 },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 6, background: C.primaryL, color: C.primary, borderRadius: 999, padding: '4px 6px 4px 10px', fontSize: 12, fontWeight: 700, marginRight: 6, marginBottom: 6 },
  x: { border: 'none', background: 'transparent', color: C.primary, cursor: 'pointer', fontWeight: 800, fontSize: 13, lineHeight: 1 },
  err: { background: C.dangerL, color: C.danger, borderRadius: 8, padding: '8px 11px', marginTop: 10, fontSize: 12 },
  row: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${C.border}` },
}
const hhmm = (t) => String(t || '').slice(0, 5)

export default function ScheduleManager({ hospitalId, clinicians = [], initialClinicianId = '', onClose, onChanged }) {
  const [clinicianId, setClinicianId] = useState(initialClinicianId || clinicians[0]?.id || '')
  const [rows, setRows] = useState([])
  const [exceptions, setExceptions] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [win, setWin] = useState({ weekdays: [1, 2, 3, 4, 5], start: '08:00', end: '17:00', slot: 30 })
  const [exc, setExc] = useState({ kind: 'leave', from: '', to: '', start: '', end: '', reason: '' })

  async function load(id = clinicianId) {
    if (!id) return
    const [a, b] = await Promise.all([
      supabase.from('provider_schedules').select('*').eq('hospital_id', hospitalId).eq('staff_id', String(id)).eq('active', true).order('weekday').order('start_time'),
      supabase.from('provider_schedule_exceptions').select('*').eq('hospital_id', hospitalId).eq('staff_id', String(id))
        .gte('ends_on', new Date(Date.now() - 86400000).toISOString().slice(0, 10)).order('starts_on'),
    ])
    if (a.error || b.error) setError((a.error || b.error).message)
    setRows(a.data || [])
    setExceptions(b.data || [])
  }
  useEffect(() => { setError(''); void load(clinicianId) }, [clinicianId, hospitalId]) // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = useMemo(() => WEEKDAYS.map((_, d) => rows.filter((r) => Number(r.weekday) === d)), [rows])
  const clinician = clinicians.find((c) => String(c.id) === String(clinicianId))

  async function run(fn) {
    setBusy(true); setError('')
    try { await fn(); await load(); onChanged?.() } catch (e) { setError(e.message || String(e)) }
    setBusy(false)
  }
  const addWindows = () => run(async () => {
    if (!win.weekdays.length) throw new Error('Pick at least one day')
    if (win.end <= win.start) throw new Error('End time must be after start time')
    const { error: e } = await supabase.from('provider_schedules').insert(win.weekdays.map((weekday) => ({
      hospital_id: hospitalId, staff_id: String(clinicianId), weekday, start_time: win.start, end_time: win.end, slot_minutes: Number(win.slot) || 30,
    })))
    if (e) throw e
  })
  const removeWindow = (id) => run(async () => {
    const { error: e } = await supabase.from('provider_schedules').update({ active: false }).eq('id', id)
    if (e) throw e
  })
  const addException = () => run(async () => {
    if (!exc.from) throw new Error('Pick the first day')
    const to = exc.to || exc.from
    if (to < exc.from) throw new Error('The last day is before the first day')
    if ((exc.start && !exc.end) || (!exc.start && exc.end)) throw new Error('Give both a start and an end time, or neither for the whole day')
    const { error: e } = await supabase.from('provider_schedule_exceptions').insert({
      hospital_id: hospitalId, staff_id: String(clinicianId), kind: exc.kind, starts_on: exc.from, ends_on: to,
      start_time: exc.start || null, end_time: exc.end || null, reason: exc.reason || null,
    })
    if (e) throw e
    setExc({ kind: 'leave', from: '', to: '', start: '', end: '', reason: '' })
  })
  const removeException = (id) => run(async () => {
    const { error: e } = await supabase.from('provider_schedule_exceptions').delete().eq('id', id)
    if (e) throw e
  })

  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-label="Clinic hours">
      <div style={s.modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={s.h}>Clinic hours</h3>
            <div style={s.sub}>Bookings outside these hours or during leave are refused unless the receptionist records a reason. A clinician with no hours set can be booked any time.</div>
          </div>
          <button type="button" style={{ ...s.btn, ...s.ghost, alignSelf: 'flex-start' }} onClick={onClose}>Close</button>
        </div>

        <div style={{ marginTop: 14, maxWidth: 360 }}>
          <label style={s.label} htmlFor="sched-clinician">Clinician</label>
          <select id="sched-clinician" style={s.input} value={clinicianId} onChange={(e) => setClinicianId(e.target.value)}>
            {clinicians.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.department ? ` — ${c.department}` : ''}</option>)}
          </select>
        </div>
        {error && <div style={s.err} role="alert">{error}</div>}

        <div style={s.section}>
          <div style={s.title}>Weekly hours {clinician ? `· ${clinician.full_name}` : ''}</div>
          {byDay.map((windows, d) => (
            <div key={d} style={s.row}>
              <strong>{WEEKDAYS[d]}</strong>
              <div>
                {windows.length === 0 ? <span style={{ color: C.sub, fontSize: 12 }}>{rows.length ? 'No clinic' : 'Not set'}</span> : windows.map((w) => (
                  <span key={w.id} style={s.chip}>
                    {hhmm(w.start_time)}–{hhmm(w.end_time)} · {w.slot_minutes} min
                    <button type="button" style={s.x} disabled={busy} onClick={() => removeWindow(w.id)} aria-label={`Remove ${WEEKDAYS[d]} ${hhmm(w.start_time)}`}>×</button>
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end', marginTop: 12 }}>
            <div>
              <span style={s.label}>Days</span>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {WEEKDAYS.map((name, d) => {
                  const on = win.weekdays.includes(d)
                  return (
                    <button key={name} type="button" aria-pressed={on}
                      style={{ ...s.btn, padding: '6px 8px', ...(on ? s.pri : s.ghost) }}
                      onClick={() => setWin((w) => ({ ...w, weekdays: on ? w.weekdays.filter((x) => x !== d) : [...w.weekdays, d].sort() }))}>
                      {name.slice(0, 3)}
                    </button>
                  )
                })}
              </div>
            </div>
            <div><label style={s.label} htmlFor="w-start">From</label><input id="w-start" type="time" style={s.input} value={win.start} onChange={(e) => setWin((w) => ({ ...w, start: e.target.value }))} /></div>
            <div><label style={s.label} htmlFor="w-end">To</label><input id="w-end" type="time" style={s.input} value={win.end} onChange={(e) => setWin((w) => ({ ...w, end: e.target.value }))} /></div>
            <div><label style={s.label} htmlFor="w-slot">Slot</label>
              <select id="w-slot" style={s.input} value={win.slot} onChange={(e) => setWin((w) => ({ ...w, slot: Number(e.target.value) }))}>
                {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
            <button type="button" style={{ ...s.btn, ...s.pri }} disabled={busy || !clinicianId} onClick={addWindows}>Add hours</button>
          </div>
        </div>

        <div style={s.section}>
          <div style={s.title}>Leave, days off and extra sessions</div>
          {exceptions.length === 0 && <div style={{ color: C.sub, fontSize: 12 }}>Nothing upcoming.</div>}
          {exceptions.map((e) => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
              <div>
                <strong style={{ color: e.kind === 'extra' ? C.success : C.danger, textTransform: 'capitalize' }}>{e.kind === 'off' ? 'Not available' : e.kind}</strong>
                {' '}{e.starts_on}{e.ends_on !== e.starts_on ? ` → ${e.ends_on}` : ''}
                {e.start_time ? ` · ${hhmm(e.start_time)}–${hhmm(e.end_time)}` : ' · whole day'}
                {e.reason ? <span style={{ color: C.sub }}> · {e.reason}</span> : null}
              </div>
              <button type="button" style={{ ...s.btn, ...s.danger, padding: '4px 9px' }} disabled={busy} onClick={() => removeException(e.id)}>Remove</button>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr .8fr .8fr 1.4fr auto', gap: 8, alignItems: 'end', marginTop: 12 }}>
            <div><label style={s.label} htmlFor="x-kind">Type</label>
              <select id="x-kind" style={s.input} value={exc.kind} onChange={(e) => setExc((x) => ({ ...x, kind: e.target.value }))}>
                <option value="leave">Leave</option><option value="off">Not available</option><option value="extra">Extra session</option>
              </select>
            </div>
            <div><label style={s.label} htmlFor="x-from">From</label><input id="x-from" type="date" style={s.input} value={exc.from} onChange={(e) => setExc((x) => ({ ...x, from: e.target.value }))} /></div>
            <div><label style={s.label} htmlFor="x-to">To</label><input id="x-to" type="date" style={s.input} value={exc.to} onChange={(e) => setExc((x) => ({ ...x, to: e.target.value }))} /></div>
            <div><label style={s.label} htmlFor="x-start">Start</label><input id="x-start" type="time" style={s.input} value={exc.start} onChange={(e) => setExc((x) => ({ ...x, start: e.target.value }))} /></div>
            <div><label style={s.label} htmlFor="x-end">End</label><input id="x-end" type="time" style={s.input} value={exc.end} onChange={(e) => setExc((x) => ({ ...x, end: e.target.value }))} /></div>
            <div><label style={s.label} htmlFor="x-reason">Reason</label><input id="x-reason" style={s.input} value={exc.reason} placeholder="e.g. Annual leave" onChange={(e) => setExc((x) => ({ ...x, reason: e.target.value }))} /></div>
            <button type="button" style={{ ...s.btn, ...s.pri }} disabled={busy || !clinicianId} onClick={addException}>Add</button>
          </div>
          <div style={{ fontSize: 11, color: C.sub, marginTop: 6 }}>Leave times blank for the whole day. Existing bookings are not moved — check them in the calendar.</div>
        </div>
      </div>
    </div>
  )
}
