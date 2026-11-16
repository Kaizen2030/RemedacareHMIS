// Ward bed panel → Observations: NEWS2 (adults) / PEWS (children) chart with escalation, Braden and Morse risk
// assessments, nursing care plans and the 24-hour intake–output chart. Scores are computed by the database
// (20261205000000_ward_nursing.sql); the preview here uses the same rules (utils/wardScores.js).
// Also exports WardEarlyWarnings: the deteriorating / overdue list for the ward page.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { BRADEN, CARE_PLAN_TEMPLATES, LEVEL_STYLE, MORSE, PEWS_DOMAINS, bradenTotal, ewsResponse, fluidChart, morseTotal, news2, pews } from '../../utils/wardScores'

const C = { border: '#E6ECE8', sub: '#667085', danger: '#B42318', dangerL: '#FEF3F2', ok: '#067647', okL: '#ECFDF3', brand: '#0F6E56' }
const friendly = (e) => (/does not exist|schema cache|Could not find/i.test(e?.message || '') ? 'Not installed yet. Run docs/sql/23_ward_nursing.sql in Supabase.' : e?.message || String(e))
const hm = (v) => (v ? new Date(v).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
function Level({ level, score }) {
  const st = LEVEL_STYLE[level] || LEVEL_STYLE.routine
  return <span style={{ background: st.bg, color: st.fg, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>{score !== undefined ? `${score} · ` : ''}{st.label}</span>
}
const isChild = (patient) => {
  const age = Number(patient?.age)
  if (Number.isFinite(age) && patient?.age !== null && patient?.age !== '') return age < 16
  if (patient?.dob) return (Date.now() - new Date(patient.dob)) / (365.25 * 86400000) < 16
  return false
}

export default function WardObservations({ hospitalId, patient, visitId, bedId, fluidEntries = [], styles }) {
  const [section, setSection] = useState('obs')
  const st = styles || {}
  const tabBtn = (k, l) => <button key={k} type="button" onClick={() => setSection(k)} style={{ ...(section === k ? st.btn : st.pageBtn), padding: '6px 10px' }}>{l}</button>
  if (!patient?.id) return <div style={{ color: C.sub, fontSize: 12 }}>Admit a patient to this bed to chart observations.</div>
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tabBtn('obs', 'Early warning')}{tabBtn('risk', 'Risk assessments')}{tabBtn('plans', 'Care plans')}{tabBtn('fluids', 'Intake / output')}
      </div>
      {section === 'obs' && <ObservationChart hospitalId={hospitalId} patient={patient} visitId={visitId} bedId={bedId} st={st} />}
      {section === 'risk' && <RiskAssessments hospitalId={hospitalId} patient={patient} visitId={visitId} st={st} />}
      {section === 'plans' && <CarePlans hospitalId={hospitalId} patient={patient} visitId={visitId} st={st} />}
      {section === 'fluids' && <FluidChart entries={fluidEntries} patient={patient} />}
    </div>
  )
}

function ObservationChart({ hospitalId, patient, visitId, bedId, st }) {
  const [scale, setScale] = useState(isChild(patient) ? 'pews' : 'news2')
  const [obs, setObs] = useState({ consciousness: 'A', spo2_scale: '1' })
  const [rows, setRows] = useState([])
  const [esc, setEsc] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('ward_observations').select('*').eq('hospital_id', hospitalId).eq('patient_id', patient.id).order('observed_at', { ascending: false }).limit(30)
    if (error) setErr(friendly(error)); else setErr('')
    setRows(data || [])
  }, [hospitalId, patient.id])
  useEffect(() => { void load() }, [load])

  const preview = scale === 'news2' ? news2(obs) : pews(obs)
  const resp = ewsResponse(scale, preview.score, preview.anyThree)
  const set = (k, v) => setObs((o) => ({ ...o, [k]: v }))
  async function save() {
    setErr('')
    if (preview.missing.length) { setErr(`Record every parameter (missing: ${preview.missing.join(', ')}).`); return }
    setBusy(true)
    const { error } = await supabase.from('ward_observations').insert({ hospital_id: hospitalId, patient_id: patient.id, visit_id: visitId || null, bed_id: bedId || null, scale, obs })
    setBusy(false)
    if (error) setErr(friendly(error)); else { setObs({ consciousness: 'A', spo2_scale: obs.spo2_scale }); void load() }
  }
  async function escalate(r) {
    const e = esc[r.id] || {}
    if (!e.to?.trim()) { setErr('Name who was informed.'); return }
    const { error } = await supabase.from('ward_observations').update({ escalated_to: e.to.trim(), reviewed_at: e.reviewed ? new Date().toISOString() : null, review_note: e.note || null }).eq('id', r.id)
    if (error) setErr(friendly(error)); else void load()
  }
  const last = rows[0]
  const overdue = last && new Date(last.next_due_at) < new Date()
  const input = (k, l, extra = {}) => <label key={k} style={st.formGroup}><span style={st.label}>{l}</span><input style={st.input} inputMode="decimal" value={obs[k] ?? ''} onChange={(e) => set(k, e.target.value)} {...extra} /></label>
  const pending = rows.filter((r) => ['medium', 'high', 'low_medium'].includes(r.level) && !r.escalated_to)

  return (
    <section style={{ display: 'grid', gap: 10 }}>
      {err && <div role="alert" style={{ background: C.dangerL, color: C.danger, padding: 8, borderRadius: 8, fontSize: 12 }}>{err}</div>}
      {last && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
        <span>Last: <Level level={last.level} score={last.score} /> {hm(last.observed_at)}</span>
        <span style={{ color: overdue ? C.danger : C.sub, fontWeight: overdue ? 800 : 400 }}>Next set due {hm(last.next_due_at)}{overdue ? ' — OVERDUE' : ''}</span>
      </div>}
      {pending.map((r) => (
        <div key={r.id} style={{ border: `1px solid ${C.danger}`, borderRadius: 8, padding: 8, fontSize: 12 }}>
          <b style={{ color: C.danger }}>Escalation needed</b> — {r.scale.toUpperCase()} {r.score} at {hm(r.observed_at)}: {r.response}
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <input aria-label="Informed" style={{ ...st.input, maxWidth: 180 }} placeholder="Doctor / nurse informed" value={esc[r.id]?.to || ''} onChange={(e) => setEsc({ ...esc, [r.id]: { ...esc[r.id], to: e.target.value } })} />
            <input aria-label="Action" style={{ ...st.input, maxWidth: 220 }} placeholder="Action taken" value={esc[r.id]?.note || ''} onChange={(e) => setEsc({ ...esc, [r.id]: { ...esc[r.id], note: e.target.value } })} />
            <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={Boolean(esc[r.id]?.reviewed)} onChange={(e) => setEsc({ ...esc, [r.id]: { ...esc[r.id], reviewed: e.target.checked } })} />Patient reviewed</label>
            <button type="button" style={st.btn} onClick={() => escalate(r)}>Record escalation</button>
          </div>
        </div>
      ))}

      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <div style={st.sideSectionLabel}>New observations</div>
          <select aria-label="Scale" style={{ ...st.input, maxWidth: 180 }} value={scale} onChange={(e) => { setScale(e.target.value); setObs({ consciousness: 'A', spo2_scale: '1' }) }}><option value="news2">NEWS2 (adult)</option><option value="pews">PEWS (child)</option></select>
        </div>
        {scale === 'news2' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
            {input('rr', 'Resp. rate /min')}{input('spo2', 'SpO₂ %')}
            <label style={st.formGroup}><span style={st.label}>SpO₂ scale</span><select style={st.input} value={obs.spo2_scale} onChange={(e) => set('spo2_scale', e.target.value)}><option value="1">Scale 1</option><option value="2">Scale 2 (target 88–92%, hypercapnic)</option></select></label>
            <label style={st.formGroup}><span style={st.label}>Air or oxygen</span><select style={st.input} value={obs.oxygen ? 'yes' : 'no'} onChange={(e) => set('oxygen', e.target.value === 'yes')}><option value="no">Air</option><option value="yes">Oxygen</option></select></label>
            {input('sbp', 'Systolic BP')}{input('hr', 'Pulse /min')}
            <label style={st.formGroup}><span style={st.label}>Consciousness</span><select style={st.input} value={obs.consciousness} onChange={(e) => set('consciousness', e.target.value)}><option value="A">Alert</option><option value="C">New confusion</option><option value="V">Voice</option><option value="P">Pain</option><option value="U">Unresponsive</option></select></label>
            {input('temp', 'Temp °C')}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {Object.entries(PEWS_DOMAINS).map(([k, opts]) => <label key={k} style={st.formGroup}><span style={st.label}>{k[0].toUpperCase() + k.slice(1)}</span><select style={st.input} value={obs[k] ?? ''} onChange={(e) => set(k, e.target.value)}><option value="">—</option>{opts.map((o, i) => <option key={i} value={i}>{o}</option>)}</select></label>)}
            <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
              <label style={{ display: 'flex', gap: 4 }}><input type="checkbox" checked={Boolean(obs.nebs)} onChange={(e) => set('nebs', e.target.checked)} />Quarter-hourly nebulisers (+2)</label>
              <label style={{ display: 'flex', gap: 4 }}><input type="checkbox" checked={Boolean(obs.vomiting)} onChange={(e) => set('vomiting', e.target.checked)} />Persistent vomiting after surgery (+2)</label>
            </div>
            <div style={{ fontSize: 11, color: C.sub }}>Also record the child's heart rate, breathing rate, SpO₂ and temperature in Vitals; PEWS uses them against the normal range for age.</div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12 }}><Level level={resp.level} score={preview.score} /> {resp.response}</span>
          <button type="button" style={st.btn} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save observations'}</button>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr>{['Time', 'Score', 'RR', 'SpO₂', 'O₂', 'BP', 'HR', 'ACVPU', 'Temp', 'Escalated'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 4, borderBottom: `1px solid ${C.border}`, color: C.sub }}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => {
            const o = r.obs || {}
            return (
              <tr key={r.id}>
                <td style={{ padding: 4 }}>{hm(r.observed_at)}</td>
                <td style={{ padding: 4 }}><Level level={r.level} score={r.score} /></td>
                {r.scale === 'pews'
                  ? <td colSpan={7} style={{ padding: 4 }}>PEWS — behaviour {o.behaviour}, cardiovascular {o.cardiovascular}, respiratory {o.respiratory}{o.nebs ? ', nebs' : ''}{o.vomiting ? ', vomiting' : ''}</td>
                  : <><td style={{ padding: 4 }}>{o.rr}</td><td style={{ padding: 4 }}>{o.spo2}{o.spo2_scale === '2' ? ' (S2)' : ''}</td><td style={{ padding: 4 }}>{o.oxygen ? 'O₂' : 'Air'}</td><td style={{ padding: 4 }}>{o.sbp}</td><td style={{ padding: 4 }}>{o.hr}</td><td style={{ padding: 4 }}>{o.consciousness}</td><td style={{ padding: 4 }}>{o.temp}</td></>}
                <td style={{ padding: 4 }}>{r.escalated_to ? `${r.escalated_to}${r.reviewed_at ? ' ✓ reviewed' : ''}` : ['routine', 'low'].includes(r.level) ? '—' : <b style={{ color: C.danger }}>No</b>}</td>
              </tr>
            )
          })}</tbody>
        </table>
        {!rows.length && !err && <div style={{ color: C.sub, fontSize: 12 }}>No observations charted yet.</div>}
      </div>
    </section>
  )
}

function RiskAssessments({ hospitalId, patient, visitId, st }) {
  const [rows, setRows] = useState([])
  const [kind, setKind] = useState('braden')
  const [a, setA] = useState({})
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('ward_risk_assessments').select('*').eq('hospital_id', hospitalId).eq('patient_id', patient.id).order('assessed_at', { ascending: false }).limit(20)
    if (error) setErr(friendly(error)); setRows(data || [])
  }, [hospitalId, patient.id])
  useEffect(() => { void load() }, [load])
  const total = kind === 'braden' ? bradenTotal(a) : morseTotal(a)
  async function save() {
    setErr('')
    if (kind === 'braden' && total === null) { setErr('Answer all six Braden items.'); return }
    const { error } = await supabase.from('ward_risk_assessments').insert({ hospital_id: hospitalId, patient_id: patient.id, visit_id: visitId || null, kind, answers: a, total: total || 0, risk: '-' })
    if (error) setErr(friendly(error)); else { setA({}); void load() }
  }
  const latest = (k) => rows.find((r) => r.kind === k)
  return (
    <section style={{ display: 'grid', gap: 10 }}>
      {err && <div role="alert" style={{ background: C.dangerL, color: C.danger, padding: 8, borderRadius: 8, fontSize: 12 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 12, fontSize: 12, flexWrap: 'wrap' }}>
        {['braden', 'morse'].map((k) => { const r = latest(k); return <span key={k}><b>{k === 'braden' ? 'Pressure injury (Braden)' : 'Falls (Morse)'}:</b> {r ? `${r.total} — ${r.risk} risk (${hm(r.assessed_at)})` : 'not assessed'}</span> })}
      </div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
        <select aria-label="Assessment" style={{ ...st.input, maxWidth: 240, marginBottom: 8 }} value={kind} onChange={(e) => { setKind(e.target.value); setA({}) }}><option value="braden">Braden — pressure injury</option><option value="morse">Morse — falls</option></select>
        <div style={{ display: 'grid', gap: 6 }}>
          {kind === 'braden'
            ? BRADEN.map((q) => <label key={q.key} style={st.formGroup}><span style={st.label}>{q.label}</span><select style={st.input} value={a[q.key] ?? ''} onChange={(e) => setA({ ...a, [q.key]: e.target.value })}><option value="">—</option>{q.options.map((o, i) => <option key={i} value={i + 1}>{o}</option>)}</select></label>)
            : MORSE.map((q) => <label key={q.key} style={st.formGroup}><span style={st.label}>{q.label}</span><select style={st.input} value={a[q.key] ?? '0'} onChange={(e) => setA({ ...a, [q.key]: e.target.value })}>{q.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 12 }}>
          <b>{total === null ? 'Answer every item' : `Total ${total}`}{kind === 'braden' && total !== null ? (total <= 12 ? ' — high risk: pressure-relieving mattress, 2-hourly turns' : total <= 18 ? ' — at risk' : ' — no risk') : ''}{kind === 'morse' ? (total >= 45 ? ' — high falls risk' : total >= 25 ? ' — moderate' : ' — low') : ''}</b>
          <button type="button" style={st.btn} onClick={save}>Save assessment</button>
        </div>
      </div>
    </section>
  )
}

function CarePlans({ hospitalId, patient, visitId, st }) {
  const [rows, setRows] = useState([])
  const [draft, setDraft] = useState(null)
  const [evals, setEvals] = useState({})
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('ward_care_plans').select('*').eq('hospital_id', hospitalId).eq('patient_id', patient.id).order('created_at', { ascending: false }).limit(50)
    if (error) setErr(friendly(error)); setRows(data || [])
  }, [hospitalId, patient.id])
  useEffect(() => { void load() }, [load])
  async function save() {
    setErr('')
    if (!draft.problem.trim() || !draft.goal.trim()) { setErr('Problem and goal are required.'); return }
    const { error } = await supabase.from('ward_care_plans').insert({ hospital_id: hospitalId, patient_id: patient.id, visit_id: visitId || null, problem: draft.problem.trim(), goal: draft.goal.trim(), interventions: draft.interventions.split('\n').map((x) => x.trim()).filter(Boolean), review_by: draft.review_by || null })
    if (error) setErr(friendly(error)); else { setDraft(null); void load() }
  }
  async function evaluate(p, close) {
    const e = evals[p.id] || {}
    if (!e.note?.trim() && !close) { setErr('Write the evaluation.'); return }
    const entry = { at: new Date().toISOString(), progress: e.progress || 'no change', note: e.note || (close ? `Plan ${close}` : '') }
    const { error } = await supabase.from('ward_care_plans').update({ evaluations: [...(p.evaluations || []), entry], ...(close ? { status: close } : {}) }).eq('id', p.id)
    if (error) setErr(friendly(error)); else { setEvals({ ...evals, [p.id]: {} }); void load() }
  }
  const active = rows.filter((r) => r.status === 'active')
  return (
    <section style={{ display: 'grid', gap: 10 }}>
      {err && <div role="alert" style={{ background: C.dangerL, color: C.danger, padding: 8, borderRadius: 8, fontSize: 12 }}>{err}</div>}
      {!draft && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select aria-label="Care plan template" style={{ ...st.input, maxWidth: 300 }} value="" onChange={(e) => { const t = CARE_PLAN_TEMPLATES[Number(e.target.value)]; if (t) setDraft({ problem: t.problem, goal: t.goal, interventions: t.interventions.join('\n'), review_by: '' }) }}>
          <option value="">+ Care plan from a template…</option>{CARE_PLAN_TEMPLATES.map((t, i) => <option key={i} value={i}>{t.problem}</option>)}
        </select>
        <button type="button" style={st.pageBtn} onClick={() => setDraft({ problem: '', goal: '', interventions: '', review_by: '' })}>Blank care plan</button>
      </div>}
      {draft && <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, display: 'grid', gap: 6 }}>
        <label style={st.formGroup}><span style={st.label}>Problem / nursing diagnosis</span><input style={st.input} value={draft.problem} onChange={(e) => setDraft({ ...draft, problem: e.target.value })} /></label>
        <label style={st.formGroup}><span style={st.label}>Goal</span><input style={st.input} value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} /></label>
        <label style={st.formGroup}><span style={st.label}>Interventions (one per line)</span><textarea style={{ ...st.input, minHeight: 100 }} value={draft.interventions} onChange={(e) => setDraft({ ...draft, interventions: e.target.value })} /></label>
        <label style={st.formGroup}><span style={st.label}>Review by</span><input type="date" style={st.input} value={draft.review_by} onChange={(e) => setDraft({ ...draft, review_by: e.target.value })} /></label>
        <div style={{ display: 'flex', gap: 6 }}><button type="button" style={st.btn} onClick={save}>Save care plan</button><button type="button" style={st.pageBtn} onClick={() => setDraft(null)}>Cancel</button></div>
      </div>}
      {active.map((p) => (
        <article key={p.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 12 }}>
          <b>{p.problem}</b>{p.review_by && <span style={{ color: new Date(p.review_by) < new Date() ? C.danger : C.sub }}> · review by {p.review_by}</span>}
          <div style={{ color: C.sub }}>Goal: {p.goal}</div>
          <ul style={{ margin: '6px 0', paddingLeft: 18 }}>{(p.interventions || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
          {(p.evaluations || []).slice(-3).map((e, i) => <div key={i} style={{ color: C.sub }}>{hm(e.at)} · {e.progress}: {e.note}</div>)}
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <select aria-label="Progress" style={{ ...st.input, maxWidth: 140 }} value={evals[p.id]?.progress || 'no change'} onChange={(e) => setEvals({ ...evals, [p.id]: { ...evals[p.id], progress: e.target.value } })}><option>improving</option><option>no change</option><option>worse</option></select>
            <input aria-label="Evaluation" style={{ ...st.input, flex: 1, minWidth: 160 }} placeholder="Evaluation this shift" value={evals[p.id]?.note || ''} onChange={(e) => setEvals({ ...evals, [p.id]: { ...evals[p.id], note: e.target.value } })} />
            <button type="button" style={st.pageBtn} onClick={() => evaluate(p)}>Add evaluation</button>
            <button type="button" style={st.pageBtn} onClick={() => evaluate(p, 'resolved')}>Goal met — resolve</button>
          </div>
        </article>
      ))}
      {!active.length && !draft && <div style={{ color: C.sub, fontSize: 12 }}>No active care plans.</div>}
      {rows.filter((r) => r.status !== 'active').length > 0 && <div style={{ color: C.sub, fontSize: 11 }}>{rows.filter((r) => r.status !== 'active').length} closed care plan(s): {rows.filter((r) => r.status !== 'active').map((r) => r.problem).join(', ')}</div>}
    </section>
  )
}

function FluidChart({ entries, patient }) {
  const days = useMemo(() => fluidChart(entries), [entries])
  const weight = Number(patient?.weight_kg || patient?.weight || 0)
  return (
    <section>
      <div style={{ fontSize: 11, color: C.sub, marginBottom: 6 }}>24-hour totals from 07:00 to 07:00, from the fluid entries recorded under Nursing.{weight ? ` Urine target ≥ ${Math.round(weight * 0.5 * 24)} mL/day (0.5 mL/kg/h).` : ''}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{['Day from 07:00', 'In (mL)', 'Out (mL)', 'Balance', 'Running total', 'Breakdown'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 4, borderBottom: `1px solid ${C.border}`, color: C.sub }}>{h}</th>)}</tr></thead>
        <tbody>{days.slice().reverse().map((d) => (
          <tr key={d.day}>
            <td style={{ padding: 4 }}>{d.day}</td><td style={{ padding: 4 }}>{d.intake}</td><td style={{ padding: 4 }}>{d.output}</td>
            <td style={{ padding: 4, fontWeight: 700, color: Math.abs(d.balance) >= 1000 ? C.danger : undefined }}>{d.balance > 0 ? '+' : ''}{d.balance}</td>
            <td style={{ padding: 4 }}>{d.cumulative > 0 ? '+' : ''}{d.cumulative}</td>
            <td style={{ padding: 4, color: C.sub }}>{Object.entries(d.byType).map(([k, v]) => `${k} ${v}`).join(' · ')}</td>
          </tr>
        ))}</tbody>
      </table>
      {!days.length && <div style={{ color: C.sub, fontSize: 12 }}>No fluid entries yet.</div>}
    </section>
  )
}

/** Ward page: patients with medium/high scores, unescalated alerts or overdue observations. */
export function WardEarlyWarnings({ beds = [], onOpenBed }) {
  const patientIds = useMemo(() => beds.filter((b) => b.patient_id).map((b) => b.patient_id), [beds])
  const [latest, setLatest] = useState([])
  const load = useCallback(async () => {
    if (!patientIds.length) { setLatest([]); return }
    const { data } = await supabase.from('ward_observations').select('id, patient_id, scale, score, level, observed_at, next_due_at, escalated_to')
      .in('patient_id', patientIds).gte('observed_at', new Date(Date.now() - 3 * 86400000).toISOString()).order('observed_at', { ascending: false }).limit(500)
    const seen = new Set()
    setLatest((data || []).filter((r) => (seen.has(r.patient_id) ? false : seen.add(r.patient_id))))
  }, [patientIds])
  useEffect(() => { void load(); const t = setInterval(() => { void load() }, 60000); return () => clearInterval(t) }, [load])
  const now = new Date()
  const flagged = latest.filter((r) => ['medium', 'high', 'low_medium'].includes(r.level) || new Date(r.next_due_at) < now)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
  if (!flagged.length) return null
  return (
    <section style={{ border: `1px solid ${C.danger}`, background: '#fff', borderRadius: 10, padding: 10, margin: '8px 0' }} aria-label="Deteriorating patients">
      <b style={{ color: C.danger, fontSize: 13 }}>Early warning — {flagged.length} patient{flagged.length > 1 ? 's' : ''} need attention</b>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {flagged.map((r) => {
          const bed = beds.find((b) => b.patient_id === r.patient_id)
          const overdue = new Date(r.next_due_at) < now
          return (
            <button key={r.id} type="button" onClick={() => bed && onOpenBed?.(bed)} style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>
              Bed {bed?.bed_number || '?'} · {bed?.patients?.full_name || ''} <Level level={r.level} score={r.score} />{overdue ? <b style={{ color: C.danger }}> obs overdue</b> : null}{!r.escalated_to && ['medium', 'high'].includes(r.level) ? <b style={{ color: C.danger }}> not escalated</b> : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}
