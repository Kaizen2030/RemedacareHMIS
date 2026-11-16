// Emergency department: live board by triage colour with see-by countdowns, triage (adult SATS / TEWS, child ETAT+),
// time-critical pathways (stroke, STEMI, sepsis, trauma) with timed steps, trauma sheet, dispositions including
// "left without being seen", and department times. Data: 20261202000000_emergency.sql.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import PatientSearch from '../components/PatientSearch'
import usePatientAccessLog from '../hooks/useAccessLog'
import { C, Chip, s } from './ncd/ui'
import { ADULT_SIGNS, CHILD_SIGNS, COLOURS, DISPOSITIONS, PATHWAYS, gcs, minutesToTarget, pathwayStatus, tews, triageColour } from '../utils/edTriage'

const COLOUR_ORDER = { red: 0, orange: 1, yellow: 2, green: 3, blue: 4 }
const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Not installed yet. Run docs/sql/20_emergency.sql in Supabase.'
  if (/row-level|permission/i.test(m)) return 'Only clinical staff can use the emergency department screen.'
  return m
}
const mins = (from, to = new Date()) => Math.max(0, Math.round((new Date(to) - new Date(from)) / 60000))
const dur = (m) => (m === null || m === undefined ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`)
const name = (a) => a.patients?.full_name || a.unknown_label || 'Unknown patient'

function ColourChip({ colour }) {
  const c = COLOURS[colour]
  if (!c) return <Chip>Not triaged</Chip>
  return <span style={{ background: c.bg, color: c.fg, borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>{colour.toUpperCase()}</span>
}

function suggestPathways({ signs, complaint, vitals, trauma }) {
  const t = `${signs.join(' ')} ${complaint || ''}`.toLowerCase()
  const out = new Set()
  if (/chest pain/.test(t)) out.add('stemi')
  if (/focal neuro|stroke|weakness|slurred|facial droop/.test(t)) out.add('stroke')
  if (trauma || /trauma|fracture|burn|injur|accident|rta/.test(t)) out.add('trauma')
  const temp = Number(vitals.temp), hr = Number(vitals.hr), rr = Number(vitals.rr), sbp = Number(vitals.sbp)
  const sirs = [temp > 38.3 || (temp && temp < 36), hr > 90, rr > 21, sbp && sbp <= 100].filter(Boolean).length
  if (sirs >= 2 || /sepsis|infection/.test(t)) out.add('sepsis')
  return [...out]
}

export default function Emergency() {
  const { hospitalId } = useHospital()
  const [tab, setTab] = useState('board')
  const [rows, setRows] = useState([])
  const [events, setEvents] = useState([])
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)
  const [now, setNow] = useState(new Date())

  const load = useCallback(async () => {
    if (!hospitalId) return
    const since = new Date(Date.now() - 2 * 86400000).toISOString()
    const [a, e] = await Promise.all([
      supabase.from('ed_attendances').select('*, patients(full_name, patient_number, gender, age, allergies)').eq('hospital_id', hospitalId).or(`departed_at.is.null,departed_at.gte.${since}`).order('arrival_at', { ascending: false }).limit(300),
      supabase.from('ed_pathway_events').select('*').eq('hospital_id', hospitalId).gte('done_at', since).limit(2000),
    ])
    if (a.error || e.error) setErr(friendly(a.error || e.error)); else setErr('')
    setRows(a.data || []); setEvents(e.data || [])
  }, [hospitalId])
  useEffect(() => { void load(); const t = setInterval(() => { void load() }, 30000); return () => clearInterval(t) }, [load])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t) }, [])

  const active = useMemo(() => rows.filter((r) => !r.departed_at).sort((a, b) =>
    (COLOUR_ORDER[a.triage_colour] ?? 5) - (COLOUR_ORDER[b.triage_colour] ?? 5) || new Date(a.arrival_at) - new Date(b.arrival_at)), [rows])
  const waiting = active.filter((r) => !r.seen_at)
  const late = waiting.filter((r) => (minutesToTarget(r, now) ?? 1) < 0)
  const openRow = open ? rows.find((r) => r.id === open) : null

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h1 style={s.h1}>Emergency department</h1>
          <div style={s.sub}>{active.length} in the department · {waiting.length} waiting to be seen{late.length ? ` · ` : ''}{late.length ? <b style={{ color: C.danger }}>{late.length} past their target time</b> : null}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['red', 'orange', 'yellow', 'green'].map((c) => <span key={c} style={{ background: COLOURS[c].bg, color: COLOURS[c].fg, borderRadius: 10, padding: '6px 10px', fontWeight: 800, fontSize: 13 }}>{active.filter((r) => r.triage_colour === c).length} {c}</span>)}
        </div>
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div role="tablist" aria-label="Emergency sections" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['board', 'Board'], ['triage', '+ New arrival / triage'], ['recent', 'Left today'], ['stats', 'Department times']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...s.btn, ...(tab === k ? s.pri : s.ghost) }}>{l}</button>
        ))}
      </div>

      {tab === 'board' && <Board rows={active} events={events} now={now} onOpen={setOpen} />}
      {tab === 'triage' && <TriageForm hospitalId={hospitalId} onSaved={(id) => { setTab('board'); void load().then(() => setOpen(id)) }} />}
      {tab === 'recent' && <Board rows={rows.filter((r) => r.departed_at && new Date(r.departed_at) > new Date(Date.now() - 86400000))} events={events} now={now} onOpen={setOpen} departed />}
      {tab === 'stats' && <Stats hospitalId={hospitalId} />}
      {openRow && <AttendanceDrawer att={openRow} events={events.filter((e) => e.attendance_id === openRow.id)} now={now} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}

function Board({ rows, events, now, onOpen, departed = false }) {
  if (!rows.length) return <div style={{ ...s.card, ...s.sub }}>{departed ? 'Nobody has left in the last 24 hours.' : 'The department is empty.'}</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((a) => {
        const left = minutesToTarget(a, now)
        const overdueSteps = (a.pathways || []).flatMap((p) => pathwayStatus(p, events.filter((e) => e.attendance_id === a.id), a.arrival_at, now)).filter((x) => x.state === 'overdue' && !x.optional).length
        return (
          <button key={a.id} type="button" onClick={() => onOpen(a.id)} style={{ textAlign: 'left', background: '#fff', border: `1px solid ${left !== null && left < 0 ? C.danger : C.border}`, borderLeft: `6px solid ${COLOURS[a.triage_colour]?.fg || C.border}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span>
              <b>{name(a)}</b> <ColourChip colour={a.triage_colour} />
              <span style={{ ...s.sub, display: 'block' }}>{[a.complaint, a.bay && `Bay ${a.bay}`, a.age_group === 'child' && 'Child', a.clinician].filter(Boolean).join(' · ')}</span>
            </span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
              {(a.pathways || []).map((p) => <Chip key={p} tone={overdueSteps ? 'red' : 'blue'}>{PATHWAYS[p]?.label.split(' (')[0]}</Chip>)}
              {overdueSteps > 0 && <b style={{ color: C.danger }}>{overdueSteps} step{overdueSteps > 1 ? 's' : ''} late</b>}
              <span style={s.sub}>In {dur(mins(a.arrival_at, a.departed_at || now))}</span>
              {departed ? <Chip>{DISPOSITIONS[a.disposition] || a.disposition}</Chip>
                : a.seen_at ? <Chip tone="green">Seen</Chip>
                  : left === null ? <Chip tone="yellow">Triage now</Chip>
                    : <b style={{ color: left < 0 ? C.danger : C.text }}>{left < 0 ? `${-left} min late` : left === 0 ? 'See now' : `see in ${left} min`}</b>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const VITALS = [['rr', 'Resp. rate /min'], ['hr', 'Pulse /min'], ['sbp', 'Systolic BP'], ['dbp', 'Diastolic BP'], ['temp', 'Temp °C'], ['spo2', 'SpO₂ %'], ['glucose', 'Glucose mmol/L'], ['weight', 'Weight kg']]

function TriageForm({ hospitalId, att = null, onSaved }) {
  const [patient, setPatient] = useState(null)
  const [f, setF] = useState(() => ({
    unknown_label: att?.unknown_label || '', arrival_mode: att?.arrival_mode || 'walk_in', age_group: att?.age_group || 'adult', complaint: att?.complaint || '', bay: att?.bay || '',
    vitals: att?.vitals || {}, signs: att?.discriminators || [], dead: att?.triage_colour === 'blue',
  }))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const v = f.vitals
  const child = f.age_group === 'child'
  const score = tews({ mobility: v.mobility, rr: v.rr, hr: v.hr, sbp: v.sbp, temp: v.temp, avpu: v.avpu, trauma: v.trauma === undefined ? undefined : v.trauma === 'yes' })
  const colour = triageColour({ score: score.score, signs: f.signs, child, dead: f.dead })
  const signs = child ? CHILD_SIGNS : ADULT_SIGNS
  const suggested = suggestPathways({ signs: f.signs, complaint: f.complaint, vitals: v, trauma: v.trauma === 'yes' })
  const [pathways, setPathways] = useState(att?.pathways || [])
  const setV = (k, val) => setF((x) => ({ ...x, vitals: { ...x.vitals, [k]: val } }))
  const toggleSign = (c, label) => setF((x) => { const key = `${c}:${label}`; return { ...x, signs: x.signs.includes(key) ? x.signs.filter((y) => y !== key) : [...x.signs, key] } })

  async function save(e) {
    e.preventDefault(); setErr('')
    if (!att && !patient && !f.unknown_label.trim()) { setErr('Pick the patient, or describe an unidentified patient (e.g. "Unknown male, ~30 y").'); return }
    if (!child && !f.dead && score.missing.length > 3 && !f.signs.length) { setErr('Record the vital signs (or tick an emergency sign) to triage.'); return }
    setBusy(true)
    const row = {
      age_group: f.age_group, complaint: f.complaint || null, bay: f.bay || null, arrival_mode: f.arrival_mode,
      vitals: f.vitals, tews_score: child ? null : score.score, discriminators: [...f.signs, ...(f.dead ? ['blue:Dead on arrival'] : [])], pathways: [...new Set(pathways)],
      triage_at: new Date().toISOString(),
    }
    const res = att
      ? await supabase.from('ed_attendances').update(row).eq('id', att.id).select('id').single()
      : await supabase.from('ed_attendances').insert({ ...row, hospital_id: hospitalId, patient_id: patient?.id || null, unknown_label: patient ? null : f.unknown_label.trim() }).select('id').single()
    setBusy(false)
    if (res.error) setErr(friendly(res.error)); else onSaved?.(res.data.id)
  }

  const num = (k, l) => <div key={k}><label style={s.label} htmlFor={`v-${k}`}>{l}</label><input id={`v-${k}`} style={s.input} inputMode="decimal" value={v[k] ?? ''} onChange={(e) => setV(k, e.target.value)} /></div>
  return (
    <form onSubmit={save} style={att ? {} : s.card}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {!att && <div style={{ ...s.grid(220), marginBottom: 8 }}>
        <div><label style={s.label} htmlFor="ed-patient">Patient</label><PatientSearch id="ed-patient" hospitalId={hospitalId} inputStyle={s.input} value={patient} onPick={setPatient} /></div>
        <div><label style={s.label} htmlFor="ed-unknown">…or unidentified patient</label><input id="ed-unknown" style={s.input} placeholder="Unknown male, ~30 y, RTA" value={f.unknown_label} onChange={(e) => setF({ ...f, unknown_label: e.target.value })} disabled={Boolean(patient)} /></div>
        <div><label style={s.label} htmlFor="ed-mode">Arrived by</label><select id="ed-mode" style={s.input} value={f.arrival_mode} onChange={(e) => setF({ ...f, arrival_mode: e.target.value })}>
          <option value="walk_in">Walked in</option><option value="ambulance">Ambulance</option><option value="private_car">Private car / boda</option><option value="police">Police</option><option value="referral">Referral</option><option value="other">Other</option></select></div>
      </div>}
      <div style={{ ...s.grid(200), marginBottom: 8 }}>
        <div><label style={s.label} htmlFor="ed-age">Triage scale</label><select id="ed-age" style={s.input} value={f.age_group} onChange={(e) => setF({ ...f, age_group: e.target.value, signs: [] })}><option value="adult">Adult — SATS (≥ 12 y or &gt; 150 cm)</option><option value="child">Child — ETAT+</option></select></div>
        <div><label style={s.label} htmlFor="ed-complaint">Presenting complaint</label><input id="ed-complaint" style={s.input} value={f.complaint} onChange={(e) => setF({ ...f, complaint: e.target.value })} /></div>
        <div><label style={s.label} htmlFor="ed-bay">Bay / area</label><input id="ed-bay" style={s.input} placeholder="Resus 1, Bay 4, Waiting" value={f.bay} onChange={(e) => setF({ ...f, bay: e.target.value })} /></div>
      </div>

      <div style={{ ...s.grid(120), marginBottom: 8 }}>
        {VITALS.map(([k, l]) => num(k, l))}
        {!child && <>
          <div><label style={s.label} htmlFor="v-mob">Mobility</label><select id="v-mob" style={s.input} value={v.mobility || ''} onChange={(e) => setV('mobility', e.target.value)}><option value="">—</option><option value="walking">Walking</option><option value="with_help">With help</option><option value="stretcher">Stretcher / immobile</option></select></div>
          <div><label style={s.label} htmlFor="v-avpu">AVPU</label><select id="v-avpu" style={s.input} value={v.avpu || ''} onChange={(e) => setV('avpu', e.target.value)}><option value="">—</option><option value="A">Alert</option><option value="V">Reacts to voice</option><option value="P">Reacts to pain</option><option value="U">Unresponsive</option></select></div>
          <div><label style={s.label} htmlFor="v-trauma">Trauma</label><select id="v-trauma" style={s.input} value={v.trauma || ''} onChange={(e) => setV('trauma', e.target.value)}><option value="">—</option><option value="no">No</option><option value="yes">Yes</option></select></div>
        </>}
      </div>

      <fieldset style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', marginBottom: 8 }}>
        <legend style={s.label}>{child ? 'ETAT+ signs' : 'Emergency signs (SATS)'}</legend>
        {['red', 'orange', 'yellow'].filter((c) => signs[c]?.length).map((c) => (
          <div key={c} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: COLOURS[c].fg }}>{child ? (c === 'red' ? 'EMERGENCY SIGNS — treat now' : 'PRIORITY SIGNS — see first') : COLOURS[c].label.toUpperCase()}</div>
            <div style={s.grid(230)}>{signs[c].map((label) => (
              <label key={label} style={{ display: 'flex', gap: 6, fontSize: 12, alignItems: 'flex-start' }}><input type="checkbox" checked={f.signs.includes(`${c}:${label}`)} onChange={() => toggleSign(c, label)} />{label}</label>
            ))}</div>
          </div>
        ))}
        <label style={{ display: 'flex', gap: 6, fontSize: 12 }}><input type="checkbox" checked={f.dead} onChange={(e) => setF({ ...f, dead: e.target.checked })} />Dead on arrival (blue)</label>
      </fieldset>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: 10, borderRadius: 10, background: COLOURS[colour].bg, color: COLOURS[colour].fg, marginBottom: 8 }}>
        <b style={{ fontSize: 18 }}>{COLOURS[colour].label}</b>
        {!child && <span>TEWS {score.score}{score.missing.length ? ` (missing: ${score.missing.join(', ')})` : ''}</span>}
        {COLOURS[colour].target !== null && <span>See {COLOURS[colour].target === 0 ? 'immediately' : `within ${COLOURS[colour].target} min`}</span>}
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={s.label}>Time-critical pathways</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{Object.entries(PATHWAYS).map(([k, p]) => (
          <label key={k} style={{ display: 'flex', gap: 6, fontSize: 12, alignItems: 'center' }}>
            <input type="checkbox" checked={pathways.includes(k)} onChange={() => setPathways((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))} />{p.label}
            {suggested.includes(k) && !pathways.includes(k) && <Chip tone="yellow">suggested</Chip>}
          </label>
        ))}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="submit" style={{ ...s.btn, ...s.pri }} disabled={busy}>{busy ? 'Saving…' : att ? 'Save re-triage' : 'Save triage'}</button></div>
    </form>
  )
}

function AttendanceDrawer({ att, events, now, onClose, onChanged }) {
  const recordAllowed = usePatientAccessLog(att.hospital_id, att.patient_id, 'emergency')
  const [section, setSection] = useState('care')
  const [clinician, setClinician] = useState(att.clinician || '')
  const [disp, setDisp] = useState('')
  const [note, setNote] = useState(att.notes || '')
  const [sheet, setSheet] = useState(att.trauma_sheet || {})
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const closed = Boolean(att.departed_at)

  async function update(patch, ok) {
    setErr(''); setMsg('')
    const { error } = await supabase.from('ed_attendances').update(patch).eq('id', att.id)
    if (error) setErr(friendly(error)); else { if (ok) setMsg(ok); onChanged() }
  }
  async function tick(pathway, step, done) {
    setErr('')
    const res = done
      ? await supabase.from('ed_pathway_events').delete().eq('attendance_id', att.id).eq('pathway', pathway).eq('step', step)
      : await supabase.from('ed_pathway_events').insert({ hospital_id: att.hospital_id, attendance_id: att.id, pathway, step })
    if (res.error) setErr(friendly(res.error)); else onChanged()
  }
  if (att.patient_id && !recordAllowed) {
    return <div style={s.overlay} onClick={onClose}><div style={s.drawer} onClick={(e) => e.stopPropagation()}><div role="alert" style={s.err}>This record is confidential. Open it again and give a reason to continue.</div></div></div>
  }
  const total = gcs({ e: sheet.gcs_e, v: sheet.gcs_v, m: sheet.gcs_m })
  return (
    <div style={s.overlay} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={name(att)} style={{ ...s.drawer, width: 760 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <h2 style={{ ...s.h2, fontSize: 18, marginBottom: 2 }}>{name(att)} <ColourChip colour={att.triage_colour} /></h2>
            <div style={s.sub}>{[att.patients?.patient_number, att.patients?.gender, att.patients?.age && `${att.patients.age} y`, att.complaint].filter(Boolean).join(' · ')} · arrived {new Date(att.arrival_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })} ({dur(mins(att.arrival_at, att.departed_at || now))} ago)</div>
            {att.patients?.allergies && <div style={{ ...s.err, margin: '6px 0 0', padding: '4px 8px' }}>Allergies: {att.patients.allergies}</div>}
          </div>
          <button type="button" style={{ ...s.btn, ...s.ghost, alignSelf: 'flex-start' }} onClick={onClose}>Close</button>
        </div>
        {err && <div role="alert" style={{ ...s.err, marginTop: 10 }}>{err}</div>}
        {msg && <div role="status" style={{ ...s.ok, marginTop: 10 }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 6, margin: '12px 0' }}>
          {[['care', 'Care'], ['trauma', 'Trauma sheet'], ['retriage', 'Re-triage']].map(([k, l]) => <button key={k} type="button" onClick={() => setSection(k)} style={{ ...s.btn, ...(section === k ? s.soft : s.ghost) }}>{l}</button>)}
        </div>

        {section === 'care' && <>
          <div style={{ ...s.card, marginBottom: 10 }}>
            <div style={{ fontSize: 13 }}>
              Vitals: {Object.entries(att.vitals || {}).filter(([, x]) => x !== '' && x !== undefined).map(([k, x]) => `${k} ${x}`).join(' · ') || '—'}
              {att.tews_score !== null && att.tews_score !== undefined ? ` · TEWS ${att.tews_score}` : ''}
            </div>
            {att.discriminators?.length > 0 && <div style={{ ...s.sub, marginTop: 4 }}>Signs: {att.discriminators.map((x) => x.split(':').slice(1).join(':')).join('; ')}</div>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 10, flexWrap: 'wrap' }}>
              {att.seen_at ? <Chip tone="green">Seen at {new Date(att.seen_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })} ({dur(mins(att.arrival_at, att.seen_at))} after arrival){att.see_by && new Date(att.seen_at) > new Date(att.see_by) ? ' — after target' : ''}</Chip> : !closed && <>
                <input aria-label="Clinician" style={{ ...s.input, maxWidth: 220 }} placeholder="Clinician seeing the patient" value={clinician} onChange={(e) => setClinician(e.target.value)} />
                <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => update({ seen_at: new Date().toISOString(), clinician: clinician || null }, 'Marked as seen.')}>Seen now</button>
              </>}
            </div>
          </div>

          {(att.pathways || []).map((p) => (
            <div key={p} style={{ ...s.card, marginBottom: 10 }}>
              <b>{PATHWAYS[p].label}</b><div style={s.sub}>{PATHWAYS[p].hint}</div>
              {pathwayStatus(p, events, att.arrival_at, now).map((st) => (
                <label key={st.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
                  <span style={{ display: 'flex', gap: 8 }}><input type="checkbox" disabled={closed} checked={st.state === 'done'} onChange={() => tick(p, st.key, st.state === 'done')} />{st.label}{st.optional ? ' (if indicated)' : ''}</span>
                  <span style={{ fontWeight: 700, color: st.state === 'done' ? (st.onTime ? C.success : C.warn) : st.state === 'overdue' ? (st.optional ? C.sub : C.danger) : C.text, whiteSpace: 'nowrap' }}>
                    {st.state === 'done' ? `${st.minutes} min${st.onTime ? '' : ' (late)'}` : st.state === 'overdue' ? `${-st.minutesLeft} min late` : `target ${st.target} min · ${st.minutesLeft} left`}
                  </span>
                </label>
              ))}
            </div>
          ))}
          {!closed && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {Object.entries(PATHWAYS).filter(([k]) => !(att.pathways || []).includes(k)).map(([k, p]) => <button key={k} type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => update({ pathways: [...(att.pathways || []), k] })}>+ {p.label}</button>)}
          </div>}

          <div style={s.card}>
            <label style={s.label} htmlFor="ed-note">Notes</label>
            <textarea id="ed-note" style={{ ...s.input, minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => update({ notes: note }, 'Notes saved.')}>Save notes</button>
              {!closed && <>
                <select aria-label="Disposition" style={{ ...s.input, maxWidth: 240 }} value={disp} onChange={(e) => setDisp(e.target.value)}>
                  <option value="">Disposition…</option>{Object.entries(DISPOSITIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!disp} onClick={() => update({ disposition: disp, notes: note }, `Recorded: ${DISPOSITIONS[disp]}.`)}>Record and close</button>
              </>}
              {closed && <Chip>{DISPOSITIONS[att.disposition]} · {new Date(att.departed_at).toLocaleString('en-KE')}</Chip>}
            </div>
            {disp === 'admitted' && <div style={{ ...s.sub, marginTop: 6 }}>After recording, admit the patient to a bed in Wards.</div>}
          </div>
        </>}

        {section === 'trauma' && (
          <div style={s.card}>
            <div style={s.grid(200)}>
              {[['mechanism', 'Mechanism of injury (e.g. RTA boda-boda, fall 3 m, assault, burn)'], ['airway', 'A — Airway (with C-spine)'], ['breathing', 'B — Breathing'], ['circulation', 'C — Circulation / bleeding'], ['disability', 'D — Disability (pupils, glucose)'], ['exposure', 'E — Exposure / temperature'], ['injuries', 'Injuries found'], ['interventions', 'Interventions done'], ['secondary', 'Secondary survey']].map(([k, l]) => (
                <div key={k}><label style={s.label} htmlFor={`ts-${k}`}>{l}</label><textarea id={`ts-${k}`} style={{ ...s.input, minHeight: 50 }} value={sheet[k] || ''} onChange={(e) => setSheet({ ...sheet, [k]: e.target.value })} /></div>
              ))}
              <div>
                <div style={s.label}>GCS {total ? `= ${total}/15` : ''}</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[['gcs_e', 'E', 4], ['gcs_v', 'V', 5], ['gcs_m', 'M', 6]].map(([k, l, max]) => <select key={k} aria-label={`GCS ${l}`} style={s.input} value={sheet[k] || ''} onChange={(e) => setSheet({ ...sheet, [k]: e.target.value })}><option value="">{l}</option>{Array.from({ length: max }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{l}{n}</option>)}</select>)}
                </div>
                {total !== null && total <= 8 && <div style={{ color: C.danger, fontSize: 12, fontWeight: 700, marginTop: 4 }}>GCS ≤ 8: protect the airway</div>}
              </div>
              <div><label style={s.label} htmlFor="ts-fast">FAST</label><select id="ts-fast" style={s.input} value={sheet.fast || ''} onChange={(e) => setSheet({ ...sheet, fast: e.target.value })}><option value="">Not done</option><option>Negative</option><option>Positive</option><option>Equivocal</option></select></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => update({ trauma_sheet: { ...sheet, gcs_total: total } }, 'Trauma sheet saved.')}>Save trauma sheet</button></div>
          </div>
        )}

        {section === 'retriage' && (closed ? <div style={s.sub}>Closed attendances cannot be re-triaged.</div> : <TriageForm hospitalId={att.hospital_id} att={att} onSaved={() => { setMsg('Re-triaged.'); setSection('care'); onChanged() }} />)}
      </div>
    </div>
  )
}

function Stats({ hospitalId }) {
  const today = new Date().toISOString().slice(0, 10)
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: today })
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    void supabase.rpc('ed_stats', { p_hospital: hospitalId, p_from: range.from, p_to: range.to }).then(({ data, error }) => { if (error) setErr(friendly(error)); else { setErr(''); setD(data) } })
  }, [hospitalId, range])
  const tile = (l, v, warn) => <div style={{ border: `1px solid ${warn ? C.danger : C.border}`, borderRadius: 10, padding: 12, background: '#fff' }}><div style={s.sub}>{l}</div><div style={{ fontSize: 22, fontWeight: 800, color: warn ? C.danger : undefined }}>{v ?? '—'}</div></div>
  const round = (x) => (x === null || x === undefined ? null : Math.round(Number(x)))
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input aria-label="From" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <input aria-label="To" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {d && <>
        <div style={s.grid(160)}>
          {tile('Attendances', d.attendances)}
          {tile('Door to triage (median)', d.door_to_triage_min === null ? null : `${round(d.door_to_triage_min)} min`, d.door_to_triage_min > 15)}
          {tile('Seen within target', d.seen_within_target_pct === null ? null : `${d.seen_within_target_pct}%`, d.seen_within_target_pct !== null && d.seen_within_target_pct < 80)}
          {tile('Length of stay (median)', d.length_of_stay_min === null ? null : dur(round(d.length_of_stay_min)), d.length_of_stay_min > 240)}
          {tile('Left without being seen', d.lwbs_pct === null ? null : `${d.lwbs_pct}%`, d.lwbs_pct > 5)}
          {tile('Admitted', d.admitted_pct === null ? null : `${d.admitted_pct}%`)}
          {tile('Deaths in the department', d.deaths)}
        </div>
        <div style={{ ...s.grid(260), marginTop: 12 }}>
          <div><div style={s.label}>By colour</div>{Object.entries(d.by_colour || {}).map(([c, n]) => <div key={c} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}><span><ColourChip colour={c === 'untriaged' ? null : c} /></span><b>{n}</b><span style={s.sub}>door-to-doctor {d.door_to_seen_min?.[c] ?? '—'} min (target {COLOURS[c]?.target ?? '—'})</span></div>)}</div>
          <div><div style={s.label}>Pathway steps (median minutes from arrival)</div>{Object.entries(d.pathway_steps || {}).map(([k, m]) => {
            const [p, st] = k.split(':'); const step = PATHWAYS[p]?.steps.find((x) => x.key === st)
            return <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}><span>{PATHWAYS[p]?.label.split(' (')[0]}: {step?.label || st}</span><b style={{ color: step && m > step.target ? C.danger : C.success }}>{m} / {step?.target ?? '—'}</b></div>
          })}{!Object.keys(d.pathway_steps || {}).length && <div style={s.sub}>No pathway steps recorded yet.</div>}</div>
        </div>
      </>}
    </div>
  )
}
