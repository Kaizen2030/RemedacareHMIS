// Critical results loop (report with read-back → clinician acknowledges with action → escalation when overdue),
// drug–lab advisory alerts, and therapeutic drug monitoring. Rules: 20261222000000_critical_results.sql.
import { useCallback, useEffect, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import PatientSearch from '../components/PatientSearch'
import { localDateKey } from '../utils/scheduling'
import { TDM_TONE, tdmClassify, toTargetUnit } from '../utils/tdm'
import { C, Chip, s } from './ncd/ui'

const TABS = [['board', 'Critical results'], ['tdm', 'Drug levels (TDM)'], ['report', 'Report']]
const KIND = { critical: ['Critical', 'red'], interaction: ['Drug–lab', 'yellow'], tdm: ['Toxic level', 'red'] }
const mins = (from, to = Date.now()) => Math.round((new Date(to) - new Date(from)) / 60000)
const notInstalled = (e) => /does not exist|schema cache|Could not find/i.test(e?.message || '')

function Field({ label, id, children }) {
  return <div><label style={s.label} htmlFor={id}>{label}</label>{children}</div>
}

function AlertCard({ a, onDone }) {
  const [mode, setMode] = useState(null)
  const [f, setF] = useState({ to: '', method: 'phone', readBack: false, action: '' })
  const [err, setErr] = useState('')
  const overdue = a.status !== 'acknowledged' && ((a.status === 'open' && a.notify_due_at && new Date(a.notify_due_at) < new Date()) || (a.status === 'notified' && a.ack_due_at && new Date(a.ack_due_at) < new Date()))
  const [kl, kt] = KIND[a.kind] || [a.kind, 'gray']
  const run = async (fn, args) => {
    setErr('')
    const { error } = await supabase.rpc(fn, args)
    if (error) { setErr(error.message); return }
    setMode(null); onDone()
  }
  return (
    <div style={{ ...s.card, borderColor: overdue ? C.danger : a.kind === 'interaction' ? '#FEC84B' : '#FDA29B', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip tone={kt}>{kl}</Chip><strong>{a.patient_name || 'Patient'}</strong>
            <span style={s.sub}>{a.test_name}{a.ordered_by ? ` · ordered by ${a.ordered_by}` : ''}</span>
            {a.escalation_level > 0 && <Chip tone="red">Escalated ×{a.escalation_level}</Chip>}
            {overdue && <Chip tone="red">Overdue</Chip>}
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, marginTop: 6, color: a.kind === 'interaction' ? '#B54708' : C.danger }}>{a.message}</div>
          {(a.drug_notes || []).map((n) => <div key={n.drug + n.message} style={{ fontSize: 12, marginTop: 3 }}>💊 <strong>{n.drug}</strong>: {n.message}</div>)}
          <div style={{ ...s.sub, marginTop: 6 }}>
            Detected {mins(a.detected_at)} min ago
            {a.notified_at ? ` · reported to ${a.notified_to} (${a.notify_method}${a.read_back ? ', read back' : ''}) after ${mins(a.detected_at, a.notified_at)} min` : a.kind !== 'interaction' ? ` · report by ${new Date(a.notify_due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            {a.acknowledged_at ? ` · acknowledged after ${mins(a.detected_at, a.acknowledged_at)} min: ${a.action_taken}` : ''}
          </div>
        </div>
        {a.status !== 'acknowledged' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            {a.status === 'open' && a.kind !== 'interaction' && <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => setMode('notify')}>Record report</button>}
            <button type="button" style={{ ...s.btn, ...(a.status === 'notified' || a.kind === 'interaction' ? s.pri : s.ghost) }} onClick={() => setMode('ack')}>Acknowledge</button>
          </div>
        )}
      </div>
      {err && <div role="alert" style={{ ...s.err, marginTop: 8 }}>{err}</div>}
      {mode === 'notify' && (
        <div style={{ ...s.grid(170), marginTop: 10, alignItems: 'end' }}>
          <Field label="Told (name and ward)" id={`to-${a.id}`}><input id={`to-${a.id}`} style={s.input} value={f.to} onChange={(e) => setF((x) => ({ ...x, to: e.target.value }))} /></Field>
          <Field label="How" id={`m-${a.id}`}><select id={`m-${a.id}`} style={s.input} value={f.method} onChange={(e) => setF((x) => ({ ...x, method: e.target.value }))}><option value="phone">Phone</option><option value="in_person">In person</option><option value="system">In the system only</option></select></Field>
          {f.method !== 'system' && <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={f.readBack} onChange={(e) => setF((x) => ({ ...x, readBack: e.target.checked }))} />They read the result back to me</label>}
          <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!f.to.trim() || (f.method !== 'system' && !f.readBack)} onClick={() => run('critical_notify', { p_alert: a.id, p_notified_to: f.to, p_method: f.method, p_read_back: f.readBack })}>Save report</button>
        </div>
      )}
      {mode === 'ack' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 10 }}>
          <input aria-label="Action taken" style={s.input} placeholder="Action taken: e.g. repeat sample sent, treatment given, dose held, reviewed — no change" value={f.action} onChange={(e) => setF((x) => ({ ...x, action: e.target.value }))} />
          <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!f.action.trim()} onClick={() => run('critical_acknowledge', { p_alert: a.id, p_action: f.action })}>Acknowledge</button>
        </div>
      )}
    </div>
  )
}

function Board({ hospitalId }) {
  const [rows, setRows] = useState([])
  const [showDone, setShowDone] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    await supabase.rpc('critical_escalate', { p_hospital: hospitalId })
    let q = supabase.from('lab_critical_alerts').select('*').eq('hospital_id', hospitalId)
    q = showDone ? q.gte('detected_at', new Date(Date.now() - 2 * 86400000).toISOString()) : q.neq('status', 'acknowledged')
    const { data, error } = await q.order('detected_at', { ascending: false }).limit(200)
    if (error) setErr(notInstalled(error) ? 'Run docs/sql/40_critical_results.sql to switch on the critical results loop.' : error.message)
    setRows(data || [])
  }, [hospitalId, showDone])
  useEffect(() => {
    if (!hospitalId) return undefined
    void load()
    const t = setInterval(() => void load(), 60000)
    return () => clearInterval(t)
  }, [hospitalId, load])
  const critical = rows.filter((r) => r.kind !== 'interaction'), advisory = rows.filter((r) => r.kind === 'interaction')
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div style={s.sub}>Critical values must be reported to the clinician with read-back, and acknowledged with the action taken. Overdue alerts escalate automatically.</div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Include acknowledged (48 h)</label>
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <h3 style={s.h2}>Critical ({critical.filter((r) => r.status !== 'acknowledged').length} open)</h3>
      {critical.length === 0 ? <div style={{ ...s.card, ...s.sub, marginBottom: 12 }}>No critical results waiting.</div> : critical.map((a) => <AlertCard key={a.id} a={a} onDone={load} />)}
      <h3 style={{ ...s.h2, marginTop: 16 }}>Drug–lab advisories ({advisory.filter((r) => r.status !== 'acknowledged').length} open)</h3>
      {advisory.length === 0 ? <div style={{ ...s.card, ...s.sub }}>None.</div> : advisory.map((a) => <AlertCard key={a.id} a={a} onDone={load} />)}
    </div>
  )
}

function Tdm({ hospitalId }) {
  const [targets, setTargets] = useState([])
  const [levels, setLevels] = useState([])
  const [f, setF] = useState({ patient: null, drug: '', sample: 'trough', indication: '', value: '', unit: '', last: '', next: '', at: '', weight: '' })
  const [saved, setSaved] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const [t, l] = await Promise.all([
      supabase.from('tdm_targets').select('*').eq('active', true).order('drug'),
      supabase.from('tdm_levels').select('*, patients(full_name)').eq('hospital_id', hospitalId).order('sample_at', { ascending: false }).limit(100),
    ])
    if (t.error && notInstalled(t.error)) setErr('Run docs/sql/40_critical_results.sql to switch on TDM.')
    setTargets(t.data || []); setLevels(l.data || [])
  }, [hospitalId])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])
  const drugs = [...new Set(targets.map((t) => t.drug))]
  const options = targets.filter((t) => t.drug === f.drug)
  const target = options.find((t) => t.sample === f.sample && (!f.indication || t.indication === f.indication)) || options.find((t) => t.sample === f.sample)
  const converted = target && f.value !== '' ? toTargetUnit(Number(f.value), f.unit || target.unit, target) : null
  const preview = target && converted != null ? tdmClassify(converted, target.low == null ? null : Number(target.low), target.high == null ? null : Number(target.high), target.high_exclusive, target.critical_high == null ? null : Number(target.critical_high)) : null
  const iso = (v) => (v ? new Date(v).toISOString() : null)
  const save = async () => {
    setErr(''); setSaved(null)
    if (!f.patient) { setErr('Pick the patient'); return }
    const { data, error } = await supabase.from('tdm_levels').insert({ hospital_id: hospitalId, patient_id: f.patient.id, drug: f.drug, sample: f.sample, indication: target?.indication || 'general',
      value: Number(f.value), unit: f.unit || target?.unit || 'mg/L', last_dose_at: iso(f.last), next_dose_at: iso(f.next), sample_at: iso(f.at) || new Date().toISOString(),
      weight_kg: f.weight ? Number(f.weight) : null }).select('*').single()
    if (error) { setErr(error.message); return }
    setSaved(data); void load()
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={s.card}>
        <h3 style={s.h2}>Record a drug level</h3>
        <Field label="Patient" id="tdm-p"><PatientSearch id="tdm-p" hospitalId={hospitalId} inputStyle={s.input} value={f.patient} onPick={(p) => setF((x) => ({ ...x, patient: p }))} /></Field>
        <div style={{ ...s.grid(150), marginTop: 10, alignItems: 'end' }}>
          <Field label="Drug" id="tdm-d"><select id="tdm-d" style={s.input} value={f.drug} onChange={(e) => { const t = targets.find((x) => x.drug === e.target.value); setF((x) => ({ ...x, drug: e.target.value, sample: t?.sample || 'trough', indication: '', unit: t?.unit || '' })) }}><option value="">—</option>{drugs.map((d) => <option key={d}>{d}</option>)}</select></Field>
          <Field label="Sample" id="tdm-s"><select id="tdm-s" style={s.input} value={f.sample} onChange={(e) => setF((x) => ({ ...x, sample: e.target.value }))}>{[...new Set(options.map((o) => o.sample))].map((v) => <option key={v} value={v}>{v}</option>)}</select></Field>
          {options.filter((o) => o.sample === f.sample).length > 1 && <Field label="Indication" id="tdm-i"><select id="tdm-i" style={s.input} value={f.indication} onChange={(e) => setF((x) => ({ ...x, indication: e.target.value }))}>{options.filter((o) => o.sample === f.sample).map((o) => <option key={o.indication} value={o.indication}>{o.indication}</option>)}</select></Field>}
          <Field label="Result" id="tdm-v"><input id="tdm-v" type="number" step="any" min={0} style={s.input} value={f.value} onChange={(e) => setF((x) => ({ ...x, value: e.target.value }))} /></Field>
          <Field label="Unit" id="tdm-u"><select id="tdm-u" style={s.input} value={f.unit} onChange={(e) => setF((x) => ({ ...x, unit: e.target.value }))}>{target ? [target.unit, target.si_unit].filter(Boolean).map((u) => <option key={u}>{u}</option>) : <option value="">—</option>}</select></Field>
          <Field label="Last dose given" id="tdm-ld"><input id="tdm-ld" type="datetime-local" style={s.input} value={f.last} onChange={(e) => setF((x) => ({ ...x, last: e.target.value }))} /></Field>
          {f.sample === 'trough' && <Field label="Next dose due" id="tdm-nd"><input id="tdm-nd" type="datetime-local" style={s.input} value={f.next} onChange={(e) => setF((x) => ({ ...x, next: e.target.value }))} /></Field>}
          <Field label="Sample taken" id="tdm-at"><input id="tdm-at" type="datetime-local" style={s.input} value={f.at} onChange={(e) => setF((x) => ({ ...x, at: e.target.value }))} /></Field>
          <Field label="Weight (kg, for CrCl)" id="tdm-w"><input id="tdm-w" type="number" min={1} style={s.input} value={f.weight} onChange={(e) => setF((x) => ({ ...x, weight: e.target.value }))} /></Field>
        </div>
        {target && <div style={{ ...s.sub, marginTop: 8 }}>Target: {target.low == null ? `< ${target.high}` : `${target.low}–${target.high}`} {target.unit}{target.note ? ` · ${target.note}` : ''}</div>}
        {preview && <div style={{ marginTop: 6 }}><Chip tone={TDM_TONE[preview]}>{preview}{converted !== Number(f.value) ? ` (${converted} ${target.unit})` : ''}</Chip></div>}
        <button type="button" style={{ ...s.btn, ...s.pri, marginTop: 10 }} disabled={!f.drug || f.value === ''} onClick={save}>Save level</button>
        {saved && (
          <div role="status" style={{ ...s.card, marginTop: 10, borderColor: saved.interpretation === 'toxic' ? C.danger : C.border }}>
            <Chip tone={TDM_TONE[saved.interpretation]}>{saved.interpretation}</Chip> <strong>{saved.advice}</strong>
            {(saved.warnings || []).map((w) => <div key={w} style={{ ...s.sub, color: '#B54708', marginTop: 4 }}>⚠ {w}</div>)}
            <div style={{ ...s.sub, marginTop: 4 }}>{saved.target_text}{saved.creatinine_umol ? ` · creatinine ${saved.creatinine_umol} µmol/L, eGFR ${saved.egfr ?? '—'}, CrCl ${saved.crcl ?? '— (add weight)'} mL/min` : ''}</div>
            {saved.interpretation === 'toxic' && <div style={{ ...s.sub, color: C.danger, marginTop: 4 }}>A critical alert was raised for the clinician to acknowledge.</div>}
          </div>
        )}
        <div style={{ ...s.sub, marginTop: 8 }}>Ranges are common adult targets from standard references; confirm with your laboratory and pharmacist. The system interprets levels — it does not calculate doses.</div>
      </div>
      <div style={{ ...s.card, overflowX: 'auto' }}>
        <h3 style={s.h2}>Recent levels</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['Taken', 'Patient', 'Drug', 'Level', 'Result', 'Advice'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{levels.map((l) => (
            <tr key={l.id}><td style={s.td}>{new Date(l.sample_at).toLocaleString()}</td><td style={s.td}>{l.patients?.full_name}</td><td style={s.td}>{l.drug} <span style={s.sub}>{l.sample}</span></td>
              <td style={s.td}>{l.value} {l.unit}</td><td style={s.td}><Chip tone={TDM_TONE[l.interpretation]}>{l.interpretation}</Chip></td>
              <td style={s.td}>{l.advice}{(l.warnings || []).length > 0 && <div style={{ color: '#B54708' }}>⚠ {l.warnings.join('; ')}</div>}</td></tr>
          ))}</tbody>
        </table>
        {levels.length === 0 && <div style={{ ...s.sub, padding: 12, textAlign: 'center' }}>No levels recorded.</div>}
      </div>
    </div>
  )
}

function Report({ hospitalId }) {
  const [from, setFrom] = useState(`${localDateKey().slice(0, 8)}01`)
  const [to, setTo] = useState(localDateKey())
  const [r, setR] = useState(null)
  useEffect(() => {
    if (!hospitalId) return
    supabase.rpc('critical_stats', { p_hospital: hospitalId, p_from: from, p_to: to }).then(({ data }) => setR(data))
  }, [hospitalId, from, to])
  const tile = (label, value, good) => (
    <div style={s.card}><div style={s.label}>{label}</div><div style={{ fontSize: 22, fontWeight: 800, color: good == null ? C.text : good ? C.success : C.danger }}>{value ?? '—'}</div></div>
  )
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...s.card, display: 'flex', gap: 10, alignItems: 'end' }}>
        <Field label="From" id="cr-from"><input id="cr-from" type="date" style={s.input} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To" id="cr-to"><input id="cr-to" type="date" style={s.input} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {r && (
        <div style={s.grid(180)}>
          {tile('Critical results', r.critical)}
          {tile('Still open', r.open, r.open === 0)}
          {tile('Read-back documented', r.read_back_pct != null ? `${r.read_back_pct}%` : null, r.read_back_pct == null ? null : r.read_back_pct >= 95)}
          {tile('Reported on time', r.notified_on_time_pct != null ? `${r.notified_on_time_pct}%` : null, r.notified_on_time_pct == null ? null : r.notified_on_time_pct >= 90)}
          {tile('Acknowledged on time', r.acknowledged_on_time_pct != null ? `${r.acknowledged_on_time_pct}%` : null, r.acknowledged_on_time_pct == null ? null : r.acknowledged_on_time_pct >= 90)}
          {tile('Median minutes to report', r.median_minutes_to_notify)}
          {tile('Median minutes to acknowledge', r.median_minutes_to_acknowledge)}
          {tile('Escalated', r.escalated, r.escalated === 0)}
        </div>
      )}
    </div>
  )
}

export default function CriticalResults() {
  const { hospitalId } = useHospital()
  const [tab, setTab] = useState('board')
  return (
    <section style={s.page}>
      <header style={{ marginBottom: 14 }}>
        <h1 style={s.h1}>Critical results &amp; drug levels</h1>
        <p style={{ ...s.sub, margin: '5px 0 0' }}>Report with read-back, acknowledge with the action taken, escalate when overdue; drug–lab advisories; therapeutic drug monitoring. <a href="#/references?topic=laboratory" style={{ color: C.primary, fontWeight: 700 }}>Sources</a></p>
      </header>
      <nav role="tablist" style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 14 }}>
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} style={{ padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700, color: tab === k ? C.primary : C.sub, borderBottom: `2px solid ${tab === k ? C.primary : 'transparent'}` }}>{l}</button>)}
      </nav>
      {tab === 'board' && <Board hospitalId={hospitalId} />}
      {tab === 'tdm' && <Tdm hospitalId={hospitalId} />}
      {tab === 'report' && <Report hospitalId={hospitalId} />}
    </section>
  )
}
