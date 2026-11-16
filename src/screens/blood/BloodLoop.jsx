// Transfusion closed loop screens, mounted as tabs of the Blood Bank page: Requests (doctor's request -> grouping ->
// crossmatch -> issue), Bedside (two-person check, observations, completion), Reactions (haemovigilance), Donors and
// Statistics. Data and rules: 20261207000000_blood_transfusion.sql (mirrored in utils/bloodLoop.js).
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import PatientSearch from '../../components/PatientSearch'
import { openPromptDialog } from '../../confirmDialog'
import { C, Chip, s } from '../ncd/ui'
import { BLOOD_GROUPS } from '../../utils/bloodBank'
import { COMPONENTS, GROUP_STATUS_LABEL, RED_CELLS, REACTION_TYPES, SEVERITIES, SYMPTOMS, donationProblem, groupStatus, issuableUnits, nextEligible, possibleReaction } from '../../utils/bloodLoop'

export const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Not installed yet. Run docs/sql/25_blood_transfusion.sql in Supabase.'
  if (/row-level|permission/i.test(m)) return 'Only blood bank / laboratory staff can do this.'
  if (/duplicate key|unique/i.test(m)) return 'That number has already been used.'
  return m
}
const hm = (v) => (v ? new Date(v).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const STATUS_TONE = { requested: 'yellow', sample_received: 'blue', ready: 'green', issued: 'blue', completed: 'gray', cancelled: 'gray' }
const STATUS_LABEL = { requested: 'Requested', sample_received: 'Sample received', ready: 'Ready (crossmatched)', issued: 'Issued', completed: 'Completed', cancelled: 'Cancelled' }
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined))

export function useBloodStaff(hospitalId) {
  const [staff, setStaff] = useState(false)
  useEffect(() => { if (hospitalId) void supabase.rpc('blood_is_staff', { p_hospital: hospitalId }).then(({ data }) => setStaff(Boolean(data))) }, [hospitalId])
  return staff
}

// ------------------------------------------------------------------ requests
export function Requests({ hospitalId, staff }) {
  const [rows, setRows] = useState([])
  const [tests, setTests] = useState([])
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    let q = supabase.from('blood_requests').select('*, patients(full_name, patient_number, blood_group)').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(200)
    if (!showAll) q = q.in('status', ['requested', 'sample_received', 'ready', 'issued'])
    const { data, error } = await q
    if (error) { setErr(friendly(error)); return }
    setErr(''); setRows(data || [])
    const ids = [...new Set((data || []).map((r) => r.patient_id))]
    if (ids.length) { const t = await supabase.from('blood_group_tests').select('*').in('patient_id', ids).order('tested_at'); setTests(t.data || []) } else setTests([])
  }, [hospitalId, showAll])
  useEffect(() => { void load() }, [load])
  const current = rows.find((r) => r.id === open)
  return (
    <div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Show completed and cancelled</label>
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => setCreating((v) => !v)}>{creating ? 'Close' : '+ Request blood'}</button>
      </div>
      {creating && <NewRequest hospitalId={hospitalId} onDone={() => { setCreating(false); void load() }} />}
      {!rows.length ? <div style={{ ...s.card, ...s.sub }}>No open transfusion requests.</div> : (
        <div style={s.card}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Requested', 'Patient', 'Group', 'Component', 'Urgency', 'Status', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => {
              const gs = groupStatus(tests.filter((t) => t.patient_id === r.patient_id))
              const [gl, gt] = GROUP_STATUS_LABEL[gs.status]
              return (
                <tr key={r.id}>
                  <td style={s.td}>{hm(r.created_at)}</td>
                  <td style={s.td}><b>{r.patients?.full_name}</b><div style={s.sub}>{r.patients?.patient_number} · {r.location || ''}</div></td>
                  <td style={s.td}>{gs.group || '—'} <Chip tone={gt}>{gs.status === 'single' ? 'Once' : gl}</Chip></td>
                  <td style={s.td}>{r.units} × {r.component}</td>
                  <td style={s.td}><Chip tone={r.urgency === 'emergency' ? 'red' : r.urgency === 'urgent' ? 'yellow' : 'gray'}>{r.urgency}{r.emergency_release ? ' · uncrossmatched O' : ''}</Chip></td>
                  <td style={s.td}><Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip></td>
                  <td style={s.td}><button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setOpen(r.id)}>Open</button></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
      {current && <RequestDrawer request={current} staff={staff} tests={tests.filter((t) => t.patient_id === current.patient_id)} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}

function NewRequest({ hospitalId, onDone }) {
  const [patient, setPatient] = useState(null)
  const [f, setF] = useState({ component: 'Packed Red Cells', units: 1, urgency: 'routine', emergency_release: false, indication: '', hb: '', platelet_count: '', inr: '', consent: 'obtained', required_by: '', location: '', requested_by_name: '' })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  async function save(e) {
    e.preventDefault(); setErr('')
    if (!patient) { setErr('Pick the patient.'); return }
    if (!f.indication.trim()) { setErr('Give the clinical indication.'); return }
    if (f.consent === 'refused') { setErr('The patient has refused transfusion: do not request blood; document alternatives.'); return }
    const row = clean({ ...f, hospital_id: hospitalId, patient_id: patient.id, units: Number(f.units), required_by: f.required_by ? new Date(f.required_by).toISOString() : '' })
    row.emergency_release = f.urgency === 'emergency' && RED_CELLS.includes(f.component) && f.emergency_release
    const { error } = await supabase.from('blood_requests').insert(row)
    if (error) setErr(friendly(error)); else onDone()
  }
  const inp = (k, l, type = 'text') => <div><label style={s.label} htmlFor={`rq-${k}`}>{l}</label><input id={`rq-${k}`} type={type} style={s.input} value={f[k]} onChange={set(k)} /></div>
  return (
    <form onSubmit={save} style={{ ...s.card, marginBottom: 12 }}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={s.grid(190)}>
        <div><label style={s.label} htmlFor="rq-patient">Patient</label><PatientSearch id="rq-patient" hospitalId={hospitalId} inputStyle={s.input} value={patient} onPick={setPatient} /></div>
        <div><label style={s.label} htmlFor="rq-component">Component</label><select id="rq-component" style={s.input} value={f.component} onChange={set('component')}>{COMPONENTS.map((c) => <option key={c}>{c}</option>)}</select></div>
        {inp('units', 'Units', 'number')}
        <div><label style={s.label} htmlFor="rq-urgency">Urgency</label><select id="rq-urgency" style={s.input} value={f.urgency} onChange={set('urgency')}><option value="routine">Routine (planned)</option><option value="urgent">Urgent (within hours)</option><option value="emergency">Emergency (now)</option></select></div>
        {inp('indication', 'Indication *')}
        {inp('hb', 'Hb g/dL', 'number')}
        {inp('platelet_count', 'Platelets ×10⁹/L', 'number')}
        {inp('inr', 'INR', 'number')}
        <div><label style={s.label} htmlFor="rq-consent">Consent</label><select id="rq-consent" style={s.input} value={f.consent} onChange={set('consent')}><option value="obtained">Obtained (risks, benefits, alternatives explained)</option><option value="emergency_no_consent">Emergency — unable to consent</option><option value="refused">Refused</option></select></div>
        {inp('required_by', 'Needed by', 'datetime-local')}
        {inp('location', 'Ward / theatre')}
        {inp('requested_by_name', 'Requesting clinician')}
      </div>
      {f.urgency === 'emergency' && RED_CELLS.includes(f.component) && (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 8, color: C.danger, fontWeight: 700 }}>
          <input type="checkbox" checked={f.emergency_release} onChange={set('emergency_release')} />Release uncrossmatched group O now (life-threatening bleeding — I accept responsibility; crossmatch follows)
        </label>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button type="submit" style={{ ...s.btn, ...s.pri }}>Send request</button></div>
    </form>
  )
}

function RequestDrawer({ request: r, staff, tests, onClose, onChanged }) {
  const [units, setUnits] = useState([])
  const [xms, setXms] = useState([])
  const [issued, setIssued] = useState([])
  const [g, setG] = useState({ sample_ref: '', abo: '', rh: '', antibody_screen: 'not_done', method: 'Tile / tube', tested_by_name: '' })
  const [xm, setXm] = useState({ unit: '', method: 'Gel card', result: 'Compatible' })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const gs = groupStatus(tests)
  const load = useCallback(async () => {
    const [u, x, i] = await Promise.all([
      supabase.from('blood_bank_units').select('*').eq('hospital_id', r.hospital_id).in('status', ['Available', 'Reserved']).order('expiry_at'),
      supabase.from('blood_crossmatches').select('*').eq('patient_id', r.patient_id).order('performed_at', { ascending: false }),
      supabase.from('blood_bank_units').select('*, blood_transfusions(id, status, reaction)').eq('request_id', r.id),
    ])
    setUnits(u.data || []); setXms(x.data || []); setIssued(i.data || [])
  }, [r.hospital_id, r.patient_id, r.id])
  useEffect(() => { void load() }, [load])
  const act = async (p, ok) => {
    setErr(''); setMsg('')
    const { error } = await p
    if (error) { setErr(friendly(error)); return false }
    setMsg(ok); void load(); onChanged(); return true
  }
  const closed = ['completed', 'cancelled'].includes(r.status)
  const issuable = issuableUnits(r, units, xms, gs)
  // red-cell units that could be crossmatched: available, clear, unexpired, ABO/Rh compatible with the lab group
  const toCrossmatch = RED_CELLS.includes(r.component) && gs.group && gs.status !== 'discrepant'
    ? units.filter((u) => RED_CELLS.includes(u.component) && u.status === 'Available' && u.screening_status === 'clear' && new Date(u.expiry_at) > new Date()
      && !xms.some((x) => x.blood_unit_id === u.id && x.result === 'Compatible' && new Date(x.expires_at) > new Date())) : []
  async function addGroup() {
    if (!g.sample_ref.trim() || !g.abo || !g.rh) { setErr('Give the sample number, ABO and Rh.'); return }
    if (await act(supabase.from('blood_group_tests').insert({ ...clean(g), hospital_id: r.hospital_id, patient_id: r.patient_id }), 'Grouping recorded.')) setG({ ...g, sample_ref: '', abo: '', rh: '' })
  }
  async function voidTest(t) {
    const reason = await openPromptDialog('Why is this grouping wrong? (e.g. wrong blood in tube, mislabelled sample)', { title: 'Void grouping', confirmLabel: 'Void', tone: 'danger' })
    if (reason?.trim()) await act(supabase.from('blood_group_tests').update({ void_reason: reason.trim() }).eq('id', t.id), 'Grouping voided.')
  }
  async function cancel() {
    const reason = await openPromptDialog('Why is this request being cancelled?', { title: 'Cancel request', confirmLabel: 'Cancel request', tone: 'danger' })
    if (reason?.trim()) await act(supabase.from('blood_requests').update({ status: 'cancelled', cancel_reason: reason.trim() }).eq('id', r.id), 'Request cancelled.')
  }
  return (
    <div style={s.overlay} onClick={onClose}>
      <div role="dialog" aria-label="Transfusion request" style={{ ...s.drawer, width: 760 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <h2 style={{ ...s.h2, margin: 0 }}>{r.patients?.full_name} — {r.units} × {r.component}</h2>
            <div style={s.sub}>{r.urgency}{r.emergency_release ? ' · uncrossmatched group O authorised' : ''} · {r.indication}{r.hb ? ` · Hb ${r.hb}` : ''} · consent {String(r.consent).replace(/_/g, ' ')}</div>
          </div>
          <button type="button" onClick={onClose} style={{ ...s.btn, ...s.ghost }}>Close</button>
        </div>
        <div style={{ margin: '10px 0' }}><Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip></div>
        {err && <div role="alert" style={s.err}>{err}</div>}
        {msg && <div style={s.ok}>{msg}</div>}

        <Step n="1" title="Sample">
          {r.sample_received_at ? <span style={s.sub}>Received {hm(r.sample_received_at)}</span>
            : staff && !closed ? <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => act(supabase.from('blood_requests').update({ status: 'sample_received' }).eq('id', r.id), 'Sample received.')}>Mark sample received</button>
              : <span style={s.sub}>Waiting for the sample.</span>}
        </Step>

        <Step n="2" title={`Patient blood group — ${GROUP_STATUS_LABEL[gs.status][0]}`} tone={GROUP_STATUS_LABEL[gs.status][1]}>
          {tests.map((t) => (
            <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', opacity: t.void_reason ? 0.5 : 1 }}>
              <span style={{ textDecoration: t.void_reason ? 'line-through' : 'none' }}>Sample {t.sample_ref}: <b>{t.result_group}</b> · antibody screen {t.antibody_screen.replace('_', ' ')} · {hm(t.tested_at)}{t.void_reason ? ` — voided: ${t.void_reason}` : ''}</span>
              {staff && !t.void_reason && <button type="button" style={{ ...s.btn, ...s.ghost, padding: '1px 8px', fontSize: 11 }} onClick={() => voidTest(t)}>Void</button>}
            </div>
          ))}
          {staff && !closed && gs.status !== 'confirmed' && (
            <div style={{ ...s.grid(120), marginTop: 6 }}>
              <div><label style={s.label} htmlFor="g-sample">Sample no.</label><input id="g-sample" style={s.input} value={g.sample_ref} onChange={(e) => setG({ ...g, sample_ref: e.target.value })} /></div>
              <div><label style={s.label} htmlFor="g-abo">ABO</label><select id="g-abo" style={s.input} value={g.abo} onChange={(e) => setG({ ...g, abo: e.target.value })}><option value="">—</option>{['O', 'A', 'B', 'AB'].map((x) => <option key={x}>{x}</option>)}</select></div>
              <div><label style={s.label} htmlFor="g-rh">Rh D</label><select id="g-rh" style={s.input} value={g.rh} onChange={(e) => setG({ ...g, rh: e.target.value })}><option value="">—</option><option value="pos">Positive</option><option value="neg">Negative</option></select></div>
              <div><label style={s.label} htmlFor="g-ab">Antibody screen</label><select id="g-ab" style={s.input} value={g.antibody_screen} onChange={(e) => setG({ ...g, antibody_screen: e.target.value })}><option value="not_done">Not done</option><option value="negative">Negative</option><option value="positive">Positive</option></select></div>
              <div style={{ alignSelf: 'end' }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={addGroup}>Record grouping</button></div>
            </div>
          )}
          {gs.status === 'single' && <div style={{ fontSize: 12, color: C.warn, marginTop: 4 }}>A second, separately collected sample confirms the group and guards against wrong blood in tube.</div>}
        </Step>

        {RED_CELLS.includes(r.component) && (
          <Step n="3" title="Crossmatch">
            {xms.filter((x) => x.request_id === r.id || new Date(x.expires_at) > new Date()).map((x) => {
              const u = units.find((y) => y.id === x.blood_unit_id) || issued.find((y) => y.id === x.blood_unit_id)
              return <div key={x.id} style={{ fontSize: 12 }}>{u?.unit_reference || 'Unit'} ({u?.blood_group}) — <b style={{ color: x.result === 'Compatible' ? C.success : C.danger }}>{x.result}</b> by {x.method}, valid until {hm(x.expires_at)}</div>
            })}
            {staff && !closed && (toCrossmatch.length ? (
              <div style={{ ...s.grid(150), marginTop: 6 }}>
                <div><label style={s.label} htmlFor="xm-unit">Unit</label><select id="xm-unit" style={s.input} value={xm.unit} onChange={(e) => setXm({ ...xm, unit: e.target.value })}><option value="">Choose…</option>{toCrossmatch.map((u) => <option key={u.id} value={u.id}>{u.unit_reference} · {u.blood_group} · exp {new Date(u.expiry_at).toLocaleDateString('en-KE')}</option>)}</select></div>
                <div><label style={s.label} htmlFor="xm-method">Method</label><select id="xm-method" style={s.input} value={xm.method} onChange={(e) => setXm({ ...xm, method: e.target.value })}>{['Gel card', 'Tube', 'Solid phase'].map((m) => <option key={m}>{m}</option>)}</select></div>
                <div><label style={s.label} htmlFor="xm-result">Result</label><select id="xm-result" style={s.input} value={xm.result} onChange={(e) => setXm({ ...xm, result: e.target.value })}><option>Compatible</option><option>Incompatible</option></select></div>
                <div style={{ alignSelf: 'end' }}><button type="button" style={{ ...s.btn, ...s.pri }} disabled={!xm.unit} onClick={async () => { if (await act(supabase.from('blood_crossmatches').insert({ hospital_id: r.hospital_id, blood_unit_id: xm.unit, patient_id: r.patient_id, request_id: r.id, method: xm.method, result: xm.result }), xm.result === 'Compatible' ? 'Compatible — unit reserved for this patient.' : 'Incompatible recorded.')) setXm({ ...xm, unit: '' }) }}>Record crossmatch</button></div>
              </div>
            ) : <div style={s.sub}>{gs.group ? 'No compatible units in stock to crossmatch.' : 'Group the patient first.'}</div>)}
          </Step>
        )}

        <Step n={RED_CELLS.includes(r.component) ? '4' : '3'} title={`Issue (${issued.filter((u) => u.status === 'Issued').length} of ${r.units})`}>
          {issued.map((u) => (
            <div key={u.id} style={{ fontSize: 12 }}>
              {u.unit_reference} {u.blood_group} {u.component} — {u.status === 'Issued' ? `issued ${hm(u.issued_at)}${u.emergency_release ? ' (uncrossmatched)' : ''}` : u.status}
              {u.blood_transfusions?.[0] ? ` · transfusion ${u.blood_transfusions[0].status}${u.blood_transfusions[0].reaction ? ' · REACTION' : ''}` : ''}
            </div>
          ))}
          {staff && !closed && issued.filter((u) => u.status === 'Issued').length < r.units && (issuable.length ? issuable.map(({ unit: u, crossmatch, emergency }) => (
            <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 13 }}><b>{u.unit_reference}</b> {u.blood_group} {u.component} · exp {new Date(u.expiry_at).toLocaleDateString('en-KE')}{crossmatch ? ' · crossmatched' : emergency ? ' · EMERGENCY uncrossmatched' : ''}</span>
              <button type="button" style={{ ...s.btn, ...(emergency ? s.danger : s.pri) }} onClick={() => act(supabase.from('blood_bank_units').update(clean({ status: 'Issued', issued_to_patient_id: r.patient_id, request_id: r.id, issued_crossmatch_id: crossmatch?.id })).eq('id', u.id), `${u.unit_reference} issued. It must be started within 30 minutes or returned.`)}>Issue</button>
            </div>
          )) : <div style={s.sub}>{RED_CELLS.includes(r.component) && !r.emergency_release ? 'Nothing to issue yet: units must be crossmatched compatible first.' : 'No suitable units in stock.'}</div>)}
        </Step>

        {!closed && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="button" style={{ ...s.btn, ...s.danger }} onClick={cancel}>Cancel request</button></div>}
      </div>
    </div>
  )
}

function Step({ n, title, tone, children }) {
  return (
    <div style={{ ...s.card, marginBottom: 8, padding: 12, borderLeft: `4px solid ${tone === 'red' ? C.danger : tone === 'yellow' ? C.warn : tone === 'green' ? C.success : C.border}` }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>{n}. {title}</div>
      {children}
    </div>
  )
}

// ------------------------------------------------------------------ bedside
export function Bedside({ hospitalId }) {
  const [units, setUnits] = useState([])
  const [txs, setTxs] = useState([])
  const [start, setStart] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    const [u, t] = await Promise.all([
      supabase.from('blood_bank_units').select('*, patients:issued_to_patient_id(full_name, patient_number)').eq('hospital_id', hospitalId).eq('status', 'Issued').gte('issued_at', new Date(Date.now() - 24 * 3600000).toISOString()).order('issued_at', { ascending: false }),
      supabase.from('blood_transfusions').select('*, patients(full_name), blood_bank_units(unit_reference, blood_group, component)').eq('hospital_id', hospitalId).gte('started_at', new Date(Date.now() - 48 * 3600000).toISOString()).order('started_at', { ascending: false }),
    ])
    if (u.error || t.error) setErr(friendly(u.error || t.error)); else setErr('')
    setUnits(u.data || []); setTxs(t.data || [])
  }, [hospitalId])
  useEffect(() => { void load() }, [load])
  const waiting = units.filter((u) => !txs.some((t) => t.unit_id === u.id))
  const done = (m) => { setMsg(m); setStart(null); void load() }
  return (
    <div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {msg && <div style={s.ok}>{msg}</div>}
      <div style={s.card}>
        <h2 style={s.h2}>Issued — waiting to start</h2>
        {!waiting.length && <div style={s.sub}>No issued units waiting.</div>}
        {waiting.map((u) => {
          const mins = Math.round((Date.now() - new Date(u.issued_at)) / 60000)
          return (
            <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: `1px solid ${C.border}` }}>
              <span><b>{u.patients?.full_name}</b> · {u.component} {u.blood_group} · issued {mins} min ago{mins > 30 ? <b style={{ color: C.danger }}> — over 30 min: return to the blood bank unless already started</b> : ''}</span>
              <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => { setMsg(''); setStart(u) }}>Bedside check</button>
            </div>
          )
        })}
      </div>
      {start && <BedsideCheck unit={start} onDone={() => done('Bedside check passed — transfusion started. Record observations at 15 minutes.')} onCancel={() => setStart(null)} />}
      <div style={{ ...s.card, marginTop: 12 }}>
        <h2 style={s.h2}>Transfusions (last 48 hours)</h2>
        {!txs.length && <div style={s.sub}>None.</div>}
        {txs.map((t) => <TransfusionRow key={t.id} t={t} onChanged={load} setErr={setErr} />)}
      </div>
    </div>
  )
}

function BedsideCheck({ unit, onDone, onCancel }) {
  const [f, setF] = useState({ scanned_unit_ref: '', scanned_patient_number: '', id_band_checked: false, checker1_name: '', checker2_name: '', temp: '', hr: '', sbp: '', rr: '', spo2: '' })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const bagOk = f.scanned_unit_ref && f.scanned_unit_ref.trim().toUpperCase() === unit.unit_reference.trim().toUpperCase()
  const ptOk = f.scanned_patient_number && [unit.patients?.patient_number, unit.issued_to_patient_id].filter(Boolean).map((x) => String(x).toUpperCase()).includes(f.scanned_patient_number.trim().toUpperCase())
  async function startIt() {
    setErr('')
    if (!bagOk) { setErr('The bag number does not match the issued unit. Do not transfuse.'); return }
    if (!ptOk) { setErr('The patient number on the identity band does not match. Do not transfuse.'); return }
    if (!f.id_band_checked) { setErr('Confirm the identity band check.'); return }
    if (!f.checker1_name.trim() || !f.checker2_name.trim() || f.checker1_name.trim().toLowerCase() === f.checker2_name.trim().toLowerCase()) { setErr('Two different staff must do the check.'); return }
    if (!f.temp || !f.hr || !f.sbp) { setErr('Record baseline temperature, pulse and blood pressure.'); return }
    const { error } = await supabase.from('blood_transfusions').insert({
      hospital_id: unit.hospital_id, unit_id: unit.id, patient_id: unit.issued_to_patient_id, scanned_unit_ref: f.scanned_unit_ref.trim(), scanned_patient_number: f.scanned_patient_number.trim(),
      id_band_checked: f.id_band_checked, checker1_name: f.checker1_name.trim(), checker2_name: f.checker2_name.trim(), baseline: clean({ temp: f.temp, hr: f.hr, sbp: f.sbp, rr: f.rr, spo2: f.spo2 }),
    })
    if (error) setErr(friendly(error)); else onDone()
  }
  const inp = (k, l, type = 'text') => <div><label style={s.label} htmlFor={`bs-${k}`}>{l}</label><input id={`bs-${k}`} type={type} style={s.input} value={f[k]} onChange={set(k)} /></div>
  return (
    <div style={{ ...s.card, marginTop: 12, borderColor: C.primary }}>
      <h2 style={s.h2}>Bedside check — {unit.patients?.full_name}</h2>
      <div style={{ ...s.sub, marginBottom: 8 }}>At the bedside, with the patient: ask their name and date of birth, read the identity band, and compare with the bag label and the issue slip. Type the numbers as you read them.</div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={s.grid(200)}>
        <div><label style={s.label} htmlFor="bs-scanned_unit_ref">Bag number (scan or type) {f.scanned_unit_ref && (bagOk ? '✓' : '✗')}</label><input id="bs-scanned_unit_ref" style={{ ...s.input, borderColor: f.scanned_unit_ref ? (bagOk ? C.success : C.danger) : undefined }} value={f.scanned_unit_ref} onChange={set('scanned_unit_ref')} autoComplete="off" /></div>
        <div><label style={s.label} htmlFor="bs-scanned_patient_number">Patient number on identity band {f.scanned_patient_number && (ptOk ? '✓' : '✗')}</label><input id="bs-scanned_patient_number" style={{ ...s.input, borderColor: f.scanned_patient_number ? (ptOk ? C.success : C.danger) : undefined }} value={f.scanned_patient_number} onChange={set('scanned_patient_number')} autoComplete="off" /></div>
        {inp('checker1_name', 'Nurse 1')}
        {inp('checker2_name', 'Nurse / doctor 2 (independent check)')}
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, margin: '8px 0' }}><input type="checkbox" checked={f.id_band_checked} onChange={set('id_band_checked')} />Name, number and date of birth match on band, bag label and slip; group and expiry checked; bag intact</label>
      <div style={s.label}>Baseline observations</div>
      <div style={s.grid(110)}>{[['temp', 'Temp °C'], ['hr', 'Pulse'], ['sbp', 'Systolic BP'], ['rr', 'Resp. rate'], ['spo2', 'SpO₂ %']].map(([k, l]) => <div key={k}>{inp(k, l, 'number')}</div>)}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={onCancel}>Back</button>
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={startIt}>Start transfusion</button>
      </div>
    </div>
  )
}

function TransfusionRow({ t, onChanged, setErr }) {
  const [o, setO] = useState({ temp: '', hr: '', sbp: '' })
  const [vol, setVol] = useState('')
  const [reacting, setReacting] = useState(false)
  const live = t.status === 'in_progress'
  const mins = Math.round((Date.now() - new Date(t.started_at)) / 60000)
  const warn = possibleReaction(t.baseline, o)
  async function upd(patch) { const { error } = await supabase.from('blood_transfusions').update(patch).eq('id', t.id); if (error) setErr(friendly(error)); else { setErr(''); setO({ temp: '', hr: '', sbp: '' }); onChanged() } }
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, padding: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span><b>{t.patients?.full_name}</b> · {t.blood_bank_units?.unit_reference} {t.blood_bank_units?.component} · started {hm(t.started_at)} by {t.checker1_name} / {t.checker2_name}</span>
        <Chip tone={t.reaction ? 'red' : live ? 'blue' : 'gray'}>{t.reaction ? 'Reaction' : live ? `Running ${mins} min` : t.status}</Chip>
      </div>
      <div style={s.sub}>Baseline T {t.baseline?.temp} · P {t.baseline?.hr} · BP {t.baseline?.sbp}{t.obs_15 ? ` — 15 min: T ${t.obs_15.temp} · P ${t.obs_15.hr} · BP ${t.obs_15.sbp}` : ''}{t.volume_ml ? ` · ${t.volume_ml} mL` : ''}{t.stop_reason ? ` · stopped: ${t.stop_reason}` : ''}</div>
      {(t.flags || []).map((x) => <div key={x} style={{ color: C.danger, fontSize: 12, fontWeight: 700 }}>⚠ {x}</div>)}
      {live && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'end', marginTop: 6 }}>
          {['temp', 'hr', 'sbp'].map((k) => <input key={k} aria-label={`${t.obs_15 ? 'Obs' : '15-minute'} ${k}`} placeholder={{ temp: 'Temp', hr: 'Pulse', sbp: 'Sys BP' }[k]} type="number" style={{ ...s.input, width: 90 }} value={o[k]} onChange={(e) => setO({ ...o, [k]: e.target.value })} />)}
          <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => upd(t.obs_15 ? { obs: [...(t.obs || []), { ...o, at: new Date().toISOString() }] } : { obs_15: o })}>{t.obs_15 ? 'Add observations' : 'Save 15-minute obs'}</button>
          {t.obs_15 && <><input aria-label="Volume transfused" placeholder="Volume mL" type="number" style={{ ...s.input, width: 110 }} value={vol} onChange={(e) => setVol(e.target.value)} />
            <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => upd({ status: 'completed', volume_ml: vol || null })}>Completed</button></>}
          <button type="button" style={{ ...s.btn, ...s.danger }} onClick={() => setReacting(true)}>Stop — reaction</button>
        </div>
      )}
      {live && warn && <div style={{ color: C.danger, fontSize: 12, fontWeight: 700 }}>These observations suggest a reaction: stop the transfusion, keep the line open with saline, call the doctor.</div>}
      {(reacting || (t.reaction && live)) && <ReactionForm t={t} onDone={async () => { setReacting(false); if (live) await upd({ status: 'stopped', stop_reason: 'Transfusion reaction' }); else onChanged() }} setErr={setErr} />}
    </div>
  )
}

function ReactionForm({ t, onDone, setErr }) {
  const [f, setF] = useState({ reaction_type: 'febrile_non_haemolytic', severity: 'non_severe', symptoms: [], actions: '' })
  async function save() {
    if (!f.actions.trim()) { setErr('Record what was done (stopped, treatment given, doctor informed).'); return }
    const { error } = await supabase.from('blood_reactions').insert({ hospital_id: t.hospital_id, transfusion_id: t.id, ...f })
    if (error) setErr(friendly(error)); else { setErr(''); await onDone() }
  }
  return (
    <div style={{ background: C.dangerL, borderRadius: 10, padding: 12, marginTop: 8 }}>
      <b style={{ color: C.danger }}>Transfusion reaction — stop the transfusion, keep the IV line open with normal saline, call the doctor. Return the bag and giving set to the blood bank.</b>
      <div style={{ ...s.grid(200), marginTop: 8 }}>
        <div><label style={s.label} htmlFor={`rx-type-${t.id}`}>Type</label><select id={`rx-type-${t.id}`} style={s.input} value={f.reaction_type} onChange={(e) => setF({ ...f, reaction_type: e.target.value })}>{REACTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label style={s.label} htmlFor={`rx-sev-${t.id}`}>Severity</label><select id={`rx-sev-${t.id}`} style={s.input} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{SEVERITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '8px 0' }}>{SYMPTOMS.map((x) => (
        <label key={x} style={{ display: 'flex', gap: 4, fontSize: 12 }}><input type="checkbox" checked={f.symptoms.includes(x)} onChange={(e) => setF({ ...f, symptoms: e.target.checked ? [...f.symptoms, x] : f.symptoms.filter((y) => y !== x) })} />{x}</label>
      ))}</div>
      <label style={s.label} htmlFor={`rx-act-${t.id}`}>Actions taken *</label>
      <input id={`rx-act-${t.id}`} style={s.input} value={f.actions} onChange={(e) => setF({ ...f, actions: e.target.value })} placeholder="Stopped transfusion; saline; hydrocortisone / chlorphenamine; doctor reviewed" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button type="button" style={{ ...s.btn, ...s.danger }} onClick={save}>Report reaction</button></div>
    </div>
  )
}

// ------------------------------------------------------------------ reactions (haemovigilance)
export function Reactions({ hospitalId }) {
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('blood_reactions').select('*, patients:patient_id(full_name), blood_bank_units:unit_id(unit_reference, component, blood_group)').eq('hospital_id', hospitalId).order('onset_at', { ascending: false }).limit(200)
    if (error) setErr(friendly(error)); else { setErr(''); setRows(data || []) }
  }, [hospitalId])
  useEffect(() => { void load() }, [load])
  const upd = async (id, patch) => { const { error } = await supabase.from('blood_reactions').update(patch).eq('id', id); if (error) setErr(friendly(error)); else void load() }
  return (
    <div style={s.card}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ ...s.sub, marginBottom: 8 }}>Every reaction is investigated by the blood bank and reported to the national haemovigilance programme (Kenya Blood Transfusion Service).</div>
      {!rows.length && <div style={s.sub}>No reactions reported.</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ borderTop: `1px solid ${C.border}`, padding: '8px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span><b>{r.patients?.full_name}</b> · {REACTION_TYPES.find(([v]) => v === r.reaction_type)?.[1]} · {r.blood_bank_units?.unit_reference} {r.blood_bank_units?.component} · {hm(r.onset_at)}</span>
            <Chip tone={r.severity === 'non_severe' ? 'yellow' : 'red'}>{SEVERITIES.find(([v]) => v === r.severity)?.[1]}</Chip>
          </div>
          <div style={s.sub}>{(r.symptoms || []).join(', ')} — {r.actions}</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 4, fontSize: 12 }}>
            <label style={{ display: 'flex', gap: 4 }}><input type="checkbox" checked={r.unit_returned} onChange={(e) => upd(r.id, { unit_returned: e.target.checked })} />Bag returned</label>
            <label style={{ display: 'flex', gap: 4 }}><input type="checkbox" checked={r.samples_sent} onChange={(e) => upd(r.id, { samples_sent: e.target.checked })} />Post-transfusion samples sent</label>
            <select aria-label="Imputability" style={{ ...s.input, width: 170 }} value={r.imputability || ''} onChange={(e) => upd(r.id, { imputability: e.target.value || null })}>
              <option value="">Imputability…</option>{['excluded', 'unlikely', 'possible', 'probable', 'certain'].map((x) => <option key={x}>{x}</option>)}
            </select>
            {r.reported_externally_at ? <Chip tone="green">Reported {hm(r.reported_externally_at)}</Chip>
              : <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => upd(r.id, { reported_externally_at: new Date().toISOString() })}>Mark reported to KNBTS</button>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ donors
export function Donors({ hospitalId }) {
  const [donors, setDonors] = useState([])
  const [donations, setDonations] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    const [d, n] = await Promise.all([
      supabase.from('blood_donors').select('*').eq('hospital_id', hospitalId).order('full_name').limit(500),
      supabase.from('blood_donations').select('*, blood_donors(full_name)').eq('hospital_id', hospitalId).order('donated_at', { ascending: false }).limit(100),
    ])
    if (d.error || n.error) setErr(friendly(d.error || n.error)); else setErr('')
    setDonors(d.data || []); setDonations(n.data || [])
  }, [hospitalId])
  useEffect(() => { void load() }, [load])
  const shown = useMemo(() => donors.filter((d) => !q || `${d.full_name} ${d.national_id || ''} ${d.phone || ''} ${d.donor_number || ''}`.toLowerCase().includes(q.toLowerCase())), [donors, q])
  const donor = donors.find((d) => d.id === sel)
  const pendingTti = donations.filter((d) => d.outcome === 'donated' && ['hiv', 'hbv', 'hcv', 'syphilis'].some((k) => !d.tti?.[k] || d.tti[k] === 'pending'))
  return (
    <div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {msg && <div style={s.ok}>{msg}</div>}
      <div style={s.grid(340)}>
        <div style={s.card}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input aria-label="Search donors" placeholder="Search name, ID or phone" style={s.input} value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" style={{ ...s.btn, ...s.pri, whiteSpace: 'nowrap' }} onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : '+ Donor'}</button>
          </div>
          {adding && <NewDonor hospitalId={hospitalId} onDone={() => { setAdding(false); void load() }} setErr={setErr} />}
          {shown.map((d) => {
            const next = nextEligible(d)
            const status = d.permanently_deferred ? ['Permanently deferred', 'red'] : d.deferred_until && new Date(d.deferred_until) > new Date() ? [`Deferred to ${d.deferred_until}`, 'yellow'] : next && next > new Date() ? [`Next ${next.toLocaleDateString('en-KE')}`, 'gray'] : ['Eligible', 'green']
            return (
              <button key={d.id} type="button" onClick={() => { setSel(d.id); setMsg('') }} style={{ width: '100%', textAlign: 'left', background: sel === d.id ? C.primaryL : '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', marginBottom: 4, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                <span><b>{d.full_name}</b> <span style={s.sub}>{d.blood_group || '?'} · {d.phone || d.national_id || ''}</span></span><Chip tone={status[1]}>{status[0]}</Chip>
              </button>
            )
          })}
          {!shown.length && <div style={s.sub}>No donors.</div>}
        </div>
        <div>
          {donor ? <DonationForm donor={donor} onDone={(m) => { setMsg(m); void load() }} setErr={setErr} /> : <div style={{ ...s.card, ...s.sub }}>Choose a donor to record a donation or deferral.</div>}
          <div style={{ ...s.card, marginTop: 12 }}>
            <h2 style={s.h2}>Screening results pending ({pendingTti.length})</h2>
            {pendingTti.map((d) => <TtiRow key={d.id} d={d} onDone={load} setErr={setErr} />)}
            {!pendingTti.length && <div style={s.sub}>All donations screened.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function NewDonor({ hospitalId, onDone, setErr }) {
  const [f, setF] = useState({ full_name: '', national_id: '', phone: '', sex: 'male', date_of_birth: '', blood_group: '', donor_number: '' })
  async function save() {
    if (!f.full_name.trim() || !f.date_of_birth) { setErr('Name and date of birth are required.'); return }
    const { error } = await supabase.from('blood_donors').insert(clean({ ...f, hospital_id: hospitalId }))
    if (error) setErr(friendly(error)); else { setErr(''); onDone() }
  }
  const inp = (k, l, type = 'text') => <div><label style={s.label} htmlFor={`dn-${k}`}>{l}</label><input id={`dn-${k}`} type={type} style={s.input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  return (
    <div style={{ background: '#F8FAFC', borderRadius: 8, padding: 10, marginBottom: 8 }}>
      <div style={s.grid(140)}>
        {inp('full_name', 'Full name *')}{inp('national_id', 'National ID')}{inp('phone', 'Phone')}
        <div><label style={s.label} htmlFor="dn-sex">Sex</label><select id="dn-sex" style={s.input} value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}><option value="male">Male</option><option value="female">Female</option></select></div>
        {inp('date_of_birth', 'Date of birth *', 'date')}
        <div><label style={s.label} htmlFor="dn-bg">Blood group</label><select id="dn-bg" style={s.input} value={f.blood_group} onChange={(e) => setF({ ...f, blood_group: e.target.value })}><option value="">Unknown</option>{BLOOD_GROUPS.map((x) => <option key={x}>{x}</option>)}</select></div>
        {inp('donor_number', 'Donor number')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={save}>Save donor</button></div>
    </div>
  )
}

function DonationForm({ donor, onDone, setErr }) {
  const blank = { weight_kg: '', hb: '', bp_sys: '', bp_dia: '', temp: '', questionnaire_ok: false, blood_group: donor.blood_group || '', unit_reference: '', volume_ml: 450, deferral_reason: '', deferral_until: '' }
  const [f, setF] = useState(blank)
  useEffect(() => { setF({ ...blank, blood_group: donor.blood_group || '' }) }, [donor.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const problem = donationProblem(donor, f)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  async function save(outcome) {
    if (outcome === 'donated' && problem) { setErr(`Not eligible: ${problem}`); return }
    if (outcome === 'donated' && !f.unit_reference.trim()) { setErr('Record the bag number.'); return }
    if (outcome === 'deferred' && !f.deferral_reason.trim()) { setErr('Give the reason for deferral.'); return }
    const row = clean({ ...f, hospital_id: donor.hospital_id, donor_id: donor.id, outcome })
    if (outcome === 'deferred') { delete row.unit_reference; delete row.volume_ml }
    const { error } = await supabase.from('blood_donations').insert(row)
    if (error) setErr(friendly(error)); else { setErr(''); setF(blank); onDone(outcome === 'donated' ? `Donation recorded. Unit ${f.unit_reference} is in quarantine until screening is negative.` : 'Deferral recorded.') }
  }
  const inp = (k, l, type = 'number') => <div><label style={s.label} htmlFor={`do-${k}`}>{l}</label><input id={`do-${k}`} type={type} style={s.input} value={f[k]} onChange={set(k)} /></div>
  return (
    <div style={s.card}>
      <h2 style={s.h2}>{donor.full_name} — donation</h2>
      <div style={s.grid(110)}>
        {inp('weight_kg', 'Weight kg')}{inp('hb', 'Hb g/dL')}{inp('bp_sys', 'BP sys')}{inp('bp_dia', 'BP dia')}{inp('temp', 'Temp °C')}
        <div><label style={s.label} htmlFor="do-bg">Group</label><select id="do-bg" style={s.input} value={f.blood_group} onChange={set('blood_group')}><option value="">—</option>{BLOOD_GROUPS.map((x) => <option key={x}>{x}</option>)}</select></div>
        {inp('unit_reference', 'Bag number', 'text')}{inp('volume_ml', 'Volume mL')}
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, margin: '8px 0' }}><input type="checkbox" checked={f.questionnaire_ok} onChange={set('questionnaire_ok')} />Donor health questionnaire completed and passed; informed consent signed</label>
      <div style={{ fontSize: 12, fontWeight: 700, color: problem ? C.danger : C.success }}>{problem ? `Not eligible: ${problem}` : 'Eligible to donate'}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'end', marginTop: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input aria-label="Deferral reason" placeholder="Deferral reason" style={{ ...s.input, width: 180 }} value={f.deferral_reason} onChange={set('deferral_reason')} />
          <input aria-label="Deferred until" type="date" style={{ ...s.input, width: 150 }} value={f.deferral_until} onChange={set('deferral_until')} />
          <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => save('deferred')}>Defer</button>
        </div>
        <button type="button" style={{ ...s.btn, ...s.pri }} disabled={Boolean(problem)} onClick={() => save('donated')}>Record donation</button>
      </div>
    </div>
  )
}

function TtiRow({ d, onDone, setErr }) {
  const [t, setT] = useState({ hiv: 'pending', hbv: 'pending', hcv: 'pending', syphilis: 'pending', ...(d.tti || {}) })
  async function save() {
    const { error } = await supabase.from('blood_donations').update({ tti: t }).eq('id', d.id)
    if (error) setErr(friendly(error)); else { setErr(''); onDone() }
  }
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, padding: '6px 0', fontSize: 12 }}>
      <div><b>{d.unit_reference}</b> · {d.blood_donors?.full_name} · {hm(d.donated_at)}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
        {['hiv', 'hbv', 'hcv', 'syphilis'].map((k) => (
          <label key={k} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>{k.toUpperCase()}
            <select aria-label={`${k} ${d.unit_reference}`} style={{ ...s.input, width: 105, padding: '4px 6px' }} value={t[k]} onChange={(e) => setT({ ...t, [k]: e.target.value })}><option value="pending">Pending</option><option value="negative">Negative</option><option value="reactive">Reactive</option></select>
          </label>
        ))}
        <button type="button" style={{ ...s.btn, ...s.soft }} onClick={save}>Save</button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ statistics
export function Stats({ hospitalId }) {
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { void supabase.rpc('blood_stats', { p_hospital: hospitalId, p_from: range.from, p_to: range.to }).then(({ data, error }) => { if (error) setErr(friendly(error)); else { setErr(''); setD(data) } }) }, [hospitalId, range])
  const tile = (l, v, warn) => <div style={{ border: `1px solid ${warn ? C.danger : C.border}`, borderRadius: 10, padding: 12, background: '#fff' }}><div style={s.sub}>{l}</div><div style={{ fontSize: 22, fontWeight: 800, color: warn ? C.danger : undefined }}>{v ?? '—'}</div></div>
  const ct = d && d.transfused ? Math.round((d.crossmatched / d.transfused) * 10) / 10 : null
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input aria-label="From" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <input aria-label="To" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {d && <>
        <div style={s.grid(160)}>
          {tile('Requests', d.requests)}{tile('Emergency requests', d.emergency_requests)}{tile('Units transfused', d.transfused)}
          {tile('Crossmatch : transfusion ratio', ct, ct > 2)}{tile('Uncrossmatched releases', d.emergency_releases)}
          {tile('Median emergency request → issue', d.median_emergency_request_to_issue_min === null ? null : `${d.median_emergency_request_to_issue_min} min`, d.median_emergency_request_to_issue_min > 30)}
          {tile('Reactions', d.reactions, d.reactions > 0)}{tile('Severe reactions', d.severe_reactions, d.severe_reactions > 0)}
          {tile('Started > 30 min after issue', d.late_starts, d.late_starts > 0)}{tile('Expiring in 7 days', d.expiring_7_days, d.expiring_7_days > 0)}
          {tile('Donations', d.donations)}{tile('Donor deferrals', d.deferrals)}{tile('Reactive screening', d.tti_reactive)}
        </div>
        <div style={{ ...s.grid(260), marginTop: 12 }}>
          <div><div style={s.label}>Issued by component</div>{Object.entries(d.issued_by_component || {}).map(([k, n]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{k}</span><b>{n}</b></div>)}</div>
          <div><div style={s.label}>Discarded (wastage)</div>{Object.entries(d.discarded || {}).map(([k, n]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{k}</span><b>{n}</b></div>)}{!Object.keys(d.discarded || {}).length && <div style={s.sub}>None.</div>}</div>
          <div><div style={s.label}>Stock now</div>{Object.entries(d.stock || {}).map(([k, n]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{k}</span><b>{n}</b></div>)}</div>
        </div>
      </>}
    </div>
  )
}
