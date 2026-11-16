// Radiology: worklist by modality and stage, scheduling by room (clash-checked by the database), examination
// (pregnancy check before ionising imaging, radiographer, contrast and dose), structured report templates,
// verification, critical results with acknowledgement, PACS viewer link and statistics.
// Orders come from Consultation into radiology_orders; 20261204000000_radiology.sql adds the rest.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { resolveRole } from '../access'
import supabase from '../supabase'
import { useHospital } from '../context'
import usePatientAccessLog from '../hooks/useAccessLog'
import { C, Chip, s } from './ncd/ui'
import { IONISING, MODALITIES, PREGNANCY_CHECK, TEMPLATES, buildReport, suggestCritical, suggestTemplate } from '../utils/radiologyTemplates'

const STAGES = [
  ['to_schedule', 'To schedule', (o) => (o.status || 'Requested') === 'Requested' && !o.scheduled_at],
  ['scheduled', 'Scheduled', (o) => (o.status || 'Requested') === 'Requested' && o.scheduled_at],
  ['in_progress', 'In progress', (o) => o.status === 'In Progress'],
  ['to_verify', 'To verify', (o) => o.status === 'Reported'],
  ['done', 'Verified', (o) => o.status === 'Verified'],
  ['cancelled', 'Cancelled', (o) => o.status === 'Cancelled'],
]
const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/critical_ack_at|accession_number|structured/.test(m) && /column|schema cache/i.test(m)) return 'Radiology upgrade not installed yet. Run docs/sql/22_radiology.sql in Supabase.'
  return m
}
const when = (v) => (v ? new Date(v).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const ago = (v) => { if (!v) return ''; const m = Math.round((Date.now() - new Date(v)) / 60000); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d` }

export default function Radiology() {
  const { hospitalId, userRole } = useHospital()
  const role = resolveRole(userRole)
  const canReport = ['Admin', 'Doctor', 'Lab Technician'].includes(role)
  const canVerify = ['Admin', 'Doctor'].includes(role)
  const [orders, setOrders] = useState([])
  const [patients, setPatients] = useState({})
  const [pacsUrl, setPacsUrl] = useState('')
  const [tab, setTab] = useState('worklist')
  const [stage, setStage] = useState('to_schedule')
  const [modality, setModality] = useState('All')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!hospitalId) return
    const { data, error } = await supabase.from('radiology_orders').select('*').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(800)
    if (error) { setErr(`Could not load radiology orders: ${friendly(error)}`); return }
    setErr('')
    const rows = data || []
    const ids = [...new Set(rows.map((r) => r.patient_id).filter(Boolean))]
    if (ids.length) {
      const res = await supabase.from('patients').select('id, full_name, patient_number, gender, age, dob').eq('hospital_id', hospitalId).in('id', ids)
      if (!res.error) setPatients(Object.fromEntries((res.data || []).map((p) => [p.id, p])))
    }
    setOrders(rows)
  }, [hospitalId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!hospitalId) return
    void supabase.from('hospitals').select('system_settings').eq('id', hospitalId).maybeSingle()
      .then(({ data }) => setPacsUrl(data?.system_settings?.integrations_config?.pacs_viewer_url || ''))
  }, [hospitalId])

  const critical = orders.filter((o) => o.critical && !o.critical_ack_at)
  const counts = Object.fromEntries(STAGES.map(([k, , f]) => [k, orders.filter(f).length]))
  const shown = useMemo(() => {
    const test = STAGES.find(([k]) => k === stage)[2]
    const term = search.trim().toLowerCase()
    return orders.filter(test)
      .filter((o) => modality === 'All' || String(o.modality || '').toLowerCase() === modality.toLowerCase())
      .filter((o) => !term || [patients[o.patient_id]?.full_name, patients[o.patient_id]?.patient_number, o.accession_number, o.modality, o.body_region, o.requesting_doctor, o.clinical_indication].some((v) => String(v || '').toLowerCase().includes(term)))
      .sort((a, b) => (String(a.priority).match(/stat|urgent|emerg/i) ? -1 : 0) - (String(b.priority).match(/stat|urgent|emerg/i) ? -1 : 0) || new Date(a.scheduled_at || a.created_at) - new Date(b.scheduled_at || b.created_at))
  }, [orders, stage, modality, search, patients])
  const openOrder = orders.find((o) => o.id === open)

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div><h1 style={s.h1}>Radiology & imaging</h1><div style={s.sub}>Worklists, structured reports, critical results and dose records.</div></div>
        <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => void load()}>Refresh</button>
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {notice && <div role="status" style={s.ok}>{notice}</div>}
      {critical.length > 0 && (
        <button type="button" onClick={() => setTab('critical')} style={{ ...s.err, display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
          ⚠ {critical.length} critical result{critical.length > 1 ? 's' : ''} not yet acknowledged by a clinician — open
        </button>
      )}
      <div role="tablist" aria-label="Radiology sections" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['worklist', 'Worklist'], ['critical', `Critical results (${critical.length})`], ['stats', 'Statistics']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...s.btn, ...(tab === k ? s.pri : s.ghost) }}>{l}</button>
        ))}
      </div>

      {tab === 'worklist' && <>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {STAGES.map(([k, l]) => <button key={k} type="button" aria-pressed={stage === k} onClick={() => setStage(k)} style={{ ...s.btn, ...(stage === k ? s.soft : s.ghost) }}>{l} ({counts[k]})</button>)}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <select aria-label="Modality" style={{ ...s.input, maxWidth: 180 }} value={modality} onChange={(e) => setModality(e.target.value)}><option>All</option>{MODALITIES.map((m) => <option key={m}>{m}</option>)}</select>
          <input aria-label="Search radiology orders" style={{ ...s.input, maxWidth: 360 }} placeholder="Search patient, accession, indication, doctor" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ ...s.card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['Patient', 'Examination', 'Indication', 'Requested by', stage === 'scheduled' ? 'Slot' : 'Ordered', 'Priority', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{shown.map((o) => (
              <tr key={o.id}>
                <td style={s.td}><b>{patients[o.patient_id]?.full_name || o.patient_name || 'Patient'}</b><div style={s.sub}>{patients[o.patient_id]?.patient_number} {o.accession_number ? `· ${o.accession_number}` : ''}</div></td>
                <td style={s.td}>{o.modality || '—'} · {o.body_region || '—'}{o.critical ? <> <Chip tone="red">critical</Chip></> : null}</td>
                <td style={{ ...s.td, minWidth: 160 }}>{o.clinical_indication || '—'}</td>
                <td style={s.td}>{o.requesting_doctor || '—'}</td>
                <td style={s.td}>{stage === 'scheduled' ? `${when(o.scheduled_at)}${o.room ? ` · ${o.room}` : ''}` : `${when(o.created_at)} (${ago(o.created_at)})`}</td>
                <td style={s.td}>{/stat|urgent|emerg/i.test(o.priority || '') ? <Chip tone="red">{o.priority}</Chip> : o.priority || 'Routine'}</td>
                <td style={s.td}><button type="button" style={{ ...s.btn, ...s.soft, padding: '4px 10px' }} onClick={() => setOpen(o.id)}>Open</button></td>
              </tr>
            ))}</tbody>
          </table>
          {!shown.length && <div style={{ ...s.sub, padding: 16 }}>Nothing in this list.</div>}
        </div>
      </>}
      {tab === 'critical' && <CriticalList orders={orders.filter((o) => o.critical)} patients={patients} onOpen={setOpen} onChanged={load} />}
      {tab === 'stats' && <Stats hospitalId={hospitalId} />}
      {openOrder && <OrderDrawer order={openOrder} patient={patients[openOrder.patient_id]} hospitalId={hospitalId} pacsUrl={pacsUrl} canReport={canReport} canVerify={canVerify}
        onClose={() => setOpen(null)} onChanged={load} onNotice={setNotice} />}
    </div>
  )
}

function CriticalList({ orders, patients, onOpen, onChanged }) {
  const [names, setNames] = useState({})
  const [err, setErr] = useState('')
  async function ack(o) {
    if (!names[o.id]?.trim()) { setErr('Type the name of the clinician who received the result.'); return }
    const { error } = await supabase.from('radiology_orders').update({ critical_ack_at: new Date().toISOString(), critical_ack_name: names[o.id].trim() }).eq('id', o.id)
    if (error) setErr(friendly(error)); else { setErr(''); onChanged() }
  }
  return (
    <div style={s.card}>
      <p style={{ ...s.sub, marginTop: 0 }}>Critical findings must be passed to the requesting clinician directly (phone or in person) and acknowledged here. Unacknowledged results stay at the top of Radiology.</p>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {orders.sort((a, b) => Boolean(a.critical_ack_at) - Boolean(b.critical_ack_at) || new Date(b.critical_notified_at) - new Date(a.critical_notified_at)).map((o) => (
        <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
          <div>
            <b>{patients[o.patient_id]?.full_name || 'Patient'}</b> · {o.modality} {o.body_region}
            <div style={{ color: C.danger, fontWeight: 700 }}>{o.critical_finding}</div>
            <div style={s.sub}>Reported {when(o.critical_notified_at)} · for {o.requesting_doctor || 'the requesting clinician'} <button type="button" style={{ ...s.btn, ...s.ghost, padding: '1px 6px' }} onClick={() => onOpen(o.id)}>Open</button></div>
          </div>
          {o.critical_ack_at
            ? <Chip tone="green">Acknowledged by {o.critical_ack_name} after {Math.round((new Date(o.critical_ack_at) - new Date(o.critical_notified_at)) / 60000)} min</Chip>
            : <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Chip tone="red">waiting {ago(o.critical_notified_at)}</Chip>
              <input aria-label="Clinician informed" style={{ ...s.input, width: 200 }} placeholder="Clinician informed" value={names[o.id] || ''} onChange={(e) => setNames({ ...names, [o.id]: e.target.value })} />
              <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => ack(o)}>Acknowledged</button>
            </div>}
        </div>
      ))}
      {!orders.length && <div style={s.sub}>No critical results.</div>}
    </div>
  )
}

function OrderDrawer({ order: o, patient, hospitalId, pacsUrl, canReport, canVerify, onClose, onChanged, onNotice }) {
  const allowed = usePatientAccessLog(hospitalId, o.patient_id, 'radiology')
  const [sched, setSched] = useState({ room: o.room || '', at: o.scheduled_at ? new Date(new Date(o.scheduled_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '', duration: o.duration_min || (IONISING.test(o.modality || '') && !/ct/i.test(o.modality || '') ? 15 : 30) })
  const [exam, setExam] = useState({ pregnancy_check: o.pregnancy_check || '', performed_by: o.performed_by || '', contrast: o.contrast || {}, dose: o.dose || {} })
  const [tpl, setTpl] = useState(o.template || suggestTemplate(o.modality, o.body_region))
  const [answers, setAnswers] = useState(o.structured || {})
  const [reportText, setReportText] = useState(o.report_text || '')
  const [impression, setImpression] = useState(o.impression || '')
  const [critical, setCritical] = useState(Boolean(o.critical))
  const [finding, setFinding] = useState(o.critical_finding || '')
  const [reporter, setReporter] = useState(o.reporter_name || '')
  const [cancel, setCancel] = useState('')
  const [dose, setDose] = useState(null)
  const [err, setErr] = useState('')
  const ionising = IONISING.test(o.modality || '')
  const locked = o.status === 'Verified' || o.status === 'Cancelled'
  const female = /^f/i.test(patient?.gender || '')
  const suggested = suggestCritical(tpl, answers, `${reportText} ${impression}`)

  useEffect(() => { if (o.patient_id && ionising) void supabase.rpc('radiology_patient_dose', { p_patient: o.patient_id }).then(({ data }) => setDose(data)) }, [o.patient_id, ionising])

  async function update(patch, ok) {
    setErr('')
    const { error } = await supabase.from('radiology_orders').update(patch).eq('hospital_id', hospitalId).eq('id', o.id)
    if (error) { setErr(friendly(error)); return false }
    if (ok) onNotice(ok)
    onChanged(); return true
  }
  async function report(status) {
    if (critical && !finding.trim()) { setErr('Describe the critical finding.'); return }
    const ok = await update({ template: tpl, structured: answers, report_text: reportText.trim() || null, impression: impression.trim() || null, report_date: new Date().toISOString(), status, critical, critical_finding: critical ? finding.trim() : null, reporter_name: reporter || null },
      status === 'Verified' ? 'Report verified.' : 'Report saved.')
    if (ok && o.visit_id) await returnToDoctor(hospitalId, o, onNotice)
    if (ok) onClose()
  }
  const viewer = pacsUrl && o.accession_number ? pacsUrl.replace('{accession}', encodeURIComponent(o.accession_number)) : ''

  if (!allowed) return <div style={s.overlay} onClick={onClose}><div style={s.drawer} onClick={(e) => e.stopPropagation()}><div role="alert" style={s.err}>This record is confidential. Open it again and give a reason to continue.</div></div></div>
  const t = TEMPLATES[tpl]
  return (
    <div style={s.overlay} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Imaging order" style={{ ...s.drawer, width: 780 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <h2 style={{ ...s.h2, fontSize: 18, marginBottom: 2 }}>{o.modality} · {o.body_region || '—'} <Chip>{o.status || 'Requested'}</Chip></h2>
            <div style={s.sub}>{patient?.full_name} {patient?.patient_number} · {patient?.gender || ''} {patient?.age ? `${patient.age} y` : ''} · {o.accession_number || 'no accession yet'} · ordered by {o.requesting_doctor || '—'} {when(o.created_at)}</div>
            <div style={{ fontSize: 13, marginTop: 6 }}><b>Indication:</b> {o.clinical_indication || '—'}{o.special_instructions ? ` · ${o.special_instructions}` : ''}</div>
            {dose && Number(dose.ionising_exams) > 0 && <div style={{ ...s.sub, marginTop: 4 }}>Last 12 months: {dose.ionising_exams} ionising exam(s){Number(dose.dlp_total) ? `, CT DLP total ${dose.dlp_total} mGy·cm` : ''}.</div>}
          </div>
          <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-start' }}>
            {viewer && /^https?:\/\//.test(viewer) && <a href={viewer} target="_blank" rel="noreferrer" style={{ ...s.btn, ...s.soft, textDecoration: 'none' }}>Images (PACS)</a>}
            <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={onClose}>Close</button>
          </div>
        </div>
        {err && <div role="alert" style={{ ...s.err, marginTop: 10 }}>{err}</div>}

        {!locked && (o.status || 'Requested') === 'Requested' && (
          <div style={{ ...s.card, marginTop: 10 }}>
            <b>Schedule</b>
            <div style={{ ...s.grid(160), marginTop: 6, alignItems: 'end' }}>
              <div><label style={s.label} htmlFor="rd-room">Room</label><input id="rd-room" style={s.input} placeholder="X-ray room 1, Ultrasound 2, CT" value={sched.room} onChange={(e) => setSched({ ...sched, room: e.target.value })} /></div>
              <div><label style={s.label} htmlFor="rd-at">Date and time</label><input id="rd-at" type="datetime-local" style={s.input} value={sched.at} onChange={(e) => setSched({ ...sched, at: e.target.value })} /></div>
              <div><label style={s.label} htmlFor="rd-dur">Minutes</label><input id="rd-dur" type="number" min="5" style={s.input} value={sched.duration} onChange={(e) => setSched({ ...sched, duration: e.target.value })} /></div>
              <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => update({ room: sched.room || null, scheduled_at: sched.at ? new Date(sched.at).toISOString() : null, duration_min: Number(sched.duration) || null }, 'Scheduled.')}>Save slot</button>
            </div>
          </div>
        )}

        {!locked && (
          <div style={{ ...s.card, marginTop: 10 }}>
            <b>Examination</b>
            <div style={{ ...s.grid(200), marginTop: 6 }}>
              {ionising && <div><label style={s.label} htmlFor="rd-preg">Pregnancy check *</label><select id="rd-preg" style={s.input} value={exam.pregnancy_check} onChange={(e) => setExam({ ...exam, pregnancy_check: e.target.value })}><option value="">Choose…</option>{Object.entries(PREGNANCY_CHECK).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{female && !exam.pregnancy_check && <div style={{ fontSize: 11, color: C.warn }}>Female patient: ask about pregnancy / LMP.</div>}</div>}
              <div><label style={s.label} htmlFor="rd-by">Radiographer / sonographer</label><input id="rd-by" style={s.input} value={exam.performed_by} onChange={(e) => setExam({ ...exam, performed_by: e.target.value })} /></div>
              <div><label style={s.label} htmlFor="rd-cagent">Contrast agent (if used)</label><input id="rd-cagent" style={s.input} placeholder="e.g. Omnipaque 350" value={exam.contrast.agent || ''} onChange={(e) => setExam({ ...exam, contrast: { ...exam.contrast, agent: e.target.value } })} /></div>
              {exam.contrast.agent && <>
                <div><label style={s.label} htmlFor="rd-cvol">Volume (mL)</label><input id="rd-cvol" type="number" style={s.input} value={exam.contrast.volume_ml || ''} onChange={(e) => setExam({ ...exam, contrast: { ...exam.contrast, volume_ml: e.target.value } })} /></div>
                <div><label style={s.label} htmlFor="rd-creac">Reaction</label><select id="rd-creac" style={s.input} value={exam.contrast.reaction || 'none'} onChange={(e) => setExam({ ...exam, contrast: { ...exam.contrast, reaction: e.target.value } })}><option value="none">None</option><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe (anaphylaxis)</option></select></div>
              </>}
              {/ct|computed/i.test(o.modality || '') && <>
                <div><label style={s.label} htmlFor="rd-ctdi">CTDIvol (mGy)</label><input id="rd-ctdi" type="number" style={s.input} value={exam.dose.ctdi || ''} onChange={(e) => setExam({ ...exam, dose: { ...exam.dose, ctdi: e.target.value } })} /></div>
                <div><label style={s.label} htmlFor="rd-dlp">DLP (mGy·cm)</label><input id="rd-dlp" type="number" style={s.input} value={exam.dose.dlp || ''} onChange={(e) => setExam({ ...exam, dose: { ...exam.dose, dlp: e.target.value } })} /></div>
              </>}
              {ionising && !/ct|computed/i.test(o.modality || '') && <>
                <div><label style={s.label} htmlFor="rd-dap">DAP (Gy·cm²)</label><input id="rd-dap" type="number" style={s.input} value={exam.dose.dap || ''} onChange={(e) => setExam({ ...exam, dose: { ...exam.dose, dap: e.target.value } })} /></div>
                {/fluoro|angio|interven/i.test(o.modality || '') && <div><label style={s.label} htmlFor="rd-ft">Fluoroscopy time (s)</label><input id="rd-ft" type="number" style={s.input} value={exam.dose.fluoro_s || ''} onChange={(e) => setExam({ ...exam, dose: { ...exam.dose, fluoro_s: e.target.value } })} /></div>}
              </>}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => update({ pregnancy_check: exam.pregnancy_check || null, performed_by: exam.performed_by || null, contrast: exam.contrast.agent ? exam.contrast : null, dose: Object.keys(exam.dose).length ? exam.dose : null, ...((o.status || 'Requested') === 'Requested' ? { status: 'In Progress' } : {}) }, 'Examination recorded.')}>{(o.status || 'Requested') === 'Requested' ? 'Start / record examination' : 'Save examination details'}</button>
              {(o.status || 'Requested') === 'Requested' && <>
                <input aria-label="Cancel reason" style={{ ...s.input, maxWidth: 240 }} placeholder="Reason to cancel" value={cancel} onChange={(e) => setCancel(e.target.value)} />
                <button type="button" style={{ ...s.btn, ...s.danger }} onClick={() => update({ status: 'Cancelled', cancel_reason: cancel }, 'Order cancelled.')}>Cancel order</button>
              </>}
            </div>
          </div>
        )}

        <div style={{ ...s.card, marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <b>Report</b>
            {!locked && canReport && <select aria-label="Template" style={{ ...s.input, maxWidth: 240 }} value={tpl} onChange={(e) => setTpl(e.target.value)}>{Object.entries(TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>}
          </div>
          {!locked && canReport && t.fields.length > 0 && (
            <div style={{ ...s.grid(200), marginTop: 8 }}>
              {t.fields.map((f) => (
                <div key={f.key}><label style={s.label} htmlFor={`tp-${f.key}`}>{f.label}</label>
                  {f.options ? <select id={`tp-${f.key}`} style={s.input} value={answers[f.key] || ''} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}><option value="">—</option>{f.options.map((x) => <option key={x}>{x}</option>)}</select>
                    : <input id={`tp-${f.key}`} type={f.type || 'text'} style={s.input} placeholder={f.placeholder} value={answers[f.key] || ''} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} />}
                </div>
              ))}
              <div style={{ gridColumn: '1 / -1' }}><button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setReportText(buildReport(tpl, answers))}>Write findings from the fields above (replaces the findings box)</button></div>
            </div>
          )}
          <label style={s.label} htmlFor="rd-find">Findings</label>
          <textarea id="rd-find" readOnly={locked || !canReport} style={{ ...s.input, minHeight: 120 }} value={reportText} onChange={(e) => setReportText(e.target.value)} />
          <label style={s.label} htmlFor="rd-imp">Impression</label>
          <textarea id="rd-imp" readOnly={locked || !canReport} style={{ ...s.input, minHeight: 60 }} value={impression} onChange={(e) => setImpression(e.target.value)} />
          {!locked && canReport && <>
            <div style={{ ...s.grid(220), marginTop: 8, alignItems: 'end' }}>
              <div><label style={s.label} htmlFor="rd-rep">Reported by</label><input id="rd-rep" style={s.input} value={reporter} onChange={(e) => setReporter(e.target.value)} /></div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, fontWeight: 700, color: C.danger }}><input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />Critical result</label>
            </div>
            {suggested && !critical && <div style={{ ...s.err, marginTop: 6, background: C.warnL, color: C.warn }}>This looks like a critical finding ({suggested}). Tick "Critical result" if so.</div>}
            {critical && <input aria-label="Critical finding" style={{ ...s.input, marginTop: 6, borderColor: C.danger }} placeholder="Critical finding, e.g. Large subdural haematoma with 8 mm midline shift" value={finding} onChange={(e) => setFinding(e.target.value)} />}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
              <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => report('Reported')}>Save report</button>
              {canVerify && <button type="button" style={{ ...s.btn, ...s.pri, background: C.success }} onClick={() => report('Verified')}>Verify and lock</button>}
            </div>
          </>}
          {o.reported_at && <div style={{ ...s.sub, marginTop: 6 }}>Reported {when(o.reported_at)}{o.reporter_name ? ` by ${o.reporter_name}` : ''}{o.verified_at ? ` · verified ${when(o.verified_at)}` : ''}</div>}
          {o.critical && <div style={{ ...s.err, marginTop: 6 }}>Critical: {o.critical_finding} {o.critical_ack_at ? `— acknowledged by ${o.critical_ack_name} ${when(o.critical_ack_at)}` : '— not yet acknowledged'}</div>}
        </div>
      </div>
    </div>
  )
}

// Once all imaging and lab work for the visit is done, send the patient back to the doctor (unchanged behaviour)
async function returnToDoctor(hospitalId, o, onNotice) {
  const [labs, imaging] = await Promise.all([
    supabase.from('lab_tests').select('id, status').eq('hospital_id', hospitalId).eq('visit_id', o.visit_id).not('status', 'in', '(Complete,Completed,Cancelled)'),
    supabase.from('radiology_orders').select('id, status').eq('hospital_id', hospitalId).eq('visit_id', o.visit_id).neq('id', o.id).not('status', 'in', '(Reported,Verified,Cancelled)'),
  ])
  if (labs.error || imaging.error) { onNotice('Report saved. The diagnostic queue could not be checked, so the visit was left where it is.'); return }
  if ((labs.data || []).length || (imaging.data || []).length) { onNotice('Report saved. The visit stays in diagnostics until its other tests are complete.'); return }
  const { error } = await supabase.from('visits').update({ status: 'Doctor' }).eq('hospital_id', hospitalId).eq('id', o.visit_id)
  if (error) { onNotice('Report saved, but the visit could not be returned to the doctor queue.'); return }
  try { window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: o.visit_id, status: 'Doctor', source: 'radiology-report' } })) } catch { /* ignore */ }
  onNotice('Report saved and the patient returned to the doctor queue.')
}

function Stats({ hospitalId }) {
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { void supabase.rpc('radiology_stats', { p_hospital: hospitalId, p_from: range.from, p_to: range.to }).then(({ data, error }) => { if (error) setErr(/does not exist|schema cache/i.test(error.message) ? 'Run docs/sql/22_radiology.sql in Supabase.' : error.message); else { setErr(''); setD(data) } }) }, [hospitalId, range])
  const tile = (l, v, warn) => <div style={{ border: `1px solid ${warn ? C.danger : C.border}`, borderRadius: 10, padding: 12, background: '#fff' }}><div style={s.sub}>{l}</div><div style={{ fontSize: 22, fontWeight: 800, color: warn ? C.danger : undefined }}>{v ?? '—'}</div></div>
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input aria-label="From" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <input aria-label="To" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {d && <>
        <div style={s.grid(160)}>
          {tile('Orders', d.orders)}{tile('Not yet reported', d.unreported, d.unreported > 0)}{tile('Cancelled', d.cancelled)}
          {tile('Critical results', d.critical)}{tile('Critical not acknowledged', d.critical_unacknowledged, d.critical_unacknowledged > 0)}
          {tile('Time to acknowledge (median)', d.critical_ack_median_min === null ? null : `${d.critical_ack_median_min} min`, d.critical_ack_median_min > 60)}
          {tile('Contrast reactions', d.contrast_reactions, d.contrast_reactions > 0)}{tile('CT dose, median DLP', d.ct_dlp_median === null ? null : `${Math.round(d.ct_dlp_median)} mGy·cm`)}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 12 }}>
          <thead><tr>{['Modality', 'Orders', 'Order → exam (median h)', 'Exam → report (median h)'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{Object.entries(d.by_modality || {}).map(([m, v]) => <tr key={m}><td style={s.td}>{m}</td><td style={s.td}>{v.orders}</td><td style={s.td}>{v.order_to_exam_h ?? '—'}</td><td style={s.td}>{v.exam_to_report_h ?? '—'}</td></tr>)}</tbody>
        </table>
      </>}
    </div>
  )
}
