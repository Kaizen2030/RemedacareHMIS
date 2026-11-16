// "My leave" on the department page: days left per leave type, apply for leave, follow and cancel your own requests.
// The request goes to HR or this department's leave approver (staff_leave_before refuses requests for anyone else).
import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'
import { localDateKey } from '../../utils/scheduling'

const STATUS = { requested: ['Waiting for approval', '#B54708'], approved: ['Approved', '#05603A'], rejected: ['Rejected', '#912018'], cancelled: ['Cancelled', '#475467'] }
const DEFAULT_TYPES = ['Annual Leave', 'Sick Leave', 'Maternity Leave', 'Paternity Leave']
const friendly = (e) => (/does not exist|schema cache/i.test(e?.message || '') ? 'Leave is not installed yet (docs/sql/36).' : String(e?.message || 'Could not save.').replace(/^.*?ERROR:\s*/, ''))

export default function DepartmentMyLeave({ hospitalId, department, css, SectionCard, EmptyState }) {
  const [me, setMe] = useState(undefined) // undefined = loading, null = login not linked to a staff record
  const [mine, setMine] = useState([])
  const [balances, setBalances] = useState({})
  const [types, setTypes] = useState(DEFAULT_TYPES)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ leave_type: 'Annual Leave', start_date: '', end_date: '', reason: '' })
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const today = localDateKey(new Date())

  const load = useCallback(async () => {
    if (!hospitalId) return
    const { data: id } = await supabase.rpc('hr_my_staff_id', { p_hospital: hospitalId })
    setMe(id || null)
    if (!id) return
    const [lv, bal, ent] = await Promise.all([
      supabase.from('staff_leave').select('*').eq('hospital_id', hospitalId).eq('staff_id', id).order('start_date', { ascending: false }).limit(20),
      supabase.rpc('leave_balances', { p_hospital: hospitalId, p_staff: id }),
      supabase.from('hr_leave_entitlements').select('leave_type, hospital_id'),
    ])
    setMine((lv.data || []).filter((r) => r.staff_id === id))
    setBalances(bal.data || {})
    const t = [...new Set((ent.data || []).filter((e) => !e.hospital_id || e.hospital_id === hospitalId).map((e) => e.leave_type))]
    if (t.length) setTypes(t)
  }, [hospitalId])
  useEffect(() => { void load() }, [load])

  async function apply() {
    if (!form.start_date || !form.end_date) { setErr('Choose the first and last day of leave.'); return }
    if (form.end_date < form.start_date) { setErr('The leave ends before it starts.'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('staff_leave').insert({ hospital_id: hospitalId, staff_id: me, leave_type: form.leave_type, start_date: form.start_date, end_date: form.end_date, reason: form.reason.trim() || null, status: 'requested' })
    setBusy(false)
    if (error) { setErr(friendly(error)); return }
    setOpen(false); setForm({ leave_type: form.leave_type, start_date: '', end_date: '', reason: '' })
    setNotice(`Leave requested. HR or the ${department} leave approver will decide it.`)
    void load(); window.dispatchEvent(new CustomEvent('remedacare:leave_changed'))
  }
  async function cancel(r) {
    const { error } = await supabase.from('staff_leave').update({ status: 'cancelled' }).eq('id', r.id)
    if (error) { setErr(friendly(error)); return }
    setNotice('Request cancelled.'); void load(); window.dispatchEvent(new CustomEvent('remedacare:leave_changed'))
  }

  const input = { padding: '7px 10px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', background: '#fff', color: '#101828' }
  const label = { display: 'block', fontSize: 12.5, fontWeight: 700, color: '#344054', marginBottom: 4 }
  if (me === undefined) return null
  return (
    <SectionCard title="My leave" note={me ? null : 'Your login is not linked to a staff record, so you cannot apply here. Ask HR to link it.'}>
      {me && (
        <>
          {Object.keys(balances).length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {Object.entries(balances).map(([t, b]) => {
                const left = Number(b.entitled || 0) - Number(b.used || 0) - Number(b.pending || 0)
                return (
                  <div key={t} style={{ border: '1px solid #EAECF0', borderRadius: 8, padding: '6px 12px', minWidth: 140 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#344054' }}>{t}</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: '#101828' }}>{left} <span style={{ fontSize: 12, fontWeight: 600, color: '#475467' }}>of {b.entitled} days left</span></div>
                    {Number(b.pending) > 0 && <div style={{ fontSize: 11.5, color: '#B54708', fontWeight: 600 }}>{b.pending} waiting for approval</div>}
                  </div>
                )
              })}
            </div>
          )}
          {!open ? (
            <button type="button" style={{ ...css.backBtn, background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' }} onClick={() => { setOpen(true); setNotice(''); setErr('') }}>Apply for leave</button>
          ) : (
            <div role="group" aria-label="Apply for leave" style={{ border: '1px solid #D0D5DD', borderRadius: 10, padding: 14, background: '#FCFCFD' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <div><label style={label} htmlFor="ml-type">Leave type</label>
                  <select id="ml-type" style={input} value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })}>{types.map((t) => <option key={t}>{t}</option>)}</select></div>
                <div><label style={label} htmlFor="ml-from">First day</label>
                  <input id="ml-from" type="date" min={today} style={input} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value, end_date: form.end_date && form.end_date < e.target.value ? e.target.value : form.end_date })} /></div>
                <div><label style={label} htmlFor="ml-to">Last day</label>
                  <input id="ml-to" type="date" min={form.start_date || today} style={input} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
              </div>
              <div style={{ marginTop: 10 }}><label style={label} htmlFor="ml-reason">Reason (optional)</label>
                <input id="ml-reason" style={input} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. family travel" /></div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button type="button" disabled={busy} style={{ ...css.backBtn, background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' }} onClick={() => void apply()}>{busy ? 'Sending…' : 'Send request'}</button>
                <button type="button" style={css.backBtn} onClick={() => { setOpen(false); setErr('') }}>Close</button>
              </div>
            </div>
          )}
          {notice && <div role="status" style={{ color: '#05603A', fontSize: 13, fontWeight: 600, marginTop: 8 }}>{notice}</div>}
          {err && <div role="alert" style={{ color: '#912018', fontSize: 13, fontWeight: 600, marginTop: 8 }}>{err}</div>}
          <div style={{ marginTop: 12 }}>
            {mine.length === 0 ? <EmptyState message="You have no leave requests yet." /> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={css.table}>
                  <thead><tr>{['Leave', 'From', 'To', 'Days', 'Status', ''].map((h, i) => <th key={i} style={css.th}>{h}</th>)}</tr></thead>
                  <tbody>{mine.map((r) => {
                    const [label2, tone] = STATUS[r.status] || [r.status, '#475467']
                    return (
                      <tr key={r.id}>
                        <td style={{ ...css.td, fontWeight: 700 }}>{r.leave_type}</td>
                        <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{r.start_date}</td>
                        <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{r.end_date}</td>
                        <td style={css.td}>{r.working_days ?? '—'}</td>
                        <td style={css.td}><span style={{ color: tone, fontWeight: 700 }}>{label2}</span>{r.status === 'rejected' && r.decision_note && <div style={{ fontSize: 12, color: '#475467' }}>{r.decision_note}</div>}</td>
                        <td style={{ ...css.td, textAlign: 'right' }}>{r.status === 'requested' && <button type="button" style={{ ...css.backBtn, padding: '4px 10px' }} onClick={() => void cancel(r)}>Cancel request</button>}</td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </SectionCard>
  )
}
