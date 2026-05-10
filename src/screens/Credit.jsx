import { useEffect, useState } from 'react'
import SkeletonLoader from '../components/SkeletonLoader'
import supabase from '../supabase'
import { useHospital } from '../context'
import { broadcastWorkflowChanged } from '../utils/workflowEvents'
import { colors as themeColors, typography } from '../theme'

const C = {
  ...themeColors,
  border: themeColors.borderSoft,
  danger: themeColors.dangerDark,
  dangerL: themeColors.dangerSoft,
  sub: themeColors.subStrong,
  muted: themeColors.mutedStrong,
}

const STATUS_COLORS = {
  Pending:  { bg: '#F8FAFC', color: '#475569' },
  Partial:  { bg: C.primaryL, color: C.primary },
  Paid:     { bg: '#ECFDF5', color: '#047857' },
  Waived:   { bg: '#F8FAFC', color: '#64748B' },
  Disputed: { bg: '#FEE2E2', color: '#B91C1C' },
}

const CATEGORY_ICONS = {}
const CATEGORIES    = ['Consultation','Lab','Pharmacy','Admission','Deposit','Overpayment','Other']
const PAYMENT_METHODS = ['Cash','M-Pesa','Insurance','SHA','Bank Transfer','Cheque','Waived']

function formatKES(v) { return `KES ${Number(v || 0).toLocaleString()}` }

// ─── Auto-post credit record to billing invoice when a payment is made ───────
async function syncPaymentToBillingInvoice(hospitalId, record, amountPaid, paymentMethod) {
  if (!record.visit_id && !record.patient_id) return
  // Find matching unpaid billing invoice for this visit/patient
  let q = supabase.from('invoices')
    .select('id, amount_kes, paid_kes, balance_kes, status')
    .eq('hospital_id', hospitalId)
    .in('status', ['Pending', 'Partial'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (record.visit_id) q = q.eq('visit_id', record.visit_id)
  else q = q.eq('patient_id', record.patient_id)
  const { data: invs } = await q
  if (!invs || invs.length === 0) return
  const inv = invs[0]
  const newPaid = Math.min(Number(inv.amount_kes || 0), Number(inv.paid_kes || 0) + Number(amountPaid))
  const newBalance = Math.max(0, Number(inv.amount_kes || 0) - newPaid)
  const newStatus = newBalance <= 0 ? 'Paid' : newPaid > 0 ? 'Partial' : 'Pending'
  await supabase.from('invoices').update({
    paid_kes: newPaid, balance_kes: newBalance, status: newStatus,
    payment_method: paymentMethod || inv.payment_method,
    paid_at: newStatus === 'Paid' ? new Date().toISOString() : null,
  }).eq('id', inv.id)
}

export default function CreditDebts() {
  const { hospitalId, userRole } = useHospital()
  const isAdmin = ['Admin', 'admin'].includes(userRole || '')
  const [loading, setLoading]   = useState(true)
  const [saving,  setSaving]    = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [search, setSearch]     = useState('')
  const [dateFilter, setDateFilter] = useState('all')

  // Data
  const [records,  setRecords]  = useState([])
  const [patients, setPatients] = useState([])

  // Modals
  const [showAdd,      setShowAdd]      = useState(false)
  const [showPayment,  setShowPayment]  = useState(null)
  const [showDetail,   setShowDetail]   = useState(null)
  const [showWriteoff, setShowWriteoff] = useState(null)
  const [editingRecord, setEditingRecord] = useState(null)

  // Forms
  const emptyForm = {
    patient_id:'', visit_id:'', type:'Debt', category:'Consultation',
    description:'', amount_charged:'', amount_paid:'0',
    payment_method:'Cash', mpesa_ref:'', due_date:'', notes:'',
  }
  const [form, setForm]           = useState(emptyForm)
  const [patientVisits, setPatientVisits] = useState([])
  const [payForm, setPayForm]     = useState({ amount_paid:'', payment_method:'Cash', mpesa_ref:'', notes:'' })
  const [writeoffForm, setWriteoffForm] = useState({ reason:'', authorized_by:'' })

  // Patient search
  const [patSearch,   setPatSearch]   = useState('')
  const [patResults,  setPatResults]  = useState([])
  const [selectedPat, setSelectedPat] = useState(null)

  useEffect(() => { if (!hospitalId) { setLoading(false); return }; fetchAll() }, [hospitalId])

  async function fetchAll() {
    setLoading(true)
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from('credit_debts')
        .select('*, patients(full_name, phone, insurance)')
        .eq('hospital_id', hospitalId)
        .order('created_at', { ascending: false }),
      supabase.from('patients').select('id, full_name, phone')
        .eq('hospital_id', hospitalId).order('full_name'),
    ])
    setRecords(r || [])
    setPatients(p || [])
    setLoading(false)
  }

  async function searchPatients(q) {
    if (!q.trim()) { setPatResults([]); return }
    const { data } = await supabase.from('patients').select('id, full_name, phone')
      .eq('hospital_id', hospitalId)
      .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8)
    setPatResults(data || [])
  }

  async function loadPatientVisits(patientId) {
    const { data } = await supabase.from('visits')
      .select('id, visit_number, visit_type, created_at, status, admission_fee')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(10)
    setPatientVisits(data || [])
  }

  function resetFormState() {
    setForm(emptyForm); setSelectedPat(null); setPatSearch('')
    setPatResults([]); setPatientVisits([]); setEditingRecord(null)
  }

  function getStatus(amountCharged, amountPaid) {
    const c = parseFloat(amountCharged || 0), p = parseFloat(amountPaid || 0)
    if (c === 0) return 'Pending'
    return p >= c ? 'Paid' : p > 0 ? 'Partial' : 'Pending'
  }

  function openRecordForm(record = null) {
    if (record) {
      setEditingRecord(record)
      setForm({
        patient_id: record.patient_id || '', visit_id: record.visit_id || '',
        type: record.type || 'Debt', category: record.category || 'Consultation',
        description: record.description || '',
        amount_charged: record.amount_charged?.toString() || '',
        amount_paid: record.amount_paid?.toString() || '0',
        payment_method: record.payment_method || 'Cash',
        mpesa_ref: record.mpesa_ref || '', due_date: record.due_date || '',
        notes: record.notes || '',
      })
      setSelectedPat({ id: record.patient_id, full_name: record.patients?.full_name || '', phone: record.patients?.phone || '' })
      if (record.patient_id) loadPatientVisits(record.patient_id)
    } else { resetFormState() }
    setShowAdd(true)
  }

  async function handleSave() {
    if (!form.patient_id)     { window.notifyFromLegacyAlert('Select a patient'); return }
    if (!form.amount_charged) { window.notifyFromLegacyAlert('Enter amount charged'); return }
    if (!form.description)    { window.notifyFromLegacyAlert('Enter description'); return }
    setSaving(true)
    const amountCharged = parseFloat(form.amount_charged)
    const amountPaid    = parseFloat(form.amount_paid) || 0
    const balance       = amountCharged - amountPaid
    const status        = getStatus(amountCharged, amountPaid)
    const payload = {
      hospital_id: hospitalId,
      patient_id:  form.patient_id,
      visit_id:    form.visit_id || null,
      type: form.type, category: form.category,
      description: form.description,
      amount_charged: amountCharged, amount_paid: amountPaid,
      balance, status,
      payment_method: form.payment_method || null,
      mpesa_ref: form.mpesa_ref || null,
      due_date:  form.due_date  || null,
      notes:     form.notes     || null,
      paid_at: status === 'Paid' ? new Date().toISOString() : null,
      created_by: editingRecord ? undefined : (localStorage.getItem('nexus_user_name') || 'Staff'),
    }
    let error = null
    if (editingRecord) {
      delete payload.created_by
      const { error: e } = await supabase.from('credit_debts').update(payload).eq('id', editingRecord.id)
      error = e
    } else {
      const { error: e } = await supabase.from('credit_debts').insert(payload)
      error = e
    }
    if (error) { window.notifyFromLegacyAlert('Error: ' + error.message) } else {
      // If payment was made now, sync to billing
      if (amountPaid > 0 && !error) {
        await syncPaymentToBillingInvoice(hospitalId, { ...payload }, amountPaid, form.payment_method)
      }
    }
    setShowAdd(false); resetFormState(); await fetchAll(); setSaving(false)
    if (!error) broadcastWorkflowChanged({ source: editingRecord ? 'credit-update' : 'credit-create', patient_id: form.patient_id, type: form.type, balance })
  }

  async function markAsPaid(record) {
    setSaving(true)
    const amountCharged = parseFloat(record.amount_charged || 0)
    const { error } = await supabase.from('credit_debts').update({
      amount_paid: amountCharged, balance: 0, status: 'Paid',
      paid_at: new Date().toISOString(),
    }).eq('id', record.id)
    if (error) { window.notifyFromLegacyAlert('Error: ' + error.message) }
    await fetchAll(); setSaving(false)
    if (!error) broadcastWorkflowChanged({ source: 'credit-mark-paid', id: record.id })
  }

  async function handleRecordPayment() {
    if (!payForm.amount_paid || parseFloat(payForm.amount_paid) <= 0) { window.notifyFromLegacyAlert('Enter payment amount'); return }
    setSaving(true)
    const rec       = showPayment
    const newPaid   = parseFloat(rec.amount_paid) + parseFloat(payForm.amount_paid)
    const newBalance = parseFloat(rec.amount_charged) - newPaid
    const newStatus = newPaid >= parseFloat(rec.amount_charged) ? 'Paid' : 'Partial'
    const { error } = await supabase.from('credit_debts').update({
      amount_paid: newPaid, balance: newBalance, status: newStatus,
      payment_method: payForm.payment_method,
      mpesa_ref: payForm.mpesa_ref || null,
      notes: payForm.notes || rec.notes,
      paid_at: newStatus === 'Paid' ? new Date().toISOString() : rec.paid_at,
    }).eq('id', rec.id)
    if (error) { window.notifyFromLegacyAlert('Error: ' + error.message) } else {
      // Sync payment to billing invoice
      await syncPaymentToBillingInvoice(hospitalId, rec, parseFloat(payForm.amount_paid), payForm.payment_method)
    }
    setShowPayment(null)
    setPayForm({ amount_paid:'', payment_method:'Cash', mpesa_ref:'', notes:'' })
    await fetchAll(); setSaving(false)
    if (!error) broadcastWorkflowChanged({ source: 'credit-payment', id: rec.id, status: newStatus })
  }

  async function handleWriteoff() {
    if (!writeoffForm.authorized_by) { window.notifyFromLegacyAlert('Enter authorizing officer name'); return }
    if (!isAdmin) { window.notifyFromLegacyAlert('Only Admin users can authorize write-offs.'); return }
    setSaving(true)
    const { error } = await supabase.from('credit_debts').update({
      status: 'Waived', balance: 0,
      notes: `Written off — ${writeoffForm.reason}. Authorized by: ${writeoffForm.authorized_by}`,
      paid_at: new Date().toISOString(),
    }).eq('id', showWriteoff.id)
    setShowWriteoff(null); setWriteoffForm({ reason:'', authorized_by:'' })
    await fetchAll(); setSaving(false)
    if (!error) broadcastWorkflowChanged({ source: 'credit-writeoff', id: showWriteoff.id })
  }

  function exportCSV() {
    const headers = ['Patient','Phone','Type','Category','Description','Charged','Paid','Balance','Status','Payment Method','Date']
    const rows = records.map(r => [
      r.patients?.full_name || '', r.patients?.phone || '',
      r.type, r.category, r.description,
      r.amount_charged, r.amount_paid, r.balance || 0,
      r.status, r.payment_method || '',
      r.created_at ? new Date(r.created_at).toLocaleDateString('en-KE') : '',
    ])
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = `credit_debts_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  // ── Date filter helper ────────────────────────────────────────────────────
  function inDateRange(dateStr) {
    if (dateFilter === 'all') return true
    const d = new Date(dateStr), now = new Date()
    if (dateFilter === 'today') return d.toDateString() === now.toDateString()
    if (dateFilter === 'week')  return (now - d) < 7 * 86400000
    if (dateFilter === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    return true
  }

  // ── Computed stats ────────────────────────────────────────────────────────
  const debts   = records.filter(r => r.type === 'Debt')
  const credits  = records.filter(r => r.type === 'Credit')
  const pending  = debts.filter(r => r.status === 'Pending' || r.status === 'Partial')
  const totalOwed    = pending.reduce((s,r) => s + parseFloat(r.balance||0), 0)
  const totalCredits = credits.reduce((s,r) => s + parseFloat(r.balance||0), 0)
  const writtenOff   = records.filter(r => r.status === 'Waived').reduce((s,r) => s + parseFloat(r.amount_charged||0), 0)

  const totalCollectedToday = records.filter(r => {
    const today = new Date().toDateString()
    return r.paid_at && new Date(r.paid_at).toDateString() === today && r.status !== 'Waived'
  }).reduce((s,r) => s + parseFloat(r.amount_paid||0), 0)

  const cashCollected  = records.filter(r => r.payment_method === 'Cash'   && r.status !== 'Pending').reduce((s,r) => s + parseFloat(r.amount_paid||0), 0)
  const mpesaCollected = records.filter(r => r.payment_method === 'M-Pesa' && r.status !== 'Pending').reduce((s,r) => s + parseFloat(r.amount_paid||0), 0)
  const shaCollected   = records.filter(r => r.payment_method === 'SHA'    && r.status !== 'Pending').reduce((s,r) => s + parseFloat(r.amount_paid||0), 0)

  // Overdue: due_date in the past and still unpaid
  const overdue = pending.filter(r => r.due_date && new Date(r.due_date) < new Date())
  const overdueAmt = overdue.reduce((s,r) => s + parseFloat(r.balance||0), 0)

  // Top debtors
  const debtorMap = {}
  pending.forEach(r => {
    const id = r.patient_id
    if (!debtorMap[id]) debtorMap[id] = { name: r.patients?.full_name||'Unknown', phone: r.patients?.phone||'', total: 0, count: 0 }
    debtorMap[id].total += parseFloat(r.balance||0)
    debtorMap[id].count++
  })
  const topDebtors = Object.values(debtorMap).sort((a,b) => b.total - a.total).slice(0, 5)

  // Aging buckets
  const aging = { current: 0, days30: 0, days60: 0, days90plus: 0 }
  const now = Date.now()
  pending.forEach(r => {
    const age = r.due_date ? Math.floor((now - new Date(r.due_date)) / 86400000) : 0
    const bal = parseFloat(r.balance || 0)
    if (age <= 0)  aging.current  += bal
    else if (age <= 30) aging.days30   += bal
    else if (age <= 60) aging.days60   += bal
    else               aging.days90plus += bal
  })

  // Filter records
  function filterRecords(list) {
    return list.filter(r => {
      const name = (r.patients?.full_name||'').toLowerCase()
      const desc = (r.description||'').toLowerCase()
      const matchSearch = !search || name.includes(search.toLowerCase()) || desc.includes(search.toLowerCase())
      const matchDate   = inDateRange(r.created_at)
      return matchSearch && matchDate
    })
  }

  // Group debts by patient
  const patientDebtMap = {}
  filterRecords(pending).forEach(r => {
    const id = r.patient_id
    if (!patientDebtMap[id]) patientDebtMap[id] = {
      patient_id: id, name: r.patients?.full_name||'Unknown',
      phone: r.patients?.phone||'', records: [], total: 0, hasOverdue: false,
    }
    patientDebtMap[id].records.push(r)
    patientDebtMap[id].total += parseFloat(r.balance||0)
    if (r.due_date && new Date(r.due_date) < new Date()) patientDebtMap[id].hasOverdue = true
  })
  const patientDebtGroups = Object.values(patientDebtMap).sort((a,b) => b.total - a.total)

  if (loading) return (
    <div style={s.loadWrap}>
      <div style={{ width: '220px' }}>
        <SkeletonLoader rows={3} height={14} width={['45%', '100%', '70%']} />
      </div>
      <p style={{color:C.primary,marginTop:12}}>Loading Credit & Debts...</p>
    </div>
  )

  return (
    <div style={s.page}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* HEADER */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Credit & Debts</h1>
          <p style={s.subtitle}>
            {pending.length} outstanding · {formatKES(totalOwed)} owed
            {overdue.length > 0 && <span style={{color:C.danger,fontWeight:700}}> · {overdue.length} overdue ({formatKES(overdueAmt)})</span>}
          </p>
        </div>
        <div style={{display:'flex',gap:8}}>
          {isAdmin && (
            <button style={s.ghostBtn} onClick={exportCSV}>Export CSV</button>
          )}
          <button style={s.primaryBtn} onClick={()=>openRecordForm()}>+ Add Record</button>
        </div>
      </div>

      {/* FINANCE RECONCILIATION BANNER */}
<div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:12,marginBottom:16}}>
          {[
            { lbl:'Total Outstanding', val:totalOwed, color:C.danger },
            { lbl:'Overdue', val:overdueAmt, color:C.danger },
            { lbl:'Credits Balance', val:totalCredits, color:C.primary },
            { lbl:'Collected Today', val:totalCollectedToday, color:C.primary },
          ].map(({ lbl, val, color }) => (
            <div key={lbl} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'18px 16px'}}>
              <div style={{fontSize:11,color:C.sub,fontWeight:600,letterSpacing:'.5px',marginBottom:8,textTransform:'uppercase'}}>{lbl}</div>
              <div style={{fontSize:18,fontWeight:700,color}}>{formatKES(val)}</div>
            </div>
          ))}
      </div>

      {/* TABS */}
      <div style={s.tabRow}>
        {[
          { key:'overview', label:'Overview' },
          { key:'debts',    label:`Patient Debts (${patientDebtGroups.length})` },
          { key:'credits',  label:`Credits (${credits.filter(r=>r.status!=='Paid').length})` },
          { key:'overdue',  label:`Overdue${overdue.length>0?` (${overdue.length})`:''}` },
          { key:'aging',    label:'Aging Report' },
          { key:'writeoffs',label:'Write-offs' },
          { key:'all',      label:'All Records' },
        ].map(t => (
          <button key={t.key} style={{...s.tab,...(activeTab===t.key?s.tabActive:{})}} onClick={()=>setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* TOOLBAR (search + date filter) */}
      {activeTab !== 'overview' && activeTab !== 'aging' && (
        <div style={{display:'flex',gap:10,marginBottom:14,alignItems:'center'}}>
          <div style={{position:'relative',flex:1}}>
            <input style={{...s.input,paddingLeft:10,width:'100%',boxSizing:'border-box'}}
              placeholder="Search patient name or description..."
              value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          {['all','today','week','month'].map(f => (
            <button key={f} style={{...s.tab,...(dateFilter===f?s.tabActive:{}),padding:'7px 12px'}}
              onClick={()=>setDateFilter(f)}>
              {f==='all'?'All Time':f==='today'?'Today':f==='week'?'This Week':'This Month'}
            </button>
          ))}
        </div>
      )}

      <div style={{animation:'fadeIn .2s ease'}}>

        {/* ══ OVERVIEW ══════════════════════════════════════════════════ */}
        {activeTab==='overview' && (
          <>
            <div style={s.statsRow}>
              {[
                { label:'Total Outstanding', value:formatKES(totalOwed),           color:C.danger,  bg:'#FEF2F2' },
                { label:'Total Credits',     value:formatKES(totalCredits),         color:C.primary, bg:C.primaryL },
                { label:'Overdue Debts',     value:formatKES(overdueAmt),           color:C.danger,  bg:'#FFF1F1' },
                { label:'Collected Today',   value:formatKES(totalCollectedToday),  color:C.primary, bg:C.primaryL },
                { label:'Pending Accounts',  value:pending.length,                  color:C.sub,     bg:C.surface },
              ].map(st => (
                <div key={st.label} style={{...s.statCard,background:st.bg,borderColor:C.border}}>
                  <div style={{fontSize:20,fontWeight:700,color:st.color,margin:'4px 0'}}>{st.value}</div>
                  <div style={{fontSize:11,color:C.sub}}>{st.label}</div>
                </div>
              ))}
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
              {/* Top debtors */}
              <div style={s.card}>
                <div style={s.cardHeader}>Top Debtors</div>
                <div style={s.cardBody}>
                  {topDebtors.length === 0 ? (
                    <div style={s.empty}><div style={{fontSize:16,fontWeight:700,color:C.sub}}>No outstanding debts</div></div>
                  ) : topDebtors.map((d,i) => (
                    <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:`1px solid ${C.border}`}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:13,color:C.text}}>{d.name}</div>
                        <div style={{fontSize:11,color:C.sub}}>{d.phone} · {d.count} record{d.count!==1?'s':''}</div>
                      </div>
                      <div style={{fontWeight:700,color:C.danger,fontSize:14}}>{formatKES(d.total)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent activity */}
              <div style={s.card}>
                <div style={s.cardHeader}>Recent Activity</div>
                <div style={s.cardBody}>
                  {records.slice(0,8).map(r => {
                    const sc = STATUS_COLORS[r.status] || STATUS_COLORS.Pending
                    return (
                      <div key={r.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid #f5f5f5`}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600,fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                            {r.patients?.full_name||'—'}
                          </div>
                          <div style={{fontSize:11,color:C.sub}}>{r.description?.slice(0,40)}{r.description?.length>40?'...':''}</div>
                        </div>
                        <div style={{textAlign:'right',flexShrink:0,marginLeft:8}}>
                          <div style={{fontWeight:700,fontSize:12,color:r.type==='Credit'?C.primary:C.danger}}>
                            {r.type==='Credit'?'+':'-'}{formatKES(r.balance||0)}
                          </div>
                          <span style={{...s.pill,...sc}}>{r.status}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Category breakdown */}
            <div style={{...s.card,marginTop:16}}>
              <div style={s.cardHeader}>Outstanding by Category</div>
              <div style={s.cardBody}>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12}}>
                  {CATEGORIES.map(cat => {
                    const catTotal = pending.filter(r=>r.category===cat).reduce((s,r)=>s+parseFloat(r.balance||0),0)
                    if (catTotal === 0) return null
                    return (
                      <div key={cat} style={{background:C.surface,borderRadius:10,padding:'12px 14px',border:`1px solid ${C.border}`}}>
                        <div style={{fontSize:13,fontWeight:700,color:C.text}}>{cat}</div>
                        <div style={{fontSize:14,fontWeight:800,color:C.danger,marginTop:2}}>{formatKES(catTotal)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ══ PATIENT DEBTS ════════════════════════════════════════════ */}
        {activeTab==='debts' && (
          <div style={s.card}>
            <div style={s.cardHeader}>Patient Debts — Outstanding & Partial</div>
            <div style={s.cardBody}>
              {patientDebtGroups.length === 0 ? (
                <div style={s.empty}><div style={{fontSize:16,fontWeight:700,color:C.sub}}>No outstanding debts</div></div>
              ) : patientDebtGroups.map(grp => (
                <div key={grp.patient_id} style={{border:`1px solid ${grp.hasOverdue?C.danger:C.border}`,borderRadius:12,marginBottom:12,overflow:'hidden'}}>
                  <div style={{background:C.surface,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,borderBottom:`1px solid ${C.border}`}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:14,color:C.text}}>
                        {grp.name}
                        {grp.hasOverdue && <span style={{marginLeft:8,fontSize:11,background:C.dangerL,color:C.danger,borderRadius:4,padding:'2px 6px',fontWeight:700}}>OVERDUE</span>}
                      </div>
                      <div style={{fontSize:12,color:C.sub}}>{grp.phone} · {grp.records.length} record{grp.records.length!==1?'s':''}</div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div style={{fontWeight:800,fontSize:16,color:C.danger}}>{formatKES(grp.total)}</div>
                      <button style={s.smsBtn} onClick={()=>window.notifyFromLegacyAlert(`SMS reminder sent to ${grp.phone}`)}>Send SMS</button>
                      <button style={s.viewBtn} onClick={()=>setShowDetail(grp)}>View all</button>
                    </div>
                  </div>
                  {grp.records.map(r => {
                    const sc = STATUS_COLORS[r.status]
                    const isOverdue = r.due_date && new Date(r.due_date) < new Date()
                    return (
                      <div key={r.id} style={{padding:'10px 16px',borderTop:`1px solid #f5f5f5`,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:600,color:C.text}}>{r.description}</div>
                          <div style={{fontSize:11,color:isOverdue?C.danger:C.sub,marginTop:2}}>
                            {r.category} · {new Date(r.created_at).toLocaleDateString('en-KE')}
                            {r.due_date && ` · Due: ${new Date(r.due_date).toLocaleDateString('en-KE')}`}
                            {isOverdue && ' Overdue'}
                          </div>
                        </div>
                        <div style={{textAlign:'right',flexShrink:0}}>
                          <div style={{fontSize:12,color:C.sub}}>Charged: {formatKES(r.amount_charged)}</div>
                          <div style={{fontSize:12,color:C.primary}}>Paid: {formatKES(r.amount_paid)}</div>
                          <div style={{fontSize:13,fontWeight:700,color:C.danger}}>Bal: {formatKES(r.balance)}</div>
                        </div>
                        <span style={{...s.pill,...sc}}>{r.status}</span>
                        <div style={{display:'flex',gap:6}}>
                          <button style={s.payBtn} onClick={()=>{setShowPayment(r);setPayForm({amount_paid:parseFloat(r.balance).toString(),payment_method:'Cash',mpesa_ref:'',notes:''})}}>
                            Pay
                          </button>
                          <button style={s.editBtn} onClick={()=>openRecordForm(r)}>Edit</button>
                          {isAdmin && (
                            <button style={s.woffBtn} onClick={()=>{setShowWriteoff(r);setWriteoffForm({reason:'',authorized_by:''})}}>
                              Write-off
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ CREDITS ══════════════════════════════════════════════════ */}
        {activeTab==='credits' && (
          <div style={s.card}>
            <div style={s.cardHeader}>Patient Credits — Deposits & Overpayments</div>
            <div style={s.cardBody}>
              {filterRecords(credits.filter(r=>r.status!=='Paid')).length === 0 ? (
                <div style={s.empty}><div style={{fontSize:16,fontWeight:700,color:C.sub}}>No active credits</div></div>
              ) : (
                <table style={s.table}>
                  <thead>
                    <tr style={{background:'#FAFBFD'}}>
                      {['Patient','Category','Description','Credit Amount','Used','Balance','Status','Actions'].map(h=>(
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filterRecords(credits.filter(r=>r.status!=='Paid')).map(r=>{
                      const sc = STATUS_COLORS[r.status]
                      return (
                        <tr key={r.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                          <td style={s.td}><div style={{fontWeight:600}}>{r.patients?.full_name}</div><div style={{fontSize:11,color:C.sub}}>{r.patients?.phone}</div></td>
                          <td style={s.td}>{r.category}</td>
                          <td style={s.td}>{r.description}</td>
                          <td style={s.td}><span style={{color:C.primary,fontWeight:700}}>{formatKES(r.amount_charged)}</span></td>
                          <td style={s.td}>{formatKES(r.amount_paid)}</td>
                          <td style={s.td}><span style={{color:C.primary,fontWeight:700}}>{formatKES(r.balance)}</span></td>
                          <td style={s.td}><span style={{...s.pill,...sc}}>{r.status}</span></td>
                          <td style={s.td}>
                            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                              <button style={s.payBtn} onClick={()=>{setShowPayment(r);setPayForm({amount_paid:parseFloat(r.balance).toString(),payment_method:'Cash',mpesa_ref:'',notes:'Apply credit to bill'})}}>
                                Apply
                              </button>
                              <button style={s.editBtn} onClick={()=>openRecordForm(r)}>Edit</button>
                              {r.status !== 'Paid' && (
                                <button style={s.markPaidBtn} onClick={()=>markAsPaid(r)} disabled={saving}>Mark Paid</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ══ OVERDUE ═══════════════════════════════════════════════════ */}
        {activeTab==='overdue' && (
          <div style={s.card}>
            <div style={{...s.cardHeader,color:C.danger}}>Overdue Debts — Past Due Date</div>
            <div style={s.cardBody}>
              {filterRecords(overdue).length === 0 ? (
                <div style={s.empty}><div style={{fontSize:16,fontWeight:700,color:C.primary}}>No overdue debts ✓</div></div>
              ) : (
                <table style={s.table}>
                  <thead>
                    <tr style={{background:'#FFF1F1'}}>
                      {['Patient','Category','Description','Balance','Due Date','Days Overdue','Actions'].map(h=>(
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filterRecords(overdue).sort((a,b)=>new Date(a.due_date)-new Date(b.due_date)).map(r=>{
                      const daysOver = Math.floor((Date.now() - new Date(r.due_date)) / 86400000)
                      return (
                        <tr key={r.id} style={{borderBottom:'1px solid #f5f5f5',background:daysOver>60?'#FFF5F5':''}}>
                          <td style={s.td}><div style={{fontWeight:600}}>{r.patients?.full_name}</div><div style={{fontSize:11,color:C.sub}}>{r.patients?.phone}</div></td>
                          <td style={s.td}>{r.category}</td>
                          <td style={s.td}><span style={{fontSize:12}}>{r.description?.slice(0,40)}</span></td>
                          <td style={s.td}><span style={{fontWeight:700,color:C.danger}}>{formatKES(r.balance)}</span></td>
                          <td style={s.td}><span style={{color:C.danger}}>{new Date(r.due_date).toLocaleDateString('en-KE')}</span></td>
                          <td style={s.td}><span style={{fontWeight:700,color:daysOver>60?C.danger:C.warn}}>{daysOver} days</span></td>
                          <td style={s.td}>
                            <div style={{display:'flex',gap:6}}>
                              <button style={s.payBtn} onClick={()=>{setShowPayment(r);setPayForm({amount_paid:parseFloat(r.balance).toString(),payment_method:'Cash',mpesa_ref:'',notes:''})}}>Pay</button>
                              <button style={s.smsBtn} onClick={()=>window.notifyFromLegacyAlert(`SMS reminder sent to ${r.patients?.phone}`)}>Send SMS</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ══ AGING REPORT ══════════════════════════════════════════════ */}
        {activeTab==='aging' && (
          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
              {[
                { label:'Current (Not Yet Due)', val:aging.current,   color:C.primary, bg:C.primaryL },
                { label:'1–30 Days Overdue',     val:aging.days30,    color:C.warn,    bg:C.warnL    },
                { label:'31–60 Days Overdue',    val:aging.days60,    color:'#B45309', bg:'#FFFBEB'  },
                { label:'60+ Days Overdue',      val:aging.days90plus,color:C.danger,  bg:C.dangerL  },
              ].map(a => (
                <div key={a.label} style={{background:a.bg,border:`1px solid ${a.color}22`,borderRadius:12,padding:'16px 18px'}}>
                  <div style={{fontSize:11,color:a.color,fontWeight:700,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:8}}>{a.label}</div>
                  <div style={{fontSize:22,fontWeight:800,color:a.color}}>{formatKES(a.val)}</div>
                  <div style={{fontSize:12,color:a.color,marginTop:4}}>
                    {pending.filter(r => {
                      const age = r.due_date ? Math.floor((Date.now()-new Date(r.due_date))/86400000) : 0
                      if (a.label.includes('Current')) return age <= 0
                      if (a.label.includes('1–30')) return age > 0 && age <= 30
                      if (a.label.includes('31–60')) return age > 30 && age <= 60
                      return age > 60
                    }).length} accounts
                  </div>
                </div>
              ))}
            </div>

            <div style={s.card}>
              <div style={s.cardHeader}>Aging Detail by Patient</div>
              <div style={s.cardBody}>
                <table style={s.table}>
                  <thead>
                    <tr style={{background:'#FAFBFD'}}>
                      {['Patient','Phone','Current','1-30 Days','31-60 Days','60+ Days','Total Balance'].map(h=>(
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(
                      pending.reduce((acc, r) => {
                        const id = r.patient_id
                        if (!acc[id]) acc[id] = { name:r.patients?.full_name||'Unknown', phone:r.patients?.phone||'', current:0, d30:0, d60:0, d90:0, total:0 }
                        const age = r.due_date ? Math.floor((Date.now()-new Date(r.due_date))/86400000) : 0
                        const bal = parseFloat(r.balance||0)
                        acc[id].total += bal
                        if (age <= 0) acc[id].current += bal
                        else if (age <= 30) acc[id].d30 += bal
                        else if (age <= 60) acc[id].d60 += bal
                        else acc[id].d90 += bal
                        return acc
                      }, {})
                    ).sort((a,b)=>b.total-a.total).map((p, i) => (
                      <tr key={i} style={{borderBottom:'1px solid #f5f5f5'}}>
                        <td style={s.td}><strong>{p.name}</strong></td>
                        <td style={s.td}><span style={{fontSize:12,color:C.sub}}>{p.phone}</span></td>
                        <td style={s.td}>{p.current > 0 ? <span style={{color:C.primary}}>{formatKES(p.current)}</span> : '—'}</td>
                        <td style={s.td}>{p.d30 > 0 ? <span style={{color:C.warn,fontWeight:600}}>{formatKES(p.d30)}</span> : '—'}</td>
                        <td style={s.td}>{p.d60 > 0 ? <span style={{color:'#B45309',fontWeight:700}}>{formatKES(p.d60)}</span> : '—'}</td>
                        <td style={s.td}>{p.d90 > 0 ? <span style={{color:C.danger,fontWeight:800}}>{formatKES(p.d90)}</span> : '—'}</td>
                        <td style={s.td}><strong style={{color:C.danger}}>{formatKES(p.total)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══ WRITE-OFFS ════════════════════════════════════════════════ */}
        {activeTab==='writeoffs' && (
          <div style={s.card}>
            <div style={s.cardHeader}>Write-offs & Waived Amounts</div>
            <div style={s.cardBody}>
              {filterRecords(records.filter(r=>r.status==='Waived')).length === 0 ? (
                <div style={s.empty}><div style={{fontSize:16,fontWeight:700,color:C.sub}}>No write-offs recorded</div></div>
              ) : (
                <table style={s.table}>
                  <thead>
                    <tr style={{background:'#FAFBFD'}}>
                      {['Patient','Category','Description','Amount Waived','Date','Notes'].map(h=>(
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filterRecords(records.filter(r=>r.status==='Waived')).map(r=>(
                      <tr key={r.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                        <td style={s.td}><div style={{fontWeight:600}}>{r.patients?.full_name}</div></td>
                        <td style={s.td}>{r.category}</td>
                        <td style={s.td}>{r.description}</td>
                        <td style={s.td}><span style={{color:C.sub,fontWeight:700,textDecoration:'line-through'}}>{formatKES(r.amount_charged)}</span></td>
                        <td style={s.td}>{r.paid_at ? new Date(r.paid_at).toLocaleDateString('en-KE') : '—'}</td>
                        <td style={s.td}><span style={{fontSize:12,color:C.sub}}>{r.notes||'—'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ══ ALL RECORDS ═══════════════════════════════════════════════ */}
        {activeTab==='all' && (
          <div style={s.card}>
            <div style={{...s.cardHeader,display:'flex',justifyContent:'space-between'}}>
              <span>All Records</span>
              <span style={{fontSize:12,color:C.sub,fontWeight:400}}>{filterRecords(records).length} records</span>
            </div>
            <div style={s.cardBody}>
              <table style={s.table}>
                <thead>
                  <tr style={{background:'#FAFBFD'}}>
                    {['Patient','Type','Category','Description','Charged','Paid','Balance','Method','Status','Date','Actions'].map(h=>(
                      <th key={h} style={s.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filterRecords(records).map(r => {
                    const sc = STATUS_COLORS[r.status] || STATUS_COLORS.Pending
                    return (
                      <tr key={r.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                        <td style={s.td}><div style={{fontWeight:600,fontSize:13}}>{r.patients?.full_name||'—'}</div><div style={{fontSize:11,color:C.sub}}>{r.patients?.phone}</div></td>
                        <td style={s.td}><span style={{fontWeight:600,color:r.type==='Credit'?C.primary:C.danger}}>{r.type}</span></td>
                        <td style={s.td}>{r.category}</td>
                        <td style={s.td}><span style={{fontSize:12}}>{r.description?.slice(0,35)}{r.description?.length>35?'...':''}</span></td>
                        <td style={s.td}>{formatKES(r.amount_charged)}</td>
                        <td style={s.td}>{formatKES(r.amount_paid)}</td>
                        <td style={s.td}><span style={{fontWeight:700,color:r.type==='Credit'?C.primary:C.danger}}>{formatKES(r.balance)}</span></td>
                        <td style={s.td}><span style={{fontSize:11,color:C.sub}}>{r.payment_method||'—'}</span></td>
                        <td style={s.td}><span style={{...s.pill,...sc}}>{r.status}</span></td>
                        <td style={s.td}><span style={{fontSize:11,color:C.sub}}>{new Date(r.created_at).toLocaleDateString('en-KE')}</span></td>
                        <td style={s.td}>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            {(r.status==='Pending'||r.status==='Partial') && (
                              <button style={s.payBtn} onClick={()=>{setShowPayment(r);setPayForm({amount_paid:parseFloat(r.balance).toString(),payment_method:'Cash',mpesa_ref:'',notes:''})}}>Pay</button>
                            )}
                            <button style={s.editBtn} onClick={()=>openRecordForm(r)}>Edit</button>
                            {r.status !== 'Paid' && r.status !== 'Waived' && (
                              <button style={s.markPaidBtn} onClick={()=>markAsPaid(r)} disabled={saving}>Mark Paid</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ══ ADD RECORD MODAL ════════════════════════════════════════════ */}
      {showAdd && (
        <div style={s.overlay} onClick={()=>setShowAdd(false)}>
          <div style={{...s.modal,maxWidth:580}} onClick={e=>e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>{editingRecord ? 'Edit Record' : '+ Add Credit / Debt Record'}</h2>
              <button style={s.closeBtn} onClick={()=>setShowAdd(false)}>✕</button>
            </div>
            <div style={s.modalBody}>
              {/* Type toggle */}
              <div style={{display:'flex',gap:8,marginBottom:16}}>
                {['Debt','Credit'].map(t=>(
                  <button key={t} style={{flex:1,padding:'10px',border:`2px solid ${form.type===t?(t==='Debt'?C.danger:C.primary):C.border}`,
                    borderRadius:8,background:form.type===t?(t==='Debt'?C.dangerL:C.primaryL):C.surface,
                    color:form.type===t?(t==='Debt'?C.danger:C.primary):C.sub,fontWeight:700,cursor:'pointer',fontSize:13}}
                    onClick={()=>setForm({...form,type:t})}>
                    {t==='Debt'?'Debt (Patient Owes)':'Credit (Advance/Overpayment)'}
                  </button>
                ))}
              </div>

              {/* Patient search */}
              <div style={{marginBottom:14}}>
                <label style={s.label}>Patient *</label>
                {selectedPat ? (
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:C.primaryL,borderRadius:8,padding:'10px 14px'}}>
                    <div>
                      <div style={{fontWeight:600,color:C.text}}>{selectedPat.full_name}</div>
                      <div style={{fontSize:12,color:C.sub}}>{selectedPat.phone}</div>
                    </div>
                    <button style={{background:'none',border:'none',cursor:'pointer',color:C.danger,fontWeight:700}}
                      onClick={()=>{setSelectedPat(null);setForm({...form,patient_id:'',visit_id:''});setPatientVisits([])}}>Change</button>
                  </div>
                ) : (
                  <div style={{position:'relative'}}>
                    <input style={s.input} placeholder="Search patient name or phone..."
                      value={patSearch} onChange={e=>{setPatSearch(e.target.value);searchPatients(e.target.value)}}/>
                    {patResults.length > 0 && (
                      <div style={{position:'absolute',top:'100%',left:0,right:0,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,zIndex:100,boxShadow:'0 8px 24px rgba(0,0,0,.12)',maxHeight:200,overflowY:'auto'}}>
                        {patResults.map(p=>(
                          <div key={p.id} style={{padding:'10px 14px',cursor:'pointer',borderBottom:'1px solid #f5f5f5',fontSize:13}}
                            onMouseDown={()=>{setSelectedPat(p);setForm({...form,patient_id:p.id});setPatSearch('');setPatResults([]);loadPatientVisits(p.id)}}>
                            <span style={{fontWeight:600}}>{p.full_name}</span> <span style={{color:C.sub,fontSize:12}}>{p.phone}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Visit link */}
              {patientVisits.length > 0 && (
                <div style={{marginBottom:14}}>
                  <label style={s.label}>Link to Visit (optional)</label>
                  <select style={s.input} value={form.visit_id} onChange={e=>setForm({...form,visit_id:e.target.value})}>
                    <option value="">-- No specific visit --</option>
                    {patientVisits.map(v=>(
                      <option key={v.id} value={v.id}>{v.visit_number} — {v.visit_type} — {new Date(v.created_at).toLocaleDateString('en-KE')} — {formatKES(v.admission_fee||0)}</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                <div style={{marginBottom:14}}>
                  <label style={s.label}>Category</label>
                  <select style={s.input} value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>
                    {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{marginBottom:14}}>
                  <label style={s.label}>Due Date</label>
                  <input style={s.input} type="date" value={form.due_date} onChange={e=>setForm({...form,due_date:e.target.value})}/>
                </div>
              </div>

              <div style={{marginBottom:14}}>
                <label style={s.label}>Description *</label>
                <input style={s.input} placeholder="e.g. FBC + Urinalysis unpaid, Patient advance deposit..."
                  value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                <div style={{marginBottom:14}}>
                  <label style={s.label}>Amount Charged (KES) *</label>
                  <input style={s.input} type="number" placeholder="0" value={form.amount_charged} onChange={e=>setForm({...form,amount_charged:e.target.value})}/>
                </div>
                <div style={{marginBottom:14}}>
                  <label style={s.label}>Amount Paid Now (KES)</label>
                  <input style={s.input} type="number" placeholder="0" value={form.amount_paid} onChange={e=>setForm({...form,amount_paid:e.target.value})}/>
                </div>
              </div>

              {parseFloat(form.amount_paid) > 0 && (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                  <div style={{marginBottom:14}}>
                    <label style={s.label}>Payment Method</label>
                    <select style={s.input} value={form.payment_method} onChange={e=>setForm({...form,payment_method:e.target.value})}>
                      {PAYMENT_METHODS.map(m=><option key={m}>{m}</option>)}
                    </select>
                  </div>
                  {form.payment_method==='M-Pesa' && (
                    <div style={{marginBottom:14}}>
                      <label style={s.label}>M-Pesa Ref</label>
                      <input style={s.input} placeholder="e.g. QBX4K..." value={form.mpesa_ref} onChange={e=>setForm({...form,mpesa_ref:e.target.value})}/>
                    </div>
                  )}
                </div>
              )}

              <div style={{marginBottom:14}}>
                <label style={s.label}>Notes</label>
                <input style={s.input} placeholder="Any additional notes..." value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/>
              </div>

              {/* Balance preview */}
              {form.amount_charged && (
                <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 14px',fontSize:13,display:'flex',justifyContent:'space-between'}}>
                  <span style={{color:C.sub}}>Balance after this record:</span>
                  <span style={{fontWeight:700,color:parseFloat(form.amount_charged||0)-parseFloat(form.amount_paid||0)>0?C.danger:C.primary}}>
                    {formatKES(parseFloat(form.amount_charged||0)-parseFloat(form.amount_paid||0))}
                  </span>
                </div>
              )}
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={()=>setShowAdd(false)}>Cancel</button>
              <button style={s.submitBtn} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editingRecord ? 'Save Changes' : '+ Add Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ RECORD PAYMENT MODAL ════════════════════════════════════════ */}
      {showPayment && (
        <div style={s.overlay} onClick={()=>setShowPayment(null)}>
          <div style={{...s.modal,maxWidth:460}} onClick={e=>e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>Record Payment</h2>
              <button style={s.closeBtn} onClick={()=>setShowPayment(null)}>✕</button>
            </div>
            <div style={s.modalBody}>
              <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'12px 14px',marginBottom:16,fontSize:13}}>
                <div style={{fontWeight:600,color:C.text,marginBottom:4}}>{showPayment.patients?.full_name}</div>
                <div style={{color:C.sub}}>{showPayment.description}</div>
                <div style={{display:'flex',justifyContent:'space-between',marginTop:8}}>
                  <span style={{color:C.sub}}>Total charged:</span>
                  <span style={{fontWeight:600}}>{formatKES(showPayment.amount_charged)}</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between'}}>
                  <span style={{color:C.sub}}>Already paid:</span>
                  <span style={{fontWeight:600,color:C.primary}}>{formatKES(showPayment.amount_paid)}</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',borderTop:`1px solid ${C.border}`,marginTop:6,paddingTop:6}}>
                  <span style={{color:C.danger,fontWeight:700}}>Outstanding:</span>
                  <span style={{fontWeight:800,color:C.danger}}>{formatKES(showPayment.balance)}</span>
                </div>
              </div>
              <div style={{marginBottom:14}}>
                <label style={s.label}>Amount Paying Now (KES) *</label>
                <input style={{...s.input,fontSize:18,fontWeight:700}} type="number"
                  value={payForm.amount_paid} onChange={e=>setPayForm({...payForm,amount_paid:e.target.value})}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
                <div>
                  <label style={s.label}>Payment Method</label>
                  <select style={s.input} value={payForm.payment_method} onChange={e=>setPayForm({...payForm,payment_method:e.target.value})}>
                    {PAYMENT_METHODS.map(m=><option key={m}>{m}</option>)}
                  </select>
                </div>
                {payForm.payment_method==='M-Pesa' && (
                  <div>
                    <label style={s.label}>M-Pesa Ref</label>
                    <input style={s.input} placeholder="e.g. QBX4K..." value={payForm.mpesa_ref} onChange={e=>setPayForm({...payForm,mpesa_ref:e.target.value})}/>
                  </div>
                )}
              </div>
              <div style={{marginBottom:14}}>
                <label style={s.label}>Notes</label>
                <input style={s.input} placeholder="Optional notes..." value={payForm.notes} onChange={e=>setPayForm({...payForm,notes:e.target.value})}/>
              </div>
              {payForm.amount_paid && (
                <div style={{background:parseFloat(payForm.amount_paid)>=parseFloat(showPayment.balance)?C.primaryL:C.warnL,
                  borderRadius:8,padding:'10px 14px',fontSize:13,color:C.text}}>
                  {parseFloat(payForm.amount_paid) >= parseFloat(showPayment.balance)
                    ? 'This payment will fully clear the balance.'
                    : `${formatKES(parseFloat(showPayment.balance)-parseFloat(payForm.amount_paid))} will remain outstanding.`}
                </div>
              )}
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={()=>setShowPayment(null)}>Cancel</button>
              <button style={s.submitBtn} onClick={handleRecordPayment} disabled={saving}>
                {saving ? 'Saving...' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ WRITE-OFF MODAL ═════════════════════════════════════════════ */}
      {showWriteoff && (
        <div style={s.overlay} onClick={()=>setShowWriteoff(null)}>
          <div style={{...s.modal,maxWidth:440}} onClick={e=>e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>Write Off Debt</h2>
              <button style={s.closeBtn} onClick={()=>setShowWriteoff(null)}>✕</button>
            </div>
            <div style={s.modalBody}>
              <div style={{background:C.dangerL,borderRadius:8,padding:'10px 14px',fontSize:13,color:C.danger,marginBottom:16}}>
                Writing off <strong>{formatKES(showWriteoff.balance)}</strong> for <strong>{showWriteoff.patients?.full_name}</strong>. Admin authorization required.
              </div>
              <div style={{marginBottom:14}}>
                <label style={s.label}>Reason for Write-off</label>
                <textarea style={{...s.input,height:80,resize:'vertical'}} placeholder="e.g. Patient deceased, financial hardship waiver, billing error..."
                  value={writeoffForm.reason} onChange={e=>setWriteoffForm({...writeoffForm,reason:e.target.value})}/>
              </div>
              <div style={{marginBottom:14}}>
                <label style={s.label}>Authorized By (Name) *</label>
                <input style={s.input} placeholder="Admin / Medical Director name"
                  value={writeoffForm.authorized_by} onChange={e=>setWriteoffForm({...writeoffForm,authorized_by:e.target.value})}/>
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={()=>setShowWriteoff(null)}>Cancel</button>
              <button style={{...s.submitBtn,background:C.danger}} onClick={handleWriteoff} disabled={saving}>
                {saving?'Processing...':'Confirm Write-off'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ PATIENT DETAIL MODAL ════════════════════════════════════════ */}
      {showDetail && (
        <div style={s.overlay} onClick={()=>setShowDetail(null)}>
          <div style={{...s.modal,maxWidth:600}} onClick={e=>e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitle}>{showDetail.name} — Full Debt History</h2>
                <p style={{margin:'4px 0 0',fontSize:13,color:C.sub}}>{showDetail.phone} · Total outstanding: {formatKES(showDetail.total)}</p>
              </div>
              <button style={s.closeBtn} onClick={()=>setShowDetail(null)}>✕</button>
            </div>
            <div style={s.modalBody}>
              {showDetail.records.map(r=>{
                const sc = STATUS_COLORS[r.status]
                return (
                  <div key={r.id} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:'12px 14px',marginBottom:10}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:13,color:C.text}}>{r.description}</div>
                        <div style={{fontSize:11,color:C.sub,marginTop:3}}>
                          {r.category} · {new Date(r.created_at).toLocaleDateString('en-KE')}
                          {r.due_date && ` · Due: ${new Date(r.due_date).toLocaleDateString('en-KE')}`}
                        </div>
                      </div>
                      <span style={{...s.pill,...sc}}>{r.status}</span>
                    </div>
                    <div style={{display:'flex',gap:16,marginTop:10,fontSize:12}}>
                      <span style={{color:C.sub}}>Charged: <strong>{formatKES(r.amount_charged)}</strong></span>
                      <span style={{color:C.primary}}>Paid: <strong>{formatKES(r.amount_paid)}</strong></span>
                      <span style={{color:C.danger}}>Balance: <strong>{formatKES(r.balance)}</strong></span>
                    </div>
                    {r.notes && <div style={{fontSize:11,color:C.sub,marginTop:6,fontStyle:'italic'}}>{r.notes}</div>}
                    <div style={{marginTop:8,display:'flex',gap:6}}>
                      <button style={s.payBtn} onClick={()=>{setShowDetail(null);setShowPayment(r);setPayForm({amount_paid:parseFloat(r.balance).toString(),payment_method:'Cash',mpesa_ref:'',notes:''})}}>Pay</button>
                      {isAdmin && <button style={s.woffBtn} onClick={()=>{setShowDetail(null);setShowWriteoff(r);setWriteoffForm({reason:'',authorized_by:''})}}>Write-off</button>}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={()=>setShowDetail(null)}>Close</button>
              <button style={s.smsBtn} onClick={()=>window.notifyFromLegacyAlert(`SMS reminder sent to ${showDetail.phone}`)}>Send SMS Reminder</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  page:       { minHeight:'100vh', background:C.bg, fontFamily:typography.fontFamily, fontSize:'13px', color:C.text, padding:'20px 24px', boxSizing:'border-box' },
  loadWrap:   { height:'80vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' },
  spinner:    { width:36, height:36, border:'3px solid #E8ECF2', borderTop:`3px solid ${C.primary}`, borderRadius:'50%', animation:'spin 0.9s linear infinite' },
  header:     { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10 },
  title:      { fontSize:26, fontWeight:800, margin:0, color:C.text },
  subtitle:   { color:C.sub, margin:'4px 0 0', fontSize:13 },
  primaryBtn: { background:C.primary, color:'#fff', border:'none', padding:'10px 20px', borderRadius:8, fontWeight:600, cursor:'pointer', fontSize:14 },
  ghostBtn:   { background:C.surface, color:C.text, border:`1px solid ${C.border}`, padding:'10px 20px', borderRadius:8, fontWeight:600, cursor:'pointer', fontSize:14 },
  tabRow:     { display:'flex', gap:6, marginBottom:16, flexWrap:'wrap', background:C.surface, padding:'10px 12px', borderRadius:12, border:`1px solid ${C.border}` },
  tab:        { padding:'8px 14px', border:'1px solid transparent', borderRadius:8, background:'none', cursor:'pointer', fontSize:13, color:C.sub, fontWeight:500 },
  tabActive:  { background:C.primary, color:'#fff', fontWeight:600 },
  statsRow:   { display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' },
  statCard:   { borderRadius:12, padding:'14px 18px', minWidth:140, flex:1, textAlign:'center', background:C.surface, border:`1px solid ${C.border}` },
  card:       { background:C.surface, borderRadius:14, border:`1px solid ${C.border}`, overflow:'hidden', boxShadow:'none' },
  cardHeader: { padding:'14px 20px', fontWeight:700, fontSize:14, color:C.text, borderBottom:`1px solid ${C.border}`, background:C.surface },
  cardBody:   { padding:'16px 20px' },
  table:      { width:'100%', borderCollapse:'collapse' },
  th:         { fontSize:11, color:C.sub, fontWeight:600, textAlign:'left', padding:'10px 14px', borderBottom:`2px solid ${C.border}`, textTransform:'uppercase', letterSpacing:.4, whiteSpace:'nowrap' },
  td:         { fontSize:13, color:C.text, padding:'10px 14px', verticalAlign:'middle' },
  pill:       { fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:99, display:'inline-block' },
  payBtn:     { fontSize:12, padding:'6px 12px', border:'none', borderRadius:6, background:C.primary, cursor:'pointer', color:'#FFFFFF', fontWeight:600 },
  woffBtn:    { fontSize:12, padding:'6px 12px', border:`1px solid ${C.border}`, borderRadius:6, background:C.surface, cursor:'pointer', color:C.sub, fontWeight:600 },
  editBtn:    { fontSize:12, padding:'6px 12px', border:`1px solid ${C.border}`, borderRadius:6, background:C.surface, cursor:'pointer', color:C.primary, fontWeight:600 },
  markPaidBtn:{ fontSize:12, padding:'6px 12px', border:'none', borderRadius:6, background:C.primary, cursor:'pointer', color:'#FFFFFF', fontWeight:600 },
  smsBtn:     { fontSize:12, padding:'6px 12px', border:`1px solid ${C.border}`, borderRadius:6, background:'#F1F5F9', cursor:'pointer', color:C.primary, fontWeight:600 },
  viewBtn:    { fontSize:12, padding:'6px 12px', border:`1px solid ${C.border}`, borderRadius:6, background:C.surface, cursor:'pointer', color:C.primary, fontWeight:600 },
  empty:      { textAlign:'center', padding:'40px 20px', color:'#999' },
  input:      { width:'100%', padding:'10px 12px', border:`1px solid ${C.border}`, borderRadius:8, fontSize:13, outline:'none', boxSizing:'border-box', background:'#fff', color:C.text, fontFamily:'inherit' },
  label:      { fontSize:12, color:C.sub, display:'block', marginBottom:5, fontWeight:500 },
  overlay:    { position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 },
  modal:      { background:C.surface, borderRadius:16, width:'100%', maxWidth:700, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,.12)', animation:'fadeIn .2s ease' },
  modalHeader:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'18px 24px', borderBottom:`1px solid ${C.border}` },
  modalTitle: { fontSize:17, fontWeight:700, margin:0, color:C.text },
  closeBtn:   { background:'none', border:'none', fontSize:18, cursor:'pointer', color:C.sub },
  modalBody:  { padding:'20px 24px', overflowY:'auto', flex:1 },
  modalFooter:{ padding:'14px 24px', borderTop:`1px solid ${C.border}`, display:'flex', justifyContent:'flex-end', gap:10 },
  cancelBtn:  { padding:'10px 20px', border:`1px solid ${C.border}`, borderRadius:8, background:C.surface, cursor:'pointer', fontSize:13, fontWeight:500, color:C.sub },
  submitBtn:  { padding:'10px 24px', border:'none', borderRadius:8, background:C.primary, color:'#fff', cursor:'pointer', fontSize:13, fontWeight:600 },
}
