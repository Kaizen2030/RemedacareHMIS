// Specialty assessment panel inside the consultation: the template follows the clinic (mental health, eye, dental, ENT,
// physiotherapy, cardiology, dermatology), scores are previewed live and recomputed by the database on save, and the
// summary can be copied into the examination findings. Data: specialty_assessments (20261209000000).
import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'
import { TEMPLATES, TEETH, TOOTH_STATUS, scoreAssessment, summarise, templateFor } from '../../utils/specialtyTemplates'

const box = { border: '1px solid #E4E7EC', borderRadius: 10, padding: 12, marginBottom: 10, background: '#fff' }
const lab = { display: 'block', fontSize: 11, fontWeight: 700, color: '#667085', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }
const inp = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 13 }
const btn = { padding: '7px 12px', borderRadius: 8, border: '1px solid #D0D5DD', background: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 12 }
const pri = { ...btn, background: '#175CD3', color: '#fff', border: 'none' }
const friendly = (e) => (/does not exist|schema cache|Could not find/i.test(e?.message || '') ? 'Specialty assessments are not installed yet. Run docs/sql/27_specialty_assessments.sql in Supabase.' : e?.message || String(e))

export default function SpecialtyAssessment({ hospitalId, patientId, visitId, speciality, onInsertSummary, doctorName }) {
  const auto = templateFor(speciality)
  const [open, setOpen] = useState(Boolean(auto))
  const [template, setTemplate] = useState(auto || '')
  const [data, setData] = useState({})
  const [history, setHistory] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { if (auto) { setTemplate(auto); setOpen(true) } }, [auto])

  const load = useCallback(async () => {
    if (!hospitalId || !patientId || !template) return
    const { data: rows, error } = await supabase.from('specialty_assessments').select('*').eq('hospital_id', hospitalId).eq('patient_id', patientId).eq('template', template).order('created_at', { ascending: false }).limit(10)
    if (!error) setHistory(rows || [])
  }, [hospitalId, patientId, template])
  useEffect(() => { void load() }, [load])

  const t = TEMPLATES[template]
  const result = t ? scoreAssessment(template, data) : { scores: {}, flags: [] }
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }))

  async function save() {
    setErr(''); setMsg('')
    if (!patientId) { setErr('Select the patient first.'); return }
    const { error } = await supabase.from('specialty_assessments').insert({ hospital_id: hospitalId, patient_id: patientId, visit_id: visitId ? String(visitId) : null, template, data, recorded_by_name: doctorName || null })
    if (error) { setErr(friendly(error)); return }
    setMsg('Assessment saved.')
    void load()
  }

  if (!open) {
    return (
      <div style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Specialty assessment</span>
        <select aria-label="Specialty template" style={{ ...inp, width: 240 }} value={template} onChange={(e) => { setTemplate(e.target.value); setData({}); setOpen(Boolean(e.target.value)) }}>
          <option value="">Add a structured assessment…</option>
          {Object.entries(TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
        </select>
      </div>
    )
  }

  return (
    <div style={{ ...box, borderColor: '#B2CCFF', background: '#F5F8FF' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <b style={{ fontSize: 14 }}>{t?.title}</b>
        <select aria-label="Specialty template" style={{ ...inp, width: 240 }} value={template} onChange={(e) => { setTemplate(e.target.value); setData({}); setOpen(Boolean(e.target.value)) }}>
          <option value="">None</option>
          {Object.entries(TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
        </select>
      </div>
      {err && <div role="alert" style={{ background: '#FEF3F2', color: '#B42318', borderRadius: 8, padding: 8, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {msg && <div style={{ background: '#ECFDF3', color: '#067647', borderRadius: 8, padding: 8, fontSize: 12, marginBottom: 8, fontWeight: 600 }}>{msg}</div>}
      {t?.sections.map((sec) => <Section key={sec.key} sec={sec} data={data} set={set} setData={setData} />)}

      <div style={{ ...box, marginBottom: 0 }} aria-live="polite">
        <div style={lab}>Scores</div>
        {Object.keys(result.scores).length ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(result.scores).map(([k, v]) => <span key={k} style={{ background: '#EFF8FF', color: '#175CD3', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 800 }}>{k.replace(/_/g, ' ')}: {String(v)}</span>)}
          </div>
        ) : <div style={{ fontSize: 12, color: '#667085' }}>Complete the items to see the scores.</div>}
        {result.flags.map((f) => <div key={f} role={/HIGH/.test(f) ? 'alert' : undefined} style={{ color: '#B42318', fontSize: 12, fontWeight: 800, marginTop: 4 }}>⚠ {f}</div>)}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
          {onInsertSummary && <button type="button" style={btn} onClick={() => onInsertSummary(summarise(template, data, result))}>Copy summary to findings</button>}
          <button type="button" style={pri} onClick={save}>Save assessment</button>
        </div>
      </div>

      {history.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={lab}>Previous {t?.title.toLowerCase()}s</div>
          {history.map((h) => (
            <div key={h.id} style={{ fontSize: 12, padding: '3px 0', borderTop: '1px solid #E4E7EC' }}>
              <b>{new Date(h.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}</b>{' '}
              {Object.entries(h.scores || {}).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(' · ') || 'no scores'}
              {(h.flags || []).length > 0 && <span style={{ color: '#B42318' }}> · {(h.flags || []).length} alert(s)</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Section({ sec, data, set, setData }) {
  const id = (k) => `spec-${k}`
  let body = null
  if (sec.kind === 'scale' || sec.kind === 'select') {
    body = sec.items.map(([k, label, options]) => (
      <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(180px, 260px)', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #F2F4F7' }}>
        <label htmlFor={id(k)} style={{ fontSize: 13 }}>{label}</label>
        <select id={id(k)} style={inp} value={data[k] ?? ''} onChange={(e) => set(k, e.target.value)}>
          <option value="">—</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
    ))
  } else if (sec.kind === 'yesno') {
    body = sec.items.map(([k, label]) => (
      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderBottom: '1px solid #F2F4F7', fontSize: 13 }}>
        <span>{label}</span>
        <span style={{ display: 'flex', gap: 10 }}>{['yes', 'no'].map((v) => (
          <label key={v} style={{ display: 'flex', gap: 3, alignItems: 'center', color: v === 'yes' && data[k] === 'yes' ? '#B42318' : undefined }}><input type="radio" name={id(k)} checked={data[k] === v} onChange={() => set(k, v)} />{v === 'yes' ? 'Yes' : 'No'}</label>
        ))}</span>
      </div>
    ))
  } else if (sec.kind === 'text') {
    body = <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>{sec.items.map(([k, label]) => (
      <div key={k}><label style={lab} htmlFor={id(k)}>{label}</label><textarea id={id(k)} rows={2} style={{ ...inp, resize: 'vertical' }} value={data[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></div>
    ))}</div>
  } else if (sec.kind === 'number' || sec.kind === 'va' || sec.kind === 'bpe') {
    body = <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>{sec.items.map(([k, label]) => (
      <div key={k}><label style={lab} htmlFor={id(k)}>{label}</label>
        {sec.kind === 'bpe'
          ? <select id={id(k)} style={inp} value={data[k] ?? ''} onChange={(e) => set(k, e.target.value)}><option value="">—</option>{['0', '1', '2', '3', '4'].map((v) => <option key={v}>{v}</option>)}</select>
          : <input id={id(k)} type={sec.kind === 'va' ? 'text' : 'number'} placeholder={sec.kind === 'va' ? 'e.g. 6/18' : ''} style={inp} value={data[k] ?? ''} onChange={(e) => set(k, e.target.value)} />}
      </div>
    ))}</div>
  } else if (sec.kind === 'checks') {
    body = <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{sec.items.map(([k, label]) => (
      <label key={k} style={{ display: 'flex', gap: 4, fontSize: 13 }}><input type="checkbox" checked={Boolean(data[k])} onChange={(e) => set(k, e.target.checked)} />{label}</label>
    ))}</div>
  } else if (sec.kind === 'teeth') {
    const teeth = data.teeth || {}
    const cycle = (n) => {
      const order = TOOTH_STATUS.map(([k]) => k)
      const next = order[(order.indexOf(teeth[n] || 'sound') + 1) % order.length]
      setData((d) => ({ ...d, teeth: { ...(d.teeth || {}), [n]: next } }))
    }
    body = (
      <div>
        {TEETH.map((row, ri) => (
          <div key={ri} style={{ display: 'flex', gap: 3, justifyContent: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
            {row.map((n, i) => {
              const st = TOOTH_STATUS.find(([k]) => k === (teeth[n] || 'sound'))
              return <button key={n} type="button" aria-label={`Tooth ${n}: ${st[1]}`} onClick={() => cycle(n)}
                style={{ width: 34, height: 38, borderRadius: 6, border: '1px solid #98A2B3', background: st[2], fontSize: 11, fontWeight: 800, cursor: 'pointer', marginLeft: i === 8 ? 10 : 0 }}>{n}</button>
            })}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', fontSize: 11, marginTop: 4 }}>
          {TOOTH_STATUS.map(([k, l, c]) => <span key={k} style={{ display: 'flex', gap: 3, alignItems: 'center' }}><span style={{ width: 12, height: 12, background: c, border: '1px solid #98A2B3', borderRadius: 3 }} />{l}</span>)}
        </div>
      </div>
    )
  }
  return <div style={box}><div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>{sec.title}</div>{body}</div>
}
