import { useEffect, useState, useCallback } from 'react'
import SkeletonLoader from '../components/SkeletonLoader'
import supabase from '../supabase'
import { useHospital } from '../context'
import { executeWithFallback, omitKeys } from '../utils/dbCompat'
import { extractGeminiText, generateGeminiContent } from '../utils/geminiProxy'
import { broadcastWorkflowChanged } from '../utils/workflowEvents'
import { colors as C, typography } from '../theme'

/* ═══════════════════════════════════════════════════════════════════════════
 DESIGN TOKENS — matches MPesa / SHAClaims design system exactly
═══════════════════════════════════════════════════════════════════════════ */
const STATUS_COLORS = {
  Draft: { bg:'#F3F4F6', color:C.sub },
  Pending: { bg:C.warnL, color:C.warn },
  'Pre-auth': { bg:C.purpleL, color:C.purple },
  Submitted: { bg:C.blueL, color:C.blue },
  'Under Review': { bg:C.blueL, color:C.blue },
  Approved: { bg:C.primaryL, color:C.primary },
  Paid: { bg:C.primaryL, color:C.primary },
  Rejected: { bg:C.dangerL, color:C.danger },
  Appealed: { bg:'#FFF7ED', color:'#EA580C' },
  Lapsed: { bg:C.dangerL, color:C.danger },
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
  tabRow: { display:'flex', gap:'4px', marginBottom:'16px', background:C.surface, border:`1px solid ${C.border}`, borderRadius:'8px', padding:'6px', flexWrap:'wrap' },
  tab: { padding:'7px 16px', borderRadius:'6px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight:500, color:C.sub, background:'none', whiteSpace:'nowrap' },
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
  btnPurple: { background:C.purpleL, color:C.purple, border:'none' },
  card: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:'10px', overflow:'hidden', marginBottom:'16px' },
  cardHead: { padding:'12px 16px', borderBottom:`1px solid ${C.border}`, fontSize:'13px', fontWeight:600, color:C.text, background:'#FAFBFD', display:'flex', justifyContent:'space-between', alignItems:'center' },
  table: { width:'100%', borderCollapse:'collapse' },
  th: { padding:'9px 14px', textAlign:'left', fontSize:'11px', fontWeight:700, color:C.sub, textTransform:'uppercase', letterSpacing:'.5px', borderBottom:`2px solid ${C.border}`, background:'#FAFBFD', whiteSpace:'nowrap' },
  td: { padding:'11px 14px', borderBottom:`1px solid ${C.border}`, fontSize:'13px', verticalAlign:'middle' },
  badge: { display:'inline-block', padding:'2px 9px', borderRadius:'20px', fontSize:'11px', fontWeight:600 },
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:999, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' },
  modal: { background:C.surface, borderRadius:'12px', padding:'24px', width:'600px', maxWidth:'95vw', boxShadow:'0 20px 60px rgba(0,0,0,.2)', maxHeight:'92vh', overflowY:'auto' },
  modalWide: { background:C.surface, borderRadius:'12px', padding:'24px', width:'780px', maxWidth:'95vw', boxShadow:'0 20px 60px rgba(0,0,0,.2)', maxHeight:'92vh', overflowY:'auto' },
  modalH: { fontSize:'15px', fontWeight:700, marginBottom:'16px', color:C.text },
  lbl: { fontSize:'11px', fontWeight:600, color:C.sub, textTransform:'uppercase', letterSpacing:'.4px', marginBottom:'4px', display:'block' },
  input: { width:'100%', boxSizing:'border-box', padding:'9px 11px', border:`1px solid ${C.border}`, borderRadius:'7px', fontSize:'13px', color:C.text, outline:'none', background:C.surface, marginBottom:'12px' },
  grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' },
  grid3: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px' },
  divider: { border:'none', borderTop:`1px solid ${C.border}`, margin:'16px 0' },
  pill: { display:'inline-flex', alignItems:'center', gap:'4px', padding:'3px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:600 },
  aiBox: { background:'#F5F3FF', border:`1px solid #DDD6FE`, borderRadius:'8px', padding:'12px', marginBottom:'12px' },
  aiLabel: { fontSize:'10px', fontWeight:700, color:C.purple, textTransform:'uppercase', letterSpacing:'.6px', marginBottom:'6px' },
  infoRow: { display:'flex', justifyContent:'space-between', padding:'9px 0', borderBottom:`1px solid ${C.border}`, fontSize:'13px' },
}

/* ═══════════════════════════════════════════════════════════════════════════
 CONSTANTS
═══════════════════════════════════════════════════════════════════════════ */
const INSURERS = [
  'AAR Insurance','Jubilee Health Insurance','CIC Insurance','Britam Health',
  'Madison Insurance','Resolution Insurance','Sanlam Kenya','UAP Old Mutual',
  'Minet Kenya','GA Insurance','Heritage Insurance','ICEA LION',
  'Pacis Insurance','Pioneer Insurance','Other',
]

const SERVICES = [
  'Outpatient Consultation','Inpatient Admission','Surgical Procedure',
  'Laboratory Tests','Radiology / Imaging','Pharmacy / Drugs',
  'Maternity / Delivery','Physiotherapy','Dental','Eye / Optical',
  'Emergency Services','Mental Health','Chronic Disease','Annual Check-up',
]

// Common ICD-10 codes for Kenya hospitals — AI will suggest more
const COMMON_ICD10 = [
  { code:'J18.9', desc:'Pneumonia, unspecified' },
  { code:'A09', desc:'Diarrhoea and gastroenteritis' },
  { code:'B50.9', desc:'Malaria, unspecified' },
  { code:'J06.9', desc:'Acute upper respiratory infection' },
  { code:'K29.7', desc:'Gastritis, unspecified' },
  { code:'I10', desc:'Essential (primary) hypertension' },
  { code:'E11.9', desc:'Type 2 diabetes mellitus' },
  { code:'J45.9', desc:'Asthma, unspecified' },
  { code:'N39.0', desc:'Urinary tract infection' },
  { code:'Z34.9', desc:'Supervision of normal pregnancy' },
  { code:'O80', desc:'Normal delivery' },
  { code:'S09.9', desc:'Unspecified injury of head' },
  { code:'R50.9', desc:'Fever, unspecified' },
  { code:'A15.0', desc:'Tuberculosis of lung' },
  { code:'B24', desc:'HIV disease' },
]

const PAGE_SIZE = 100
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

const INSURER_RULES = {
  'AAR Insurance': { requiresICD10:true, requiresAuth:true, authWindowDays:30, outpatientCap:10000, note:'ICD-10 mandatory. Pre-auth for procedures >KES 5,000.' },
  'Jubilee Health Insurance':{ requiresICD10:true, requiresAuth:true, authWindowDays:45, outpatientCap:15000, note:'Referral letter required for specialist. Pre-auth >KES 10,000.' },
  'CIC Insurance': { requiresICD10:false, requiresAuth:false, authWindowDays:null, outpatientCap:5000, note:'No ICD-10 required. Outpatient capped at KES 5,000/visit.' },
  'Britam Health': { requiresICD10:true, requiresAuth:true, authWindowDays:60, outpatientCap:12000, note:'Pre-auth mandatory for all inpatient. ICD-10 required.' },
  'Madison Insurance': { requiresICD10:false, requiresAuth:true, authWindowDays:30, outpatientCap:8000, note:'Pre-auth for surgery. Outpatient limit KES 8,000.' },
  'Resolution Insurance': { requiresICD10:true, requiresAuth:false, authWindowDays:null, outpatientCap:7500, note:'ICD-10 required. No pre-auth for outpatient.' },
  'Sanlam Kenya': { requiresICD10:false, requiresAuth:true, authWindowDays:45, outpatientCap:10000, note:'Pre-auth for inpatient and surgery.' },
  'UAP Old Mutual': { requiresICD10:true, requiresAuth:true, authWindowDays:30, outpatientCap:10000, note:'ICD-10 and pre-auth required for all admissions.' },
  'Minet Kenya': { requiresICD10:false, requiresAuth:true, authWindowDays:60, outpatientCap:9000, note:'Pre-auth required. Broker-managed — allow extra 3 days.' },
  'ICEA LION': { requiresICD10:true, requiresAuth:true, authWindowDays:30, outpatientCap:8000, note:'Strict ICD-10 and auth. Rejections common for wrong codes.' },
  'Other': { requiresICD10:false, requiresAuth:false, authWindowDays:null, outpatientCap:null, note:'Verify requirements directly with insurer.' },
}

/* ═══════════════════════════════════════════════════════════════════════════
 HELPERS
═══════════════════════════════════════════════════════════════════════════ */
function Badge({ status }) {
  const sc = STATUS_COLORS[status] || { bg:'#F3F4F6', color:C.sub }
  return <span style={{...css.badge, background:sc.bg, color:sc.color}}>{status || '—'}</span>
}

function SourceBadge({ source }) {
  const colors = {
    Billing: { bg:C.blueL, color:C.blue },
    Manual: { bg:'#F3F4F6', color:C.sub },
    Lab: { bg:C.purpleL, color:C.purple },
    Pharmacy: { bg:C.primaryL, color:C.primary },
  }
  const sc = colors[source] || colors.Manual
  return <span style={{...css.badge, background:sc.bg, color:sc.color, fontSize:'10px'}}>{source || 'Manual'}</span>
}

function daysSince(ts) {
  if (!ts) return null
  return Math.floor((Date.now() - new Date(ts)) / 86400000)
}

function fmt(n) { return parseFloat(n||0).toLocaleString() }

function parseServicesField(services) {
  if (!services) return ''
  if (typeof services === 'string') {
    const trimmed = services.trim()
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          return parsed.map(item => {
            const drug = item.drug || item.drug_name || item.description || ''
            const qty = item.qty ?? item.quantity ?? item.qty_sold ?? ''
            return drug ? `${drug}${qty ? ` ×${qty}` : ''}` : ''
          }).filter(Boolean).join('; ')
        }
        if (parsed && typeof parsed === 'object') {
          return parsed.drug || parsed.service || JSON.stringify(parsed)
        }
      } catch {}
    }
    return trimmed
  }
  if (Array.isArray(services)) {
    return services.map(item => {
      const drug = item.drug || item.drug_name || item.description || ''
      const qty = item.qty ?? item.quantity ?? item.qty_sold ?? ''
      return drug ? `${drug}${qty ? ` ×${qty}` : ''}` : ''
    }).filter(Boolean).join('; ')
  }
  return String(services)
}

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
    invoice_ref: meta.invoice_ref || '',
    invoice_id: meta.invoice_id || null,
    patient_id: meta.patient_id || null,
    visit_id: meta.visit_id || null,
    notes: meta.notes || '',
  })
}

function genClaimNo() {
  return 'CLM-' + Date.now().toString(36).toUpperCase().slice(-6)
}

/* ═══════════════════════════════════════════════════════════════════════════
 AI ICD-10 SUGGEST (calls Claude API inline)
═══════════════════════════════════════════════════════════════════════════ */
async function aiSuggestICD10(symptoms) {
  try {
    const prompt = `You are a clinical coding assistant for a Kenyan hospital. Given this clinical description, suggest the 3 most appropriate ICD-10 codes. Return ONLY a JSON array, no markdown, no preamble. Format: [{"code":"X00.0","desc":"Description","confidence":"high|medium"}]\n\nClinical description: "${symptoms}"`

    const data = await generateGeminiContent({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 800,
        topP: 0.95,
        topK: 40
      }
    })

    const text = extractGeminiText(data) || '[]'
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return []
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 EXPORT HELPERS
═══════════════════════════════════════════════════════════════════════════ */
function exportCSV(rows, filename) {
  const headers = ['Claim No','Patient','Insurer','Member No','Service','ICD-10','Auth Code','Amount (KES)','Status','Submitted','Source']
  const lines = [headers.join(','), ...rows.map(r =>
    [r.claim_no||'',r.patient_name||'',r.insurer||'',r.member_no||'',r.service||'',
     r.icd10_code||'',r.auth_code||'',r.amount_kes||0,r.status||'',
     r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('en-KE') : '',
     r.source||'Manual'
    ].map(v => `"${v}"`).join(',')
  )]
  const a = document.createElement('a')
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\n'))
  a.download = filename
  a.click()
}

function exportInsurerPDF(rows, insurer) {
  // Generate a printable HTML claim sheet per insurer format
  const total = rows.reduce((s,r) => s+parseFloat(r.amount_kes||0),0)
  const html = `<!DOCTYPE html><html><head>
    <title>${insurer} Claims — ${new Date().toLocaleDateString('en-KE')}</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:12px;margin:20px;color:#111}
      h2{color:#16A34A;border-bottom:2px solid #16A34A;padding-bottom:8px}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th{background:#F4F6FB;padding:8px;text-align:left;border:1px solid #E8ECF2;font-size:11px;text-transform:uppercase}
      td{padding:8px;border:1px solid #E8ECF2;font-size:12px}
      .total{font-weight:bold;font-size:14px;text-align:right;margin-top:12px;color:#16A34A}
      .footer{margin-top:24px;font-size:10px;color:#6B7280}
    </style></head><body>
    <h2>${insurer} — Insurance Claims Statement</h2>
    <p>Generated: ${new Date().toLocaleString('en-KE')} &nbsp;|&nbsp; Total Claims: ${rows.length} &nbsp;|&nbsp; Total Amount: KES ${total.toLocaleString()}</p>
    <table>
      <thead><tr><th>#</th><th>Claim No</th><th>Patient</th><th>Member No</th><th>Service</th><th>ICD-10</th><th>Auth Code</th><th>Amount (KES)</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>${rows.map((r,i)=>`<tr>
        <td>${i+1}</td><td>${r.claim_no||'—'}</td><td>${r.patient_name||'—'}</td>
        <td>${r.member_no||'—'}</td><td>${r.service||'—'}</td>
        <td>${r.icd10_code||'—'}</td><td>${r.auth_code||'—'}</td>
        <td style="font-weight:bold">${parseFloat(r.amount_kes||0).toLocaleString()}</td>
        <td>${r.status||'—'}</td>
        <td>${r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('en-KE') : '—'}</td>
      </tr>`).join('')}</tbody>
    </table>
    <div class="total">TOTAL CLAIMED: KES ${total.toLocaleString()}</div>
    <div class="footer">This statement was generated by CliniqBot · Remedacare Hospital System</div>
  </body></html>`
  const w = window.open('','_blank')
  w.document.write(html)
  w.document.close()
  setTimeout(() => w.print(), 500)
}

/* ═══════════════════════════════════════════════════════════════════════════
 EMPTY FORM
═══════════════════════════════════════════════════════════════════════════ */
const emptyForm = {
  claim_no: '',
  patient_name: '',
  insurer: INSURERS[0],
  member_no: '',
  service: SERVICES[0],
  icd10_code: '',
  auth_code: '',
  amount_kes: '',
  status: 'Pending',
  source: 'Manual',
  patient_id: '',
  visit_id: '',
  invoice_id: '',
  invoice_ref: '',
  notes: '',
}

// Allowed statuses matching the DB check constraint
const ALLOWED_STATUSES = ['Draft','Pending','Pre-auth','Submitted','Under Review','Approved','Paid','Rejected','Appealed','Lapsed']

/* ═══════════════════════════════════════════════════════════════════════════
 MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function InsuranceClaims() {
  const { hospitalId, userRole } = useHospital()
  const isAdmin = ['Admin','admin'].includes(userRole || '')

  // Core state
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('claims')
  const [records, setRecords] = useState([])
  const [claimPage, setClaimPage] = useState(1)
  const [claimPageSize, setClaimPageSize] = useState(PAGE_SIZE)
  const [claimTotalCount, setClaimTotalCount] = useState(0)
  const [invoices, setInvoices] = useState([]) // billing invoices with insurer

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [insurerFilter, setInsurerFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('month')

  // Modals
  const [showAdd, setShowAdd] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [showPatientLedger, setShowPatientLedger] = useState(null)
  const [showPreAuthTracker, setShowPreAuthTracker] = useState(false)

  // Form
  const [form, setForm] = useState(emptyForm)
  const [f, sf] = [form, (patch) => setForm(p => ({...p,...patch}))]

  // AI ICD-10
  const [aiQuery, setAiQuery] = useState('')
  const [aiSuggestions, setAiSuggestions] = useState([])
  const [aiLoading, setAiLoading] = useState(false)
  const [icdSearch, setIcdSearch] = useState('')

  useEffect(() => { if (!hospitalId) { setLoading(false); return }; fetchAll() }, [hospitalId, claimPage, claimPageSize])

  /* ── Fetch ─────────────────────────────────────────────────────────────── */
  async function fetchAll() {
    setLoading(true)
    const start = (claimPage - 1) * claimPageSize
    const end = claimPage * claimPageSize - 1
    const [claimsRes, invRes] = await Promise.all([
      supabase.from('insurance_claims').select('*', { count: 'exact' })
        .eq('hospital_id', hospitalId)
        .order('submitted_at', { ascending:false })
        .range(start, end),
      supabase.from('invoices').select('*').eq('hospital_id', hospitalId)
        .not('insurer', 'is', null).neq('insurer', '')
        .order('created_at', { ascending:false })
    ])
    setRecords(claimsRes.data || [])
    setClaimTotalCount(claimsRes.count || 0)
    setInvoices(invRes.data || [])
    setLoading(false)
  }

  /* ── Save new claim ────────────────────────────────────────────────────── */
  async function handleSave() {
    if (!f.patient_name || !f.amount_kes || !f.insurer) {
      window.notifyFromLegacyAlert('Patient name, insurer, and amount are required')
      return
    }
    setSaving(true)
    const rule = INSURER_RULES[f.insurer] || {}
    if (rule.requiresICD10 && !f.icd10_code) {
      if (!await window.openConfirmDialog(`${f.insurer} requires an ICD-10 code. Save anyway?`)) {
        setSaving(false); return
      }
    }

    // ── STATUS SAFETY FIX: prevents DB check constraint violation ──
    const finalStatus = ALLOWED_STATUSES.includes(f.status) ? f.status : 'Pending'
    // ───────────────────────────────────────────────────────────────

    const payload = {
      hospital_id: hospitalId,
      claim_no: f.claim_no || genClaimNo(),
      patient_name: f.patient_name.trim(),
      patient_id: f.patient_id || null,
      visit_id: f.visit_id || null,
      invoice_id: f.invoice_id || null,
      insurer: f.insurer,
      member_no: f.member_no.trim(),
      service: f.service,
      icd10_code: f.icd10_code.trim().toUpperCase(),
      auth_code: f.auth_code.trim().toUpperCase(),
      amount_kes: parseFloat(f.amount_kes),
      status: finalStatus,
      submitted_at: new Date().toISOString(),
      notes: buildClaimNotes({
        source: f.source || 'Manual',
        invoice_ref: f.invoice_ref,
        invoice_id: f.invoice_id || null,
        patient_id: f.patient_id || null,
        visit_id: f.visit_id || null,
        notes: f.notes,
      }),
    }

    const { error } = await executeWithFallback(
      () => supabase.from('insurance_claims').insert(payload),
      async () => supabase.from('insurance_claims').insert(omitKeys(payload, ['patient_id', 'visit_id', 'invoice_id'])),
    )
    if (error) { window.notifyFromLegacyAlert('Error: ' + error.message); setSaving(false); return }
    setShowAdd(false)
    setForm(emptyForm)
    setAiSuggestions([])
    await fetchAll()
    setSaving(false)
    broadcastWorkflowChanged({ source: 'insurance-claim-create', claim_no: f.claim_no || null, patient_name: f.patient_name.trim() })
  }

  /* ── Import from billing ───────────────────────────────────────────────── */
  async function importFromBilling(inv) {
    setSaving(true)
    const existing = records.find(r => getInvoiceId(r) === inv.id || getInvoiceRef(r) === inv.invoice_no)
    if (existing) { window.notifyFromLegacyAlert('This invoice is already imported.'); setSaving(false); return }
    const payload = {
      hospital_id: hospitalId,
      claim_no: genClaimNo(),
      patient_name: inv.patient_name,
      patient_id: inv.patient_id || null,
      visit_id: inv.visit_id || null,
      invoice_id: inv.id || null,
      insurer: inv.insurer,
      member_no: inv.sha_member_no || '',
      service: parseServicesField(inv.services) || 'Pharmacy / Drugs',
      icd10_code: '',
      auth_code: '',
      amount_kes: parseFloat(inv.amount_kes || 0),
      status: 'Pending',
      submitted_at: new Date().toISOString(),
      notes: buildClaimNotes({
        source: 'Billing',
        invoice_ref: inv.invoice_no,
        invoice_id: inv.id || null,
        patient_id: inv.patient_id || null,
        visit_id: inv.visit_id || null,
        notes: inv.notes || '',
      }),
    }
    const { error } = await executeWithFallback(
      () => supabase.from('insurance_claims').insert(payload),
      async () => supabase.from('insurance_claims').insert(omitKeys(payload, ['patient_id', 'visit_id', 'invoice_id'])),
    )
    if (error) window.notifyFromLegacyAlert('Error: ' + error.message)
    await fetchAll()
    setSaving(false)
    if (!error) broadcastWorkflowChanged({ source: 'insurance-claim-import', invoice_no: inv.invoice_no })
  }

  /* ── Import all unimported billing invoices ────────────────────────────── */
  async function importAllBilling(unimported) {
    if (!isAdmin) {
      window.notifyFromLegacyAlert('Only Admin users can import billing invoices into insurance claims.')
      return
    }
    setSaving(true)
    const inserts = unimported.map(inv => ({
      hospital_id: hospitalId,
      claim_no: genClaimNo(),
      patient_name: inv.patient_name,
      patient_id: inv.patient_id || null,
      visit_id: inv.visit_id || null,
      invoice_id: inv.id || null,
      insurer: inv.insurer,
      member_no: inv.sha_member_no || '',
      service: parseServicesField(inv.services) || 'Pharmacy / Drugs',
      icd10_code: '',
      auth_code: '',
      amount_kes: parseFloat(inv.amount_kes || 0),
      status: 'Pending',
      submitted_at: new Date().toISOString(),
      notes: buildClaimNotes({
        source: 'Billing',
        invoice_ref: inv.invoice_no,
        invoice_id: inv.id || null,
        patient_id: inv.patient_id || null,
        visit_id: inv.visit_id || null,
      }),
    }))
    const fallbackInserts = inserts.map(payload => omitKeys(payload, ['patient_id', 'visit_id', 'invoice_id']))
    const { error } = await executeWithFallback(
      () => supabase.from('insurance_claims').insert(inserts),
      async () => supabase.from('insurance_claims').insert(fallbackInserts),
    )
    if (error) window.notifyFromLegacyAlert('Error: ' + error.message)
    await fetchAll()
    setSaving(false)
    if (!error) broadcastWorkflowChanged({ source: 'insurance-claim-import-all', count: inserts.length })
  }

  /* ── Status update ─────────────────────────────────────────────────────── */
  async function updateStatus(id, status) {
    if (!isAdmin && ['Approved','Paid','Rejected'].includes(status)) {
      window.notifyFromLegacyAlert('Only Admin users can approve, pay, or reject insurance claims.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('insurance_claims').update({ status }).eq('id', id)
    if (error) {
      window.notifyFromLegacyAlert('Error updating claim: ' + error.message)
      setSaving(false)
      return
    }
    const claim = records.find(r => r.id === id) || showDetail
    if (claim && status === 'Paid') {
      const invoiceId = getInvoiceId(claim)
      const invoiceRef = getInvoiceRef(claim)
      if (invoiceId || invoiceRef) {
        let invoiceQuery = supabase.from('invoices')
          .update({ status: 'Paid', paid_kes: claim.amount_kes || 0, balance_kes: 0, paid_at: new Date().toISOString() })
          .eq('hospital_id', hospitalId)
        invoiceQuery = invoiceId ? invoiceQuery.eq('id', invoiceId) : invoiceQuery.eq('invoice_no', invoiceRef)
        const { error: invError } = await invoiceQuery
        if (invError) {
          window.notifyFromLegacyAlert('Warning: claim updated, but billing invoice sync failed: ' + invError.message)
        }
      }
    }
    if (showDetail?.id === id) setShowDetail(p => ({...p, status}))
    await fetchAll()
    setSaving(false)
    broadcastWorkflowChanged({ source: 'insurance-claim-status', id, status })
  }

  /* ── AI ICD-10 suggest ─────────────────────────────────────────────────── */
  async function handleAISuggest() {
    if (!aiQuery.trim()) return
    setAiLoading(true)
    setAiSuggestions([])
    const suggestions = await aiSuggestICD10(aiQuery)
    setAiSuggestions(suggestions)
    setAiLoading(false)
  }

  /* ── Date range helper ─────────────────────────────────────────────────── */
  function getDateRange(range) {
    const now = new Date(); const start = new Date()
    if (range === 'today') start.setHours(0,0,0,0)
    else if (range === 'week') start.setDate(now.getDate()-7)
    else if (range === 'month') start.setDate(now.getDate()-30)
    else start.setFullYear(2000)
    return start.toISOString()
  }

  /* ── Source helper ─────────────────────────────────────────────────────── */
  function getSource(r) {
    const meta = parseClaimNotes(r.notes)
    if (meta.source) return meta.source
    return String(r.notes || '').includes('Imported from Billing') ? 'Billing' : 'Manual'
  }
  function getInvoiceRef(r) {
    const meta = parseClaimNotes(r.notes)
    return meta.invoice_ref || r.invoice_ref || String(r.notes || '').match(/Invoice (INV-\d+)/)?.[1] || ''
  }
  function getInvoiceId(r) {
    return r.invoice_id || parseClaimNotes(r.notes).invoice_id || ''
  }
  function getPatientId(r) {
    return r.patient_id || parseClaimNotes(r.notes).patient_id || ''
  }
  function getVisitId(r) {
    return r.visit_id || parseClaimNotes(r.notes).visit_id || ''
  }

  /* ── Filtering ─────────────────────────────────────────────────────────── */
  const since = getDateRange(dateFilter)
  const filtered = records.filter(r => {
    const matchDate = dateFilter === 'all' || new Date(r.submitted_at) >= new Date(since)
    const matchStatus = statusFilter === 'all' || r.status === statusFilter
    const matchInsurer = insurerFilter === 'all' || r.insurer === insurerFilter
    const matchSearch = !search ||
      r.patient_name?.toLowerCase().includes(search.toLowerCase()) ||
      r.claim_no?.toLowerCase().includes(search.toLowerCase()) ||
      r.member_no?.toLowerCase().includes(search.toLowerCase()) ||
      r.insurer?.toLowerCase().includes(search.toLowerCase()) ||
      r.icd10_code?.toLowerCase().includes(search.toLowerCase())
    return matchDate && matchStatus && matchInsurer && matchSearch
  })

  const insurerOptions = [...new Set([...INSURERS, ...records.map(r => r.insurer).filter(Boolean)])]

  /* ── Stats ─────────────────────────────────────────────────────────────── */
  const totalAmt = records.reduce((s,r) => s+parseFloat(r.amount_kes||0), 0)
  const approved = records.filter(r => ['Approved','Paid'].includes(r.status))
  const approvedAmt= approved.reduce((s,r) => s+parseFloat(r.amount_kes||0), 0)
  const pending = records.filter(r => ['Pending','Draft','Pre-auth','Submitted','Under Review'].includes(r.status))
  const pendingAmt = pending.reduce((s,r) => s+parseFloat(r.amount_kes||0), 0)
  const rejected = records.filter(r => r.status === 'Rejected')
  const preAuths = records.filter(r => r.status === 'Pre-auth' && r.auth_code)

  const monthRecs = records.filter(r => {
    const d = new Date(r.submitted_at); const now = new Date()
    return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear()
  })
  const monthAmt = monthRecs.reduce((s,r) => s+parseFloat(r.amount_kes||0), 0)

  /* ── Insurer breakdown ─────────────────────────────────────────────────── */
  const insurerMap = {}
  records.forEach(r => {
    const k = r.insurer || 'Unknown'
    if (!insurerMap[k]) insurerMap[k] = { count:0, total:0, approved:0, paid:0, rejected:0, pending:0 }
    insurerMap[k].count++
    insurerMap[k].total += parseFloat(r.amount_kes||0)
    if (r.status==='Approved') insurerMap[k].approved++
    if (r.status==='Paid') insurerMap[k].paid++
    if (r.status==='Rejected') insurerMap[k].rejected++
    if (['Pending','Draft','Submitted','Under Review','Pre-auth'].includes(r.status)) insurerMap[k].pending++
  })
  const insurerBreakdown = Object.entries(insurerMap)
    .map(([name,v]) => ({ name, ...v }))
    .sort((a,b) => b.total - a.total)

  /* ── Patient ledger ─────────────────────────────────────────────────────── */
  function buildPatientLedger(name) {
    const patientClaims = records.filter(r => r.patient_name?.toLowerCase() === name?.toLowerCase())
    return patientClaims
  }

  /* ── Billing invoices not yet imported ─────────────────────────────────── */
  const importedInvoiceKeys = new Set(
    records.flatMap(r => [getInvoiceId(r), getInvoiceRef(r)]).filter(Boolean)
  )
  const unimportedInvoices = invoices.filter(inv => !importedInvoiceKeys.has(inv.id) && !importedInvoiceKeys.has(inv.invoice_no))

  /* ── Active insurers for filter dropdown ───────────────────────────────── */
  const activeInsurers = [...new Set(records.map(r => r.insurer).filter(Boolean))]

  /* ── ICD-10 local search ───────────────────────────────────────────────── */
  const icdResults = COMMON_ICD10.filter(i =>
    i.code.toLowerCase().includes(icdSearch.toLowerCase()) ||
    i.desc.toLowerCase().includes(icdSearch.toLowerCase())
  )

  if (loading) return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'80vh',background:C.bg}}>
      <div style={{width:'220px'}}>
        <SkeletonLoader rows={3} height={14} width={['48%','100%','66%']} />
      </div>
      <p style={{color:C.sub,marginTop:12,fontSize:'13px'}}>Loading insurance claims...</p>
    </div>
  )

  /* ═══════════════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div style={css.page}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        tr:hover td{background:#FAFBFD}
        .ai-pulse{animation:pulse 1.4s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
      `}</style>
      <div style={css.wrap}>

        {/* ── HEADER ──────────────────────────────────────────────────────── */}
        <div style={css.header}>
          <div>
            <h1 style={css.h1}>Insurance Claims</h1>
          </div>
          <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
            <button style={{...css.btn,...css.btnPurple}} onClick={() => setShowPreAuthTracker(true)}>
              🔐 Pre-Auth Tracker {preAuths.length > 0 && <span style={{background:C.purple,color:'#fff',borderRadius:'10px',padding:'1px 6px',fontSize:'10px',marginLeft:'4px'}}>{preAuths.length}</span>}
            </button>
            <button style={{...css.btn,...css.btnGhost}} onClick={() => exportCSV(filtered, `insurance_claims_${insurerFilter!=='all'?insurerFilter.replace(/ /g,'_'):'all'}_${new Date().toISOString().slice(0,10)}.csv`)} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>
              ↓ Export CSV
            </button>
            <button style={{...css.btn,...css.btnPri}} onClick={() => { setForm(emptyForm); setAiSuggestions([]); setAiQuery(''); setShowAdd(true) }}>
              + New Claim
            </button>
          </div>
        </div>
        <div style={css.subtext}>
          This month: KES {monthAmt.toLocaleString()} across {monthRecs.length} claims · {activeInsurers.length} insurer{activeInsurers.length!==1?'s':''} active
          {unimportedInvoices.length > 0 ? <span style={{color:C.warn,fontWeight:600}}> · {unimportedInvoices.length} pending auto-post</span> : <span style={{color:C.primary,fontWeight:600}}> · All billing invoices auto-posted ✓</span>}
        </div>

        {/* ── STATS ──────────────────────────────────────────────────────── */}
        <div style={css.statsRow}>
          {[
            { label:'Total Claimed', value:`KES ${fmt(totalAmt)}`, sub:`${records.length} claims all time`, color:C.text },
            { label:'Approved / Paid', value:`KES ${fmt(approvedAmt)}`, sub:`${approved.length} claims`, color:C.primary },
            { label:'Pending / In Review', value:`KES ${fmt(pendingAmt)}`, sub:`${pending.length} awaiting action`, color:C.warn },
            { label:'Rejected', value:`${rejected.length}`, sub:`KES ${fmt(rejected.reduce((s,r)=>s+parseFloat(r.amount_kes||0),0))} at risk`, color:rejected.length>0?C.danger:C.muted },
            { label:'This Month', value:`KES ${fmt(monthAmt)}`, sub:`${monthRecs.length} submitted`, color:C.blue },
          ].map(st => (
            <div key={st.label} style={css.stat}>
              <div style={css.statLbl}>{st.label}</div>
              <div style={{...css.statVal, color:st.color}}>{st.value}</div>
              <div style={css.statSub}>{st.sub}</div>
            </div>
          ))}
        </div>

        {/* ── TABS ───────────────────────────────────────────────────────── */}
        <div style={css.tabRow}>
          {[
            { key:'claims', label:'All Claims' },
            { key:'billing', label:`From Billing${unimportedInvoices.length>0?` (${unimportedInvoices.length} new)`:''}` },
            { key:'pending', label:`Pending${pending.length>0?` (${pending.length})`:''}` },
            { key:'rejected', label:`Rejected${rejected.length>0?` (${rejected.length})`:''}` },
            { key:'insurers', label:'By Insurer' },
            { key:'ledger', label:'Patient Ledger' },
          ].map(t => (
            <button key={t.key}
              style={{...css.tab,...(activeTab===t.key?css.tabActive:{})}}
              onClick={() => setActiveTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            TAB: ALL CLAIMS
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'claims' && (<>
          <div style={css.toolbar}>
            <div style={css.searchWrap}>
              <span style={css.searchIcon}></span>
              <input style={css.searchInp} placeholder="Search patient, claim no, member no, ICD-10..."
                value={search} onChange={e => setSearch(e.target.value)}/>
            </div>
            <select style={css.select} value={insurerFilter} onChange={e => setInsurerFilter(e.target.value)}>
              <option value="all">All Insurers</option>
              {insurerOptions.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
            <select style={css.select} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select style={css.select} value={dateFilter} onChange={e => setDateFilter(e.target.value)}>
              <option value="today">Today</option>
              <option value="week">Last 7 days</option>
              <option value="month">Last 30 days</option>
              <option value="all">All time</option>
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
            <button style={{...css.btn,...css.btnGhost}} onClick={() => exportCSV(filtered, `insurance_claims_${insurerFilter!=='all'?insurerFilter.replace(/\s+/g,'_'):'all'}_${new Date().toISOString().slice(0,10)}.csv`)} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>
              ↓ Export {insurerFilter !== 'all' ? insurerFilter : 'Filtered Claims'}
            </button>
            {insurerFilter !== 'all' && (
              <button style={{...css.btn,background:'#F5F3FF',color:C.purple,border:'none'}}
                onClick={() => exportInsurerPDF(filtered, insurerFilter)}
                disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>
                📄 Export {insurerFilter}
              </button>
            )}
          </div>
          <div style={css.card}>
            <div style={css.cardHead}>
              <span>Insurance Claims — {filtered.length} record{filtered.length!==1?'s':''}</span>
              <span style={{fontSize:'12px',color:C.sub}}>
                Showing page {claimPage} of {Math.max(1, Math.ceil(claimTotalCount / claimPageSize))} ({claimTotalCount} total)
              </span>
            </div>
            <table style={css.table}>
              <thead>
                <tr>
                  {['Claim No','Patient','Insurer','Member No','Service','ICD-10','Amount','Status','Source','Actions'].map(h=>(
                    <th key={h} style={css.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={10} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No claims found</td></tr>
                )}
                {filtered.map(r => (
                  <tr key={r.id} style={{cursor:'pointer'}} onClick={() => setShowDetail(r)}>
                    <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.sub}}>{r.claim_no||'—'}</td>
                    <td style={css.td}>
                      <strong>{r.patient_name}</strong>
                      <br/>
                      <span style={{fontSize:'11px',color:C.sub,fontFamily:'monospace'}}>{r.member_no||'No member no.'}</span>
                    </td>
                    <td style={{...css.td,fontSize:'12px',fontWeight:600}}>{r.insurer||'—'}</td>
                    <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.sub}}>{r.member_no||'—'}</td>
                    <td style={{...css.td,fontSize:'12px'}}>{parseServicesField(r.service) || '—'}</td>
                    <td style={{...css.td,fontFamily:'monospace',fontSize:'12px'}}>
                      {r.icd10_code
                        ? <span style={{background:C.purpleL,color:C.purple,padding:'2px 6px',borderRadius:'4px',fontWeight:600}}>{r.icd10_code}</span>
                        : <span style={{color:C.muted,fontSize:'11px'}}>—</span>
                      }
                    </td>
                    <td style={{...css.td,fontWeight:700}}>KES {fmt(r.amount_kes)}</td>
                    <td style={css.td}><Badge status={r.status}/></td>
                    <td style={css.td}><SourceBadge source={getSource(r)}/></td>
                    <td style={css.td} onClick={e => e.stopPropagation()}>
                      <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
                        {r.status === 'Draft' && (
                          <button style={{...css.btn,background:C.blueL,color:C.blue,border:'none',padding:'4px 8px',fontSize:'11px'}}
                            onClick={() => updateStatus(r.id,'Submitted')}>Submit</button>
                        )}
                        {['Pending','Submitted','Pre-auth','Under Review'].includes(r.status) && (
                          <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
                            onClick={() => updateStatus(r.id,'Approved')}>Approve</button>
                        )}
                        {r.status === 'Approved' && (
                          <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
                            onClick={() => updateStatus(r.id,'Paid')}>Mark Paid</button>
                        )}
                        {!['Rejected','Paid','Lapsed'].includes(r.status) && (
                          <button style={{...css.btn,background:C.dangerL,color:C.danger,border:'none',padding:'4px 8px',fontSize:'11px'}}
                            onClick={() => updateStatus(r.id,'Rejected')}>Reject</button>
                        )}
                        {r.status === 'Rejected' && (
                          <button style={{...css.btn,background:'#FFF7ED',color:'#EA580C',border:'none',padding:'4px 8px',fontSize:'11px'}}
                            onClick={() => updateStatus(r.id,'Appealed')}>Appeal</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: FROM BILLING
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'billing' && (
          <div style={css.card}>
            <div style={{...css.cardHead}}>
              <span>Insurance Invoices from Billing — {unimportedInvoices.length > 0 ? `${unimportedInvoices.length} pending auto-post (pre-feature invoices)` : 'All auto-synced ✓'}</span>
              {unimportedInvoices.length > 0 && (
                <button style={{...css.btn,...css.btnPri,fontSize:'11px',padding:'6px 12px'}}
                  onClick={() => importAllBilling(unimportedInvoices)} disabled={saving || !isAdmin} title={!isAdmin ? 'Admin only' : ''}>
                  {saving ? 'Syncing...' : `Sync Remaining (${unimportedInvoices.length})`}
                </button>
              )}
            </div>
            <div style={{padding:'10px 16px',background:C.blueL,borderBottom:`1px solid ${C.border}`,fontSize:'12px',color:C.blue}}>
              ℹ These are invoices from Billing where the patient's insurer is recorded. Import them to create draft claims — then add ICD-10 codes and auth codes before submitting.
            </div>
            {invoices.length === 0 && (
              <div style={{padding:'40px',textAlign:'center',color:C.muted}}>
                No insurance invoices found in Billing yet. When staff add patients with an insurer in Billing, they'll appear here automatically.
              </div>
            )}
            <table style={css.table}>
              <thead>
                <tr>
                  {['Invoice No','Patient','Insurer','Services','Amount','Balance','Date','Status','Action'].map(h=>(
                    <th key={h} style={css.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const imported = importedRefs.has(inv.invoice_no)
                  return (
                    <tr key={inv.id} style={{opacity: imported ? 0.5 : 1}}>
                      <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.sub}}>{inv.invoice_no||'—'}</td>
                      <td style={css.td}><strong>{inv.patient_name}</strong></td>
                      <td style={{...css.td,fontWeight:600,fontSize:'12px'}}>{inv.insurer||'—'}</td>
                      <td style={{...css.td,fontSize:'12px',maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{parseServicesField(inv.services) || '—'}</td>
                      <td style={{...css.td,fontWeight:700}}>KES {fmt(inv.amount_kes)}</td>
                      <td style={{...css.td,color:parseFloat(inv.balance_kes||0)>0?C.warn:C.primary,fontWeight:600}}>KES {fmt(inv.balance_kes)}</td>
                      <td style={{...css.td,fontSize:'12px',color:C.sub}}>{inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-KE') : '—'}</td>
                      <td style={css.td}><Badge status={inv.status}/></td>
                      <td style={css.td}>
                        {imported
                          ? <span style={{...css.badge,background:C.primaryL,color:C.primary}}> Imported</span>
                          : <button style={{...css.btn,...css.btnBlue,padding:'5px 10px',fontSize:'11px'}}
                              onClick={() => importFromBilling(inv)} disabled={saving}>
                              Import
                            </button>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: PENDING
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'pending' && (
          <div style={css.card}>
            <div style={{...css.cardHead,color:C.warn}}>
              <span>Claims Awaiting Action — {pending.length} claims</span>
              <span style={{fontSize:'12px'}}>KES {fmt(pendingAmt)} outstanding</span>
            </div>
            <table style={css.table}>
              <thead>
                <tr>
                  {['Patient','Insurer','Service','ICD-10','Amount','Status','Days Pending','Actions'].map(h=>(
                    <th key={h} style={css.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pending.length === 0 && (
                  <tr><td colSpan={8} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No pending claims 🎉</td></tr>
                )}
                {pending.map(r => {
                  const days = daysSince(r.submitted_at)
                  const rule = INSURER_RULES[r.insurer] || {}
                  const authExpiring = r.auth_code && rule.authWindowDays && days > (rule.authWindowDays - 7)
                  return (
                    <tr key={r.id} style={{cursor:'pointer'}} onClick={() => setShowDetail(r)}>
                      <td style={css.td}>
                        <strong>{r.patient_name}</strong>
                        {!r.icd10_code && rule.requiresICD10 && (
                          <div style={{fontSize:'10px',color:C.danger,marginTop:'2px'}}> ICD-10 missing — {r.insurer} requires it</div>
                        )}
                        {authExpiring && (
                          <div style={{fontSize:'10px',color:C.warn,marginTop:'2px'}}>⏰ Auth code may expire soon</div>
                        )}
                      </td>
                      <td style={{...css.td,fontSize:'12px',fontWeight:600}}>{r.insurer||'—'}</td>
                      <td style={{...css.td,fontSize:'12px'}}>{parseServicesField(r.service) || '—'}</td>
                      <td style={{...css.td,fontFamily:'monospace',fontSize:'12px'}}>
                        {r.icd10_code
                          ? <span style={{background:C.purpleL,color:C.purple,padding:'2px 6px',borderRadius:'4px',fontWeight:600}}>{r.icd10_code}</span>
                          : <span style={{color:C.danger,fontSize:'11px',fontWeight:600}}>Missing</span>}
                      </td>
                      <td style={{...css.td,fontWeight:700}}>KES {fmt(r.amount_kes)}</td>
                      <td style={css.td}><Badge status={r.status}/></td>
                      <td style={{...css.td,color:days>30?C.danger:days>14?C.warn:C.text,fontWeight:days>14?700:400}}>
                        {days !== null ? `${days}d` : '—'}
                        {days > 30 && <span style={{marginLeft:'4px',fontSize:'10px',color:C.danger}}> STALE</span>}
                      </td>
                      <td style={css.td} onClick={e => e.stopPropagation()}>
                        <div style={{display:'flex',gap:'4px'}}>
                          <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
                            onClick={() => updateStatus(r.id,'Approved')}>Approve</button>
                          <button style={{...css.btn,background:C.dangerL,color:C.danger,border:'none',padding:'4px 8px',fontSize:'11px'}}
                            onClick={() => updateStatus(r.id,'Rejected')}>Reject</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: REJECTED
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'rejected' && (
          <div style={css.card}>
            <div style={{...css.cardHead,color:C.danger}}>
              <span>Rejected Claims — {rejected.length} claims</span>
              <span style={{fontSize:'12px'}}>KES {fmt(rejected.reduce((s,r)=>s+parseFloat(r.amount_kes||0),0))} unrecovered</span>
            </div>
            {rejected.length > 0 && (
              <div style={{padding:'10px 16px',background:C.dangerL,borderBottom:`1px solid ${C.border}`,fontSize:'12px',color:C.danger}}>
                💡 Tip: Check ICD-10 codes and auth codes before re-submitting. Most rejections are coding errors.
              </div>
            )}
            <table style={css.table}>
              <thead>
                <tr>
                  {['Claim No','Patient','Insurer','Service','ICD-10','Amount','Date','Actions'].map(h=>(
                    <th key={h} style={css.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rejected.length === 0 && (
                  <tr><td colSpan={8} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No rejected claims</td></tr>
                )}
                {rejected.map(r => (
                  <tr key={r.id} style={{cursor:'pointer'}} onClick={() => setShowDetail(r)}>
                    <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.sub}}>{r.claim_no||'—'}</td>
                    <td style={css.td}><strong>{r.patient_name}</strong></td>
                    <td style={{...css.td,fontSize:'12px',fontWeight:600}}>{r.insurer||'—'}</td>
                    <td style={{...css.td,fontSize:'12px'}}>{parseServicesField(r.service) || '—'}</td>
                    <td style={{...css.td,fontFamily:'monospace',fontSize:'12px'}}>
                      {r.icd10_code
                        ? <span style={{background:C.purpleL,color:C.purple,padding:'2px 6px',borderRadius:'4px'}}>{r.icd10_code}</span>
                        : <span style={{color:C.danger,fontSize:'11px',fontWeight:600}}> Missing</span>}
                    </td>
                    <td style={{...css.td,fontWeight:700,color:C.danger}}>KES {fmt(r.amount_kes)}</td>
                    <td style={{...css.td,fontSize:'12px',color:C.sub}}>{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('en-KE') : '—'}</td>
                    <td style={css.td} onClick={e => e.stopPropagation()}>
                      <div style={{display:'flex',gap:'4px'}}>
                        <button style={{...css.btn,background:'#FFF7ED',color:'#EA580C',border:'none',padding:'4px 8px',fontSize:'11px'}}
                          onClick={() => updateStatus(r.id,'Appealed')}>Appeal</button>
                        <button style={{...css.btn,background:C.blueL,color:C.blue,border:'none',padding:'4px 8px',fontSize:'11px'}}
                          onClick={() => updateStatus(r.id,'Submitted')}>Re-submit</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: BY INSURER
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'insurers' && (
          <div style={css.card}>
            <div style={css.cardHead}>
              <span>Performance by Insurer</span>
              <span style={{fontSize:'12px',color:C.sub}}>{insurerBreakdown.length} insurer{insurerBreakdown.length!==1?'s':''} · All time</span>
            </div>
            <table style={css.table}>
              <thead>
                <tr>
                  {['Insurer','Claims','Total (KES)','Pending','Approved','Paid','Rejected','Approval Rate','Action'].map(h=>(
                    <th key={h} style={css.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {insurerBreakdown.length === 0 && (
                  <tr><td colSpan={9} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No data yet</td></tr>
                )}
                {insurerBreakdown.map(ins => {
                  const rate = ins.count > 0 ? Math.round(((ins.approved+ins.paid)/ins.count)*100) : 0
                  const rateColor = rate>70?C.primary:rate>40?C.warn:C.danger
                  const insRecs = records.filter(r => r.insurer === ins.name)
                  return (
                    <tr key={ins.name}>
                      <td style={{...css.td,fontWeight:700}}>
                        {ins.name}
                        {INSURER_RULES[ins.name]?.requiresICD10 && (
                          <div style={{fontSize:'10px',color:C.purple,marginTop:'2px'}}>ICD-10 required</div>
                        )}
                      </td>
                      <td style={css.td}>{ins.count}</td>
                      <td style={{...css.td,fontWeight:700,color:C.primary}}>KES {ins.total.toLocaleString()}</td>
                      <td style={{...css.td,color:C.warn,fontWeight:ins.pending>0?600:400}}>{ins.pending}</td>
                      <td style={{...css.td,color:C.primary}}>{ins.approved}</td>
                      <td style={{...css.td,color:C.primary,fontWeight:600}}>{ins.paid}</td>
                      <td style={{...css.td,color:ins.rejected>0?C.danger:C.muted,fontWeight:ins.rejected>0?600:400}}>{ins.rejected}</td>
                      <td style={css.td}>
                        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                          <div style={{flex:1,height:'6px',background:C.border,borderRadius:'3px',overflow:'hidden',minWidth:'60px'}}>
                            <div style={{height:'100%',width:`${rate}%`,background:rateColor,borderRadius:'3px'}}/>
                          </div>
                          <span style={{fontSize:'12px',fontWeight:700,color:rateColor,minWidth:'32px'}}>{rate}%</span>
                        </div>
                      </td>
                      <td style={css.td}>
                        <button style={{...css.btn,background:'#F5F3FF',color:C.purple,border:'none',padding:'5px 10px',fontSize:'11px'}}
                          onClick={() => exportInsurerPDF(insRecs, ins.name)} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>
                          📄 Export
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {/* Insurer rules reference */}
            <div style={{padding:'16px',borderTop:`1px solid ${C.border}`}}>
              <div style={{fontSize:'11px',fontWeight:700,color:C.sub,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'10px'}}>Insurer Rules Reference</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:'8px'}}>
                {Object.entries(INSURER_RULES).filter(([k]) => activeInsurers.includes(k)).map(([name,rule]) => (
                  <div key={name} style={{background:'#FAFBFD',border:`1px solid ${C.border}`,borderRadius:'8px',padding:'10px 12px'}}>
                    <div style={{fontWeight:700,fontSize:'12px',marginBottom:'4px'}}>{name}</div>
                    <div style={{fontSize:'11px',color:C.sub,lineHeight:'1.6'}}>
                      {rule.requiresICD10 && <span style={{color:C.purple,fontWeight:600}}>ICD-10 req · </span>}
                      {rule.requiresAuth && <span style={{color:C.warn,fontWeight:600}}>Pre-auth req · </span>}
                      {rule.outpatientCap && <span>Cap: KES {rule.outpatientCap.toLocaleString()} · </span>}
                      {rule.note}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: PATIENT LEDGER
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'ledger' && (() => {
          const patientMap = {}
          records.forEach(r => {
            const k = r.patient_name || 'Unknown'
            if (!patientMap[k]) patientMap[k] = { name:k, insurer:r.insurer, member_no:r.member_no, claims:[], total:0, paid:0 }
            patientMap[k].claims.push(r)
            patientMap[k].total += parseFloat(r.amount_kes||0)
            if (r.status === 'Paid') patientMap[k].paid += parseFloat(r.amount_kes||0)
          })
          const patients = Object.values(patientMap).sort((a,b) => b.total - a.total)
          return (
            <div style={css.card}>
              <div style={css.cardHead}>
                <span>Patient Insurance Ledger — {patients.length} patient{patients.length!==1?'s':''}</span>
              </div>
              <table style={css.table}>
                <thead>
                  <tr>
                    {['Patient','Insurer','Member No','Total Claims','Total Claimed','Total Paid','Outstanding','Last Claim','Action'].map(h=>(
                      <th key={h} style={css.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {patients.length === 0 && (
                    <tr><td colSpan={9} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No patient data yet</td></tr>
                  )}
                  {patients.map(p => {
                    const outstanding = p.total - p.paid
                    const lastClaim = p.claims[0]
                    return (
                      <tr key={p.name} style={{cursor:'pointer'}} onClick={() => setShowPatientLedger(p)}>
                        <td style={css.td}><strong>{p.name}</strong></td>
                        <td style={{...css.td,fontSize:'12px',fontWeight:600}}>{p.insurer||'—'}</td>
                        <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.sub}}>{p.member_no||'—'}</td>
                        <td style={css.td}>{p.claims.length}</td>
                        <td style={{...css.td,fontWeight:700}}>KES {fmt(p.total)}</td>
                        <td style={{...css.td,color:C.primary,fontWeight:600}}>KES {fmt(p.paid)}</td>
                        <td style={{...css.td,color:outstanding>0?C.warn:C.primary,fontWeight:600}}>KES {fmt(outstanding)}</td>
                        <td style={{...css.td,fontSize:'12px',color:C.sub}}>
                          {lastClaim?.submitted_at ? new Date(lastClaim.submitted_at).toLocaleDateString('en-KE') : '—'}
                        </td>
                        <td style={css.td}>
                          <button style={{...css.btn,...css.btnBlue,padding:'5px 10px',fontSize:'11px'}}
                            onClick={e => { e.stopPropagation(); setShowPatientLedger(p) }}>
                            View All
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })()}

      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: NEW CLAIM
      ══════════════════════════════════════════════════════════════════════ */}
      {showAdd && (
        <div style={css.overlay} onClick={() => setShowAdd(false)}>
          <div style={css.modalWide} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
              <div style={css.modalH}>New Insurance Claim</div>
              <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setShowAdd(false)}></button>
            </div>

            {/* Insurer rules alert */}
            {INSURER_RULES[f.insurer] && (
              <div style={{...css.aiBox,background:C.warnL,border:`1px solid #FDE68A`,marginBottom:'12px'}}>
                <div style={{...css.aiLabel,color:C.warn}}>📋 {f.insurer} Rules</div>
                <div style={{fontSize:'12px',color:C.text,lineHeight:'1.6'}}>{INSURER_RULES[f.insurer].note}</div>
              </div>
            )}

            <div style={css.grid2}>
              <div>
                <label style={css.lbl}>Patient Name *</label>
                <input style={css.input} placeholder="Full name" value={f.patient_name} onChange={e => sf({patient_name:e.target.value})}/>
              </div>
              <div>
                <label style={css.lbl}>Insurer *</label>
                <select style={{...css.input,cursor:'pointer'}} value={f.insurer} onChange={e => sf({insurer:e.target.value})}>
                  {INSURERS.map(i => <option key={i}>{i}</option>)}
                </select>
              </div>
            </div>
            <div style={css.grid2}>
              <div>
                <label style={css.lbl}>Member No</label>
                <input style={css.input} placeholder="MEM-XXXXXXX" value={f.member_no} onChange={e => sf({member_no:e.target.value.toUpperCase()})}/>
              </div>
              <div>
                <label style={css.lbl}>Auth / Pre-auth Code</label>
                <input style={css.input} placeholder="AUTH-XXXXXX" value={f.auth_code} onChange={e => sf({auth_code:e.target.value.toUpperCase()})}/>
              </div>
            </div>
            <div style={css.grid2}>
              <div>
                <label style={css.lbl}>Service Type *</label>
                <select style={{...css.input,cursor:'pointer'}} value={f.service} onChange={e => sf({service:e.target.value})}>
                  {SERVICES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={css.lbl}>Amount (KES) *</label>
                <input style={css.input} type="number" placeholder="0" value={f.amount_kes} onChange={e => sf({amount_kes:e.target.value})}/>
              </div>
            </div>

            {/* ICD-10 Section */}
            <hr style={css.divider}/>
            <div style={{...css.aiLabel,color:C.purple,marginBottom:'8px'}}>🧬 ICD-10 Code {INSURER_RULES[f.insurer]?.requiresICD10 && <span style={{color:C.danger}}>* Required</span>}</div>

            {/* Manual ICD-10 entry + search */}
            <div style={css.grid2}>
              <div>
                <label style={css.lbl}>ICD-10 Code</label>
                <input style={{...css.input,fontFamily:'monospace'}} placeholder="e.g. J18.9"
                  value={f.icd10_code} onChange={e => sf({icd10_code:e.target.value.toUpperCase()})}/>
              </div>
              <div>
                <label style={css.lbl}>Quick Search Common Codes</label>
                <input style={css.input} placeholder="Type diagnosis keyword..."
                  value={icdSearch} onChange={e => setIcdSearch(e.target.value)}/>
              </div>
            </div>
            {icdSearch && icdResults.length > 0 && (
              <div style={{background:'#FAFBFD',border:`1px solid ${C.border}`,borderRadius:'7px',marginBottom:'12px',maxHeight:'140px',overflowY:'auto'}}>
                {icdResults.map(i => (
                  <div key={i.code} style={{padding:'8px 12px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:'12px',display:'flex',gap:'10px',alignItems:'center'}}
                    onClick={() => { sf({icd10_code:i.code}); setIcdSearch('') }}>
                    <span style={{fontFamily:'monospace',fontWeight:700,color:C.purple,minWidth:'50px'}}>{i.code}</span>
                    <span style={{color:C.text}}>{i.desc}</span>
                  </div>
                ))}
              </div>
            )}

            {/* AI ICD-10 suggestion */}
            <div style={css.aiBox}>
              <div style={css.aiLabel}>✨ AI ICD-10 Assist</div>
              <div style={{display:'flex',gap:'8px',marginBottom:'6px'}}>
                <input style={{...css.input,marginBottom:0,flex:1}} placeholder="Describe symptoms or diagnosis in plain English..."
                  value={aiQuery} onChange={e => setAiQuery(e.target.value)}
                  onKeyDown={e => e.key==='Enter' && handleAISuggest()}/>
                <button style={{...css.btn,...css.btnPurple,whiteSpace:'nowrap'}} onClick={handleAISuggest} disabled={aiLoading}>
                  {aiLoading ? <span className="ai-pulse">Thinking...</span> : 'Suggest'}
                </button>
              </div>
              {aiSuggestions.length > 0 && (
                <div>
                  {aiSuggestions.map((s,i) => (
                    <div key={i} style={{display:'flex',alignItems:'center',gap:'10px',padding:'6px 8px',background:C.surface,borderRadius:'6px',marginTop:'4px',cursor:'pointer',border:`1px solid ${C.border}`}}
                      onClick={() => sf({icd10_code:s.code})}>
                      <span style={{fontFamily:'monospace',fontWeight:700,color:C.purple,minWidth:'50px'}}>{s.code}</span>
                      <span style={{flex:1,fontSize:'12px'}}>{s.desc}</span>
                      <span style={{fontSize:'10px',color:s.confidence==='high'?C.primary:C.warn,fontWeight:600,textTransform:'uppercase'}}>{s.confidence}</span>
                      <span style={{fontSize:'11px',color:C.blue}}>← Use</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={css.grid2}>
              <div>
                <label style={css.lbl}>Invoice Ref (if from Billing)</label>
                <input style={css.input} placeholder="INV-XXXXX" value={f.invoice_ref} onChange={e => sf({invoice_ref:e.target.value})}/>
              </div>
              <div>
                <label style={css.lbl}>Initial Status</label>
                <select style={{...css.input,cursor:'pointer'}} value={f.status} onChange={e => sf({status:e.target.value})}>
                  <option>Draft</option>
                  <option>Pending</option>
                  <option>Pre-auth</option>
                  <option>Submitted</option>
                </select>
              </div>
            </div>
            <label style={css.lbl}>Notes / Diagnosis Details</label>
            <textarea style={{...css.input,resize:'vertical',minHeight:'60px',fontFamily:'inherit'}}
              placeholder="Any additional clinical or billing notes..."
              value={f.notes} onChange={e => sf({notes:e.target.value})}/>

            <hr style={css.divider}/>
            <div style={{display:'flex',gap:'8px'}}>
              <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={() => setShowAdd(false)}>Cancel</button>
              <button style={{...css.btn,...css.btnPri,flex:2,padding:'10px'}} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Claim'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: CLAIM DETAIL
      ══════════════════════════════════════════════════════════════════════ */}
      {showDetail && (
        <div style={css.overlay} onClick={() => setShowDetail(null)}>
          <div style={css.modal} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
              <div style={css.modalH}>Claim Detail</div>
              <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setShowDetail(null)}></button>
            </div>

            {/* Status badge + source */}
            <div style={{display:'flex',gap:'8px',marginBottom:'16px',alignItems:'center'}}>
              <Badge status={showDetail.status}/>
              <SourceBadge source={getSource(showDetail)}/>
              {showDetail.claim_no && <span style={{fontFamily:'monospace',fontSize:'12px',color:C.sub}}>#{showDetail.claim_no}</span>}
            </div>

            {/* Insurer rules reminder */}
            {INSURER_RULES[showDetail.insurer] && (
              <div style={{...css.aiBox,background:C.warnL,border:`1px solid #FDE68A`,marginBottom:'12px'}}>
                <div style={{...css.aiLabel,color:C.warn}}>📋 {showDetail.insurer} Rules</div>
                <div style={{fontSize:'12px',color:C.text}}>{INSURER_RULES[showDetail.insurer].note}</div>
              </div>
            )}

            {[
              ['Patient', showDetail.patient_name],
              ['Insurer', showDetail.insurer || '—'],
              ['Member No', showDetail.member_no || '—'],
              ['Service', parseServicesField(showDetail.service) || '—'],
              ['ICD-10 Code',showDetail.icd10_code || ' Missing'],
              ['Auth Code', showDetail.auth_code || '—'],
              ['Amount', `KES ${fmt(showDetail.amount_kes)}`],
              ['Submitted', showDetail.submitted_at ? new Date(showDetail.submitted_at).toLocaleString('en-KE') : '—'],
              ['Invoice Ref',getInvoiceRef(showDetail) || '—'],
            ].map(([k,v]) => (
              <div key={k} style={css.infoRow}>
                <span style={{color:C.sub,fontWeight:500}}>{k}</span>
                <span style={{fontWeight:600,fontFamily:k.includes('No')||k.includes('Code')||k.includes('ICD')?'monospace':'inherit',
                  color:k==='ICD-10 Code'&&!showDetail.icd10_code?C.danger:C.text}}>
                  {k==='Status'?<Badge status={v}/>:v}
                </span>
              </div>
            ))}

            {/* Action buttons */}
            <div style={{marginTop:'16px',display:'flex',gap:'8px',flexWrap:'wrap'}}>
              {showDetail.status === 'Draft' && (
                <button style={{...css.btn,...css.btnBlue,flex:1,padding:'10px'}}
                  onClick={() => { updateStatus(showDetail.id,'Submitted'); setShowDetail(null) }}>Submit to Insurer</button>
              )}
              {['Pending','Submitted','Pre-auth','Under Review'].includes(showDetail.status) && (
                <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',flex:1,padding:'10px'}}
                  onClick={() => { updateStatus(showDetail.id,'Approved'); setShowDetail(null) }}>Approve</button>
              )}
              {showDetail.status === 'Approved' && (
                <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',flex:1,padding:'10px'}}
                  onClick={() => { updateStatus(showDetail.id,'Paid'); setShowDetail(null) }}>Mark Paid</button>
              )}
              {!['Rejected','Paid','Lapsed'].includes(showDetail.status) && (
                <button style={{...css.btn,background:C.dangerL,color:C.danger,border:'none',flex:1,padding:'10px'}}
                  onClick={() => { updateStatus(showDetail.id,'Rejected'); setShowDetail(null) }}>Reject</button>
              )}
              {showDetail.status === 'Rejected' && (
                <button style={{...css.btn,background:'#FFF7ED',color:'#EA580C',border:'none',flex:1,padding:'10px'}}
                  onClick={() => { updateStatus(showDetail.id,'Appealed'); setShowDetail(null) }}>Lodge Appeal</button>
              )}
              <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={() => setShowDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: PATIENT LEDGER
      ══════════════════════════════════════════════════════════════════════ */}
      {showPatientLedger && (
        <div style={css.overlay} onClick={() => setShowPatientLedger(null)}>
          <div style={css.modalWide} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}>
              <div style={css.modalH}>{showPatientLedger.name} — Full Insurance History</div>
              <div style={{display:'flex',gap:'8px'}}>
                <button style={{...css.btn,...css.btnGhost,padding:'5px 12px',fontSize:'11px'}}
                  onClick={() => exportCSV(showPatientLedger.claims, `claims_${showPatientLedger.name.replace(/ /g,'_')}.csv`)}
                  disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>
                  ↓ Export
                </button>
                <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setShowPatientLedger(null)}></button>
              </div>
            </div>
            <div style={{fontSize:'12px',color:C.sub,marginBottom:'16px'}}>
              {showPatientLedger.insurer} · Member: {showPatientLedger.member_no || 'N/A'}
            </div>

            {/* Summary row */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px',marginBottom:'16px'}}>
              {[
                { label:'Total Claims', value:showPatientLedger.claims.length, color:C.text },
                { label:'Total Claimed', value:`KES ${fmt(showPatientLedger.total)}`, color:C.blue },
                { label:'Total Paid', value:`KES ${fmt(showPatientLedger.paid)}`, color:C.primary },
                { label:'Outstanding', value:`KES ${fmt(showPatientLedger.total - showPatientLedger.paid)}`, color:(showPatientLedger.total-showPatientLedger.paid)>0?C.warn:C.primary },
              ].map(s => (
                <div key={s.label} style={css.stat}>
                  <div style={css.statLbl}>{s.label}</div>
                  <div style={{...css.statVal,fontSize:'16px',color:s.color}}>{s.value}</div>
                </div>
              ))}
            </div>

            <table style={css.table}>
              <thead>
                <tr>
                  {['Claim No','Service','ICD-10','Auth','Amount','Status','Date','Source'].map(h=>(
                    <th key={h} style={css.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {showPatientLedger.claims.map(r => (
                  <tr key={r.id}>
                    <td style={{...css.td,fontFamily:'monospace',fontSize:'11px',color:C.sub}}>{r.claim_no||'—'}</td>
                    <td style={{...css.td,fontSize:'12px'}}>{parseServicesField(r.service) || '—'}</td>
                    <td style={{...css.td,fontFamily:'monospace',fontSize:'12px'}}>
                      {r.icd10_code
                        ? <span style={{background:C.purpleL,color:C.purple,padding:'2px 6px',borderRadius:'4px',fontWeight:600}}>{r.icd10_code}</span>
                        : <span style={{color:C.muted,fontSize:'11px'}}>—</span>}
                    </td>
                    <td style={{...css.td,fontFamily:'monospace',fontSize:'11px',color:C.sub}}>{r.auth_code||'—'}</td>
                    <td style={{...css.td,fontWeight:700}}>KES {fmt(r.amount_kes)}</td>
                    <td style={css.td}><Badge status={r.status}/></td>
                    <td style={{...css.td,fontSize:'11px',color:C.sub}}>{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('en-KE') : '—'}</td>
                    <td style={css.td}><SourceBadge source={getSource(r)}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: PRE-AUTH TRACKER
      ══════════════════════════════════════════════════════════════════════ */}
      {showPreAuthTracker && (
        <div style={css.overlay} onClick={() => setShowPreAuthTracker(false)}>
          <div style={css.modalWide} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}>
              <div style={css.modalH}>🔐 Pre-Auth Tracker</div>
              <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setShowPreAuthTracker(false)}></button>
            </div>
            <div style={{fontSize:'12px',color:C.sub,marginBottom:'16px'}}>
              Tracks all claims with auth codes and their expiry risk based on insurer windows.
            </div>
            {records.filter(r => r.auth_code).length === 0 ? (
              <div style={{padding:'40px',textAlign:'center',color:C.muted}}>No claims with auth codes yet. Add pre-auth codes when submitting claims.</div>
            ) : (
              <table style={css.table}>
                <thead>
                  <tr>
                    {['Patient','Insurer','Auth Code','Service','Amount','Days Since','Auth Window','Risk','Status'].map(h=>(
                      <th key={h} style={css.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.filter(r => r.auth_code).map(r => {
                    const days = daysSince(r.submitted_at) || 0
                    const rule = INSURER_RULES[r.insurer] || {}
                    const window = rule.authWindowDays
                    const remaining = window ? window - days : null
                    const risk = remaining === null ? 'Unknown' : remaining < 0 ? 'LAPSED' : remaining < 7 ? 'CRITICAL' : remaining < 14 ? 'WARNING' : 'Safe'
                    const riskColor = { LAPSED:C.danger, CRITICAL:C.danger, WARNING:C.warn, Safe:C.primary, Unknown:C.sub }[risk]
                    return (
                      <tr key={r.id}>
                        <td style={css.td}><strong>{r.patient_name}</strong></td>
                        <td style={{...css.td,fontSize:'12px',fontWeight:600}}>{r.insurer||'—'}</td>
                        <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.purple,fontWeight:700}}>{r.auth_code}</td>
                        <td style={{...css.td,fontSize:'12px'}}>{parseServicesField(r.service) || '—'}</td>
                        <td style={{...css.td,fontWeight:700}}>KES {fmt(r.amount_kes)}</td>
                        <td style={css.td}>{days}d ago</td>
                        <td style={{...css.td,color:C.sub}}>{window ? `${window} days` : 'N/A'}</td>
                        <td style={{...css.td,fontWeight:700,color:riskColor}}>{risk}{remaining !== null && remaining > 0 && ` (${remaining}d left)`}</td>
                        <td style={css.td}><Badge status={r.status}/></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
