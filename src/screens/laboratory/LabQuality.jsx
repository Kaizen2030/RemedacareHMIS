// Laboratory quality panel (on the lab Dashboard): section worklists, the review queue with delta-check flags, turnaround
// times against targets, patient result trends and the lab's rules (auto-validation switch, targets, analyte limits).
// Data: lab_tests + lab_analyte_rules / lab_quality_settings / lab_tat() (20261216000000_lab_quality.sql).
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import PatientSearch from '../../components/PatientSearch'
import { LAB_TEST_CATEGORIES } from '../../utils/labCatalog'
import { ANALYTE_LABELS, DEFAULT_LAB_RULES, TEMPLATE_LABELS, effectiveRules, sectionWorklist, trendSeries } from '../../utils/labQuality'
import { C, Chip, s } from '../ncd/ui'

const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Laboratory quality is not installed yet. Run docs/sql/34_lab_quality.sql in Supabase.'
  return m
}
const mins = (m) => (m === null || m === undefined ? '—' : m >= 1440 ? `${Math.round(m / 144) / 10} d` : m >= 60 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m)} min`)
const DEFAULT_TARGETS = { STAT: 60, Urgent: 240, Routine: 1440 }

export default function LabQuality({ hospitalId }) {
  const [tab, setTab] = useState('worklists')
  return (
    <div style={{ ...s.card, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ ...s.h2, margin: 0 }}>Quality and worklists</h2>
        <div role="tablist" aria-label="Lab quality sections" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['worklists', 'Section worklists'], ['review', 'Review queue'], ['tat', 'Turnaround times'], ['trends', 'Patient trends'], ['rules', 'Rules']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...s.btn, ...(tab === k ? s.pri : s.ghost) }}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'worklists' && <Worklists hospitalId={hospitalId} />}
      {tab === 'review' && <ReviewQueue hospitalId={hospitalId} />}
      {tab === 'tat' && <Tat hospitalId={hospitalId} />}
      {tab === 'trends' && <Trends hospitalId={hospitalId} />}
      {tab === 'rules' && <Rules hospitalId={hospitalId} />}
    </div>
  )
}

function Worklists({ hospitalId }) {
  const [tests, setTests] = useState([])
  const [section, setSection] = useState('')
  const [targets, setTargets] = useState(DEFAULT_TARGETS)
  useEffect(() => {
    void supabase.from('lab_tests').select('id, test_type, category, priority, patient_name, status, sample_status, created_at, sample_collected_at, resulted_at, results_ready_at')
      .eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(800).then(({ data }) => setTests(data || []))
    void supabase.from('lab_quality_settings').select('tat_targets').eq('hospital_id', hospitalId).then(({ data }) => { if (data?.[0]?.tat_targets) setTargets(data[0].tat_targets) })
  }, [hospitalId])
  const open = sectionWorklist(tests)
  const counts = LAB_TEST_CATEGORIES.map((c) => [c, open.filter((t) => t.category === c).length]).filter(([, n]) => n)
  const list = sectionWorklist(tests, section)
  const now = Date.now()
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <button type="button" style={{ ...s.btn, ...(section === '' ? s.soft : s.ghost) }} onClick={() => setSection('')}>All ({open.length})</button>
        {counts.map(([c, n]) => <button key={c} type="button" style={{ ...s.btn, ...(section === c ? s.soft : s.ghost) }} onClick={() => setSection(c)}>{c} ({n})</button>)}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Priority', 'Test', 'Patient', 'Stage', 'Waiting', 'Target'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>{list.slice(0, 200).map((t) => {
          const waited = (now - new Date(t.created_at)) / 60000, target = targets[t.priority] || targets.Routine || 1440
          return (
            <tr key={t.id}>
              <td style={s.td}><Chip tone={t.priority === 'STAT' ? 'red' : t.priority === 'Urgent' ? 'yellow' : 'gray'}>{t.priority || 'Routine'}</Chip></td>
              <td style={s.td}>{t.test_type}</td><td style={s.td}>{t.patient_name}</td><td style={s.td}>{t.sample_status || t.status || 'Ordered'}</td>
              <td style={{ ...s.td, color: waited > target ? C.danger : undefined, fontWeight: waited > target ? 800 : undefined }}>{mins(waited)}</td>
              <td style={s.td}>{mins(target)}</td>
            </tr>
          )
        })}</tbody>
      </table>
      {!list.length && <div style={s.sub}>Nothing waiting in this section.</div>}
    </div>
  )
}

function ReviewQueue({ hospitalId }) {
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('lab_tests').select('id, test_type, patient_name, result_text, result_json, result_template_key, delta_flags, critical_flags, resulted_at, results_ready_at')
      .eq('hospital_id', hospitalId).eq('validation_status', 'needs_review').order('resulted_at', { ascending: true }).limit(200)
    if (error) setErr(friendly(error)); else { setErr(''); setRows(data || []) }
  }, [hospitalId])
  useEffect(() => { void load() }, [load])
  async function validate(r) {
    const { error } = await supabase.from('lab_tests').update({ reviewed_at: new Date().toISOString() }).eq('id', r.id)
    if (error) setErr(friendly(error)); else void load()
  }
  return (
    <div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ ...s.sub, marginBottom: 6 }}>Results outside range, critical, or with a suspicious change since the last result wait here for a second look before release.</div>
      {rows.map((r) => (
        <div key={r.id} style={{ borderTop: `1px solid ${C.border}`, padding: '8px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span><b>{r.patient_name}</b> · {r.test_type} · {new Date(r.results_ready_at || r.resulted_at).toLocaleString('en-KE')}</span>
            <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => validate(r)}>Validate</button>
          </div>
          <div style={{ fontSize: 12, whiteSpace: 'pre-line' }}>{r.result_text}</div>
          {(r.critical_flags || []).map((f, i) => <div key={i} style={{ color: C.danger, fontSize: 12, fontWeight: 700 }}>⚠ {f}</div>)}
          {(r.delta_flags || []).map((f) => (
            <div key={f.analyte} style={{ color: '#B54708', fontSize: 12, fontWeight: 700 }}>
              Δ {ANALYTE_LABELS[f.analyte] || f.analyte}: {f.previous} → {f.current} ({f.change > 0 ? '+' : ''}{Math.round(f.change * 100) / 100}) since {new Date(f.previous_at).toLocaleDateString('en-KE')} — check sample identity and haemolysis
            </div>
          ))}
        </div>
      ))}
      {!rows.length && <div style={s.sub}>Nothing waiting for review.</div>}
    </div>
  )
}

function Tat({ hospitalId }) {
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { void supabase.rpc('lab_tat', { p_hospital: hospitalId, p_from: range.from, p_to: range.to }).then(({ data, error }) => { if (error) setErr(friendly(error)); else { setErr(''); setD(data) } }) }, [hospitalId, range])
  const tile = (l, v, warn) => <div style={{ border: `1px solid ${warn ? C.danger : C.border}`, borderRadius: 10, padding: 12, background: '#fff' }}><div style={s.sub}>{l}</div><div style={{ fontSize: 20, fontWeight: 800, color: warn ? C.danger : undefined }}>{v ?? '—'}</div></div>
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input aria-label="From" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <input aria-label="To" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {d && <>
        <div style={s.grid(170)}>
          {tile('Ordered', d.ordered)}{tile('Resulted', d.resulted)}{tile('Awaiting review', d.awaiting_review, d.awaiting_review > 0)}
          {tile('Auto-validated', d.auto_validated)}{tile('Delta-check flags', d.delta_flagged)}{tile('Overdue now', d.overdue.length, d.overdue.length > 0)}
        </div>
        <div style={{ ...s.label, marginTop: 12 }}>By priority (order → result)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Priority', 'Target', 'Ordered', 'Resulted', 'Median', 'Median in lab (collection → result)', 'Within target'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{Object.entries(d.by_priority || {}).map(([p, x]) => (
            <tr key={p}><td style={s.td}>{p}</td><td style={s.td}>{mins(d.targets?.[p])}</td><td style={s.td}>{x.ordered}</td><td style={s.td}>{x.resulted}</td><td style={s.td}>{mins(x.median_min)}</td><td style={s.td}>{mins(x.median_lab_min)}</td>
              <td style={{ ...s.td, color: x.within_target_pct !== null && x.within_target_pct < 80 ? C.danger : C.success, fontWeight: 800 }}>{x.within_target_pct === null ? '—' : `${x.within_target_pct}%`}</td></tr>
          ))}</tbody>
        </table>
        <div style={{ ...s.label, marginTop: 12 }}>Busiest tests</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Test', 'Ordered', 'Median', 'Within target'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{(d.by_test || []).map((x) => <tr key={x.test}><td style={s.td}>{x.test}</td><td style={s.td}>{x.ordered}</td><td style={s.td}>{mins(x.median_min)}</td><td style={s.td}>{x.within_target_pct === null ? '—' : `${x.within_target_pct}%`}</td></tr>)}</tbody>
        </table>
        {d.overdue.length > 0 && <>
          <div style={{ ...s.label, marginTop: 12, color: C.danger }}>Overdue now</div>
          {d.overdue.map((o) => <div key={o.id} style={{ fontSize: 12 }}>{o.priority} · {o.test} · {o.patient} · waiting {mins(o.minutes)} (target {mins(o.target)})</div>)}
        </>}
      </>}
    </div>
  )
}

function Trends({ hospitalId }) {
  const [patient, setPatient] = useState(null)
  const [tests, setTests] = useState([])
  const [template, setTemplate] = useState('rfts')
  useEffect(() => {
    if (!patient) return
    void supabase.from('lab_tests').select('id, result_template_key, result_json, resulted_at, results_ready_at, created_at').eq('hospital_id', hospitalId).eq('patient_id', patient.id).order('created_at').limit(500)
      .then(({ data }) => setTests(data || []))
  }, [hospitalId, patient])
  const analytes = DEFAULT_LAB_RULES.filter((r) => r.template_key === template)
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ minWidth: 280 }}><label style={s.label} htmlFor="lt-patient">Patient</label><PatientSearch id="lt-patient" hospitalId={hospitalId} inputStyle={s.input} value={patient} onPick={setPatient} /></div>
        <div><label style={s.label} htmlFor="lt-template">Panel</label><select id="lt-template" style={s.input} value={template} onChange={(e) => setTemplate(e.target.value)}>{Object.entries(TEMPLATE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>
      {patient && <div style={{ ...s.grid(300), marginTop: 10 }}>
        {analytes.map((r) => <TrendChart key={r.analyte} rule={r} points={trendSeries(tests, template, r.analyte)} />)}
      </div>}
    </div>
  )
}

function TrendChart({ rule, points }) {
  const W = 300, H = 120, P = 26
  if (!points.length) return <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 12 }}><b>{ANALYTE_LABELS[rule.analyte]}</b><div style={s.sub}>No results.</div></div>
  const vals = points.map((p) => p.value).concat([rule.low, rule.high].filter((x) => x !== null))
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1
  const t0 = new Date(points[0].at).getTime(), t1 = new Date(points[points.length - 1].at).getTime(), tspan = t1 - t0 || 1
  const sx = (t) => P + ((new Date(t).getTime() - t0) / tspan) * (W - P - 8), sy = (v) => H - 14 - ((v - lo) / span) * (H - 26)
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }}>
      <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}><b>{ANALYTE_LABELS[rule.analyte]}</b><span>latest <b>{points[points.length - 1].value}</b></span></div>
      <svg role="img" aria-label={`${ANALYTE_LABELS[rule.analyte]} trend`} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }}>
        {rule.low !== null && rule.high !== null && <rect x={P} width={W - P - 8} y={sy(rule.high)} height={Math.max(1, sy(rule.low) - sy(rule.high))} fill="#ECFDF3" />}
        <text x={2} y={sy(hi) + 4} fontSize="9" fill="#667085">{hi}</text><text x={2} y={sy(lo)} fontSize="9" fill="#667085">{lo}</text>
        {points.length > 1 && <path d={points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.at).toFixed(1)},${sy(p.value).toFixed(1)}`).join(' ')} fill="none" stroke="#175CD3" strokeWidth="1.5" />}
        {points.map((p, i) => {
          const out = (rule.low !== null && p.value < rule.low) || (rule.high !== null && p.value > rule.high)
          return <circle key={i} cx={sx(p.at)} cy={sy(p.value)} r="3" fill={out ? '#B42318' : '#175CD3'}><title>{`${new Date(p.at).toLocaleDateString('en-KE')}: ${p.value}`}</title></circle>
        })}
      </svg>
    </div>
  )
}

function Rules({ hospitalId }) {
  const [settings, setSettings] = useState({ autoverify: false, tat_targets: DEFAULT_TARGETS })
  const [own, setOwn] = useState([])
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const [st, r] = await Promise.all([
      supabase.from('lab_quality_settings').select('*').eq('hospital_id', hospitalId),
      supabase.from('lab_analyte_rules').select('*').eq('hospital_id', hospitalId),
    ])
    if (st.error) { setErr(friendly(st.error)); return }
    if (st.data?.[0]) setSettings(st.data[0])
    setOwn(r.data || [])
  }, [hospitalId])
  useEffect(() => { void load() }, [load])
  async function saveSettings(next) {
    setErr(''); setMsg('')
    const { error } = await supabase.from('lab_quality_settings').upsert({ hospital_id: hospitalId, autoverify: next.autoverify, tat_targets: next.tat_targets }, { onConflict: 'hospital_id' })
    if (error) setErr(friendly(error)); else { setSettings(next); setMsg('Saved.') }
  }
  async function saveRule(rule, patch) {
    setErr(''); setMsg('')
    const existing = own.find((o) => o.template_key === rule.template_key && o.analyte === rule.analyte)
    const row = { ...rule, ...patch, hospital_id: hospitalId }
    delete row.id; delete row.updated_at
    const { error } = existing ? await supabase.from('lab_analyte_rules').update(row).eq('id', existing.id) : await supabase.from('lab_analyte_rules').insert(row)
    if (error) setErr(friendly(error)); else { setMsg(`${ANALYTE_LABELS[rule.analyte]} rule saved for this hospital.`); void load() }
  }
  const all = useMemo(() => Object.keys(TEMPLATE_LABELS).flatMap((t) => effectiveRules(own, t)), [own])
  return (
    <div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {msg && <div style={s.ok}>{msg}</div>}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 700 }}>
        <input type="checkbox" checked={settings.autoverify} onChange={(e) => saveSettings({ ...settings, autoverify: e.target.checked })} />
        Auto-validate structured results that are all in range, not critical and pass the delta check
      </label>
      <div style={{ ...s.sub, margin: '2px 0 10px 24px' }}>Off: every result waits in the review queue. Only the laboratory manager or an administrator can change this.</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        {['STAT', 'Urgent', 'Routine'].map((p) => (
          <div key={p}><label style={s.label} htmlFor={`tat-${p}`}>{p} target (min)</label><input id={`tat-${p}`} type="number" style={{ ...s.input, width: 120 }} value={settings.tat_targets?.[p] ?? ''} onChange={(e) => setSettings({ ...settings, tat_targets: { ...settings.tat_targets, [p]: Number(e.target.value) } })} /></div>
        ))}
        <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => saveSettings(settings)}>Save targets</button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12, fontSize: 12 }}>
        <thead><tr>{['Panel', 'Analyte', 'Low', 'High', 'Critical low', 'Critical high', 'Delta (abs)', 'Delta (%)', 'Window (days)', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>{all.map((r) => <RuleRow key={`${r.template_key}-${r.analyte}`} rule={r} custom={Boolean(r.hospital_id)} onSave={saveRule} />)}</tbody>
      </table>
    </div>
  )
}

function RuleRow({ rule, custom, onSave }) {
  const [f, setF] = useState(rule)
  useEffect(() => { setF(rule) }, [rule])
  const n = (k) => <td style={s.td}><input aria-label={`${rule.analyte} ${k}`} type="number" style={{ ...s.input, width: 80, padding: '4px 6px' }} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value === '' ? null : Number(e.target.value) })} /></td>
  return (
    <tr>
      <td style={s.td}>{TEMPLATE_LABELS[rule.template_key]}</td><td style={s.td}>{ANALYTE_LABELS[rule.analyte]}{custom ? <b style={{ color: C.primary }}> · ours</b> : ''}</td>
      {n('low')}{n('high')}{n('critical_low')}{n('critical_high')}{n('delta_abs')}{n('delta_pct')}{n('delta_days')}
      <td style={s.td}><button type="button" style={{ ...s.btn, ...s.ghost, padding: '3px 9px' }} onClick={() => onSave(rule, { low: f.low, high: f.high, critical_low: f.critical_low, critical_high: f.critical_high, delta_abs: f.delta_abs, delta_pct: f.delta_pct, delta_days: f.delta_days || 7 })}>Save</button></td>
    </tr>
  )
}
