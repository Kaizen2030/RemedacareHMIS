// Patients screen: patient-portal codes and the facilities of the same organisation (network).
//   PatientNetworkPanel  — on a patient's record: give a portal code; see visits at sister facilities.
//   NetworkPatientImport — "From another facility": find a patient registered at a sister facility and register here.
import { useState } from 'react'
import supabase from '../../supabase'

const C = { brand: '#0F6E56', brandL: '#E1F5EE', border: '#E4E7EC', sub: '#667085', danger: '#B42318', dangerL: '#FEF3F2' }
const st = {
  box: { border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginTop: 14, background: '#fff' },
  title: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: C.sub, marginBottom: 8 },
  btn: { padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 },
  pri: { background: C.brand, color: '#fff', border: 'none' },
  err: { background: C.dangerL, color: C.danger, padding: '8px 10px', borderRadius: 8, fontSize: 13, marginTop: 8 },
  input: { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid #F2F4F7', fontSize: 13 },
}
const friendly = (e) => (/does not exist|schema cache|Could not find/i.test(e?.message || '') ? 'Not installed yet: run docs/sql/17_patient_portal_and_networks.sql in Supabase.' : e?.message || String(e))
export const portalUrl = () => {
  const origin = typeof window !== 'undefined' && /^https?:/.test(window.location.origin) ? window.location.origin : (import.meta.env.VITE_SITE_URL || 'https://remedacarehms.com')
  return `${origin.replace(/\/$/, '')}/#/portal`
}

export function PatientNetworkPanel({ patient, hospitalId }) {
  const [code, setCode] = useState(null)
  const [history, setHistory] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  if (!patient?.id) return null

  async function makeCode() {
    setErr(''); setBusy('code')
    const { data, error } = await supabase.rpc('portal_staff_code', { p_patient: patient.id })
    setBusy('')
    if (error) setErr(friendly(error)); else setCode(data)
  }
  async function loadHistory() {
    setErr(''); setBusy('history')
    const { data, error } = await supabase.rpc('network_patient_history', { p_hospital: hospitalId, p_patient: patient.id })
    setBusy('')
    if (error) setErr(friendly(error)); else setHistory((data || []).sort((a, b) => String(b.happened_at).localeCompare(String(a.happened_at))))
  }
  function printCode() {
    const w = window.open('', '_blank', 'width=420,height=520')
    if (!w) return
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    w.document.write(`<html><body style="font-family:Arial;padding:24px;text-align:center"><h2>Your patient portal</h2>
      <p>Open <b>${esc(portalUrl())}</b> on your phone.</p><p>Enter your number (${esc(code.phone_hint)}) and tap <i>I have a code from reception</i>.</p>
      <div style="font-size:36px;letter-spacing:8px;font-weight:700;margin:16px 0">${esc(code.code)}</div>
      <p style="font-size:12px">Valid until ${esc(new Date(code.expires_at).toLocaleString('en-KE'))}. Do not share this code.</p>
      <script>setTimeout(()=>window.print(),300)</script></body></html>`)
    w.document.close()
  }

  return (
    <div style={st.box}>
      <div style={st.title}>Patient portal &amp; other facilities</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={{ ...st.btn, ...st.pri }} disabled={busy === 'code'} onClick={makeCode}>{busy === 'code' ? 'Creating…' : 'Give portal code'}</button>
        <button type="button" style={st.btn} disabled={busy === 'history'} onClick={loadHistory}>{busy === 'history' ? 'Loading…' : 'Records at our other facilities'}</button>
      </div>
      {err && <div role="alert" style={st.err}>{err}</div>}
      {code && (
        <div role="status" style={{ marginTop: 10, padding: 12, background: C.brandL, borderRadius: 10 }}>
          <div style={{ fontSize: 13 }}>Ask the patient to open <b>{portalUrl()}</b>, enter their number ({code.phone_hint}) and this code:</div>
          <div style={{ fontSize: 30, letterSpacing: 6, fontWeight: 800, margin: '6px 0', color: C.brand }}>{code.code}</div>
          <div style={{ fontSize: 12, color: C.sub }}>Valid for 24 hours, one sign-in. <button type="button" style={{ ...st.btn, padding: '3px 8px' }} onClick={printCode}>Print slip</button></div>
        </div>
      )}
      {history && (
        <div style={{ marginTop: 10 }}>
          {history.length === 0 && <div style={{ fontSize: 13, color: C.sub }}>No records at other facilities of this organisation. (Patients are linked when registered with "From another facility".)</div>}
          {history.map((h, i) => (
            <div key={i} style={st.row}>
              <div><b>{h.kind}</b> · {h.summary || '—'}</div>
              <div style={{ color: C.sub, whiteSpace: 'nowrap' }}>{h.hospital_name} · {h.happened_at ? new Date(h.happened_at).toLocaleDateString('en-KE') : ''}</div>
            </div>
          ))}
          {history.length > 0 && <div style={{ fontSize: 11, color: C.sub, marginTop: 6 }}>This look is recorded in the other facility's access log.</div>}
        </div>
      )}
    </div>
  )
}

export function NetworkPatientImport({ hospitalId, onClose, onImported }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function search(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    const { data, error } = await supabase.rpc('network_patient_search', { p_hospital: hospitalId, p_query: q })
    setBusy(false)
    if (error) { setErr(friendly(error)); setRows(null) } else setRows(data || [])
  }
  async function bringHere(r) {
    setErr(''); setBusy(true)
    const { data, error } = await supabase.rpc('network_patient_import', { p_hospital: hospitalId, p_source: r.patient_id })
    setBusy(false)
    if (error) setErr(friendly(error)); else onImported?.(data, r)
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Patient from another facility" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 18, width: 560, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Patient from another facility</h2>
          <button type="button" style={st.btn} onClick={onClose}>Close</button>
        </div>
        <p style={{ fontSize: 13, color: C.sub }}>Find someone already registered at one of your organisation's other facilities and register them here without re-typing. Their details are copied and both records are linked; clinical notes stay at the other facility (see "Records at our other facilities" on the patient).</p>
        <form onSubmit={search} style={{ display: 'flex', gap: 8 }}>
          <input aria-label="National ID, SHA number, phone, patient number or name" style={st.input} placeholder="National ID, SHA no., phone, patient no. or name" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" style={{ ...st.btn, ...st.pri }} disabled={busy || q.trim().length < 3}>Search</button>
        </form>
        {err && <div role="alert" style={st.err}>{err}</div>}
        {rows && rows.length === 0 && <div style={{ fontSize: 13, color: C.sub, marginTop: 10 }}>No one found at your other facilities.</div>}
        {rows && rows.map((r) => (
          <div key={r.patient_id} style={st.row}>
            <div>
              <div style={{ fontWeight: 700 }}>{r.full_name}</div>
              <div style={{ color: C.sub }}>{[r.gender, r.age && `${r.age} yrs`, r.national_id_hint && `ID ${r.national_id_hint}`, r.phone_hint && `phone ${r.phone_hint}`].filter(Boolean).join(' · ')} — {r.hospital_name}</div>
            </div>
            <button type="button" style={{ ...st.btn, ...(r.already_here ? {} : st.pri) }} disabled={busy} onClick={() => bringHere(r)}>{r.already_here ? 'Open here' : 'Register here'}</button>
          </div>
        ))}
      </div>
    </div>
  )
}
