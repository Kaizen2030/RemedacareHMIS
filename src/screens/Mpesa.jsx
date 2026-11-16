import { useEffect, useState } from 'react'
import SkeletonLoader from '../components/SkeletonLoader'
import supabase from '../supabase'
import { useHospital } from '../context'
import { executeWithFallback, omitKeys } from '../utils/dbCompat'
import { broadcastWorkflowChanged } from '../utils/workflowEvents'
import { fetchPaymentStatus, listInvoicePayments, newIdempotencyKey, pollUntilSettled, recordManualPayments, refundPayment, startOnlinePayment } from '../utils/payments/api'
import { canManagePayments } from '../access'
import { isValidMpesaCode, normalizeKenyanPhone } from '../utils/payments/phone'
import { colors as C, typography } from '../theme'
import { notifyError, notifyFromLegacyAlert, notifyInfo, notifySuccess, notifyWarning } from '../notifications'

const STATUS_COLORS = {
 Completed: { bg: C.primaryL, color: C.primary },
 Pending: { bg: C.warnL, color: C.warn },
 Failed: { bg: C.dangerL, color: C.danger },
 Reversed: { bg: '#F3F4F6', color: C.sub },
}

const css = {
 page: { minHeight:'100vh', background:C.bg, fontFamily:typography.fontFamily, fontSize:'13px', color:C.text },
 wrap: { padding:'20px 24px', maxWidth:'1400px', margin:'0 auto' },
 header: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'4px' },
 h1: { fontSize:'18px', fontWeight:700, margin:0 },
 subtext: { fontSize:'12px', color:C.sub, marginBottom:'20px' },
 statsRow: { display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'12px', marginBottom:'20px' },
 stat: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'14px 16px' },
 statLbl: { fontSize:'11px', color:C.sub, fontWeight:600, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px' },
 statVal: { fontSize:'20px', fontWeight:800, letterSpacing:'-0.5px' },
 statSub: { fontSize:'11px', color:C.muted, marginTop:'3px' },
 tabRow: { display:'flex', gap:'4px', marginBottom:'16px', background:C.surface, border:`1px solid ${C.border}`, borderRadius:'8px', padding:'6px' },
 tab: { padding:'7px 16px', borderRadius:'6px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight:500, color:C.sub, background:'none' },
 tabActive: { background:C.primary, color:'#fff', fontWeight:600 },
 toolbar: { display:'flex', gap:'8px', marginBottom:'14px', alignItems:'center', flexWrap:'wrap' },
 searchWrap:{ position:'relative', flex:1, minWidth:'200px' },
 searchIcon:{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:C.muted, fontSize:'13px' },
 searchInp: { width:'100%', boxSizing:'border-box', padding:'8px 10px 8px 30px', border:`1px solid ${C.border}`, borderRadius:'7px', fontSize:'13px', outline:'none', background:C.surface },
 select: { padding:'8px 10px', border:`1px solid ${C.border}`, borderRadius:'7px', fontSize:'12px', background:C.surface, color:C.text, outline:'none', cursor:'pointer' },
 btn: { padding:'8px 14px', borderRadius:'7px', border:'none', cursor:'pointer', fontWeight:600, fontSize:'12px', whiteSpace:'nowrap' },
 btnPri: { background:C.primary, color:'#fff' },
 btnGhost: { background:C.surface, border:`1px solid ${C.border}`, color:C.text },
 btnBlue: { background:C.blueL, color:C.blue, border:'none' },
 card: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:'10px', overflow:'hidden', marginBottom:'16px' },
 cardHead: { padding:'12px 16px', borderBottom:`1px solid ${C.border}`, fontSize:'13px', fontWeight:600, color:C.text, background:'#FAFBFD', display:'flex', justifyContent:'space-between', alignItems:'center' },
 table: { width:'100%', borderCollapse:'collapse' },
 th: { padding:'9px 14px', textAlign:'left', fontSize:'11px', fontWeight:700, color:C.sub, textTransform:'uppercase', letterSpacing:'.5px', borderBottom:`2px solid ${C.border}`, background:'#FAFBFD', whiteSpace:'nowrap' },
 td: { padding:'11px 14px', borderBottom:`1px solid ${C.border}`, fontSize:'13px', verticalAlign:'middle' },
 badge: { display:'inline-block', padding:'2px 9px', borderRadius:'20px', fontSize:'11px', fontWeight:600 },
 overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,.4)', zIndex:999, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' },
 modal: { background:C.surface, borderRadius:'12px', padding:'24px', width:'480px', maxWidth:'95vw', boxShadow:'0 20px 60px rgba(0,0,0,.2)', maxHeight:'90vh', overflowY:'auto' },
 modalH: { fontSize:'15px', fontWeight:700, marginBottom:'16px', color:C.text },
 lbl: { fontSize:'11px', fontWeight:600, color:C.sub, textTransform:'uppercase', letterSpacing:'.4px', marginBottom:'4px', display:'block' },
 input: { width:'100%', boxSizing:'border-box', padding:'9px 11px', border:`1px solid ${C.border}`, borderRadius:'7px', fontSize:'13px', color:C.text, outline:'none', background:C.surface, marginBottom:'12px' },
 grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' },
 divider: { border:'none', borderTop:`1px solid ${C.border}`, margin:'16px 0' },
}

function Badge({ status }) {
 const sc = STATUS_COLORS[status] || { bg:'#F3F4F6', color:C.sub }
 return <span style={{...css.badge, background:sc.bg, color:sc.color}}>{status || '—'}</span>
}

function getDateRange(range) {
 const now = new Date()
 const start = new Date()
 if (range === 'today') start.setHours(0,0,0,0)
 else if (range === 'week') start.setDate(now.getDate()-7)
 else if (range === 'month') start.setDate(now.getDate()-30)
 else start.setFullYear(2000)
 return start.toISOString()
}

function isInsurancePaymentMethod(method) {
 const normalized = String(method || '').toLowerCase()
 return normalized.includes('insurance') || normalized.includes('sha') || normalized.includes('nhif') || normalized.includes('corporate')
}

export default function MPesa() {
 const { hospitalId, userRole } = useHospital()
 const isAdmin = ['Admin','admin'].includes(userRole || '')
 const [loading, setLoading] = useState(true)
 const [saving, setSaving] = useState(false)
 const [activeTab, setActiveTab] = useState('transactions')
 const [records, setRecords] = useState([])
 const [ledger, setLedger] = useState([]) // sales_ledger mpesa entries
 const [invoices, setInvoices] = useState([]) // billing invoices for linking/reconciliation
 const [search, setSearch] = useState('')
 const [statusFilter, setStatusFilter] = useState('all')
 const [dateFilter, setDateFilter] = useState('today')
 const [showAdd, setShowAdd] = useState(false)
 const [showDetail, setShowDetail] = useState(null)
 const [stkPhone, setStkPhone] = useState('')
 const [stkAmount, setStkAmount] = useState('')
 const [stkService, setStkService] = useState('')
 const [stkInvoiceId, setStkInvoiceId] = useState('')
 const [stkLoading, setStkLoading] = useState(false)

 const emptyForm = { reference:'', phone:'', amount_kes:'', drug_or_service:'', status:'Completed', transacted_at: new Date().toISOString().slice(0,16), invoice_id:'', patient_id:'', visit_id:'' }
 const [form, setForm] = useState(emptyForm)

 useEffect(() => { if (!hospitalId) { setLoading(false); return }; fetchAll() }, [hospitalId])

 async function fetchAll() {
 setLoading(true)
 const since = getDateRange('all')
 const [{ data: mp }, { data: sl }, { data: inv }] = await Promise.all([
 supabase.from('mpesa_transactions').select('*')
 .eq('hospital_id', hospitalId).order('transacted_at', { ascending: false }),
 supabase.from('sales_ledger').select('id,patient_id,customer_name,patient_phone,drug_name,total_kes,mpesa_ref,payment_method,sold_at,receipt_number')
 .eq('hospital_id', hospitalId).eq('payment_method','M-Pesa').order('sold_at',{ascending:false}).limit(200),
 supabase.from('invoices').select('id,patient_id,visit_id,patient_name,invoice_no,amount_kes,paid_kes,balance_kes,payment_method,status,created_at')
 .eq('hospital_id', hospitalId).neq('status','Cancelled').order('created_at',{ascending:false}).limit(300),
 ])
 setRecords(mp || [])
 setLedger(sl || [])
 setInvoices(inv || [])
 setLoading(false)
 }

 async function syncInvoiceForTransaction(record, nextStatus) {
 const invoiceId = record?.invoice_id
 if (!invoiceId) return

 const linkedInvoice = invoices.find(inv => inv.id === invoiceId)
 if (!linkedInvoice) return

 const amount = Number(record.amount_kes || 0)
 const currentlyCompleted = String(record.status || '') === 'Completed'
 const willBeCompleted = nextStatus === 'Completed'
 let nextPaid = Number(linkedInvoice.paid_kes || 0)

 if (!currentlyCompleted && willBeCompleted) {
  // Preferred path: record in the payments ledger so the M-Pesa code, receipt no. and audit trail exist.
  if (isValidMpesaCode(record.reference)) {
   try {
    const saved = await recordManualPayments({
     invoiceId,
     lines: [{ method: 'mpesa_manual', amount, reference: record.reference, phone: record.phone }],
     // per invoice: one patient's M-Pesa payment may legitimately cover several of their invoices
     idempotencyKey: `mpesa-log-${invoiceId}-${String(record.reference).toUpperCase()}`,
    })
    const review = saved.find((p) => p.needs_review && p.review_note)
    if (review) notifyWarning(`Applied to the invoice, but flagged for review: ${review.review_note}`)
   } catch (e) {
    notifyError('M-Pesa transaction saved, but it could not be applied to the invoice: ' + e.message)
   }
   return
  }
  nextPaid += amount // legacy fallback (code not in standard format) — the DB bridge ledgers it
 }
 else if (currentlyCompleted && nextStatus === 'Reversed') {
  // A reversal gives money back: it is a refund on the ledger (finance/admin only, with a reason).
  // Lowering invoices.paid_kes directly is refused by the database.
  const code = String(record.reference || '').toUpperCase()
  const ledgerPayments = await listInvoicePayments(invoiceId).catch(() => [])
  const original = ledgerPayments.find((p) => p.kind === 'payment' && p.status === 'completed' && String(p.reference || '').toUpperCase() === code)
  if (!original) {
   notifyWarning('Marked as reversed here, but no matching payment was found on the invoice. Ask finance to record a refund from Billing → Payments.')
   return
  }
  if (!canManagePayments(userRole)) {
   notifyWarning('Marked as reversed here. Only finance/admin can refund it on the invoice — ask them to refund receipt ' + (original.receipt_no || code) + ' from Billing → Payments.')
   return
  }
  try {
   await refundPayment({ payment: original, amount: Math.min(amount, Number(original.amount)), reason: `M-Pesa transaction ${code} reversed`, reference: code })
  } catch (e) {
   notifyError('Marked as reversed, but the refund could not be recorded on the invoice: ' + e.message)
  }
  return
 }
 else if (currentlyCompleted === willBeCompleted) return

 const total = Number(linkedInvoice.amount_kes || 0)
 const balance = Math.max(0, total - nextPaid)
 const invoiceStatus = balance <= 0 && total > 0 ? 'Paid' : nextPaid > 0 ? 'Partial' : 'Pending'

 const { error } = await supabase.from('invoices')
 .update({
  paid_kes: nextPaid,
  balance_kes: balance,
  status: invoiceStatus,
  payment_method: willBeCompleted ? 'M-Pesa' : linkedInvoice.payment_method,
  paid_at: invoiceStatus === 'Paid' ? new Date().toISOString() : null,
 })
 .eq('hospital_id', hospitalId)
 .eq('id', invoiceId)

 if (error) {
  notifyError('M-Pesa transaction saved, but invoice sync failed: ' + error.message)
 }
 }

 // Auto-match M-Pesa transaction to unlinked M-Pesa invoice by amount
 async function autoMatchInvoice(record) {
  if (record.invoice_id) return
  const amount = Number(record.amount_kes || 0)
  const match = invoices.find(inv =>
   inv.payment_method === 'M-Pesa' &&
   ['Pending', 'Partial'].includes(inv.status) &&
   Math.abs(Number(inv.amount_kes || 0) - amount) < 1
  )
  if (!match) {
   notifyWarning(`No open M-Pesa invoice for KES ${amount.toLocaleString()} was found. Open Billing and use “Pay” on the right invoice instead.`)
   return
  }
  // Amount alone does not identify the patient (many consultations cost the same), so confirm.
  const sure = await window.openConfirmDialog(
   `Apply M-Pesa ${record.reference || ''} (KES ${amount.toLocaleString()}${record.phone ? `, from ${record.phone}` : ''}) to invoice ${match.invoice_no} for ${match.patient_name}?`,
  )
  if (!sure) return
  await supabase.from('mpesa_transactions')
   .update({ invoice_id: match.id, patient_id: match.patient_id || null, visit_id: match.visit_id || null })
   .eq('id', record.id)
  await syncInvoiceForTransaction({ ...record, invoice_id: match.id }, 'Completed')
  await fetchAll()
 }

 async function handleSave() {
 if (!form.reference || !form.amount_kes) { notifyWarning('Reference and amount are required'); return }
 setSaving(true)
 const payload = {
 hospital_id: hospitalId,
 reference: form.reference.toUpperCase().trim(),
 phone: form.phone,
 amount_kes: parseFloat(form.amount_kes),
 drug_or_service:form.drug_or_service,
 patient_id: form.patient_id || null,
 visit_id: form.visit_id || null,
 invoice_id: form.invoice_id || null,
 status: form.status,
 transacted_at: new Date(form.transacted_at).toISOString(),
 }
 const { error } = await executeWithFallback(
  () => supabase.from('mpesa_transactions').insert(payload),
  async () => supabase.from('mpesa_transactions').insert(omitKeys(payload, ['patient_id', 'visit_id', 'invoice_id'])),
 )
 if (error) notifyError('Error: ' + error.message)
 else if (form.status === 'Completed') await syncInvoiceForTransaction({ ...payload, status: 'Pending' }, 'Completed')
 setShowAdd(false); setForm(emptyForm)
 await fetchAll(); setSaving(false)
 if (!error) broadcastWorkflowChanged({ source: 'mpesa-log', reference: form.reference.toUpperCase().trim() })
 }

 async function handleSTKPush() {
 const selectedInvoice = linkableInvoices.find(inv => inv.id === stkInvoiceId)
 if (!selectedInvoice) { notifyWarning('Select the invoice this payment is for — every M-Pesa payment must be linked to an invoice.'); return }
 if (!normalizeKenyanPhone(stkPhone)) { notifyWarning('Enter a valid Safaricom number, e.g. 0712 345 678'); return }
 const amount = Number(stkAmount)
 if (!(amount >= 1) || !Number.isInteger(amount)) { notifyWarning('STK Push works in whole shillings (KES 1 or more).'); return }
 setStkLoading(true)
 try {
  const res = await startOnlinePayment({
   invoiceId: selectedInvoice.id, method: 'mpesa', amount, phone: stkPhone,
   payerName: selectedInvoice.patient_name, idempotencyKey: newIdempotencyKey(),
  })
  notifyWarning(`${res.action?.message || 'Prompt sent.'}\nWaiting for the patient to enter their PIN…`)
  setStkPhone(''); setStkAmount(''); setStkService(''); setStkInvoiceId('')
  await fetchAll()
  pollUntilSettled(res.payment.id, { intervalMs: 3000, timeoutMs: 150000 }).then(async (final) => {
   await fetchAll()
   if (final?.status === 'completed') notifySuccess(`M-Pesa received: KES ${Number(final.amount).toLocaleString()} (${final.reference || final.receipt_no}).`)
   else if (final && final.status !== 'pending') notifySuccess(`M-Pesa payment ${final.status}: ${final.failure_reason || 'not completed'}`)
   broadcastWorkflowChanged({ source: 'mpesa-stk', status: final?.status })
  })
 } catch (e) {
  notifyError('STK Push failed: ' + e.message)
 } finally {
  setStkLoading(false)
 }
}

// Rows mirrored from a gateway payment (STK push) are owned by the payments ledger: their
// status comes from Safaricom / the gateway, never from a button here. Confirming one by hand
// while the STK was still in flight used to count the same money twice.
const isGatewayManaged = (r) => !!r?.payment_id

async function checkGatewayRow(r) {
 try {
  const p = await fetchPaymentStatus(r.payment_id)
  await fetchAll()
  notifyFromLegacyAlert(p ? `Gateway status: ${p.status}${p.failure_reason ? ` — ${p.failure_reason}` : ''}${p.receipt_no ? ` (receipt ${p.receipt_no})` : ''}` : 'No update from the gateway yet.')
 } catch (e) {
  notifyError('Could not check the payment: ' + e.message)
 }
}

async function updateStatus(id, status) {
 const record = records.find(r => r.id === id) || showDetail
 if (isGatewayManaged(record)) {
  notifyInfo('This STK payment is tracked automatically from the gateway. Use “Check” to refresh it; refunds are done by finance from Billing → Payments.')
  return
 }
 await supabase.from('mpesa_transactions').update({ status }).eq('id', id)
 if (record) {
  await syncInvoiceForTransaction(record, status)
  if (status === 'Completed' && !record.invoice_id) {
   await autoMatchInvoice({ ...record, status: 'Completed' })
  }
 }
 await fetchAll()
 broadcastWorkflowChanged({ source: 'mpesa-status', id, status })
}

 // ── Filters ───────────────────────────────────────────────────────────────
 const since = getDateRange(dateFilter)
 const filtered = records.filter(r => {
 const matchDate = dateFilter === 'all' || new Date(r.transacted_at) >= new Date(since)
 const matchStatus = statusFilter === 'all' || r.status === statusFilter
 const matchSearch = !search ||
 r.reference?.toLowerCase().includes(search.toLowerCase()) ||
 r.phone?.includes(search) ||
 r.drug_or_service?.toLowerCase().includes(search.toLowerCase())
 return matchDate && matchStatus && matchSearch
 })

 // ── Stats ─────────────────────────────────────────────────────────────────
 const todayStr = new Date().toDateString()
 const todayRecs = records.filter(r => new Date(r.transacted_at).toDateString() === todayStr && r.status === 'Completed')
 const todayAmt = todayRecs.reduce((s,r) => s + parseFloat(r.amount_kes||0), 0)
 const totalAmt = records.filter(r=>r.status==='Completed').reduce((s,r) => s + parseFloat(r.amount_kes||0), 0)
 const pendingAmt = records.filter(r=>r.status==='Pending').reduce((s,r) => s + parseFloat(r.amount_kes||0), 0)
 const failedCnt = records.filter(r=>r.status==='Failed').length
 const monthRecs = records.filter(r => {
 const d = new Date(r.transacted_at)
 const now = new Date()
 return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear() && r.status==='Completed'
 })
 const monthAmt = monthRecs.reduce((s,r) => s + parseFloat(r.amount_kes||0), 0)

 // Reconciliation — ledger entries with mpesa_ref matched against records
 const reconciledRefs = new Set(records.map(r => r.reference?.toUpperCase()))
 const unmatchedLedger = ledger.filter(l => l.mpesa_ref && !reconciledRefs.has(l.mpesa_ref?.toUpperCase()))
 const linkableInvoices = invoices.filter(inv => {
 const outstanding = Math.max(0, Number(inv.balance_kes ?? (Number(inv.amount_kes || 0) - Number(inv.paid_kes || 0))))
 return outstanding > 0 && !isInsurancePaymentMethod(inv.payment_method) && inv.status !== 'Cancelled'
 })
 // Unlinked completed transactions (no invoice_id set)
 const unlinkedCompleted = records.filter(r => r.status === 'Completed' && !r.invoice_id)

 // Daily breakdown for summary tab
 const dailyMap = {}
 records.filter(r=>r.status==='Completed').forEach(r => {
 const day = new Date(r.transacted_at).toLocaleDateString('en-KE')
 if (!dailyMap[day]) dailyMap[day] = { day, count:0, total:0 }
 dailyMap[day].count++
 dailyMap[day].total += parseFloat(r.amount_kes||0)
 })
 const dailySummary = Object.values(dailyMap).sort((a,b) => new Date(b.day)-new Date(a.day)).slice(0,30)

 if (loading) return (
 <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'80vh',background:C.bg}}>
 <div style={{width:'220px'}}>
 <SkeletonLoader rows={3} height={14} width={['42%','100%','64%']} />
 </div>
 <p style={{color:C.sub,marginTop:12,fontSize:'13px'}}>Loading M-Pesa transactions...</p>
 </div>
 )

 return (
 <div style={css.page}>
 <style>{`@keyframes spin{to{transform:rotate(360deg)}} tr:hover td{background:#FAFBFD}`}</style>
 <div style={css.wrap}>

 {/* HEADER */}
 <div style={css.header}>
 <div>
 <h1 style={css.h1}>M-Pesa Transactions</h1>
 </div>
 <div style={{display:'flex',gap:'8px'}}>
 <button style={{...css.btn,...css.btnGhost}} onClick={()=>{
 const csv = ['Reference,Phone,Amount,Service,Status,Date',
 ...records.map(r=>`${r.reference},${r.phone},${r.amount_kes},${r.drug_or_service},${r.status},${new Date(r.transacted_at).toLocaleDateString('en-KE')}`)
 ].join('\n')
 const a = document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download='mpesa.csv'; a.click()
 }} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Export CSV</button>
 <button style={{...css.btn,...css.btnGhost}} onClick={()=>setActiveTab('stk')}>STK Push</button>
 <button style={{...css.btn,...css.btnPri}} onClick={()=>{setShowAdd(true);setForm(emptyForm)}}>+ Log Transaction</button>
 </div>
 </div>
 <div style={css.subtext}>
 Today: KES {todayAmt.toLocaleString()} · {todayRecs.length} transactions · Month: KES {monthAmt.toLocaleString()}
 </div>

 {/* STATS */}
 <div style={css.statsRow}>
 {[
 { label:"Today's Collections", value:`KES ${todayAmt.toLocaleString()}`, sub:`${todayRecs.length} transactions`, color:C.primary },
 { label:'This Month', value:`KES ${monthAmt.toLocaleString()}`, sub:`${monthRecs.length} completed`, color:C.blue },
 { label:'All Time Total', value:`KES ${totalAmt.toLocaleString()}`, sub:'Completed only', color:C.text },
 { label:'Pending / Unconfirmed', value:`KES ${pendingAmt.toLocaleString()}`, sub:'Awaiting confirmation', color:C.warn },
 { label:'Failed Transactions', value:failedCnt, sub:'Review & retry', color:failedCnt>0?C.danger:C.muted },
 { label:'Unlinked to Invoice', value:unlinkedCompleted.length, sub:unlinkedCompleted.length>0?'Click "Link Invoice" to match':'All reconciled ✓', color:unlinkedCompleted.length>0?C.warn:C.primary },
 ].map(st => (
 <div key={st.label} style={css.stat}>
 <div style={css.statLbl}>{st.label}</div>
 <div style={{...css.statVal, color:st.color}}>{st.value}</div>
 <div style={css.statSub}>{st.sub}</div>
 </div>
 ))}
 </div>

 {/* TABS */}
 <div style={css.tabRow}>
 {[
 { key:'transactions', label:'All Transactions' },
 { key:'reconcile', label:`Reconciliation${unmatchedLedger.length>0?` (${unmatchedLedger.length} unmatched)`:''}` },
 { key:'summary', label:'Daily Summary' },
 { key:'stk', label:'STK Push' },
 ].map(t => (
 <button key={t.key}
 style={{...css.tab,...(activeTab===t.key?css.tabActive:{})}}
 onClick={()=>setActiveTab(t.key)}>
 {t.label}
 </button>
 ))}
 </div>

 {/* ══ TRANSACTIONS TAB ══════════════════════════════════════════ */}
 {activeTab==='transactions' && (
 <>
 <div style={css.toolbar}>
 <div style={css.searchWrap}>
 <span style={css.searchIcon}>⌕</span>
 <input style={css.searchInp} placeholder="Search reference, phone, service..."
 value={search} onChange={e=>setSearch(e.target.value)}/>
 </div>
 {['today','week','month','all'].map(f=>(
 <button key={f} style={{...css.btn,...(dateFilter===f?css.btnPri:css.btnGhost),padding:'7px 12px'}}
 onClick={()=>setDateFilter(f)}>
 {f==='today'?'Today':f==='week'?'7 Days':f==='month'?'30 Days':'All'}
 </button>
 ))}
 <select style={css.select} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
 <option value="all">All Status</option>
 <option>Completed</option>
 <option>Pending</option>
 <option>Failed</option>
 <option>Reversed</option>
 </select>
 <span style={{fontSize:'12px',color:C.sub,whiteSpace:'nowrap'}}>
 {filtered.length} records · KES {filtered.reduce((s,r)=>s+parseFloat(r.amount_kes||0),0).toLocaleString()}
 </span>
 </div>

 <div style={css.card}>
 <table style={css.table}>
 <thead>
 <tr>
 {['Reference','Phone','Amount (KES)','Service / Description','Status','Date & Time','Actions'].map(h=>(
 <th key={h} style={css.th}>{h}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {filtered.length===0 && (
 <tr><td colSpan={7} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No transactions found</td></tr>
 )}
 {filtered.map(r=>(
 <tr key={r.id}>
 <td style={{...css.td,fontFamily:'monospace',fontWeight:700,color:C.text,letterSpacing:'0.5px'}}>
 {r.reference}
 </td>
 <td style={css.td}>{r.phone || '—'}</td>
 <td style={{...css.td,fontWeight:700,color:r.status==='Completed'?C.primary:r.status==='Failed'?C.danger:C.warn}}>
 KES {parseFloat(r.amount_kes||0).toLocaleString()}
 </td>
 <td style={{...css.td,maxWidth:'200px'}}>
 <span style={{fontSize:'12px',color:C.sub,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'block'}}>
 {r.drug_or_service || '—'}
 </span>
 </td>
 <td style={css.td}><Badge status={r.status}/></td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>
 {r.transacted_at ? new Date(r.transacted_at).toLocaleString('en-KE',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}
 </td>
 <td style={css.td}>
 <div style={{display:'flex',gap:'4px'}}>
 <button style={{...css.btn,...css.btnGhost,padding:'4px 10px',fontSize:'11px'}}
 onClick={()=>setShowDetail(r)}>View</button>
 {isGatewayManaged(r) ? (
 <>
 <span style={{fontSize:'10px',color:C.muted,alignSelf:'center'}} title="Status comes from the gateway">auto</span>
 {r.status==='Pending' && (
 <button style={{...css.btn,...css.btnBlue,padding:'4px 10px',fontSize:'11px'}}
 onClick={()=>checkGatewayRow(r)}>Check</button>
 )}
 </>
 ) : (
 <>
 {r.status==='Pending' && (
 <>
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 10px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Completed')}>Confirm</button>
 <button style={{...css.btn,background:C.dangerL,color:C.danger,border:'none',padding:'4px 10px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Failed')}>Failed</button>
 </>
 )}
 {r.status==='Completed' && (
 <button style={{...css.btn,background:'#F3F4F6',color:C.sub,border:'none',padding:'4px 10px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Reversed')}>Reverse</button>
 )}
 </>
 )}
 {r.status==='Completed' && !r.invoice_id && (
 <button style={{...css.btn,background:'#EFF6FF',color:'#2563EB',border:'none',padding:'4px 10px',fontSize:'11px'}}
 title="Auto-match to a billing invoice by amount"
 onClick={()=>autoMatchInvoice(r)}>Link Invoice</button>
 )}
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </>
 )}

 {/* ══ RECONCILIATION TAB ════════════════════════════════════════ */}
 {activeTab==='reconcile' && (
 <>
 <div style={{...css.card,marginBottom:16}}>
 <div style={css.cardHead}>
 <span>Reconciliation — M-Pesa refs in Sales Ledger vs logged Transactions</span>
 <span style={{fontSize:'12px',color:C.sub}}>
 {ledger.length} M-Pesa sales · {records.length} logged transactions
 </span>
 </div>
 <div style={{padding:'14px 16px',display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px'}}>
 <div style={{background:C.primaryL,borderRadius:'8px',padding:'12px 14px',border:`1px solid ${C.primary}22`}}>
 <div style={{fontSize:'11px',color:C.primary,fontWeight:700,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>Matched</div>
 <div style={{fontSize:'20px',fontWeight:800,color:C.primary}}>{ledger.length - unmatchedLedger.length}</div>
 <div style={{fontSize:'11px',color:C.primary}}>Sales with confirmed M-Pesa ref</div>
 </div>
 <div style={{background:C.warnL,borderRadius:'8px',padding:'12px 14px',border:`1px solid ${C.warn}22`}}>
 <div style={{fontSize:'11px',color:C.warn,fontWeight:700,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>Unmatched</div>
 <div style={{fontSize:'20px',fontWeight:800,color:C.warn}}>{unmatchedLedger.length}</div>
 <div style={{fontSize:'11px',color:C.warn}}>Sales with refs not in transactions log</div>
 </div>
 <div style={{background:C.blueL,borderRadius:'8px',padding:'12px 14px',border:`1px solid ${C.blue}22`}}>
 <div style={{fontSize:'11px',color:C.blue,fontWeight:700,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>Open Billing Invoices</div>
 <div style={{fontSize:'20px',fontWeight:800,color:C.blue}}>{linkableInvoices.length}</div>
 <div style={{fontSize:'11px',color:C.blue}}>KES {linkableInvoices.reduce((s,i)=>s+Math.max(0, Number(i.balance_kes ?? (Number(i.amount_kes || 0) - Number(i.paid_kes || 0)))),0).toLocaleString()} outstanding</div>
 </div>
 </div>
 </div>

 {unmatchedLedger.length > 0 && (
 <div style={css.card}>
 <div style={{...css.cardHead,color:C.warn}}>
 Unmatched Sales — M-Pesa refs entered in sales but not logged as transactions
 </div>
 <table style={css.table}>
 <thead>
 <tr>
 {['Patient / Customer','Drug / Service','Amount','M-Pesa Ref','Sale Date','Action'].map(h=>(
 <th key={h} style={css.th}>{h}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {unmatchedLedger.map(l=>(
 <tr key={l.id}>
 <td style={css.td}><strong>{l.customer_name||'—'}</strong><br/><span style={{fontSize:'11px',color:C.sub}}>{l.patient_phone}</span></td>
 <td style={css.td}>{l.drug_name}</td>
 <td style={{...css.td,fontWeight:700}}>KES {parseFloat(l.total_kes||0).toLocaleString()}</td>
 <td style={{...css.td,fontFamily:'monospace',color:C.warn,fontWeight:700}}>{l.mpesa_ref}</td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{l.sold_at?new Date(l.sold_at).toLocaleDateString('en-KE'):'—'}</td>
 <td style={css.td}>
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'5px 10px',fontSize:'11px'}}
 onClick={async()=>{
 const payload = {
 hospital_id: hospitalId, reference: l.mpesa_ref?.toUpperCase(),
 phone: l.patient_phone||'', amount_kes: parseFloat(l.total_kes||0),
 drug_or_service: l.drug_name, patient_id: l.patient_id || null, status:'Completed',
 transacted_at: l.sold_at || new Date().toISOString(),
 }
 const {error} = await executeWithFallback(
 () => supabase.from('mpesa_transactions').insert(payload),
 async () => supabase.from('mpesa_transactions').insert(omitKeys(payload, ['patient_id'])),
 )
 if(error) notifyError('Error: '+error.message)
 else await fetchAll()
 }}>
 Import
 </button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}

 {/* Invoices reconciliation */}
 <div style={css.card}>
 <div style={css.cardHead}>Billing Invoices Available for M-Pesa</div>
 <table style={css.table}>
 <thead>
 <tr>
 {['Invoice No','Patient','Amount','Paid','Status','Date'].map(h=>(
 <th key={h} style={css.th}>{h}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {linkableInvoices.length===0 && (
 <tr><td colSpan={6} style={{...css.td,textAlign:'center',color:C.muted,padding:'32px'}}>No open self-pay invoices found</td></tr>
 )}
 {linkableInvoices.map(inv=>(
 <tr key={inv.id}>
 <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.sub}}>{inv.invoice_no}</td>
 <td style={css.td}><strong>{inv.patient_name}</strong></td>
 <td style={{...css.td,fontWeight:600}}>KES {parseFloat(inv.amount_kes||0).toLocaleString()}</td>
 <td style={{...css.td,color:C.primary,fontWeight:600}}>KES {parseFloat(inv.paid_kes||0).toLocaleString()}</td>
 <td style={css.td}><Badge status={inv.status}/></td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{inv.created_at?new Date(inv.created_at).toLocaleDateString('en-KE'):'—'}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </>
 )}

 {/* ══ DAILY SUMMARY TAB ═════════════════════════════════════════ */}
 {activeTab==='summary' && (
 <div style={css.card}>
 <div style={css.cardHead}>
 <span>Daily M-Pesa Collections — Last 30 Days</span>
 <span style={{fontSize:'12px',color:C.sub}}>Completed transactions only</span>
 </div>
 <table style={css.table}>
 <thead>
 <tr>
 {['Date','Transactions','Total Collected (KES)','Average per Transaction','Running Total'].map(h=>(
 <th key={h} style={css.th}>{h}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {dailySummary.length===0 && (
 <tr><td colSpan={5} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No data yet</td></tr>
 )}
 {dailySummary.reduce((acc,day,i)=>{
 const running = dailySummary.slice(i).reduce((s,d)=>s+d.total,0)
 acc.push(
 <tr key={day.day}>
 <td style={{...css.td,fontWeight:600}}>{day.day}</td>
 <td style={css.td}>{day.count}</td>
 <td style={{...css.td,fontWeight:700,color:C.primary}}>KES {day.total.toLocaleString()}</td>
 <td style={{...css.td,color:C.sub}}>KES {Math.round(day.total/day.count).toLocaleString()}</td>
 <td style={{...css.td,color:C.sub,fontSize:'12px'}}>KES {running.toLocaleString()}</td>
 </tr>
 )
 return acc
 },[])}
 </tbody>
 </table>
 </div>
 )}

 {/* ══ STK PUSH TAB ══════════════════════════════════════════════ */}
 {activeTab==='stk' && (
 <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
 <div style={css.card}>
 <div style={css.cardHead}>Send STK Push</div>
 <div style={{padding:'20px'}}>
 <div style={{background:C.blueL,border:`1px solid ${C.blue}22`,borderRadius:'8px',padding:'12px 14px',fontSize:'12px',color:C.blue,marginBottom:'16px',lineHeight:'1.6'}}>
 Sends a payment prompt directly to the patient's phone. The patient enters their M-Pesa PIN and the
 invoice is updated automatically with the M-Pesa receipt. Configure the gateway in Settings → Payments.
 </div>
 <label style={css.lbl}>Invoice *</label>
 <select
 style={{...css.input,cursor:'pointer'}}
 value={stkInvoiceId}
 onChange={e => {
 const invoice = linkableInvoices.find(inv => inv.id === e.target.value)
 setStkInvoiceId(e.target.value)
 if (invoice) {
  setStkAmount(String(Math.max(0, Number(invoice.amount_kes || 0) - Number(invoice.paid_kes || 0))))
  setStkService(`Invoice ${invoice.invoice_no} - ${invoice.patient_name}`)
 }
 }}>
 <option value="">-- Select invoice --</option>
 {linkableInvoices.slice(0, 120).map(inv => (
 <option key={inv.id} value={inv.id}>
 {inv.invoice_no} - {inv.patient_name} - KES {Math.max(0, Number(inv.amount_kes || 0) - Number(inv.paid_kes || 0)).toLocaleString()}
 </option>
 ))}
 </select>
 <label style={css.lbl}>Patient Phone Number *</label>
 <input style={css.input} placeholder="e.g. 0712345678" value={stkPhone}
 onChange={e=>setStkPhone(e.target.value.replace(/[^\d+\s]/g,''))}/>
 <label style={css.lbl}>Amount (KES) *</label>
 <input style={css.input} type="number" min="1" step="1" placeholder="0" value={stkAmount}
 onChange={e=>setStkAmount(e.target.value)}/>
 <label style={css.lbl}>Service Description</label>
 <input style={css.input} placeholder="e.g. Consultation, Lab tests, Pharmacy"
 value={stkService} onChange={e=>setStkService(e.target.value)}/>
 <button style={{...css.btn,...css.btnPri,width:'100%',padding:'11px',fontSize:'13px',marginTop:'4px'}}
 onClick={handleSTKPush} disabled={stkLoading}>
 {stkLoading ? 'Sending...' : 'Send STK Push'}
 </button>
 </div>
 </div>

 <div style={css.card}>
 <div style={css.cardHead}>
 <span>Pending STK Pushes</span>
 <span style={{fontSize:'12px',color:C.sub}}>{records.filter(r=>r.status==='Pending').length} awaiting</span>
 </div>
 <div style={{padding:'4px 0'}}>
 {records.filter(r=>r.status==='Pending').length===0 ? (
 <div style={{textAlign:'center',padding:'40px',color:C.muted,fontSize:'13px'}}>No pending STK pushes</div>
 ) : records.filter(r=>r.status==='Pending').map(r=>(
 <div key={r.id} style={{padding:'12px 16px',borderBottom:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
 <div>
 <div style={{fontFamily:'monospace',fontSize:'12px',fontWeight:700,color:C.text}}>{r.reference}</div>
 <div style={{fontSize:'12px',color:C.sub,marginTop:'2px'}}>{r.phone} · KES {parseFloat(r.amount_kes).toLocaleString()}</div>
 <div style={{fontSize:'11px',color:C.muted,marginTop:'1px'}}>{r.drug_or_service}</div>
 </div>
 <div style={{display:'flex',gap:'6px'}}>
 {isGatewayManaged(r) ? (
 <button style={{...css.btn,...css.btnBlue,padding:'5px 10px',fontSize:'11px'}}
 onClick={()=>checkGatewayRow(r)}>Check status</button>
 ) : (
 <>
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'5px 10px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Completed')}>Confirm</button>
 <button style={{...css.btn,background:C.dangerL,color:C.danger,border:'none',padding:'5px 10px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Failed')}>Failed</button>
 </>
 )}
 </div>
 </div>
 ))}
 </div>
 </div>
 </div>
 )}

 </div>

 {/* ══ ADD TRANSACTION MODAL ════════════════════════════════════════ */}
 {showAdd && (
 <div style={css.overlay} onClick={()=>setShowAdd(false)}>
 <div style={css.modal} onClick={e=>e.stopPropagation()}>
 <div style={css.modalH}>Log M-Pesa Transaction</div>
 <div style={{background:C.warnL,border:`1px solid ${C.warn}22`,borderRadius:'7px',padding:'10px 12px',fontSize:'12px',color:C.warn,marginBottom:'16px'}}>
 Use this to manually log a transaction that was paid via M-Pesa but not captured automatically via STK Push.
 </div>
 <label style={css.lbl}>M-Pesa Reference *</label>
 <input style={css.input} placeholder="e.g. QBX4KLMNOP" value={form.reference}
 onChange={e=>setForm({...form,reference:e.target.value.toUpperCase()})}/>
 <label style={css.lbl}>Linked Invoice (optional)</label>
 <select
 style={{...css.input,cursor:'pointer'}}
 value={form.invoice_id}
 onChange={e => {
 const invoice = linkableInvoices.find(inv => inv.id === e.target.value)
 setForm(prev => ({
  ...prev,
  invoice_id: e.target.value,
  patient_id: invoice?.patient_id || '',
  visit_id: invoice?.visit_id || '',
  amount_kes: invoice ? String(Math.max(0, Number(invoice.amount_kes || 0) - Number(invoice.paid_kes || 0))) : prev.amount_kes,
  drug_or_service: invoice ? `Invoice ${invoice.invoice_no} - ${invoice.patient_name}` : prev.drug_or_service,
 }))
 }}>
 <option value="">-- No linked invoice --</option>
 {linkableInvoices.slice(0, 120).map(inv => (
 <option key={inv.id} value={inv.id}>
 {inv.invoice_no} - {inv.patient_name} - KES {Math.max(0, Number(inv.amount_kes || 0) - Number(inv.paid_kes || 0)).toLocaleString()}
 </option>
 ))}
 </select>
 <div style={css.grid2}>
 <div>
 <label style={css.lbl}>Phone Number</label>
 <input style={css.input} placeholder="0712345678" value={form.phone}
 onChange={e=>setForm({...form,phone:e.target.value})}/>
 </div>
 <div>
 <label style={css.lbl}>Amount (KES) *</label>
 <input style={css.input} type="number" placeholder="0" value={form.amount_kes}
 onChange={e=>setForm({...form,amount_kes:e.target.value})}/>
 </div>
 </div>
 <label style={css.lbl}>Service / Description</label>
 <input style={css.input} placeholder="e.g. Consultation fee, Lab, Pharmacy"
 value={form.drug_or_service} onChange={e=>setForm({...form,drug_or_service:e.target.value})}/>
 <div style={css.grid2}>
 <div>
 <label style={css.lbl}>Status</label>
 <select style={{...css.input,cursor:'pointer'}} value={form.status}
 onChange={e=>setForm({...form,status:e.target.value})}>
 <option>Completed</option>
 <option>Pending</option>
 <option>Failed</option>
 <option>Reversed</option>
 </select>
 </div>
 <div>
 <label style={css.lbl}>Date & Time</label>
 <input style={css.input} type="datetime-local" value={form.transacted_at}
 onChange={e=>setForm({...form,transacted_at:e.target.value})}/>
 </div>
 </div>
 <hr style={css.divider}/>
 <div style={{display:'flex',gap:'8px'}}>
 <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={()=>setShowAdd(false)}>Cancel</button>
 <button style={{...css.btn,...css.btnPri,flex:2,padding:'10px'}} onClick={handleSave} disabled={saving}>
 {saving?'Saving...':'Log Transaction'}
 </button>
 </div>
 </div>
 </div>
 )}

 {/* ══ DETAIL MODAL ════════════════════════════════════════════════ */}
 {showDetail && (
 <div style={css.overlay} onClick={()=>setShowDetail(null)}>
 <div style={css.modal} onClick={e=>e.stopPropagation()}>
 <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
 <div style={css.modalH}>Transaction Detail</div>
 <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={()=>setShowDetail(null)} aria-label="Close" title="Close">✕</button>
 </div>
 {[
 ['Reference', showDetail.reference],
 ['Phone', showDetail.phone || '—'],
 ['Amount', `KES ${parseFloat(showDetail.amount_kes||0).toLocaleString()}`],
 ['Service', showDetail.drug_or_service || '—'],
 ['Status', showDetail.status],
 ['Date & Time', showDetail.transacted_at ? new Date(showDetail.transacted_at).toLocaleString('en-KE') : '—'],
 ].map(([k,v])=>(
 <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:`1px solid ${C.border}`,fontSize:'13px'}}>
 <span style={{color:C.sub,fontWeight:500}}>{k}</span>
 <span style={{fontWeight:600,fontFamily:k==='Reference'?'monospace':'inherit'}}>{v}</span>
 </div>
 ))}
 <div style={{marginTop:'16px',display:'flex',gap:'8px'}}>
 {isGatewayManaged(showDetail) && showDetail.status==='Pending' && (
 <button style={{...css.btn,...css.btnBlue,flex:1,padding:'10px'}}
 onClick={()=>{checkGatewayRow(showDetail);setShowDetail(null)}}>Check with gateway</button>
 )}
 {!isGatewayManaged(showDetail) && showDetail.status==='Pending' && (
 <>
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',flex:1,padding:'10px'}}
 onClick={()=>{updateStatus(showDetail.id,'Completed');setShowDetail(null)}}>Confirm Completed</button>
 <button style={{...css.btn,background:C.dangerL,color:C.danger,border:'none',flex:1,padding:'10px'}}
 onClick={()=>{updateStatus(showDetail.id,'Failed');setShowDetail(null)}}>Mark Failed</button>
 </>
 )}
 {!isGatewayManaged(showDetail) && showDetail.status==='Completed' && (
 <button style={{...css.btn,background:'#F3F4F6',color:C.sub,border:'none',flex:1,padding:'10px'}}
 onClick={()=>{updateStatus(showDetail.id,'Reversed');setShowDetail(null)}}>Reverse Transaction</button>
 )}
 <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={()=>setShowDetail(null)}>Close</button>
 </div>
 </div>
 </div>
 )}
 </div>
 )
}
