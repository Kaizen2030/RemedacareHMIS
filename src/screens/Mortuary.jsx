// Mortuary: body register (number, chamber, days in storage), admission with MCCD cause of death, personal effects,
// post-mortem, and controlled release — the database lists what still blocks release (identity, next of kin, burial
// permit, police clearance, bill cleared at the cashier) and requires two different staff. Fees are paid at the
// cashier only. Data: mortuary_bodies (20261211000000_dialysis_mortuary.sql).
import { useCallback, useEffect, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import { daysInStorage } from '../utils/morgue'
import { unpaidInvoiceFields } from '../utils/payments/invoices'
import { buildWorkflowInvoiceNote, createServiceLine, stringifyServiceLines } from '../utils/workflowBilling'
import { C, Chip, s } from './ncd/ui'

const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Not installed yet. Run docs/sql/29_dialysis_mortuary.sql in Supabase.'
  if (/row-level|permission/i.test(m)) return 'Only mortuary and clinical staff can use the mortuary register.'
  if (/mortuary_one_per_chamber|duplicate key/i.test(m)) return 'That chamber is already occupied.'
  return m
}
const PLACES = [['ward', 'Died on a ward'], ['emergency', 'Died in emergency'], ['theatre', 'Died in theatre'], ['brought_in_dead', 'Brought in dead'], ['other_facility', 'From another facility'], ['community', 'Died in the community']]
const STATUS = { in_storage: ['In storage', 'blue'], release_requested: ['Release requested', 'yellow'], released: ['Released', 'green'], transferred: ['Transferred', 'green'] }

export default function Mortuary() {
  const { hospitalId } = useHospital()
  const [tab, setTab] = useState('register')
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    if (!hospitalId) return
    let q = supabase.from('mortuary_bodies').select('*').eq('hospital_id', hospitalId).order('admitted_at', { ascending: false }).limit(300)
    q = tab === 'released' ? q.in('status', ['released', 'transferred']) : q.in('status', ['in_storage', 'release_requested'])
    const { data, error } = await q
    if (error) setErr(friendly(error)); else { setErr(''); setRows(data || []) }
  }, [hospitalId, tab])
  useEffect(() => { void load() }, [load])
  const body = rows.find((r) => r.id === open)
  return (
    <div style={s.page}>
      <div style={{ marginBottom: 12 }}><h1 style={s.h1}>Mortuary</h1><div style={s.sub}>Body register and controlled release. Mortuary fees are paid at the cashier.</div></div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div role="tablist" aria-label="Mortuary sections" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['register', 'In storage'], ['admit', '+ Admit body'], ['released', 'Released'], ['stats', 'Statistics']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...s.btn, ...(tab === k ? s.pri : s.ghost) }}>{l}</button>
        ))}
      </div>
      {(tab === 'register' || tab === 'released') && (
        <div style={s.card}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Body no.', 'Name', 'Chamber', 'Admitted', 'Days', 'Place of death', 'Status', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => {
              const days = daysInStorage(r.admitted_at)
              return (
                <tr key={r.id}>
                  <td style={s.td}><b>{r.body_number}</b></td>
                  <td style={s.td}>{r.deceased_name}{r.medico_legal && <> <Chip tone="red">Medico-legal</Chip></>}</td>
                  <td style={s.td}>{r.chamber || '—'}</td>
                  <td style={s.td}>{new Date(r.admitted_at).toLocaleDateString('en-KE')}</td>
                  <td style={{ ...s.td, color: days > 14 && r.status === 'in_storage' ? C.danger : undefined, fontWeight: days > 14 ? 800 : undefined }}>{days}{days > 14 && r.status === 'in_storage' ? ' — unclaimed?' : ''}</td>
                  <td style={s.td}>{PLACES.find(([k]) => k === r.place_of_death)?.[1]}</td>
                  <td style={s.td}><Chip tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Chip></td>
                  <td style={s.td}><button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setOpen(r.id)}>Open</button></td>
                </tr>
              )
            })}</tbody>
          </table>
          {!rows.length && <div style={s.sub}>{tab === 'released' ? 'No releases yet.' : 'No bodies in storage.'}</div>}
        </div>
      )}
      {tab === 'admit' && <Admit hospitalId={hospitalId} onDone={() => setTab('register')} setErr={setErr} />}
      {tab === 'stats' && <Stats hospitalId={hospitalId} />}
      {body && <BodyDrawer b={body} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}

function Admit({ hospitalId, onDone, setErr }) {
  const [f, setF] = useState({ deceased_name: '', sex: 'male', age_years: '', national_id: '', died_at: '', place_of_death: 'ward', source_ward: '', brought_by: '', police_station: '', police_ob_number: '', medico_legal: false, chamber: '', certified_by: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const ml = f.medico_legal || f.place_of_death === 'brought_in_dead'
  async function save(e) {
    e.preventDefault(); setErr('')
    if (!f.deceased_name.trim()) { setErr('Enter the name (or "Unknown male / female" with a description).'); return }
    if (ml && !f.police_ob_number.trim()) { setErr('Medico-legal case: record the police OB number.'); return }
    const row = Object.fromEntries(Object.entries({ ...f, hospital_id: hospitalId, age_years: f.age_years === '' ? null : Number(f.age_years), died_at: f.died_at ? new Date(f.died_at).toISOString() : null, medico_legal: ml }).filter(([, v]) => v !== ''))
    const { error } = await supabase.from('mortuary_bodies').insert(row)
    if (error) setErr(friendly(error)); else onDone()
  }
  const inp = (k, l, type = 'text') => <div><label style={s.label} htmlFor={`ma-${k}`}>{l}</label><input id={`ma-${k}`} type={type} style={s.input} value={f[k]} onChange={set(k)} /></div>
  return (
    <form onSubmit={save} style={s.card}>
      <div style={s.grid(190)}>
        {inp('deceased_name', 'Name of deceased *')}
        <div><label style={s.label} htmlFor="ma-sex">Sex</label><select id="ma-sex" style={s.input} value={f.sex} onChange={set('sex')}><option value="male">Male</option><option value="female">Female</option><option value="unknown">Unknown</option></select></div>
        {inp('age_years', 'Age (years)', 'number')}{inp('national_id', 'National ID / birth cert.')}{inp('died_at', 'Date and time of death', 'datetime-local')}
        <div><label style={s.label} htmlFor="ma-place">Place of death</label><select id="ma-place" style={s.input} value={f.place_of_death} onChange={set('place_of_death')}>{PLACES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {inp('source_ward', 'Ward / department')}{inp('brought_by', 'Brought by')}{inp('chamber', 'Chamber / tray')}{inp('certified_by', 'Death certified by')}
        {ml && <>{inp('police_station', 'Police station')}{inp('police_ob_number', 'Police OB number *')}</>}
      </div>
      <label style={{ display: 'flex', gap: 6, fontSize: 12, marginTop: 8 }}><input type="checkbox" checked={ml} disabled={f.place_of_death === 'brought_in_dead'} onChange={set('medico_legal')} />Medico-legal case (sudden, unnatural, violent or unexplained death — the police must be informed)</label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button type="submit" style={{ ...s.btn, ...s.pri }}>Admit</button></div>
    </form>
  )
}

function BodyDrawer({ b, onClose, onChanged }) {
  const [f, setF] = useState(b)
  const [blockers, setBlockers] = useState(null)
  const [effect, setEffect] = useState('')
  const [fee, setFee] = useState({ rate: 1500, extra: '' })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const closed = ['released', 'transferred'].includes(b.status)
  const loadBlockers = useCallback(async () => {
    const { data, error } = await supabase.rpc('mortuary_blockers', { p_body: b.id })
    if (!error) setBlockers(data || [])
  }, [b.id])
  useEffect(() => { setF(b); void loadBlockers() }, [b, loadBlockers])
  const cod = f.cause_of_death || {}, nok = f.next_of_kin || {}, idb = f.identified_by || {}
  const days = daysInStorage(b.admitted_at)
  async function update(patch, ok) {
    setErr(''); setMsg('')
    const { error } = await supabase.from('mortuary_bodies').update(patch).eq('id', b.id)
    if (error) { setErr(friendly(error)); return false }
    if (ok) setMsg(ok)
    onChanged(); void loadBlockers(); return true
  }
  const saveDetails = () => update({
    cause_of_death: f.cause_of_death, certified_by: f.certified_by || null, mccd_serial: f.mccd_serial || null, identified_by: f.identified_by, identity_verified: f.identity_verified,
    personal_effects: f.personal_effects, embalmed: f.embalmed, post_mortem: f.post_mortem, post_mortem_by: f.post_mortem_by || null, next_of_kin: f.next_of_kin,
    burial_permit_no: f.burial_permit_no || null, police_clearance: f.police_clearance || null, chamber: f.chamber || null,
  }, 'Saved.')
  async function sendBill() {
    setErr(''); setMsg('')
    const lines = [createServiceLine({ label: `Mortuary storage (${days} day${days === 1 ? '' : 's'})`, qty: days, unitPrice: Number(fee.rate) || 0, total: days * (Number(fee.rate) || 0), source: 'Mortuary', sourceId: b.id })]
    if (Number(fee.extra) > 0) lines.push(createServiceLine({ label: f.embalmed ? 'Embalming / other services' : 'Other mortuary services', qty: 1, unitPrice: Number(fee.extra), total: Number(fee.extra), source: 'Mortuary', sourceId: b.id }))
    const amount = lines.reduce((a, l) => a + Number(l.total || 0), 0)
    const { data, error } = await supabase.from('invoices').insert({
      hospital_id: b.hospital_id, patient_id: b.patient_id || null, patient_name: b.deceased_name, invoice_no: `MRT-${Date.now().toString().slice(-6)}`,
      services: stringifyServiceLines(lines), ...unpaidInvoiceFields(amount), payment_method: 'Cash',
      notes: buildWorkflowInvoiceNote({ source: 'Mortuary', sourceId: b.id, summary: `Mortuary bill — ${b.body_number}` }),
    }).select('id, invoice_no, balance_kes').single()
    if (error) { setErr(friendly(error)); return }
    await update({ invoice_id: data.id }, `Bill ${data.invoice_no} (KES ${Number(data.balance_kes).toLocaleString('en-KE')}) sent to the cashier. The family pays there; release unlocks when it is paid.`)
  }
  const inp = (val, onChange, label, id, type = 'text') => <div><label style={s.label} htmlFor={id}>{label}</label><input id={id} type={type} disabled={closed} style={s.input} value={val ?? ''} onChange={(e) => onChange(e.target.value)} /></div>
  return (
    <div style={s.overlay} onClick={onClose}>
      <div role="dialog" aria-label="Body record" style={{ ...s.drawer, width: 780 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <h2 style={{ ...s.h2, margin: 0 }}>{b.body_number} — {b.deceased_name}</h2>
            <div style={s.sub}>{b.sex} · {b.age_years ?? '?'} y · {PLACES.find(([k]) => k === b.place_of_death)?.[1]} · chamber {b.chamber || '—'} · {days} day(s){b.medico_legal ? ` · medico-legal, OB ${b.police_ob_number}` : ''}</div>
          </div>
          <button type="button" onClick={onClose} style={{ ...s.btn, ...s.ghost }}>Close</button>
        </div>
        <div style={{ margin: '8px 0' }}><Chip tone={STATUS[b.status][1]}>{STATUS[b.status][0]}</Chip></div>
        {err && <div role="alert" style={s.err}>{err}</div>}
        {msg && <div style={s.ok}>{msg}</div>}

        <div style={{ ...s.card, marginBottom: 10 }}>
          <h3 style={s.h2}>Cause of death (MCCD)</h3>
          <div style={s.grid(200)}>
            {[['ia', 'I(a) Disease or condition directly leading to death'], ['ib', 'I(b) Due to (or as a consequence of)'], ['ic', 'I(c) Due to'], ['id', 'I(d) Due to'], ['ii', 'II Other significant conditions']].map(([k, l]) => (
              <div key={k}>{inp(cod[k], (v) => setF({ ...f, cause_of_death: { ...cod, [k]: v } }), l, `cod-${k}`)}</div>
            ))}
            {inp(cod.interval, (v) => setF({ ...f, cause_of_death: { ...cod, interval: v } }), 'Interval onset → death (for Ia)', 'cod-int')}
            <div><label style={s.label} htmlFor="cod-manner">Manner</label><select id="cod-manner" disabled={closed} style={s.input} value={cod.manner || ''} onChange={(e) => setF({ ...f, cause_of_death: { ...cod, manner: e.target.value } })}><option value="">—</option>{['natural', 'accident', 'suicide', 'homicide', 'pending investigation', 'undetermined'].map((m) => <option key={m}>{m}</option>)}</select></div>
            {inp(f.certified_by, (v) => setF({ ...f, certified_by: v }), 'Certified by', 'cod-cert')}
            {inp(f.mccd_serial, (v) => setF({ ...f, mccd_serial: v }), 'MCCD serial no.', 'cod-serial')}
          </div>
        </div>

        <div style={{ ...s.card, marginBottom: 10 }}>
          <h3 style={s.h2}>Identification and personal effects</h3>
          <div style={s.grid(180)}>
            {inp(idb.name, (v) => setF({ ...f, identified_by: { ...idb, name: v } }), 'Identified by', 'id-name')}
            {inp(idb.relationship, (v) => setF({ ...f, identified_by: { ...idb, relationship: v } }), 'Relationship', 'id-rel')}
            {inp(idb.id_number, (v) => setF({ ...f, identified_by: { ...idb, id_number: v } }), 'Their ID number', 'id-no')}
          </div>
          <label style={{ display: 'flex', gap: 6, fontSize: 12, margin: '8px 0' }}><input type="checkbox" disabled={closed} checked={Boolean(f.identity_verified)} onChange={(e) => setF({ ...f, identity_verified: e.target.checked })} />Identity confirmed against the body tag and documents</label>
          <div style={{ fontSize: 12 }}>{(f.personal_effects || []).map((x, i) => <span key={i} style={{ marginRight: 8 }}>• {x}</span>)}{!(f.personal_effects || []).length && <span style={s.sub}>No personal effects recorded.</span>}</div>
          {!closed && <div style={{ display: 'flex', gap: 6, marginTop: 6 }}><input aria-label="Personal effect" placeholder="e.g. Wedding ring (yellow metal), phone" style={s.input} value={effect} onChange={(e) => setEffect(e.target.value)} /><button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => { if (effect.trim()) { setF({ ...f, personal_effects: [...(f.personal_effects || []), effect.trim()] }); setEffect('') } }}>Add</button></div>}
        </div>

        <div style={{ ...s.card, marginBottom: 10 }}>
          <h3 style={s.h2}>Post-mortem, permit and next of kin</h3>
          <div style={s.grid(180)}>
            <div><label style={s.label} htmlFor="pm">Post-mortem</label><select id="pm" disabled={closed} style={s.input} value={f.post_mortem} onChange={(e) => setF({ ...f, post_mortem: e.target.value })}><option value="not_required">Not required</option><option value="requested">Requested</option><option value="done">Done</option><option value="waived">Waived (police)</option></select></div>
            {inp(f.post_mortem_by, (v) => setF({ ...f, post_mortem_by: v }), 'Pathologist', 'pm-by')}
            {inp(f.burial_permit_no, (v) => setF({ ...f, burial_permit_no: v }), 'Burial permit no.', 'permit')}
            {b.medico_legal && inp(f.police_clearance, (v) => setF({ ...f, police_clearance: v }), 'Police clearance ref.', 'police')}
            {inp(nok.name, (v) => setF({ ...f, next_of_kin: { ...nok, name: v } }), 'Next of kin name', 'nok-name')}
            {inp(nok.relationship, (v) => setF({ ...f, next_of_kin: { ...nok, relationship: v } }), 'Relationship', 'nok-rel')}
            {inp(nok.id_number, (v) => setF({ ...f, next_of_kin: { ...nok, id_number: v } }), 'Next of kin ID number', 'nok-id')}
            {inp(nok.phone, (v) => setF({ ...f, next_of_kin: { ...nok, phone: v } }), 'Phone', 'nok-phone')}
          </div>
          <label style={{ display: 'flex', gap: 6, fontSize: 12, marginTop: 8 }}><input type="checkbox" disabled={closed} checked={Boolean(f.embalmed)} onChange={(e) => setF({ ...f, embalmed: e.target.checked })} />Embalmed</label>
          {!closed && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={saveDetails}>Save details</button></div>}
        </div>

        {!closed && (
          <div style={{ ...s.card, marginBottom: 10 }}>
            <h3 style={s.h2}>Mortuary bill (paid at the cashier)</h3>
            {b.invoice_id ? <div style={s.sub}>Bill sent to the cashier. Release unlocks once it is paid in full.</div> : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                <div><label style={s.label} htmlFor="fee-rate">Per day (KES)</label><input id="fee-rate" type="number" style={{ ...s.input, width: 120 }} value={fee.rate} onChange={(e) => setFee({ ...fee, rate: e.target.value })} /></div>
                <div><label style={s.label} htmlFor="fee-extra">Other services (KES)</label><input id="fee-extra" type="number" style={{ ...s.input, width: 140 }} value={fee.extra} onChange={(e) => setFee({ ...fee, extra: e.target.value })} /></div>
                <span style={{ fontSize: 13 }}>{days} day(s) = KES {(days * (Number(fee.rate) || 0) + (Number(fee.extra) || 0)).toLocaleString('en-KE')}</span>
                <button type="button" style={{ ...s.btn, ...s.soft }} onClick={sendBill}>Send bill to cashier</button>
              </div>
            )}
          </div>
        )}

        <div style={{ ...s.card, borderColor: blockers?.length ? C.warn : C.success }}>
          <h3 style={s.h2}>Release</h3>
          {closed ? <div>Released {b.released_at ? new Date(b.released_at).toLocaleString('en-KE') : ''} to {b.released_to}</div> : <>
            {blockers === null ? <div style={s.sub}>Checking…</div> : blockers.length ? (
              <div><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Still needed before release:</div>{blockers.map((x) => <div key={x} style={{ color: C.warn, fontSize: 12 }}>• {x}</div>)}</div>
            ) : <div style={{ color: C.success, fontWeight: 700, fontSize: 13 }}>Everything is in place for release.</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {b.status === 'in_storage' && <button type="button" style={{ ...s.btn, ...s.pri }} disabled={Boolean(blockers?.length)} onClick={() => update({ status: 'release_requested' }, 'Release requested. A different staff member must approve it.')}>Request release</button>}
              {b.status === 'release_requested' && <>
                <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => update({ status: 'in_storage' }, 'Release request withdrawn.')}>Withdraw request</button>
                <ReleaseButton onRelease={(to, transfer) => update({ status: transfer ? 'transferred' : 'released', released_to: to }, 'Body released.')} />
              </>}
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}

function ReleaseButton({ onRelease }) {
  const [to, setTo] = useState('')
  const [transfer, setTransfer] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input aria-label="Released to" placeholder="Released to (name, relationship, ID)" style={{ ...s.input, width: 280 }} value={to} onChange={(e) => setTo(e.target.value)} />
      <label style={{ display: 'flex', gap: 4, fontSize: 12 }}><input type="checkbox" checked={transfer} onChange={(e) => setTransfer(e.target.checked)} />Transfer to another mortuary</label>
      <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!to.trim()} onClick={() => onRelease(to.trim(), transfer)}>Approve and release</button>
    </div>
  )
}

function Stats({ hospitalId }) {
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { void supabase.rpc('mortuary_stats', { p_hospital: hospitalId, p_from: range.from, p_to: range.to }).then(({ data, error }) => { if (error) setErr(friendly(error)); else { setErr(''); setD(data) } }) }, [hospitalId, range])
  const tile = (l, v, warn) => <div style={{ border: `1px solid ${warn ? C.danger : C.border}`, borderRadius: 10, padding: 12, background: '#fff' }}><div style={s.sub}>{l}</div><div style={{ fontSize: 22, fontWeight: 800, color: warn ? C.danger : undefined }}>{v ?? '—'}</div></div>
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input aria-label="From" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <input aria-label="To" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {d && <>
        <div style={s.grid(170)}>
          {tile('Admitted', d.admitted)}{tile('Medico-legal', d.medico_legal)}{tile('Released', d.released)}
          {tile('Median stay', d.median_stay_days === null ? null : `${d.median_stay_days} days`)}{tile('In storage now', d.in_storage)}{tile('Unclaimed over 14 days', d.unclaimed_14_days, d.unclaimed_14_days > 0)}
        </div>
        <div style={{ marginTop: 12 }}><div style={s.label}>Place of death</div>{Object.entries(d.by_place || {}).map(([k, n]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{PLACES.find(([p]) => p === k)?.[1] || k}</span><b>{n}</b></div>)}</div>
      </>}
    </div>
  )
}
