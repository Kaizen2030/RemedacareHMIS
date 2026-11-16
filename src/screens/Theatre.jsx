// Theatre: day list by room, booking with clash check, the WHO Surgical Safety Checklist (enforced by the database),
// operating timestamps, operation note, recovery (modified Aldrete), implants and consumables, complications and
// utilisation. Data: 20261203000000_theatre.sql.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import PatientSearch from '../components/PatientSearch'
import usePatientAccessLog from '../hooks/useAccessLog'
import { C, Chip, s } from './ncd/ui'
import { localDateKey } from '../utils/scheduling'
import { CaseItems, PreferenceCards } from './theatre/PreferenceCards'
import { ALDRETE, CLAVIEN_DINDO, OP_NOTE_FIELDS, WHO_PHASES, aldreteTotal, caseStage, phaseProblem } from '../utils/theatreChecklist'

const STAGES = [['booked', 'Booked'], ['sign_in_done', 'Signed in'], ['time_out_done', 'Time out'], ['operating', 'Operating'], ['sign_out_done', 'Signed out'], ['recovery', 'Recovery'], ['completed', 'Done']]
const STAGE_TONE = { booked: 'gray', sign_in_done: 'blue', time_out_done: 'blue', operating: 'yellow', sign_out_done: 'yellow', recovery: 'blue', completed: 'green', cancelled: 'gray' }
const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Not installed yet. Run docs/sql/21_theatre.sql in Supabase.'
  if (/row-level|permission/i.test(m)) return 'Only clinical staff can use the theatre screen.'
  return m
}
const hm = (v) => (v ? new Date(v).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '—')

export default function Theatre() {
  const { hospitalId } = useHospital()
  const [tab, setTab] = useState('list')
  const [day, setDay] = useState(localDateKey())
  const [rooms, setRooms] = useState([])
  const [cases, setCases] = useState([])
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!hospitalId) return
    const start = new Date(`${day}T00:00:00`), end = new Date(start.getTime() + 86400000)
    const [r, c] = await Promise.all([
      supabase.from('theatre_rooms').select('*').eq('hospital_id', hospitalId).order('name'),
      supabase.from('theatre_cases').select('*, patients(full_name, patient_number, gender, age, allergies)').eq('hospital_id', hospitalId)
        .gte('scheduled_start', start.toISOString()).lt('scheduled_start', end.toISOString()).order('scheduled_start'),
    ])
    if (r.error || c.error) setErr(friendly(r.error || c.error)); else setErr('')
    setRooms(r.data || []); setCases(c.data || [])
  }, [hospitalId, day])
  useEffect(() => { void load() }, [load])

  const openCase = cases.find((c) => c.id === open)
  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div><h1 style={s.h1}>Theatre</h1><div style={s.sub}>WHO Surgical Safety Checklist on every case — the system will not let a step be skipped.</div></div>
        <input aria-label="Day" type="date" style={{ ...s.input, maxWidth: 170 }} value={day} onChange={(e) => setDay(e.target.value)} />
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div role="tablist" aria-label="Theatre sections" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['list', 'Theatre list'], ['book', '+ Book a case'], ['cards', 'Preference cards'], ['implants', 'Implant register'], ['complications', 'Complications'], ['stats', 'Utilisation'], ['rooms', 'Rooms']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...s.btn, ...(tab === k ? s.pri : s.ghost) }}>{l}</button>
        ))}
      </div>
      {tab === 'list' && <TheatreList rooms={rooms} cases={cases} onOpen={setOpen} />}
      {tab === 'book' && <BookCase hospitalId={hospitalId} rooms={rooms} day={day} onBooked={() => { setTab('list'); void load() }} />}
      {tab === 'cards' && <PreferenceCards hospitalId={hospitalId} />}
      {tab === 'implants' && <ImplantRegister hospitalId={hospitalId} />}
      {tab === 'complications' && <Complications hospitalId={hospitalId} />}
      {tab === 'stats' && <Stats hospitalId={hospitalId} />}
      {tab === 'rooms' && <Rooms hospitalId={hospitalId} rooms={rooms} onChanged={load} />}
      {openCase && <CaseDrawer c={openCase} rooms={rooms} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}

function TheatreList({ rooms, cases, onOpen }) {
  const groups = [...rooms.map((r) => ({ id: r.id, name: r.name })), { id: null, name: 'No room yet' }]
  if (!cases.length) return <div style={{ ...s.card, ...s.sub }}>No cases booked for this day.</div>
  return (
    <div style={s.grid(280)}>
      {groups.filter((g) => cases.some((c) => (c.room_id || null) === g.id)).map((g) => (
        <div key={g.id || 'none'} style={s.card}>
          <h2 style={s.h2}>{g.name}</h2>
          {cases.filter((c) => (c.room_id || null) === g.id).map((c) => {
            const st = caseStage(c)
            return (
              <button key={c.id} type="button" onClick={() => onOpen(c.id)} style={{ width: '100%', textAlign: 'left', border: `1px solid ${C.border}`, borderLeft: `5px solid ${c.urgency === 'emergency' ? C.danger : c.urgency === 'urgent' ? C.warn : C.border}`, background: '#fff', borderRadius: 10, padding: '8px 10px', marginBottom: 6, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><b>{hm(c.scheduled_start)} {c.procedure}{c.laterality && c.laterality !== 'na' ? ` (${c.laterality})` : ''}</b><Chip tone={STAGE_TONE[st]}>{st === 'cancelled' ? c.status : STAGES.find(([k]) => k === st)?.[1]}</Chip></div>
                <div style={s.sub}>{c.patients?.full_name} · {c.surgeon}{c.anaesthetist ? ` / ${c.anaesthetist}` : ''} · {c.urgency}</div>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function BookCase({ hospitalId, rooms, day, onBooked }) {
  const [patient, setPatient] = useState(null)
  const [f, setF] = useState({ procedure: '', laterality: 'na', urgency: 'elective', room_id: rooms[0]?.id || '', surgeon: '', assistant: '', anaesthetist: '', scrub_nurse: '', anaesthesia: 'general', asa: '1', date: day, time: '08:00', minutes: 60 })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function book(e) {
    e.preventDefault(); setErr('')
    if (!patient) { setErr('Pick the patient.'); return }
    if (!f.procedure.trim() || !f.surgeon.trim()) { setErr('Procedure and surgeon are required.'); return }
    const start = new Date(`${f.date}T${f.time}:00`)
    const { error } = await supabase.from('theatre_cases').insert({
      hospital_id: hospitalId, patient_id: patient.id, procedure: f.procedure.trim(), laterality: f.laterality, urgency: f.urgency, room_id: f.room_id || null,
      surgeon: f.surgeon.trim(), assistant: f.assistant || null, anaesthetist: f.anaesthetist || null, scrub_nurse: f.scrub_nurse || null,
      anaesthesia: f.anaesthesia, asa: f.asa, scheduled_start: start.toISOString(), scheduled_end: new Date(start.getTime() + Number(f.minutes) * 60000).toISOString(),
    })
    if (error) setErr(friendly(error)); else onBooked()
  }
  const field = (k, l, input) => <div><label style={s.label} htmlFor={`bk-${k}`}>{l}</label>{input || <input id={`bk-${k}`} style={s.input} value={f[k]} onChange={set(k)} />}</div>
  return (
    <form onSubmit={book} style={s.card}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {!rooms.length && <div style={{ ...s.err, background: C.warnL, color: C.warn }}>Add your operating rooms under the Rooms tab first.</div>}
      <div style={s.grid(200)}>
        <div><label style={s.label} htmlFor="bk-patient">Patient</label><PatientSearch id="bk-patient" hospitalId={hospitalId} inputStyle={s.input} value={patient} onPick={setPatient} /></div>
        {field('procedure', 'Procedure *')}
        {field('laterality', 'Side', <select id="bk-laterality" style={s.input} value={f.laterality} onChange={set('laterality')}><option value="na">Not applicable</option><option value="left">Left</option><option value="right">Right</option><option value="bilateral">Bilateral</option><option value="midline">Midline</option></select>)}
        {field('urgency', 'Urgency', <select id="bk-urgency" style={s.input} value={f.urgency} onChange={set('urgency')}><option value="elective">Elective</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select>)}
        {field('room_id', 'Room', <select id="bk-room_id" style={s.input} value={f.room_id} onChange={set('room_id')}><option value="">Not yet</option>{rooms.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>)}
        {field('date', 'Date', <input id="bk-date" type="date" style={s.input} value={f.date} onChange={set('date')} />)}
        {field('time', 'Start', <input id="bk-time" type="time" style={s.input} value={f.time} onChange={set('time')} />)}
        {field('minutes', 'Duration (min)', <input id="bk-minutes" type="number" min="10" step="5" style={s.input} value={f.minutes} onChange={set('minutes')} />)}
        {field('surgeon', 'Surgeon *')}
        {field('assistant', 'Assistant')}
        {field('anaesthetist', 'Anaesthetist')}
        {field('scrub_nurse', 'Scrub nurse')}
        {field('anaesthesia', 'Anaesthesia', <select id="bk-anaesthesia" style={s.input} value={f.anaesthesia} onChange={set('anaesthesia')}><option value="general">General</option><option value="spinal">Spinal</option><option value="epidural">Epidural</option><option value="regional_block">Regional block</option><option value="local">Local</option><option value="sedation">Sedation</option></select>)}
        {field('asa', 'ASA grade', <select id="bk-asa" style={s.input} value={f.asa} onChange={set('asa')}>{['1', '2', '3', '4', '5', '6', '1E', '2E', '3E', '4E', '5E'].map((a) => <option key={a}>{a}</option>)}</select>)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button type="submit" style={{ ...s.btn, ...s.pri }}>Book case</button></div>
    </form>
  )
}

function Phase({ phase, c, onSave, locked }) {
  const def = WHO_PHASES[phase]
  const [answers, setAnswers] = useState(c[phase] || {})
  useEffect(() => { setAnswers(c[phase] || {}) }, [c, phase])
  const done = Boolean(c[`${phase}_at`])
  const problem = phaseProblem(phase, answers)
  return (
    <div style={{ ...s.card, marginBottom: 10, borderColor: done ? C.success : C.border }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <b>{def.title} — {def.when}</b>
        {done ? <Chip tone="green">Done {hm(c[`${phase}_at`])}</Chip> : <span style={s.sub}>{def.who}</span>}
      </div>
      {def.items.map((i) => (
        <div key={i.key} style={{ padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13 }}>{i.label}</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
            {i.options.map(([v, l]) => (
              <label key={v} style={{ display: 'flex', gap: 4, fontSize: 12, alignItems: 'center' }}>
                <input type="radio" name={`${c.id}-${phase}-${i.key}`} disabled={locked} checked={answers[i.key] === v} onChange={() => setAnswers({ ...answers, [i.key]: v })} />{l}
              </label>
            ))}
            {i.options.length === 1 && <label style={{ display: 'flex', gap: 4, fontSize: 12, alignItems: 'center', color: C.danger }}><input type="radio" name={`${c.id}-${phase}-${i.key}`} disabled={locked} checked={answers[i.key] === 'no'} onChange={() => setAnswers({ ...answers, [i.key]: 'no' })} />No</label>}
          </div>
          {i.warn && answers[i.key] === 'no' && <div style={{ color: C.danger, fontSize: 12, fontWeight: 700 }}>{i.warn}</div>}
        </div>
      ))}
      {!locked && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <span style={{ fontSize: 12, color: problem ? C.warn : C.success }}>{problem ? `Still open: ${problem}` : 'Complete'}</span>
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => onSave({ [phase]: answers })}>Save {def.title.toLowerCase()}</button>
      </div>}
    </div>
  )
}

function CaseDrawer({ c, rooms, onClose, onChanged }) {
  const allowed = usePatientAccessLog(c.hospital_id, c.patient_id, 'theatre')
  const [tab, setTab] = useState('checklist')
  const [note, setNote] = useState(c.op_note || {})
  const [ald, setAld] = useState({})
  const [grade, setGrade] = useState(c.complication_grade || 'none')
  const [compl, setCompl] = useState(c.complications || '')
  const [addendum, setAddendum] = useState(c.addendum || '')
  const [reason, setReason] = useState('')
  const [items, setItems] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const closed = ['completed', 'cancelled', 'postponed'].includes(c.status)
  const stage = caseStage(c)

  const loadItems = useCallback(async () => {
    const { data } = await supabase.from('theatre_items').select('*').eq('case_id', c.id).order('created_at')
    setItems(data || [])
  }, [c.id])
  useEffect(() => { void loadItems() }, [loadItems])
  useEffect(() => { setNote(c.op_note || {}) }, [c.op_note])

  async function update(patch, ok) {
    setErr(''); setMsg('')
    const { error } = await supabase.from('theatre_cases').update(patch).eq('id', c.id)
    if (error) setErr(friendly(error)); else { if (ok) setMsg(ok); onChanged() }
  }
  const total = aldreteTotal(ald)
  if (!allowed) return <div style={s.overlay} onClick={onClose}><div style={s.drawer} onClick={(e) => e.stopPropagation()}><div role="alert" style={s.err}>This record is confidential. Open it again and give a reason to continue.</div></div></div>

  const stamp = (key, label, status) => (
    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
      <span>{label}</span>
      {c[key] ? <b>{hm(c[key])}</b> : !closed && <button type="button" style={{ ...s.btn, ...s.soft, padding: '3px 10px' }} onClick={() => update({ [key]: new Date().toISOString(), ...(status ? { status } : {}) })}>Now</button>}
    </div>
  )

  return (
    <div style={s.overlay} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={c.procedure} style={{ ...s.drawer, width: 820 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <h2 style={{ ...s.h2, fontSize: 18, marginBottom: 2 }}>{c.procedure}{c.laterality && c.laterality !== 'na' ? ` — ${c.laterality.toUpperCase()}` : ''}</h2>
            <div style={s.sub}>{c.patients?.full_name} {c.patients?.patient_number ? `· ${c.patients.patient_number}` : ''} · {c.surgeon}{c.anaesthetist ? ` / ${c.anaesthetist}` : ''} · {rooms.find((r) => r.id === c.room_id)?.name || 'no room'} · {hm(c.scheduled_start)}–{hm(c.scheduled_end)} · ASA {c.asa || '—'} · {c.anaesthesia || ''}</div>
            {c.patients?.allergies && <div style={{ ...s.err, margin: '6px 0 0', padding: '4px 8px' }}>Allergies: {c.patients.allergies}</div>}
          </div>
          <button type="button" style={{ ...s.btn, ...s.ghost, alignSelf: 'flex-start' }} onClick={onClose}>Close</button>
        </div>
        <div style={{ display: 'flex', gap: 4, margin: '10px 0', flexWrap: 'wrap' }} aria-label="Progress">
          {STAGES.map(([k, l], i) => {
            const reached = STAGES.findIndex(([x]) => x === stage) >= i
            return <span key={k} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: reached ? C.success : '#F2F4F7', color: reached ? '#fff' : C.sub, fontWeight: 700 }}>{l}</span>
          })}
        </div>
        {err && <div role="alert" style={s.err}>{err}</div>}
        {msg && <div role="status" style={s.ok}>{msg}</div>}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {[['checklist', 'WHO checklist & times'], ['note', 'Operation note'], ['recovery', 'Recovery'], ['items', `Implants & items (${items.length})`]].map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} style={{ ...s.btn, ...(tab === k ? s.soft : s.ghost) }}>{l}</button>)}
        </div>

        {tab === 'checklist' && <>
          <Phase phase="sign_in" c={c} locked={closed || Boolean(c.time_out_at)} onSave={(p) => update(p, 'Sign in saved.')} />
          <div style={{ ...s.card, marginBottom: 10 }}>
            {stamp('in_theatre_at', 'Patient in theatre', c.status === 'booked' ? 'in_theatre' : null)}
            {stamp('anaesthesia_start', 'Anaesthesia start')}
          </div>
          <Phase phase="time_out" c={c} locked={closed || Boolean(c.sign_out_at)} onSave={(p) => update(p, 'Time out saved.')} />
          <div style={{ ...s.card, marginBottom: 10 }}>
            {stamp('knife_to_skin', 'Knife to skin', 'operating')}
            {stamp('closure_at', 'Closure', 'closing')}
          </div>
          <Phase phase="sign_out" c={c} locked={closed || Boolean(c.out_of_theatre)} onSave={(p) => update(p, 'Sign out saved.')} />
          {!closed && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {!c.out_of_theatre && <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => update({ status: 'recovery' }, 'Patient moved to recovery.')}>Patient out → recovery</button>}
            <input aria-label="Cancel reason" style={{ ...s.input, maxWidth: 260 }} placeholder="Reason to cancel / postpone" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => update({ status: 'postponed', cancel_reason: reason }, 'Postponed.')}>Postpone</button>
            <button type="button" style={{ ...s.btn, ...s.danger }} onClick={() => update({ status: 'cancelled', cancel_reason: reason }, 'Cancelled.')}>Cancel case</button>
          </div>}
          {c.cancel_reason && <div style={{ ...s.sub, marginTop: 6 }}>{c.status}: {c.cancel_reason}</div>}
        </>}

        {tab === 'note' && (
          <div style={s.card}>
            <div style={s.grid(260)}>
              {OP_NOTE_FIELDS.map((fl) => (
                <div key={fl.key} style={fl.long ? { gridColumn: '1 / -1' } : undefined}>
                  <label style={s.label} htmlFor={`on-${fl.key}`}>{fl.label}{fl.required ? ' *' : ''}</label>
                  {fl.long ? <textarea id={`on-${fl.key}`} disabled={closed} style={{ ...s.input, minHeight: 70 }} value={note[fl.key] || ''} onChange={(e) => setNote({ ...note, [fl.key]: e.target.value })} />
                    : <input id={`on-${fl.key}`} disabled={closed} type={fl.type || 'text'} style={s.input} value={note[fl.key] || ''} onChange={(e) => setNote({ ...note, [fl.key]: e.target.value })} />}
                </div>
              ))}
            </div>
            {!closed && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => update({ op_note: { ...note, written_at: new Date().toISOString() } }, 'Operation note saved.')}>Save operation note</button></div>}
            {closed && <div style={{ marginTop: 10 }}>
              <label style={s.label} htmlFor="addendum">Addendum</label>
              <textarea id="addendum" style={{ ...s.input, minHeight: 50 }} value={addendum} onChange={(e) => setAddendum(e.target.value)} />
              <button type="button" style={{ ...s.btn, ...s.ghost, marginTop: 6 }} onClick={() => update({ addendum }, 'Addendum saved.')}>Save addendum</button>
            </div>}
          </div>
        )}

        {tab === 'recovery' && (
          <div style={s.card}>
            {(c.recovery || []).map((r, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: `1px solid ${C.border}` }}><span>{hm(r.at)}</span><b style={{ color: r.total >= 9 ? C.success : C.warn }}>Aldrete {r.total}/10</b></div>)}
            {!closed && <>
              <div style={{ ...s.grid(180), marginTop: 8 }}>
                {ALDRETE.map((a) => <div key={a.key}><label style={s.label} htmlFor={`al-${a.key}`}>{a.label}</label><select id={`al-${a.key}`} style={s.input} value={ald[a.key] ?? ''} onChange={(e) => setAld({ ...ald, [a.key]: e.target.value })}><option value="">—</option>{a.options.map((o, n) => <option key={n} value={n}>{o}</option>)}</select></div>)}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <b>{total === null ? 'Score all five' : `Total ${total}/10`}</b>
                <button type="button" style={{ ...s.btn, ...s.soft }} disabled={total === null} onClick={() => { void update({ recovery: [...(c.recovery || []), { at: new Date().toISOString(), total, scores: ald }] }, 'Score recorded.'); setAld({}) }}>Record score</button>
              </div>
              <div style={{ ...s.grid(260), marginTop: 12 }}>
                <div><label style={s.label} htmlFor="cd-grade">Complications (Clavien–Dindo)</label><select id="cd-grade" style={s.input} value={grade} onChange={(e) => setGrade(e.target.value)}>{Object.entries(CLAVIEN_DINDO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div><label style={s.label} htmlFor="cd-text">Details</label><input id="cd-text" style={s.input} value={compl} onChange={(e) => setCompl(e.target.value)} /></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => update({ status: 'completed', complication_grade: grade, complications: compl || null }, 'Case completed and closed.')}>Discharge from recovery — complete case</button>
              </div>
            </>}
            {closed && c.status === 'completed' && <div style={{ ...s.grid(260), marginTop: 10 }}>
              <div><label style={s.label} htmlFor="cd-grade2">Later complication (Clavien–Dindo)</label><select id="cd-grade2" style={s.input} value={grade} onChange={(e) => setGrade(e.target.value)}>{Object.entries(CLAVIEN_DINDO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div><label style={s.label} htmlFor="cd-text2">Details</label><input id="cd-text2" style={s.input} value={compl} onChange={(e) => setCompl(e.target.value)} /></div>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => update({ complication_grade: grade, complications: compl || null }, 'Complication recorded.')}>Save</button>
            </div>}
          </div>
        )}

        {tab === 'items' && <CaseItems c={c} items={items} reload={loadItems} closed={closed} />}
      </div>
    </div>
  )
}

function ImplantRegister({ hospitalId }) {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  useEffect(() => {
    void supabase.from('theatre_items').select('*, theatre_cases(procedure, scheduled_start, surgeon, patients(full_name, patient_number))').eq('hospital_id', hospitalId).eq('kind', 'implant').order('created_at', { ascending: false }).limit(500)
      .then(({ data }) => setRows(data || []))
  }, [hospitalId])
  const shown = rows.filter((r) => !q || `${r.name} ${r.manufacturer} ${r.lot_number} ${r.serial}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div style={s.card}>
      <input aria-label="Search implants" style={{ ...s.input, maxWidth: 360, marginBottom: 10 }} placeholder="Search item, maker, lot or serial (for recalls)" value={q} onChange={(e) => setQ(e.target.value)} />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{['Date', 'Patient', 'Implant', 'Maker', 'Lot / serial', 'Procedure', 'Surgeon'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>{shown.map((r) => <tr key={r.id}><td style={s.td}>{new Date(r.created_at).toLocaleDateString('en-KE')}</td><td style={s.td}>{r.theatre_cases?.patients?.full_name} {r.theatre_cases?.patients?.patient_number}</td><td style={s.td}>{r.name}</td><td style={s.td}>{r.manufacturer || '—'}</td><td style={s.td}>{[r.lot_number, r.serial].filter(Boolean).join(' / ')}</td><td style={s.td}>{r.theatre_cases?.procedure}</td><td style={s.td}>{r.theatre_cases?.surgeon}</td></tr>)}</tbody>
      </table>
      {!shown.length && <div style={{ ...s.sub, padding: 10 }}>No implants recorded.</div>}
    </div>
  )
}

function Complications({ hospitalId }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    void supabase.from('theatre_cases').select('id, procedure, surgeon, scheduled_start, complication_grade, complications, patients(full_name)').eq('hospital_id', hospitalId)
      .not('complication_grade', 'is', null).neq('complication_grade', 'none').order('scheduled_start', { ascending: false }).limit(300).then(({ data }) => setRows(data || []))
  }, [hospitalId])
  return (
    <div style={s.card}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{['Date', 'Patient', 'Procedure', 'Surgeon', 'Grade', 'Details'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td style={s.td}>{new Date(r.scheduled_start).toLocaleDateString('en-KE')}</td><td style={s.td}>{r.patients?.full_name}</td><td style={s.td}>{r.procedure}</td><td style={s.td}>{r.surgeon}</td><td style={s.td}><Chip tone={/IV|V/.test(r.complication_grade) ? 'red' : 'yellow'}>{r.complication_grade}</Chip></td><td style={s.td}>{r.complications || '—'}</td></tr>)}</tbody>
      </table>
      {!rows.length && <div style={{ ...s.sub, padding: 10 }}>No complications recorded.</div>}
    </div>
  )
}

function Stats({ hospitalId }) {
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { void supabase.rpc('theatre_stats', { p_hospital: hospitalId, p_from: range.from, p_to: range.to }).then(({ data, error }) => { if (error) setErr(friendly(error)); else { setErr(''); setD(data) } }) }, [hospitalId, range])
  const tile = (l, v, warn) => <div style={{ border: `1px solid ${warn ? C.danger : C.border}`, borderRadius: 10, padding: 12, background: '#fff' }}><div style={s.sub}>{l}</div><div style={{ fontSize: 22, fontWeight: 800, color: warn ? C.danger : undefined }}>{v ?? '—'}</div></div>
  const pct = (v) => (v === null || v === undefined ? null : `${v}%`)
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input aria-label="From" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <input aria-label="To" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {d && <>
        <div style={s.grid(160)}>
          {tile('Cases booked', d.booked)}{tile('Completed', d.completed)}
          {tile('Cancelled / postponed', d.cancelled, d.booked && d.cancelled / d.booked > 0.1)}
          {tile('Elective on-time starts', pct(d.on_time_start_pct), d.on_time_start_pct !== null && d.on_time_start_pct < 80)}
          {tile('Median turnover', d.median_turnover_min === null ? null : `${d.median_turnover_min} min`, d.median_turnover_min > 30)}
          {tile('WHO checklist complete', pct(d.checklist_complete_pct), d.checklist_complete_pct !== null && d.checklist_complete_pct < 100)}
          {tile('Emergency cases', pct(d.emergency_pct))}{tile('Complications', d.complications, d.complications > 0)}{tile('Implants used', d.implants)}
        </div>
        <div style={{ ...s.grid(260), marginTop: 12 }}>
          <div><div style={s.label}>By room</div>{Object.entries(d.by_room || {}).map(([r, v]) => <div key={r} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{r}</span><b>{v.cases} cases · {v.hours ?? 0} h in use</b></div>)}</div>
          <div><div style={s.label}>Cancellation reasons</div>{Object.entries(d.cancel_reasons || {}).map(([r, n]) => <div key={r} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{r}</span><b>{n}</b></div>)}{!Object.keys(d.cancel_reasons || {}).length && <div style={s.sub}>None.</div>}</div>
        </div>
      </>}
    </div>
  )
}

function Rooms({ hospitalId, rooms, onChanged }) {
  const [nameV, setNameV] = useState('')
  const [err, setErr] = useState('')
  async function add(e) {
    e.preventDefault(); setErr('')
    if (!nameV.trim()) return
    const { error } = await supabase.from('theatre_rooms').insert({ hospital_id: hospitalId, name: nameV.trim() })
    if (error) setErr(/duplicate|unique/i.test(error.message) ? 'That room already exists.' : friendly(error)); else { setNameV(''); onChanged() }
  }
  const toggle = async (r) => { await supabase.from('theatre_rooms').update({ active: !r.active }).eq('id', r.id); onChanged() }
  const list = useMemo(() => rooms, [rooms])
  return (
    <div style={s.card}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <form onSubmit={add} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input aria-label="Room name" style={{ ...s.input, maxWidth: 260 }} placeholder="e.g. Main theatre 1, Minor theatre" value={nameV} onChange={(e) => setNameV(e.target.value)} />
        <button type="submit" style={{ ...s.btn, ...s.pri }}>Add room</button>
      </form>
      {list.map((r) => <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.border}` }}><span>{r.name}</span><button type="button" style={{ ...s.btn, ...s.ghost, padding: '3px 8px' }} onClick={() => toggle(r)}>{r.active ? 'Take out of use' : 'Bring back into use'}</button></div>)}
      {!list.length && <div style={s.sub}>No rooms yet.</div>}
    </div>
  )
}
