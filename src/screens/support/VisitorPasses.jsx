// Visitor passes for admitted patients: issue at reception / the gate, check in and out by pass number.
// Visiting hours, the bedside maximum, isolation and clinical restrictions are enforced by the database
// (20261220000000_safety_checks.sql); staff can let a visitor through only by recording who allowed it.
import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'
import PatientSearch from '../../components/PatientSearch'
import { openPromptDialog } from '../../confirmDialog'
import { Chip, s } from '../ncd/ui'

const NEEDS_REASON = /visit_restricted|outside_hours|too_many|Outside visiting hours|Already \d+ visitor|must approve|Visits restricted/i
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }

function printPass(p) {
  const w = window.open('', '_blank', 'width=360,height=420')
  if (!w) return
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  w.document.write(`<html><head><title>${esc(p.pass_no)}</title></head><body style="font-family:sans-serif;text-align:center;padding:16px">
    <div style="font-size:12px">VISITOR PASS — valid today only</div><div style="font-size:30px;font-weight:800;margin:10px 0">${esc(p.pass_no)}</div>
    <div>${esc(p.visitor_name)}</div><div style="margin-top:8px">Visiting: <b>${esc(p.patients?.full_name || '')}</b></div><div>${esc(p.ward_name || '')} · bed ${esc(p.bed_number || '')}</div>
    <script>window.print()</script></body></html>`)
  w.document.close()
}

export default function VisitorPasses({ hospitalId }) {
  const [form, setForm] = useState({ patient: null, visitor_name: '', id_number: '', phone: '', relationship: '' })
  const [passes, setPasses] = useState([])
  const [code, setCode] = useState('')
  const [issued, setIssued] = useState(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('visitor_passes').select('*, patients(full_name)').eq('hospital_id', hospitalId).gte('issued_at', startOfToday()).order('issued_at', { ascending: false })
    if (error && /does not exist|schema cache/i.test(error.message)) setErr('Run docs/sql/38_safety_checks.sql to switch on visitor passes.')
    setPasses(data || [])
  }, [hospitalId])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])

  const issue = async (override = null) => {
    setErr(''); setOk('')
    if (!form.patient || !form.visitor_name.trim()) { setErr('Pick the patient and enter the visitor name'); return }
    const { data, error } = await supabase.from('visitor_passes').insert({
      hospital_id: hospitalId, patient_id: form.patient.id, visitor_name: form.visitor_name.trim(), id_number: form.id_number || null,
      phone: form.phone || null, relationship: form.relationship || null, override_reason: override,
    }).select('*, patients(full_name)').single()
    if (error) {
      if (!override && NEEDS_REASON.test(error.message)) {
        const why = await openPromptDialog(`${error.message.replace(/\. Record who approved.*$/, '')}.`, { title: 'Visit needs approval', placeholder: 'Who approved, and precautions given', confirmLabel: 'Issue pass' })
        if (why && why.trim()) return issue(why.trim())
        return
      }
      setErr(error.message); return
    }
    setIssued(data); setForm({ patient: null, visitor_name: '', id_number: '', phone: '', relationship: '' }); void load()
  }

  const act = async (passNo, action, reason = null) => {
    setErr(''); setOk('')
    if (!passNo?.trim()) return
    const { data, error } = await supabase.rpc('visitor_pass_action', { p_hospital: hospitalId, p_pass_no: passNo.trim(), p_action: action, p_reason: reason })
    if (error) {
      if (!reason && action !== 'out' && (action === 'revoke' || NEEDS_REASON.test(error.message))) {
        const why = await openPromptDialog(action === 'revoke' ? 'Why is this pass being revoked?' : `${error.message.replace(/\. (Record|Ask).*$/, '')}.`, {
          title: action === 'revoke' ? 'Revoke pass' : 'Let the visitor in?', placeholder: action === 'revoke' ? 'Reason' : 'Who allowed it', tone: action === 'revoke' ? 'danger' : undefined,
          confirmLabel: action === 'revoke' ? 'Revoke' : 'Let in',
        })
        if (why && why.trim()) return act(passNo, action, why.trim())
        return
      }
      setErr(error.message); return
    }
    setOk(`${data.pass_no}: ${data.visitor_name} ${action === 'in' ? 'checked in' : action === 'out' ? 'checked out' : 'pass revoked'}.`)
    setCode(''); void load()
  }

  const inside = passes.filter((p) => p.status === 'in')
  return (
    <section style={{ ...s.card, marginBottom: 14 }} aria-label="Visitor passes">
      <h2 style={s.h2}>Visitor passes</h2>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {ok && <div role="status" style={s.ok}>{ok}</div>}
      <div style={s.grid(300)}>
        <div>
          <div style={s.label}>Gate: pass number</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input aria-label="Pass number" style={s.input} value={code} placeholder="VP-…" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void act(code, 'in') }} />
            <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => act(code, 'in')}>In</button>
            <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => act(code, 'out')}>Out</button>
          </div>
          <div style={{ ...s.label, marginTop: 14 }}>Inside now ({inside.length})</div>
          {inside.length === 0 && <div style={s.sub}>No visitors inside.</div>}
          {inside.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center', fontSize: 12, padding: '4px 0' }}>
              <span><strong>{p.visitor_name}</strong> → {p.patients?.full_name} <span style={s.sub}>{p.ward_name} {p.bed_number}</span></span>
              <button type="button" style={{ ...s.btn, ...s.ghost, padding: '3px 8px' }} onClick={() => act(p.pass_no, 'out')}>Out</button>
            </div>
          ))}
        </div>
        <div>
          <div style={s.label}>Issue a pass</div>
          <PatientSearch id="vp-patient" hospitalId={hospitalId} inputStyle={s.input} value={form.patient} onPick={(p) => setForm((f) => ({ ...f, patient: p }))} />
          <div style={{ ...s.grid(130), marginTop: 6 }}>
            <input aria-label="Visitor name" style={s.input} placeholder="Visitor name" value={form.visitor_name} onChange={(e) => setForm((f) => ({ ...f, visitor_name: e.target.value }))} />
            <input aria-label="ID number" style={s.input} placeholder="ID number" value={form.id_number} onChange={(e) => setForm((f) => ({ ...f, id_number: e.target.value }))} />
            <input aria-label="Visitor phone" style={s.input} placeholder="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            <input aria-label="Relationship" style={s.input} placeholder="Relationship" value={form.relationship} onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))} />
          </div>
          <button type="button" style={{ ...s.btn, ...s.pri, marginTop: 8 }} onClick={() => issue()}>Issue pass</button>
          {issued && (
            <div style={{ marginTop: 10, padding: 10, border: '1px dashed #98A2B3', borderRadius: 8 }}>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{issued.pass_no}</div>
              <div style={{ fontSize: 12 }}>{issued.visitor_name} → {issued.patients?.full_name} · {issued.ward_name} {issued.bed_number}</div>
              <button type="button" style={{ ...s.btn, ...s.ghost, marginTop: 6 }} onClick={() => printPass(issued)}>Print pass</button>
            </div>
          )}
        </div>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Pass', 'Visitor', 'Patient', 'Status', 'In', 'Out', ''].map((h, i) => <th key={i} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{passes.map((p) => (
            <tr key={p.id}>
              <td style={s.td}>{p.pass_no}</td><td style={s.td}>{p.visitor_name}<div style={s.sub}>{[p.relationship, p.phone].filter(Boolean).join(' · ')}</div></td>
              <td style={s.td}>{p.patients?.full_name}<div style={s.sub}>{p.ward_name} {p.bed_number}</div></td>
              <td style={s.td}><Chip tone={{ issued: 'blue', in: 'green', out: 'gray', revoked: 'red' }[p.status]}>{p.status}</Chip>{p.override_reason ? <div style={s.sub}>approved: {p.override_reason}</div> : null}</td>
              <td style={s.td}>{p.checked_in_at ? new Date(p.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</td>
              <td style={s.td}>{p.checked_out_at ? new Date(p.checked_out_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</td>
              <td style={s.td}>{['issued', 'in'].includes(p.status) && <button type="button" style={{ ...s.btn, ...s.danger, padding: '3px 8px' }} onClick={() => act(p.pass_no, 'revoke')}>Revoke</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        {passes.length === 0 && <div style={{ ...s.sub, padding: 12, textAlign: 'center' }}>No passes issued today.</div>}
      </div>
    </section>
  )
}
