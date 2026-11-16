// Leave for the department's staff: requests waiting for a decision (approved or rejected here by the department's leave
// approver, HR or an administrator) and who is on leave now or soon. The database enforces who may decide
// (staff_leave_before / dept_manages in 20261231200000_department_control.sql) and that nobody approves their own leave.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { localDateKey } from '../../utils/scheduling'

const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/row-level|policy/i.test(m)) return 'You cannot decide leave for this department.'
  if (/does not exist|schema cache/i.test(m)) return 'Department leave approval is not installed yet. Run docs/sql/51_department_control.sql.'
  return m.replace(/^.*?ERROR:\s*/, '')
}

export default function DepartmentLeave({ hospitalId, department, staff, css, SectionCard, EmptyState, onCount }) {
  const [rows, setRows] = useState([])
  const [canDecide, setCanDecide] = useState(false)
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')
  const [me, setMe] = useState(null)
  const [err, setErr] = useState('')
  const today = localDateKey(new Date())
  const ids = useMemo(() => staff.map((s) => s.id), [staff])
  const idKey = ids.join(',')
  const load = useCallback(async () => {
    if (!hospitalId || !ids.length) { setRows([]); return }
    const [lv, perm, mine] = await Promise.all([
      supabase.from('staff_leave').select('*').eq('hospital_id', hospitalId).in('staff_id', ids).order('start_date', { ascending: true }).limit(300),
      supabase.rpc('dept_manages', { p_hospital: hospitalId, p_department: department, p_what: 'leave' }),
      supabase.rpc('hr_my_staff_id', { p_hospital: hospitalId }),
    ])
    if (lv.error) { setErr(friendly(lv.error)); return }
    setErr(''); setRows(lv.data || []); setCanDecide(Boolean(perm.data)); setMe(mine?.data || null)
  }, [hospitalId, department, idKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])
  useEffect(() => { const r = () => void load(); window.addEventListener('remedacare:leave_changed', r); return () => window.removeEventListener('remedacare:leave_changed', r) }, [load])
  const pending = rows.filter((r) => r.status === 'requested')
  const current = rows.filter((r) => r.status === 'approved' && String(r.end_date) >= today).slice(0, 30)
  useEffect(() => { onCount?.(pending.length) }, [pending.length, onCount])
  const name = (id) => staff.find((s) => s.id === id)?.full_name || 'Staff member'

  const decide = async (r, status) => {
    if (status === 'rejected' && !reason.trim()) { setErr('Give the reason for rejecting.'); return }
    setBusy(r.id); setErr('')
    const { error } = await supabase.from('staff_leave').update({ status, ...(status === 'rejected' ? { decision_note: reason.trim() } : {}) }).eq('id', r.id)
    setBusy('')
    if (error) { setErr(friendly(error)); return }
    setRejecting(null); setReason(''); void load()
  }

  return (
    <>
      <SectionCard title="Leave requests" count={pending.length} note={canDecide ? `You approve leave for ${department}. Nobody can approve their own leave.` : `HR or ${department}'s leave approver decides these requests.`}>
        {err && <div role="alert" style={{ color: '#912018', fontSize: 13, marginBottom: 8 }}>{err}</div>}
        {pending.length === 0 ? <EmptyState message="No leave requests waiting." /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={css.table}>
              <thead><tr>{['Staff', 'Leave', 'From', 'To', 'Working days', 'Reason', ''].map((h, i) => <th key={i} style={css.th}>{h}</th>)}</tr></thead>
              <tbody>{pending.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...css.td, fontWeight: 700 }}>{name(r.staff_id)}</td>
                  <td style={css.td}>{r.leave_type}</td>
                  <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{r.start_date}</td>
                  <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{r.end_date}</td>
                  <td style={css.td}>{r.working_days ?? '—'}</td>
                  <td style={css.td}>{r.reason || '—'}</td>
                  <td style={{ ...css.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canDecide && r.staff_id === me && <span style={{ fontSize: 12.5, color: '#475467', fontWeight: 600 }}>Your own request: another approver decides</span>}
                    {canDecide && r.staff_id !== me && rejecting !== r.id && (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <button type="button" disabled={busy === r.id} style={{ ...css.backBtn, padding: '5px 12px', background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' }} onClick={() => void decide(r, 'approved')}>Approve</button>
                        <button type="button" disabled={busy === r.id} style={{ ...css.dangerBtn, padding: '5px 12px' }} onClick={() => { setRejecting(r.id); setReason('') }}>Reject</button>
                      </span>
                    )}
                    {canDecide && rejecting === r.id && (
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input aria-label="Reason for rejecting" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. short-staffed that week)"
                          style={{ padding: '6px 8px', border: '1px solid #D0D5DD', borderRadius: 6, fontSize: 13, minWidth: 200 }} />
                        <button type="button" disabled={busy === r.id} style={{ ...css.dangerBtn, padding: '5px 12px' }} onClick={() => void decide(r, 'rejected')}>Confirm reject</button>
                        <button type="button" style={{ ...css.backBtn, padding: '5px 12px' }} onClick={() => setRejecting(null)}>Cancel</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </SectionCard>
      <SectionCard title="On leave now or soon" count={current.length}>
        {current.length === 0 ? <EmptyState message="Nobody from this department is on approved leave." /> : (
          <table style={css.table}>
            <thead><tr>{['Staff', 'Leave', 'From', 'Back after'].map((h) => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
            <tbody>{current.map((r) => (
              <tr key={r.id}><td style={{ ...css.td, fontWeight: 700 }}>{name(r.staff_id)}</td><td style={css.td}>{r.leave_type}</td><td style={css.td}>{r.start_date}</td><td style={css.td}>{r.end_date}</td></tr>
            ))}</tbody>
          </table>
        )}
      </SectionCard>
    </>
  )
}
