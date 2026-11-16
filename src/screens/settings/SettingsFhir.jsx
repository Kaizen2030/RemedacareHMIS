// Settings → FHIR API: API keys for outside systems (KHIS, SHA, partner EMRs, labs) and the log of every API call.
// Keys are created by the database (fhir_client_create), shown once, and stored only as a hash.
import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'
import { openConfirmDialog } from '../../confirmDialog'
import { C, Chip, s } from '../ncd/ui'

const RESOURCES = [
  ['Patient', 'Patients (demographics, IDs)'],
  ['Encounter', 'Visits'],
  ['Observation', 'Vital signs & viral loads'],
  ['Condition', 'Diagnoses'],
  ['MedicationRequest', 'Prescriptions'],
  ['DiagnosticReport', 'Lab reports'],
  ['Immunization', 'Immunisations'],
  ['Organization', 'This facility'],
  ['Practitioner', 'Staff names & roles'],
]
const BASE_URL = `${String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/fhir`

function friendly(e) {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Not installed yet. Run docs/sql/15_fhir_api.sql in Supabase.'
  return m
}

export default function SettingsFhir({ hospitalId }) {
  const [clients, setClients] = useState([])
  const [calls, setCalls] = useState([])
  const [form, setForm] = useState({ name: '', scopes: ['Patient', 'Encounter', 'Observation', 'Condition', 'MedicationRequest', 'DiagnosticReport', 'Immunization', 'Organization'], days: 365, confidential: false })
  const [newKey, setNewKey] = useState(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const [c, l] = await Promise.all([
      supabase.from('fhir_clients').select('id, name, key_prefix, scopes, allow_confidential, active, expires_at, last_used_at, created_at, revoked_at').eq('hospital_id', hospitalId).order('created_at', { ascending: false }),
      supabase.from('fhir_audit_log').select('*').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(150),
    ])
    if (c.error || l.error) setErr(friendly(c.error || l.error))
    setClients(c.data || []); setCalls(l.data || [])
  }, [hospitalId])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])

  const toggleScope = (r) => setForm((f) => ({ ...f, scopes: f.scopes.includes(r) ? f.scopes.filter((x) => x !== r) : [...f.scopes, r] }))

  async function create() {
    setErr(''); setNewKey(null); setCopied(false)
    if (!form.name.trim()) { setErr('Name the system that will use this key, e.g. "KHIS" or "Kenyatta referral EMR".'); return }
    if (!form.scopes.length) { setErr('Choose at least one kind of record.'); return }
    if (form.confidential && !await openConfirmDialog('This key will also return patients marked confidential (staff, VIPs, GBV survivors). Only allow this for a system with a legal need and its own access controls.', { title: 'Allow confidential records?', confirmLabel: 'Allow' })) return
    const { data, error } = await supabase.rpc('fhir_client_create', { p_hospital: hospitalId, p_name: form.name.trim(), p_scopes: form.scopes, p_days: Number(form.days), p_allow_confidential: form.confidential })
    if (error) { setErr(friendly(error)); return }
    setNewKey({ name: form.name.trim(), key: data.key })
    setForm((f) => ({ ...f, name: '', confidential: false }))
    void load()
  }
  async function revoke(c) {
    if (!await openConfirmDialog(`Revoke the key for "${c.name}"? That system will stop getting data immediately.`, { title: 'Revoke API key', confirmLabel: 'Revoke' })) return
    const { error } = await supabase.from('fhir_clients').update({ active: false, revoked_at: new Date().toISOString() }).eq('id', c.id)
    if (error) setErr(friendly(error)); else void load()
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setCopied(false) }
  }

  const now = new Date()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <div role="alert" style={s.err}>{err} <button type="button" style={{ ...s.btn, ...s.ghost, padding: '2px 8px' }} onClick={() => setErr('')}>Dismiss</button></div>}

      <div style={s.card}>
        <h2 style={s.h2}>FHIR R4 API</h2>
        <p style={{ ...s.sub, marginTop: -6 }}>Lets other systems read this hospital's records in the HL7 FHIR R4 standard: KHIS, SHA, referral hospitals, partner EMRs and labs. Read-only. Each system gets its own key, limited to the records you choose; every request is logged below and each patient it touches appears in 🔒 Privacy &amp; access log. Clinical searches must name one patient — nothing can download the whole register.</p>
        <div style={{ fontSize: 12, background: C.bg, padding: 10, borderRadius: 8, fontFamily: 'monospace', wordBreak: 'break-all' }}>
          <div><b>Base URL:</b> {BASE_URL}</div>
          <div style={{ marginTop: 6, color: C.sub }}>curl -H "Authorization: Bearer rcf_…" "{BASE_URL}/Patient?identifier=https://health.go.ke/identifier/national-id|12345678"</div>
          <div style={{ color: C.sub }}>curl -H "Authorization: Bearer rcf_…" "{BASE_URL}/Patient/&lt;id&gt;/$everything"</div>
          <div style={{ color: C.sub }}>Supported: Patient, Encounter, Observation, Condition, MedicationRequest, DiagnosticReport, Immunization, Organization, Practitioner — details at {BASE_URL}/metadata</div>
        </div>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>New API key</h2>
        <div style={{ ...s.grid(200), alignItems: 'end' }}>
          <div><label style={s.label} htmlFor="fk-name">System name</label><input id="fk-name" style={s.input} value={form.name} placeholder="e.g. KHIS, AAR Insurance, KNH referrals" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
          <div><label style={s.label} htmlFor="fk-days">Expires</label>
            <select id="fk-days" style={s.input} value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))}>
              <option value={30}>In 30 days</option><option value={90}>In 90 days</option><option value={365}>In 1 year</option><option value={0}>Never (not recommended)</option>
            </select></div>
        </div>
        <fieldset style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', marginTop: 10 }}>
          <legend style={s.label}>May read</legend>
          <div style={s.grid(210)}>{RESOURCES.map(([r, l]) => (
            <label key={r} style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={form.scopes.includes(r)} onChange={() => toggleScope(r)} />{l}</label>
          ))}</div>
        </fieldset>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={form.confidential} onChange={(e) => setForm((f) => ({ ...f, confidential: e.target.checked }))} />Include confidential patients</label>
          <button type="button" style={{ ...s.btn, ...s.pri, marginLeft: 'auto' }} onClick={create}>Create key</button>
        </div>
        {newKey && (
          <div role="status" style={{ marginTop: 12, padding: 12, borderRadius: 10, background: C.warnL, border: `1px solid ${C.warn}` }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Key for {newKey.name} — copy it now. It will not be shown again.</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ background: '#fff', padding: '6px 8px', borderRadius: 6, wordBreak: 'break-all', flex: 1, minWidth: 240 }}>{newKey.key}</code>
              <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => copy(newKey.key)}>{copied ? 'Copied' : 'Copy'}</button>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setNewKey(null)}>Done</button>
            </div>
            <div style={{ ...s.sub, marginTop: 6 }}>Send it to the other system's technical team by a secure channel (not plain e-mail or WhatsApp). If it leaks, revoke it and create a new one.</div>
          </div>
        )}
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Keys</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['System', 'Key', 'May read', 'Expires', 'Last used', 'Status', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{clients.map((c) => {
              const expired = c.expires_at && new Date(c.expires_at) < now
              const status = !c.active ? ['Revoked', 'gray'] : expired ? ['Expired', 'yellow'] : ['Active', 'green']
              return (
                <tr key={c.id}>
                  <td style={s.td}>{c.name}{c.allow_confidential ? <div><Chip tone="red">incl. confidential</Chip></div> : null}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace' }}>{c.key_prefix}…</td>
                  <td style={s.td}>{(c.scopes || []).join(', ')}</td>
                  <td style={s.td}>{c.expires_at ? new Date(c.expires_at).toLocaleDateString('en-KE') : 'Never'}</td>
                  <td style={s.td}>{c.last_used_at ? new Date(c.last_used_at).toLocaleString('en-KE') : 'Not yet'}</td>
                  <td style={s.td}><Chip tone={status[1]}>{status[0]}</Chip></td>
                  <td style={s.td}>{c.active && <button type="button" style={{ ...s.btn, ...s.danger, padding: '3px 8px' }} onClick={() => revoke(c)}>Revoke</button>}</td>
                </tr>
              )
            })}</tbody>
          </table>
          {clients.length === 0 && !err && <div style={{ ...s.sub, padding: 12 }}>No API keys yet.</div>}
        </div>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>API calls</h2>
        <div style={{ overflowX: 'auto', maxHeight: 420 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['When', 'Who', 'Request', 'Records', 'Result', 'From'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{calls.map((r) => (
              <tr key={r.id}>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{r.created_at ? new Date(r.created_at).toLocaleString('en-KE') : '—'}</td>
                <td style={s.td}>{r.client_name || (r.user_id ? 'Staff sign-in' : '—')}</td>
                <td style={{ ...s.td, fontFamily: 'monospace' }}>{r.action} {r.resource_type}{r.resource_id ? `/${r.resource_id}` : ''}{r.query ? ` ${r.query}` : ''}</td>
                <td style={s.td}>{r.result_count ?? '—'}</td>
                <td style={s.td}><Chip tone={String(r.status).startsWith('ok') ? 'green' : 'red'}>{r.status}</Chip></td>
                <td style={s.td}>{r.caller_ip || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
          {calls.length === 0 && !err && <div style={{ ...s.sub, padding: 12 }}>No API calls yet.</div>}
        </div>
      </div>
    </div>
  )
}
