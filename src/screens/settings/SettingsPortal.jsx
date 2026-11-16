// Settings → Patient portal: switch the portal on for this facility, choose what patients see, and review sign-ins.
import { useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import supabase from '../../supabase'
import { portalUrl } from '../patients/NetworkTools'
import { C, Chip, s } from '../ncd/ui'

const DEFAULT_SENSITIVE = ['hiv', 'viral load', 'cd4', 'pregnancy', 'hcg', 'hepatitis b', 'hbsag', 'syphilis', 'vdrl', 'genexpert', 'psa']
const EVENT = { code_sms: 'Code sent by SMS', code_reception: 'Code given at reception', code_wrong: 'Wrong code', code_unknown_phone: 'Unknown number', signed_in: 'Signed in', viewed: 'Viewed record', appointment_requested: 'Requested appointment', appointment_cancelled: 'Cancelled appointment' }

export default function SettingsPortal({ hospitalId }) {
  const [cfg, setCfg] = useState(null)
  const [events, setEvents] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [c, e] = await Promise.all([
      supabase.from('portal_settings').select('*').eq('hospital_id', hospitalId).maybeSingle(),
      supabase.from('portal_events').select('*').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(100),
    ])
    if (c.error) setErr(/does not exist|schema cache/i.test(c.error.message) ? 'Not installed yet. Run docs/sql/17_patient_portal_and_networks.sql in Supabase.' : c.error.message)
    setCfg(c.data || { hospital_id: hospitalId, enabled: false, show_results: true, allow_requests: true, sensitive_tests: DEFAULT_SENSITIVE, welcome_note: '' })
    setEvents(e.data || [])
  }, [hospitalId])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])

  async function save(next) {
    setErr(''); setMsg('')
    const row = { ...next, hospital_id: hospitalId, sensitive_tests: (next.sensitive_tests || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean), welcome_note: next.welcome_note || null }
    delete row.updated_at; delete row.updated_by
    const { error } = await supabase.from('portal_settings').upsert(row, { onConflict: 'hospital_id' })
    if (error) setErr(/row-level|permission/i.test(error.message) ? 'Only administrators can change the portal.' : error.message)
    else { setCfg(row); setMsg('Saved.') }
  }
  if (!cfg) return null
  const url = portalUrl()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {msg && <div role="status" style={s.ok}>{msg}</div>}
      <div style={s.card}>
        <h2 style={s.h2}>Patient portal <Chip tone={cfg.enabled ? 'green' : 'gray'}>{cfg.enabled ? 'On' : 'Off'}</Chip></h2>
        <p style={{ ...s.sub, marginTop: -6 }}>Patients sign in on their phone with the number they registered with and a 6-digit code (by SMS, or printed at reception from the patient's record). They see their upcoming appointments, released results, medicines, immunisations and what they owe, and can request or cancel appointments. Payments stay at the cashier. Patients marked confidential never appear in the portal.</p>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ background: '#fff', padding: 8, borderRadius: 8, border: `1px solid ${C.border}` }}><QRCodeSVG value={url} size={110} /></div>
          <div style={{ fontSize: 13 }}>
            <div><b>Portal address:</b> <code>{url}</code></div>
            <div style={s.sub}>Print the QR code for the waiting area. SMS codes need the Africa's Talking secrets (AT_USERNAME, AT_API_KEY) on the server; reception codes work without them.</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, fontWeight: 700 }}><input type="checkbox" checked={cfg.enabled} onChange={(e) => save({ ...cfg, enabled: e.target.checked })} />Portal on for this facility</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={cfg.show_results} onChange={(e) => save({ ...cfg, show_results: e.target.checked })} />Show completed test results</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={cfg.allow_requests} onChange={(e) => save({ ...cfg, allow_requests: e.target.checked })} />Accept appointment requests (they go to Appointments → Waiting list)</label>
        </div>
        <div style={{ ...s.grid(260), marginTop: 12 }}>
          <div><label style={s.label} htmlFor="pp-sens">Never release these tests online (comma-separated)</label>
            <textarea id="pp-sens" style={{ ...s.input, minHeight: 60 }} value={(cfg.sensitive_tests || []).join(', ')} onChange={(e) => setCfg({ ...cfg, sensitive_tests: e.target.value.split(',') })} />
            <div style={s.sub}>Matching results show "Please discuss this result with your clinician".</div></div>
          <div><label style={s.label} htmlFor="pp-note">Message shown to patients (optional)</label>
            <textarea id="pp-note" style={{ ...s.input, minHeight: 60 }} maxLength={300} value={cfg.welcome_note || ''} onChange={(e) => setCfg({ ...cfg, welcome_note: e.target.value })} placeholder="e.g. Clinic closed on 12 December" /></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => save(cfg)}>Save</button></div>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Portal activity</h2>
        <div style={{ overflowX: 'auto', maxHeight: 380 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['When', 'Phone', 'What'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{events.map((e) => (
              <tr key={e.id}>
                <td style={s.td}>{new Date(e.created_at).toLocaleString('en-KE')}</td>
                <td style={s.td}>{e.phone ? `07…${String(e.phone).slice(-3)}` : '—'}</td>
                <td style={s.td}><Chip tone={e.event === 'code_wrong' ? 'red' : 'gray'}>{EVENT[e.event] || e.event}</Chip></td>
              </tr>
            ))}</tbody>
          </table>
          {events.length === 0 && <div style={{ ...s.sub, padding: 12 }}>No portal activity yet.</div>}
        </div>
      </div>
    </div>
  )
}
