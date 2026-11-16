// Controlled drugs and ward stock: the controlled-drug register per location with running balances and a second-person
// witness, the witness queue, ward imprest stock (par levels, use, counts) and top-up requests issued by the pharmacy
// first-expiry-first-out. Data and rules: 20261208000000_pharmacy_controls.sql (mirrored in utils/pharmacyControls.js).
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import PatientSearch from '../components/PatientSearch'
import { C, Chip, s } from './ncd/ui'
import { CD_TYPES, cdPreview, cdTypesFor, isPharmacy, topUpLines } from '../utils/pharmacyControls'

const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Not installed yet. Run docs/sql/26_pharmacy_controls.sql in Supabase.'
  if (/row-level|permission/i.test(m)) return 'You do not have permission for that (pharmacy entries need pharmacy staff).'
  return m
}
const hm = (v) => (v ? new Date(v).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const NAME_KEY = 'remedacare.pharmacyControls.name'
const readName = () => { try { return localStorage.getItem(NAME_KEY) || '' } catch { return '' } }

export default function PharmacyControls() {
  const { hospitalId } = useHospital()
  const [tab, setTab] = useState('register')
  const [meds, setMeds] = useState([])
  const [wards, setWards] = useState([])
  const [me, setMe] = useState(null)
  const [myName, setMyName] = useState(readName)
  const [isPharm, setIsPharm] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!hospitalId) return
    void (async () => {
      const [m, w, u, p] = await Promise.all([
        supabase.from('pharmacy_inventory').select('id, drug_name, controlled_drug, quantity_in_stock').eq('hospital_id', hospitalId).order('drug_name'),
        supabase.from('wards').select('name').eq('hospital_id', hospitalId).order('name'),
        supabase.auth.getUser(),
        supabase.rpc('pharm_is_staff', { p_hospital: hospitalId }),
      ])
      if (m.error) setErr(friendly(m.error))
      setMeds(m.data || []); setWards([...new Set((w.data || []).map((x) => x.name).filter(Boolean))])
      setMe(u?.data?.user?.id || null); setIsPharm(Boolean(p.data))
    })()
  }, [hospitalId])
  useEffect(() => { try { localStorage.setItem(NAME_KEY, myName) } catch { /* private mode */ } }, [myName])

  const ctx = { hospitalId, meds, wards, me, myName, isPharm, setErr }
  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div><h1 style={s.h1}>Controlled drugs & ward stock</h1><div style={s.sub}>Every controlled entry needs a second person to witness it with their own login. Stock leaves the pharmacy first-expiry-first-out.</div></div>
        <div style={{ minWidth: 220 }}><label style={s.label} htmlFor="pc-name">Your name (for signatures)</label><input id="pc-name" style={s.input} value={myName} onChange={(e) => setMyName(e.target.value)} /></div>
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div role="tablist" aria-label="Sections" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['register', 'Controlled drug register'], ['witness', 'Waiting for witness'], ['ward', 'Ward stock'], ['topups', 'Top-up requests']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setErr('') }} style={{ ...s.btn, ...(tab === k ? s.pri : s.ghost) }}>{l}</button>
        ))}
      </div>
      {tab === 'register' && <Register {...ctx} />}
      {tab === 'witness' && <WitnessQueue {...ctx} />}
      {tab === 'ward' && <WardStock {...ctx} />}
      {tab === 'topups' && <TopUps {...ctx} />}
    </div>
  )
}

function Register({ hospitalId, meds, wards, myName, setErr }) {
  const controlled = meds.filter((m) => m.controlled_drug)
  const [med, setMed] = useState('')
  const [loc, setLoc] = useState('Pharmacy')
  const [rows, setRows] = useState([])
  const [balances, setBalances] = useState([])
  const [patient, setPatient] = useState(null)
  const [f, setF] = useState({ entry_type: '', quantity: '', prescriber: '', counterpart: '', batch_number: '', reason: '' })
  const [msg, setMsg] = useState('')
  useEffect(() => { if (!med && controlled[0]) setMed(controlled[0].id) }, [controlled, med])
  const load = useCallback(async () => {
    if (!hospitalId) return
    const b = await supabase.rpc('cd_balances', { p_hospital: hospitalId })
    if (b.error) { setErr(friendly(b.error)); return }
    setBalances(b.data || [])
    if (!med) { setRows([]); return }
    const r = await supabase.from('cd_register').select('*').eq('hospital_id', hospitalId).eq('inventory_id', med).eq('location', loc).order('created_at', { ascending: false }).limit(200)
    setRows(r.data || [])
  }, [hospitalId, med, loc, setErr])
  useEffect(() => { void load() }, [load])
  const types = cdTypesFor(loc)
  useEffect(() => { if (!types.includes(f.entry_type)) setF((x) => ({ ...x, entry_type: types[0] })) }, [loc]) // eslint-disable-line react-hooks/exhaustive-deps
  const bal = Number(balances.find((b) => b.inventory_id === med && String(b.location).toLowerCase() === loc.toLowerCase())?.balance || 0)
  const preview = cdPreview(bal, f.entry_type, f.quantity, { ...f, patient })
  const locations = [...new Set(['Pharmacy', ...wards, ...balances.map((b) => b.location)])]
  async function save() {
    setErr(''); setMsg('')
    if (preview.problem) { setErr(preview.problem); return }
    const { error } = await supabase.from('cd_register').insert({
      hospital_id: hospitalId, inventory_id: med, location: loc, entry_type: f.entry_type, quantity: Number(f.quantity), patient_id: patient?.id || null,
      prescriber: f.prescriber || null, counterpart: f.counterpart || null, batch_number: f.batch_number || null, reason: f.reason || null, recorded_by_name: myName || null,
    })
    if (error) { setErr(friendly(error)); return }
    setMsg('Recorded. A second person must now witness it (Waiting for witness tab, with their own login).')
    setF({ ...f, quantity: '', prescriber: '', counterpart: '', batch_number: '', reason: '' }); setPatient(null); void load()
  }
  const t = CD_TYPES[f.entry_type] || {}
  if (!controlled.length) return <div style={{ ...s.card, ...s.sub }}>No medicines are marked as controlled. Tick "Controlled medicine" on the item in Drug Inventory (morphine, pethidine, fentanyl, ketamine, diazepam, phenobarbital, tramadol…), then record the opening balance here as a receipt.</div>
  return (
    <div>
      {msg && <div style={s.ok}>{msg}</div>}
      <div style={s.card}>
        <h2 style={s.h2}>Balances</h2>
        <div style={s.grid(220)}>
          {balances.map((b) => {
            const stale = !b.last_check_at || Date.now() - new Date(b.last_check_at) > 24 * 3600000
            return (
              <button key={`${b.inventory_id}-${b.location}`} type="button" onClick={() => { setMed(b.inventory_id); setLoc(b.location) }} style={{ textAlign: 'left', border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, background: '#fff', cursor: 'pointer' }}>
                <b>{b.drug_name}</b><div style={s.sub}>{b.location}</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{Number(b.balance)}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {Number(b.unwitnessed) > 0 && <Chip tone="red">{b.unwitnessed} not witnessed</Chip>}
                  <Chip tone={stale ? 'yellow' : 'green'}>{b.last_check_at ? `Checked ${hm(b.last_check_at)}` : 'Never counted'}</Chip>
                </div>
              </button>
            )
          })}
          {!balances.length && <div style={s.sub}>Nothing recorded yet.</div>}
        </div>
      </div>
      <div style={{ ...s.card, marginTop: 12 }}>
        <div style={s.grid(220)}>
          <div><label style={s.label} htmlFor="cd-med">Medicine</label><select id="cd-med" style={s.input} value={med} onChange={(e) => setMed(e.target.value)}>{controlled.map((m) => <option key={m.id} value={m.id}>{m.drug_name}</option>)}</select></div>
          <div><label style={s.label} htmlFor="cd-loc">Register (location)</label><select id="cd-loc" style={s.input} value={loc} onChange={(e) => setLoc(e.target.value)}>{locations.map((l) => <option key={l}>{l}</option>)}</select></div>
          <div><div style={s.label}>Balance in this register</div><div style={{ fontSize: 22, fontWeight: 800 }}>{bal}</div></div>
        </div>
        <div style={{ ...s.grid(170), marginTop: 10 }}>
          <div><label style={s.label} htmlFor="cd-type">Entry</label><select id="cd-type" style={s.input} value={f.entry_type} onChange={(e) => setF({ ...f, entry_type: e.target.value })}>{types.map((k) => <option key={k} value={k}>{CD_TYPES[k].label}</option>)}</select></div>
          <div><label style={s.label} htmlFor="cd-qty">{f.entry_type === 'balance_check' ? 'Counted quantity' : f.entry_type === 'adjustment' ? 'Quantity (+ or −)' : 'Quantity'}</label><input id="cd-qty" type="number" style={s.input} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></div>
          {t.patient && <div><label style={s.label} htmlFor="cd-patient">Patient</label><PatientSearch id="cd-patient" hospitalId={hospitalId} inputStyle={s.input} value={patient} onPick={setPatient} /></div>}
          {t.prescriber && <div><label style={s.label} htmlFor="cd-prescriber">Prescriber</label><input id="cd-prescriber" style={s.input} value={f.prescriber} onChange={(e) => setF({ ...f, prescriber: e.target.value })} /></div>}
          {t.counterpart && <div><label style={s.label} htmlFor="cd-ward">To ward</label><select id="cd-ward" style={s.input} value={f.counterpart} onChange={(e) => setF({ ...f, counterpart: e.target.value })}><option value="">Choose…</option>{wards.map((w) => <option key={w}>{w}</option>)}</select></div>}
          {f.entry_type === 'receipt' && <div><label style={s.label} htmlFor="cd-supplier">Supplier and invoice</label><input id="cd-supplier" style={s.input} value={f.counterpart} onChange={(e) => setF({ ...f, counterpart: e.target.value })} /></div>}
          <div><label style={s.label} htmlFor="cd-batch">Batch</label><input id="cd-batch" style={s.input} value={f.batch_number} onChange={(e) => setF({ ...f, batch_number: e.target.value })} /></div>
          {(t.reason || f.entry_type === 'balance_check') && <div><label style={s.label} htmlFor="cd-reason">{f.entry_type === 'balance_check' ? 'Explanation (if the count differs)' : 'Reason'}</label><input id="cd-reason" style={s.input} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
          <span style={{ fontSize: 13, color: preview.problem ? C.danger : C.text }}>
            {preview.problem || (f.entry_type === 'balance_check' ? (preview.discrepancy === 0 ? 'Count matches the register' : `Discrepancy ${preview.discrepancy > 0 ? '+' : ''}${preview.discrepancy}: the pharmacist in charge will be alerted`) : `New balance ${preview.balance}`)}
          </span>
          <button type="button" style={{ ...s.btn, ...s.pri }} onClick={save}>Record entry</button>
        </div>
      </div>
      <div style={{ ...s.card, marginTop: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['When', 'Entry', 'In', 'Out', 'Balance', 'Patient / ward / reason', 'Recorded by', 'Witness'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td style={s.td}>{hm(r.created_at)}</td>
              <td style={s.td}>{CD_TYPES[r.entry_type]?.label}{r.entry_type === 'balance_check' ? ` — counted ${r.quantity}` : ''}</td>
              <td style={s.td}>{Number(r.delta) > 0 ? Number(r.delta) : ''}</td>
              <td style={s.td}>{Number(r.delta) < 0 ? -Number(r.delta) : ''}</td>
              <td style={{ ...s.td, fontWeight: 800 }}>{Number(r.balance_after)}{Number(r.discrepancy) ? <span style={{ color: C.danger }}> ({Number(r.discrepancy) > 0 ? '+' : ''}{Number(r.discrepancy)})</span> : ''}</td>
              <td style={s.td}>{[r.prescriber && `Dr: ${r.prescriber}`, r.counterpart, r.batch_number && `batch ${r.batch_number}`, r.reason].filter(Boolean).join(' · ')}</td>
              <td style={s.td}>{r.recorded_by_name || '—'}</td>
              <td style={s.td}>{r.witness_by ? <Chip tone="green">{r.witness_name}</Chip> : <Chip tone="red">Not witnessed</Chip>}</td>
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <div style={s.sub}>No entries in this register yet.</div>}
      </div>
    </div>
  )
}

function WitnessQueue({ hospitalId, me, myName, setErr }) {
  const [rows, setRows] = useState([])
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('cd_register').select('*').eq('hospital_id', hospitalId).is('witness_by', null).order('created_at').limit(200)
    if (error) setErr(friendly(error)); else setRows(data || [])
  }, [hospitalId, setErr])
  useEffect(() => { void load() }, [load])
  async function witness(r) {
    setErr(''); setMsg('')
    if (!myName.trim()) { setErr('Type your name at the top first: it is printed as the witness signature.'); return }
    const { error } = await supabase.rpc('cd_witness', { p_entry: r.id, p_name: myName.trim() })
    if (error) setErr(friendly(error)); else { setMsg(`Witnessed: ${r.drug_name} ${CD_TYPES[r.entry_type]?.label.toLowerCase()}.`); void load() }
  }
  return (
    <div style={s.card}>
      {msg && <div style={s.ok}>{msg}</div>}
      <div style={{ ...s.sub, marginBottom: 8 }}>Witness only what you saw: the count, the dose drawn up and given, or the destruction. Entries you made yourself must be witnessed by someone else.</div>
      {rows.map((r) => {
        const mine = r.recorded_by && r.recorded_by === me
        return (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', borderTop: `1px solid ${C.border}`, padding: '7px 0' }}>
            <span><b>{r.drug_name}</b> · {r.location} · {CD_TYPES[r.entry_type]?.label} {r.entry_type === 'balance_check' ? `(counted ${r.quantity})` : `× ${Math.abs(Number(r.delta))}`} · {hm(r.created_at)} by {r.recorded_by_name || 'staff'}{r.reason ? ` — ${r.reason}` : ''}
              {Date.now() - new Date(r.created_at) > 4 * 3600000 && <b style={{ color: C.danger }}> · over 4 hours</b>}</span>
            {mine ? <span style={s.sub}>Your entry</span> : <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => witness(r)}>Witness</button>}
          </div>
        )
      })}
      {!rows.length && <div style={s.sub}>Nothing waiting for a witness.</div>}
    </div>
  )
}

function WardStock({ hospitalId, meds, wards, isPharm, setErr }) {
  const [ward, setWard] = useState('')
  const [rows, setRows] = useState([])
  const [add, setAdd] = useState({ inventory_id: '', par_level: '' })
  const [act, setAct] = useState(null)   // { row, kind }
  const [msg, setMsg] = useState('')
  useEffect(() => { if (!ward && wards[0]) setWard(wards[0]) }, [wards, ward])
  const load = useCallback(async () => {
    if (!ward) return
    const { data, error } = await supabase.from('ward_stock').select('*').eq('hospital_id', hospitalId).eq('ward', ward).order('drug_name')
    if (error) setErr(friendly(error)); else setRows(data || [])
  }, [hospitalId, ward, setErr])
  useEffect(() => { void load() }, [load])
  const below = topUpLines(rows)
  async function addItem() {
    setErr('')
    if (!add.inventory_id || !(Number(add.par_level) > 0)) { setErr('Choose the medicine and its par level.'); return }
    const { error } = await supabase.from('ward_stock').insert({ hospital_id: hospitalId, ward, inventory_id: add.inventory_id, par_level: Number(add.par_level) })
    if (error) setErr(friendly(error)); else { setAdd({ inventory_id: '', par_level: '' }); void load() }
  }
  async function requestTopUp() {
    setErr(''); setMsg('')
    const { error } = await supabase.rpc('ward_topup_create', { p_hospital: hospitalId, p_ward: ward })
    if (error) setErr(friendly(error)); else setMsg(`Top-up requested for ${below.length} item(s). The pharmacy will issue it.`)
  }
  return (
    <div>
      {msg && <div style={s.ok}>{msg}</div>}
      <div style={{ ...s.card, display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 220 }}><label style={s.label} htmlFor="ws-ward">Ward</label>
          {wards.length ? <select id="ws-ward" style={s.input} value={ward} onChange={(e) => setWard(e.target.value)}>{wards.map((w) => <option key={w}>{w}</option>)}</select>
            : <input id="ws-ward" style={s.input} value={ward} onChange={(e) => setWard(e.target.value)} />}
        </div>
        <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!below.length} onClick={requestTopUp}>Request top-up ({below.length} below par)</button>
      </div>
      <div style={{ ...s.card, marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Medicine', 'On ward', 'Par level', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td style={s.td}><b>{r.drug_name}</b></td>
              <td style={{ ...s.td, color: Number(r.quantity) < Number(r.par_level) ? C.danger : undefined, fontWeight: 700 }}>{Number(r.quantity)}</td>
              <td style={s.td}>{Number(r.par_level)}</td>
              <td style={s.td}><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[['use', 'Used'], ['count', 'Count'], ['expired', 'Expired'], ['return', 'Return']].map(([k, l]) => <button key={k} type="button" style={{ ...s.btn, ...s.ghost, padding: '3px 9px' }} onClick={() => setAct({ row: r, kind: k })}>{l}</button>)}
              </div></td>
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <div style={s.sub}>No ward stock list for {ward || 'this ward'} yet.{isPharm ? ' Add items below.' : ' The pharmacy sets it up.'}</div>}
        {act && <WardMove act={act} hospitalId={hospitalId} onDone={(m) => { setAct(null); setMsg(m); void load() }} onCancel={() => setAct(null)} setErr={setErr} />}
        {isPharm && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 240 }}><label style={s.label} htmlFor="ws-med">Add medicine to this ward</label><select id="ws-med" style={s.input} value={add.inventory_id} onChange={(e) => setAdd({ ...add, inventory_id: e.target.value })}><option value="">Choose…</option>{meds.filter((m) => !rows.some((r) => r.inventory_id === m.id)).map((m) => <option key={m.id} value={m.id}>{m.drug_name}</option>)}</select></div>
            <div><label style={s.label} htmlFor="ws-par">Par level</label><input id="ws-par" type="number" style={{ ...s.input, width: 110 }} value={add.par_level} onChange={(e) => setAdd({ ...add, par_level: e.target.value })} /></div>
            <button type="button" style={{ ...s.btn, ...s.soft }} onClick={addItem}>Add</button>
          </div>
        )}
      </div>
    </div>
  )
}

function WardMove({ act, hospitalId, onDone, onCancel, setErr }) {
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [patient, setPatient] = useState(null)
  const { row, kind } = act
  const variance = kind === 'count' && qty !== '' ? Number(qty) - Number(row.quantity) : 0
  async function save() {
    setErr('')
    if (qty === '' || Number(qty) < 0 || (kind !== 'count' && Number(qty) <= 0)) { setErr('Enter the quantity.'); return }
    if (kind !== 'count' && Number(qty) > Number(row.quantity)) { setErr(`Only ${row.quantity} on the ward.`); return }
    if (kind === 'count' && variance !== 0 && !reason.trim()) { setErr('The count differs from the book balance: give the reason.'); return }
    const { error } = await supabase.from('ward_stock_moves').insert({ hospital_id: hospitalId, ward_stock_id: row.id, kind, quantity: Number(qty), patient_id: patient?.id || null, reason: reason || null })
    if (error) setErr(friendly(error)); else onDone(`${row.drug_name}: ${kind === 'count' ? `counted ${qty}` : `${kind} ${qty}`} recorded.`)
  }
  return (
    <div style={{ background: '#F8FAFC', borderRadius: 10, padding: 12, marginTop: 10 }}>
      <b>{row.drug_name} — {{ use: 'used', count: 'stock count', expired: 'expired / damaged', return: 'return to pharmacy' }[kind]}</b> <span style={s.sub}>(book balance {Number(row.quantity)})</span>
      <div style={{ ...s.grid(180), marginTop: 6 }}>
        <div><label style={s.label} htmlFor="wm-qty">{kind === 'count' ? 'Counted' : 'Quantity'}</label><input id="wm-qty" type="number" style={s.input} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        {kind === 'use' && <div><label style={s.label} htmlFor="wm-patient">Patient</label><PatientSearch id="wm-patient" hospitalId={hospitalId} inputStyle={s.input} value={patient} onPick={setPatient} /></div>}
        <div><label style={s.label} htmlFor="wm-reason">{kind === 'count' ? 'Reason (if different)' : 'Note'}</label><input id="wm-reason" style={s.input} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
      {kind === 'count' && qty !== '' && <div style={{ fontSize: 12, color: variance ? C.danger : C.success, marginTop: 4 }}>{variance ? `Variance ${variance > 0 ? '+' : ''}${variance}` : 'Matches the book balance'}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
        <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={onCancel}>Cancel</button>
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={save}>Save</button>
      </div>
    </div>
  )
}

function TopUps({ hospitalId, isPharm, myName, setErr }) {
  const [rows, setRows] = useState([])
  const [qty, setQty] = useState({})
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('ward_topup_requests').select('*').eq('hospital_id', hospitalId).order('requested_at', { ascending: false }).limit(100)
    if (error) setErr(friendly(error)); else setRows(data || [])
  }, [hospitalId, setErr])
  useEffect(() => { void load() }, [load])
  const open = useMemo(() => rows.filter((r) => ['requested', 'issued'].includes(r.status)), [rows])
  const done = rows.filter((r) => !['requested', 'issued'].includes(r.status)).slice(0, 20)
  async function issue(r) {
    setErr(''); setMsg('')
    const issued = Object.fromEntries(r.lines.map((l) => [l.ward_stock_id, Number(qty[`${r.id}:${l.ward_stock_id}`] ?? l.requested)]))
    const { error } = await supabase.rpc('ward_topup_issue', { p_request: r.id, p_issued: issued, p_name: myName || null })
    if (error) setErr(friendly(error)); else { setMsg(`Issued to ${r.ward} (earliest-expiry batches first).`); void load() }
  }
  async function receive(r) {
    setErr(''); setMsg('')
    const { error } = await supabase.rpc('ward_topup_receive', { p_request: r.id })
    if (error) setErr(friendly(error)); else { setMsg(`Received on ${r.ward}; ward stock updated.`); void load() }
  }
  return (
    <div>
      {msg && <div style={s.ok}>{msg}</div>}
      {open.map((r) => (
        <div key={r.id} style={{ ...s.card, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <b>{r.ward} · {hm(r.requested_at)}</b><Chip tone={r.status === 'requested' ? 'yellow' : 'blue'}>{r.status === 'requested' ? 'Waiting for pharmacy' : `Issued ${hm(r.issued_at)} — waiting for the ward to receive`}</Chip>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
            <thead><tr>{['Medicine', 'Requested', 'Issued'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{r.lines.map((l) => (
              <tr key={l.ward_stock_id}>
                <td style={s.td}>{l.drug_name}</td><td style={s.td}>{Number(l.requested)}</td>
                <td style={s.td}>{r.status === 'requested' && isPharm
                  ? <input aria-label={`Issue ${l.drug_name}`} type="number" min="0" style={{ ...s.input, width: 100 }} value={qty[`${r.id}:${l.ward_stock_id}`] ?? l.requested} onChange={(e) => setQty({ ...qty, [`${r.id}:${l.ward_stock_id}`]: e.target.value })} />
                  : r.status === 'requested' ? '—' : Number(l.issued)}</td>
              </tr>
            ))}</tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            {r.status === 'requested' && isPharm && <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => issue(r)}>Issue</button>}
            {r.status === 'issued' && <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => receive(r)}>Received on the ward</button>}
          </div>
        </div>
      ))}
      {!open.length && <div style={{ ...s.card, ...s.sub }}>No open top-up requests.</div>}
      {done.length > 0 && <div style={{ ...s.card, marginTop: 12 }}><h2 style={s.h2}>Recent</h2>{done.map((r) => <div key={r.id} style={{ fontSize: 12 }}>{r.ward} · {hm(r.requested_at)} · {r.status} · {r.lines.map((l) => `${l.drug_name} ${Number(l.issued || 0)}`).join(', ')}</div>)}</div>}
    </div>
  )
}
