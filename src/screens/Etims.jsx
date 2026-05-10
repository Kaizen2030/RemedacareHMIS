import { useEffect, useState } from 'react'
import SkeletonLoader from '../components/SkeletonLoader'
import supabase from '../supabase'
import { useHospital } from '../context'
import { colors as C, typography } from '../theme'

const STATUS_COLORS = {
 Submitted: { bg: C.primaryL, color: C.primary },
 Pending: { bg: C.warnL, color: C.warn },
 Failed: { bg: C.dangerL, color: C.danger },
 Accepted: { bg: C.primaryL, color: C.primary },
 Rejected: { bg: C.dangerL, color: C.danger },
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
 modal: { background:C.surface, borderRadius:'12px', padding:'24px', width:'500px', maxWidth:'95vw', boxShadow:'0 20px 60px rgba(0,0,0,.2)', maxHeight:'90vh', overflowY:'auto' },
 modalH: { fontSize:'15px', fontWeight:700, marginBottom:'16px', color:C.text },
 lbl: { fontSize:'11px', fontWeight:600, color:C.sub, textTransform:'uppercase', letterSpacing:'.4px', marginBottom:'4px', display:'block' },
 input: { width:'100%', boxSizing:'border-box', padding:'9px 11px', border:`1px solid ${C.border}`, borderRadius:'7px', fontSize:'13px', color:C.text, outline:'none', background:C.surface, marginBottom:'12px' },
 grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' },
 divider: { border:'none', borderTop:`1px solid ${C.border}`, margin:'16px 0' },
}

// etims_submissions schema: id, hospital_id, sale_ref, service, amount_kes, status, submitted_at

function Badge({ status }) {
 const sc = STATUS_COLORS[status] || { bg:'#F3F4F6', color:C.sub }
 return <span style={{...css.badge, background:sc.bg, color:sc.color}}>{status || '—'}</span>
}

const emptyForm = {
 sale_ref: '',
 service: '',
 amount_kes: '',
 status: 'Pending',
 submitted_at: new Date().toISOString().slice(0,16),
}

export default function ETims() {
 const { hospitalId, userRole } = useHospital()
 const isAdmin = ['Admin','admin'].includes(userRole || '')
 const [loading, setLoading] = useState(true)
 const [saving, setSaving] = useState(false)
 const [activeTab, setActiveTab] = useState('submissions')
 const [submissions, setSubmissions] = useState([]) // etims_submissions table
 const [invoices, setInvoices] = useState([]) // paid invoices not yet submitted
 const [salesLedger, setSalesLedger] = useState([]) // sales_ledger entries not yet submitted
 const [search, setSearch] = useState('')
 const [statusFilter, setStatusFilter] = useState('all')
 const [dateFilter, setDateFilter] = useState('month')
 const [showAdd, setShowAdd] = useState(false)
 const [form, setForm] = useState(emptyForm)

 useEffect(() => { if (!hospitalId) { setLoading(false); return }; fetchAll() }, [hospitalId])

 async function fetchAll() {
 setLoading(true)
 const [{ data: sub }, { data: inv }, { data: sl }] = await Promise.all([
 // eTIMS submissions log
 supabase.from('etims_submissions').select('*')
 .eq('hospital_id', hospitalId)
 .order('submitted_at', { ascending: false }),
 // Paid invoices from billing — these need to be reported to KRA
 supabase.from('invoices')
 .select('id,invoice_no,patient_name,services,amount_kes,paid_kes,payment_method,status,created_at')
 .eq('hospital_id', hospitalId)
 .in('status', ['Paid','Partial'])
 .order('created_at', { ascending: false })
 .limit(300),
 // Sales ledger entries
 supabase.from('sales_ledger')
 .select('id,receipt_number,customer_name,drug_name,total_kes,payment_method,sold_at')
 .eq('hospital_id', hospitalId)
 .order('sold_at', { ascending: false })
 .limit(300),
 ])
 setSubmissions(sub || [])
 setInvoices(inv || [])
 setSalesLedger(sl || [])
 setLoading(false)
 }

 async function handleSave() {
 if (!form.sale_ref || !form.amount_kes) { window.notifyFromLegacyAlert('Sale reference and amount are required'); return }
 setSaving(true)
 const { error } = await supabase.from('etims_submissions').insert({
 hospital_id: hospitalId,
 sale_ref: form.sale_ref.trim().toUpperCase(),
 service: form.service.trim(),
 amount_kes: parseFloat(form.amount_kes),
 status: form.status,
 submitted_at: new Date(form.submitted_at).toISOString(),
 })
 if (error) window.notifyFromLegacyAlert('Error: ' + error.message)
 setShowAdd(false); setForm(emptyForm)
 await fetchAll(); setSaving(false)
 }

 // Submit an invoice to eTIMS — in production calls KRA eTIMS API
 async function submitToETims(ref, service, amount) {
 if (!isAdmin) {
 window.notifyFromLegacyAlert('Only Admin users can submit invoices to KRA eTIMS.')
 return
 }
 setSaving(true)
 const alreadySubmitted = submissions.some(s => s.sale_ref === ref)
 if (alreadySubmitted) { window.notifyFromLegacyAlert(`${ref} is already submitted to eTIMS.`); setSaving(false); return }
 const { error } = await supabase.from('etims_submissions').insert({
 hospital_id: hospitalId,
 sale_ref: ref,
 service: service || 'Hospital Services',
 amount_kes: parseFloat(amount || 0),
 status: 'Submitted',
 submitted_at: new Date().toISOString(),
 })
 if (error) window.notifyFromLegacyAlert('Error: ' + error.message)
 else await fetchAll()
 setSaving(false)
 }

 async function updateStatus(id, status) {
 if (!isAdmin && ['Submitted','Accepted'].includes(status)) {
 window.notifyFromLegacyAlert('Only Admin users can update KRA submission status.')
 return
 }
 await supabase.from('etims_submissions').update({ status }).eq('id', id)
 await fetchAll()
 }

 // Bulk submit all pending invoices
 async function bulkSubmitInvoices() {
 if (!isAdmin) {
 window.notifyFromLegacyAlert('Only Admin users can bulk submit invoices to KRA eTIMS.')
 return
 }
 const submittedRefs = new Set(submissions.map(s => s.sale_ref))
 const unsubmitted = invoices.filter(inv => !submittedRefs.has(inv.invoice_no))
 if (unsubmitted.length === 0) { window.notifyFromLegacyAlert('All invoices already submitted to eTIMS.'); return }
 if (!await window.openConfirmDialog(`Submit ${unsubmitted.length} invoice(s) to KRA eTIMS?`)) return
 setSaving(true)
 const rows = unsubmitted.map(inv => ({
 hospital_id: hospitalId,
 sale_ref: inv.invoice_no,
 service: inv.services || 'Hospital Services',
 amount_kes: parseFloat(inv.amount_kes || 0),
 status: 'Submitted',
 submitted_at: new Date().toISOString(),
 }))
 const { error } = await supabase.from('etims_submissions').insert(rows)
 if (error) window.notifyFromLegacyAlert('Error: ' + error.message)
 else await fetchAll()
 setSaving(false)
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
 const filtered = submissions.filter(r => {
 const matchDate = dateFilter === 'all' || new Date(r.submitted_at) >= new Date(since)
 const matchStatus = statusFilter === 'all' || r.status === statusFilter
 const matchSearch = !search ||
 r.sale_ref?.toLowerCase().includes(search.toLowerCase()) ||
 r.service?.toLowerCase().includes(search.toLowerCase())
 return matchDate && matchStatus && matchSearch
 })

 // Stats
 const submittedRefs = new Set(submissions.map(s => s.sale_ref))
 const unsubInvoices = invoices.filter(inv => !submittedRefs.has(inv.invoice_no))
 const totalSubmitted = submissions.filter(r => r.status === 'Submitted' || r.status === 'Accepted')
 const totalAmount = totalSubmitted.reduce((s,r) => s+parseFloat(r.amount_kes||0), 0)
 const failedSubs = submissions.filter(r => r.status === 'Failed' || r.status === 'Rejected')
 const pendingSubs = submissions.filter(r => r.status === 'Pending')
 const monthSubs = submissions.filter(r => {
 const d = new Date(r.submitted_at), now = new Date()
 return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()
 })
 const monthAmt = monthSubs.reduce((s,r)=>s+parseFloat(r.amount_kes||0),0)

 // Compliance rate — submitted vs total paid invoices
 const complianceRate = invoices.length > 0 ? Math.round(((invoices.length - unsubInvoices.length) / invoices.length) * 100) : 100

 // Daily summary
 const dailyMap = {}
 submissions.filter(r => r.status === 'Submitted' || r.status === 'Accepted').forEach(r => {
 const day = new Date(r.submitted_at).toLocaleDateString('en-KE')
 if (!dailyMap[day]) dailyMap[day] = { day, count:0, total:0 }
 dailyMap[day].count++
 dailyMap[day].total += parseFloat(r.amount_kes||0)
 })
 const dailySummary = Object.values(dailyMap).sort((a,b)=>new Date(b.day)-new Date(a.day)).slice(0,30)

 if (loading) return (
 <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'80vh',background:C.bg}}>
 <div style={{width:'220px'}}>
 <SkeletonLoader rows={3} height={14} width={['50%','100%','68%']} />
 </div>
 <p style={{color:C.sub,marginTop:12,fontSize:'13px'}}>Loading eTIMS submissions...</p>
 </div>
 )

 return (
 <div style={css.page}>
 <style>{`@keyframes spin{to{transform:rotate(360deg)}} tr:hover td{background:#FAFBFD}`}</style>
 <div style={css.wrap}>

 {/* HEADER */}
 <div style={css.header}>
 <div>
 <h1 style={css.h1}>eTIMS / KRA Tax Compliance</h1>
 </div>
 <div style={{display:'flex',gap:'8px'}}>
 <button style={{...css.btn,...css.btnGhost}} onClick={() => {
 const csv = ['Sale Ref,Service,Amount (KES),Status,Submitted At',
 ...submissions.map(r=>`${r.sale_ref},${r.service||''},${r.amount_kes},${r.status},${r.submitted_at?new Date(r.submitted_at).toLocaleString('en-KE'):''}`)
 ].join('\n')
 const a = document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download='etims_submissions.csv'; a.click()
 }} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Export CSV</button>
 {unsubInvoices.length > 0 && (
 <button style={{...css.btn,background:C.blueL,color:C.blue,border:'none'}}
 onClick={bulkSubmitInvoices} disabled={saving || !isAdmin} title={!isAdmin ? 'Admin only' : ''}>
 Submit All ({unsubInvoices.length})
 </button>
 )}
 <button style={{...css.btn,...css.btnPri}} onClick={()=>{setForm(emptyForm);setShowAdd(true)}}>+ Manual Entry</button>
 </div>
 </div>
 <div style={css.subtext}>
 Compliance: {complianceRate}% of paid invoices submitted to KRA
 {unsubInvoices.length > 0 && <span style={{color:C.warn,fontWeight:600}}> · {unsubInvoices.length} invoice{unsubInvoices.length!==1?'s':''} pending submission</span>}
 </div>

 {/* STATS */}
 <div style={css.statsRow}>
 {[
 { label:'Total Submitted', value:totalSubmitted.length, sub:`KES ${totalAmount.toLocaleString()}`, color:C.primary },
 { label:'This Month', value:`KES ${monthAmt.toLocaleString()}`, sub:`${monthSubs.length} submissions`, color:C.blue },
 { label:'Pending Confirmation', value:pendingSubs.length, sub:'Awaiting KRA response', color:C.warn },
 { label:'Failed / Rejected', value:failedSubs.length, sub:'Require resubmission', color:failedSubs.length>0?C.danger:C.muted },
 { label:'Compliance Rate', value:`${complianceRate}%`, sub:`${unsubInvoices.length} invoices not submitted`, color:complianceRate>=90?C.primary:complianceRate>=70?C.warn:C.danger },
 ].map(st => (
 <div key={st.label} style={css.stat}>
 <div style={css.statLbl}>{st.label}</div>
 <div style={{...css.statVal,color:st.color}}>{st.value}</div>
 <div style={css.statSub}>{st.sub}</div>
 </div>
 ))}
 </div>

 {/* COMPLIANCE RATE BAR */}
 <div style={{...css.card,marginBottom:'16px'}}>
 <div style={{padding:'14px 16px'}}>
 <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
 <span style={{fontSize:'12px',fontWeight:600,color:C.text}}>KRA eTIMS Compliance</span>
 <span style={{fontSize:'13px',fontWeight:800,color:complianceRate>=90?C.primary:complianceRate>=70?C.warn:C.danger}}>{complianceRate}%</span>
 </div>
 <div style={{height:'10px',background:C.border,borderRadius:'5px',overflow:'hidden'}}>
 <div style={{height:'100%',width:`${complianceRate}%`,background:complianceRate>=90?C.primary:complianceRate>=70?C.warn:C.danger,borderRadius:'5px',transition:'width .4s ease'}}/>
 </div>
 <div style={{display:'flex',justifyContent:'space-between',marginTop:'6px'}}>
 <span style={{fontSize:'11px',color:C.sub}}>{invoices.length - unsubInvoices.length} submitted</span>
 <span style={{fontSize:'11px',color:unsubInvoices.length>0?C.warn:C.muted}}>{unsubInvoices.length} pending</span>
 </div>
 </div>
 </div>

 {/* TABS */}
 <div style={css.tabRow}>
 {[
 { key:'submissions', label:'All Submissions' },
 { key:'pending', label:`Not Submitted${unsubInvoices.length>0?` (${unsubInvoices.length})`:''}` },
 { key:'failed', label:`Failed${failedSubs.length>0?` (${failedSubs.length})`:''}` },
 { key:'daily', label:'Daily Summary' },
 ].map(t => (
 <button key={t.key} style={{...css.tab,...(activeTab===t.key?css.tabActive:{})}} onClick={()=>setActiveTab(t.key)}>
 {t.label}
 </button>
 ))}
 </div>

 {/* ALL SUBMISSIONS */}
 {activeTab === 'submissions' && (
 <>
 <div style={css.toolbar}>
 <div style={css.searchWrap}>
 <span style={css.searchIcon}>⌕</span>
 <input style={css.searchInp} placeholder="Search sale reference, service..."
 value={search} onChange={e=>setSearch(e.target.value)}/>
 </div>
 <select style={css.select} value={dateFilter} onChange={e=>setDateFilter(e.target.value)}>
 <option value="today">Today</option><option value="week">Last 7 Days</option>
 <option value="month">Last 30 Days</option><option value="all">All Time</option>
 </select>
 <select style={css.select} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
 <option value="all">All Statuses</option>
 <option>Pending</option><option>Submitted</option><option>Accepted</option>
 <option>Failed</option><option>Rejected</option>
 </select>
 </div>
 <div style={css.card}>
 <div style={css.cardHead}>
 <span>eTIMS Submissions — {filtered.length} records</span>
 <span style={{fontSize:'12px',color:C.sub}}>KES {filtered.reduce((s,r)=>s+parseFloat(r.amount_kes||0),0).toLocaleString()} total</span>
 </div>
 <table style={css.table}>
 <thead>
 <tr>{['Sale Reference','Service','Amount (KES)','Status','Submitted At','Actions'].map(h=><th key={h} style={css.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {filtered.length===0 && <tr><td colSpan={6} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No submissions found</td></tr>}
 {filtered.map(r => (
 <tr key={r.id}>
 <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',fontWeight:700,color:C.text}}>{r.sale_ref}</td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{r.service||'—'}</td>
 <td style={{...css.td,fontWeight:700}}>KES {parseFloat(r.amount_kes||0).toLocaleString()}</td>
 <td style={css.td}><Badge status={r.status}/></td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{r.submitted_at?new Date(r.submitted_at).toLocaleString('en-KE'):'—'}</td>
 <td style={css.td}>
 <div style={{display:'flex',gap:'4px'}}>
 {r.status === 'Pending' && (
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Submitted')}>Mark Submitted</button>
 )}
 {r.status === 'Submitted' && (
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Accepted')}>Accepted</button>
 )}
 {(r.status === 'Failed' || r.status === 'Rejected') && (
 <button style={{...css.btn,background:C.blueL,color:C.blue,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Pending')}>Retry</button>
 )}
 {(r.status === 'Failed' || r.status === 'Rejected') && (
 <button style={{...css.btn,background:C.dangerL,color:C.danger,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Submitted')}>Re-submit</button>
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

 {/* NOT SUBMITTED TAB */}
 {activeTab === 'pending' && (
 <>
 {unsubInvoices.length > 0 && (
 <div style={{background:C.warnL,border:`1px solid ${C.warn}33`,borderRadius:'8px',padding:'12px 16px',marginBottom:'16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
 <div style={{fontSize:'13px',color:C.warn,fontWeight:600}}>
 {unsubInvoices.length} paid invoice{unsubInvoices.length!==1?'s':''} not yet submitted to KRA eTIMS.
 <span style={{fontWeight:400,marginLeft:4}}>Submit individually or use Submit All above.</span>
 </div>
 <button style={{...css.btn,background:C.warn,color:'#fff',border:'none'}}
 onClick={bulkSubmitInvoices} disabled={saving}>
 Submit All {unsubInvoices.length}
 </button>
 </div>
 )}
 <div style={css.card}>
 <div style={{...css.cardHead,color:unsubInvoices.length>0?C.warn:C.text}}>
 <span>Invoices Pending eTIMS Submission — {unsubInvoices.length}</span>
 <span style={{fontSize:'12px'}}>KES {unsubInvoices.reduce((s,i)=>s+parseFloat(i.amount_kes||0),0).toLocaleString()}</span>
 </div>
 <table style={css.table}>
 <thead>
 <tr>{['Invoice No','Patient','Services','Amount','Payment','Invoice Status','Date','Action'].map(h=><th key={h} style={css.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {unsubInvoices.length===0 && (
 <tr><td colSpan={8} style={{...css.td,textAlign:'center',color:C.primary,padding:'40px',fontWeight:600}}>
 All paid invoices have been submitted to KRA eTIMS.
 </td></tr>
 )}
 {unsubInvoices.map(inv => (
 <tr key={inv.id}>
 <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',fontWeight:700,color:C.sub}}>{inv.invoice_no}</td>
 <td style={css.td}><strong>{inv.patient_name}</strong></td>
 <td style={{...css.td,fontSize:'12px',color:C.sub,maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{inv.services||'—'}</td>
 <td style={{...css.td,fontWeight:700}}>KES {parseFloat(inv.amount_kes||0).toLocaleString()}</td>
 <td style={{...css.td,fontSize:'12px'}}>{inv.payment_method||'—'}</td>
 <td style={css.td}><Badge status={inv.status}/></td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{inv.created_at?new Date(inv.created_at).toLocaleDateString('en-KE'):'—'}</td>
 <td style={css.td}>
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'5px 10px',fontSize:'11px'}}
 onClick={()=>submitToETims(inv.invoice_no, inv.services, inv.amount_kes)} disabled={saving || !isAdmin} title={!isAdmin ? 'Admin only' : ''}>
 Submit
 </button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </>
 )}

 {/* FAILED TAB */}
 {activeTab === 'failed' && (
 <div style={css.card}>
 <div style={{...css.cardHead,color:C.danger}}>
 <span>Failed / Rejected Submissions — {failedSubs.length}</span>
 <span style={{fontSize:'12px'}}>KES {failedSubs.reduce((s,r)=>s+parseFloat(r.amount_kes||0),0).toLocaleString()}</span>
 </div>
 <table style={css.table}>
 <thead>
 <tr>{['Sale Reference','Service','Amount','Status','Submitted At','Action'].map(h=><th key={h} style={css.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {failedSubs.length===0 && (
 <tr><td colSpan={6} style={{...css.td,textAlign:'center',color:C.primary,padding:'40px',fontWeight:600}}>No failed submissions.</td></tr>
 )}
 {failedSubs.map(r => (
 <tr key={r.id}>
 <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',fontWeight:700,color:C.danger}}>{r.sale_ref}</td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{r.service||'—'}</td>
 <td style={{...css.td,fontWeight:700,color:C.danger}}>KES {parseFloat(r.amount_kes||0).toLocaleString()}</td>
 <td style={css.td}><Badge status={r.status}/></td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{r.submitted_at?new Date(r.submitted_at).toLocaleString('en-KE'):'—'}</td>
 <td style={css.td}>
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'5px 10px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Submitted')}>Re-submit</button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}

 {/* DAILY SUMMARY TAB */}
 {activeTab === 'daily' && (
 <div style={css.card}>
 <div style={css.cardHead}>
 <span>Daily eTIMS Submissions — Last 30 Days</span>
 <span style={{fontSize:'12px',color:C.sub}}>Submitted and Accepted only</span>
 </div>
 <table style={css.table}>
 <thead>
 <tr>{['Date','Submissions','Total Amount (KES)','Avg Per Submission','Running Total'].map(h=><th key={h} style={css.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {dailySummary.length===0 && (
 <tr><td colSpan={5} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No data yet</td></tr>
 )}
 {dailySummary.reduce((acc, day, i) => {
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
 }, [])}
 </tbody>
 </table>
 </div>
 )}

 </div>

 {/* MANUAL ENTRY MODAL */}
 {showAdd && (
 <div style={css.overlay} onClick={()=>setShowAdd(false)}>
 <div style={css.modal} onClick={e=>e.stopPropagation()}>
 <div style={css.modalH}>Manual eTIMS Entry</div>
 <div style={{background:C.warnL,border:`1px solid ${C.warn}33`,borderRadius:'8px',padding:'10px 12px',fontSize:'12px',color:C.warn,marginBottom:'16px',lineHeight:'1.6'}}>
 Use this for transactions not captured via invoice — e.g. cash sales logged outside billing. For invoices, use the Not Submitted tab.
 </div>
 <label style={css.lbl}>Sale Reference *</label>
 <input style={css.input} placeholder="e.g. INV-123456, RCPT-001"
 value={form.sale_ref} onChange={e=>setForm({...form,sale_ref:e.target.value.toUpperCase()})}/>
 <label style={css.lbl}>Service / Description</label>
 <input style={css.input} placeholder="e.g. Consultation, Pharmacy, Lab"
 value={form.service} onChange={e=>setForm({...form,service:e.target.value})}/>
 <div style={css.grid2}>
 <div>
 <label style={css.lbl}>Amount (KES) *</label>
 <input style={css.input} type="number" placeholder="0"
 value={form.amount_kes} onChange={e=>setForm({...form,amount_kes:e.target.value})}/>
 </div>
 <div>
 <label style={css.lbl}>Status</label>
 <select style={{...css.input,cursor:'pointer'}} value={form.status}
 onChange={e=>setForm({...form,status:e.target.value})}>
 <option>Pending</option><option>Submitted</option><option>Accepted</option>
 </select>
 </div>
 </div>
 <label style={css.lbl}>Submission Date &amp; Time</label>
 <input style={css.input} type="datetime-local" value={form.submitted_at}
 onChange={e=>setForm({...form,submitted_at:e.target.value})}/>
 <hr style={css.divider}/>
 <div style={{display:'flex',gap:'8px'}}>
 <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={()=>setShowAdd(false)}>Cancel</button>
 <button style={{...css.btn,...css.btnPri,flex:2,padding:'10px'}} onClick={handleSave} disabled={saving}>
 {saving?'Saving...':'Log Entry'}
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 )
}
