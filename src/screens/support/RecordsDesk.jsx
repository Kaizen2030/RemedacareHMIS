// Medical Records desk: physical file locator (issue / transfer / return / missing, overdue files) and the incomplete-
// records list generated from the clinical data. Data: record_files, record_file_movements, records_deficiencies()
// (20261215000000_records_file_locator.sql).
import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'
import PatientSearch from '../../components/PatientSearch'
import { C, Chip, s } from '../ncd/ui'

const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Not installed yet. Run docs/sql/33_records_file_locator.sql in Supabase.'
  if (/duplicate key|unique/i.test(m)) return 'This patient already has a file with that volume number.'
  if (/row-level|permission/i.test(m)) return 'Only records and clinical staff can use the file locator.'
  return m
}
const hm = (v) => (v ? new Date(v).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const STATUS = { in_registry: ['In registry', 'green'], out: ['Out', 'blue'], missing: ['MISSING', 'red'], archived: ['Archived', 'gray'] }
const NAME_KEY = 'remedacare.records.name'

export default function RecordsDesk({ hospitalId }) {
  const [tab, setTab] = useState('files')
  return (
    <div style={{ ...s.card, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ ...s.h2, margin: 0 }}>Medical records</h2>
        <div role="tablist" aria-label="Records sections" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['files', 'File locator'], ['out', 'Files out / overdue'], ['incomplete', 'Incomplete records']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...s.btn, ...(tab === k ? s.pri : s.ghost) }}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'files' && <FileLocator hospitalId={hospitalId} />}
      {tab === 'out' && <FilesOut hospitalId={hospitalId} />}
      {tab === 'incomplete' && <Incomplete hospitalId={hospitalId} />}
    </div>
  )
}

function FileLocator({ hospitalId }) {
  const [patient, setPatient] = useState(null)
  const [files, setFiles] = useState([])
  const [moves, setMoves] = useState([])
  const [newFile, setNewFile] = useState({ file_number: '', shelf: '', volume: 1 })
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    if (!patient) { setFiles([]); setMoves([]); return }
    const { data, error } = await supabase.from('record_files').select('*').eq('hospital_id', hospitalId).eq('patient_id', patient.id).order('volume')
    if (error) { setErr(friendly(error)); return }
    setErr(''); setFiles(data || [])
    const ids = (data || []).map((f) => f.id)
    if (ids.length) { const m = await supabase.from('record_file_movements').select('*').in('file_id', ids).order('moved_at', { ascending: false }).limit(50); setMoves(m.data || []) } else setMoves([])
  }, [hospitalId, patient])
  useEffect(() => { void load() }, [load])
  async function create() {
    setErr('')
    const { error } = await supabase.from('record_files').insert({ hospital_id: hospitalId, patient_id: patient.id, file_number: newFile.file_number || patient.patient_number || null, shelf: newFile.shelf || null, volume: Number(newFile.volume) || 1 })
    if (error) setErr(friendly(error)); else void load()
  }
  return (
    <div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ maxWidth: 420 }}><label style={s.label} htmlFor="rf-patient">Patient</label><PatientSearch id="rf-patient" hospitalId={hospitalId} inputStyle={s.input} value={patient} onPick={setPatient} /></div>
      {patient && (
        <div style={{ marginTop: 10 }}>
          {files.map((f) => <FileCard key={f.id} f={f} moves={moves.filter((m) => m.file_id === f.id)} onChanged={load} setErr={setErr} />)}
          {!files.length && <div style={s.sub}>No physical file registered for {patient.full_name}.</div>}
          <div style={{ display: 'flex', gap: 6, alignItems: 'end', flexWrap: 'wrap', marginTop: 8 }}>
            <div><label style={s.label} htmlFor="rf-number">File number</label><input id="rf-number" style={s.input} placeholder={patient.patient_number || ''} value={newFile.file_number} onChange={(e) => setNewFile({ ...newFile, file_number: e.target.value })} /></div>
            <div><label style={s.label} htmlFor="rf-shelf">Shelf</label><input id="rf-shelf" style={s.input} value={newFile.shelf} onChange={(e) => setNewFile({ ...newFile, shelf: e.target.value })} /></div>
            <div><label style={s.label} htmlFor="rf-vol">Volume</label><input id="rf-vol" type="number" min="1" style={{ ...s.input, width: 80 }} value={newFile.volume} onChange={(e) => setNewFile({ ...newFile, volume: e.target.value })} /></div>
            <button type="button" style={{ ...s.btn, ...s.soft }} onClick={create}>{files.length ? 'Add a volume' : 'Register file'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function FileCard({ f, moves, onChanged, setErr }) {
  const [to, setTo] = useState('')
  const [loc, setLoc] = useState('')
  const [hours, setHours] = useState(24)
  const myName = (() => { try { return localStorage.getItem(NAME_KEY) || '' } catch { return '' } })()
  const [st, tone] = STATUS[f.status]
  const overdue = f.status === 'out' && f.due_back && new Date(f.due_back) < new Date()
  async function move(action, extra = {}) {
    setErr('')
    if (['issued', 'transferred'].includes(action) && !to.trim()) { setErr('Record who is taking the file.'); return }
    let reason = extra.reason
    if (action === 'missing' || action === 'archived') {
      reason = window.prompt(action === 'missing' ? 'Where was the file last seen?' : 'Archive box / reason')
      if (!reason) return
    }
    const { error } = await supabase.from('record_file_movements').insert({ hospital_id: f.hospital_id, file_id: f.id, action, to_holder: to.trim() || null, to_location: loc.trim() || null,
      due_back: action === 'issued' ? new Date(Date.now() + Number(hours) * 3600000).toISOString() : null, reason: reason || null, moved_by_name: myName || null })
    if (error) setErr(friendly(error)); else { setTo(''); setLoc(''); onChanged() }
  }
  return (
    <div style={{ border: `1px solid ${overdue || f.status === 'missing' ? C.danger : C.border}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <b>File {f.file_number || '—'}{f.volume > 1 ? ` vol. ${f.volume}` : ''} · shelf {f.shelf || '—'}</b>
        <span><Chip tone={tone}>{st}</Chip>{overdue && <> <Chip tone="red">Overdue</Chip></>}</span>
      </div>
      {f.status === 'out' && <div style={{ fontSize: 13, marginTop: 4 }}>With <b>{f.holder}</b>{f.holder_location ? ` (${f.holder_location})` : ''} since {hm(f.out_since)} · due back {hm(f.due_back)}</div>}
      {f.status === 'missing' && <div style={{ fontSize: 13, marginTop: 4, color: C.danger }}>Missing — last with {f.holder || 'unknown'}</div>}
      {f.status !== 'archived' && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'end', flexWrap: 'wrap', marginTop: 8 }}>
          {(f.status === 'in_registry' || f.status === 'out') && <>
            <input aria-label={`File ${f.file_number} to`} placeholder={f.status === 'out' ? 'Pass to (name)' : 'Issue to (name)'} style={{ ...s.input, width: 170 }} value={to} onChange={(e) => setTo(e.target.value)} />
            <input aria-label={`File ${f.file_number} location`} placeholder="Department / room" style={{ ...s.input, width: 150 }} value={loc} onChange={(e) => setLoc(e.target.value)} />
          </>}
          {f.status === 'in_registry' && <>
            <select aria-label="Due back in" style={{ ...s.input, width: 120 }} value={hours} onChange={(e) => setHours(e.target.value)}><option value={4}>4 hours</option><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>1 week</option></select>
            <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => move('issued')}>Issue</button>
            <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => move('archived')}>Archive</button>
          </>}
          {f.status === 'out' && <>
            <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => move('transferred')}>Pass on</button>
            <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => move('returned')}>Returned to registry</button>
            <button type="button" style={{ ...s.btn, ...s.danger }} onClick={() => move('missing')}>Report missing</button>
          </>}
          {f.status === 'missing' && <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => move('found')}>Found — back in registry</button>}
        </div>
      )}
      {moves.length > 0 && (
        <details style={{ marginTop: 6, fontSize: 12 }}><summary>Movement history ({moves.length})</summary>
          {moves.map((m) => <div key={m.id} style={{ padding: '2px 0' }}>{hm(m.moved_at)} · <b>{m.action}</b>{m.to_holder ? ` → ${m.to_holder}` : ''}{m.to_location ? ` (${m.to_location})` : ''}{m.reason ? ` — ${m.reason}` : ''}{m.moved_by_name ? ` · by ${m.moved_by_name}` : ''}</div>)}
        </details>
      )}
    </div>
  )
}

function FilesOut({ hospitalId }) {
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => {
    void supabase.from('record_files').select('*, patients(full_name, patient_number)').eq('hospital_id', hospitalId).in('status', ['out', 'missing']).order('due_back')
      .then(({ data, error }) => { if (error) setErr(friendly(error)); else setRows(data || []) })
  }, [hospitalId])
  const now = new Date()
  const overdue = rows.filter((f) => f.status === 'missing' || (f.due_back && new Date(f.due_back) < now))
  return (
    <div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ ...s.sub, marginBottom: 6 }}>{rows.length} file(s) out of the registry · <b style={{ color: overdue.length ? C.danger : undefined }}>{overdue.length} overdue or missing</b></div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Patient', 'File', 'With', 'Since', 'Due back', 'Status'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((f) => {
          const late = f.status === 'missing' || (f.due_back && new Date(f.due_back) < now)
          return (
            <tr key={f.id}>
              <td style={s.td}>{f.patients?.full_name}</td><td style={s.td}>{f.file_number}{f.volume > 1 ? ` v${f.volume}` : ''}</td>
              <td style={s.td}>{f.holder}{f.holder_location ? ` (${f.holder_location})` : ''}</td><td style={s.td}>{hm(f.out_since)}</td>
              <td style={{ ...s.td, color: late ? C.danger : undefined, fontWeight: late ? 800 : undefined }}>{hm(f.due_back)}</td>
              <td style={s.td}><Chip tone={STATUS[f.status][1]}>{late && f.status === 'out' ? 'Overdue' : STATUS[f.status][0]}</Chip></td>
            </tr>
          )
        })}</tbody>
      </table>
      {!rows.length && <div style={s.sub}>All files are in the registry.</div>}
    </div>
  )
}

function Incomplete({ hospitalId }) {
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    void supabase.rpc('records_deficiencies', { p_hospital: hospitalId, p_from: range.from, p_to: range.to }).then(({ data, error }) => { if (error) setErr(friendly(error)); else { setErr(''); setRows(data || []) } })
  }, [hospitalId, range])
  const byClinician = Object.entries((rows || []).reduce((a, r) => { const k = r.clinician || 'Not recorded'; a[k] = (a[k] || 0) + 1; return a }, {})).sort((a, b) => b[1] - a[1])
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input aria-label="From" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <input aria-label="To" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <span style={s.sub}>Generated from discharges and deaths. An item disappears as soon as the record is completed.</span>
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {rows && <>
        {byClinician.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>{byClinician.map(([k, n]) => <Chip key={k} tone="yellow">{k}: {n}</Chip>)}</div>}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Patient', 'Record', 'Ward', 'Clinician', 'Days', 'Missing'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={`${r.kind}-${r.record_id}`}>
              <td style={s.td}>{r.patient}</td><td style={s.td}>{r.kind === 'death' ? 'Death' : 'Discharge'} {r.discharged_at ? new Date(r.discharged_at).toLocaleDateString('en-KE') : ''}</td>
              <td style={s.td}>{r.ward || '—'}</td><td style={s.td}>{r.clinician || '—'}</td>
              <td style={{ ...s.td, color: r.days_since > 3 ? C.danger : undefined, fontWeight: r.days_since > 3 ? 800 : undefined }}>{r.days_since}</td>
              <td style={{ ...s.td, color: C.danger }}>{(r.missing || []).join(', ')}</td>
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <div style={s.sub}>No incomplete records in this period.</div>}
      </>}
    </div>
  )
}
