// Dialysis water-quality log (ISO 23500 / AAMI limits). Grading and the "no dialysis while chlorine fails"
// rule are in the database (20261220000000_safety_checks.sql); utils/safetyChecks.js only previews them.
import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'
import { dialysisWaterGrade, WATER_PARAMETERS } from '../../utils/safetyChecks'
import { Chip, s } from '../ncd/ui'

const POINTS = { ro_outlet: 'RO outlet', loop_return: 'Loop return', post_carbon: 'After carbon filter', post_softener: 'After softener', feed: 'Feed water', dialysate: 'Dialysate' }
const TONE = { pass: 'green', action: 'yellow', fail: 'red' }
const LABEL = Object.fromEntries(WATER_PARAMETERS.map((p) => [p.key, p]))

/** Banner for the sessions tab: shows when the latest chlorine test failed. */
export function WaterAlert({ hospitalId }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    if (!hospitalId) return
    supabase.rpc('dialysis_water_status', { p_hospital: hospitalId }).then(({ data }) => setRows(Array.isArray(data) ? data : []))
  }, [hospitalId])
  const block = rows.find((r) => r.blocks_dialysis)
  const overdue = rows.filter((r) => r.overdue)
  if (!block && overdue.length === 0) return null
  return (
    <div role="alert" style={{ ...(block ? s.err : { ...s.err, background: '#FFFAEB', color: '#B54708' }), fontWeight: 700 }}>
      {block ? `Do not start dialysis: total chlorine ${block.value} mg/L. Fix the carbon filter and record a passing chlorine test.` : `Water tests due: ${overdue.map((r) => LABEL[r.parameter]?.label || r.parameter).join(', ')}.`}
    </div>
  )
}

export default function WaterQuality({ hospitalId }) {
  const [status, setStatus] = useState([])
  const [log, setLog] = useState([])
  const [form, setForm] = useState({ parameter: 'total_chlorine', sample_point: 'ro_outlet', value: '', action_taken: '' })
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.rpc('dialysis_water_status', { p_hospital: hospitalId }),
      supabase.from('dialysis_water_tests').select('*').eq('hospital_id', hospitalId).order('tested_at', { ascending: false }).limit(60),
    ])
    if (a.error) setErr(/does not exist|schema cache|Could not find/i.test(a.error.message) ? 'Run docs/sql/38_safety_checks.sql to switch on the water log.' : a.error.message)
    setStatus(Array.isArray(a.data) ? a.data : []); setLog(b.data || [])
  }, [hospitalId])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])
  const grade = form.value === '' ? null : dialysisWaterGrade(form.parameter, form.value)
  const save = async () => {
    setErr(''); setOk('')
    const { error } = await supabase.from('dialysis_water_tests').insert({ hospital_id: hospitalId, parameter: form.parameter, sample_point: form.sample_point, value: Number(form.value), action_taken: form.action_taken || null })
    if (error) { setErr(error.message); return }
    setOk(`${LABEL[form.parameter].label} recorded: ${grade}.`)
    setForm((f) => ({ ...f, value: '', action_taken: '' })); void load()
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {ok && <div role="status" style={s.ok}>{ok}</div>}
      <div style={s.grid(190)}>
        {status.map((r) => {
          const p = LABEL[r.parameter] || { label: r.parameter, unit: r.unit, limit: '' }
          return (
            <div key={r.parameter} style={{ ...s.card, borderColor: r.blocks_dialysis ? '#F04438' : undefined }}>
              <div style={s.label}>{p.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{r.value ?? '—'} <span style={{ fontSize: 12, fontWeight: 600 }}>{p.unit}</span></div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                {r.status && <Chip tone={TONE[r.status]}>{r.status}</Chip>}
                <Chip tone={r.overdue ? 'red' : 'gray'}>{r.overdue ? 'due now' : `next ${r.next_due}`}</Chip>
              </div>
              <div style={{ ...s.sub, marginTop: 4 }}>Limit {p.limit} · every {r.every_days === 1 ? 'day' : `${r.every_days} days`}</div>
            </div>
          )
        })}
      </div>
      <div style={s.card}>
        <h3 style={s.h2}>Record a water test</h3>
        <div style={{ ...s.grid(160), alignItems: 'end' }}>
          <div><label style={s.label} htmlFor="wq-p">Test</label><select id="wq-p" style={s.input} value={form.parameter} onChange={(e) => setForm((f) => ({ ...f, parameter: e.target.value }))}>{WATER_PARAMETERS.map((p) => <option key={p.key} value={p.key}>{p.label} ({p.unit})</option>)}</select></div>
          <div><label style={s.label} htmlFor="wq-pt">Sample point</label><select id="wq-pt" style={s.input} value={form.sample_point} onChange={(e) => setForm((f) => ({ ...f, sample_point: e.target.value }))}>{Object.entries(POINTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label style={s.label} htmlFor="wq-v">Result</label><input id="wq-v" type="number" min={0} step="any" style={s.input} value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} /></div>
          {grade && <div><Chip tone={TONE[grade]}>{grade === 'fail' ? 'Out of limits' : grade === 'action' ? 'Action level' : 'Within limits'}</Chip></div>}
        </div>
        {grade && grade !== 'pass' && (
          <div style={{ marginTop: 10 }}><label style={s.label} htmlFor="wq-a">Action taken{grade === 'fail' ? ' (required)' : ''}</label><input id="wq-a" style={s.input} value={form.action_taken} placeholder="e.g. carbon tank changed, loop disinfected, retest at 14:00" onChange={(e) => setForm((f) => ({ ...f, action_taken: e.target.value }))} /></div>
        )}
        {grade === 'fail' && form.parameter === 'total_chlorine' && <div style={{ ...s.sub, color: '#B42318', marginTop: 6 }}>Sessions cannot start until a passing chlorine test is recorded.</div>}
        <button type="button" style={{ ...s.btn, ...s.pri, marginTop: 10 }} disabled={form.value === '' || (grade === 'fail' && !form.action_taken.trim())} onClick={save}>Save result</button>
      </div>
      <div style={{ ...s.card, overflowX: 'auto' }}>
        <h3 style={s.h2}>Log</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['When', 'Test', 'Point', 'Result', '', 'Action'].map((h, i) => <th key={i} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{log.map((r) => (
            <tr key={r.id}><td style={s.td}>{String(r.tested_at).slice(0, 16).replace('T', ' ')}</td><td style={s.td}>{LABEL[r.parameter]?.label || r.parameter}</td><td style={s.td}>{POINTS[r.sample_point] || r.sample_point}</td>
              <td style={s.td}>{r.value} {LABEL[r.parameter]?.unit}</td><td style={s.td}><Chip tone={TONE[r.status]}>{r.status}</Chip></td><td style={s.td}>{r.action_taken || ''}</td></tr>
          ))}</tbody>
        </table>
        {log.length === 0 && <div style={{ ...s.sub, padding: 12, textAlign: 'center' }}>No water tests recorded yet.</div>}
      </div>
    </div>
  )
}
