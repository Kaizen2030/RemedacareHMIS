// One patient's chronic-care record for one condition: targets, trend of visits, record a structured visit,
// change status, and book the next visit (Appointments) in one click.
import { useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import {
  CONTROL_STYLE, describeTargets, evaluateControl, fieldsFor, mergeTargets, NCD_FIELDS, recallState, SCREENINGS, STATUS_LABEL,
} from '../../utils/ncd'
import { localDateKey } from '../../utils/scheduling'
import { Chip, s } from './ui'
import usePatientAccessLog from '../../hooks/useAccessLog'

const blankVisit = () => ({ visit_date: localDateKey(), adherence: '', medications: '', refill_days: '', next_visit_date: '', notes: '', complications: '', screening: {} })

export default function EnrolmentDrawer({ enrolment, config, canEdit, onClose, onChanged, navigate }) {
  const [visits, setVisits] = useState([])
  const [form, setForm] = useState(blankVisit)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState({ value: enrolment.status, reason: '' })
  const [targetEdit, setTargetEdit] = useState(JSON.stringify(enrolment.targets || {}))

  const code = enrolment.condition_code
  const defaults = config.find((c) => c.code === code && !c.hospital_id)?.targets
  const hospitalTargets = config.find((c) => c.code === code && c.hospital_id)?.targets
  const targets = mergeTargets(defaults, hospitalTargets, enrolment.targets)
  const fields = fieldsFor(code)
  const preview = evaluateControl(form, targets)
  const recall = recallState(enrolment)
  const patient = enrolment.patients || {}
  const recordAllowed = usePatientAccessLog(enrolment.hospital_id, enrolment.patient_id, 'chronic care')

  async function load() {
    const { data, error: e } = await supabase.from('ncd_visits').select('*').eq('enrolment_id', enrolment.id).order('visit_date', { ascending: false }).limit(50)
    if (e) setError(e.message)
    setVisits(data || [])
  }
  useEffect(() => { void load() }, [enrolment.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const trend = useMemo(() => fields.filter((f) => visits.some((v) => v[f] !== null && v[f] !== undefined)), [fields, visits])

  async function saveVisit() {
    setBusy(true); setError(''); setNotice('')
    const row = { enrolment_id: enrolment.id, hospital_id: enrolment.hospital_id, patient_id: enrolment.patient_id, visit_date: form.visit_date,
      adherence: form.adherence || null, medications: form.medications || null, notes: form.notes || null, complications: form.complications || null,
      refill_days: form.refill_days ? Number(form.refill_days) : null, next_visit_date: form.next_visit_date || null, screening: form.screening || {} }
    for (const f of fields) row[f] = form[f] === '' || form[f] === undefined ? null : Number(form[f])
    const { error: e } = await supabase.from('ncd_visits').insert(row)
    setBusy(false)
    if (e) { setError(e.message); return }
    setForm(blankVisit())
    setNotice(`Visit saved — ${CONTROL_STYLE[preview].label.toLowerCase()}.`)
    await load(); onChanged?.()
  }

  async function saveStatus() {
    if (status.value === enrolment.status) return
    if (['died', 'transferred_out', 'refused', 'discharged'].includes(status.value) && !status.reason.trim()) { setError('Give a reason for the status change.'); return }
    setBusy(true); setError('')
    const { error: e } = await supabase.from('ncd_enrolments').update({ status: status.value, status_reason: status.reason || null, status_date: localDateKey() }).eq('id', enrolment.id)
    setBusy(false)
    if (e) setError(e.message); else { setNotice('Status updated.'); onChanged?.() }
  }

  async function saveTargets() {
    let parsed
    try { parsed = JSON.parse(targetEdit || '{}') } catch { setError('Targets must look like {"hba1c_max": 7.9}'); return }
    setBusy(true); setError('')
    const { error: e } = await supabase.from('ncd_enrolments').update({ targets: parsed }).eq('id', enrolment.id)
    setBusy(false)
    if (e) setError(e.message); else { setNotice('Patient targets saved. The next visit is judged against them.'); onChanged?.() }
  }

  const bookNext = () => navigate?.('appointments', {
    patientId: enrolment.patient_id, patientName: patient.full_name || '', followUpDate: enrolment.next_visit_due && enrolment.next_visit_due >= localDateKey() ? enrolment.next_visit_due : null,
    followUpInDays: 7, appointmentType: 'Chronic care review', doctorId: enrolment.clinician_id || '', doctorName: enrolment.clinician_name || '',
    notes: `${enrolment.condition_label} review`, carePlanRef: enrolment.id, source: 'ncd-registry',
  })

  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-label={`${patient.full_name || 'Patient'} — ${enrolment.condition_label}`} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.drawer}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <h2 style={{ ...s.h1, fontSize: 18 }}>{patient.full_name || 'Patient'}</h2>
            <div style={s.sub}>{[patient.patient_number, patient.phone, enrolment.condition_label, `enrolled ${enrolment.enrolled_on}`].filter(Boolean).join(' · ')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <Chip tone={CONTROL_STYLE[enrolment.control_status]?.tone}>{CONTROL_STYLE[enrolment.control_status]?.label}</Chip>
              <Chip tone={enrolment.status === 'active' ? 'green' : 'red'}>{STATUS_LABEL[enrolment.status]}</Chip>
              {recall && <Chip tone={recall.tone}>{recall.label}</Chip>}
              {enrolment.risk_class && <Chip tone={enrolment.risk_class === 'high' ? 'red' : 'gray'}>{enrolment.risk_class} risk</Chip>}
              {enrolment.refill_due && <Chip tone="blue">Refill due {enrolment.refill_due}</Chip>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            {navigate && <button type="button" style={{ ...s.btn, ...s.soft }} onClick={bookNext}>Book next visit</button>}
            <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={onClose}>Close</button>
          </div>
        </div>

        {!recordAllowed && <div style={{ marginTop: 12 }}><div role="alert" style={{ padding: 16, background: '#FEF3F2', color: '#B42318', borderRadius: 10, fontWeight: 700 }}>This record is confidential. Open it again and give a reason to continue.</div></div>}
        {error && <div role="alert" style={{ ...s.err, marginTop: 12 }}>{error}</div>}
        {notice && <div role="status" style={{ ...s.ok, marginTop: 12 }}>{notice}</div>}

        <div style={{ ...s.card, marginTop: 14, padding: 12 }}>
          <div style={s.label}>Targets</div>
          <div>{describeTargets(targets) || 'No numeric target for this condition — track adherence and outcomes.'}</div>
        </div>

        {trend.length > 0 && (
          <div style={{ ...s.card, marginTop: 12, padding: 12, overflowX: 'auto' }}>
            <div style={s.label}>Trend</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr><th style={s.th}>Date</th>{trend.map((f) => <th key={f} style={s.th}>{NCD_FIELDS[f].label}</th>)}<th style={s.th}>Adherence</th><th style={s.th}>Result</th></tr></thead>
              <tbody>{visits.slice(0, 12).map((v) => (
                <tr key={v.id}>
                  <td style={s.td}>{v.visit_date}</td>
                  {trend.map((f) => <td key={f} style={s.td}>{v[f] ?? '—'}</td>)}
                  <td style={s.td}>{v.adherence || '—'}</td>
                  <td style={s.td}><Chip tone={CONTROL_STYLE[v.control_status]?.tone}>{CONTROL_STYLE[v.control_status]?.label}</Chip></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {canEdit && ['active', 'ltfu'].includes(enrolment.status) && (
          <div style={{ ...s.card, marginTop: 12 }}>
            <h3 style={s.h2}>Record a review</h3>
            <div style={s.grid(130)}>
              <div><label style={s.label} htmlFor="v-date">Date</label><input id="v-date" type="date" style={s.input} max={localDateKey()} value={form.visit_date} onChange={(e) => setForm((f) => ({ ...f, visit_date: e.target.value }))} /></div>
              {fields.map((f) => (
                <div key={f}>
                  <label style={s.label} htmlFor={`v-${f}`}>{NCD_FIELDS[f].label}{NCD_FIELDS[f].unit ? ` (${NCD_FIELDS[f].unit})` : ''}</label>
                  <input id={`v-${f}`} type="number" inputMode="decimal" step={NCD_FIELDS[f].step} style={s.input} value={form[f] ?? ''} onChange={(e) => setForm((x) => ({ ...x, [f]: e.target.value }))} />
                </div>
              ))}
              <div><label style={s.label} htmlFor="v-adh">Adherence</label>
                <select id="v-adh" style={s.input} value={form.adherence} onChange={(e) => setForm((f) => ({ ...f, adherence: e.target.value }))}>
                  <option value="">—</option><option value="good">Good (&gt;95%)</option><option value="fair">Fair (85–95%)</option><option value="poor">Poor (&lt;85%)</option>
                </select>
              </div>
              <div><label style={s.label} htmlFor="v-refill">Drugs given for (days)</label><input id="v-refill" type="number" min={1} max={365} style={s.input} value={form.refill_days} onChange={(e) => setForm((f) => ({ ...f, refill_days: e.target.value }))} /></div>
              <div><label style={s.label} htmlFor="v-next">Next visit</label><input id="v-next" type="date" style={s.input} min={localDateKey()} value={form.next_visit_date} onChange={(e) => setForm((f) => ({ ...f, next_visit_date: e.target.value }))} /></div>
            </div>
            {(SCREENINGS[code] || []).length > 0 && (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
                {SCREENINGS[code].map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                    <input type="checkbox" checked={Boolean(form.screening?.[key])} onChange={(e) => setForm((f) => ({ ...f, screening: { ...f.screening, [key]: e.target.checked } }))} />{label}
                  </label>
                ))}
              </div>
            )}
            <div style={{ ...s.grid(220), marginTop: 10 }}>
              <div><label style={s.label} htmlFor="v-meds">Medication</label><input id="v-meds" style={s.input} value={form.medications} placeholder="e.g. Amlodipine 10mg OD" onChange={(e) => setForm((f) => ({ ...f, medications: e.target.value }))} /></div>
              <div><label style={s.label} htmlFor="v-comp">Complications</label><input id="v-comp" style={s.input} value={form.complications} onChange={(e) => setForm((f) => ({ ...f, complications: e.target.value }))} /></div>
            </div>
            <div style={{ marginTop: 10 }}><label style={s.label} htmlFor="v-notes">Notes</label><textarea id="v-notes" rows={2} style={s.input} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 10 }}>
              <span style={s.sub}>On these readings: <Chip tone={CONTROL_STYLE[preview].tone}>{CONTROL_STYLE[preview].label}</Chip></span>
              <button type="button" style={{ ...s.btn, ...s.pri }} disabled={busy || !form.visit_date} onClick={saveVisit}>{busy ? 'Saving…' : 'Save review'}</button>
            </div>
          </div>
        )}

        {canEdit && (
          <div style={{ ...s.card, marginTop: 12 }}>
            <h3 style={s.h2}>Status and targets</h3>
            <div style={s.grid(160)}>
              <div><label style={s.label} htmlFor="e-status">Status</label>
                <select id="e-status" style={s.input} value={status.value} onChange={(e) => setStatus((x) => ({ ...x, value: e.target.value }))}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}><label style={s.label} htmlFor="e-reason">Reason</label><input id="e-reason" style={s.input} value={status.reason} placeholder="e.g. Transferred to Kenyatta NCD clinic" onChange={(e) => setStatus((x) => ({ ...x, reason: e.target.value }))} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} disabled={busy || status.value === enrolment.status} onClick={saveStatus}>Update status</button>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={s.label} htmlFor="e-targets">This patient's own targets (overrides, optional)</label>
              <input id="e-targets" style={{ ...s.input, fontFamily: 'monospace' }} value={targetEdit} onChange={(e) => setTargetEdit(e.target.value)} />
              <div style={{ ...s.sub, marginTop: 4 }}>e.g. {'{"hba1c_max": 7.9}'} for an elderly patient. Leave {'{}'} to use the clinic targets.</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                <button type="button" style={{ ...s.btn, ...s.ghost }} disabled={busy} onClick={saveTargets}>Save targets</button>
              </div>
            </div>
          </div>
        )}
        <div style={{ height: 24 }} />
      </div>
    </div>
  )
}
