import { useCallback, useEffect, useMemo, useState } from 'react'
import { useHospital } from '../context'
import { canAccessPayroll, resolveRole } from '../access'
import { colors as C, typography } from '../theme'
import supabase from '../supabase'
import { calculatePayrollLine } from '../utils/payroll'
import { notifyError } from '../notifications'

const s = {
  page: { background: C.bg, color: C.text, fontFamily: typography.fontFamily },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 12, marginBottom: 14, flexWrap: 'wrap' },
  controls: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  button: { border: 'none', borderRadius: 7, padding: '8px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' },
  primary: { background: C.primary, color: '#fff' },
  secondary: { background: C.surface, color: C.text, border: `1px solid ${C.border}` },
  input: { border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 10px', fontSize: 12, background: C.surface, color: C.text },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 },
  stat: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px' },
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '9px 12px', textAlign: 'left', fontSize: 10, color: C.sub, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' },
  td: { padding: '10px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 12, verticalAlign: 'middle' },
}

const activeStatuses = new Set(['active'])
const money = (value) => `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const currentPeriod = () => new Date().toISOString().slice(0, 7)
const statusStyle = (status) => status === 'Completed'
  ? { background: '#EAF5EF', color: '#0F6E56' }
  : status === 'Pending' ? { background: '#FFF3DC', color: '#A85F00' } : { background: '#EEF2FF', color: '#3854A8' }

export default function Payroll() {
  const { hospitalId, userRole } = useHospital()
  const [payPeriod, setPayPeriod] = useState(currentPeriod)
  const [staff, setStaff] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const canViewPayroll = canAccessPayroll(userRole)
  const isAdmin = resolveRole(userRole) === 'Admin'

  const load = useCallback(async () => {
    if (!hospitalId) { setStaff([]); setRecords([]); setLoading(false); return }
    setLoading(true)
    const [staffResult, payrollResult] = await Promise.all([
      supabase.from('staff').select('id, full_name, role, department, status, salary_kes').eq('hospital_id', hospitalId).order('full_name'),
      supabase.from('hospital_workflow_records').select('id, status, details, created_at').eq('hospital_id', hospitalId).eq('module_code', 'payroll').eq('details->>pay_period', payPeriod).order('created_at'),
    ])
    if (staffResult.error) notifyError(`Unable to load staff payroll data: ${staffResult.error.message}`)
    if (payrollResult.error) notifyError(`Unable to load payroll period: ${payrollResult.error.message}`)
    setStaff(staffResult.data || [])
    setRecords(payrollResult.data || [])
    setLoading(false)
  }, [hospitalId, payPeriod])

  useEffect(() => { void load() }, [load])

  const rows = useMemo(() => {
    const byStaffId = new Map(records.map((record) => [String(record.details?.staff_id || ''), record]))
    return staff.filter((person) => activeStatuses.has(String(person.status || '').trim().toLowerCase())).map((person) => {
      const record = byStaffId.get(String(person.id))
      const line = calculatePayrollLine({ grossPay: record ? record.details?.gross_pay : person.salary_kes, deductions: record ? record.details?.deductions : 0 })
      return { person, record, ...line }
    })
  }, [staff, records])

  const eligible = rows.filter((row) => row.grossPay > 0)
  const missing = eligible.filter((row) => !row.record)
  const totals = eligible.reduce((sum, row) => ({ gross: sum.gross + row.grossPay, deductions: sum.deductions + row.deductions, net: sum.net + row.netPay }), { gross: 0, deductions: 0, net: 0 })
  const draftCount = records.filter((record) => record.status === 'Open').length
  const pendingCount = records.filter((record) => record.status === 'Pending').length

  async function generateDrafts() {
    if (!hospitalId || missing.length === 0) return
    setSaving(true)
    const payload = missing.map(({ person, grossPay, deductions, netPay }) => ({
      hospital_id: hospitalId, module_code: 'payroll', title: `${person.full_name} payroll ${payPeriod}`, status: 'Open',
      details: { staff_id: person.id, employee_name: person.full_name, pay_period: payPeriod, gross_pay: grossPay, deductions, net_pay: netPay },
    }))
    const { error } = await supabase.from('hospital_workflow_records').insert(payload)
    setSaving(false)
    if (error) return notifyError(`Could not create payroll drafts: ${error.message}`)
    await load()
  }

  async function changeStatus(from, to) {
    const ids = records.filter((record) => record.status === from).map((record) => record.id)
    if (ids.length === 0) return
    setSaving(true)
    const { error } = await supabase.from('hospital_workflow_records').update({ status: to }).eq('hospital_id', hospitalId).in('id', ids)
    setSaving(false)
    if (error) return notifyError(`Could not update payroll period: ${error.message}`)
    await load()
  }

  if (!canViewPayroll) return null
  return <section style={s.page} aria-label="Payroll">
    <div style={s.header}>
      <div><h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Payroll</h2><div style={{ color: C.sub, fontSize: 12, marginTop: 4 }}>Active staff salaries become period snapshots. Verify statutory and other deductions before approval.</div></div>
      <div style={s.controls}>
        <input aria-label="Pay period" type="month" value={payPeriod} onChange={(event) => setPayPeriod(event.target.value)} style={s.input} />
        <button type="button" style={{ ...s.button, ...s.secondary }} disabled={saving || draftCount === 0} onClick={() => changeStatus('Open', 'Pending')}>Submit drafts</button>
        {isAdmin && <button type="button" style={{ ...s.button, ...s.primary }} disabled={saving || pendingCount === 0} onClick={() => changeStatus('Pending', 'Completed')}>Approve period</button>}
        <button type="button" style={{ ...s.button, ...s.primary }} disabled={saving || missing.length === 0} onClick={generateDrafts}>Generate drafts</button>
      </div>
    </div>
    <div style={s.stats}>
      {[['Eligible staff', eligible.length], ['Gross pay', money(totals.gross)], ['Deductions', money(totals.deductions)], ['Net pay', money(totals.net)]].map(([label, value]) => <div key={label} style={s.stat}><div style={{ color: C.sub, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div><div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{value}</div></div>)}
    </div>
    <div style={s.card}><div style={{ overflowX: 'auto' }}><table style={s.table}><thead><tr><th style={s.th}>Staff</th><th style={s.th}>Department</th><th style={s.th}>Gross</th><th style={s.th}>Deductions</th><th style={s.th}>Net</th><th style={s.th}>Status</th></tr></thead><tbody>
      {loading && <tr><td colSpan={6} style={{ ...s.td, padding: 32, textAlign: 'center', color: C.sub }}>Loading payroll period...</td></tr>}
      {!loading && eligible.length === 0 && <tr><td colSpan={6} style={{ ...s.td, padding: 32, textAlign: 'center', color: C.sub }}>No active staff with a monthly salary are ready for this payroll period.</td></tr>}
      {!loading && eligible.map(({ person, record, grossPay, deductions, netPay }) => <tr key={person.id}><td style={s.td}><strong>{person.full_name}</strong><div style={{ color: C.sub, fontSize: 11, marginTop: 2 }}>{person.role || 'Staff'}</div></td><td style={s.td}>{person.department || 'Unassigned'}</td><td style={s.td}>{money(grossPay)}</td><td style={s.td}>{money(deductions)}</td><td style={{ ...s.td, fontWeight: 700 }}>{money(netPay)}</td><td style={s.td}><span style={{ display: 'inline-flex', padding: '3px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, ...statusStyle(record?.status || 'Open') }}>{record?.status || 'Not generated'}</span></td></tr>)}
    </tbody></table></div></div>
    {rows.length > eligible.length && <div style={{ color: C.sub, fontSize: 12, marginTop: 10 }}>{rows.length - eligible.length} active staff record(s) are excluded because a monthly salary is not set.</div>}
  </section>
}
