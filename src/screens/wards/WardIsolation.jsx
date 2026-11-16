// Isolation precautions (contact / droplet / airborne / protective) and the bed types that suit them.
// The database refuses an unsuitable bed unless a reason is recorded (20261220000000_safety_checks.sql).
import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'
import { openPromptDialog } from '../../confirmDialog'

export const PRECAUTIONS = {
  contact: { label: 'Contact', hint: 'MRSA, CRE, C. difficile, scabies — gloves and gown', color: '#B54708', bg: '#FFFAEB' },
  droplet: { label: 'Droplet', hint: 'Influenza, meningococcus, pertussis — surgical mask within 1 m', color: '#175CD3', bg: '#EFF8FF' },
  airborne: { label: 'Airborne', hint: 'TB, measles, varicella — N95, door closed', color: '#B42318', bg: '#FEF3F2' },
  protective: { label: 'Protective', hint: 'Neutropenic / immunosuppressed — protect the patient', color: '#027A48', bg: '#ECFDF3' },
}
export const BED_ISOLATION = { '': 'Open bay (no isolation)', single_room: 'Single room', negative_pressure: 'Negative-pressure room', cohort: 'Cohort bay' }

/**
 * Before putting a patient in a bed: returns { ok: true, reason } (reason is null when the bed suits),
 * or { ok: false } when staff cancel. Silently allows placement if the check is not installed.
 */
export async function confirmBedForIsolation(bedId, patientId) {
  if (!bedId || !patientId) return { ok: true, reason: null }
  const { data, error } = await supabase.rpc('bed_isolation_check', { p_bed: String(bedId), p_patient: String(patientId) })
  if (error || !data) return { ok: true, reason: null }
  const reason = await openPromptDialog(`This patient needs ${data}. Use this bed anyway?`, {
    title: 'Isolation bed needed', placeholder: 'Why this bed (e.g. side rooms full, screens and N95 in place)', tone: 'danger', confirmLabel: 'Use this bed', cancelLabel: 'Choose another bed',
  })
  return reason && reason.trim() ? { ok: true, reason: reason.trim() } : { ok: false }
}

export function IsolationChips({ precautions = [] }) {
  return precautions.map((p) => PRECAUTIONS[p] && (
    <span key={p} title={PRECAUTIONS[p].hint} style={{ background: PRECAUTIONS[p].bg, color: PRECAUTIONS[p].color, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 800, marginRight: 4 }}>{PRECAUTIONS[p].label}</span>
  ))
}

/** Bed panel tab: the patient's precautions and (for ward managers) the bed's isolation type. */
export function BedIsolation({ hospitalId, bed, patientId, canManageBeds, styles = {}, onChanged }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState({ precaution: 'contact', reason: '' })
  const [err, setErr] = useState('')
  const [bedType, setBedTypeState] = useState(bed?.isolation_type || '')
  useEffect(() => { setBedTypeState(bed?.isolation_type || '') }, [bed?.id, bed?.isolation_type])
  const load = useCallback(async () => {
    if (!patientId) { setRows([]); return }
    const { data, error } = await supabase.from('patient_isolation').select('*').eq('hospital_id', hospitalId).eq('patient_id', patientId).order('started_at', { ascending: false })
    if (error && /does not exist|schema cache/i.test(error.message)) setErr('Run docs/sql/38_safety_checks.sql to switch on isolation tracking.')
    setRows(data || [])
  }, [hospitalId, patientId])
  useEffect(() => { void load() }, [load])
  const run = async (fn) => { setErr(''); try { await fn(); await load(); onChanged?.() } catch (e) { setErr(e.message || String(e)) } }
  const start = () => run(async () => {
    const { error } = await supabase.from('patient_isolation').insert({ hospital_id: hospitalId, patient_id: patientId, precaution: form.precaution, reason: form.reason })
    if (error) throw new Error(/unique|duplicate/i.test(error.message) ? 'This precaution is already active.' : error.message)
    setForm({ precaution: 'contact', reason: '' })
  })
  const end = (row) => run(async () => {
    const why = await openPromptDialog(`End ${PRECAUTIONS[row.precaution].label.toLowerCase()} isolation?`, { title: 'End isolation', placeholder: 'e.g. 3 negative cultures, 2 weeks of TB treatment', confirmLabel: 'End isolation' })
    if (!why) return
    const { error } = await supabase.from('patient_isolation').update({ ended_at: new Date().toISOString(), end_reason: why }).eq('id', row.id)
    if (error) throw error
  })
  const setBedType = (value) => run(async () => {
    const { error } = await supabase.from('beds').update({ isolation_type: value || null }).eq('id', bed.id)
    if (error) throw error
    setBedTypeState(value || '')
  })
  const [restrictions, setRestrictions] = useState([])
  const [noVisit, setNoVisit] = useState('')
  const loadRestrictions = useCallback(async () => {
    if (!patientId) { setRestrictions([]); return }
    const { data } = await supabase.from('visitor_restrictions').select('*').eq('hospital_id', hospitalId).eq('patient_id', patientId).is('lifted_at', null)
    setRestrictions(data || [])
  }, [hospitalId, patientId])
  useEffect(() => { void loadRestrictions() }, [loadRestrictions])
  const restrict = () => run(async () => {
    const { error } = await supabase.from('visitor_restrictions').insert({ hospital_id: hospitalId, patient_id: patientId, reason: noVisit.trim() })
    if (error) throw error
    setNoVisit(''); await loadRestrictions()
  })
  const lift = (r) => run(async () => {
    const { error } = await supabase.from('visitor_restrictions').update({ lifted_at: new Date().toISOString() }).eq('id', r.id)
    if (error) throw error
    await loadRestrictions()
  })
  const active = rows.filter((r) => !r.ended_at)
  const input = styles.input || { width: '100%', padding: 8, border: '1px solid #D0D5DD', borderRadius: 8, boxSizing: 'border-box' }
  const btn = styles.btn || { padding: '8px 12px', borderRadius: 8, border: 'none', background: '#0F6E56', color: '#fff', fontWeight: 700, cursor: 'pointer' }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {err && <div role="alert" style={{ background: '#FEF3F2', color: '#B42318', padding: '8px 10px', borderRadius: 8, fontSize: 12 }}>{err}</div>}
      <section>
        <div style={styles.sideSectionLabel}>Bed type</div>
        {canManageBeds
          ? <select aria-label="Bed isolation type" style={input} value={bedType} onChange={(e) => setBedType(e.target.value)}>{Object.entries(BED_ISOLATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          : <div style={{ fontSize: 13 }}>{BED_ISOLATION[bedType]}</div>}
        {bed?.isolation_override_reason && <div style={{ marginTop: 6, fontSize: 12, color: '#B42318' }}>Placed here despite isolation needs: {bed.isolation_override_reason}</div>}
      </section>
      {patientId ? (
        <section>
          <div style={styles.sideSectionLabel}>Isolation precautions</div>
          {active.length === 0 && <div style={{ fontSize: 12, color: '#667085' }}>No isolation in place.</div>}
          {active.map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #EAECF0' }}>
              <div><IsolationChips precautions={[r.precaution]} /> <span style={{ fontSize: 12 }}>{r.reason}</span><div style={{ fontSize: 11, color: '#667085' }}>since {String(r.started_at).slice(0, 10)} · {PRECAUTIONS[r.precaution].hint}</div></div>
              <button type="button" style={{ ...btn, background: '#fff', color: '#344054', border: '1px solid #D0D5DD' }} onClick={() => end(r)}>End</button>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', gap: 8, marginTop: 10 }}>
            <select aria-label="Precaution" style={input} value={form.precaution} onChange={(e) => setForm((x) => ({ ...x, precaution: e.target.value }))}>{Object.entries(PRECAUTIONS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select>
            <input aria-label="Isolation reason" style={input} placeholder="Organism or suspected condition" value={form.reason} onChange={(e) => setForm((x) => ({ ...x, reason: e.target.value }))} />
            <button type="button" style={btn} disabled={!form.reason.trim()} onClick={start}>Start isolation</button>
          </div>
          <div style={{ ...styles.sideSectionLabel, marginTop: 14 }}>Visitors</div>
          {restrictions.map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 12, padding: '4px 0' }}>
              <span style={{ color: '#B42318', fontWeight: 700 }}>No visitors without approval — {r.reason}</span>
              <button type="button" style={{ ...btn, background: '#fff', color: '#344054', border: '1px solid #D0D5DD' }} onClick={() => lift(r)}>Lift</button>
            </div>
          ))}
          {restrictions.length === 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
              <input aria-label="Visitor restriction reason" style={input} placeholder="Restrict visitors: reason (shown to the gate only as 'restricted')" value={noVisit} onChange={(e) => setNoVisit(e.target.value)} />
              <button type="button" style={btn} disabled={!noVisit.trim()} onClick={restrict}>Restrict visitors</button>
            </div>
          )}
        </section>
      ) : <div style={{ fontSize: 12, color: '#667085' }}>Admit a patient to record isolation precautions.</div>}
    </div>
  )
}

/** Ward page: everyone in isolation and whether their bed suits the precautions. */
export function IsolationBoard({ hospitalId, refreshKey }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    if (!hospitalId) return
    supabase.rpc('isolation_board', { p_hospital: hospitalId }).then(({ data }) => setRows(Array.isArray(data) ? data : []))
  }, [hospitalId, refreshKey])
  if (rows.length === 0) return null
  return (
    <section aria-label="Isolation" style={{ border: '1px solid #FECDCA', background: '#FFFBFA', borderRadius: 12, padding: 12, margin: '0 0 12px' }}>
      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>In isolation ({rows.length})</div>
      {rows.map((r) => (
        <div key={r.patient_id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, padding: '4px 0' }}>
          <strong>{r.full_name || 'Patient'}</strong><span style={{ color: '#667085' }}>{r.bed_number ? `bed ${r.bed_number}` : 'no bed'}</span>
          <IsolationChips precautions={r.precautions || []} />
          {r.problem && <span style={{ color: '#B42318', fontWeight: 700 }}>needs {r.problem}{r.override_reason ? ` (reason: ${r.override_reason})` : ''}</span>}
        </div>
      ))}
    </section>
  )
}
