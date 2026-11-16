// HR additions: weekly duty roster (clashes refused, rest / hours warnings), leave approval with balances, and licences /
// CPD with a compliance list. Data: staff_shifts, staff_leave, staff_licences, staff_cpd (20261218000000_hr_roster_leave.sql).
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { openPromptDialog } from '../../confirmDialog'
import { C, Chip, s } from '../ncd/ui'

const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Not installed yet. Run docs/sql/36_hr_roster_leave.sql in Supabase.'
  if (/row-level|policy/i.test(m)) return 'You do not have permission for that.'
  if (/duplicate key|unique/i.test(m)) return 'That shift is already on the roster.'
  return m
}
const iso = (d) => d.toISOString().slice(0, 10)
const mondayOf = (d) => { const x = new Date(d); x.setHours(12); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }
const SHIFT_TONE = { D: '#EFF8FF', N: '#F4F3FF', AM: '#ECFDF3', PM: '#FFFAEB', OC: '#FEF3F2', OFF: '#F2F4F7' }
export const LEAVE_STATUS = { requested: ['Waiting for HR', 'yellow'], approved: ['Approved', 'green'], rejected: ['Rejected', 'red'], cancelled: ['Cancelled', 'gray'] }

// ---------------------------------------------------------------- roster
export function HrRoster({ hospitalId, staff = [] }) {
  const [week, setWeek] = useState(() => mondayOf(new Date()))
  const [shifts, setShifts] = useState([])
  const [types, setTypes] = useState([])
  const [dept, setDept] = useState('all')
  const [err, setErr] = useState('')
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(week); d.setDate(d.getDate() + i); return iso(d) }), [week])
  const load = useCallback(async () => {
    const [sh, ty] = await Promise.all([
      supabase.from('staff_shifts').select('*').eq('hospital_id', hospitalId).gte('shift_date', days[0]).lte('shift_date', days[6]),
      supabase.from('hr_shift_types').select('*').order('code'),
    ])
    if (sh.error) { setErr(friendly(sh.error)); return }
    setErr(''); setShifts(sh.data || [])
    const byCode = new Map(); for (const t of ty.data || []) if (!byCode.has(t.code) || t.hospital_id) byCode.set(t.code, t)
    setTypes([...byCode.values()])
  }, [hospitalId, days])
  useEffect(() => { void load() }, [load])
  const people = staff.filter((p) => !['Terminated', 'Deceased', 'Rejected'].includes(p.status) && (dept === 'all' || p.department === dept))
  const depts = [...new Set(staff.map((p) => p.department).filter(Boolean))].sort()
  async function setCell(person, date, code) {
    setErr('')
    const existing = shifts.filter((x) => x.staff_id === person.id && x.shift_date === date)
    for (const x of existing) { const { error } = await supabase.from('staff_shifts').delete().eq('id', x.id); if (error) { setErr(friendly(error)); return } }
    if (code) {
      const { error } = await supabase.from('staff_shifts').insert({ hospital_id: hospitalId, staff_id: person.id, shift_date: date, shift_code: code, unit: person.department || null })
      if (error) setErr(`${person.full_name}, ${date}: ${friendly(error)}`)
    }
    void load()
  }
  const shift = (week2) => { const d = new Date(week); d.setDate(d.getDate() + week2 * 7); setWeek(d) }
  const onDutyToday = shifts.filter((x) => x.shift_date === iso(new Date()) && x.shift_code !== 'OFF').length
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => shift(-1)} aria-label="Previous week">‹</button>
          <b>Week of {new Date(days[0]).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</b>
          <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => shift(1)} aria-label="Next week">›</button>
        </div>
        <span style={s.sub}>{onDutyToday} rostered today</span>
        <select aria-label="Department" style={{ ...s.input, width: 200 }} value={dept} onChange={(e) => setDept(e.target.value)}><option value="all">All departments</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr><th style={s.th}>Staff</th>{days.map((d) => <th key={d} style={s.th}>{new Date(d).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric' })}</th>)}</tr></thead>
          <tbody>{people.map((p) => (
            <tr key={p.id}>
              <td style={{ ...s.td, whiteSpace: 'nowrap' }}><b>{p.full_name}</b><div style={s.sub}>{p.role}</div></td>
              {days.map((d) => {
                const x = shifts.find((y) => y.staff_id === p.id && y.shift_date === d)
                return (
                  <td key={d} style={{ ...s.td, background: x ? SHIFT_TONE[x.shift_code] : undefined, padding: 4 }} title={(x?.flags || []).join(' · ')}>
                    <select aria-label={`${p.full_name} ${d}`} style={{ ...s.input, padding: '3px 4px', fontSize: 12, background: 'transparent', border: (x?.flags || []).length ? `2px solid ${C.warn}` : `1px solid ${C.border}` }}
                      value={x?.shift_code || ''} onChange={(e) => setCell(p, d, e.target.value)}>
                      <option value="">—</option>{types.map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}
                    </select>
                    {(x?.flags || []).length > 0 && <div style={{ color: C.warn, fontSize: 10, fontWeight: 700 }}>⚠ {x.flags.length}</div>}
                  </td>
                )
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={{ ...s.sub, marginTop: 6 }}>{types.map((t) => `${t.code} = ${t.label}`).join(' · ')}. Double-booking and shifts during approved leave are refused; a ⚠ marks short rest or long weekly hours (hover for details).</div>
    </div>
  )
}

// ---------------------------------------------------------------- leave approval
export function LeaveStatusCell({ leave, canDecide, onChanged }) {
  const [err, setErr] = useState('')
  const st = leave.status || 'approved'
  const [label, tone] = LEAVE_STATUS[st] || LEAVE_STATUS.approved
  async function decide(status) {
    setErr('')
    let decision_note = null
    if (status === 'rejected' || status === 'cancelled') {
      decision_note = await openPromptDialog(status === 'rejected' ? 'Why is this leave being rejected?' : 'Why is this leave being cancelled?', { title: status === 'rejected' ? 'Reject leave' : 'Cancel leave', confirmLabel: status === 'rejected' ? 'Reject' : 'Cancel leave' })
      if (!decision_note?.trim()) return
    }
    const { error } = await supabase.from('staff_leave').update({ status, ...(decision_note ? { decision_note: decision_note.trim() } : {}) }).eq('id', leave.id)
    if (error) setErr(friendly(error)); else onChanged()
  }
  return (
    <div>
      <Chip tone={tone}>{label}</Chip>
      {st === 'requested' && canDecide && <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button type="button" style={{ ...s.btn, ...s.pri, padding: '3px 9px' }} onClick={() => decide('approved')}>Approve</button>
        <button type="button" style={{ ...s.btn, ...s.danger, padding: '3px 9px' }} onClick={() => decide('rejected')}>Reject</button>
      </div>}
      {(st === 'requested' || st === 'approved') && <button type="button" style={{ ...s.btn, ...s.ghost, padding: '2px 8px', marginTop: 4, fontSize: 11 }} onClick={() => decide('cancelled')}>Cancel</button>}
      {leave.decision_note && <div style={{ fontSize: 11, color: C.sub }}>{leave.decision_note}</div>}
      {err && <div role="alert" style={{ color: C.danger, fontSize: 11 }}>{err}</div>}
    </div>
  )
}

export function LeaveBalances({ hospitalId, staffId }) {
  const [b, setB] = useState(null)
  useEffect(() => {
    if (!staffId) { setB(null); return }
    void supabase.rpc('leave_balances', { p_hospital: hospitalId, p_staff: staffId }).then(({ data }) => setB(data || null))
  }, [hospitalId, staffId])
  if (!b) return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
      {Object.entries(b).map(([k, v]) => {
        const left = Number(v.entitled) - Number(v.used)
        return <Chip key={k} tone={left - Number(v.pending) < 0 ? 'red' : 'blue'}>{k}: {left} of {v.entitled} left{Number(v.pending) ? ` (${v.pending} pending)` : ''}</Chip>
      })}
    </div>
  )
}

// ---------------------------------------------------------------- licences and CPD
export function HrLicences({ hospitalId, staff = [] }) {
  const [c, setC] = useState(null)
  const [lic, setLic] = useState({ staff_id: '', body: 'NCK', number: '', issued_on: '', expires_on: '' })
  const [cpd, setCpd] = useState({ staff_id: '', activity: '', provider: '', done_on: iso(new Date()), points: '' })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('hr_compliance', { p_hospital: hospitalId, p_days: 60 })
    if (error) setErr(friendly(error)); else { setErr(''); setC(data) }
  }, [hospitalId])
  useEffect(() => { void load() }, [load])
  async function addLicence() {
    setErr(''); setMsg('')
    if (!lic.staff_id || !lic.number.trim() || !lic.expires_on) { setErr('Choose the staff member and give the number and expiry date.'); return }
    const { error } = await supabase.from('staff_licences').insert({ hospital_id: hospitalId, ...lic, issued_on: lic.issued_on || null, number: lic.number.trim() })
    if (error) setErr(friendly(error)); else { setMsg('Licence recorded.'); setLic({ ...lic, number: '', issued_on: '', expires_on: '' }); void load() }
  }
  async function addCpd() {
    setErr(''); setMsg('')
    if (!cpd.staff_id || !cpd.activity.trim() || !(Number(cpd.points) > 0)) { setErr('Choose the staff member, the activity and the points.'); return }
    const { error } = await supabase.from('staff_cpd').insert({ hospital_id: hospitalId, ...cpd, points: Number(cpd.points), provider: cpd.provider || null })
    if (error) setErr(friendly(error)); else { setMsg('CPD recorded.'); setCpd({ ...cpd, activity: '', provider: '', points: '' }); void load() }
  }
  const pick = (v, on, id) => <select id={id} style={s.input} value={v} onChange={(e) => on(e.target.value)}><option value="">Staff member…</option>{staff.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {p.role}</option>)}</select>
  const list = (rows, render, empty) => (rows?.length ? rows.map(render) : <div style={s.sub}>{empty}</div>)
  return (
    <div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {msg && <div style={s.ok}>{msg}</div>}
      {c && <div style={s.grid(300)}>
        <div style={{ ...s.card, borderColor: c.expired.length ? C.danger : C.border }}><div style={s.label}>Expired ({c.expired.length})</div>
          {list(c.expired, (x, i) => <div key={i} style={{ fontSize: 13, color: C.danger }}><b>{x.staff}</b> · {x.body} {x.number} · expired {x.expires_on}</div>, 'None.')}</div>
        <div style={s.card}><div style={s.label}>Expiring within 60 days ({c.expiring.length})</div>
          {list(c.expiring, (x, i) => <div key={i} style={{ fontSize: 13 }}><b>{x.staff}</b> · {x.body} · {x.expires_on} ({x.days} days)</div>, 'None.')}</div>
        <div style={s.card}><div style={s.label}>Clinical staff with no licence on file ({c.no_licence.length})</div>
          {list(c.no_licence, (x, i) => <div key={i} style={{ fontSize: 13 }}><b>{x.staff}</b> · {x.role}{x.registration_expiry ? ` · registration expiry ${x.registration_expiry}` : ''}</div>, 'None.')}</div>
        <div style={s.card}><div style={s.label}>CPD points this year</div>
          {list(c.cpd, (x, i) => <div key={i} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between' }}><span>{x.staff}</span><b style={{ color: x.required && Number(x.points) < Number(x.required) ? C.warn : undefined }}>{Number(x.points)}{x.required ? ` / ${x.required}` : ''}</b></div>, 'No clinical staff.')}</div>
      </div>}
      <div style={{ ...s.grid(360), marginTop: 12 }}>
        <div style={s.card}>
          <h3 style={s.h2}>Record a licence / registration</h3>
          <div style={s.grid(150)}>
            <div><label style={s.label} htmlFor="lic-staff">Staff</label>{pick(lic.staff_id, (v) => setLic({ ...lic, staff_id: v }), 'lic-staff')}</div>
            <div><label style={s.label} htmlFor="lic-body">Regulator</label><select id="lic-body" style={s.input} value={lic.body} onChange={(e) => setLic({ ...lic, body: e.target.value })}>
              {['KMPDC', 'NCK', 'COC', 'PPB', 'KMLTTB', 'KNDI', 'RPB', 'PCK', 'Other'].map((b) => <option key={b}>{b}</option>)}</select></div>
            <div><label style={s.label} htmlFor="lic-number">Number</label><input id="lic-number" style={s.input} value={lic.number} onChange={(e) => setLic({ ...lic, number: e.target.value })} /></div>
            <div><label style={s.label} htmlFor="lic-issued">Issued</label><input id="lic-issued" type="date" style={s.input} value={lic.issued_on} onChange={(e) => setLic({ ...lic, issued_on: e.target.value })} /></div>
            <div><label style={s.label} htmlFor="lic-expires">Expires</label><input id="lic-expires" type="date" style={s.input} value={lic.expires_on} onChange={(e) => setLic({ ...lic, expires_on: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={addLicence}>Save licence</button></div>
        </div>
        <div style={s.card}>
          <h3 style={s.h2}>Record CPD</h3>
          <div style={s.grid(150)}>
            <div><label style={s.label} htmlFor="cpd-staff">Staff</label>{pick(cpd.staff_id, (v) => setCpd({ ...cpd, staff_id: v }), 'cpd-staff')}</div>
            <div><label style={s.label} htmlFor="cpd-activity">Activity</label><input id="cpd-activity" style={s.input} value={cpd.activity} onChange={(e) => setCpd({ ...cpd, activity: e.target.value })} /></div>
            <div><label style={s.label} htmlFor="cpd-provider">Provider</label><input id="cpd-provider" style={s.input} value={cpd.provider} onChange={(e) => setCpd({ ...cpd, provider: e.target.value })} /></div>
            <div><label style={s.label} htmlFor="cpd-date">Date</label><input id="cpd-date" type="date" style={s.input} value={cpd.done_on} onChange={(e) => setCpd({ ...cpd, done_on: e.target.value })} /></div>
            <div><label style={s.label} htmlFor="cpd-points">Points</label><input id="cpd-points" type="number" min="0" style={s.input} value={cpd.points} onChange={(e) => setCpd({ ...cpd, points: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={addCpd}>Save CPD</button></div>
        </div>
      </div>
    </div>
  )
}
