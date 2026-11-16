// Growth monitoring for children under 5: measurements with WHO z-scores (previewed here, recomputed by the database),
// malnutrition / stunting alerts, history and a WHO growth chart. Data: growth_measurements (20261213000000).
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { ageInDays, growthAssess, referenceCurve } from '../../utils/growth'

const box = { border: '1px solid #E4E7EC', borderRadius: 10, padding: 12, marginBottom: 10, background: '#fff' }
const lab = { display: 'block', fontSize: 11, fontWeight: 700, color: '#667085', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }
const inp = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 13 }
const btn = { padding: '7px 12px', borderRadius: 8, border: '1px solid #D0D5DD', background: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 12 }
const pri = { ...btn, background: '#175CD3', color: '#fff', border: 'none' }
const zTone = (z) => (z === null || z === undefined ? '#667085' : z < -3 || z > 3 ? '#B42318' : z < -2 || z > 2 ? '#C4320A' : '#067647')
const CHARTS = { wfa: ['Weight-for-age', 'weight_kg', 'kg'], lhfa: ['Length / height-for-age', 'length_cm', 'cm'], hcfa: ['Head circumference-for-age', 'hc_cm', 'cm'] }
const friendly = (e) => (/does not exist|schema cache|Could not find/i.test(e?.message || '') ? 'Growth monitoring is not installed yet. Run docs/sql/31_growth_ortho_oncology.sql in Supabase.' : e?.message || String(e))

export function isUnderFive(patient) {
  const d = ageInDays(patient?.date_of_birth)
  if (d !== null) return d >= 0 && d <= 1856
  const a = Number(patient?.age)
  return Number.isFinite(a) && patient?.age !== '' && patient?.age !== null && a < 5
}

export default function GrowthPanel({ hospitalId, patientId, visitId, patient }) {
  const [rows, setRows] = useState([])
  const [f, setF] = useState({ measured_on: new Date().toISOString().slice(0, 10), weight_kg: '', length_cm: '', measured: 'length', hc_cm: '', muac_cm: '', oedema: false, age_days: '' })
  const [chart, setChart] = useState('wfa')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const sex = patient?.gender || patient?.sex || ''
  const dobAge = ageInDays(patient?.date_of_birth, f.measured_on)
  const age = dobAge ?? (f.age_days === '' ? null : Number(f.age_days))
  useEffect(() => { if (age !== null) setF((x) => ({ ...x, measured: age >= 731 ? 'height' : 'length' })) }, [age >= 731]) // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('growth_measurements').select('*').eq('hospital_id', hospitalId).eq('patient_id', patientId).order('measured_on')
    if (error) setErr(friendly(error)); else setRows(data || [])
  }, [hospitalId, patientId])
  useEffect(() => { void load() }, [load])
  const live = growthAssess({ ...f, sex, age_days: age })
  async function save() {
    setErr(''); setMsg('')
    if (age === null) { setErr('Record the date of birth on the patient, or enter the age in days.'); return }
    if (!sex) { setErr('Record the child\'s sex on the patient record.'); return }
    const num = (v) => (v === '' ? null : Number(v))
    const { error } = await supabase.from('growth_measurements').insert({ hospital_id: hospitalId, patient_id: patientId, visit_id: visitId ? String(visitId) : null, measured_on: f.measured_on,
      age_days: dobAge === null ? age : null, sex, weight_kg: num(f.weight_kg), length_cm: num(f.length_cm), measured: f.measured, hc_cm: num(f.hc_cm), muac_cm: num(f.muac_cm), oedema: f.oedema })
    if (error) { setErr(friendly(error)); return }
    setMsg('Measurement saved.'); setF((x) => ({ ...x, weight_kg: '', length_cm: '', hc_cm: '', muac_cm: '', oedema: false })); void load()
  }
  const field = (k, l) => <div><label style={lab} htmlFor={`gr-${k}`}>{l}</label><input id={`gr-${k}`} type="number" step="0.1" style={inp} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  const z = (label, v) => <span style={{ fontSize: 12, fontWeight: 800, color: zTone(v), marginRight: 10 }}>{label} {v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2)}</span>
  return (
    <div style={{ ...box, borderColor: '#A6F4C5', background: '#F6FEF9' }}>
      <b style={{ fontSize: 14 }}>Growth monitoring (WHO Child Growth Standards)</b>
      <div style={{ fontSize: 12, color: '#667085', margin: '2px 0 8px' }}>{sex || 'Sex not recorded'} · {age === null ? 'age unknown' : `${Math.floor(age / 30.4375)} months (${age} days)`}</div>
      {err && <div role="alert" style={{ background: '#FEF3F2', color: '#B42318', borderRadius: 8, padding: 8, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {msg && <div style={{ background: '#ECFDF3', color: '#067647', borderRadius: 8, padding: 8, fontSize: 12, marginBottom: 8, fontWeight: 600 }}>{msg}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
        <div><label style={lab} htmlFor="gr-date">Date</label><input id="gr-date" type="date" style={inp} value={f.measured_on} onChange={(e) => setF({ ...f, measured_on: e.target.value })} /></div>
        {dobAge === null && field('age_days', 'Age in days')}
        {field('weight_kg', 'Weight kg')}{field('length_cm', f.measured === 'height' ? 'Height cm' : 'Length cm')}
        <div><label style={lab} htmlFor="gr-measured">Measured</label><select id="gr-measured" style={inp} value={f.measured} onChange={(e) => setF({ ...f, measured: e.target.value })}><option value="length">Lying (length)</option><option value="height">Standing (height)</option></select></div>
        {field('hc_cm', 'Head circ. cm')}{field('muac_cm', 'MUAC cm')}
      </div>
      <label style={{ display: 'flex', gap: 6, fontSize: 12, marginTop: 8 }}><input type="checkbox" checked={f.oedema} onChange={(e) => setF({ ...f, oedema: e.target.checked })} />Bilateral pitting oedema of both feet</label>
      <div style={{ marginTop: 8 }}>{z('WAZ', live.waz)}{z('HAZ', live.haz)}{z('WHZ', live.whz)}{z('HCZ', live.hcz)}</div>
      {live.flags.map((x) => <div key={x} style={{ color: '#B42318', fontSize: 12, fontWeight: 800 }}>⚠ {x}</div>)}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button type="button" style={pri} onClick={save}>Save measurement</button></div>

      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }} role="tablist" aria-label="Growth chart">
            {Object.entries(CHARTS).map(([k, [l]]) => <button key={k} type="button" role="tab" aria-selected={chart === k} style={chart === k ? pri : btn} onClick={() => setChart(k)}>{l}</button>)}
          </div>
          <GrowthChart indicator={chart} sex={sex} rows={rows} />
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
            <thead><tr>{['Date', 'Age (m)', 'Weight', 'Length / height', 'HC', 'MUAC', 'WAZ', 'HAZ', 'WHZ', 'HCZ'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 4, borderBottom: '1px solid #E4E7EC', color: '#667085' }}>{h}</th>)}</tr></thead>
            <tbody>{rows.slice().reverse().map((r) => (
              <tr key={r.id} title={(r.flags || []).join(' · ')}>
                <td style={{ padding: 4 }}>{r.measured_on}</td><td style={{ padding: 4 }}>{Math.floor(r.age_days / 30.4375)}</td>
                <td style={{ padding: 4 }}>{r.weight_kg ?? '—'}</td><td style={{ padding: 4 }}>{r.length_cm ?? '—'}</td><td style={{ padding: 4 }}>{r.hc_cm ?? '—'}</td><td style={{ padding: 4 }}>{r.muac_cm ?? '—'}</td>
                {['waz', 'haz', 'whz', 'hcz'].map((k) => <td key={k} style={{ padding: 4, fontWeight: 800, color: zTone(r[k] === null ? null : Number(r[k])) }}>{r[k] ?? '—'}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </>
      )}
    </div>
  )
}

function GrowthChart({ indicator, sex, rows }) {
  const [title, key, unit] = CHARTS[indicator]
  const curves = useMemo(() => referenceCurve(indicator, sex), [indicator, sex])
  const pts = rows.filter((r) => r[key] !== null && r[key] !== undefined).map((r) => [Number(r.age_days), Number(r[key])])
  if (!curves[0]?.points.length) return null
  const W = 560, H = 260, P = 34
  const xMax = 1856
  const ys = curves.flatMap((c) => c.points.map((p) => p[1])).concat(pts.map((p) => p[1]))
  const yMin = Math.floor(Math.min(...ys)), yMax = Math.ceil(Math.max(...ys))
  const sx = (x) => P + (x / xMax) * (W - P - 8), sy = (y) => H - P + 8 - ((y - yMin) / (yMax - yMin)) * (H - P)
  const line = (points) => points.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')
  const colour = { '-3': '#B42318', '-2': '#F79009', 0: '#12B76A', 2: '#F79009', 3: '#B42318' }
  return (
    <svg role="img" aria-label={`${title} chart with WHO reference lines`} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, marginTop: 8, background: '#fff', border: '1px solid #E4E7EC', borderRadius: 8 }}>
      {[0, 12, 24, 36, 48, 60].map((m) => <g key={m}><line x1={sx(m * 30.4375)} x2={sx(m * 30.4375)} y1={8} y2={H - P + 8} stroke="#F2F4F7" /><text x={sx(m * 30.4375)} y={H - 10} fontSize="10" textAnchor="middle" fill="#667085">{m}m</text></g>)}
      {[yMin, Math.round((yMin + yMax) / 2), yMax].map((y) => <text key={y} x={4} y={sy(y) + 3} fontSize="10" fill="#667085">{y}</text>)}
      {curves.map((c) => <path key={c.z} d={line(c.points)} fill="none" stroke={colour[c.z]} strokeWidth={c.z === 0 ? 1.6 : 1} strokeDasharray={Math.abs(c.z) === 3 ? '4 3' : undefined} />)}
      {pts.length > 1 && <path d={line(pts)} fill="none" stroke="#175CD3" strokeWidth="1.5" />}
      {pts.map((p, i) => <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r="3.5" fill="#175CD3"><title>{`${Math.floor(p[0] / 30.4375)} months: ${p[1]} ${unit}`}</title></circle>)}
      <text x={W - 8} y={18} fontSize="11" textAnchor="end" fill="#344054">{title} ({unit}) · lines: −3, −2, median, +2, +3 SD</text>
    </svg>
  )
}
