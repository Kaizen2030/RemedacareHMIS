import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import SkeletonLoader from '../components/SkeletonLoader'
import supabase from '../supabase'
import { useHospital } from '../context'
import { executeWithFallback, omitKeys } from '../utils/dbCompat'
import { extractGeminiText, generateGeminiContent } from '../utils/geminiProxy'
import { broadcastWorkflowChanged } from '../utils/workflowEvents'
import { colors as C, typography } from '../theme'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'

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
  cardPad: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px 18px', marginBottom:'16px' },
  kpiGrid: { display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:'12px', marginBottom:'16px' },
  chartWrap: { height:'280px' },
  split: { display:'grid', gridTemplateColumns:'1.05fr .95fr', gap:'16px', marginBottom:'16px' },
  uploadList: { display:'grid', gap:'8px', marginTop:'8px' },
  uploadItem: { display:'flex', justifyContent:'space-between', alignItems:'center', gap:'10px', padding:'8px 10px', border:`1px solid ${C.border}`, borderRadius:'8px', background:'#FAFBFD', fontSize:'12px' },
  checklistRow: { display:'flex', alignItems:'flex-start', gap:'10px', padding:'10px 12px', border:`1px solid ${C.border}`, borderRadius:'8px', background:'#FAFBFD' },
  mono: { fontFamily:'monospace', fontSize:'12px' },
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

const DEFAULT_DOCUMENT_REQUIREMENTS = {
  'Jubilee Health Insurance': ['Claim form', 'Original receipts', 'Discharge summary'],
  'AAR Insurance': ['Pre-auth letter', 'Itemized bill', 'Clinical notes'],
  'CIC Insurance': ['Claim form', 'Itemized invoice'],
  'Britam Health': ['Pre-auth letter', 'Clinical notes', 'Discharge summary'],
}

const DEFAULT_TARIFF_GUIDE = {
  'AAR Insurance': {
    'Outpatient Consultation': { rate: 1800, covered: true, plan: 'Corporate' },
    'Laboratory Tests': { rate: 3500, covered: true, plan: 'Corporate' },
    'Radiology / Imaging': { rate: 5000, covered: true, plan: 'Corporate' },
    'Annual Check-up': { rate: 0, covered: false, plan: 'Corporate' },
  },
  'Jubilee Health Insurance': {
    'Outpatient Consultation': { rate: 2000, covered: true, plan: 'Premier' },
    'Inpatient Admission': { rate: 12000, covered: true, plan: 'Premier' },
    'Maternity / Delivery': { rate: 40000, covered: true, plan: 'Premier' },
  },
}

const DEFAULT_DRG_MAP = {
  maternity: ['Maternity / Delivery', 'Laboratory Tests', 'Pharmacy / Drugs', 'Accommodation'],
  surgery: ['Surgical Procedure', 'Laboratory Tests', 'Radiology / Imaging', 'Pharmacy / Drugs', 'Accommodation'],
  medical: ['Inpatient Admission', 'Laboratory Tests', 'Pharmacy / Drugs', 'Accommodation'],
}

const CHART_COLORS = ['#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#475569', '#0F766E']

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

function normalizeClaimMeta(meta = {}) {
  return {
    source: meta.source || 'Manual',
    invoice_ref: meta.invoice_ref || '',
    invoice_id: meta.invoice_id || null,
    patient_id: meta.patient_id || null,
    visit_id: meta.visit_id || null,
    notes: meta.notes || '',
    plan_name: meta.plan_name || '',
    preauth_status: meta.preauth_status || '',
    preauth_expiry_date: meta.preauth_expiry_date || '',
    required_documents: Array.isArray(meta.required_documents) ? meta.required_documents : [],
    submitted_documents: Array.isArray(meta.submitted_documents) ? meta.submitted_documents : [],
    tariff_rate: Number(meta.tariff_rate || 0),
    tariff_covered: meta.tariff_covered !== false,
    tariff_plan: meta.tariff_plan || '',
    bundled_invoice_ids: Array.isArray(meta.bundled_invoice_ids) ? meta.bundled_invoice_ids : [],
    bundled_line_items: Array.isArray(meta.bundled_line_items) ? meta.bundled_line_items : [],
    drg_group: meta.drg_group || '',
    payment_received_at: meta.payment_received_at || '',
    remittance_ref: meta.remittance_ref || '',
    remittance_status: meta.remittance_status || '',
    paid_amount: Number(meta.paid_amount || 0),
  }
}

function buildClaimNotes(meta = {}) {
  return JSON.stringify(normalizeClaimMeta(meta))
}

function genClaimNo() {
  return 'CLM-' + Date.now().toString(36).toUpperCase().slice(-6)
}

function normalizeInsuranceConfig(raw = {}) {
  return {
    preauthRules: raw.preauthRules && typeof raw.preauthRules === 'object' ? raw.preauthRules : {},
    tariffGuide: raw.tariffGuide && typeof raw.tariffGuide === 'object' ? raw.tariffGuide : DEFAULT_TARIFF_GUIDE,
    documentRequirements: raw.documentRequirements && typeof raw.documentRequirements === 'object' ? raw.documentRequirements : DEFAULT_DOCUMENT_REQUIREMENTS,
    drgGrouping: raw.drgGrouping && typeof raw.drgGrouping === 'object' ? raw.drgGrouping : DEFAULT_DRG_MAP,
  }
}

function safeDate(value) {
  const date = new Date(value || 0)
  return Number.isNaN(date.getTime()) ? null : date
}

function diffDays(from, to = new Date()) {
  const left = safeDate(from)
  const right = safeDate(to)
  if (!left || !right) return null
  return Math.max(0, Math.floor((right.getTime() - left.getTime()) / 86400000))
}

function getRateColor(rate) {
  if (rate > 80) return C.primary
  if (rate >= 60) return C.warn
  return C.danger
}

function getRateBadge(rate) {
  return {
    bg: rate > 80 ? C.primaryL : rate >= 60 ? C.warnL : C.dangerL,
    color: getRateColor(rate),
  }
}

function getAgingBucket(days) {
  if (days <= 30) return '0-30 days'
  if (days <= 60) return '31-60 days'
  if (days <= 90) return '61-90 days'
  return '>90 days'
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
    <div class="footer">This statement was generated by CliniqBot · Brightpath Travel Scholars</div>
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
  const [showChecklistModal, setShowChecklistModal] = useState(null)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [showCollectionsModal, setShowCollectionsModal] = useState(null)
  const [reconciliationReport, setReconciliationReport] = useState(null)
  const [insuranceConfig, setInsuranceConfig] = useState(normalizeInsuranceConfig())
  const [configSaving, setConfigSaving] = useState(false)
  const [tariffUploadInsurer, setTariffUploadInsurer] = useState(INSURERS[0])
  const [remittanceImporting, setRemittanceImporting] = useState(false)
  const remittanceInputRef = useRef(null)
  const tariffInputRef = useRef(null)

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
    const [claimsRes, invRes, settingsRes] = await Promise.all([
      supabase.from('insurance_claims').select('*', { count: 'exact' })
        .eq('hospital_id', hospitalId)
        .order('submitted_at', { ascending:false })
        .range(start, end),
      supabase.from('invoices').select('*').eq('hospital_id', hospitalId)
        .not('insurer', 'is', null).neq('insurer', '')
        .order('created_at', { ascending:false }),
      supabase.from('hospital_settings').select('insurance_config').eq('hospital_id', hospitalId).maybeSingle(),
    ])
    setRecords(claimsRes.data || [])
    setClaimTotalCount(claimsRes.count || 0)
    setInvoices(invRes.data || [])
    setInsuranceConfig(normalizeInsuranceConfig(settingsRes.data?.insurance_config || {}))
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
    const tariffEntry = getTariffEntry(f.insurer, f.service)
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
      amount_kes: tariffEntry?.rate || parseFloat(f.amount_kes),
      status: finalStatus,
      submitted_at: new Date().toISOString(),
      notes: buildClaimNotes({
        source: f.source || 'Manual',
        invoice_ref: f.invoice_ref,
        invoice_id: f.invoice_id || null,
        patient_id: f.patient_id || null,
        visit_id: f.visit_id || null,
        notes: f.notes,
        tariff_rate: tariffEntry?.rate || 0,
        tariff_plan: tariffEntry?.plan || '',
        tariff_covered: tariffEntry?.covered !== false,
        required_documents: getRequiredDocuments(f.insurer),
        plan_name: tariffEntry?.plan || '',
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
    const serviceText = parseServicesField(inv.services) || 'Pharmacy / Drugs'
    const tariffEntry = getTariffEntry(inv.insurer, serviceText)
    const payload = {
      hospital_id: hospitalId,
      claim_no: genClaimNo(),
      patient_name: inv.patient_name,
      patient_id: inv.patient_id || null,
      visit_id: inv.visit_id || null,
      invoice_id: inv.id || null,
      insurer: inv.insurer,
      member_no: inv.sha_member_no || '',
      service: serviceText,
      icd10_code: '',
      auth_code: '',
      amount_kes: tariffEntry?.rate || parseFloat(inv.amount_kes || 0),
      status: 'Pending',
      submitted_at: new Date().toISOString(),
      notes: buildClaimNotes({
        source: 'Billing',
        invoice_ref: inv.invoice_no,
        invoice_id: inv.id || null,
        patient_id: inv.patient_id || null,
        visit_id: inv.visit_id || null,
        notes: inv.notes || '',
        tariff_rate: tariffEntry?.rate || 0,
        tariff_plan: tariffEntry?.plan || '',
        tariff_covered: tariffEntry?.covered !== false,
        required_documents: getRequiredDocuments(inv.insurer),
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
    const inserts = unimported.map(inv => {
      const serviceText = parseServicesField(inv.services) || 'Pharmacy / Drugs'
      const tariffEntry = getTariffEntry(inv.insurer, serviceText)
      return ({
      hospital_id: hospitalId,
      claim_no: genClaimNo(),
      patient_name: inv.patient_name,
      patient_id: inv.patient_id || null,
      visit_id: inv.visit_id || null,
      invoice_id: inv.id || null,
      insurer: inv.insurer,
      member_no: inv.sha_member_no || '',
      service: serviceText,
      icd10_code: '',
      auth_code: '',
      amount_kes: tariffEntry?.rate || parseFloat(inv.amount_kes || 0),
      status: 'Pending',
      submitted_at: new Date().toISOString(),
      notes: buildClaimNotes({
        source: 'Billing',
        invoice_ref: inv.invoice_no,
        invoice_id: inv.id || null,
        patient_id: inv.patient_id || null,
        visit_id: inv.visit_id || null,
        tariff_rate: tariffEntry?.rate || 0,
        tariff_plan: tariffEntry?.plan || '',
        tariff_covered: tariffEntry?.covered !== false,
        required_documents: getRequiredDocuments(inv.insurer),
      }),
    })})
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
    const claim = records.find(r => r.id === id) || showDetail
    if (claim && status === 'Submitted') {
      await openSubmissionChecklist(claim)
      return
    }
    setSaving(true)
    const meta = claim ? getClaimMeta(claim) : normalizeClaimMeta()
    const { error } = await supabase.from('insurance_claims').update({
      status,
      notes: buildClaimNotes({
        ...meta,
        payment_received_at: status === 'Paid' ? new Date().toISOString() : meta.payment_received_at,
      }),
    }).eq('id', id)
    if (error) {
      window.notifyFromLegacyAlert('Error updating claim: ' + error.message)
      setSaving(false)
      return
    }
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
    const meta = normalizeClaimMeta(parseClaimNotes(r.notes))
    if (meta.source) return meta.source
    return String(r.notes || '').includes('Imported from Billing') ? 'Billing' : 'Manual'
  }
  function getClaimMeta(r) {
    return normalizeClaimMeta(parseClaimNotes(r?.notes))
  }
  function getInvoiceRef(r) {
    const meta = getClaimMeta(r)
    return meta.invoice_ref || r.invoice_ref || String(r.notes || '').match(/Invoice (INV-\d+)/)?.[1] || ''
  }
  function getInvoiceId(r) {
    return r.invoice_id || getClaimMeta(r).invoice_id || ''
  }
  function getPatientId(r) {
    return r.patient_id || getClaimMeta(r).patient_id || ''
  }
  function getVisitId(r) {
    return r.visit_id || getClaimMeta(r).visit_id || ''
  }

  function getPreauthRule(insurer) {
    return insuranceConfig.preauthRules[insurer] || INSURER_RULES[insurer] || INSURER_RULES.Other
  }

  function getTariffEntry(insurer, service) {
    return insuranceConfig.tariffGuide?.[insurer]?.[service] || null
  }

  function getRequiredDocuments(insurer) {
    return insuranceConfig.documentRequirements?.[insurer] || DEFAULT_DOCUMENT_REQUIREMENTS[insurer] || ['Claim form', 'Itemized bill']
  }

  async function saveInsuranceConfig(nextConfig) {
    setConfigSaving(true)
    const payload = normalizeInsuranceConfig(nextConfig)
    const { error } = await supabase.from('hospital_settings').upsert({
      hospital_id: hospitalId,
      insurance_config: payload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'hospital_id' })
    if (error) {
      window.notifyFromLegacyAlert('Error saving insurance configuration: ' + error.message)
      setConfigSaving(false)
      return false
    }
    setInsuranceConfig(payload)
    setConfigSaving(false)
    window.notifyFromLegacyAlert('Insurance configuration saved.')
    return true
  }

  async function openSubmissionChecklist(record) {
    const meta = getClaimMeta(record)
    const documents = getRequiredDocuments(record.insurer).map(label => ({
      label,
      checked: (meta.submitted_documents || []).includes(label),
    }))
    setShowChecklistModal({ record, documents })
  }

  async function confirmSubmissionChecklist() {
    if (!showChecklistModal?.record) return
    const allChecked = showChecklistModal.documents.every(item => item.checked)
    if (!allChecked) {
      window.notifyFromLegacyAlert('Tick every required document before submitting this claim.')
      return
    }
    const record = showChecklistModal.record
    const meta = getClaimMeta(record)
    const { error } = await supabase.from('insurance_claims').update({
      status: 'Submitted',
      notes: buildClaimNotes({
        ...meta,
        submitted_documents: showChecklistModal.documents.filter(item => item.checked).map(item => item.label),
      }),
    }).eq('id', record.id)
    if (error) {
      window.notifyFromLegacyAlert('Error submitting claim: ' + error.message)
      return
    }
    setShowChecklistModal(null)
    await fetchAll()
  }

  function buildInpatientBundle(invoiceRecord) {
    const related = invoices.filter(item =>
      item.insurer === invoiceRecord.insurer &&
      ((invoiceRecord.visit_id && item.visit_id === invoiceRecord.visit_id) || (!invoiceRecord.visit_id && item.patient_id === invoiceRecord.patient_id))
    )
    const seen = new Set()
    const lineItems = []
    related.forEach(item => {
      const raw = parseServicesField(item.services)
      raw.split(';').map(part => part.trim()).filter(Boolean).forEach(service => {
        const key = service.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        lineItems.push(service)
      })
    })
    const drgGroup = Object.entries(insuranceConfig.drgGrouping || DEFAULT_DRG_MAP).find(([, services]) =>
      services.some(service => lineItems.join(' ').toLowerCase().includes(service.toLowerCase()))
    )?.[0] || 'general'
    return {
      related,
      lineItems,
      total: related.reduce((sum, item) => sum + Number(item.amount_kes || 0), 0),
      drgGroup,
    }
  }

  async function importBundledInpatientClaim(invoiceRecord) {
    const bundle = buildInpatientBundle(invoiceRecord)
    if (!bundle.related.length) {
      window.notifyFromLegacyAlert('No related inpatient invoices found to bundle.')
      return
    }
    const tariffEntry = getTariffEntry(invoiceRecord.insurer, 'Inpatient Admission')
    const payload = {
      hospital_id: hospitalId,
      claim_no: genClaimNo(),
      patient_name: invoiceRecord.patient_name,
      patient_id: invoiceRecord.patient_id || null,
      visit_id: invoiceRecord.visit_id || null,
      invoice_id: invoiceRecord.id || null,
      insurer: invoiceRecord.insurer,
      member_no: invoiceRecord.sha_member_no || '',
      service: bundle.lineItems.join('; '),
      icd10_code: '',
      auth_code: '',
      amount_kes: tariffEntry?.rate || bundle.total,
      status: 'Draft',
      submitted_at: new Date().toISOString(),
      notes: buildClaimNotes({
        source: 'Billing',
        invoice_ref: invoiceRecord.invoice_no,
        invoice_id: invoiceRecord.id || null,
        patient_id: invoiceRecord.patient_id || null,
        visit_id: invoiceRecord.visit_id || null,
        bundled_invoice_ids: bundle.related.map(item => item.id),
        bundled_line_items: bundle.lineItems,
        drg_group: bundle.drgGroup,
        tariff_rate: tariffEntry?.rate || 0,
        tariff_plan: tariffEntry?.plan || '',
        tariff_covered: tariffEntry?.covered !== false,
      }),
    }
    const { error } = await executeWithFallback(
      () => supabase.from('insurance_claims').insert(payload),
      async () => supabase.from('insurance_claims').insert(omitKeys(payload, ['patient_id', 'visit_id', 'invoice_id'])),
    )
    if (error) {
      window.notifyFromLegacyAlert('Error creating bundled claim: ' + error.message)
      return
    }
    await fetchAll()
    window.notifyFromLegacyAlert(`Bundled ${bundle.related.length} inpatient invoice(s) into one claim.`)
  }

  async function importRemittanceCsv(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setRemittanceImporting(true)
    try {
      const text = await file.text()
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      const headers = lines[0].split(',').map(item => item.trim().toLowerCase())
      const rows = lines.slice(1).map(line => {
        const values = line.split(',').map(item => item.trim())
        return headers.reduce((acc, key, index) => ({ ...acc, [key]: values[index] || '' }), {})
      })
      const report = { matched: [], unmatched: [], overpaid: [], underpaid: [], disputed: [] }

      for (const row of rows) {
        const claim = records.find(item =>
          item.claim_no === row.claim_no ||
          getInvoiceRef(item) === row.invoice_ref ||
          String(item.member_no || '').toLowerCase() === String(row.member_no || '').toLowerCase()
        )
        if (!claim) {
          report.unmatched.push(row)
          continue
        }
        const paid = Number(row.paid_amount || row.amount_paid || 0)
        const expected = Number(claim.amount_kes || 0)
        const meta = getClaimMeta(claim)
        const discrepancy = paid - expected
        if (discrepancy > 0) report.overpaid.push({ claim, paid, expected })
        else if (discrepancy < 0) report.underpaid.push({ claim, paid, expected })
        if (String(row.status || '').toLowerCase().includes('dispute')) report.disputed.push({ claim, row })

        await supabase.from('insurance_claims').update({
          status: paid >= expected ? 'Paid' : claim.status,
          notes: buildClaimNotes({
            ...meta,
            payment_received_at: row.payment_received_at || row.payment_date || new Date().toISOString(),
            remittance_ref: row.remittance_ref || row.eft_ref || row.payment_reference || '',
            remittance_status: row.status || '',
            paid_amount: paid,
          }),
        }).eq('id', claim.id)
        report.matched.push({ claim, paid, expected })
      }

      setReconciliationReport(report)
      await fetchAll()
      window.notifyFromLegacyAlert('Insurance remittance import complete.')
    } catch (error) {
      window.notifyFromLegacyAlert(error instanceof Error ? error.message : 'Remittance import failed.')
    } finally {
      event.target.value = ''
      setRemittanceImporting(false)
    }
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
  const importedRefs = new Set(records.map(r => getInvoiceRef(r)).filter(Boolean))

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
  const insurerPerformance = insurerBreakdown.map(item => {
    const insurerClaims = records.filter(record => record.insurer === item.name)
    const paidClaims = insurerClaims.filter(record => getClaimMeta(record).payment_received_at)
    const avgDaysToPay = paidClaims.length
      ? Math.round((paidClaims.reduce((sum, record) => sum + (diffDays(record.submitted_at, getClaimMeta(record).payment_received_at) || 0), 0) / paidClaims.length) * 10) / 10
      : 0
    const approvalRate = item.count > 0 ? Math.round((((item.approved || 0) + (item.paid || 0)) / item.count) * 100) : 0
    const outstandingOver45 = insurerClaims.filter(record => !['Paid', 'Rejected'].includes(record.status) && (diffDays(record.submitted_at) || 0) > 45).length
    return {
      ...item,
      totalClaimed: item.total,
      totalPaid: insurerClaims.reduce((sum, record) => sum + Number(getClaimMeta(record).paid_amount || (record.status === 'Paid' ? record.amount_kes : 0) || 0), 0),
      approvalRate,
      avgDaysToPay,
      outstandingOver45,
    }
  })
  const agingBuckets = ['0-30 days', '31-60 days', '61-90 days', '>90 days'].map(name => ({ name, value: 0 }))
  records.filter(record => !['Paid', 'Rejected'].includes(record.status)).forEach(record => {
    const bucket = getAgingBucket(diffDays(record.submitted_at) || 0)
    const entry = agingBuckets.find(item => item.name === bucket)
    if (entry) entry.value += Number(record.amount_kes || 0)
  })
  const claimStatusData = [
    { name: 'Draft', value: records.filter(record => record.status === 'Draft').length },
    { name: 'Pending', value: records.filter(record => ['Pending', 'Submitted', 'Under Review', 'Pre-auth'].includes(record.status)).length },
    { name: 'Approved', value: records.filter(record => ['Approved', 'Paid'].includes(record.status)).length },
    { name: 'Rejected', value: records.filter(record => record.status === 'Rejected').length },
  ].filter(item => item.value > 0)
  const preauthExpiringClaims = records
    .map(record => {
      const meta = getClaimMeta(record)
      const expiryDays = diffDays(new Date(), meta.preauth_expiry_date)
      const insurerRule = getPreauthRule(record.insurer)
      const ageDays = diffDays(record.submitted_at) || 0
      const insurerWindowRemaining = insurerRule?.authWindowDays ? insurerRule.authWindowDays - ageDays : null
      return {
        ...record,
        meta,
        expiryDays,
        insurerWindowRemaining,
      }
    })
    .filter(record =>
      record.meta.preauth_status ||
      record.auth_code ||
      (record.insurerWindowRemaining !== null && record.insurerWindowRemaining <= 7)
    )
    .sort((a, b) => {
      const left = a.expiryDays ?? a.insurerWindowRemaining ?? 999
      const right = b.expiryDays ?? b.insurerWindowRemaining ?? 999
      return left - right
    })
  const overduePayments = records.filter(record =>
    ['Approved', 'Submitted', 'Under Review'].includes(record.status) &&
    (diffDays(record.submitted_at) || 0) > 45
  )
  const reconciliationSummary = reconciliationReport || {
    matched: records.filter(record => getClaimMeta(record).paid_amount > 0).map(record => ({
      claim: record,
      paid: Number(getClaimMeta(record).paid_amount || 0),
      expected: Number(record.amount_kes || 0),
    })),
    unmatched: [],
    overpaid: records.filter(record => Number(getClaimMeta(record).paid_amount || 0) > Number(record.amount_kes || 0)).map(record => ({
      claim: record,
      paid: Number(getClaimMeta(record).paid_amount || 0),
      expected: Number(record.amount_kes || 0),
    })),
    underpaid: records.filter(record => {
      const paid = Number(getClaimMeta(record).paid_amount || 0)
      return paid > 0 && paid < Number(record.amount_kes || 0)
    }).map(record => ({
      claim: record,
      paid: Number(getClaimMeta(record).paid_amount || 0),
      expected: Number(record.amount_kes || 0),
    })),
    disputed: records.filter(record => String(getClaimMeta(record).remittance_status || '').toLowerCase().includes('dispute')).map(record => ({
      claim: record,
      row: { status: getClaimMeta(record).remittance_status },
    })),
  }
  const collectionsLetters = insurerPerformance.filter(item => item.outstandingOver45 > 0).map(item => ({
    insurer: item.name,
    text: `Subject: Outstanding insurance claims follow-up\n\nDear ${item.name} claims team,\n\nWe are following up on claims outstanding beyond 45 days. Current exposure is KES ${fmt(item.totalClaimed - item.totalPaid)} across ${item.outstandingOver45} claim(s).\n\nPlease share remittance status, disputed lines, and expected payment dates.\n\nRegards,\nAccounts Receivable Team`,
  }))

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
            <input ref={remittanceInputRef} type="file" accept=".csv,text/csv" style={{display:'none'}} onChange={importRemittanceCsv} />
            <input ref={tariffInputRef} type="file" accept=".csv,text/csv" style={{display:'none'}} onChange={async event => {
              const file = event.target.files?.[0]
              if (!file) return
              try {
                const text = await file.text()
                const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
                const headers = lines[0].split(',').map(item => item.trim().toLowerCase())
                const nextGuide = { ...insuranceConfig.tariffGuide, [tariffUploadInsurer]: { ...(insuranceConfig.tariffGuide?.[tariffUploadInsurer] || {}) } }
                lines.slice(1).forEach(line => {
                  const values = line.split(',').map(item => item.trim())
                  const entry = headers.reduce((acc, key, index) => ({ ...acc, [key]: values[index] || '' }), {})
                  if (!entry.service) return
                  nextGuide[tariffUploadInsurer][entry.service] = {
                    rate: Number(entry.rate || entry.amount || 0),
                    covered: String(entry.covered || 'true').toLowerCase() !== 'false',
                    plan: entry.plan || '',
                  }
                })
                await saveInsuranceConfig({ ...insuranceConfig, tariffGuide: nextGuide })
              } catch (error) {
                window.notifyFromLegacyAlert(error instanceof Error ? error.message : 'Tariff upload failed.')
              } finally {
                event.target.value = ''
              }
            }} />
            <button style={{...css.btn,...css.btnPurple}} onClick={() => setShowPreAuthTracker(true)}>
              🔐 Pre-Auth Tracker {preAuths.length > 0 && <span style={{background:C.purple,color:'#fff',borderRadius:'10px',padding:'1px 6px',fontSize:'10px',marginLeft:'4px'}}>{preAuths.length}</span>}
            </button>
            <button style={{...css.btn,...css.btnGhost}} onClick={() => setShowConfigModal(true)}>Payer Setup</button>
            <button style={{...css.btn,...css.btnGhost}} onClick={() => remittanceInputRef.current?.click()} disabled={remittanceImporting}>{remittanceImporting ? 'Importing...' : 'Import Remittance'}</button>
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
        <div style={css.kpiGrid}>
          {insurerPerformance.slice(0, 3).map(item => {
            const rateStyle = getRateBadge(item.approvalRate)
            return (
              <div key={item.name} style={css.cardPad}>
                <div style={{display:'flex',justifyContent:'space-between',gap:'10px',alignItems:'flex-start',marginBottom:'10px'}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:'14px'}}>{item.name}</div>
                    <div style={{fontSize:'11px',color:C.sub}}>Avg days to pay: {item.avgDaysToPay || '—'}</div>
                  </div>
                  <span style={{...css.badge,background:rateStyle.bg,color:rateStyle.color}}>{item.approvalRate}% approved</span>
                </div>
                <div style={{display:'grid',gap:'6px',fontSize:'12px'}}>
                  <div style={{display:'flex',justifyContent:'space-between'}}><span>Total claimed</span><strong>KES {fmt(item.totalClaimed)}</strong></div>
                  <div style={{display:'flex',justifyContent:'space-between'}}><span>Total paid</span><strong style={{color:C.primary}}>KES {fmt(item.totalPaid)}</strong></div>
                  <div style={{display:'flex',justifyContent:'space-between'}}><span>Outstanding {'>'}45d</span><strong style={{color:item.outstandingOver45 > 0 ? C.danger : C.sub}}>{item.outstandingOver45}</strong></div>
                </div>
              </div>
            )
          })}
        </div>
        <div style={css.tabRow}>
          {[
            { key:'dashboard', label:'Dashboard' },
            { key:'claims', label:'All Claims' },
            { key:'billing', label:`From Billing${unimportedInvoices.length>0?` (${unimportedInvoices.length} new)`:''}` },
            { key:'pending', label:`Pending${pending.length>0?` (${pending.length})`:''}` },
            { key:'rejected', label:`Rejected${rejected.length>0?` (${rejected.length})`:''}` },
            { key:'insurers', label:'By Insurer' },
            { key:'reconciliation', label:'Reconciliation' },
            { key:'aging', label:'Aging Report' },
            { key:'ledger', label:'Patient Ledger' },
          ].map(t => (
            <button key={t.key}
              style={{...css.tab,...(activeTab===t.key?css.tabActive:{})}}
              onClick={() => setActiveTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'dashboard' && (
          <>
            <div style={css.split}>
              <div style={css.cardPad}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:'14px'}}>Insurer Performance Dashboard</div>
                    <div style={{fontSize:'12px',color:C.sub}}>Claimed, paid, approval rate, and average days to pay by insurer.</div>
                  </div>
                </div>
                <div style={css.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={insurerPerformance.slice(0, 8)}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-12} height={56} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RechartsTooltip formatter={value => [`KES ${fmt(value)}`, '']} />
                      <Bar dataKey="totalClaimed" name="Claimed" fill={C.blue} radius={[6, 6, 0, 0]} />
                      <Bar dataKey="totalPaid" name="Paid" fill={C.primary} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={css.cardPad}>
                <div style={{fontWeight:800,fontSize:'14px',marginBottom:'4px'}}>Claims Outcome Mix</div>
                <div style={{fontSize:'12px',color:C.sub,marginBottom:'12px'}}>Live distribution of insurance claim statuses.</div>
                <div style={css.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={claimStatusData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={3}>
                        {claimStatusData.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                      </Pie>
                      <RechartsTooltip formatter={value => [`${value}`, 'Claims']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{display:'grid',gap:'8px'}}>
                  {claimStatusData.map((entry, index) => (
                    <div key={entry.name} style={{display:'flex',justifyContent:'space-between',fontSize:'12px'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}>
                        <span style={{width:'10px',height:'10px',borderRadius:'999px',background:CHART_COLORS[index % CHART_COLORS.length]}} />
                        {entry.name}
                      </span>
                      <strong>{entry.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={css.cardPad}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
                <div>
                  <div style={{fontWeight:800,fontSize:'14px'}}>Insurer Scorecards</div>
                  <div style={{fontSize:'12px',color:C.sub}}>Color-coded approval rates and outstanding follow-up risk.</div>
                </div>
                <div style={{fontSize:'12px',color:C.sub}}>{insurerPerformance.length} insurer{insurerPerformance.length !== 1 ? 's' : ''}</div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:'12px'}}>
                {insurerPerformance.map(item => {
                  const rateStyle = getRateBadge(item.approvalRate)
                  const outstandingKes = Math.max(0, item.totalClaimed - item.totalPaid)
                  return (
                    <div key={item.name} style={{border:`1px solid ${C.border}`,borderRadius:'10px',padding:'14px',background:'#FAFBFD'}}>
                      <div style={{display:'flex',justifyContent:'space-between',gap:'8px',marginBottom:'10px'}}>
                        <strong style={{fontSize:'13px'}}>{item.name}</strong>
                        <span style={{...css.badge,background:rateStyle.bg,color:rateStyle.color}}>{item.approvalRate}%</span>
                      </div>
                      <div style={{display:'grid',gap:'6px',fontSize:'12px'}}>
                        <div style={{display:'flex',justifyContent:'space-between'}}><span>Claimed</span><strong>KES {fmt(item.totalClaimed)}</strong></div>
                        <div style={{display:'flex',justifyContent:'space-between'}}><span>Paid</span><strong style={{color:C.primary}}>KES {fmt(item.totalPaid)}</strong></div>
                        <div style={{display:'flex',justifyContent:'space-between'}}><span>Avg days to pay</span><strong>{item.avgDaysToPay || '—'}</strong></div>
                        <div style={{display:'flex',justifyContent:'space-between'}}><span>Outstanding</span><strong style={{color:outstandingKes > 0 ? C.warn : C.sub}}>KES {fmt(outstandingKes)}</strong></div>
                        {item.outstandingOver45 > 0 && <div style={{fontSize:'11px',color:C.danger,fontWeight:700}}>Payment follow-up needed: {item.outstandingOver45} claim(s) over 45 days</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={css.split}>
              <div style={css.cardPad}>
                <div style={{fontWeight:800,fontSize:'14px',marginBottom:'4px'}}>Pre-Auth Expiry Tracker</div>
                <div style={{fontSize:'12px',color:C.sub,marginBottom:'12px'}}>Claims whose authorization window is about to lapse or has missing pre-auth tracking.</div>
                <div style={{display:'grid',gap:'8px'}}>
                  {preauthExpiringClaims.slice(0, 6).map(record => {
                    const expiryText = record.meta.preauth_expiry_date
                      ? `${record.expiryDays} day${record.expiryDays === 1 ? '' : 's'} to expiry`
                      : record.insurerWindowRemaining !== null
                        ? `${record.insurerWindowRemaining} day${record.insurerWindowRemaining === 1 ? '' : 's'} left in insurer auth window`
                        : 'No expiry tracked'
                    const color = (record.expiryDays !== null && record.expiryDays <= 7) || (record.insurerWindowRemaining !== null && record.insurerWindowRemaining <= 7) ? C.danger : C.warn
                    return (
                      <button key={record.id} style={{...css.uploadItem,cursor:'pointer',textAlign:'left',background:'#fff'}} onClick={() => setShowDetail(record)}>
                        <div>
                          <div style={{fontWeight:700}}>{record.patient_name}</div>
                          <div style={{fontSize:'11px',color:C.sub}}>{record.insurer} · {parseServicesField(record.service) || 'Service pending'}</div>
                        </div>
                        <div style={{fontSize:'11px',fontWeight:700,color}}>{expiryText}</div>
                      </button>
                    )
                  })}
                  {preauthExpiringClaims.length === 0 && <div style={{fontSize:'12px',color:C.sub}}>No expiring pre-auth requests right now.</div>}
                </div>
              </div>
              <div style={css.cardPad}>
                <div style={{fontWeight:800,fontSize:'14px',marginBottom:'4px'}}>Aging Exposure</div>
                <div style={{fontSize:'12px',color:C.sub,marginBottom:'12px'}}>Open claims bucketed by age for collections follow-up.</div>
                <div style={css.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={agingBuckets}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RechartsTooltip formatter={value => [`KES ${fmt(value)}`, 'Open exposure']} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                        {agingBuckets.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </>
        )}

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
                  const serviceLabel = parseServicesField(inv.services) || 'Pharmacy / Drugs'
                  const tariffEntry = getTariffEntry(inv.insurer, serviceLabel)
                  const uncovered = tariffEntry?.covered === false
                  return (
                    <tr key={inv.id} style={{opacity: imported ? 0.5 : 1}}>
                      <td style={{...css.td,fontFamily:'monospace',fontSize:'12px',color:C.sub}}>{inv.invoice_no||'—'}</td>
                      <td style={css.td}><strong>{inv.patient_name}</strong></td>
                      <td style={{...css.td,fontWeight:600,fontSize:'12px'}}>{inv.insurer||'—'}</td>
                      <td style={{...css.td,fontSize:'12px',maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {serviceLabel}
                        {tariffEntry?.plan && <div style={{fontSize:'10px',color:C.sub,marginTop:'2px'}}>Plan: {tariffEntry.plan}</div>}
                        {uncovered && <div style={{fontSize:'10px',color:C.danger,marginTop:'2px'}}>Not covered by tariff</div>}
                      </td>
                      <td style={{...css.td,fontWeight:700}}>
                        KES {fmt(inv.amount_kes)}
                        {tariffEntry?.rate > 0 && <div style={{fontSize:'10px',color:C.primary,marginTop:'2px'}}>Tariff: KES {fmt(tariffEntry.rate)}</div>}
                      </td>
                      <td style={{...css.td,color:parseFloat(inv.balance_kes||0)>0?C.warn:C.primary,fontWeight:600}}>KES {fmt(inv.balance_kes)}</td>
                      <td style={{...css.td,fontSize:'12px',color:C.sub}}>{inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-KE') : '—'}</td>
                      <td style={css.td}><Badge status={inv.status}/></td>
                      <td style={css.td}>
                        {imported ? (
                          <span style={{...css.badge,background:C.primaryL,color:C.primary}}> Imported</span>
                        ) : (
                          <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                            <button style={{...css.btn,...css.btnBlue,padding:'5px 10px',fontSize:'11px'}}
                              onClick={() => importFromBilling(inv)} disabled={saving}>
                              Import
                            </button>
                            {String(serviceLabel).toLowerCase().includes('admission') && (
                              <button
                                style={{...css.btn,background:'#F5F3FF',color:C.purple,border:'none',padding:'5px 10px',fontSize:'11px'}}
                                onClick={() => importBundledInpatientClaim(inv)}
                                disabled={saving}
                              >
                                Bundle Stay
                              </button>
                            )}
                          </div>
                        )}
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
        {activeTab === 'reconciliation' && (
          <>
            <div style={css.statsRow}>
              {[
                { label:'Matched Payments', value: reconciliationSummary.matched.length, sub:'Claims matched from remittance', color:C.primary },
                { label:'Underpaid', value: reconciliationSummary.underpaid.length, sub:'Requires follow-up', color:C.warn },
                { label:'Overpaid', value: reconciliationSummary.overpaid.length, sub:'Check remittance advice', color:C.blue },
                { label:'Disputed', value: reconciliationSummary.disputed.length, sub:'Needs clarification', color:C.danger },
                { label:'Unmatched', value: reconciliationSummary.unmatched.length, sub:'Rows not linked to claim', color:C.sub },
              ].map(item => (
                <div key={item.label} style={css.stat}>
                  <div style={css.statLbl}>{item.label}</div>
                  <div style={{...css.statVal,color:item.color}}>{item.value}</div>
                  <div style={css.statSub}>{item.sub}</div>
                </div>
              ))}
            </div>
            <div style={css.split}>
              <div style={css.cardPad}>
                <div style={{fontWeight:800,fontSize:'14px',marginBottom:'4px'}}>Reconciliation Exceptions</div>
                <div style={{fontSize:'12px',color:C.sub,marginBottom:'12px'}}>Imported insurer remittance advice matched against claim values.</div>
                <div style={{display:'grid',gap:'8px'}}>
                  {[...reconciliationSummary.underpaid, ...reconciliationSummary.overpaid].slice(0, 8).map(entry => (
                    <div key={entry.claim.id} style={css.uploadItem}>
                      <div>
                        <div style={{fontWeight:700}}>{entry.claim.claim_no || entry.claim.patient_name}</div>
                        <div style={{fontSize:'11px',color:C.sub}}>{entry.claim.insurer} · {entry.claim.patient_name}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:'11px'}}>Expected: KES {fmt(entry.expected)}</div>
                        <div style={{fontSize:'11px',fontWeight:700,color:entry.paid >= entry.expected ? C.blue : C.warn}}>Paid: KES {fmt(entry.paid)}</div>
                      </div>
                    </div>
                  ))}
                  {reconciliationSummary.matched.length === 0 && reconciliationSummary.underpaid.length === 0 && reconciliationSummary.overpaid.length === 0 && (
                    <div style={{fontSize:'12px',color:C.sub}}>No remittance data imported yet. Use “Import Remittance” to start reconciliation.</div>
                  )}
                </div>
              </div>
              <div style={css.cardPad}>
                <div style={{fontWeight:800,fontSize:'14px',marginBottom:'4px'}}>Reconciliation Summary</div>
                <div style={{fontSize:'12px',color:C.sub,marginBottom:'12px'}}>A clean accounts-receivable snapshot after EFT import.</div>
                <div style={{display:'grid',gap:'10px',fontSize:'12px'}}>
                  <div style={css.uploadItem}><span>Total matched value</span><strong>KES {fmt(reconciliationSummary.matched.reduce((sum, item) => sum + Number(item.paid || 0), 0))}</strong></div>
                  <div style={css.uploadItem}><span>Underpaid exposure</span><strong style={{color:C.warn}}>KES {fmt(reconciliationSummary.underpaid.reduce((sum, item) => sum + Math.max(0, Number(item.expected || 0) - Number(item.paid || 0)), 0))}</strong></div>
                  <div style={css.uploadItem}><span>Overpaid value</span><strong style={{color:C.blue}}>KES {fmt(reconciliationSummary.overpaid.reduce((sum, item) => sum + Math.max(0, Number(item.paid || 0) - Number(item.expected || 0)), 0))}</strong></div>
                  <div style={css.uploadItem}><span>Disputed claims</span><strong style={{color:C.danger}}>{reconciliationSummary.disputed.length}</strong></div>
                  <button
                    style={{...css.btn,...css.btnGhost,justifySelf:'start'}}
                    onClick={() => exportCSV(
                      reconciliationSummary.matched.map(item => ({
                        claim_no: item.claim.claim_no,
                        patient_name: item.claim.patient_name,
                        insurer: item.claim.insurer,
                        amount_kes: item.expected,
                        paid_amount: item.paid,
                        status: item.claim.status,
                        remittance_ref: getClaimMeta(item.claim).remittance_ref,
                      })),
                      `insurance_reconciliation_${new Date().toISOString().slice(0, 10)}.csv`
                    )}
                    disabled={!isAdmin}
                    title={!isAdmin ? 'Admin only' : ''}
                  >
                    Export Reconciliation CSV
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'aging' && (
          <>
            <div style={css.split}>
              <div style={css.cardPad}>
                <div style={{fontWeight:800,fontSize:'14px',marginBottom:'4px'}}>Outstanding Aging</div>
                <div style={{fontSize:'12px',color:C.sub,marginBottom:'12px'}}>KES exposure by claims age bucket.</div>
                <div style={css.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={agingBuckets}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RechartsTooltip formatter={value => [`KES ${fmt(value)}`, 'Exposure']} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                        {agingBuckets.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={css.cardPad}>
                <div style={{fontWeight:800,fontSize:'14px',marginBottom:'4px'}}>Collections Queue</div>
                <div style={{fontSize:'12px',color:C.sub,marginBottom:'12px'}}>Approved or submitted claims older than 45 days.</div>
                <div style={{display:'grid',gap:'8px'}}>
                  {overduePayments.slice(0, 8).map(record => (
                    <div key={record.id} style={css.uploadItem}>
                      <div>
                        <div style={{fontWeight:700}}>{record.patient_name}</div>
                        <div style={{fontSize:'11px',color:C.sub}}>{record.insurer} · {record.claim_no || 'No claim no.'}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:'11px',color:C.danger,fontWeight:700}}>{diffDays(record.submitted_at)} days outstanding</div>
                        <div style={{fontSize:'11px'}}>KES {fmt(record.amount_kes)}</div>
                      </div>
                    </div>
                  ))}
                  {overduePayments.length === 0 && <div style={{fontSize:'12px',color:C.sub}}>No overdue approved claims at the moment.</div>}
                </div>
              </div>
            </div>
            <div style={css.card}>
              <div style={css.cardHead}>
                <span>Collections Letter Templates</span>
                <span style={{fontSize:'12px',color:C.sub}}>{collectionsLetters.length} overdue insurer{collectionsLetters.length !== 1 ? 's' : ''}</span>
              </div>
              <table style={css.table}>
                <thead>
                  <tr>
                    {['Insurer','Outstanding Claims > 45d','Estimated Exposure','Action'].map(label => <th key={label} style={css.th}>{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {collectionsLetters.length === 0 && (
                    <tr><td colSpan={4} style={{...css.td,textAlign:'center',color:C.sub,padding:'32px'}}>No overdue collections letters needed right now.</td></tr>
                  )}
                  {collectionsLetters.map(letter => {
                    const item = insurerPerformance.find(entry => entry.name === letter.insurer)
                    return (
                      <tr key={letter.insurer}>
                        <td style={{...css.td,fontWeight:700}}>{letter.insurer}</td>
                        <td style={{...css.td,color:C.danger,fontWeight:700}}>{item?.outstandingOver45 || 0}</td>
                        <td style={{...css.td}}>KES {fmt(Math.max(0, (item?.totalClaimed || 0) - (item?.totalPaid || 0)))}</td>
                        <td style={css.td}>
                          <button style={{...css.btn,...css.btnGhost,padding:'6px 10px'}} onClick={() => setShowCollectionsModal(letter)}>Open Letter</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

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
              <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setShowAdd(false)}>Close</button>
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
            {(() => {
              const tariffEntry = getTariffEntry(f.insurer, f.service)
              const requiredDocs = getRequiredDocuments(f.insurer)
              return (
                <div style={{display:'grid',gap:'8px',marginBottom:'12px'}}>
                  <div style={css.uploadItem}>
                    <span>Tariff guide</span>
                    <strong style={{color:tariffEntry?.covered === false ? C.danger : C.primary}}>
                      {tariffEntry ? `KES ${fmt(tariffEntry.rate)}${tariffEntry.plan ? ` · ${tariffEntry.plan}` : ''}` : 'No tariff configured'}
                    </strong>
                  </div>
                  <div style={css.uploadItem}>
                    <span>Coverage</span>
                    <strong style={{color:tariffEntry?.covered === false ? C.danger : C.text}}>
                      {tariffEntry?.covered === false ? 'Flagged as not covered' : 'Covered / not restricted'}
                    </strong>
                  </div>
                  <div style={css.uploadItem}>
                    <span>Required documents</span>
                    <strong>{requiredDocs.join(', ')}</strong>
                  </div>
                </div>
              )
            })()}

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
              <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setShowDetail(null)}>Close</button>
            </div>

            {/* Status badge + source */}
            <div style={{display:'flex',gap:'8px',marginBottom:'16px',alignItems:'center'}}>
              <Badge status={showDetail.status}/>
              <SourceBadge source={getSource(showDetail)}/>
              {showDetail.claim_no && <span style={{fontFamily:'monospace',fontSize:'12px',color:C.sub}}>#{showDetail.claim_no}</span>}
            </div>

            <div style={{display:'grid',gap:'8px',marginBottom:'12px'}}>
              {(() => {
                const meta = getClaimMeta(showDetail)
                const requiredDocs = getRequiredDocuments(showDetail.insurer)
                return (
                  <>
                    {meta.preauth_status && <div style={css.uploadItem}><span>Pre-auth status</span><strong>{meta.preauth_status}</strong></div>}
                    {meta.preauth_expiry_date && <div style={css.uploadItem}><span>Pre-auth expiry</span><strong>{new Date(meta.preauth_expiry_date).toLocaleDateString('en-KE')}</strong></div>}
                    <div style={css.uploadItem}><span>Documents checked</span><strong>{meta.submitted_documents?.length || 0}/{requiredDocs.length}</strong></div>
                    {meta.remittance_ref && <div style={css.uploadItem}><span>Remittance ref</span><strong style={css.mono}>{meta.remittance_ref}</strong></div>}
                  </>
                )
              })()}
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
              <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={() => openSubmissionChecklist(showDetail)}>Documents Checklist</button>
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
                <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setShowPatientLedger(null)}>Close</button>
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
              <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setShowPreAuthTracker(false)}>Close</button>
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

      {showChecklistModal && (
        <div style={css.overlay} onClick={() => setShowChecklistModal(null)}>
          <div style={css.modal} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
              <div style={css.modalH}>Claim Document Checklist</div>
              <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setShowChecklistModal(null)}>Close</button>
            </div>
            <div style={{fontSize:'12px',color:C.sub,marginBottom:'14px'}}>
              {showChecklistModal.record.insurer} requires every checked document before claim submission.
            </div>
            <div style={{display:'grid',gap:'10px'}}>
              {showChecklistModal.documents.map((item, index) => (
                <label key={item.label} style={css.checklistRow}>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={event => setShowChecklistModal(current => ({
                      ...current,
                      documents: current.documents.map((doc, docIndex) =>
                        docIndex === index ? { ...doc, checked: event.target.checked } : doc
                      ),
                    }))}
                  />
                  <div>
                    <div style={{fontWeight:700,fontSize:'12px'}}>{item.label}</div>
                    <div style={{fontSize:'11px',color:C.sub}}>Required for insurer submission.</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{display:'flex',gap:'8px',marginTop:'16px'}}>
              <button style={{...css.btn,...css.btnGhost,flex:1}} onClick={() => setShowChecklistModal(null)}>Cancel</button>
              <button style={{...css.btn,...css.btnPri,flex:2}} onClick={confirmSubmissionChecklist}>Confirm & Submit</button>
            </div>
          </div>
        </div>
      )}

      {showConfigModal && (
        <div style={css.overlay} onClick={() => setShowConfigModal(false)}>
          <div style={css.modalWide} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
              <div style={css.modalH}>Payer Setup</div>
              <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setShowConfigModal(false)}>Close</button>
            </div>
            <div style={css.grid2}>
              <div>
                <label style={css.lbl}>Insurer</label>
                <select style={{...css.input,cursor:'pointer'}} value={tariffUploadInsurer} onChange={e => setTariffUploadInsurer(e.target.value)}>
                  {insurerOptions.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
                <label style={css.lbl}>Pre-auth required</label>
                <select
                  style={{...css.input,cursor:'pointer'}}
                  value={String(getPreauthRule(tariffUploadInsurer)?.requiresAuth !== false)}
                  onChange={e => setInsuranceConfig(current => ({
                    ...current,
                    preauthRules: {
                      ...current.preauthRules,
                      [tariffUploadInsurer]: {
                        ...(getPreauthRule(tariffUploadInsurer) || {}),
                        requiresAuth: e.target.value === 'true',
                      },
                    },
                  }))}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
                <label style={css.lbl}>Pre-auth validity (days)</label>
                <input
                  style={css.input}
                  type="number"
                  value={getPreauthRule(tariffUploadInsurer)?.authWindowDays || ''}
                  onChange={e => setInsuranceConfig(current => ({
                    ...current,
                    preauthRules: {
                      ...current.preauthRules,
                      [tariffUploadInsurer]: {
                        ...(getPreauthRule(tariffUploadInsurer) || {}),
                        authWindowDays: Number(e.target.value || 0),
                      },
                    },
                  }))}
                />
                <label style={css.lbl}>Outpatient cap (KES)</label>
                <input
                  style={css.input}
                  type="number"
                  value={getPreauthRule(tariffUploadInsurer)?.outpatientCap || ''}
                  onChange={e => setInsuranceConfig(current => ({
                    ...current,
                    preauthRules: {
                      ...current.preauthRules,
                      [tariffUploadInsurer]: {
                        ...(getPreauthRule(tariffUploadInsurer) || {}),
                        outpatientCap: Number(e.target.value || 0),
                      },
                    },
                  }))}
                />
              </div>
              <div>
                <label style={css.lbl}>Required claim documents</label>
                <textarea
                  style={{...css.input,minHeight:'120px',resize:'vertical'}}
                  value={(insuranceConfig.documentRequirements?.[tariffUploadInsurer] || []).join('\n')}
                  onChange={e => setInsuranceConfig(current => ({
                    ...current,
                    documentRequirements: {
                      ...current.documentRequirements,
                      [tariffUploadInsurer]: e.target.value.split('\n').map(line => line.trim()).filter(Boolean),
                    },
                  }))}
                />
                <label style={css.lbl}>Manual tariff guide</label>
                <textarea
                  style={{...css.input,minHeight:'120px',resize:'vertical'}}
                  value={Object.entries(insuranceConfig.tariffGuide?.[tariffUploadInsurer] || {})
                    .map(([service, entry]) => `${service}|${entry.rate || 0}|${entry.covered !== false ? 'covered' : 'not-covered'}|${entry.plan || ''}`)
                    .join('\n')}
                  onChange={e => {
                    const nextEntries = {}
                    e.target.value.split('\n').map(line => line.trim()).filter(Boolean).forEach(line => {
                      const [service, rate, covered, plan] = line.split('|')
                      if (!service) return
                      nextEntries[service.trim()] = {
                        rate: Number(rate || 0),
                        covered: String(covered || 'covered').toLowerCase() !== 'not-covered',
                        plan: (plan || '').trim(),
                      }
                    })
                    setInsuranceConfig(current => ({
                      ...current,
                      tariffGuide: {
                        ...current.tariffGuide,
                        [tariffUploadInsurer]: nextEntries,
                      },
                    }))
                  }}
                />
                <div style={{display:'flex',gap:'8px'}}>
                  <button style={{...css.btn,...css.btnGhost}} onClick={() => tariffInputRef.current?.click()}>Upload Tariff CSV</button>
                  <button style={{...css.btn,...css.btnPri}} onClick={() => saveInsuranceConfig(insuranceConfig)} disabled={configSaving}>
                    {configSaving ? 'Saving...' : 'Save Payer Setup'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCollectionsModal && (
        <div style={css.overlay} onClick={() => setShowCollectionsModal(null)}>
          <div style={css.modal} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
              <div style={css.modalH}>Collections Letter</div>
              <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setShowCollectionsModal(null)}>Close</button>
            </div>
            <div style={{fontSize:'12px',color:C.sub,marginBottom:'10px'}}>{showCollectionsModal.insurer}</div>
            <textarea readOnly style={{...css.input,minHeight:'260px',resize:'vertical'}} value={showCollectionsModal.text} />
            <div style={{display:'flex',gap:'8px'}}>
              <button
                style={{...css.btn,...css.btnGhost}}
                onClick={async () => {
                  await navigator.clipboard.writeText(showCollectionsModal.text)
                  window.notifyFromLegacyAlert('Collections letter copied.')
                }}
              >
                Copy Letter
              </button>
              <button style={{...css.btn,...css.btnPri}} onClick={() => setShowCollectionsModal(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
