// Referral inbox and outbox for a department (internal referrals in the referrals table).
// Incoming: referrals sent to this department — accept, or decline with a reason (the visit goes back to the
// referring department's queue). Outgoing: referrals this department made, with their status.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { notifyError, notifyWarning } from '../../notifications'

const OPEN = ['Sent', 'Received']
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString()
const note = (status, text, author) => ({ status, note: String(text || '').trim(), author: author || '', at: new Date().toISOString() })
const notes = (v) => { if (Array.isArray(v)) return v; try { return JSON.parse(v || '[]') || [] } catch { return [] } }
const STATUS_LABEL = { Sent: 'Waiting to be accepted', Received: 'Accepted', Completed: 'Seen', Declined: 'Declined', Draft: 'Draft' }

export function splitReferrals(rows, matchesDepartment) {
  const incoming = rows.filter((r) => matchesDepartment(r.receiving_department) && OPEN.includes(r.status))
  const outgoing = rows.filter((r) => r.referring_department && matchesDepartment(r.referring_department))
  return { incoming, outgoing }
}

export default function DepartmentReferrals({ hospitalId, department, matchesDepartment, canAct, author, css, SectionCard, EmptyState, onChanged, onCount }) {
  const [rows, setRows] = useState([])
  const [tab, setTab] = useState('incoming')
  const [declining, setDeclining] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!hospitalId) return
    const { data, error: e } = await supabase.from('referrals').select('*').eq('hospital_id', hospitalId).gte('created_at', daysAgo(60)).order('created_at', { ascending: false })
    if (e) { setError(e.message); return }
    setError('')
    setRows(data || [])
  }, [hospitalId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const refresh = () => void load()
    window.addEventListener('remedacare:workflow_changed', refresh)
    return () => window.removeEventListener('remedacare:workflow_changed', refresh)
  }, [load])
  const { incoming, outgoing } = useMemo(() => splitReferrals(rows, matchesDepartment), [rows, matchesDepartment])
  useEffect(() => { onCount?.(incoming.length) }, [incoming.length, onCount])

  const accept = async (r) => {
    setBusy(r.id)
    const { error: e } = await supabase.from('referrals').update({ status: 'Received', received_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      status_notes: [...notes(r.status_notes), note('Received', `Accepted by ${department}`, author)] }).eq('id', r.id).eq('hospital_id', hospitalId)
    setBusy('')
    if (e) { notifyError(`Could not accept the referral: ${e.message}`); return }
    await load(); onChanged?.()
  }
  const decline = async (r) => {
    if (!reason.trim()) { notifyWarning('Give the reason for declining, so the referring team knows what to do next.'); return }
    setBusy(r.id)
    const now = new Date().toISOString()
    const { error: e } = await supabase.from('referrals').update({ status: 'Declined', declined_reason: reason.trim(), declined_at: now, updated_at: now,
      status_notes: [...notes(r.status_notes), note('Declined', reason, author)] }).eq('id', r.id).eq('hospital_id', hospitalId)
    if (e) { setBusy(''); notifyError(`Could not decline the referral: ${e.message}`); return }
    // send the patient back to the referring department's queue
    if (r.visit_id && r.referring_department) {
      const { error: vErr } = await supabase.from('visits').update({ status: 'Doctor', speciality: r.referring_department, assigned_doctor_name: r.referring_doctor || null,
        doctor_notes: `Referral declined by ${department}: ${reason.trim()}` }).eq('id', r.visit_id).eq('hospital_id', hospitalId)
      if (vErr) notifyWarning(`Referral declined, but the patient could not be moved back to ${r.referring_department}: ${vErr.message}`)
      try { window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: r.visit_id, status: 'Doctor', department: r.referring_department, source: 'referral-declined' } })) } catch { /* ignore */ }
    }
    setBusy(''); setDeclining(null); setReason('')
    await load(); onChanged?.()
  }

  const list = tab === 'incoming' ? incoming : outgoing
  return (
    <SectionCard title="Referrals" count={incoming.length}>
      <div role="tablist" aria-label="Referrals" style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[['incoming', `Incoming (${incoming.length})`], ['outgoing', `Sent from here (${outgoing.length})`]].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            style={{ ...css.backBtn, padding: '5px 12px', ...(tab === k ? { background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' } : {}) }}>{l}</button>
        ))}
      </div>
      {error && <div role="alert" style={{ color: '#912018', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      {list.length === 0 ? <EmptyState message={tab === 'incoming' ? `No referrals waiting for ${department}.` : 'No referrals sent from this department in the last 60 days.'} /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={css.table}>
            <thead><tr>{(tab === 'incoming' ? ['Patient', 'From', 'Reason', 'Urgency', 'Status', ''] : ['Patient', 'To', 'Reason', 'Sent', 'Status']).map((h, i) => <th key={i} style={css.th}>{h}</th>)}</tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td style={css.td}><div style={{ fontWeight: 700 }}>{r.patient_name || '—'}</div>{r.referring_doctor && <div style={{ fontSize: 12, color: '#475467' }}>by {r.referring_doctor}</div>}</td>
                  <td style={css.td}>{tab === 'incoming' ? (r.referring_department || r.referring_facility || '—') : (r.receiving_department || r.receiving_facility || '—')}</td>
                  <td style={{ ...css.td, maxWidth: 320 }}>{r.referral_reason || r.diagnosis_label || '—'}{r.declined_reason && <div style={{ fontSize: 12, color: '#912018', marginTop: 2 }}>Declined: {r.declined_reason}</div>}</td>
                  <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{tab === 'incoming' ? (r.urgency || 'Routine') : (r.created_at ? new Date(r.created_at).toLocaleDateString('en-KE') : '—')}</td>
                  <td style={css.td}><span style={css.statusPill(r.status === 'Declined' ? '#B42318' : r.status === 'Completed' ? '#067647' : r.status === 'Received' ? '#175CD3' : '#B54708')}>{STATUS_LABEL[r.status] || r.status}</span></td>
                  {tab === 'incoming' && (
                    <td style={{ ...css.td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {canAct && declining !== r.id && (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          {r.status === 'Sent' && <button type="button" disabled={busy === r.id} style={{ ...css.backBtn, padding: '5px 12px', background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' }} onClick={() => void accept(r)}>Accept</button>}
                          <button type="button" disabled={busy === r.id} style={{ ...css.dangerBtn, padding: '5px 12px' }} onClick={() => { setDeclining(r.id); setReason('') }}>Decline</button>
                        </span>
                      )}
                      {canAct && declining === r.id && (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <input id={`decline-${r.id}`} aria-label="Reason for declining" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. manage in OPD first)"
                            style={{ padding: '6px 8px', border: '1px solid #D0D5DD', borderRadius: 6, fontSize: 13, minWidth: 200 }} />
                          <button type="button" disabled={busy === r.id} style={{ ...css.dangerBtn, padding: '5px 12px' }} onClick={() => void decline(r)}>Confirm decline</button>
                          <button type="button" style={{ ...css.backBtn, padding: '5px 12px' }} onClick={() => setDeclining(null)}>Cancel</button>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}
