// Chronic care (NCD) registry: who is enrolled, who is controlled, who is overdue or lost to follow-up,
// tracing, and 6 / 12-month cohort outcomes. Rules live in the database (20261117000000_ncd_registry.sql).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { canPerformAction, resolveRole } from '../access'
import supabase from '../supabase'
import { useHospital } from '../context'
import { CONTROL_STYLE, describeTargets, mergeTargets, NCD_FIELDS, pct, recallState, STATUS_LABEL } from '../utils/ncd'
import { inferChronicConditionHint } from '../utils/chronicDisease'
import { localDateKey } from '../utils/scheduling'
import EnrolmentDrawer from './ncd/EnrolmentDrawer'
import TracingList from './ncd/TracingList'
import { C, Chip, s } from './ncd/ui'

const PAGE = 25
const LABEL_TO_CODE = {
  'Type 2 Diabetes': 'dm', Hypertension: 'htn', Asthma: 'asthma', HIV: 'hiv', Tuberculosis: 'tb', 'Chronic Kidney Disease': 'ckd',
  COPD: 'copd', Epilepsy: 'epilepsy', 'Heart Failure': 'hf', 'Sickle Cell Disease': 'sickle',
}
const TABS = [['dashboard', 'Dashboard'], ['registry', 'Registry'], ['tracing', 'Tracing'], ['cohorts', 'Cohort outcomes']]
const blankEnrol = () => ({ patient: null, condition_code: 'htn', enrolled_on: localDateKey(), diagnosis_date: '', risk_class: '', clinician_id: '', baseline: {} })

function PatientPicker({ hospitalId, value, onPick }) {
  const [q, setQ] = useState(value?.full_name || '')
  const [results, setResults] = useState([])
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2 || term === value?.full_name) { setResults([]); return undefined }
    const t = setTimeout(async () => {
      const safe = term.replace(/[%,()]/g, ' ')
      const { data } = await supabase.from('patients').select('id, full_name, phone, patient_number, age, gender')
        .eq('hospital_id', hospitalId).or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%,patient_number.ilike.%${safe}%`).limit(10)
      setResults(data || [])
    }, 220)
    return () => clearTimeout(t)
  }, [q, hospitalId, value])
  return (
    <div style={{ position: 'relative' }}>
      <input aria-label="Search patient" style={s.input} value={q} placeholder="Type name, phone or patient number" onChange={(e) => { setQ(e.target.value); if (value) onPick(null) }} />
      {results.length > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 5, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 12px 24px rgba(15,23,42,.12)' }}>
          {results.map((p) => (
            <button key={p.id} type="button" onClick={() => { onPick(p); setQ(p.full_name); setResults([]) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', borderBottom: `1px solid ${C.border}`, background: 'none', cursor: 'pointer' }}>
              <strong>{p.full_name}</strong> <span style={s.sub}>{[p.patient_number, p.phone, p.age ? `${p.age}y` : null].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ChronicDisease() {
  const { hospitalId, userRole, navigationState, clearNavigationState, navigate } = useHospital()
  const canEdit = resolveRole(userRole) === 'Admin' || canPerformAction(userRole, 'write_diagnosis') || canPerformAction(userRole, 'record_vitals')
  const [tab, setTab] = useState('dashboard')
  const [config, setConfig] = useState([])
  const [summary, setSummary] = useState([])
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({ condition: '', status: 'active', control: '', due: '', q: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [open, setOpen] = useState(null)
  const [enrol, setEnrol] = useState(null)
  const [staff, setStaff] = useState([])
  const [cohort, setCohort] = useState({ condition: '', from: localDateKey(Date.now() - 400 * 86400000), to: localDateKey(Date.now() - 180 * 86400000), six: null, twelve: null, busy: false })

  const conditions = useMemo(() => {
    const map = new Map()
    config.forEach((c) => { if (!map.has(c.code) || c.hospital_id) map.set(c.code, c) })
    return [...map.values()].filter((c) => c.active !== false).sort((a, b) => a.label.localeCompare(b.label))
  }, [config])
  const targetsFor = useCallback((code) => mergeTargets(config.find((c) => c.code === code && !c.hospital_id)?.targets, config.find((c) => c.code === code && c.hospital_id)?.targets), [config])

  const loadSummary = useCallback(async () => {
    const [cfg, sum, st] = await Promise.all([
      supabase.from('ncd_condition_config').select('*'),
      supabase.rpc('ncd_summary', { p_hospital: hospitalId }),
      supabase.from('staff').select('id, full_name, role, department').eq('hospital_id', hospitalId).eq('status', 'Active').order('full_name'),
    ])
    if (cfg.error || sum.error) setError(`The chronic care registry is not installed yet (${(cfg.error || sum.error).message}). Run docs/sql/06_ncd_registry.sql in Supabase.`)
    setConfig(cfg.data || [])
    setSummary(sum.data || [])
    setStaff(st.data || [])
  }, [hospitalId])

  const loadRows = useCallback(async () => {
    setLoading(true)
    let patientIds = null
    const term = filters.q.trim().replace(/[%,()]/g, ' ')
    if (term.length >= 2) {
      const { data } = await supabase.from('patients').select('id').eq('hospital_id', hospitalId)
        .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,patient_number.ilike.%${term}%`).limit(300)
      patientIds = (data || []).map((p) => p.id)
    }
    let q = supabase.from('ncd_enrolments').select('*, patients(full_name, phone, patient_number, age, gender)', { count: 'exact' }).eq('hospital_id', hospitalId)
    if (filters.condition) q = q.eq('condition_code', filters.condition)
    if (filters.status) q = q.eq('status', filters.status)
    if (filters.control) q = q.eq('control_status', filters.control)
    if (filters.due === 'overdue') q = q.lt('next_visit_due', localDateKey())
    if (filters.due === 'week') q = q.gte('next_visit_due', localDateKey()).lte('next_visit_due', localDateKey(Date.now() + 7 * 86400000))
    if (filters.due === 'refill') q = q.lte('refill_due', localDateKey(Date.now() + 7 * 86400000))
    if (patientIds) q = patientIds.length ? q.in('patient_id', patientIds) : q.eq('patient_id', '00000000-0000-0000-0000-000000000000')
    const { data, count: n, error: e } = await q.order('next_visit_due', { ascending: true, nullsFirst: false }).range((page - 1) * PAGE, page * PAGE - 1)
    if (e) setError(e.message)
    setRows(data || [])
    setCount(n || 0)
    setLoading(false)
  }, [hospitalId, filters, page])

  useEffect(() => { if (hospitalId) void loadSummary() }, [hospitalId, loadSummary])
  useEffect(() => { if (hospitalId) void loadRows() }, [hospitalId, loadRows])

  // From Consultation: "Add to chronic care" opens enrolment pre-filled.
  useEffect(() => {
    if (!navigationState?.patientId) return
    void (async () => {
      const { data } = await supabase.from('patients').select('id, full_name, phone, patient_number, age, gender').eq('id', navigationState.patientId).maybeSingle()
      const hint = navigationState.suggestedCondition || inferChronicConditionHint(navigationState.suggestedCondition)
      setEnrol({ ...blankEnrol(), patient: data || { id: navigationState.patientId, full_name: navigationState.patientName }, condition_code: LABEL_TO_CODE[hint] || 'htn' })
      clearNavigationState?.()
    })()
  }, [navigationState, clearNavigationState])

  const refresh = () => { void loadSummary(); void loadRows() }

  async function saveEnrolment() {
    if (!enrol.patient?.id) { setError('Pick the patient.'); return }
    const baseline = Object.fromEntries(Object.entries(enrol.baseline || {}).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, Number(v)]))
    const clinician = staff.find((x) => String(x.id) === String(enrol.clinician_id))
    const { data, error: e } = await supabase.from('ncd_enrolments').insert({
      hospital_id: hospitalId, patient_id: enrol.patient.id, condition_code: enrol.condition_code,
      condition_label: conditions.find((c) => c.code === enrol.condition_code)?.label || enrol.condition_code,
      enrolled_on: enrol.enrolled_on, diagnosis_date: enrol.diagnosis_date || null, risk_class: enrol.risk_class || null,
      clinician_id: clinician ? String(clinician.id) : null, clinician_name: clinician?.full_name || null, baseline,
    }).select('*, patients(full_name, phone, patient_number, age, gender)').single()
    if (e) { setError(/duplicate|unique/i.test(e.message) ? 'This patient is already in the register for that condition.' : e.message); return }
    // the baseline readings count as the first review
    if (Object.keys(baseline).length) {
      await supabase.from('ncd_visits').insert({ enrolment_id: data.id, hospital_id: hospitalId, patient_id: data.patient_id, visit_date: enrol.enrolled_on, ...baseline, notes: 'Baseline at enrolment' })
    }
    setEnrol(null); setNotice(`${data.patients?.full_name || 'Patient'} enrolled for ${data.condition_label}.`)
    refresh()
    setOpen(data)
  }

  async function runCohort() {
    setCohort((c) => ({ ...c, busy: true }))
    const args = (m) => ({ p_hospital: hospitalId, p_condition: cohort.condition || null, p_from: cohort.from, p_to: cohort.to, p_months: m })
    const [a, b] = await Promise.all([supabase.rpc('ncd_cohort', args(6)), supabase.rpc('ncd_cohort', args(12))])
    if (a.error || b.error) setError((a.error || b.error).message)
    setCohort((c) => ({ ...c, six: a.data?.[0] || null, twelve: b.data?.[0] || null, busy: false }))
  }

  const totals = summary.reduce((t, r) => ({ active: t.active + Number(r.active), controlled: t.controlled + Number(r.controlled), overdue: t.overdue + Number(r.overdue), ltfu: t.ltfu + Number(r.ltfu), tracing: t.tracing + Number(r.open_tracing), refills: t.refills + Number(r.refills_due_7d) }), { active: 0, controlled: 0, overdue: 0, ltfu: 0, tracing: 0, refills: 0 })
  const pages = Math.max(1, Math.ceil(count / PAGE))
  const setFilter = (patch) => { setPage(1); setFilters((f) => ({ ...f, ...patch })) }

  return (
    <section style={s.page}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={s.h1}>Chronic care registry</h1>
          <p style={{ ...s.sub, margin: '5px 0 0' }}>Hypertension, diabetes, asthma, epilepsy, CKD, sickle cell, cancer, HIV, TB and mental health — control, recall and tracing.</p>
        </div>
        {canEdit && <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => setEnrol(blankEnrol())}>Enrol patient</button>}
      </header>
      {error && <div role="alert" style={s.err}>{error} <button type="button" style={{ ...s.btn, padding: '2px 8px', marginLeft: 8, ...s.ghost }} onClick={() => setError('')}>Dismiss</button></div>}
      {notice && <div role="status" style={s.ok}>{notice}</div>}

      <nav role="tablist" style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 16, overflowX: 'auto' }}>
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} type="button" onClick={() => setTab(key)}
            style={{ padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, color: tab === key ? C.primary : C.sub, borderBottom: `2px solid ${tab === key ? C.primary : 'transparent'}`, whiteSpace: 'nowrap' }}>
            {label}{key === 'tracing' && totals.tracing ? ` (${totals.tracing})` : ''}
          </button>
        ))}
      </nav>

      {tab === 'dashboard' && (
        <>
          <div style={{ ...s.grid(170), marginBottom: 16 }}>
            {[
              ['In care', totals.active, 'active patients', C.primary, () => { setFilter({ status: 'active', control: '', due: '' }); setTab('registry') }],
              ['Controlled', `${pct(totals.controlled, totals.active)}%`, `${totals.controlled} of ${totals.active}`, C.success, () => { setFilter({ status: 'active', control: 'controlled', due: '' }); setTab('registry') }],
              ['Overdue', totals.overdue, 'missed their review date', C.warn, () => { setFilter({ status: 'active', control: '', due: 'overdue' }); setTab('registry') }],
              ['Lost to follow-up', totals.ltfu, '28+ days late', C.danger, () => { setFilter({ status: 'ltfu', control: '', due: '' }); setTab('registry') }],
              ['To trace', totals.tracing, 'open tracing tasks', C.danger, () => setTab('tracing')],
              ['Refills this week', totals.refills, 'drugs running out', '#175CD3', () => { setFilter({ status: 'active', control: '', due: 'refill' }); setTab('registry') }],
            ].map(([label, value, sub, color, go]) => (
              <button key={label} type="button" onClick={go} style={{ ...s.card, textAlign: 'left', cursor: 'pointer' }}>
                <div style={s.label}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
                <div style={s.sub}>{sub}</div>
              </button>
            ))}
          </div>
          <div style={{ ...s.card, overflowX: 'auto' }}>
            <h2 style={s.h2}>By condition</h2>
            {summary.length === 0 ? <div style={s.sub}>No patients enrolled yet. Use “Enrol patient”, or “Add to chronic care” from a consultation.</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Condition', 'Active', 'Control rate', 'Uncontrolled', 'No reading', 'Overdue', 'LTFU', 'New this month', 'Target'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                <tbody>{summary.map((r) => {
                  const rate = pct(r.controlled, Number(r.controlled) + Number(r.uncontrolled))
                  return (
                    <tr key={r.condition_code} style={{ cursor: 'pointer' }} onClick={() => { setFilter({ condition: r.condition_code, status: 'active', control: '', due: '' }); setTab('registry') }}>
                      <td style={{ ...s.td, fontWeight: 700 }}>{r.condition_label}</td>
                      <td style={s.td}>{r.active}</td>
                      <td style={s.td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 80, height: 8, background: '#F2F4F7', borderRadius: 99 }} aria-hidden="true"><div style={{ width: `${rate}%`, height: 8, borderRadius: 99, background: rate >= 70 ? C.success : rate >= 50 ? C.warn : C.danger }} /></div>
                          <span>{rate}%</span>
                        </div>
                      </td>
                      <td style={s.td}>{r.uncontrolled}</td><td style={s.td}>{r.unknown}</td>
                      <td style={{ ...s.td, color: Number(r.overdue) ? C.warn : undefined, fontWeight: Number(r.overdue) ? 700 : 400 }}>{r.overdue}</td>
                      <td style={{ ...s.td, color: Number(r.ltfu) ? C.danger : undefined, fontWeight: Number(r.ltfu) ? 700 : 400 }}>{r.ltfu}</td>
                      <td style={s.td}>{r.new_this_month}</td>
                      <td style={{ ...s.td, ...s.sub }}>{describeTargets(targetsFor(r.condition_code)) || '—'}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            )}
            <div style={{ ...s.sub, marginTop: 8 }}>Control rate counts patients with a reading. Overdue = past their review date; LTFU = 28+ days late with no booking.</div>
          </div>
        </>
      )}

      {tab === 'registry' && (
        <div style={s.card}>
          <div style={{ ...s.grid(150), marginBottom: 12 }}>
            <input aria-label="Search patient" style={s.input} placeholder="Search name, phone, number" value={filters.q} onChange={(e) => setFilter({ q: e.target.value })} />
            <select aria-label="Condition" style={s.input} value={filters.condition} onChange={(e) => setFilter({ condition: e.target.value })}>
              <option value="">All conditions</option>{conditions.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
            <select aria-label="Status" style={s.input} value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
              <option value="">Any status</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select aria-label="Control" style={s.input} value={filters.control} onChange={(e) => setFilter({ control: e.target.value })}>
              <option value="">Any control</option>{Object.entries(CONTROL_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select aria-label="Due" style={s.input} value={filters.due} onChange={(e) => setFilter({ due: e.target.value })}>
              <option value="">Any due date</option><option value="overdue">Overdue</option><option value="week">Due this week</option><option value="refill">Refill due ≤ 7 days</option>
            </select>
          </div>
          {loading ? <div style={s.sub}>Loading…</div> : rows.length === 0 ? <div style={{ ...s.sub, padding: 20, textAlign: 'center' }}>No patients match.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Patient', 'Condition', 'Control', 'Last reading', 'Next visit', 'Refill', 'Clinician'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                <tbody>{rows.map((r) => {
                  const rc = recallState(r)
                  const lv = r.last_values || {}
                  const reading = Object.keys(NCD_FIELDS).filter((k) => lv[k] !== undefined && !['weight_kg', 'height_cm'].includes(k)).slice(0, 2)
                    .map((k) => (k === 'bp_sys' ? `BP ${lv.bp_sys}/${lv.bp_dia ?? '?'}` : k === 'bp_dia' ? null : `${NCD_FIELDS[k].label} ${lv[k]}`)).filter(Boolean).join(' · ')
                  return (
                    <tr key={r.id} onClick={() => setOpen(r)} style={{ cursor: 'pointer' }}>
                      <td style={s.td}><strong>{r.patients?.full_name || 'Patient'}</strong><div style={s.sub}>{[r.patients?.patient_number, r.patients?.phone].filter(Boolean).join(' · ')}</div></td>
                      <td style={s.td}>{r.condition_label}{r.status !== 'active' && <div><Chip tone="red">{STATUS_LABEL[r.status]}</Chip></div>}</td>
                      <td style={s.td}><Chip tone={CONTROL_STYLE[r.control_status]?.tone}>{CONTROL_STYLE[r.control_status]?.label}</Chip></td>
                      <td style={s.td}>{reading || '—'}{lv.visit_date && <div style={s.sub}>{lv.visit_date}</div>}</td>
                      <td style={s.td}>{rc ? <Chip tone={rc.tone}>{rc.label}</Chip> : '—'}</td>
                      <td style={s.td}>{r.refill_due || '—'}</td>
                      <td style={s.td}>{r.clinician_name || '—'}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <span style={s.sub}>{count} patient{count === 1 ? '' : 's'} · page {page} of {pages}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <button type="button" style={{ ...s.btn, ...s.ghost }} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'tracing' && <TracingList hospitalId={hospitalId} canEdit={canEdit} navigate={navigate} onOpenEnrolment={(e) => setOpen(e)} onChanged={refresh} />}

      {tab === 'cohorts' && (
        <div style={s.card}>
          <h2 style={s.h2}>Cohort outcomes</h2>
          <p style={{ ...s.sub, marginTop: -6 }}>Patients enrolled in the period, followed for 6 and 12 months: still in care, controlled at their latest visit (within 4 months), lost, died or transferred.</p>
          <div style={{ ...s.grid(170), alignItems: 'end' }}>
            <div><label style={s.label} htmlFor="c-cond">Condition</label>
              <select id="c-cond" style={s.input} value={cohort.condition} onChange={(e) => setCohort((c) => ({ ...c, condition: e.target.value }))}>
                <option value="">All conditions</option>{conditions.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select></div>
            <div><label style={s.label} htmlFor="c-from">Enrolled from</label><input id="c-from" type="date" style={s.input} value={cohort.from} onChange={(e) => setCohort((c) => ({ ...c, from: e.target.value }))} /></div>
            <div><label style={s.label} htmlFor="c-to">Enrolled to</label><input id="c-to" type="date" style={s.input} value={cohort.to} onChange={(e) => setCohort((c) => ({ ...c, to: e.target.value }))} /></div>
            <button type="button" style={{ ...s.btn, ...s.pri }} disabled={cohort.busy} onClick={runCohort}>{cohort.busy ? 'Calculating…' : 'Calculate'}</button>
          </div>
          {(cohort.six || cohort.twelve) && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
              <thead><tr>{['', 'Enrolled', 'In care', 'Controlled', 'Lost to follow-up', 'Died', 'Transferred out', 'Not yet reached'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>{[['6 months', cohort.six], ['12 months', cohort.twelve]].map(([label, r]) => r && (
                <tr key={label}>
                  <td style={{ ...s.td, fontWeight: 800 }}>{label}</td>
                  <td style={s.td}>{r.enrolled}</td>
                  <td style={s.td}>{r.in_care} <span style={s.sub}>({pct(r.in_care, Number(r.enrolled) - Number(r.not_yet_due))}%)</span></td>
                  <td style={s.td}>{r.controlled} <span style={s.sub}>({pct(r.controlled, r.in_care)}% of in care)</span></td>
                  <td style={s.td}>{r.ltfu}</td><td style={s.td}>{r.died}</td><td style={s.td}>{r.transferred}</td><td style={s.td}>{r.not_yet_due}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {enrol && (
        <div style={{ ...s.overlay, justifyContent: 'center', alignItems: 'center', padding: 16 }} role="dialog" aria-modal="true" aria-label="Enrol patient">
          <div style={{ ...s.card, width: 620, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={s.h2}>Enrol in chronic care</h2>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setEnrol(null)}>Close</button>
            </div>
            <label style={s.label}>Patient</label>
            <PatientPicker hospitalId={hospitalId} value={enrol.patient} onPick={(p) => setEnrol((x) => ({ ...x, patient: p }))} />
            <div style={{ ...s.grid(160), marginTop: 10 }}>
              <div><label style={s.label} htmlFor="n-cond">Condition</label>
                <select id="n-cond" style={s.input} value={enrol.condition_code} onChange={(e) => setEnrol((x) => ({ ...x, condition_code: e.target.value }))}>
                  {conditions.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select></div>
              <div><label style={s.label} htmlFor="n-date">Enrolled on</label><input id="n-date" type="date" style={s.input} max={localDateKey()} value={enrol.enrolled_on} onChange={(e) => setEnrol((x) => ({ ...x, enrolled_on: e.target.value }))} /></div>
              <div><label style={s.label} htmlFor="n-dx">Diagnosed</label><input id="n-dx" type="date" style={s.input} value={enrol.diagnosis_date} onChange={(e) => setEnrol((x) => ({ ...x, diagnosis_date: e.target.value }))} /></div>
              <div><label style={s.label} htmlFor="n-risk">Risk</label>
                <select id="n-risk" style={s.input} value={enrol.risk_class} onChange={(e) => setEnrol((x) => ({ ...x, risk_class: e.target.value }))}>
                  <option value="">—</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                </select></div>
              <div style={{ gridColumn: 'span 2' }}><label style={s.label} htmlFor="n-doc">Clinician</label>
                <select id="n-doc" style={s.input} value={enrol.clinician_id} onChange={(e) => setEnrol((x) => ({ ...x, clinician_id: e.target.value }))}>
                  <option value="">—</option>{staff.map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.role ? ` — ${m.role}` : ''}</option>)}
                </select></div>
            </div>
            <div style={{ ...s.label, marginTop: 12 }}>Baseline readings (optional — saved as the first review)</div>
            <div style={s.grid(120)}>
              {['bp_sys', 'bp_dia', 'fbs', 'hba1c', 'weight_kg', 'viral_load'].map((f) => (
                <div key={f}><label style={{ ...s.label, textTransform: 'none' }} htmlFor={`b-${f}`}>{NCD_FIELDS[f].label}</label>
                  <input id={`b-${f}`} type="number" step={NCD_FIELDS[f].step} style={s.input} value={enrol.baseline[f] ?? ''} onChange={(e) => setEnrol((x) => ({ ...x, baseline: { ...x.baseline, [f]: e.target.value } }))} /></div>
              ))}
            </div>
            <div style={{ ...s.sub, marginTop: 8 }}>Targets: {describeTargets(targetsFor(enrol.condition_code)) || 'none — outcomes and adherence are tracked'}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setEnrol(null)}>Cancel</button>
              <button type="button" style={{ ...s.btn, ...s.pri }} onClick={saveEnrolment}>Enrol</button>
            </div>
          </div>
        </div>
      )}

      {open && <EnrolmentDrawer key={open.id} enrolment={open} config={config} canEdit={canEdit} navigate={navigate}
        onClose={() => setOpen(null)} onChanged={async () => {
          refresh()
          const { data } = await supabase.from('ncd_enrolments').select('*, patients(full_name, phone, patient_number, age, gender)').eq('id', open.id).maybeSingle()
          if (data) setOpen(data)
        }} />}
    </section>
  )
}
