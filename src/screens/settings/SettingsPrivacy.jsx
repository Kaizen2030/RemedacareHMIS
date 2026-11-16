// Admin: who viewed which patient, break-glass review, confidential patients, and Data Protection Act requests
// (export everything held about a patient; de-identify contact details on an erasure request).
import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'
import PatientSearch from '../../components/PatientSearch'
import { downloadText } from '../../utils/khis'
import { openConfirmDialog } from '../../confirmDialog'
import { C, Chip, s } from '../ncd/ui'

const ACTION = { view: ['Viewed', 'gray'], print: ['Printed', 'blue'], export: ['Exported', 'yellow'], break_glass: ['Break-glass', 'red'], anonymise: ['De-identified', 'red'] }

export default function SettingsPrivacy({ hospitalId }) {
  const [log, setLog] = useState([])
  const [filter, setFilter] = useState({ action: '', patient: null })
  const [requests, setRequests] = useState([])
  const [req, setReq] = useState({ patient: null, request_type: 'access', details: '', verified_identity: false })
  const [conf, setConf] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    let q = supabase.from('patient_access_log').select('*, patients(full_name, patient_number)').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(300)
    if (filter.action) q = q.eq('action', filter.action)
    if (filter.patient) q = q.eq('patient_id', filter.patient.id)
    const [l, r] = await Promise.all([q, supabase.from('data_subject_requests').select('*, patients(full_name, patient_number)').eq('hospital_id', hospitalId).order('received_on', { ascending: false }).limit(100)])
    const e = l.error || r.error
    if (e) setErr(/does not exist|schema cache/i.test(e.message) ? 'Not installed yet. Run docs/sql/11_audit_privacy.sql in Supabase.' : /permission|row-level/i.test(e.message) ? 'Only administrators can see the access log.' : e.message)
    setLog(l.data || []); setRequests(r.data || [])
  }, [hospitalId, filter])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])

  async function addRequest() {
    if (!req.patient) { setErr('Pick the patient'); return }
    const { error } = await supabase.from('data_subject_requests').insert({ hospital_id: hospitalId, patient_id: req.patient.id, request_type: req.request_type, details: req.details || null, verified_identity: req.verified_identity })
    if (error) setErr(error.message); else { setReq({ patient: null, request_type: 'access', details: '', verified_identity: false }); setMsg('Request recorded.'); void load() }
  }
  async function exportFor(r) {
    const { data, error } = await supabase.rpc('dsr_export_patient', { p_hospital: hospitalId, p_patient: r.patient_id })
    if (error) { setErr(error.message); return }
    downloadText(`patient-data-${r.patients?.patient_number || r.patient_id}.json`, JSON.stringify(data, null, 2), 'application/json')
    await supabase.from('data_subject_requests').update({ status: 'in_progress' }).eq('id', r.id).eq('status', 'open')
    void load()
  }
  async function deidentify(r) {
    if (!r.verified_identity) { setErr('Verify the person\'s identity before processing an erasure request.'); return }
    if (!await openConfirmDialog('Remove phone, e-mail, address, ID and next-of-kin details for this patient? Clinical records are kept (legal retention). This cannot be undone.', { title: 'Erasure request', confirmLabel: 'De-identify' })) return
    const { data, error } = await supabase.rpc('dsr_deidentify_patient', { p_hospital: hospitalId, p_patient: r.patient_id, p_reason: `Data subject request ${r.id}` })
    if (error) { setErr(error.message); return }
    await supabase.from('data_subject_requests').update({ status: 'completed', completed_at: new Date().toISOString(), outcome: `Cleared: ${(data?.cleared || []).join(', ')}. Clinical record retained.` }).eq('id', r.id)
    setMsg('Contact and identity details removed; clinical record kept.'); void load()
  }
  async function closeRequest(r, status) {
    await supabase.from('data_subject_requests').update({ status, completed_at: new Date().toISOString() }).eq('id', r.id); void load()
  }
  async function setConfidential(value) {
    if (!conf) return
    const { error } = await supabase.from('patients').update({ confidential: value }).eq('id', conf.id)
    if (error) setErr(error.message); else { setMsg(value ? 'Marked confidential: staff must give a reason to open this record.' : 'No longer confidential.'); setConf({ ...conf, confidential: value }) }
  }

  const today = new Date().toISOString().slice(0, 10)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <div role="alert" style={s.err}>{err} <button type="button" style={{ ...s.btn, ...s.ghost, padding: '2px 8px' }} onClick={() => setErr('')}>Dismiss</button></div>}
      {msg && <div role="status" style={s.ok}>{msg}</div>}

      <div style={s.card}>
        <h2 style={s.h2}>Who opened patient records</h2>
        <div style={{ ...s.grid(200), marginBottom: 10 }}>
          <PatientSearch hospitalId={hospitalId} inputStyle={s.input} value={filter.patient} onPick={(p) => setFilter((f) => ({ ...f, patient: p }))} placeholder="Filter by patient (optional)" />
          <select aria-label="Action" style={s.input} value={filter.action} onChange={(e) => setFilter((f) => ({ ...f, action: e.target.value }))}>
            <option value="">All actions</option>{Object.entries(ACTION).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 420 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['When', 'Who', 'Patient', 'Action', 'Screen', 'Reason'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{log.map((r) => {
              const [l, tone] = ACTION[r.action] || [r.action, 'gray']
              return (
                <tr key={r.id}>
                  <td style={s.td}>{new Date(r.created_at).toLocaleString('en-KE')}</td>
                  <td style={s.td}>{r.user_email || (r.api_client_name ? `API: ${r.api_client_name}` : r.user_id)}<div style={s.sub}>{r.api_client_name ? 'FHIR API key' : r.user_role}</div></td>
                  <td style={s.td}>{r.patients?.full_name || r.patient_id}</td>
                  <td style={s.td}><Chip tone={tone}>{l}</Chip></td>
                  <td style={s.td}>{r.context || '—'}</td>
                  <td style={s.td}>{r.reason || '—'}</td>
                </tr>
              )
            })}</tbody>
          </table>
          {log.length === 0 && !err && <div style={{ ...s.sub, padding: 12 }}>No entries yet.</div>}
        </div>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Confidential patients</h2>
        <p style={{ ...s.sub, marginTop: -6 }}>For staff members as patients, VIPs, GBV survivors and similar: anyone except an administrator must give a reason to open the record, and every opening is listed above.</p>
        <div style={{ ...s.grid(220), alignItems: 'end' }}>
          <PatientSearch hospitalId={hospitalId} inputStyle={s.input} value={conf} onPick={setConf} />
          {conf && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Chip tone={conf.confidential ? 'red' : 'gray'}>{conf.confidential ? 'Confidential' : 'Normal'}</Chip>
            <button type="button" style={{ ...s.btn, ...(conf.confidential ? s.ghost : s.danger) }} onClick={() => setConfidential(!conf.confidential)}>{conf.confidential ? 'Remove flag' : 'Mark confidential'}</button>
          </div>}
        </div>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Data protection requests</h2>
        <p style={{ ...s.sub, marginTop: -6 }}>Requests from patients to see, correct or erase their data (Data Protection Act, 2019). The due date defaults to 7 days — confirm the timelines with your Data Protection Officer.</p>
        <div style={{ ...s.grid(170), alignItems: 'end' }}>
          <div style={{ gridColumn: 'span 2' }}><label style={s.label}>Patient</label><PatientSearch hospitalId={hospitalId} inputStyle={s.input} value={req.patient} onPick={(p) => setReq((x) => ({ ...x, patient: p }))} /></div>
          <div><label style={s.label} htmlFor="dsr-type">Request</label>
            <select id="dsr-type" style={s.input} value={req.request_type} onChange={(e) => setReq((x) => ({ ...x, request_type: e.target.value }))}>
              <option value="access">Access (copy of data)</option><option value="portability">Portability</option><option value="correction">Correction</option><option value="erasure">Erasure</option><option value="objection">Objection</option>
            </select></div>
          <div><label style={s.label} htmlFor="dsr-det">Details</label><input id="dsr-det" style={s.input} value={req.details} onChange={(e) => setReq((x) => ({ ...x, details: e.target.value }))} /></div>
          <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={req.verified_identity} onChange={(e) => setReq((x) => ({ ...x, verified_identity: e.target.checked }))} />Identity verified</label>
          <button type="button" style={{ ...s.btn, ...s.pri }} onClick={addRequest}>Record request</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 12 }}>
          <thead><tr>{['Received', 'Patient', 'Request', 'Due', 'Status', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{requests.map((r) => (
            <tr key={r.id}>
              <td style={s.td}>{r.received_on}</td><td style={s.td}>{r.patients?.full_name}</td><td style={s.td}>{r.request_type}{r.verified_identity ? '' : ' · identity not verified'}</td>
              <td style={{ ...s.td, color: r.status !== 'completed' && r.due_on < today ? C.danger : undefined, fontWeight: r.due_on < today ? 700 : 400 }}>{r.due_on}</td>
              <td style={s.td}><Chip tone={r.status === 'completed' ? 'green' : r.status === 'refused' ? 'gray' : 'yellow'}>{r.status.replace('_', ' ')}</Chip>{r.outcome ? <div style={s.sub}>{r.outcome}</div> : null}</td>
              <td style={s.td}>{r.status !== 'completed' && r.status !== 'refused' && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {['access', 'portability'].includes(r.request_type) && <button type="button" style={{ ...s.btn, ...s.soft, padding: '3px 8px' }} onClick={() => exportFor(r)}>Export data</button>}
                {r.request_type === 'erasure' && <button type="button" style={{ ...s.btn, ...s.danger, padding: '3px 8px' }} onClick={() => deidentify(r)}>De-identify</button>}
                <button type="button" style={{ ...s.btn, ...s.ghost, padding: '3px 8px' }} onClick={() => closeRequest(r, 'completed')}>Mark done</button>
                <button type="button" style={{ ...s.btn, ...s.ghost, padding: '3px 8px' }} onClick={() => closeRequest(r, 'refused')}>Refuse</button>
              </div>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
