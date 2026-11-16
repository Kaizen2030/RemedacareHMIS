// Problem list and current medicines that follow the patient across visits, a "medicines reviewed" record, and the order
// set picker. Data: patient_problems / patient_medications / medication_reviews / order_sets (20261214000000).
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { openPromptDialog } from '../../confirmDialog'
import { orderSetRows, suggestOrderSets } from '../../utils/orderSetLibrary'

const box = { border: '1px solid #E4E7EC', borderRadius: 10, padding: 12, marginBottom: 10, background: '#fff' }
const inp = { boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 12 }
const btn = { padding: '5px 10px', borderRadius: 8, border: '1px solid #D0D5DD', background: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 12 }
const pri = { ...btn, background: '#175CD3', color: '#fff', border: 'none' }
const friendly = (e) => (/does not exist|schema cache|Could not find/i.test(e?.message || '') ? 'Problem list and order sets are not installed yet. Run docs/sql/32_problem_list_order_sets.sql in Supabase.'
  : /duplicate key|unique/i.test(e?.message || '') ? 'Already on the list.' : e?.message || String(e))

export function PatientContinuity({ hospitalId, patientId, visitId, diagnoses = [], prescriptions = [], doctorName }) {
  const [problems, setProblems] = useState([])
  const [meds, setMeds] = useState([])
  const [review, setReview] = useState(null)
  const [newProblem, setNewProblem] = useState('')
  const [newMed, setNewMed] = useState({ drug: '', dose: '', frequency: '', source: 'other_facility' })
  const [showResolved, setShowResolved] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const [p, m, r] = await Promise.all([
      supabase.from('patient_problems').select('*').eq('hospital_id', hospitalId).eq('patient_id', patientId).order('created_at'),
      supabase.from('patient_medications').select('*').eq('hospital_id', hospitalId).eq('patient_id', patientId).order('created_at'),
      supabase.from('medication_reviews').select('*').eq('hospital_id', hospitalId).eq('patient_id', patientId).order('reviewed_at', { ascending: false }).limit(1),
    ])
    if (p.error) { setErr(friendly(p.error)); return }
    setErr(''); setProblems(p.data || []); setMeds(m.data || []); setReview((r.data || [])[0] || null)
  }, [hospitalId, patientId])
  useEffect(() => { void load() }, [load])
  const act = async (promise) => { const { error } = await promise; if (error) setErr(friendly(error)); else { setErr(''); void load() } }

  const active = problems.filter((p) => p.status === 'active')
  const activeMeds = meds.filter((m) => m.status === 'active')
  const has = (desc, code) => active.some((p) => (code && p.icd10 === String(code).toUpperCase()) || p.problem.toLowerCase() === String(desc || '').toLowerCase())
  const todayDx = diagnoses.filter((d) => (d.description || d.code) && !has(d.description, d.code))
  const todayRx = prescriptions.filter((r) => r.drug_name && !activeMeds.some((m) => m.drug.toLowerCase() === r.drug_name.toLowerCase()))
  const addProblem = (problem, icd10 = null, chronic = false) => act(supabase.from('patient_problems').insert({ hospital_id: hospitalId, patient_id: patientId, visit_id: visitId ? String(visitId) : null, problem, icd10, chronic, noted_by_name: doctorName || null }))
  async function stopMed(m) {
    const reason = await openPromptDialog(`Why is ${m.drug} being stopped?`, { title: 'Stop medicine', placeholder: 'e.g. Side effect, course finished, changed to another drug', confirmLabel: 'Stop' })
    if (reason?.trim()) await act(supabase.from('patient_medications').update({ status: 'stopped', stop_reason: reason.trim() }).eq('id', m.id))
  }
  const reviewedToday = review && new Date(review.reviewed_at).toDateString() === new Date().toDateString()
  return (
    <div style={{ ...box, borderColor: '#D6BBFB', background: '#FCFAFF' }}>
      {err && <div role="alert" style={{ background: '#FEF3F2', color: '#B42318', borderRadius: 8, padding: 8, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ fontSize: 13 }}>Problem list</b>
            <label style={{ fontSize: 11 }}><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> show resolved</label></div>
          {problems.filter((p) => showResolved || p.status === 'active').map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12, padding: '4px 0', borderBottom: '1px solid #F2F4F7', opacity: p.status === 'active' ? 1 : 0.55 }}>
              <span>{p.problem}{p.icd10 ? ` (${p.icd10})` : ''}{p.chronic ? <b style={{ color: '#6941C6' }}> · chronic</b> : ''}{p.status !== 'active' ? ` · ${p.status}${p.resolved_on ? ` ${p.resolved_on}` : ''}` : ''}</span>
              {p.status === 'active' && <span style={{ display: 'flex', gap: 4 }}>
                <button type="button" style={btn} aria-label={`Resolve ${p.problem}`} onClick={() => act(supabase.from('patient_problems').update({ status: 'resolved' }).eq('id', p.id))}>Resolved</button>
                {!p.chronic && <button type="button" style={btn} aria-label={`Mark ${p.problem} chronic`} onClick={() => act(supabase.from('patient_problems').update({ chronic: true }).eq('id', p.id))}>Chronic</button>}
              </span>}
            </div>
          ))}
          {!active.length && <div style={{ fontSize: 12, color: '#667085' }}>No active problems recorded.</div>}
          {todayDx.length > 0 && <div style={{ marginTop: 6 }}>{todayDx.map((d, i) => (
            <button key={i} type="button" style={{ ...btn, marginRight: 4, marginTop: 4 }} onClick={() => addProblem(d.description || d.code, d.code || null)}>+ {d.description || d.code} (today)</button>
          ))}</div>}
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <input aria-label="New problem" placeholder="Add a problem (e.g. Asthma)" style={{ ...inp, flex: 1 }} value={newProblem} onChange={(e) => setNewProblem(e.target.value)} />
            <button type="button" style={btn} onClick={() => { if (newProblem.trim()) { void addProblem(newProblem.trim()); setNewProblem('') } }}>Add</button>
          </div>
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ fontSize: 13 }}>Current medicines</b>
            <span style={{ fontSize: 11, color: reviewedToday ? '#067647' : '#B54708' }}>{review ? `Reviewed ${new Date(review.reviewed_at).toLocaleDateString('en-KE')}` : 'Never reviewed'}</span></div>
          {activeMeds.map((m) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12, padding: '4px 0', borderBottom: '1px solid #F2F4F7' }}>
              <span><b>{m.drug}</b> {[m.dose, m.frequency].filter(Boolean).join(' ')}{m.source !== 'prescribed_here' ? <span style={{ color: '#667085' }}> · {m.source.replace(/_/g, ' ')}</span> : ''}</span>
              <span style={{ display: 'flex', gap: 4 }}>
                <button type="button" style={btn} aria-label={`Stop ${m.drug}`} onClick={() => stopMed(m)}>Stop</button>
                <button type="button" style={btn} aria-label={`${m.drug} finished`} onClick={() => act(supabase.from('patient_medications').update({ status: 'completed' }).eq('id', m.id))}>Finished</button>
              </span>
            </div>
          ))}
          {!activeMeds.length && <div style={{ fontSize: 12, color: '#667085' }}>No current medicines recorded.</div>}
          {todayRx.length > 0 && <div style={{ marginTop: 6 }}>{todayRx.map((r, i) => (
            <button key={i} type="button" style={{ ...btn, marginRight: 4, marginTop: 4 }} onClick={() => act(supabase.from('patient_medications').insert({ hospital_id: hospitalId, patient_id: patientId, drug: r.drug_name, dose: r.dosage || null, frequency: r.frequency || null, source: 'prescribed_here', added_by_name: doctorName || null }))}>+ {r.drug_name} (prescribed today, long-term)</button>
          ))}</div>}
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            <input aria-label="Medicine" placeholder="Medicine" style={{ ...inp, flex: 2, minWidth: 120 }} value={newMed.drug} onChange={(e) => setNewMed({ ...newMed, drug: e.target.value })} />
            <input aria-label="Dose" placeholder="Dose" style={{ ...inp, flex: 1, minWidth: 60 }} value={newMed.dose} onChange={(e) => setNewMed({ ...newMed, dose: e.target.value })} />
            <input aria-label="Frequency" placeholder="How often" style={{ ...inp, flex: 1, minWidth: 70 }} value={newMed.frequency} onChange={(e) => setNewMed({ ...newMed, frequency: e.target.value })} />
            <select aria-label="Source" style={inp} value={newMed.source} onChange={(e) => setNewMed({ ...newMed, source: e.target.value })}><option value="other_facility">From another facility</option><option value="over_the_counter">Over the counter</option><option value="herbal">Herbal</option><option value="prescribed_here">Prescribed here</option></select>
            <button type="button" style={btn} onClick={() => { if (newMed.drug.trim()) { void act(supabase.from('patient_medications').insert({ hospital_id: hospitalId, patient_id: patientId, ...newMed, drug: newMed.drug.trim(), added_by_name: doctorName || null })); setNewMed({ drug: '', dose: '', frequency: '', source: 'other_facility' }) } }}>Add</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" style={reviewedToday ? btn : pri} onClick={() => act(supabase.from('medication_reviews').insert({ hospital_id: hospitalId, patient_id: patientId, visit_id: visitId ? String(visitId) : null, reviewed_by_name: doctorName || null }))}>{reviewedToday ? 'Reviewed today ✓' : 'Mark medicines reviewed'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function OrderSetPicker({ hospitalId, patientId, visitId, diagnoses = [], diagnosisText = '', onApply }) {
  const [sets, setSets] = useState([])
  const [pick, setPick] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!hospitalId) return
    void supabase.from('order_sets').select('*').eq('hospital_id', hospitalId).eq('active', true).order('name').then(({ data }) => setSets(data || []))
  }, [hospitalId])
  const suggested = useMemo(() => suggestOrderSets(sets, { codes: diagnoses.map((d) => d.code), text: diagnosisText }), [sets, diagnoses, diagnosisText])
  if (!sets.length) return null
  const chosen = sets.find((s) => s.id === pick)
  async function apply(set) {
    setErr(''); setMsg('')
    const { error } = await supabase.from('order_set_uses').insert({ hospital_id: hospitalId, order_set_id: set.id, patient_id: patientId || null, visit_id: visitId ? String(visitId) : null })
    if (error) { setErr(friendly(error)); return }
    onApply(orderSetRows(set), set)
    setMsg(`${set.name} added: ${set.medications.length} medicine(s), ${set.labs.length} test(s). Review every line before saving.`)
    setPick('')
  }
  return (
    <div style={{ ...box, background: '#F5F8FF', borderColor: '#B2CCFF' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>Order sets</b>
        {suggested.map((s) => <button key={s.id} type="button" style={pri} onClick={() => apply(s)}>Use “{s.name}”</button>)}
        <select aria-label="Order set" style={{ ...inp, minWidth: 220 }} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{suggested.length ? 'Other order sets…' : 'Choose an order set…'}</option>
          {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {chosen && (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          {chosen.labs.length > 0 && <div><b>Tests:</b> {chosen.labs.map((l) => l.test_type).join(', ')}</div>}
          {chosen.medications.length > 0 && <div><b>Medicines:</b> {chosen.medications.map((m) => `${m.drug_name} ${m.dosage || ''}`.trim()).join('; ')}</div>}
          {chosen.instructions && <div><b>Instructions:</b> {chosen.instructions}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}><button type="button" style={pri} onClick={() => apply(chosen)}>Add to this consultation</button></div>
        </div>
      )}
      {err && <div role="alert" style={{ color: '#B42318', fontSize: 12, marginTop: 4 }}>{err}</div>}
      {msg && <div style={{ color: '#067647', fontSize: 12, marginTop: 4, fontWeight: 600 }}>{msg}</div>}
    </div>
  )
}
