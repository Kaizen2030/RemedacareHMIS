import { useEffect, useState } from 'react'
import SkeletonLoader from '../components/SkeletonLoader'
import supabase from '../supabase'
import { useHospital } from '../context'
import { executeWithFallback, omitKeys } from '../utils/dbCompat'
import { broadcastWorkflowChanged } from '../utils/workflowEvents'
import { colors as C, typography } from '../theme'

const STATUS_COLORS = {
 Submitted: { bg: C.blueL, color: C.blue },
 Approved: { bg: C.primaryL, color: C.primary },
 Rejected: { bg: C.dangerL, color: C.danger },
 Pending: { bg: C.warnL, color: C.warn },
 Paid: { bg: C.primaryL, color: C.primary },
 'Under Review': { bg: C.blueL, color: C.blue },
 Appealed: { bg: '#F3F4F6', color: C.sub },
}

const css = {
 page: { minHeight:'100vh', background:C.bg, fontFamily:typography.fontFamily, fontSize:'13px', color:C.text },
 wrap: { padding:'20px 24px', maxWidth:'1400px', margin:'0 auto' },
 header: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'4px' },
 h1: { fontSize:'18px', fontWeight:700, margin:0 },
 subtext: { fontSize:'12px', color:C.sub, marginBottom:'20px' },
 statsRow: { display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'12px', marginBottom:'20px' },
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
 card: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:'10px', overflow:'hidden', marginBottom:'16px' },
 cardHead: { padding:'12px 16px', borderBottom:`1px solid ${C.border}`, fontSize:'13px', fontWeight:600, color:C.text, background:'#FAFBFD', display:'flex', justifyContent:'space-between', alignItems:'center' },
 table: { width:'100%', borderCollapse:'collapse' },
 th: { padding:'9px 14px', textAlign:'left', fontSize:'11px', fontWeight:700, color:C.sub, textTransform:'uppercase', letterSpacing:'.5px', borderBottom:`2px solid ${C.border}`, background:'#FAFBFD', whiteSpace:'nowrap' },
 td: { padding:'11px 14px', borderBottom:`1px solid ${C.border}`, fontSize:'13px', verticalAlign:'middle' },
 badge: { display:'inline-block', padding:'2px 9px', borderRadius:'20px', fontSize:'11px', fontWeight:600 },
 overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,.4)', zIndex:999, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' },
 modal: { background:C.surface, borderRadius:'12px', padding:'24px', width:'540px', maxWidth:'95vw', boxShadow:'0 20px 60px rgba(0,0,0,.2)', maxHeight:'90vh', overflowY:'auto' },
 modalH: { fontSize:'15px', fontWeight:700, marginBottom:'16px', color:C.text },
 lbl: { fontSize:'11px', fontWeight:600, color:C.sub, textTransform:'uppercase', letterSpacing:'.4px', marginBottom:'4px', display:'block' },
 input: { width:'100%', boxSizing:'border-box', padding:'9px 11px', border:`1px solid ${C.border}`, borderRadius:'7px', fontSize:'13px', color:C.text, outline:'none', background:C.surface, marginBottom:'12px' },
 grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' },
 divider: { border:'none', borderTop:`1px solid ${C.border}`, margin:'16px 0' },
}

const PAGE_SIZE = 100
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

const SHA_SERVICES = [
 'Outpatient Consultation','Inpatient Admission','Laboratory Tests','Pharmacy / Drugs',
 'Surgical Procedure','Maternity / Delivery','Radiology / Imaging','Physiotherapy',
 'Dental','Eye / Optical','Emergency Services','Mental Health','Chronic Disease Management',
]

function parseClaimNotes(notes) {
 try {
  return JSON.parse(notes || '{}')
 } catch {
  return {}
 }
}

function buildClaimNotes(meta = {}) {
 return JSON.stringify({
  source: meta.source || 'Manual',
  invoice_no: meta.invoice_no || '',
  invoice_id: meta.invoice_id || null,
  patient_id: meta.patient_id || null,
  visit_id: meta.visit_id || null,
  notes: meta.notes || '',
 })
}

function getClaimSource(record) {
 const meta = parseClaimNotes(record?.notes)
 if (meta.source) return meta.source
 return record?.notes?.includes('Imported from Billing') ? 'Billing' : 'Manual'
}

function getClaimNotesText(record) {
 const meta = parseClaimNotes(record?.notes)
 return meta.notes || record?.notes || ''
}

function Badge({ status }) {
 const sc = STATUS_COLORS[status] || { bg:'#F3F4F6', color:C.sub }
 return <span style={{...css.badge, background:sc.bg, color:sc.color}}>{status || '—'}</span>
}

const emptyForm = {
 patient_name: '', sha_number: '', id_number: '',
 service_type: SHA_SERVICES[0], amount_claimed: '',
 visit_date: new Date().toISOString().slice(0,10),
 notes: '', status: 'Pending', patient_id: '', visit_id: '', invoice_id: '',
}

export default function SHAClaims() {
 const { hospitalId, userRole } = useHospital()
 const isAdmin = ['Admin','admin'].includes(userRole || '')
 const [loading, setLoading] = useState(true)
 const [saving, setSaving] = useState(false)
 const [activeTab, setActiveTab] = useState('claims')
 const [claims, setClaims] = useState([])
 const [claimPage, setClaimPage] = useState(1)
 const [claimPageSize, setClaimPageSize] = useState(PAGE_SIZE)
 const [claimTotalCount, setClaimTotalCount] = useState(0)

 useEffect(() => { if (!hospitalId) { setLoading(false); return }; fetchAll() }, [hospitalId, claimPage, claimPageSize])

 async function fetchAll() {
 setLoading(true)
 const start = (claimPage - 1) * claimPageSize
 const end = claimPage * claimPageSize - 1
 const [{ data: cl, count }, { data: inv }] = await Promise.all([
 // sha_claims table — tracked/submitted claims
 supabase.from('sha_claims').select('*', { count: 'exact' })
 .eq('hospital_id', hospitalId)
 .order('created_at', { ascending: false })
 .range(start, end),
 // invoices table — SHA-billed invoices from Billing.jsx
 supabase.from('invoices')
 .select('id,patient_id,visit_id,invoice_no,patient_name,sha_member_no,services,amount_kes,paid_kes,balance_kes,status,created_at,notes')
 .eq('hospital_id', hospitalId)
 .ilike('payment_method', '%SHA%')
 .order('created_at', { ascending: false }),
 ])
 setClaims(cl || [])
 setClaimTotalCount(count || 0)
 setShaInvoices(inv || [])
 setLoading(false)
 }

 async function handleSave() {
 if (!form.patient_name || !form.amount_claimed) { window.notifyFromLegacyAlert('Patient name and amount are required'); return }
 setSaving(true)
 const payload = {
 hospital_id: hospitalId,
 patient_name: form.patient_name.trim(),
 patient_id: form.patient_id || null,
 visit_id: form.visit_id || null,
 invoice_id: form.invoice_id || null,
 id_number: form.id_number.trim(),
 sha_number: form.sha_number.trim(),
 service_type: form.service_type,
 amount_claimed: parseFloat(form.amount_claimed),
 visit_date: form.visit_date,
 notes: buildClaimNotes({
  source: 'Manual',
  invoice_id: form.invoice_id || null,
  patient_id: form.patient_id || null,
  visit_id: form.visit_id || null,
  notes: form.notes.trim(),
 }),
 status: form.status,
 created_at: new Date().toISOString(),
 }
 const { error } = await executeWithFallback(
  () => supabase.from('sha_claims').insert(payload),
  async () => supabase.from('sha_claims').insert(omitKeys(payload, ['patient_id', 'visit_id', 'invoice_id'])),
 )
 if (error) window.notifyFromLegacyAlert('Error: ' + error.message)
 setShowAdd(false); setForm(emptyForm)
 await fetchAll(); setSaving(false)
 if (!error) broadcastWorkflowChanged({ source: 'sha-claim-create', patient_name: form.patient_name.trim() })
 }

 // One-click import: pull a Billing SHA invoice into sha_claims
 async function importFromBilling(inv) {
 const alreadyExists = claims.some(c => {
 const meta = parseClaimNotes(c.notes)
 return c.invoice_id === inv.id || meta.invoice_id === inv.id || meta.invoice_no === inv.invoice_no || c.notes?.includes(inv.invoice_no)
 })
 if (alreadyExists) { window.notifyFromLegacyAlert('This invoice is already tracked in SHA Claims.'); return }
 setSaving(true)
 const payload = {
 hospital_id: hospitalId,
 patient_name: inv.patient_name,
 patient_id: inv.patient_id || null,
 visit_id: inv.visit_id || null,
 invoice_id: inv.id || null,
 sha_number: inv.sha_member_no || '',
 id_number: '',
 service_type: inv.services || 'Outpatient Consultation',
 amount_claimed: parseFloat(inv.amount_kes || 0),
 visit_date: inv.created_at?.slice(0,10) || new Date().toISOString().slice(0,10),
 notes: buildClaimNotes({
  source: 'Billing',
  invoice_no: inv.invoice_no,
  invoice_id: inv.id || null,
  patient_id: inv.patient_id || null,
  visit_id: inv.visit_id || null,
  notes: inv.notes || '',
 }),
 status: inv.status === 'Paid' ? 'Paid' : 'Pending',
 created_at: new Date().toISOString(),
 }
 const { error } = await executeWithFallback(
  () => supabase.from('sha_claims').insert(payload),
  async () => supabase.from('sha_claims').insert(omitKeys(payload, ['patient_id', 'visit_id', 'invoice_id'])),
 )
 if (error) window.notifyFromLegacyAlert('Error: ' + error.message)
 else await fetchAll()
 setSaving(false)
 if (!error) broadcastWorkflowChanged({ source: 'sha-claim-import', invoice_no: inv.invoice_no })
 }

 async function syncInvoiceForClaim(claim, nextStatus) {
 if (!claim || !['Approved', 'Paid'].includes(nextStatus)) return

 const meta = parseClaimNotes(claim.notes)
 const invoiceId = claim.invoice_id || meta.invoice_id || null
 const invoiceNo = meta.invoice_no || null
 if (!invoiceId && !invoiceNo) return

 const amount = Number(claim.amount_claimed || 0)
 const updatePayload = nextStatus === 'Paid'
  ? {
    status: 'Paid',
    paid_kes: amount,
    balance_kes: 0,
    paid_at: new Date().toISOString(),
   }
  : {
    status: 'Approved',
   }

 let invoiceQuery = supabase.from('invoices').update(updatePayload).eq('hospital_id', hospitalId)
 invoiceQuery = invoiceId ? invoiceQuery.eq('id', invoiceId) : invoiceQuery.eq('invoice_no', invoiceNo)
 const { error } = await invoiceQuery
 if (error) {
  window.notifyFromLegacyAlert('SHA claim status saved, but billing invoice sync failed: ' + error.message)
 }
 }

 async function updateStatus(id, status) {
 if (!isAdmin && ['Approved','Paid','Rejected'].includes(status)) {
 window.notifyFromLegacyAlert('Only Admin users can approve or reject SHA claims.')
 return
 }
 const claim = claims.find(r => r.id === id) || (showDetail?.id === id ? showDetail : null)
 setSaving(true)
 const { error } = await supabase.from('sha_claims').update({ status }).eq('id', id)
 if (error) {
 window.notifyFromLegacyAlert('Error: ' + error.message)
 setSaving(false)
 return
 }
 if (claim) await syncInvoiceForClaim(claim, status)
 await fetchAll()
 setSaving(false)
 broadcastWorkflowChanged({ source: 'sha-claim-status', id, status })
}

 function getDateRange(range) {
 const now = new Date(); const start = new Date()
 if (range === 'today') start.setHours(0,0,0,0)
 else if (range === 'week') start.setDate(now.getDate()-7)
 else if (range === 'month') start.setDate(now.getDate()-30)
 else start.setFullYear(2000)
 return start.toISOString()
 }

 const since = getDateRange(dateFilter)
 const filtered = claims.filter(r => {
 const matchDate = dateFilter === 'all' || new Date(r.created_at) >= new Date(since)
 const matchStatus = statusFilter === 'all' || r.status === statusFilter
 const matchSearch = !search ||
 r.patient_name?.toLowerCase().includes(search.toLowerCase()) ||
 r.sha_number?.toLowerCase().includes(search.toLowerCase()) ||
 r.service_type?.toLowerCase().includes(search.toLowerCase())
 return matchDate && matchStatus && matchSearch
 })

 const totalClaimed = claims.reduce((s,r) => s + parseFloat(r.amount_claimed||0), 0)
 const approved = claims.filter(r => r.status === 'Approved' || r.status === 'Paid')
 const approvedAmt = approved.reduce((s,r) => s + parseFloat(r.amount_claimed||0), 0)
 const pending = claims.filter(r => ['Pending','Submitted','Under Review'].includes(r.status))
 const pendingAmt = pending.reduce((s,r) => s + parseFloat(r.amount_claimed||0), 0)
 const rejected = claims.filter(r => r.status === 'Rejected')
 const rejectedAmt = rejected.reduce((s,r) => s + parseFloat(r.amount_claimed||0), 0)
 const monthRecs = claims.filter(r => { const d=new Date(r.created_at),now=new Date(); return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear() })
 const monthAmt = monthRecs.reduce((s,r) => s+parseFloat(r.amount_claimed||0),0)

 // SHA invoices from Billing not yet imported into sha_claims
 const importedInvoiceKeys = new Set(
 claims.flatMap(c => {
  const meta = parseClaimNotes(c.notes)
  const legacyInvoiceNo = c.notes?.match(/Invoice (INV-\d+)/)?.[1]
  return [c.invoice_id, meta.invoice_id, meta.invoice_no, legacyInvoiceNo]
 }).filter(Boolean)
 )
 const unimported = shaInvoices.filter(inv => !importedInvoiceKeys.has(inv.id) && !importedInvoiceKeys.has(inv.invoice_no))

 const serviceMap = {}
 claims.forEach(r => {
 const k = r.service_type || 'Other'
 if (!serviceMap[k]) serviceMap[k] = { name:k, count:0, total:0, approved:0 }
 serviceMap[k].count++
 serviceMap[k].total += parseFloat(r.amount_claimed||0)
 if (r.status === 'Approved' || r.status === 'Paid') serviceMap[k].approved++
 })
 const serviceBreakdown = Object.values(serviceMap).sort((a,b) => b.total-a.total)

 if (loading) return (
 <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'80vh',background:C.bg}}>
 <div style={{width:'220px'}}>
 <SkeletonLoader rows={3} height={14} width={['44%','100%','62%']} />
 </div>
 <p style={{color:C.sub,marginTop:12,fontSize:'13px'}}>Loading SHA claims...</p>
 </div>
 )

 return (
 <div style={css.page}>
 <style>{`@keyframes spin{to{transform:rotate(360deg)}} tr:hover td{background:#FAFBFD}`}</style>
 <div style={css.wrap}>

 <div style={css.header}>
 <div><h1 style={css.h1}>SHA Claims</h1></div>
 <div style={{display:'flex',gap:'8px'}}>
 <button style={{...css.btn,...css.btnGhost}} onClick={() => {
 const csv = ['Patient,SHA No,Service,Amount,Status,Visit Date,Submitted',
 ...claims.map(r=>`${r.patient_name},${r.sha_number||''},${r.service_type},${r.amount_claimed},${r.status},${r.visit_date||''},${r.created_at?new Date(r.created_at).toLocaleDateString('en-KE'):''}`)
 ].join('\n')
 const a = document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download='sha_claims.csv'; a.click()
 }} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Export CSV</button>
 <button style={{...css.btn,...css.btnPri}} onClick={() => { setForm(emptyForm); setShowAdd(true) }}>+ New Claim</button>
 </div>
 </div>
 <div style={css.subtext}>
 This month: KES {monthAmt.toLocaleString()} across {monthRecs.length} claims
 {unimported.length > 0 ? <span style={{color:C.warn,fontWeight:600}}> · {unimported.length} pending auto-post</span> : <span style={{color:C.primary,fontWeight:600}}> · All billing SHA invoices auto-posted ✓</span>}
 </div>

 <div style={css.statsRow}>
 {[
 { label:'Total Claimed', value:`KES ${totalClaimed.toLocaleString()}`, sub:`${claims.length} claims`, color:C.text },
 { label:'Approved / Paid', value:`KES ${approvedAmt.toLocaleString()}`, sub:`${approved.length} claims`, color:C.primary },
 { label:'Pending / Under Review', value:`KES ${pendingAmt.toLocaleString()}`, sub:`${pending.length} awaiting`, color:C.warn },
 { label:'Rejected', value:`KES ${rejectedAmt.toLocaleString()}`, sub:`${rejected.length} claims`, color:rejected.length>0?C.danger:C.muted },
 { label:'SHA Invoices in Billing', value:shaInvoices.length, sub:`KES ${shaInvoices.reduce((s,i)=>s+parseFloat(i.amount_kes||0),0).toLocaleString()}`, color:C.blue },
 ].map(st => (
 <div key={st.label} style={css.stat}>
 <div style={css.statLbl}>{st.label}</div>
 <div style={{...css.statVal,color:st.color}}>{st.value}</div>
 <div style={css.statSub}>{st.sub}</div>
 </div>
 ))}
 </div>

 <div style={css.tabRow}>
 {[
 { key:'claims', label:'All Claims' },
 { key:'billing', label:`From Billing${unimported.length>0?` (${unimported.length} pending)`:''}` },
 { key:'pending', label:`Pending${pending.length>0?` (${pending.length})`:''}` },
 { key:'rejected', label:`Rejected${rejected.length>0?` (${rejected.length})`:''}` },
 { key:'breakdown', label:'By Service' },
 ].map(t => (
 <button key={t.key} style={{...css.tab,...(activeTab===t.key?css.tabActive:{})}} onClick={()=>setActiveTab(t.key)}>
 {t.label}
 </button>
 ))}
 </div>

 {/* ALL CLAIMS */}
 {activeTab === 'claims' && (
 <>
 <div style={css.toolbar}>
 <div style={css.searchWrap}>
 <span style={css.searchIcon}>⌕</span>
 <input style={css.searchInp} placeholder="Search patient, SHA number, service..."
 value={search} onChange={e=>setSearch(e.target.value)}/>
 </div>
 <select style={css.select} value={dateFilter} onChange={e=>setDateFilter(e.target.value)}>
 <option value="today">Today</option><option value="week">Last 7 Days</option>
 <option value="month">Last 30 Days</option><option value="all">All Time</option>
 </select>
 <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
   <label style={{ fontSize:'12px', color:C.sub }}>Page size</label>
   <select style={css.select} value={claimPageSize} onChange={e => { setClaimPageSize(Number(e.target.value)); setClaimPage(1) }}>
     {PAGE_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}</option>)}
   </select>
 </div>
 <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
   <button style={{...css.btn,...css.btnGhost,padding:'7px 12px'}} disabled={claimPage <= 1} onClick={() => setClaimPage(prev => Math.max(prev - 1, 1))}>← Prev</button>
   <button style={{...css.btn,...css.btnGhost,padding:'7px 12px'}} disabled={claimPage >= Math.max(1, Math.ceil(claimTotalCount / claimPageSize))} onClick={() => setClaimPage(prev => prev + 1)}>Next →</button>
 </div>
 <select style={css.select} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
 <option value="all">All Statuses</option>
 <option>Pending</option><option>Submitted</option><option>Under Review</option>
 <option>Approved</option><option>Paid</option><option>Rejected</option><option>Appealed</option>
 </select>
 </div>
 <div style={css.card}>
 <div style={css.cardHead}>
 <span>SHA Claims — {filtered.length} records</span>
 <span style={{fontSize:'12px',color:C.sub}}>Page {claimPage} of {Math.max(1, Math.ceil(claimTotalCount / claimPageSize))} ({claimTotalCount} total)</span>
 </div>
 <table style={css.table}>
 <thead>
 <tr>{['Patient','SHA No / ID','Source','Service','Amount','Status','Visit Date','Actions'].map(h=><th key={h} style={css.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {filtered.length===0 && <tr><td colSpan={8} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No claims found</td></tr>}
 {filtered.map(r => (
 <tr key={r.id} style={{cursor:'pointer'}} onClick={()=>setShowDetail(r)}>
 <td style={css.td}><strong>{r.patient_name}</strong></td>
 <td style={css.td}>
 {r.sha_number && <div style={{fontFamily:'monospace',fontSize:'12px',color:C.blue,fontWeight:700}}>{r.sha_number}</div>}
 {r.id_number && <div style={{fontSize:'11px',color:C.sub}}>{r.id_number}</div>}
 {!r.sha_number&&!r.id_number && <span style={{color:C.muted}}>—</span>}
 </td>
 <td style={css.td}>
 {getClaimSource(r) === 'Billing'
 ? <span style={{fontSize:'11px',fontWeight:600,color:C.blue,background:C.blueL,padding:'2px 7px',borderRadius:'4px'}}>Billing</span>
 : <span style={{fontSize:'11px',fontWeight:600,color:C.sub,background:'#F3F4F6',padding:'2px 7px',borderRadius:'4px'}}>Manual</span>
 }
 </td>
 <td style={css.td}>{r.service_type}</td>
 <td style={{...css.td,fontWeight:700}}>KES {parseFloat(r.amount_claimed||0).toLocaleString()}</td>
 <td style={css.td}><Badge status={r.status}/></td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{r.visit_date?new Date(r.visit_date).toLocaleDateString('en-KE'):'—'}</td>
 <td style={css.td} onClick={e=>e.stopPropagation()}>
 <div style={{display:'flex',gap:'4px'}}>
 {['Pending','Submitted','Under Review'].includes(r.status) && (
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Approved')} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Approve</button>
 )}
 {r.status==='Approved' && (
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Paid')} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Mark Paid</button>
 )}
 {!['Rejected','Paid'].includes(r.status) && (
 <button style={{...css.btn,background:C.dangerL,color:C.danger,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Rejected')} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Reject</button>
 )}
 {r.status==='Rejected' && (
 <button style={{...css.btn,background:'#F3F4F6',color:C.sub,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Appealed')}>Appeal</button>
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

 {/* FROM BILLING TAB */}
 {activeTab === 'billing' && (
 <>
 <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px',marginBottom:'16px'}}>
 {[
 { label:'SHA Invoices in Billing', val:shaInvoices.length, sub:`KES ${shaInvoices.reduce((s,i)=>s+parseFloat(i.amount_kes||0),0).toLocaleString()}`, bg:C.blueL, color:C.blue },
 { label:'Already Imported', val:shaInvoices.length-unimported.length, sub:'Tracked in SHA Claims', bg:C.primaryL, color:C.primary },
 { label:'Pending Auto-Post', val:unimported.length, sub:unimported.length===0?'All synced from billing':'Will auto-post on next billing save', bg:unimported.length===0?C.primaryL:C.warnL, color:unimported.length===0?C.primary:C.warn },
 ].map(s => (
 <div key={s.label} style={{background:s.bg,borderRadius:'8px',padding:'14px 16px',border:`1px solid ${s.color}22`}}>
 <div style={{fontSize:'11px',color:s.color,fontWeight:700,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>{s.label}</div>
 <div style={{fontSize:'20px',fontWeight:800,color:s.color}}>{s.val}</div>
 <div style={{fontSize:'11px',color:s.color}}>{s.sub}</div>
 </div>
 ))}
 </div>

 {unimported.length > 0 && (
 <div style={css.card}>
 <div style={{...css.cardHead,color:C.warn}}>
 SHA Invoices pending auto-post (created before auto-post feature — click Import to sync)
 </div>
 <table style={css.table}>
 <thead>
 <tr>{['Invoice No','Patient','SHA Member No','Services','Amount','Invoice Status','Date','Action'].map(h=><th key={h} style={css.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {unimported.map(inv => (
 <tr key={inv.id}>
 <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.sub,fontWeight:700}}>{inv.invoice_no}</td>
 <td style={css.td}><strong>{inv.patient_name}</strong></td>
 <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.blue}}>{inv.sha_member_no||'—'}</td>
 <td style={{...css.td,fontSize:'12px',color:C.sub,maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{inv.services||'—'}</td>
 <td style={{...css.td,fontWeight:700}}>KES {parseFloat(inv.amount_kes||0).toLocaleString()}</td>
 <td style={css.td}><Badge status={inv.status}/></td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{inv.created_at?new Date(inv.created_at).toLocaleDateString('en-KE'):'—'}</td>
 <td style={css.td}>
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'5px 10px',fontSize:'11px'}}
 onClick={()=>importFromBilling(inv)} disabled={saving}>Import</button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}

 <div style={css.card}>
 <div style={css.cardHead}>
 <span>All SHA Invoices from Billing</span>
 <span style={{fontSize:'12px',color:C.sub}}>{shaInvoices.length} invoices</span>
 </div>
 <table style={css.table}>
 <thead>
 <tr>{['Invoice No','Patient','SHA Member No','Amount','Paid','Balance','Status','Date'].map(h=><th key={h} style={css.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {shaInvoices.length===0 && (
 <tr><td colSpan={8} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>
 No SHA invoices in Billing yet. SHA claims are now auto-created when billing saves a SHA invoice.
 </td></tr>
 )}
 {shaInvoices.map(inv => (
 <tr key={inv.id}>
 <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.sub}}>{inv.invoice_no}</td>
 <td style={css.td}><strong>{inv.patient_name}</strong></td>
 <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.blue}}>{inv.sha_member_no||'—'}</td>
 <td style={{...css.td,fontWeight:700}}>KES {parseFloat(inv.amount_kes||0).toLocaleString()}</td>
 <td style={{...css.td,color:C.primary,fontWeight:600}}>KES {parseFloat(inv.paid_kes||0).toLocaleString()}</td>
 <td style={{...css.td,fontWeight:700,color:(inv.balance_kes||0)>0?C.danger:C.primary}}>KES {parseFloat(inv.balance_kes||0).toLocaleString()}</td>
 <td style={css.td}><Badge status={inv.status}/></td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{inv.created_at?new Date(inv.created_at).toLocaleDateString('en-KE'):'—'}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </>
 )}

 {/* PENDING TAB */}
 {activeTab === 'pending' && (
 <div style={css.card}>
 <div style={{...css.cardHead,color:C.warn}}>
 <span>Claims Awaiting Action — {pending.length}</span>
 <span style={{fontSize:'12px'}}>KES {pendingAmt.toLocaleString()} outstanding</span>
 </div>
 <table style={css.table}>
 <thead>
 <tr>{['Patient','SHA No','Service','Amount','Status','Days Pending','Actions'].map(h=><th key={h} style={css.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {pending.length===0 && <tr><td colSpan={7} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No pending claims</td></tr>}
 {pending.map(r => {
 const days = r.created_at ? Math.floor((Date.now()-new Date(r.created_at))/86400000) : null
 return (
 <tr key={r.id}>
 <td style={css.td}><strong>{r.patient_name}</strong></td>
 <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.blue}}>{r.sha_number||'—'}</td>
 <td style={css.td}>{r.service_type}</td>
 <td style={{...css.td,fontWeight:700}}>KES {parseFloat(r.amount_claimed||0).toLocaleString()}</td>
 <td style={css.td}><Badge status={r.status}/></td>
 <td style={{...css.td,color:days>14?C.danger:days>7?C.warn:C.text,fontWeight:days>7?700:400}}>
 {days!==null?`${days} day${days!==1?'s':''}`:'—'}
 </td>
 <td style={css.td}>
 <div style={{display:'flex',gap:'4px'}}>
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Approved')}>Approve</button>
 <button style={{...css.btn,background:C.dangerL,color:C.danger,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Rejected')}>Reject</button>
 </div>
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>
 )}

 {/* REJECTED TAB */}
 {activeTab === 'rejected' && (
 <div style={css.card}>
 <div style={{...css.cardHead,color:C.danger}}>
 <span>Rejected Claims — {rejected.length}</span>
 <span style={{fontSize:'12px'}}>KES {rejectedAmt.toLocaleString()} unrecovered</span>
 </div>
 <table style={css.table}>
 <thead>
 <tr>{['Patient','SHA No','Service','Amount','Date','Notes','Action'].map(h=><th key={h} style={css.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {rejected.length===0 && <tr><td colSpan={7} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No rejected claims</td></tr>}
 {rejected.map(r=>(
 <tr key={r.id}>
 <td style={css.td}><strong>{r.patient_name}</strong></td>
 <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.blue}}>{r.sha_number||'—'}</td>
 <td style={css.td}>{r.service_type}</td>
 <td style={{...css.td,fontWeight:700,color:C.danger}}>KES {parseFloat(r.amount_claimed||0).toLocaleString()}</td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{r.created_at?new Date(r.created_at).toLocaleDateString('en-KE'):'—'}</td>
 <td style={{...css.td,fontSize:'12px',color:C.sub,maxWidth:'200px'}}>{getClaimNotesText(r) || '—'}</td>
 <td style={css.td}>
 <button style={{...css.btn,background:'#F3F4F6',color:C.sub,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Appealed')}>Lodge Appeal</button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}

 {/* BY SERVICE TAB */}
 {activeTab === 'breakdown' && (
 <div style={css.card}>
 <div style={css.cardHead}>
 <span>Claims by Service Type</span>
 <span style={{fontSize:'12px',color:C.sub}}>All time</span>
 </div>
 <table style={css.table}>
 <thead>
 <tr>{['Service Type','Total Claims','Total Amount (KES)','Approved','Approval Rate'].map(h=><th key={h} style={css.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {serviceBreakdown.length===0 && <tr><td colSpan={5} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No data yet</td></tr>}
 {serviceBreakdown.map(s => {
 const rate = s.count>0?Math.round((s.approved/s.count)*100):0
 return (
 <tr key={s.name}>
 <td style={{...css.td,fontWeight:600}}>{s.name}</td>
 <td style={css.td}>{s.count}</td>
 <td style={{...css.td,fontWeight:700,color:C.primary}}>KES {s.total.toLocaleString()}</td>
 <td style={css.td}>{s.approved}</td>
 <td style={css.td}>
 <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
 <div style={{flex:1,height:'6px',background:C.border,borderRadius:'3px',overflow:'hidden'}}>
 <div style={{height:'100%',width:`${rate}%`,background:rate>70?C.primary:rate>40?C.warn:C.danger,borderRadius:'3px'}}/>
 </div>
 <span style={{fontSize:'12px',fontWeight:600,color:rate>70?C.primary:rate>40?C.warn:C.danger,minWidth:'30px'}}>{rate}%</span>
 </div>
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>
 )}

 </div>

 {/* NEW CLAIM MODAL */}
 {showAdd && (
 <div style={css.overlay} onClick={()=>setShowAdd(false)}>
 <div style={css.modal} onClick={e=>e.stopPropagation()}>
 <div style={css.modalH}>Submit SHA Claim</div>
 <div style={{background:C.blueL,border:`1px solid ${C.blue}33`,borderRadius:'8px',padding:'10px 12px',fontSize:'12px',color:C.blue,marginBottom:'16px',lineHeight:'1.6'}}>
 For patients already invoiced in Billing with SHA payment, use the From Billing tab to import directly instead.
 </div>
 <label style={css.lbl}>Patient Name *</label>
 <input style={css.input} placeholder="Full name as per SHA records"
 value={form.patient_name} onChange={e=>setForm({...form,patient_name:e.target.value})}/>
 <div style={css.grid2}>
 <div>
 <label style={css.lbl}>SHA Member Number</label>
 <input style={css.input} placeholder="SHA-XXXXXXXX"
 value={form.sha_number} onChange={e=>setForm({...form,sha_number:e.target.value.toUpperCase()})}/>
 </div>
 <div>
 <label style={css.lbl}>National ID</label>
 <input style={css.input} placeholder="12345678"
 value={form.id_number} onChange={e=>setForm({...form,id_number:e.target.value})}/>
 </div>
 </div>
 <label style={css.lbl}>Service Type *</label>
 <select style={{...css.input,cursor:'pointer'}} value={form.service_type}
 onChange={e=>setForm({...form,service_type:e.target.value})}>
 {SHA_SERVICES.map(s=><option key={s}>{s}</option>)}
 </select>
 <div style={css.grid2}>
 <div>
 <label style={css.lbl}>Amount Claimed (KES) *</label>
 <input style={css.input} type="number" placeholder="0"
 value={form.amount_claimed} onChange={e=>setForm({...form,amount_claimed:e.target.value})}/>
 </div>
 <div>
 <label style={css.lbl}>Visit Date</label>
 <input style={css.input} type="date" value={form.visit_date}
 onChange={e=>setForm({...form,visit_date:e.target.value})}/>
 </div>
 </div>
 <label style={css.lbl}>Notes</label>
 <textarea style={{...css.input,resize:'vertical',minHeight:'60px',fontFamily:'inherit'}}
 placeholder="Diagnosis, procedure details..."
 value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/>
 <hr style={css.divider}/>
 <div style={{display:'flex',gap:'8px'}}>
 <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={()=>setShowAdd(false)}>Cancel</button>
 <button style={{...css.btn,...css.btnPri,flex:2,padding:'10px'}} onClick={handleSave} disabled={saving}>
 {saving?'Submitting...':'Submit Claim'}
 </button>
 </div>
 </div>
 </div>
 )}

 {/* DETAIL MODAL */}
 {showDetail && (
 <div style={css.overlay} onClick={()=>setShowDetail(null)}>
 <div style={css.modal} onClick={e=>e.stopPropagation()}>
 <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
 <div style={css.modalH}>Claim Detail</div>
 <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={()=>setShowDetail(null)}></button>
 </div>
 {[
 ['Patient Name', showDetail.patient_name],
 ['SHA Number', showDetail.sha_number||'—'],
 ['ID Number', showDetail.id_number||'—'],
 ['Service Type', showDetail.service_type],
 ['Amount Claimed', `KES ${parseFloat(showDetail.amount_claimed||0).toLocaleString()}`],
 ['Visit Date', showDetail.visit_date?new Date(showDetail.visit_date).toLocaleDateString('en-KE'):'—'],
 ['Status', showDetail.status],
 ['Submitted', showDetail.created_at?new Date(showDetail.created_at).toLocaleString('en-KE'):'—'],
 ].map(([k,v])=>(
 <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:`1px solid ${C.border}`,fontSize:'13px'}}>
 <span style={{color:C.sub,fontWeight:500}}>{k}</span>
 <span style={{fontWeight:600}}>{k==='Status'?<Badge status={v}/>:v}</span>
 </div>
 ))}
 {getClaimNotesText(showDetail) && (
 <div style={{marginTop:'12px',padding:'12px',background:'#FAFBFD',borderRadius:'8px',border:`1px solid ${C.border}`,fontSize:'13px',color:C.sub,lineHeight:'1.6'}}>
 <div style={{fontWeight:600,color:C.text,marginBottom:'4px',fontSize:'11px',textTransform:'uppercase',letterSpacing:'.4px'}}>Notes</div>
 {getClaimNotesText(showDetail)}
 </div>
 )}
 <div style={{marginTop:'16px',display:'flex',gap:'8px',flexWrap:'wrap'}}>
 {['Pending','Submitted','Under Review'].includes(showDetail.status) && (
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',flex:1,padding:'10px'}}
 onClick={()=>{updateStatus(showDetail.id,'Approved');setShowDetail(null)}} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Approve</button>
 )}
 {showDetail.status==='Approved' && (
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',flex:1,padding:'10px'}}
 onClick={()=>{updateStatus(showDetail.id,'Paid');setShowDetail(null)}} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Mark Paid</button>
 )}
 {!['Rejected','Paid'].includes(showDetail.status) && (
 <button style={{...css.btn,background:C.dangerL,color:C.danger,border:'none',flex:1,padding:'10px'}}
 onClick={()=>{updateStatus(showDetail.id,'Rejected');setShowDetail(null)}} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Reject</button>
 )}
 {showDetail.status==='Rejected' && (
 <button style={{...css.btn,background:'#F3F4F6',color:C.sub,border:'none',flex:1,padding:'10px'}}
 onClick={()=>{updateStatus(showDetail.id,'Appealed');setShowDetail(null)}}>Lodge Appeal</button>
 )}
 <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={()=>setShowDetail(null)}>Close</button>
 </div>
 </div>
 </div>
 )}
 </div>
 )
}
