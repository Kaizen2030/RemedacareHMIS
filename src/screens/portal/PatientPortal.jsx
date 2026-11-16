// Patient portal (#/portal): sign in with a phone number and an SMS or reception code, then see appointments,
// released results, medicines, immunisations and open bills at every facility that uses the portal; request or
// cancel appointments. Talks only to the patient-portal edge function — no staff access, no direct database access.
import { useCallback, useEffect, useState } from 'react'

const API = `${String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/patient-portal`
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const TOKEN_KEY = 'rc-portal-token'

const store = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY) || '' } catch { return '' } },
  set: (v) => { try { if (v) sessionStorage.setItem(TOKEN_KEY, v); else sessionStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ } },
}

export async function portalCall(action, payload = {}, token = '') {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...payload }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) { const e = new Error(body.error || 'Something went wrong. Please try again.'); e.status = res.status; throw e }
  return body
}

const C = { brand: '#0F6E56', brandL: '#E1F5EE', text: '#101828', sub: '#667085', border: '#E4E7EC', bg: '#F4F7F6', danger: '#B42318', dangerL: '#FEF3F2', warnL: '#FFFAEB', warn: '#B54708' }
const s = {
  page: { minHeight: '100vh', background: C.bg, fontFamily: 'Inter, system-ui, Arial, sans-serif', color: C.text, padding: 16, boxSizing: 'border-box' },
  wrap: { maxWidth: 640, margin: '0 auto' },
  card: { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 12 },
  h2: { fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em', color: C.sub, margin: '0 0 10px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 16, border: `1px solid ${C.border}`, borderRadius: 10, background: '#fff', color: C.text },
  btn: { width: '100%', padding: '13px 16px', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 10, background: C.brand, color: '#fff', cursor: 'pointer' },
  link: { background: 'none', border: 'none', color: C.brand, fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 14 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: `1px solid #F2F4F7`, fontSize: 14 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, margin: '10px 0 6px' },
  sub: { color: C.sub, fontSize: 13 },
  err: { background: C.dangerL, color: C.danger, padding: '10px 12px', borderRadius: 10, fontSize: 14, marginBottom: 12 },
  ok: { background: C.brandL, color: C.brand, padding: '10px 12px', borderRadius: 10, fontSize: 14, marginBottom: 12 },
}
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE')}`

function Header({ onSignOut }) {
  return (
    <div style={{ ...s.card, background: C.brand, color: '#fff', border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>RemedacareHMS</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>My health record</div>
      </div>
      {onSignOut && <button type="button" onClick={onSignOut} style={{ ...s.link, color: '#fff', border: '1px solid rgba(255,255,255,.6)', borderRadius: 8, padding: '6px 10px' }}>Sign out</button>}
    </div>
  )
}

function SignIn({ onSignedIn }) {
  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  async function sendCode(e) {
    e.preventDefault(); setErr(''); setMsg(''); setBusy(true)
    try { const r = await portalCall('request_code', { phone }); setMsg(r.message); setStep('code') } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  async function verify(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    try { const r = await portalCall('verify', { phone, code }); store.set(r.token); onSignedIn(r.token) } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  return (
    <div style={s.card}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {msg && <div role="status" style={s.ok}>{msg}</div>}
      {step === 'phone' ? (
        <form onSubmit={sendCode}>
          <label style={s.label} htmlFor="pp-phone">Your mobile number</label>
          <input id="pp-phone" style={s.input} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          <p style={s.sub}>Use the number you gave the hospital. We will send a 6-digit code by SMS.</p>
          <button type="submit" style={s.btn} disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
          <p style={{ ...s.sub, textAlign: 'center', marginTop: 14 }}><button type="button" style={s.link} onClick={() => { if (phone) setStep('code'); else setErr('Enter your mobile number first.') }}>I have a code from reception</button></p>
        </form>
      ) : (
        <form onSubmit={verify}>
          <label style={s.label} htmlFor="pp-code">Code for {phone}</label>
          <input id="pp-code" style={{ ...s.input, letterSpacing: '.3em', fontSize: 22, textAlign: 'center' }} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          <button type="submit" style={{ ...s.btn, marginTop: 12 }} disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign in'}</button>
          <p style={{ ...s.sub, textAlign: 'center', marginTop: 14 }}><button type="button" style={s.link} onClick={() => { setStep('phone'); setCode(''); setMsg('') }}>Use another number or send a new code</button></p>
        </form>
      )}
      <p style={{ ...s.sub, marginTop: 16 }}>Your record is private. Do not share your code with anyone, including hospital staff.</p>
    </div>
  )
}

function RequestForm({ record, token, onDone }) {
  const [f, setF] = useState({ department: '', earliest_date: '', preferred_times: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('')
    try { const r = await portalCall('request_appointment', { patient_id: record.patient.id, ...f }, token); onDone(r.message) } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  return (
    <form onSubmit={submit} style={{ marginTop: 8 }}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <label style={s.label} htmlFor="rq-dept">Clinic or service</label>
      <input id="rq-dept" style={s.input} placeholder="e.g. Diabetes clinic, Antenatal, Dental" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
      <label style={s.label} htmlFor="rq-date">From which date?</label>
      <input id="rq-date" style={s.input} type="date" min={new Date().toISOString().slice(0, 10)} value={f.earliest_date} onChange={(e) => setF({ ...f, earliest_date: e.target.value })} />
      <label style={s.label} htmlFor="rq-time">Best time</label>
      <select id="rq-time" style={s.input} value={f.preferred_times} onChange={(e) => setF({ ...f, preferred_times: e.target.value })}>
        <option value="">Any time</option><option>Morning</option><option>Afternoon</option>
      </select>
      <label style={s.label} htmlFor="rq-why">Reason (optional)</label>
      <input id="rq-why" style={s.input} maxLength={200} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      <button type="submit" style={{ ...s.btn, marginTop: 12 }} disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
    </form>
  )
}

function Record({ record, token, reload }) {
  const [showRequest, setShowRequest] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const r = record
  async function cancel(a) {
    if (!window.confirm(`Cancel your appointment on ${fmtDate(a.date)}?`)) return
    setErr('')
    try { const x = await portalCall('cancel_appointment', { patient_id: r.patient.id, appointment_id: a.id }, token); setMsg(x.message); reload() } catch (e) { setErr(e.message) }
  }
  return (
    <>
      {msg && <div role="status" style={s.ok}>{msg}</div>}
      {err && <div role="alert" style={s.err}>{err}</div>}
      <section style={s.card}>
        <h2 style={s.h2}>Appointments · {r.patient.facility}</h2>
        {r.appointments.length === 0 && <div style={s.sub}>No upcoming appointments.</div>}
        {r.appointments.map((a) => (
          <div key={a.id} style={s.row}>
            <div>
              <div style={{ fontWeight: 700 }}>{fmtDate(a.date)}{a.time ? ` · ${String(a.time).slice(0, 5)}` : ''}</div>
              <div style={s.sub}>{[a.department, a.clinician, a.type].filter(Boolean).join(' · ') || a.status}</div>
              {a.video_link && /^https:\/\//.test(a.video_link) && <a href={a.video_link} target="_blank" rel="noreferrer" style={{ color: C.brand, fontSize: 14, fontWeight: 600 }}>Join video visit</a>}
            </div>
            {a.can_cancel && <button type="button" style={{ ...s.link, color: C.danger }} onClick={() => cancel(a)}>Cancel</button>}
          </div>
        ))}
        {r.patient.can_request && (showRequest
          ? <RequestForm record={r} token={token} onDone={(m) => { setMsg(m); setShowRequest(false) }} />
          : <button type="button" style={{ ...s.btn, marginTop: 12, background: C.brandL, color: C.brand }} onClick={() => setShowRequest(true)}>Request an appointment</button>)}
      </section>

      <section style={s.card}>
        <h2 style={s.h2}>Test results</h2>
        {r.results.length === 0 && <div style={s.sub}>No results to show yet.</div>}
        {r.results.map((t, i) => (
          <div key={i} style={s.row}>
            <div><div style={{ fontWeight: 600 }}>{t.test}</div><div style={s.sub}>{fmtDate(t.date)}</div></div>
            <div style={{ textAlign: 'right', maxWidth: '55%' }}>{t.released ? <><div>{t.result || 'Ready — ask your clinician'}</div>{t.interpretation && <div style={s.sub}>{t.interpretation}</div>}</> : <span style={s.sub}>{t.note}</span>}</div>
          </div>
        ))}
      </section>

      <section style={s.card}>
        <h2 style={s.h2}>Medicines (last 6 months)</h2>
        {r.medicines.length === 0 && <div style={s.sub}>None.</div>}
        {r.medicines.map((m, i) => <div key={i} style={s.row}><div><div style={{ fontWeight: 600 }}>{m.name}</div><div style={s.sub}>{m.how}</div></div><div style={s.sub}>{fmtDate(m.date)}</div></div>)}
      </section>

      {r.immunisations.length > 0 && <section style={s.card}>
        <h2 style={s.h2}>Immunisations</h2>
        {r.immunisations.map((m, i) => <div key={i} style={s.row}><span>{m.vaccine}</span><span style={s.sub}>{fmtDate(m.date)}</span></div>)}
      </section>}

      <section style={s.card}>
        <h2 style={s.h2}>Bills</h2>
        {r.bills.length === 0 && <div style={s.sub}>Nothing to pay.</div>}
        {r.bills.map((b, i) => <div key={i} style={s.row}><div><div style={{ fontWeight: 600 }}>{b.number || 'Bill'}</div><div style={s.sub}>{fmtDate(b.date)} · total {kes(b.total)}</div></div><div style={{ fontWeight: 700, color: C.warn }}>{kes(b.balance)}</div></div>)}
        {r.bills.length > 0 && <div style={{ ...s.sub, marginTop: 8 }}>Pay at the cashier at {r.patient.facility}. They can also send an M-Pesa prompt to your phone.</div>}
      </section>
    </>
  )
}

export default function PatientPortal() {
  const [token, setToken] = useState(store.get)
  const [data, setData] = useState(null)
  const [active, setActive] = useState(0)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true); setErr('')
    try { setData(await portalCall('summary', {}, token)) } catch (e) {
      if (e.status === 401) { store.set(''); setToken('') }
      setErr(e.message)
    }
    setLoading(false)
  }, [token])
  useEffect(() => { void load() }, [load])

  async function signOut() {
    try { await portalCall('logout', {}, token) } catch { /* ignore */ }
    store.set(''); setToken(''); setData(null)
  }

  const records = data?.records || []
  const record = records[Math.min(active, records.length - 1)]
  return (
    <main style={s.page}>
      <div style={s.wrap}>
        <Header onSignOut={token ? signOut : null} />
        {err && <div role="alert" style={s.err}>{err}</div>}
        {!token && <SignIn onSignedIn={setToken} />}
        {token && loading && !data && <div style={s.card} role="status">Loading your record…</div>}
        {token && data && records.length === 0 && <div style={s.card}>No records are linked to this number at facilities using the portal. Ask reception to check your phone number.</div>}
        {token && data?.welcome && <div style={{ ...s.card, background: C.warnL }}>{data.welcome}</div>}
        {records.length > 1 && (
          <div role="tablist" aria-label="Family members and facilities" style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 12 }}>
            {records.map((r, i) => (
              <button key={r.patient.id} type="button" role="tab" aria-selected={i === active} onClick={() => setActive(i)}
                style={{ padding: '8px 12px', borderRadius: 999, border: `1px solid ${i === active ? C.brand : C.border}`, background: i === active ? C.brandL : '#fff', color: i === active ? C.brand : C.text, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                {r.patient.name} · {r.patient.facility}
              </button>
            ))}
          </div>
        )}
        {record && <Record key={record.patient.id} record={record} token={token} reload={load} />}
        <p style={{ ...s.sub, textAlign: 'center' }}>For emergencies go to the nearest hospital or call 999 / 112.</p>
      </div>
    </main>
  )
}
