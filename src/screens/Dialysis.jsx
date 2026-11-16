// Dialysis unit: day list, session chart (pre / intra / post, urea → URR and Kt/V computed by the database, access check,
// complications), renal registry with standing orders and hepatitis B status, machines (hepatitis B-dedicated machines
// enforced) and unit statistics. Data: 20261211000000_dialysis_mortuary.sql.
import { useCallback, useEffect, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import PatientSearch from '../components/PatientSearch'
import { localDateKey } from '../utils/scheduling'
import { C, Chip, s } from './ncd/ui'
import { ACCESS_LABEL, COMPLICATIONS, DAYS, adequacy } from '../utils/dialysis'
import WaterQuality, { WaterAlert } from './dialysis/WaterQuality'

const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Not installed yet. Run docs/sql/29_dialysis_mortuary.sql in Supabase.'
  if (/row-level|permission/i.test(m)) return 'Only clinical staff can use the dialysis unit screen.'
  if (/duplicate key|unique/i.test(m)) return 'Already registered.'
  return m
}
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
const STATUS_TONE = { scheduled: 'gray', in_progress: 'blue', completed: 'green', missed: 'red', cancelled: 'gray' }

export default function Dialysis() {
  const { hospitalId } = useHospital()
  const [tab, setTab] = useState('day')
  const [day, setDay] = useState(localDateKey())
  const [patients, setPatients] = useState([])
  const [machines, setMachines] = useState([])
  const [sessions, setSessions] = useState([])
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    if (!hospitalId) return
    const [p, m, ss] = await Promise.all([
      supabase.from('dialysis_patients').select('*, patients(full_name, patient_number)').eq('hospital_id', hospitalId).order('created_at'),
      supabase.from('dialysis_machines').select('*').eq('hospital_id', hospitalId).order('name'),
      supabase.from('dialysis_sessions').select('*').eq('hospital_id', hospitalId).eq('session_date', day).order('created_at'),
    ])
    if (p.error || m.error || ss.error) setErr(friendly(p.error || m.error || ss.error)); else setErr('')
    setPatients(p.data || []); setMachines(m.data || []); setSessions(ss.data || [])
  }, [hospitalId, day])
  useEffect(() => { void load() }, [load])

  const weekday = DAYS[(new Date(`${day}T12:00:00`).getDay() + 6) % 7]
  const due = patients.filter((p) => p.active && p.modality === 'HD' && (p.schedule_days || []).includes(weekday) && !sessions.some((x) => x.dialysis_patient_id === p.id))
  async function book(p) {
    setErr('')
    const { error } = await supabase.from('dialysis_sessions').insert({ hospital_id: hospitalId, dialysis_patient_id: p.id, patient_id: p.patient_id, session_date: day })
    if (error) setErr(friendly(error)); else void load()
  }
  const session = sessions.find((x) => x.id === open)
  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div><h1 style={s.h1}>Dialysis unit</h1><div style={s.sub}>URR and Kt/V calculated on every session; hepatitis B positive patients only on dedicated machines.</div></div>
        <input aria-label="Day" type="date" style={{ ...s.input, maxWidth: 170 }} value={day} onChange={(e) => setDay(e.target.value)} />
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div role="tablist" aria-label="Dialysis sections" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['day', 'Sessions'], ['patients', `Patients (${patients.filter((p) => p.active).length})`], ['machines', 'Machines'], ['water', 'Water quality'], ['stats', 'Statistics']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...s.btn, ...(tab === k ? s.pri : s.ghost) }}>{l}</button>
        ))}
      </div>
      {tab === 'day' && <WaterAlert hospitalId={hospitalId} />}
      {tab === 'day' && (
        <div style={s.grid(320)}>
          <div style={s.card}>
            <h2 style={s.h2}>Due {weekday} but not booked ({due.length})</h2>
            {due.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderTop: `1px solid ${C.border}` }}>
                <span>{p.patients?.full_name} {p.hbsag === 'positive' && <Chip tone="red">HBsAg+</Chip>}</span>
                <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => book(p)}>Book</button>
              </div>
            ))}
            {!due.length && <div style={s.sub}>Everyone scheduled today is booked.</div>}
          </div>
          <div style={s.card}>
            <h2 style={s.h2}>Sessions</h2>
            {sessions.map((x) => {
              const p = patients.find((y) => y.id === x.dialysis_patient_id)
              const m = machines.find((y) => y.id === x.machine_id)
              return (
                <button key={x.id} type="button" onClick={() => setOpen(x.id)} style={{ width: '100%', textAlign: 'left', border: `1px solid ${C.border}`, borderLeft: `5px solid ${(x.flags || []).length ? C.danger : C.border}`, borderRadius: 10, background: '#fff', padding: '8px 10px', marginBottom: 6, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><b>{p?.patients?.full_name}</b><Chip tone={STATUS_TONE[x.status]}>{x.status.replace('_', ' ')}</Chip></div>
                  <div style={s.sub}>{m?.name || 'No machine'}{x.urr ? ` · URR ${x.urr}%` : ''}{x.ktv ? ` · Kt/V ${x.ktv}` : ''}{x.uf_achieved_l ? ` · UF ${x.uf_achieved_l} L` : ''}</div>
                  {(x.flags || []).slice(0, 2).map((f) => <div key={f} style={{ color: C.danger, fontSize: 12 }}>⚠ {f}</div>)}
                </button>
              )
            })}
            {!sessions.length && <div style={s.sub}>No sessions on this day.</div>}
          </div>
        </div>
      )}
      {tab === 'patients' && <Registry hospitalId={hospitalId} patients={patients} onChanged={load} setErr={setErr} />}
      {tab === 'machines' && <Machines hospitalId={hospitalId} machines={machines} onChanged={load} setErr={setErr} />}
      {tab === 'water' && <WaterQuality hospitalId={hospitalId} />}
      {tab === 'stats' && <Stats hospitalId={hospitalId} />}
      {session && <SessionDrawer x={session} p={patients.find((y) => y.id === session.dialysis_patient_id)} machines={machines} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}

function SessionDrawer({ x, p, machines, onClose, onChanged }) {
  const [f, setF] = useState({ ...x, complications: x.complications || [], access_check: x.access_check || {} })
  const [err, setErr] = useState('')
  useEffect(() => { setF({ ...x, complications: x.complications || [], access_check: x.access_check || {} }) }, [x])
  const closed = ['completed', 'missed', 'cancelled'].includes(x.status)
  const so = p?.standing_orders || {}
  const ufNow = f.uf_achieved_l !== null && f.uf_achieved_l !== undefined && f.uf_achieved_l !== '' ? f.uf_achieved_l : (num(f.pre_weight_kg) && num(f.post_weight_kg) ? Math.round((f.pre_weight_kg - f.post_weight_kg) * 10) / 10 : null)
  const live = adequacy(f.pre_urea, f.post_urea, f.duration_min || so.duration_min || 240, ufNow, f.post_weight_kg)
  const field = (k, l, type = 'number') => <div><label style={s.label} htmlFor={`ds-${k}`}>{l}</label><input id={`ds-${k}`} type={type} step="any" disabled={closed} style={s.input} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  async function save(status) {
    setErr('')
    const patch = { machine_id: f.machine_id || null, complications: f.complications, access_check: f.access_check, heparin: f.heparin || null, medications: f.medications || null, notes: f.notes || null }
    for (const k of ['pre_weight_kg', 'post_weight_kg', 'pre_sbp', 'pre_dbp', 'post_sbp', 'post_dbp', 'lowest_sbp', 'pre_pulse', 'post_pulse', 'temp_c', 'duration_min', 'blood_flow', 'uf_goal_l', 'uf_achieved_l', 'pre_urea', 'post_urea']) patch[k] = num(f[k])
    if (status) patch.status = status
    if (status === 'missed') {
      const reason = window.prompt('Why was the session missed?')
      if (!reason) return
      patch.missed_reason = reason
    }
    const { error } = await supabase.from('dialysis_sessions').update(patch).eq('id', x.id)
    if (error) setErr(friendly(error)); else onChanged()
  }
  return (
    <div style={s.overlay} onClick={onClose}>
      <div role="dialog" aria-label="Dialysis session" style={{ ...s.drawer, width: 760 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <h2 style={{ ...s.h2, margin: 0 }}>{p?.patients?.full_name} — {x.session_date}</h2>
            <div style={s.sub}>{ACCESS_LABEL[p?.access_type] || 'Access not recorded'} · dry weight {p?.dry_weight_kg ?? '?'} kg · HBsAg {p?.hbsag}{so.duration_min ? ` · orders: ${so.duration_min} min, Qb ${so.qb || '?'}, ${so.dialyser || ''} K ${so.dialysate_k || '?'}` : ''}</div>
          </div>
          <button type="button" onClick={onClose} style={{ ...s.btn, ...s.ghost }}>Close</button>
        </div>
        <div style={{ margin: '8px 0' }}><Chip tone={STATUS_TONE[x.status]}>{x.status.replace('_', ' ')}</Chip>{x.idwg_kg !== null && x.idwg_kg !== undefined && <span style={s.sub}> · weight gain since last session {x.idwg_kg} kg</span>}</div>
        {err && <div role="alert" style={s.err}>{err}</div>}
        {(x.flags || []).map((fl) => <div key={fl} style={{ color: C.danger, fontSize: 12, fontWeight: 700 }}>⚠ {fl}</div>)}
        <div style={{ ...s.card, marginTop: 8 }}>
          <div style={s.grid(130)}>
            <div><label style={s.label} htmlFor="ds-machine">Machine</label><select id="ds-machine" disabled={closed} style={s.input} value={f.machine_id || ''} onChange={(e) => setF({ ...f, machine_id: e.target.value })}><option value="">Choose…</option>{machines.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}{m.hbv_dedicated ? ' (HBV)' : ''}</option>)}</select></div>
            {field('pre_weight_kg', 'Pre weight kg')}{field('pre_sbp', 'Pre BP sys')}{field('pre_dbp', 'Pre BP dia')}{field('pre_pulse', 'Pre pulse')}{field('temp_c', 'Temp °C')}
            {field('uf_goal_l', 'UF goal L')}{field('blood_flow', 'Blood flow mL/min')}{field('lowest_sbp', 'Lowest BP sys (intra)')}
            {field('post_weight_kg', 'Post weight kg')}{field('post_sbp', 'Post BP sys')}{field('post_dbp', 'Post BP dia')}{field('post_pulse', 'Post pulse')}{field('duration_min', 'Duration min')}{field('uf_achieved_l', 'UF achieved L')}
            {field('pre_urea', 'Pre urea mmol/L')}{field('post_urea', 'Post urea mmol/L')}
          </div>
          <div style={{ fontSize: 13, marginTop: 8 }}>
            {live.urr !== null ? <>URR <b style={{ color: live.urr < 65 ? C.danger : C.success }}>{live.urr}%</b> · Kt/V <b style={{ color: live.ktv < 1.2 ? C.danger : C.success }}>{live.ktv ?? '—'}</b> (targets: URR ≥ 65%, Kt/V ≥ 1.2)</> : <span style={s.sub}>Enter pre and post urea to calculate URR and Kt/V.</span>}
            {ufNow !== null && <span style={s.sub}> · UF {ufNow} L</span>}
          </div>
          <div style={{ ...s.grid(160), marginTop: 8 }}>
            <div><label style={s.label} htmlFor="ds-thrill">Thrill</label><select id="ds-thrill" disabled={closed} style={s.input} value={f.access_check.thrill || ''} onChange={(e) => setF({ ...f, access_check: { ...f.access_check, thrill: e.target.value } })}><option value="">—</option><option value="present">Present</option><option value="absent">Absent</option><option value="na">Not a fistula</option></select></div>
            <div><label style={s.label} htmlFor="ds-bruit">Bruit</label><select id="ds-bruit" disabled={closed} style={s.input} value={f.access_check.bruit || ''} onChange={(e) => setF({ ...f, access_check: { ...f.access_check, bruit: e.target.value } })}><option value="">—</option><option value="present">Present</option><option value="absent">Absent</option><option value="na">Not a fistula</option></select></div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" disabled={closed} checked={Boolean(f.access_check.infection_signs)} onChange={(e) => setF({ ...f, access_check: { ...f.access_check, infection_signs: e.target.checked } })} />Access site redness / pus / fever</label>
            {field('heparin', 'Heparin', 'text')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, fontSize: 12 }}>
            <b>Complications:</b>{COMPLICATIONS.map((c) => <label key={c}><input type="checkbox" disabled={closed} checked={f.complications.includes(c)} onChange={(e) => setF({ ...f, complications: e.target.checked ? [...f.complications, c] : f.complications.filter((y) => y !== c) })} /> {c}</label>)}
          </div>
          <div style={{ ...s.grid(240), marginTop: 8 }}>{field('medications', 'Medications given (EPO, iron, …)', 'text')}{field('notes', 'Notes', 'text')}</div>
        </div>
        {!closed && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" style={{ ...s.btn, ...s.danger }} onClick={() => save('missed')}>Missed</button>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => save()}>Save</button>
              {x.status === 'scheduled' && <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => save('in_progress')}>Start session</button>}
              {x.status === 'in_progress' && <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => save('completed')}>Complete session</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Registry({ hospitalId, patients, onChanged, setErr }) {
  const blank = { modality: 'HD', ckd_cause: '', dry_weight_kg: '', access_type: 'AVF', access_site: '', hbsag: 'unknown', anti_hcv: 'unknown', hiv: 'unknown', schedule_days: [], shift: 'Morning', nephrologist: '', dialyser: '', duration_min: '240', qb: '300', dialysate_k: '2' }
  const [patient, setPatient] = useState(null)
  const [f, setF] = useState(blank)
  async function add() {
    setErr('')
    if (!patient) { setErr('Pick the patient.'); return }
    const { error } = await supabase.from('dialysis_patients').insert({
      hospital_id: hospitalId, patient_id: patient.id, modality: f.modality, ckd_cause: f.ckd_cause || null, dry_weight_kg: num(f.dry_weight_kg), access_type: f.access_type, access_site: f.access_site || null,
      hbsag: f.hbsag, anti_hcv: f.anti_hcv, hiv: f.hiv, schedule_days: f.schedule_days, shift: f.shift, nephrologist: f.nephrologist || null,
      standing_orders: { dialyser: f.dialyser, duration_min: num(f.duration_min), qb: num(f.qb), dialysate_k: num(f.dialysate_k) },
    })
    if (error) setErr(friendly(error)); else { setPatient(null); setF(blank); onChanged() }
  }
  const sel = (k, l, opts) => <div><label style={s.label} htmlFor={`dr-${k}`}>{l}</label><select id={`dr-${k}`} style={s.input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
  const inp = (k, l) => <div><label style={s.label} htmlFor={`dr-${k}`}>{l}</label><input id={`dr-${k}`} style={s.input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  const vir = [['unknown', 'Unknown'], ['negative', 'Negative'], ['positive', 'Positive']]
  return (
    <div>
      <div style={s.card}>
        <h2 style={s.h2}>Register a patient</h2>
        <div style={s.grid(170)}>
          <div><label style={s.label} htmlFor="dr-patient">Patient</label><PatientSearch id="dr-patient" hospitalId={hospitalId} inputStyle={s.input} value={patient} onPick={setPatient} /></div>
          {sel('modality', 'Modality', [['HD', 'Haemodialysis'], ['PD', 'Peritoneal dialysis']])}{inp('ckd_cause', 'Cause of kidney failure')}{inp('dry_weight_kg', 'Dry weight kg')}
          {sel('access_type', 'Access', Object.entries(ACCESS_LABEL))}{inp('access_site', 'Access site')}
          {sel('hbsag', 'HBsAg', vir)}{sel('anti_hcv', 'Anti-HCV', vir)}{sel('hiv', 'HIV', vir)}{sel('shift', 'Shift', [['Morning', 'Morning'], ['Afternoon', 'Afternoon'], ['Night', 'Night']])}
          {inp('dialyser', 'Dialyser')}{inp('duration_min', 'Duration min')}{inp('qb', 'Blood flow')}{inp('dialysate_k', 'Dialysate K')}{inp('nephrologist', 'Nephrologist')}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8, fontSize: 12 }}><b>Days:</b>{DAYS.map((d) => <label key={d}><input type="checkbox" checked={f.schedule_days.includes(d)} onChange={(e) => setF({ ...f, schedule_days: e.target.checked ? [...f.schedule_days, d] : f.schedule_days.filter((y) => y !== d) })} /> {d}</label>)}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={add}>Register</button></div>
      </div>
      <div style={{ ...s.card, marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Patient', 'Modality', 'Access', 'Dry weight', 'HBsAg / HCV / HIV', 'Schedule'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{patients.map((p) => (
            <tr key={p.id}>
              <td style={s.td}><b>{p.patients?.full_name}</b></td><td style={s.td}>{p.modality}</td>
              <td style={{ ...s.td, color: /cvc/.test(p.access_type || '') ? C.warn : undefined }}>{ACCESS_LABEL[p.access_type] || '—'}</td>
              <td style={s.td}>{p.dry_weight_kg ?? '—'}</td>
              <td style={s.td}><Chip tone={p.hbsag === 'positive' ? 'red' : p.hbsag === 'unknown' ? 'yellow' : 'green'}>HBsAg {p.hbsag}</Chip> {p.anti_hcv} / {p.hiv}</td>
              <td style={s.td}>{(p.schedule_days || []).join(', ')} {p.shift || ''}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

function Machines({ hospitalId, machines, onChanged, setErr }) {
  const [name, setName] = useState('')
  const [hbv, setHbv] = useState(false)
  async function add() {
    setErr('')
    if (!name.trim()) return
    const { error } = await supabase.from('dialysis_machines').insert({ hospital_id: hospitalId, name: name.trim(), hbv_dedicated: hbv })
    if (error) setErr(friendly(error)); else { setName(''); setHbv(false); onChanged() }
  }
  async function disinfected(m) {
    const { error } = await supabase.from('dialysis_machines').update({ last_disinfected_at: new Date().toISOString() }).eq('id', m.id)
    if (error) setErr(friendly(error)); else onChanged()
  }
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 10 }}>
        <div><label style={s.label} htmlFor="dm-name">Machine</label><input id="dm-name" style={s.input} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <label style={{ display: 'flex', gap: 6, fontSize: 12 }}><input type="checkbox" checked={hbv} onChange={(e) => setHbv(e.target.checked)} />Hepatitis B-dedicated (isolation)</label>
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={add}>Add machine</button>
      </div>
      {machines.map((m) => (
        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: `1px solid ${C.border}` }}>
          <span><b>{m.name}</b> {m.hbv_dedicated && <Chip tone="red">HBV only</Chip>} <span style={s.sub}>Disinfected {m.last_disinfected_at ? new Date(m.last_disinfected_at).toLocaleString('en-KE') : 'never recorded'}</span></span>
          <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => disinfected(m)}>Disinfected now</button>
        </div>
      ))}
      {!machines.length && <div style={s.sub}>Add your machines. Mark the ones kept for hepatitis B positive patients.</div>}
    </div>
  )
}

function Stats({ hospitalId }) {
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { void supabase.rpc('dialysis_stats', { p_hospital: hospitalId, p_from: range.from, p_to: range.to }).then(({ data, error }) => { if (error) setErr(friendly(error)); else { setErr(''); setD(data) } }) }, [hospitalId, range])
  const tile = (l, v, warn) => <div style={{ border: `1px solid ${warn ? C.danger : C.border}`, borderRadius: 10, padding: 12, background: '#fff' }}><div style={s.sub}>{l}</div><div style={{ fontSize: 22, fontWeight: 800, color: warn ? C.danger : undefined }}>{v ?? '—'}</div></div>
  const catheter = d ? Object.entries(d.access || {}).filter(([k]) => /cvc/.test(k)).reduce((a, [, n]) => a + n, 0) : 0
  const total = d ? Object.values(d.access || {}).reduce((a, n) => a + n, 0) : 0
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input aria-label="From" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <input aria-label="To" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {d && <div style={s.grid(170)}>
        {tile('Sessions completed', d.sessions)}{tile('Missed', d.missed, d.missed > 0)}{tile('Patients dialysed', d.patients)}
        {tile('Median URR', d.urr_median === null ? null : `${d.urr_median}%`, d.urr_median !== null && d.urr_median < 65)}{tile('URR ≥ 65%', d.urr_65_pct === null ? null : `${d.urr_65_pct}%`, d.urr_65_pct !== null && d.urr_65_pct < 80)}
        {tile('Median Kt/V', d.ktv_median, d.ktv_median !== null && d.ktv_median < 1.2)}{tile('Hypotension episodes', d.hypotension)}
        {tile('On catheters', total ? `${catheter} of ${total}` : null, total && catheter / total > 0.3)}{tile('HBsAg not known', d.hbsag_unknown, d.hbsag_unknown > 0)}
      </div>}
    </div>
  )
}
