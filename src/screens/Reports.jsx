import { useState, useEffect, useContext } from 'react'
import { HospitalContext } from '../context'
import supabase from '../supabase'
import { executeWithFallback } from '../utils/dbCompat'
import { buildAmrInterventions, summarizeAmrInterventions } from '../utils/hospitalSignals'
import { executeMicrobiologyQuery } from '../utils/microbiologyResults'
import { colors as themeColors, typography } from '../theme'

// ─── COLOURS ───────────────────────────────────────────────────────
const C = {
 primary: themeColors.primaryDark,
 accent: themeColors.accent,
 bg: themeColors.bgAlt,
 card: themeColors.card,
 border: themeColors.borderSoft,
 text: themeColors.textStrong,
 muted: '#888',
 danger: '#E24B4A',
 warn: '#F59E0B',
 info: themeColors.info,
 purple: '#8B5CF6',
 green: themeColors.success,
 bars: themeColors.chartBars,
}

// ─── DATE RANGE ────────────────────────────────────────────────────
const RANGES = [
 { id: 'today', label: 'Today' },
 { id: 'week', label: 'This Week' },
 { id: 'month', label: 'This Month' },
 { id: 'year', label: 'This Year' },
]
function getRange(id) {
 const now = new Date(), start = new Date()
 if (id === 'today') { start.setHours(0,0,0,0) }
 else if (id === 'week') { start.setDate(now.getDate() - now.getDay()); start.setHours(0,0,0,0) }
 else if (id === 'month') { start.setDate(1); start.setHours(0,0,0,0) }
 else if (id === 'year') { start.setMonth(0,1); start.setHours(0,0,0,0) }
 return { from: start.toISOString(), to: now.toISOString() }
}

// ─── FORMATTERS ────────────────────────────────────────────────────
function fmt(n) {
 if (n == null) return '—'
 if (n >= 1_000_000) return 'KES ' + (n / 1_000_000).toFixed(1) + 'M'
 if (n >= 1_000) return 'KES ' + (n / 1_000).toFixed(1) + 'K'
 return 'KES ' + Number(n).toLocaleString()
}
function num(n) { return n == null ? '—' : Number(n).toLocaleString() }

// ─── HELPERS ───────────────────────────────────────────────────────
function grid(cols) {
 return { display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }
}
function groupCount(arr, keyFn) {
 const map = {}
 arr.forEach(r => { const k = keyFn(r) || 'Unknown'; map[k] = (map[k] || 0) + 1 })
 return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))
}
function groupSum(arr, keyFn, valFn) {
 const map = {}
 arr.forEach(r => { const k = keyFn(r) || 'Unknown'; map[k] = (map[k] || 0) + valFn(r) })
 return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value: Math.round(value) }))
}
function revenueByDay(invoices) {
 const map = {}
 invoices.forEach(r => {
 if (!r.created_at) return
 const day = new Date(r.created_at).toLocaleDateString('en-KE', {
 month: 'short',
 day: 'numeric'
 })

 const amount =
 Number(r.amount_paid) ||
 Number(r.paid_kes) ||
 Number(r.total_amount) ||
 Number(r.amount_kes) ||
 0

 map[day] = (map[day] || 0) + amount
 })

 return Object.entries(map)
 .slice(-7)
 .map(([label, value]) => ({ label, value: Math.round(value) }))
}

// ─── SPINNER ───────────────────────────────────────────────────────
function Spinner() {
 return (
 <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
 <div style={{ width: 26, height: 26, border: '3px solid #e8ebe8', borderTop: `3px solid ${C.primary}`, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
 </div>
 )
}

// ─── BADGE ─────────────────────────────────────────────────────────
function Badge({ label, color = C.primary }) {
 return (
 <span style={{ background: color + '22', color, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
 {label}
 </span>
 )
}

// ─── KPI CARD ──────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, color = C.primary, loading }) {
 return (
 <div style={{ background: C.card, borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${C.border}` }}>
 {icon ? (
 <div style={{ width: 46, height: 46, borderRadius: 12, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
 {icon}
 </div>
 ) : null}
 <div style={{ flex: 1, minWidth: 0 }}>
 <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</div>
 {loading
 ? <div style={{ height: 22, width: '55%', background: '#eee', borderRadius: 5, animation: 'pulse 1.2s ease infinite' }} />
 : <div style={{ fontSize: 21, fontWeight: 700, color: C.text, lineHeight: 1.2 }}>{value ?? '—'}</div>
 }
 {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
 </div>
 </div>
 )
}

// ─── HORIZONTAL BAR CHART ──────────────────────────────────────────
function BarChart({ title, data, valuePrefix = '', valueSuffix = '', loading, maxItems = 8 }) {
 const items = (data || []).slice(0, maxItems)
 const max = Math.max(...items.map(d => d.value), 1)
 return (
 <div style={{ background: C.card, borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${C.border}` }}>
 <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 16 }}>{title}</div>
 {loading ? <Spinner /> : items.length === 0
 ? <div style={{ textAlign: 'center', color: C.muted, padding: '20px 0', fontSize: 12 }}>No data yet</div>
 : items.map((d, i) => (
 <div key={i} style={{ marginBottom: 11 }}>
 <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
 <span style={{ fontSize: 12, color: C.text, fontWeight: 500, maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
 <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{valuePrefix}{typeof d.value === 'number' ? d.value.toLocaleString() : d.value}{valueSuffix}</span>
 </div>
 <div style={{ height: 9, background: '#f0f2f0', borderRadius: 99, overflow: 'hidden' }}>
 <div style={{ height: '100%', width: `${(d.value / max) * 100}%`, background: C.bars[i % C.bars.length], borderRadius: 99, transition: 'width 0.7s ease' }} />
 </div>
 </div>
 ))
 }
 </div>
 )
}

// ─── DONUT CHART ───────────────────────────────────────────────────
function DonutChart({ title, data, loading }) {
 const size = 150, r = 54, cx = 75, cy = 75
 const total = (data || []).reduce((s, d) => s + d.value, 0) || 1
 let angle = -90
 const slices = (data || []).map((d, i) => {
 const pct = d.value / total, start = angle
 angle += pct * 360
 return { ...d, pct, start, end: angle, color: C.bars[i % C.bars.length] }
 })
 function arc(s, e, rr) {
 const toR = a => a * Math.PI / 180
 const x1 = cx + rr * Math.cos(toR(s)), y1 = cy + rr * Math.sin(toR(s))
 const x2 = cx + rr * Math.cos(toR(e)), y2 = cy + rr * Math.sin(toR(e))
 return `M ${cx} ${cy} L ${x1} ${y1} A ${rr} ${rr} 0 ${e - s > 180 ? 1 : 0} 1 ${x2} ${y2} Z`
 }
 return (
 <div style={{ background: C.card, borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${C.border}` }}>
 <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 16 }}>{title}</div>
 {loading ? <Spinner /> : !data || data.length === 0
 ? <div style={{ textAlign: 'center', color: C.muted, padding: '20px 0', fontSize: 12 }}>No data yet</div>
 : (
 <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
 <svg width={size} height={size} style={{ flexShrink: 0 }}>
 {slices.map((sl, i) => <path key={i} d={arc(sl.start, sl.end, r)} fill={sl.color} opacity={0.9} />)}
 <circle cx={cx} cy={cy} r={34} fill="white" />
 <text x={cx} y={cy - 5} textAnchor="middle" fontSize={10} fill={C.muted}>Total</text>
 <text x={cx} y={cy + 11} textAnchor="middle" fontSize={15} fontWeight="700" fill={C.text}>{total.toLocaleString()}</text>
 </svg>
 <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
 {slices.map((sl, i) => (
 <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
 <div style={{ width: 10, height: 10, borderRadius: 3, background: sl.color, flexShrink: 0 }} />
 <span style={{ fontSize: 11.5, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sl.label}</span>
 <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{sl.value} ({(sl.pct * 100).toFixed(0)}%)</span>
 </div>
 ))}
 </div>
 </div>
 )
 }
 </div>
 )
}

// ─── LINE / AREA CHART ─────────────────────────────────────────────
function LineChart({ title, data, color = C.primary, loading }) {
 const W = 340, H = 100, pad = 10
 const vals = (data || []).map(d => d.value)
 const labels = (data || []).map(d => d.label)
 const maxV = Math.max(...vals, 1), minV = Math.min(...vals, 0)
 const range = maxV - minV || 1
 const pts = vals.map((v, i) => ({
 x: pad + (i / (vals.length - 1 || 1)) * (W - pad * 2),
 y: H - pad - ((v - minV) / range) * (H - pad * 2),
 }))
 const polyline = pts.map(p => `${p.x},${p.y}`).join(' ')
 const area = pts.length > 1
 ? `M${pts[0].x},${H - pad} ` + pts.map(p => `L${p.x},${p.y}`).join(' ') + ` L${pts[pts.length - 1].x},${H - pad} Z`
 : ''
 const gradId = 'grad_' + title.replace(/\W/g, '')
 return (
 <div style={{ background: C.card, borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${C.border}` }}>
 <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 16 }}>{title}</div>
 {loading ? <Spinner /> : !data || data.length === 0
 ? <div style={{ textAlign: 'center', color: C.muted, padding: '20px 0', fontSize: 12 }}>No data yet</div>
 : <>
 <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 100 }}>
 <defs>
 <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor={color} stopOpacity="0.3" />
 <stop offset="100%" stopColor={color} stopOpacity="0.02" />
 </linearGradient>
 </defs>
 {area && <path d={area} fill={`url(#${gradId})`} />}
 {pts.length > 1 && <polyline points={polyline} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
 {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={color} />)}
 </svg>
 <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
 {labels.map((l, i) => <span key={i} style={{ fontSize: 9, color: C.muted, flex: 1, textAlign: 'center' }}>{l}</span>)}
 </div>
 </>
 }
 </div>
 )
}

// ─── STAT TABLE ────────────────────────────────────────────────────
function StatTable({ title, cols, rows, loading }) {
 return (
 <div style={{ background: C.card, borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${C.border}` }}>
 <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>{title}</div>
 {loading ? <Spinner /> : (
 <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
 <thead>
 <tr style={{ borderBottom: `1px solid ${C.border}` }}>
 {cols.map(c => <th key={c} style={{ textAlign: 'left', padding: '6px 8px', color: C.muted, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{c}</th>)}
 </tr>
 </thead>
 <tbody>
 {rows.length === 0
 ? <tr><td colSpan={cols.length} style={{ padding: '16px 8px', textAlign: 'center', color: C.muted }}>No data</td></tr>
 : rows.map((r, i) => (
 <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 1 ? '#fafafa' : 'transparent' }}>
 {r.map((cell, j) => <td key={j} style={{ padding: '8px 8px', color: C.text }}>{cell}</td>)}
 </tr>
 ))
 }
 </tbody>
 </table>
 )}
 </div>
 )
}

// ══════════════════════════════════════════════════════════════════
// MAIN REPORTS SCREEN
// ══════════════════════════════════════════════════════════════════
export default function Reports() {
 const { hospitalId } = useContext(HospitalContext)
 const [tab, setTab] = useState('overview')
 const [range, setRange] = useState('month')
 const [data, setData] = useState({})
 const [loading, setLoading] = useState(true)

 useEffect(() => { if (hospitalId) fetchAll() }, [hospitalId, range])

 useEffect(() => {
 if (!hospitalId) return undefined
 const refresh = () => fetchAll()
 window.addEventListener('remedacare:workflow_changed', refresh)
 window.addEventListener('remedacare:prescriptions_changed', refresh)
 window.addEventListener('remedacare:antibiogram_updated', refresh)
 window.addEventListener('remedacare:stewardship_changed', refresh)
 return () => {
 window.removeEventListener('remedacare:workflow_changed', refresh)
 window.removeEventListener('remedacare:prescriptions_changed', refresh)
 window.removeEventListener('remedacare:antibiogram_updated', refresh)
 window.removeEventListener('remedacare:stewardship_changed', refresh)
 }
 }, [hospitalId, range])

 async function fetchAll() {
 setLoading(true)
 const { from, to } = getRange(range)
 const hid = hospitalId

 const [
 { data: visits },
 { data: patients },
 { data: admissions },
 { data: consultations },
 { data: labTests },
 { data: invoices },
 { data: mpesa },
 { data: creditDebts },
 { data: salesLedger },
 { data: prescriptions },
 { data: insuranceClaims },
 { data: shaClaims },
 { data: staff },
 { data: staffLeave },
 { data: pharmInventory },
 { data: drugBatches },
 { data: microbiologyResults },
 { data: stewardshipInterventions },
 { data: departments },
 ] = await Promise.all([
 supabase.from('visits').select('id,created_at,visit_type,status,payment_mode').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
 supabase.from('patients').select('id,created_at,gender').eq('hospital_id', hid),
 supabase.from('admissions').select('id,admission_date,discharge_date,ward,status').eq('hospital_id', hid).gte('admission_date', from).lte('admission_date', to),
 supabase.from('consultations').select('id,created_at,doctor_name,speciality,diagnosis').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
 supabase.from('lab_tests').select('id,created_at,ordered_at,patient_id,patient_name,phone,test_name,test_type,category,priority,notes,source,ordered_by,assigned_to,payment_method,amount,mpesa_ref,visit_id,status').eq('hospital_id', hid).gte('ordered_at', from).lte('ordered_at', to),
 supabase.from('invoices').select('id,created_at,total_amount,amount_kes,amount_paid,paid_kes,status,payment_method,services').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
 supabase.from('mpesa_transactions').select('id,created_at,transacted_at,amount,amount_kes,status,type').eq('hospital_id', hid).gte('transacted_at', from).lte('transacted_at', to),
 supabase.from('credit_debts').select('id,created_at,amount_charged,amount_paid,balance,status,category').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
 supabase.from('sales_ledger').select('id,created_at,sold_at,receipt_number,customer_name,drug_name,quantity,qty_sold,total_price,total_kes,payment_mode,payment_method').eq('hospital_id', hid).gte('sold_at', from).lte('sold_at', to),
 supabase.from('prescriptions').select('id,created_at,status,patient_id,patient_name,drug_name').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
 supabase.from('insurance_claims').select('id,created_at,amount_claimed,amount_approved,status,insurer_name').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
 supabase.from('sha_claims').select('id,created_at,amount_claimed,amount_paid,status').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
 supabase.from('staff').select('id,full_name,department,employment_type,status,salary,salary_kes,current_shift').eq('hospital_id', hid),
 supabase.from('staff_leave').select('id,created_at,status,leave_type,staff_id,start_date,end_date').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
 supabase.from('pharmacy_inventory').select('id,drug_name,quantity,quantity_in_stock,reorder_level').eq('hospital_id', hid),
 supabase.from('drug_batches').select('id,drug_name,batch_number,quantity_remaining,expiry_date,status').eq('hospital_id', hid),
 executeMicrobiologyQuery(select => supabase.from('microbiology_results').select(select).eq('hospital_id', hid).order('updated_at', { ascending: false }).limit(120)),
 executeWithFallback(
 () => supabase.from('stewardship_interventions').select('*').eq('hospital_id', hid).order('created_at', { ascending: false }).limit(160),
 async () => ({ data: [], error: null, compatFallback: true }),
 ),
 supabase.from('departments').select('id,name,status').eq('hospital_id', hid).order('name'),
 ])

 setData({
 visits: visits || [], patients: patients || [], admissions: admissions || [],
 consultations: consultations || [], labTests: labTests || [], invoices: invoices || [],
 mpesa: mpesa || [], creditDebts: creditDebts || [], salesLedger: salesLedger || [],
 prescriptions: prescriptions || [], insuranceClaims: insuranceClaims || [],
 shaClaims: shaClaims || [], staff: staff || [], staffLeave: staffLeave || [],
 pharmInventory: pharmInventory || [], drugBatches: drugBatches || [],
 microbiologyResults: microbiologyResults || [], stewardshipInterventions: stewardshipInterventions || [], departments: departments || [],
 })
 setLoading(false)
 }

 // ── DERIVED METRICS ─────────────────────────────────────────────
 const d = data

 // ── FINANCE ─────────────────────────────────────
 const totalInvoiced = (d.invoices || []).reduce((s, r) =>
 s + Number(r.total_amount || r.amount_kes || 0), 0)

 const totalCollected = (d.invoices || []).reduce((s, r) =>
 s + Number(r.amount_paid || r.paid_kes || 0), 0)

 const totalMpesa = (d.mpesa || [])
 .filter(r => ['completed', 'Completed'].includes(r.status))
 .reduce((s, r) =>
 s + Number(r.amount || r.amount_kes || 0), 0)

 const totalDebt = (d.creditDebts || []).reduce((s, r) =>
 s + Number(
 r.balance ??
 (Number(r.amount_charged || 0) - Number(r.amount_paid || 0))
 ), 0)

 const pharmRevenue = (d.salesLedger || []).reduce((s, r) =>
 s + Number(r.total_price || r.total_kes || 0), 0)

 const insApproved = (d.insuranceClaims || []).reduce((s, r) =>
 s + Number(r.amount_approved || r.amount_claimed || 0), 0)

 const shaApproved = (d.shaClaims || []).reduce((s, r) =>
 s + Number(r.amount_paid || 0), 0)

 const payMethods = groupCount(d.invoices || [],
 r => r.payment_method || 'Unknown')

 const revByDay = revenueByDay(d.invoices || [])

 // ── PAYMENT METHOD BREAKDOWN ─────────────────────────────────────
 const cashCollected = (d.invoices || []).filter(r => r.payment_method === 'Cash').reduce((s, r) => s + Number(r.paid_kes || r.amount_paid || 0), 0)
 const mpesaCollected = (d.invoices || []).filter(r => r.payment_method === 'M-Pesa').reduce((s, r) => s + Number(r.paid_kes || r.amount_paid || 0), 0)
 const shaTotal = (d.invoices || []).filter(r => (r.payment_method || '').toLowerCase().includes('sha')).reduce((s, r) => s + Number(r.amount_kes || 0), 0)
 const insTotal = (d.invoices || []).filter(r => !['Cash', 'M-Pesa', 'Credit'].includes(r.payment_method || '') && !(r.payment_method || '').toLowerCase().includes('sha')).reduce((s, r) => s + Number(r.amount_kes || 0), 0)
 const creditTotal = (d.invoices || []).filter(r => r.payment_method === 'Credit').reduce((s, r) => s + Number(r.amount_kes || 0), 0)
 const shaClaimsPending = (d.shaClaims || []).filter(r => ['Pending', 'Submitted', 'Under Review'].includes(r.status)).length
 const shaClaimsApproved = (d.shaClaims || []).filter(r => ['Approved', 'Paid'].includes(r.status)).length
 const insClaimsPending = (d.insuranceClaims || []).filter(r => ['Draft', 'Pending', 'Submitted', 'Pre-auth', 'Under Review'].includes(r.status)).length
 const insClaimsApproved = (d.insuranceClaims || []).filter(r => ['Approved', 'Paid'].includes(r.status)).length

 const debtByCategory = groupSum(
 d.creditDebts || [],
 r => r.category || 'Unknown',
 r => Number(r.balance || 0)
 )

 // ── CLINICAL ────────────────────────────────────
 const totalVisits = d.visits?.length || 0
 const totalPatients = d.patients?.length || 0
 const totalAdmissions = d.admissions?.length || 0

 const activeAdmissions = (d.admissions || []).filter(r =>
 ['active', 'Active', 'admitted', 'Admitted'].includes(r.status)
 ).length

 const totalConsults = d.consultations?.length || 0
 const totalLab = d.labTests?.length || 0

 const deptData = groupCount(
 d.consultations || [],
 r => r.speciality || r.department || 'General'
 ).slice(0, 8)

 const diagData = groupCount(
 d.consultations || [],
 r => r.diagnosis || 'Unspecified'
 ).slice(0, 8)

 const visitTypes = groupCount(
 d.visits || [],
 r => r.visit_type || 'OPD'
 )

 const labBreakdown = groupCount(
 d.labTests || [],
 r => r.test_type || r.test_name || 'Unknown'
 ).slice(0, 8)

 const labStaffNames = (d.labTests || []).flatMap(r =>
 [r.ordered_by, r.assigned_to]
 .map(v => (v || '').trim())
 .filter(Boolean)
 )

 const labStaffUsage = groupCount(
 labStaffNames.map(name => ({ name })),
 r => r.name
 ).slice(0, 12)

 const hrNames = new Set(
 (d.staff || []).map(s => (s.full_name || '').trim()).filter(Boolean)
 )

 const missingLabStaff = labStaffUsage
 .filter(item => item.label !== 'Unknown' && !hrNames.has(item.label))
 .slice(0, 10)

 const unlinkedLabStaff = missingLabStaff.length

 const patientGender = groupCount(
 d.patients || [],
 r => r.gender || 'Unknown'
 )

 // ── PHARMACY ────────────────────────────────────
 const totalSold = (d.salesLedger || []).reduce((s, r) =>
 s + Number(r.quantity || r.qty_sold || 0), 0)

 const topDrugsRev = groupSum(
 d.salesLedger || [],
 r => r.drug_name || 'Unknown',
 r => Number(r.total_price || r.total_kes || 0)
 ).slice(0, 8)

 const topDrugsQty = groupSum(
 d.salesLedger || [],
 r => r.drug_name || 'Unknown',
 r => Number(r.quantity || r.qty_sold || 0)
 ).slice(0, 8)

 const pharmacyPayMethods = groupCount(
 d.salesLedger || [],
 r => r.payment_method || r.payment_mode || 'Unknown'
 )

 const recentPharmacyReceipts = Object.values((d.salesLedger || []).reduce((acc, row) => {
 const key = row.receipt_number || row.id
 if (!acc[key]) {
 acc[key] = {
 receipt_number: row.receipt_number || '—',
 customer_name: row.customer_name || 'Walk-in',
 payment_method: row.payment_method || row.payment_mode || 'Unknown',
 total_kes: 0,
 sold_at: row.sold_at || null,
 items: 0,
 }
 }
 acc[key].total_kes += Number(row.total_price || row.total_kes || 0)
 acc[key].items += Number(row.quantity || row.qty_sold || 1)
 if (!acc[key].sold_at || new Date(row.sold_at || 0) > new Date(acc[key].sold_at || 0)) {
 acc[key].sold_at = row.sold_at || acc[key].sold_at
 }
 return acc
 }, {}))
 .sort((a, b) => new Date(b.sold_at || 0) - new Date(a.sold_at || 0))
 .slice(0, 8)

 const lowStock = (d.pharmInventory || [])
 .filter(r =>
 Number(r.quantity || r.quantity_in_stock || 0) <=
 Number(r.reorder_level || 10)
 ).slice(0, 10)

 const expiryAlert = (d.drugBatches || [])
 .filter(r => {
 if (!r.expiry_date) return false
 const diff = (new Date(r.expiry_date) - new Date()) / (1000*60*60*24)
 return diff >= 0 && diff < 90
 })
 .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date))
 .slice(0, 10)

 // ── STAFF ───────────────────────────────────────
 const totalStaff = d.staff?.length || 0
 const activeStaff = (d.staff || []).filter(r => ['active', 'Active'].includes(r.status)).length

 const byDept = groupCount(
 d.staff || [],
 r => r.department || 'Unknown'
 ).slice(0, 8)

 const byStatus = groupCount(
 d.staff || [],
 r => r.status || 'Unknown'
 )

 const byType = groupCount(
 d.staff || [],
 r => r.employment_type || 'Unknown'
 )

 const activeLeave = (d.staffLeave || []).filter(r =>
 ['approved', 'Approved'].includes(r.status)
 ).length

 const totalPayroll = (d.staff || []).reduce((s, r) =>
 s + Number(r.salary || r.salary_kes || 0), 0)

 const pendingMpesaCount = (d.mpesa || []).filter(r => String(r.status || '').toLowerCase() === 'pending').length
 const pendingMpesaAmount = (d.mpesa || []).filter(r => String(r.status || '').toLowerCase() === 'pending').reduce((s, r) => s + Number(r.amount || r.amount_kes || 0), 0)
 const pendingInsuranceCount = (d.insuranceClaims || []).filter(r => ['draft', 'pending', 'pre-auth', 'submitted', 'under review', 'appealed'].includes(String(r.status || '').toLowerCase())).length
 const pendingInsuranceAmount = (d.insuranceClaims || []).filter(r => ['draft', 'pending', 'pre-auth', 'submitted', 'under review', 'appealed'].includes(String(r.status || '').toLowerCase())).reduce((s, r) => s + Number(r.amount_claimed || r.amount_approved || 0), 0)
 const pendingShaCount = (d.shaClaims || []).filter(r => ['pending', 'submitted', 'under review', 'appealed'].includes(String(r.status || '').toLowerCase())).length
 const pendingShaAmount = (d.shaClaims || []).filter(r => ['pending', 'submitted', 'under review', 'appealed'].includes(String(r.status || '').toLowerCase())).reduce((s, r) => s + Number(r.amount_claimed || 0), 0)

 const amrItems = buildAmrInterventions({
 results: d.microbiologyResults || [],
 prescriptions: d.prescriptions || [],
 interventions: d.stewardshipInterventions || [],
 maxAgeDays: 30,
 })
 const amrSummary = summarizeAmrInterventions(amrItems)

 const activeStaffByDepartment = (d.staff || []).reduce((map, member) => {
 if (!['active', 'approved'].includes(String(member.status || '').toLowerCase())) return map
 const key = member.department || 'Unknown'
 map[key] = (map[key] || 0) + 1
 return map
 }, {})

 const departmentsWithoutActiveStaff = (d.departments || [])
 .filter(department => String(department.status || 'active').toLowerCase() !== 'inactive')
 .filter(department => !(activeStaffByDepartment[department.name] > 0))
 .map(department => ({ label: department.name, value: 0 }))

 // ── RENDER ──────────────────────────────────────────────────────
 return (
 <div style={{ padding: '20px 24px', minHeight: '100%', background: C.bg, fontFamily: typography.systemFontFamily }}>
 <style>{`
 @keyframes spin { to { transform: rotate(360deg) } }
 @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
 `}</style>

 {/* HEADER */}
 <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
 <div>
 <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}> Reports & Analytics</h2>
 <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted }}>Live data from your hospital records</p>
 </div>
 <div style={{ display: 'flex', gap: 5, background: '#fff', padding: 4, borderRadius: 10, border: `1px solid ${C.border}` }}>
 {RANGES.map(r => (
 <button key={r.id} onClick={() => setRange(r.id)} style={{ padding: '5px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, background: range === r.id ? C.primary : 'transparent', color: range === r.id ? '#fff' : C.muted, transition: 'all 0.2s' }}>
 {r.label}
 </button>
 ))}
 </div>
 </div>

 {/* TABS */}
 <div style={{ display: 'flex', gap: 2, marginBottom: 22, borderBottom: `1.5px solid ${C.border}`, overflowX: 'auto' }}>
 {[
 { id: 'overview', label: 'Overview' },
 { id: 'finance', label: 'Finance' },
 { id: 'clinical', label: 'Clinical' },
 { id: 'pharmacy', label: 'Pharmacy' },
 { id: 'staff', label: 'HR & Staff' }
 ].map(t => (
 <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '9px 18px', border: 'none', borderBottom: `2.5px solid ${tab === t.id ? C.primary : 'transparent'}`, marginBottom: -1.5, background: 'transparent', color: tab === t.id ? C.primary : C.muted, fontWeight: tab === t.id ? 700 : 500, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
 {t.label}
 </button>
 ))}
 </div>

 {/* ════ OVERVIEW ════════════════════════════════════════════ */}
 {tab === 'overview' && (
 <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
 <div style={grid(4)}>
 <KpiCard label="Total Patients" value={num(totalPatients)} sub="All time" color={C.primary} loading={loading} />
 <KpiCard label="Visits" value={num(totalVisits)} sub="This period" color={C.info} loading={loading} />
 <KpiCard label="Revenue Collected" value={fmt(totalCollected)} sub="Invoices paid" color={C.green} loading={loading} />
 <KpiCard label="Outstanding Debt" value={fmt(totalDebt)} sub="Unpaid balance" color={C.danger} loading={loading} />
 </div>
 <div style={grid(4)}>
 <KpiCard label="Active Admissions" value={num(activeAdmissions)} sub="Currently admitted" color={C.warn} loading={loading} />
 <KpiCard label="Consultations" value={num(totalConsults)} sub="This period" color={C.purple} loading={loading} />
 <KpiCard label="Lab Tests" value={num(totalLab)} sub="This period" color={C.info} loading={loading} />
 <KpiCard label="M-Pesa Received" value={fmt(totalMpesa)} sub="Confirmed" color={C.green} loading={loading} />
 </div>
 <div style={grid(4)}>
 <KpiCard label="Pending M-Pesa" value={num(pendingMpesaCount)} sub={fmt(pendingMpesaAmount)} color={C.warn} loading={loading} />
 <KpiCard label="Pending SHA" value={num(pendingShaCount)} sub={fmt(pendingShaAmount)} color={C.info} loading={loading} />
 <KpiCard label="Pending Insurance" value={num(pendingInsuranceCount)} sub={fmt(pendingInsuranceAmount)} color={C.purple} loading={loading} />
 <KpiCard label="AMR Watchlist" value={num(amrSummary.pendingReview)} sub={`${num(amrSummary.resistantOverlap)} resistant overlaps`} color={C.danger} loading={loading} />
 </div>
 <div style={grid(2)}>
 <LineChart title="Revenue Trend (Daily)" data={revByDay} color={C.primary} loading={loading} />
 <DonutChart title="Visit Types Breakdown" data={visitTypes} loading={loading} />
 </div>
 <div style={grid(2)}>
 <BarChart title="Busiest Departments" data={deptData} loading={loading} />
 <BarChart title="Top Drugs by Revenue" data={topDrugsRev} valuePrefix="KES " loading={loading} />
 </div>
 </div>
 )}

 {/* ════ FINANCE ═════════════════════════════════════════════ */}
 {tab === 'finance' && (
 <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

 {/* Payment method reconciliation row */}
 <div style={{ background: '#fff', border: '1px solid #E8ECF2', borderRadius: '10px', overflow: 'hidden' }}>
   <div style={{ padding: '10px 16px', background: '#FAFBFD', borderBottom: '1px solid #E8ECF2', fontWeight: 700, fontSize: '13px' }}>
     Payment Method Reconciliation
   </div>
   <div style={grid(5)} >
     <KpiCard label="💵 Cash Collected" value={fmt(cashCollected)} color="#374151" loading={loading} />
     <KpiCard label="📱 M-Pesa Collected" value={fmt(mpesaCollected)} color={C.green} loading={loading} />
     <KpiCard label="🏥 SHA Billed" value={fmt(shaTotal)} color="#2563EB" loading={loading} sub={`${shaClaimsPending} pending · ${shaClaimsApproved} approved`} />
     <KpiCard label="🛡️ Insurance Billed" value={fmt(insTotal)} color={C.warn} loading={loading} sub={`${insClaimsPending} pending · ${insClaimsApproved} approved`} />
     <KpiCard label="📋 Credit Outstanding" value={fmt(creditTotal)} color="#7C3AED" loading={loading} />
   </div>
 </div>

 <div style={grid(4)}>
 <KpiCard label="Total Invoiced" value={fmt(totalInvoiced)} color={C.primary} loading={loading} />
 <KpiCard label="Amount Collected" value={fmt(totalCollected)} color={C.green} loading={loading} />
 <KpiCard label="M-Pesa In" value={fmt(totalMpesa)} color={C.green} loading={loading} />
 <KpiCard label="Outstanding Debt" value={fmt(totalDebt)} color={C.danger} loading={loading} />
 </div>
 <div style={grid(3)}>
 <KpiCard icon="" label="Pharmacy Revenue" value={fmt(pharmRevenue)} color={C.purple} loading={loading} />
 <KpiCard icon="" label="Insurance Approved" value={fmt(insApproved)} color={C.info} loading={loading} />
 <KpiCard icon="" label="SHA Approved" value={fmt(shaApproved)} color={C.warn} loading={loading} />
 </div>
 <div style={grid(3)}>
 <KpiCard icon="" label="M-Pesa Pending" value={fmt(pendingMpesaAmount)} color={C.warn} loading={loading} sub={`${num(pendingMpesaCount)} transactions`} />
 <KpiCard icon="" label="Insurance Backlog" value={fmt(pendingInsuranceAmount)} color={C.purple} loading={loading} sub={`${num(pendingInsuranceCount)} claims`} />
 <KpiCard icon="" label="SHA Backlog" value={fmt(pendingShaAmount)} color={C.info} loading={loading} sub={`${num(pendingShaCount)} claims`} />
 </div>
 <div style={grid(2)}>
 <LineChart title=" Daily Revenue Trend" data={revByDay} color={C.primary} loading={loading} />
 <DonutChart title="Payment Methods" data={payMethods} loading={loading} />
 </div>
 <div style={grid(2)}>
 <BarChart title="Outstanding Debt by Category" data={debtByCategory} valuePrefix="KES " loading={loading} />
 <StatTable
 title=" Recent Invoices"
 cols={['Amount', 'Paid', 'Method', 'Status']}
 loading={loading}
 rows={(d.invoices || []).slice(0, 8).map(r => [
 fmt(r.total_amount || r.amount_kes),
 fmt(r.amount_paid || r.paid_kes),
 r.payment_method || '—',
 <Badge label={r.status || '?'} color={String(r.status || '').toLowerCase() === 'paid' ? C.green : String(r.status || '').toLowerCase() === 'partial' ? C.warn : C.danger} />,
 ])}
 />
 </div>
 </div>
 )}

 {/* ════ CLINICAL ════════════════════════════════════════════ */}
 {tab === 'clinical' && (
 <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
 <div style={grid(4)}>
 <KpiCard label="Visits" value={num(totalVisits)} color={C.primary} loading={loading} />
 <KpiCard label="Admissions" value={num(totalAdmissions)} color={C.warn} loading={loading} />
 <KpiCard label="Consultations" value={num(totalConsults)} color={C.purple} loading={loading} />
 <KpiCard label="Lab Tests" value={num(totalLab)} color={C.info} loading={loading} />
 </div>
 <div style={grid(4)}>
 <KpiCard label="AMR Pending Review" value={num(amrSummary.pendingReview)} color={C.danger} loading={loading} />
 <KpiCard label="High Severity AMR" value={num(amrSummary.highSeverity)} color={C.danger} loading={loading} />
 <KpiCard label="Resistant Rx Overlap" value={num(amrSummary.resistantOverlap)} color={C.warn} loading={loading} />
 <KpiCard label="Lab Staff Gaps" value={num(unlinkedLabStaff)} color={C.info} loading={loading} />
 </div>
 <div style={grid(2)}>
 <BarChart title=" Busiest Departments" data={deptData} loading={loading} />
 <BarChart title="Most Requested Lab Tests" data={labBreakdown} loading={loading} />
 </div>
 <div style={grid(2)}>
 <BarChart title=" Top Diagnoses" data={diagData} loading={loading} />
 <DonutChart title="Patient Gender Split" data={patientGender} loading={loading} />
 </div>
 <StatTable
 title=" AMR Stewardship Watchlist"
 cols={['Patient', 'Organism', 'Department', 'Severity', 'Review Status']}
 loading={loading}
 rows={amrItems.slice(0, 8).map(item => [
 item.patientName,
 item.organism,
 item.department || 'Not captured',
 <Badge label={item.severity} color={item.severity === 'high' ? C.danger : item.severity === 'medium' ? C.warn : C.info} />,
 item.requiresReview ? 'Awaiting pharmacist note' : 'Intervention saved',
 ])}
 />
 <StatTable
 title=" Recent Admissions"
 cols={['Ward', 'Admitted', 'Discharged', 'Status']}
 loading={loading}
 rows={(d.admissions || []).slice(0, 10).map(r => [
 r.ward || '—',
 r.admission_date ? new Date(r.admission_date).toLocaleDateString() : '—',
 r.discharge_date ? new Date(r.discharge_date).toLocaleDateString() : 'Still admitted',
 <Badge label={r.status || '?'} color={r.status === 'admitted' ? C.warn : r.status === 'discharged' ? C.green : C.muted} />,
 ])}
 />
 </div>
 )}

 {/* ════ PHARMACY ════════════════════════════════════════════ */}
 {tab === 'pharmacy' && (
 <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
 <div style={grid(4)}>
 <KpiCard label="Pharmacy Revenue" value={fmt(pharmRevenue)} color={C.primary} loading={loading} />
 <KpiCard label="Units Sold" value={num(totalSold)} color={C.purple} loading={loading} />
 <KpiCard label="Low Stock Items" value={num(lowStock.length)} color={C.danger} loading={loading} sub="Below reorder level" />
 <KpiCard label="Expiring Soon" value={num(expiryAlert.length)} color={C.warn} loading={loading} sub="Within 90 days" />
 </div>
 <div style={grid(2)}>
 <BarChart title=" Top Drugs by Revenue" data={topDrugsRev} valuePrefix="KES " loading={loading} />
 <BarChart title="Top Drugs by Quantity Sold" data={topDrugsQty} valueSuffix=" units" loading={loading} />
 </div>
 <div style={grid(2)}>
 <DonutChart title="POS Payment Mix" data={pharmacyPayMethods} loading={loading} />
 <StatTable
 title=" Low Stock Alert"
 cols={['Drug', 'Qty Left', 'Reorder Level']}
 loading={loading}
 rows={lowStock.map(r => [
 r.drug_name,
 <span style={{ color: C.danger, fontWeight: 700 }}>{r.quantity || r.quantity_in_stock || 0}</span>,
 r.reorder_level || 10,
 ])}
 />
 </div>
 <div style={grid(2)}>
 <StatTable
 title="Expiring Within 90 Days"
 cols={['Drug', 'Batch', 'Expiry Date', 'Qty Left']}
 loading={loading}
 rows={expiryAlert.map(r => [
 r.drug_name,
 r.batch_number || '—',
 r.expiry_date ? new Date(r.expiry_date).toLocaleDateString() : '—',
 <span style={{ color: C.warn, fontWeight: 700 }}>{r.quantity_remaining}</span>,
 ])}
 />
 <StatTable
 title=" Recent Pharmacy Receipts"
 cols={['Receipt', 'Patient', 'Payment', 'Amount', 'Sold']}
 loading={loading}
 rows={recentPharmacyReceipts.map(r => [
 r.receipt_number,
 r.customer_name,
 r.payment_method,
 fmt(r.total_kes),
 r.sold_at ? new Date(r.sold_at).toLocaleString() : '—',
 ])}
 />
 </div>
 </div>
 )}

 {/* ════ STAFF / HR ══════════════════════════════════════════ */}
 {tab === 'staff' && (
 <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
 <div style={grid(4)}>
 <KpiCard label="Total Staff" value={num(totalStaff)} color={C.primary} loading={loading} />
 <KpiCard label="Active Staff" value={num(activeStaff)} color={C.green} loading={loading} />
 <KpiCard label="On Leave Now" value={num(activeLeave)} color={C.warn} loading={loading} />
 <KpiCard label="Unlinked Lab Staff" value={num(unlinkedLabStaff)} color={C.info} loading={loading} sub="Lab names missing in HR" />
 </div>
 <div style={grid(2)}>
 <BarChart title=" Staff by Department" data={byDept} loading={loading} />
 <DonutChart title="Staff by Status" data={byStatus} loading={loading} />
 </div>
 <StatTable
 title=" Recent Leave Requests"
 cols={['Leave Type', 'Status', 'Applied']}
 loading={loading}
 rows={(d.staffLeave || []).slice(0, 10).map(r => [
 r.leave_type || '—',
 <Badge label={r.status || '?'} color={r.status === 'approved' ? C.green : r.status === 'rejected' ? C.danger : C.warn} />,
 r.created_at ? new Date(r.created_at).toLocaleDateString() : '—',
 ])}
 />
 <StatTable
 title=" Lab Staff Names Missing in HR"
 cols={['Name', 'Lab Records']}
 loading={loading}
 rows={missingLabStaff.length === 0 ? [] : missingLabStaff.map(item => [
 item.label,
 num(item.value),
 ])}
 />
 <StatTable
 title=" Departments Without Active Staff"
 cols={['Department', 'Status']}
 loading={loading}
 rows={departmentsWithoutActiveStaff.length === 0 ? [] : departmentsWithoutActiveStaff.map(item => [
 item.label,
 'No active cover',
 ])}
 />
 </div>
 )}
 </div>
 )
}
