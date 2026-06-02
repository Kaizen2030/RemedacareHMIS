import { useEffect, useMemo, useRef, useState } from 'react'
import SkeletonLoader from '../components/SkeletonLoader'
import supabase from '../supabase'
import { useHospital } from '../context'
import { executeWithFallback, omitKeys } from '../utils/dbCompat'
import { broadcastWorkflowChanged } from '../utils/workflowEvents'
import { colors as C, typography } from '../theme'
import { searchIcd10Diagnoses } from '../utils/icd10Kenya'
import { validatePrescriptionPpb } from '../utils/ppbCatalogue'
import { buildMessage, DEFAULT_TEMPLATES, fetchNotificationConfig, getNotificationSetting, sendPatientNotification } from '../utils/notifications'
import { submitShaClaimViaFhir } from '../utils/fhir/client'
import {
 Bar,
 BarChart,
 CartesianGrid,
 Cell,
 Line,
 LineChart,
 Pie,
 PieChart,
 ResponsiveContainer,
 Tooltip as RechartsTooltip,
 XAxis,
 YAxis,
} from 'recharts'

const STATUS_COLORS = {
 Submitted: { bg: C.blueL, color: C.blue },
 Approved: { bg: C.primaryL, color: C.primary },
 Rejected: { bg: C.dangerL, color: C.danger },
 Pending: { bg: C.warnL, color: C.warn },
 Paid: { bg: C.primaryL, color: C.primary },
 'Under Review': { bg: C.blueL, color: C.blue },
 Appealed: { bg: '#F3F4F6', color: C.sub },
 Draft: { bg: '#F3F4F6', color: C.sub },
 'Submitted to SHA': { bg: C.blueL, color: C.blue },
 Expired: { bg: C.warnL, color: C.warn },
 Filed: { bg: C.blueL, color: C.blue },
 Upheld: { bg: C.primaryL, color: C.primary },
 Dismissed: { bg: C.dangerL, color: C.danger },
}

const FHIR_STATUS_COLORS = {
 'Not Submitted': { bg: '#F3F4F6', color: C.sub },
 Submitted: { bg: C.blueL, color: C.blue },
 Accepted: { bg: C.primaryL, color: C.primary },
 Rejected: { bg: C.dangerL, color: C.danger },
 Error: { bg: C.dangerL, color: C.danger },
}

const REVIEW_STATUS_COLORS = {
 PASS: { bg: C.primaryL, color: C.primary },
 WARN: { bg: C.warnL, color: C.warn },
 FAIL: { bg: C.dangerL, color: C.danger },
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
 textarea: { width:'100%', boxSizing:'border-box', padding:'9px 11px', border:`1px solid ${C.border}`, borderRadius:'7px', fontSize:'13px', color:C.text, outline:'none', background:C.surface, marginBottom:'12px', resize:'vertical', minHeight:'72px', fontFamily:'inherit' },
 grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' },
 divider: { border:'none', borderTop:`1px solid ${C.border}`, margin:'16px 0' },
 hint: { fontSize:'11px', color:C.sub, marginTop:'-4px', marginBottom:'12px' },
 miniBtn: { padding:'4px 8px', borderRadius:'6px', border:'none', cursor:'pointer', fontSize:'11px', fontWeight:600 },
 reviewCard: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'18px 20px', marginBottom:'16px' },
 reviewIssue: { border:`1px solid ${C.border}`, borderRadius:'10px', padding:'12px 14px', background:'#FAFBFD' },
 progressTrack: { width:'100%', height:'10px', background:'#E5E7EB', borderRadius:'999px', overflow:'hidden' },
 progressFill: { height:'100%', borderRadius:'999px' },
 cardPad: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px 18px' },
 kpiGrid: { display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:'12px', marginBottom:'16px' },
 sectionTitle: { fontSize:'12px', fontWeight:700, textTransform:'uppercase', letterSpacing:'.4px', color:C.sub, marginBottom:'10px' },
 uploadList: { display:'grid', gap:'8px', marginTop:'8px', marginBottom:'12px' },
 uploadItem: { display:'flex', justifyContent:'space-between', alignItems:'center', gap:'10px', padding:'8px 10px', border:`1px solid ${C.border}`, borderRadius:'8px', background:'#FAFBFD', fontSize:'12px' },
 flagRow: { display:'flex', flexWrap:'wrap', gap:'6px', marginTop:'6px' },
 flagBadge: { display:'inline-flex', alignItems:'center', gap:'6px', padding:'3px 8px', borderRadius:'999px', fontSize:'10px', fontWeight:700, textTransform:'uppercase', letterSpacing:'.35px' },
 stepRow: { display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' },
 stepDot: { width:'12px', height:'12px', borderRadius:'999px', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:'8px', fontWeight:800 },
 checklistItem: { display:'flex', justifyContent:'space-between', gap:'12px', padding:'10px 12px', border:`1px solid ${C.border}`, borderRadius:'8px', background:'#FAFBFD' },
 textBtn: { border:'none', background:'transparent', color:C.primary, cursor:'pointer', fontWeight:700, padding:0, fontSize:'12px' },
 chartWrap: { height:'280px' },
 splitGrid: { display:'grid', gridTemplateColumns:'1.1fr .9fr', gap:'16px' },
 mono: { fontFamily:'monospace', fontSize:'12px' },
}

const PAGE_SIZE = 100
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

const SHA_SERVICES = [
 'Outpatient Consultation','Inpatient Admission','Laboratory Tests','Pharmacy / Drugs',
 'Surgical Procedure','Maternity / Delivery','Radiology / Imaging','Physiotherapy',
 'Dental','Eye / Optical','Emergency Services','Mental Health','Chronic Disease Management',
]

const PREAUTH_REQUIRED_SERVICES = new Set([
 'Inpatient Admission',
 'Surgical Procedure',
 'Maternity / Delivery',
 'Radiology / Imaging',
 'Emergency Services',
])

const SHA_BENEFIT_LIMITS = {
 'Outpatient Consultation': 1000,
 'Inpatient Admission': 25000,
 'Laboratory Tests': 5000,
 'Pharmacy / Drugs': 7000,
 'Surgical Procedure': 85000,
 'Maternity / Delivery': 45000,
 'Radiology / Imaging': 15000,
 'Physiotherapy': 4000,
 Dental: 6000,
 'Eye / Optical': 8000,
 'Emergency Services': 30000,
 'Mental Health': 10000,
 'Chronic Disease Management': 12000,
}

const REJECTION_REASON_GUIDE = {
 MISSING_ICD10: {
  label: 'Missing / Invalid ICD-10',
  explanation: 'SHA could not process the claim because the diagnosis code is missing, malformed, or not clinically aligned.',
  fixes: ['Confirm the diagnosis in the chart.', 'Select a valid ICD-10 code.', 'Ensure the diagnosis matches the claimed service.'],
 },
 PREAUTH_REQUIRED: {
  label: 'Pre-Authorization Missing',
  explanation: 'This claim needs an approved pre-authorization reference before SHA can reimburse it.',
  fixes: ['Open the linked pre-auth request.', 'Enter the SHA pre-auth number.', 'Confirm approval was granted before submission.'],
 },
 MEMBERSHIP_NOT_VERIFIED: {
  label: 'SHA Membership Not Verified',
  explanation: 'The patient SHA member number could not be matched or is missing from the claim.',
  fixes: ['Confirm the member number from the patient card.', 'Update the patient SHA record if needed.', 'Re-run membership verification before resubmission.'],
 },
 OUTSIDE_BENEFIT_PACKAGE: {
  label: 'Outside SHA Benefit Package',
  explanation: 'The requested service is not mapped to the SHA benefit package currently configured for this hospital.',
  fixes: ['Confirm the correct service category.', 'Move non-covered items to self-pay.', 'Attach justification if exceptional coverage was granted.'],
 },
 LIMIT_EXCEEDED: {
  label: 'Claim Amount Above Limit',
  explanation: 'The amount claimed is higher than the pre-auth or benefit-package approval ceiling.',
  fixes: ['Reduce the claim to the approved amount.', 'Attach a revised pre-auth approval.', 'Split non-covered charges out of the SHA claim.'],
 },
 SUPPORTING_DOCS: {
  label: 'Supporting Documents Missing',
  explanation: 'Required clinical attachments were not present on the claim or pre-authorization record.',
  fixes: ['Upload discharge summary or operative notes.', 'Attach referral and clinician notes.', 'Re-submit once the document pack is complete.'],
 },
}

const REJECTION_REASON_OPTIONS = Object.keys(REJECTION_REASON_GUIDE)
const ANALYTICS_COLORS = ['#2563EB', '#0F766E', '#D97706', '#7C3AED', '#DC2626', '#475569', '#16A34A']
const PREAUTH_PIPELINE = ['Draft', 'Submitted to SHA', 'Pending', 'Approved', 'Rejected']

function normalizeClaimMeta(meta = {}) {
 return {
  source: meta.source || 'Manual',
  invoice_no: meta.invoice_no || '',
  invoice_id: meta.invoice_id || null,
  patient_id: meta.patient_id || null,
  visit_id: meta.visit_id || null,
  notes: meta.notes || '',
  cpt_code: meta.cpt_code || '',
  icd10_code: meta.icd10_code || '',
  icd10_description: meta.icd10_description || '',
  service_requested: meta.service_requested || '',
  benefit_package: meta.benefit_package || '',
  preauth_id: meta.preauth_id || null,
  preauth_number: meta.preauth_number || '',
  approved_limit: Number(meta.approved_limit || 0),
  verified_sha_membership: meta.verified_sha_membership === true,
  supporting_documents: Array.isArray(meta.supporting_documents) ? meta.supporting_documents : [],
  validation_checks: Array.isArray(meta.validation_checks) ? meta.validation_checks : [],
  rejection: meta.rejection && typeof meta.rejection === 'object' ? meta.rejection : {},
  resubmissions: Array.isArray(meta.resubmissions) ? meta.resubmissions : [],
  appeal: meta.appeal && typeof meta.appeal === 'object' ? meta.appeal : {},
  approved_at: meta.approved_at || null,
  payment_received_at: meta.payment_received_at || null,
  submitted_to_sha_at: meta.submitted_to_sha_at || null,
  payment_reference: meta.payment_reference || '',
 }
}

function parseClaimNotes(notes) {
 try {
  return JSON.parse(notes || '{}')
 } catch {
  return {}
 }
}

function buildClaimNotes(meta = {}) {
 return JSON.stringify(normalizeClaimMeta(meta))
}

function getClaimSource(record) {
 const meta = normalizeClaimMeta(parseClaimNotes(record?.notes))
 if (meta.source) return meta.source
 return record?.notes?.includes('Imported from Billing') ? 'Billing' : 'Manual'
}

function getClaimNotesText(record) {
 const meta = normalizeClaimMeta(parseClaimNotes(record?.notes))
 return meta.notes || record?.notes || ''
}

function getClaimMeta(record) {
 return normalizeClaimMeta(parseClaimNotes(record?.notes))
}

function isValidIcd10Code(code) {
 return /\b[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?\b/.test(String(code || '').trim().toUpperCase())
}

function formatDateTimeInput(value) {
 if (!value) return ''
 const date = new Date(value)
 if (Number.isNaN(date.getTime())) return ''
 const pad = item => String(item).padStart(2, '0')
 return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
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

function diffHours(from, to = new Date()) {
 const left = safeDate(from)
 const right = safeDate(to)
 if (!left || !right) return null
 return Math.max(0, Math.round(((right.getTime() - left.getTime()) / 3600000) * 10) / 10)
}

function getRejectionGuide(code) {
 return REJECTION_REASON_GUIDE[code] || {
  label: code || 'Custom rejection',
  explanation: 'Review the claim details, supporting documents, and pre-authorization trail before resubmitting.',
  fixes: ['Update the claim record.', 'Attach the missing evidence.', 'Resubmit after correction.'],
 }
}

function getAppealDaysRemaining(record) {
 const appeal = getClaimMeta(record).appeal || {}
 const dueDate = appeal.due_date || getClaimMeta(record).rejection?.appeal_due_date
 const due = safeDate(dueDate)
 if (!due) return null
 return Math.ceil((due.getTime() - Date.now()) / 86400000)
}

function getClaimFlags(record) {
 const meta = getClaimMeta(record)
 const flags = []
 const pendingDays = diffDays(meta.submitted_to_sha_at || record.created_at)
 const approvedDays = diffDays(meta.approved_at)
 const appealDays = getAppealDaysRemaining(record)

 if (['Pending', 'Submitted', 'Submitted to SHA', 'Under Review'].includes(record.status) && pendingDays !== null && pendingDays > 14) {
  flags.push({ label: 'Follow Up', bg: C.warnL, color: C.warn, detail: `${pendingDays} days pending SHA response` })
 }
 if (record.status === 'Approved' && !meta.payment_received_at && approvedDays !== null && approvedDays > 30) {
  flags.push({ label: 'Payment Overdue', bg: C.dangerL, color: C.danger, detail: `${approvedDays} days since approval` })
 }
 if (record.status === 'Rejected' && appealDays !== null && appealDays >= 0 && appealDays <= 7 && !['Filed', 'Under Review', 'Upheld'].includes(meta.appeal?.status || '')) {
  flags.push({ label: 'Appeal Due', bg: C.dangerL, color: C.danger, detail: `${appealDays} day${appealDays === 1 ? '' : 's'} remaining` })
 }
 return flags
}

function getPreauthTimelineStatus(status) {
 const index = PREAUTH_PIPELINE.indexOf(status)
 return index === -1 ? 0 : index
}

function Badge({ status }) {
 const sc = STATUS_COLORS[status] || { bg:'#F3F4F6', color:C.sub }
 return <span style={{...css.badge, background:sc.bg, color:sc.color}}>{status || '—'}</span>
}

function ReviewBadge({ overall, compact = false }) {
 const sc = REVIEW_STATUS_COLORS[overall] || { bg:'#F3F4F6', color:C.sub }
 return (
  <span style={{...css.badge, background:sc.bg, color:sc.color, padding: compact ? '2px 7px' : '2px 9px', fontSize: compact ? '10px' : '11px'}}>
   {overall || 'No Review'}
  </span>
 )
}

function FhirBadge({ status }) {
 const normalized = String(status || 'Not Submitted')
 const sc = FHIR_STATUS_COLORS[normalized] || { bg: '#F3F4F6', color: C.sub }
 return <span style={{ ...css.badge, background: sc.bg, color: sc.color }}>{normalized}</span>
}

function normalizeReviewIssue(issue) {
 return {
  severity: ['error', 'warning', 'info'].includes(String(issue?.severity || '').toLowerCase()) ? String(issue.severity).toLowerCase() : 'info',
  field: String(issue?.field || 'claim'),
  message: String(issue?.message || ''),
  fix: String(issue?.fix || ''),
 }
}

function parseReviewIssues(value) {
 if (Array.isArray(value)) return value.map(normalizeReviewIssue)
 try {
  const parsed = JSON.parse(value || '[]')
  return Array.isArray(parsed) ? parsed.map(normalizeReviewIssue) : []
 } catch {
  return []
 }
}

function formatCurrency(value) {
 return `KES ${Number(value || 0).toLocaleString()}`
}

function formatDate(value, withTime = false) {
 if (!value) return '—'
 const date = new Date(value)
 return withTime ? date.toLocaleString('en-KE') : date.toLocaleDateString('en-KE')
}

function getReviewSeverityStyle(severity) {
 if (severity === 'error') return { bg:C.dangerL, color:C.danger, icon:'âš ï¸' }
 if (severity === 'warning') return { bg:C.warnL, color:C.warn, icon:'âš ' }
 return { bg:C.blueL, color:C.blue, icon:'â„¹ï¸' }
}

function extractIcdCode(text) {
 const match = String(text || '').match(/\b[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?\b/)
 return match ? match[0] : ''
}

function extractCurrencyAmount(text) {
 const match = String(text || '').replace(/,/g, '').match(/(?:KES\s*)?([0-9]+(?:\.[0-9]+)?)/i)
 return match ? match[1] : ''
}

function extractServiceType(text) {
 const source = String(text || '').toLowerCase()
 return SHA_SERVICES.find(item => source.includes(item.toLowerCase())) || ''
}

function isWithinClaimWindow(claimDate, prescriptionDate) {
 if (!claimDate || !prescriptionDate) return true
 const left = new Date(claimDate)
 const right = new Date(prescriptionDate)
 if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return true
 const diff = Math.abs(right.getTime() - left.getTime())
 return diff <= 14 * 24 * 60 * 60 * 1000
}

async function readFunctionError(error) {
 if (!error) return 'Request failed.'
 if (error.context && typeof error.context.text === 'function') {
  const raw = await error.context.text()
  try {
   const parsed = JSON.parse(raw)
   return parsed?.error || parsed?.message || raw || error.message
  } catch {
   return raw || error.message
  }
 }
 return error.message || 'Request failed.'
}

function PreauthIcd10Field({ form, setForm }) {
 const [query, setQuery] = useState(form.icd10_description || form.procedure_notes || '')
 const [results, setResults] = useState([])
 const [open, setOpen] = useState(false)
 const [loading, setLoading] = useState(false)

 useEffect(() => {
  setQuery(form.icd10_description || '')
 }, [form.icd10_description])

 useEffect(() => {
  const value = String(query || '').trim()
  if (value.length < 2) {
   setResults([])
   setLoading(false)
   return undefined
  }

  let active = true
  setLoading(true)
  const timer = window.setTimeout(async () => {
   const items = await searchIcd10Diagnoses(value)
   if (!active) return
   setResults(items)
   setLoading(false)
  }, 200)

  return () => {
   active = false
   window.clearTimeout(timer)
  }
 }, [query])

 function applyItem(item) {
  setForm({
   ...form,
   icd10_code: item.code,
   icd10_description: item.description,
  })
  setQuery(item.description)
  setOpen(false)
 }

 return (
  <div style={{ position:'relative' }}>
   <label style={css.lbl}>Proposed Procedure / Diagnosis</label>
   <input
    style={css.input}
    placeholder="Search ICD-10 diagnosis"
    value={query}
    onFocus={() => setOpen(true)}
    onChange={e => {
     const value = e.target.value
     setQuery(value)
     setOpen(true)
     setForm({
      ...form,
      icd10_code: '',
      icd10_description: value,
     })
    }}
   />
   <div style={css.hint}>
    {form.icd10_code ? `${form.icd10_code} — ${form.icd10_description}` : 'Pick an ICD-10 code or type a diagnosis description.'}
   </div>
   {open && (
    <div style={{ position:'absolute', top:'calc(100% - 8px)', left:0, right:0, background:C.surface, border:`1px solid ${C.border}`, borderRadius:'8px', boxShadow:'0 12px 24px rgba(15,23,42,.10)', zIndex:10, maxHeight:'220px', overflowY:'auto' }}>
     {loading && <div style={{ padding:'10px 12px', fontSize:'12px', color:C.sub }}>Searching ICD-10...</div>}
     {!loading && results.map(item => (
      <button
       key={`${item.code}-${item.description}`}
       type="button"
       onClick={() => applyItem(item)}
       style={{ width:'100%', border:'none', background:'transparent', textAlign:'left', padding:'10px 12px', cursor:'pointer', borderBottom:`1px solid ${C.border}` }}
      >
       <div style={{ fontSize:'11px', fontWeight:700, color:C.primary }}>{item.code}</div>
       <div style={{ fontSize:'12px', color:C.text, marginTop:'2px' }}>{item.description}</div>
      </button>
     ))}
     {!loading && !results.length && String(query || '').trim().length >= 2 && (
      <div style={{ padding:'10px 12px', fontSize:'12px', color:C.sub }}>No ICD-10 match found. Free-text description will be saved.</div>
     )}
    </div>
   )}
  </div>
 )
}

const emptyForm = {
 patient_name: '', sha_number: '', id_number: '',
 service_type: SHA_SERVICES[0], amount_claimed: '',
 visit_date: new Date().toISOString().slice(0,10),
 notes: '', status: 'Pending', patient_id: '', visit_id: '', invoice_id: '',
}

const emptyPreauthForm = {
 patient_search: '',
 patient_id: '',
 patient_name: '',
 patient_number: '',
 sha_number: '',
 id_number: '',
 visit_id: '',
 admission_type: 'Elective',
 service_requested: '',
 icd10_code: '',
 icd10_description: '',
 procedure_code: '',
 procedure_notes: '',
 estimated_cost: '',
 requesting_doctor: '',
 supporting_documents: [],
 status: 'Draft',
}

export default function SHAClaims() {
 const { hospitalId, hospitalName, userRole } = useHospital()
 const isAdmin = ['Admin','admin'].includes(userRole || '')
 const [loading, setLoading] = useState(true)
 const [saving, setSaving] = useState(false)
 const [activeTab, setActiveTab] = useState('claims')
 const [claims, setClaims] = useState([])
 const [shaInvoices, setShaInvoices] = useState([])
 const [preauths, setPreauths] = useState([])
  const [claimPage, setClaimPage] = useState(1)
  const [claimPageSize, setClaimPageSize] = useState(PAGE_SIZE)
  const [claimTotalCount, setClaimTotalCount] = useState(0)
 const [search, setSearch] = useState('')
 const [dateFilter, setDateFilter] = useState('all')
 const [statusFilter, setStatusFilter] = useState('all')
 const [showAdd, setShowAdd] = useState(false)
 const [showDetail, setShowDetail] = useState(null)
 const [form, setForm] = useState(emptyForm)
 const [showPreauthModal, setShowPreauthModal] = useState(false)
 const [showPreauthDetail, setShowPreauthDetail] = useState(null)
 const [editingPreauth, setEditingPreauth] = useState(null)
 const [preauthForm, setPreauthForm] = useState(emptyPreauthForm)
 const [preauthPatients, setPreauthPatients] = useState([])
 const [preauthPatientLoading, setPreauthPatientLoading] = useState(false)
 const [claimReviews, setClaimReviews] = useState([])
 const [selectedReviewClaimId, setSelectedReviewClaimId] = useState('')
 const [reviewLoading, setReviewLoading] = useState(false)
 const [reviewSaveLoading, setReviewSaveLoading] = useState(false)
 const [reviewError, setReviewError] = useState('')
 const [reviewResult, setReviewResult] = useState(null)
 const [selectedClaimIds, setSelectedClaimIds] = useState([])
 const [batchSubmitting, setBatchSubmitting] = useState(false)
 const [batchReport, setBatchReport] = useState(null)
 const [validationModal, setValidationModal] = useState(null)
 const [validationLoadingId, setValidationLoadingId] = useState('')
 const [validationByClaim, setValidationByClaim] = useState({})
 const [rejectionModal, setRejectionModal] = useState(null)
 const [appealModal, setAppealModal] = useState(null)
 const [fhirSubmittingId, setFhirSubmittingId] = useState('')
 const [fhirResponseModal, setFhirResponseModal] = useState(null)
 const [preauthUploading, setPreauthUploading] = useState(false)
 const [appealUploading, setAppealUploading] = useState(false)
 const [eobImporting, setEobImporting] = useState(false)
 const eobInputRef = useRef(null)

 useEffect(() => { if (!hospitalId) { setLoading(false); return }; fetchAll() }, [hospitalId, claimPage, claimPageSize])

 useEffect(() => {
 if (!showPreauthModal || !hospitalId) return undefined
 const query = String(preauthForm.patient_search || '').trim()
 if (query.length < 2) {
 setPreauthPatients([])
 setPreauthPatientLoading(false)
 return undefined
 }

 let active = true
 setPreauthPatientLoading(true)
 const timer = window.setTimeout(async () => {
 const { data, error } = await supabase
 .from('patients')
 .select('id, full_name, patient_number, mrn, insurance_number, sha_member_no, national_id')
 .eq('hospital_id', hospitalId)
 .or(`full_name.ilike.%${query}%,patient_number.ilike.%${query}%,mrn.ilike.%${query}%,insurance_number.ilike.%${query}%,national_id.ilike.%${query}%`)
 .limit(8)
 if (!active) return
 if (error) setPreauthPatients([])
 else setPreauthPatients(data || [])
 setPreauthPatientLoading(false)
 }, 220)

 return () => {
 active = false
 window.clearTimeout(timer)
 }
 }, [showPreauthModal, preauthForm.patient_search, hospitalId])

 const latestReviewByClaim = useMemo(() => {
  const map = {}
 claimReviews.forEach(review => {
  if (!review?.claim_id || map[review.claim_id]) return
  map[review.claim_id] = {
    ...review,
    issues: parseReviewIssues(review.issues_json),
    estimated_approval_probability: Number(review.approval_probability ?? review.estimated_approval_probability ?? 0),
   }
  })
  return map
 }, [claimReviews])

 const reviewableClaims = useMemo(
  () => claims.filter(record => ['Pending', 'Draft'].includes(record.status)),
  [claims],
 )

 const selectedReviewClaim = reviewableClaims.find(record => record.id === selectedReviewClaimId) || null
 const latestSelectedReview = selectedReviewClaim ? latestReviewByClaim[selectedReviewClaim.id] || null : null

 useEffect(() => {
  if (!reviewableClaims.length) {
   setSelectedReviewClaimId('')
   return
  }
  if (!selectedReviewClaimId || !reviewableClaims.some(record => record.id === selectedReviewClaimId)) {
   setSelectedReviewClaimId(reviewableClaims[0].id)
  }
 }, [reviewableClaims, selectedReviewClaimId])

 useEffect(() => {
  setReviewResult(latestSelectedReview)
  setReviewError('')
 }, [latestSelectedReview, selectedReviewClaimId])

 useEffect(() => {
  setSelectedClaimIds(current => current.filter(id => claims.some(record => record.id === id)))
 }, [claims])

 async function fetchAll() {
 setLoading(true)
 const start = (claimPage - 1) * claimPageSize
 const end = claimPage * claimPageSize - 1
 const [{ data: cl, count }, { data: inv }, { data: pa }, { data: rv }] = await Promise.all([
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
 supabase.from('sha_preauth')
 .select('*, patients(id, full_name, patient_number, mrn, insurance_number, sha_member_no, national_id)')
 .eq('hospital_id', hospitalId)
 .order('created_at', { ascending: false }),
 supabase.from('sha_claim_reviews')
 .select('*')
 .eq('hospital_id', hospitalId)
 .order('reviewed_at', { ascending: false })
 .limit(300),
 ])
 setClaims(cl || [])
 setClaimTotalCount(count || 0)
 setShaInvoices(inv || [])
 setPreauths(pa || [])
 setClaimReviews(rv || [])
 setLoading(false)
}

 async function uploadSupportingDocuments(files, folder) {
  const uploads = []
  const normalizedFiles = Array.from(files || []).filter(Boolean)
  if (!normalizedFiles.length) return uploads

  for (const file of normalizedFiles) {
   const safeName = String(file.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '-')
   const objectPath = `${hospitalId}/${folder}/${Date.now()}-${safeName}`
   let uploaded = null

   for (const bucket of ['sha-documents', 'lab-reports']) {
    const { error } = await supabase.storage.from(bucket).upload(objectPath, file, {
     contentType: file.type || 'application/octet-stream',
     upsert: true,
    })
    if (error) continue
    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(objectPath)
    uploaded = {
     name: file.name,
     bucket,
     path: objectPath,
     url: urlData?.publicUrl || '',
     uploaded_at: new Date().toISOString(),
    }
    break
   }

   uploads.push(uploaded || {
    name: file.name,
    bucket: '',
    path: '',
    url: '',
    uploaded_at: new Date().toISOString(),
    error: 'Storage bucket unavailable',
   })
  }

  return uploads
 }

 async function validateClaimForSubmission(claim) {
  if (!claim) return null
  const meta = getClaimMeta(claim)
  let patient = null
  if (claim.patient_id) {
   const { data } = await supabase
    .from('patients')
    .select('id,full_name,sha_member_no,insurance_number,national_id')
    .eq('hospital_id', hospitalId)
    .eq('id', claim.patient_id)
    .maybeSingle()
   patient = data || null
  }

  const relatedPreauth = preauths
   .filter(item => item.patient_id === claim.patient_id || (claim.visit_id && item.visit_id === claim.visit_id))
   .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime())[0] || null

  const icd10Code = relatedPreauth?.icd10_code || meta.icd10_code || extractIcdCode(getClaimNotesText(claim))
  const memberNumber = String(claim.sha_number || patient?.sha_member_no || patient?.insurance_number || '').trim()
  const amountClaimed = Number(claim.amount_claimed || 0)
  const approvedLimit = Number(relatedPreauth?.estimated_cost || meta.approved_limit || SHA_BENEFIT_LIMITS[claim.service_type] || 0)
  const requiresPreauth = PREAUTH_REQUIRED_SERVICES.has(claim.service_type) || (amountClaimed > SHA_BENEFIT_LIMITS['Outpatient Consultation'] && claim.service_type === 'Outpatient Consultation')
  const supportingDocuments = relatedPreauth?.supporting_documents || meta.supporting_documents || []
  const checklist = [
   {
    key: 'icd10',
    label: 'ICD-10 code present and valid',
    passed: isValidIcd10Code(icd10Code),
    detail: icd10Code ? `Code ${icd10Code} is attached.` : 'Attach a valid ICD-10 diagnosis code before submission.',
   },
   {
    key: 'preauth',
    label: 'Pre-authorization number present (if required)',
    passed: !requiresPreauth || Boolean((relatedPreauth?.sha_reference || meta.preauth_number || '').trim()) || relatedPreauth?.status === 'Approved',
    detail: requiresPreauth
     ? relatedPreauth?.status === 'Approved'
       ? `Approved pre-auth ${relatedPreauth?.sha_reference || relatedPreauth?.id || 'linked'} found.`
       : 'This service needs an approved pre-auth before SHA submission.'
     : 'This service can proceed without pre-authorization.',
   },
   {
    key: 'membership',
    label: 'Patient SHA membership verified',
    passed: Boolean(memberNumber) && (!patient || memberNumber === String(patient.sha_member_no || patient.insurance_number || memberNumber)),
    detail: memberNumber ? `Member number ${memberNumber} available for claim.` : 'Record the patient SHA member number before submission.',
   },
   {
    key: 'benefit',
    label: 'Service within SHA benefit package',
    passed: SHA_SERVICES.includes(claim.service_type),
    detail: SHA_SERVICES.includes(claim.service_type) ? `${claim.service_type} is mapped to the SHA benefit package.` : 'Map this service to a supported SHA benefit package first.',
   },
   {
    key: 'limit',
    label: 'Claim amount within approved limits',
    passed: approvedLimit <= 0 || amountClaimed <= approvedLimit,
    detail: approvedLimit > 0 ? `${formatCurrency(amountClaimed)} claimed against ${formatCurrency(approvedLimit)} approved.` : 'No limit configured, using hospital default rules.',
   },
   {
    key: 'documents',
    label: 'Supporting documents attached',
    passed: supportingDocuments.length > 0 || !requiresPreauth,
    detail: supportingDocuments.length > 0 ? `${supportingDocuments.length} supporting document(s) attached.` : 'Upload discharge summary / operative notes if SHA asks for evidence.',
   },
  ]

  return {
   claimId: claim.id,
   claim,
   patient,
   preauth: relatedPreauth,
   checklist,
   passed: checklist.every(item => item.passed),
   icd10Code,
   approvedLimit,
   memberNumber,
  }
 }

 function cacheValidationResult(result) {
  if (!result?.claimId) return
  setValidationByClaim(current => ({ ...current, [result.claimId]: result }))
 }

 async function ensureClaimFromPreauth(record) {
  if (!record) return null
  const existingClaim = claims.find(item => {
   const meta = getClaimMeta(item)
   return meta.preauth_id === record.id
  })
  if (existingClaim) return existingClaim

  const patient = record.patients || {}
  const payload = {
   hospital_id: hospitalId,
   patient_name: patient.full_name || record.patient_name || 'Unknown patient',
   patient_id: record.patient_id || null,
   visit_id: record.visit_id || null,
   invoice_id: null,
   id_number: patient.national_id || '',
   sha_number: patient.insurance_number || patient.sha_member_no || record.sha_reference || '',
   service_type: record.service_requested || (record.admission_type === 'Emergency' ? 'Emergency Services' : record.admission_type === 'Maternity' ? 'Maternity / Delivery' : 'Inpatient Admission'),
   amount_claimed: parseFloat(record.estimated_cost || 0),
   visit_date: (record.created_at || new Date().toISOString()).slice(0, 10),
   notes: buildClaimNotes({
    source: 'Pre-Authorization',
    patient_id: record.patient_id || null,
    visit_id: record.visit_id || null,
    notes: [record.icd10_code ? `${record.icd10_code} - ${record.icd10_description || ''}` : record.icd10_description, record.procedure_notes, `Auto-created from SHA pre-auth ${record.id}`].filter(Boolean).join('\n'),
    icd10_code: record.icd10_code || '',
    icd10_description: record.icd10_description || '',
    service_requested: record.service_requested || '',
    cpt_code: record.procedure_code || '',
    preauth_id: record.id,
    preauth_number: record.sha_reference || '',
    approved_limit: Number(record.estimated_cost || 0),
    supporting_documents: Array.isArray(record.supporting_documents) ? record.supporting_documents : [],
   }),
   status: 'Pending',
   created_at: new Date().toISOString(),
  }

  const { error } = await executeWithFallback(
   () => supabase.from('sha_claims').insert(payload),
   async () => supabase.from('sha_claims').insert(omitKeys(payload, ['patient_id', 'visit_id', 'invoice_id'])),
  )
  if (error) throw error
  return payload
 }

 async function buildClaimReviewData(claim) {
  const meta = getClaimMeta(claim)
  const notesText = getClaimNotesText(claim)

  const prescriptionQuery = claim?.visit_id
   ? supabase.from('prescriptions').select('id,drug_name,generic_name,status,patient_id,visit_id,payment_method,created_at').eq('hospital_id', hospitalId).eq('visit_id', claim.visit_id)
   : claim?.patient_id
    ? supabase.from('prescriptions').select('id,drug_name,generic_name,status,patient_id,visit_id,payment_method,created_at').eq('hospital_id', hospitalId).eq('patient_id', claim.patient_id).order('created_at', { ascending: false }).limit(30)
    : null

  const preauthQuery = claim?.visit_id
   ? supabase.from('sha_preauth').select('id,admission_type,service_requested,procedure_code,icd10_code,icd10_description,status,procedure_notes,submitted_at,approved_at,created_at,sha_reference,estimated_cost,supporting_documents').eq('hospital_id', hospitalId).eq('visit_id', claim.visit_id).order('created_at', { ascending: false }).limit(1)
   : claim?.patient_id
    ? supabase.from('sha_preauth').select('id,admission_type,service_requested,procedure_code,icd10_code,icd10_description,status,procedure_notes,submitted_at,approved_at,created_at,sha_reference,estimated_cost,supporting_documents').eq('hospital_id', hospitalId).eq('patient_id', claim.patient_id).order('created_at', { ascending: false }).limit(1)
    : null

  const [prescriptionsResponse, preauthResponse] = await Promise.all([
   prescriptionQuery || Promise.resolve({ data: [] }),
   preauthQuery || Promise.resolve({ data: [] }),
  ])

  const prescriptions = (prescriptionsResponse?.data || []).filter(item => claim?.visit_id || isWithinClaimWindow(claim?.visit_date, item?.created_at))
  const latestPreauth = preauthResponse?.data?.[0] || null
  const drugMap = new Map()

  prescriptions.forEach(item => {
   const key = `${item.drug_name || ''}|${item.generic_name || ''}`.toLowerCase()
   if (!key.trim()) return
   if (!drugMap.has(key)) {
    drugMap.set(key, {
     drug_name: item.drug_name || '',
     generic_name: item.generic_name || '',
     status: item.status || '',
     payment_method: item.payment_method || '',
    })
   }
  })

  return {
   patient_name: claim?.patient_name || '',
   service_type: claim?.service_type || '',
   amount_claimed: Number(claim?.amount_claimed || 0),
   claim_status: claim?.status || '',
   visit_date: claim?.visit_date || '',
   sha_number: claim?.sha_number || '',
   id_number: claim?.id_number || '',
   claim_source: getClaimSource(claim),
   invoice_id: claim?.invoice_id || meta.invoice_id || null,
   invoice_no: meta.invoice_no || null,
   notes: notesText || '',
   icd10_code: latestPreauth?.icd10_code || extractIcdCode(notesText) || '',
   icd10_description: latestPreauth?.icd10_description || meta.icd10_description || '',
   cpt_code: latestPreauth?.procedure_code || meta.cpt_code || '',
   admission_type: latestPreauth?.admission_type || (claim?.service_type?.includes('Inpatient') ? 'Elective' : claim?.service_type?.includes('Emergency') ? 'Emergency' : ''),
   has_preauth: Boolean(latestPreauth),
   preauth_status: latestPreauth?.status || 'None',
   preauth_submitted_at: latestPreauth?.submitted_at || null,
   preauth_approved_at: latestPreauth?.approved_at || null,
   preauth_number: latestPreauth?.sha_reference || meta.preauth_number || '',
   service_requested: latestPreauth?.service_requested || meta.service_requested || claim?.service_type || '',
   drugs: [...drugMap.values()],
  }
}

 async function saveClaimReview(claimId, review) {
  const payload = {
   hospital_id: hospitalId,
   claim_id: claimId,
   overall: review.overall,
   score: Number(review.score || 0),
   issues_json: review.issues,
   recommendation: review.recommendation || '',
   approval_probability: Number(review.estimated_approval_probability || 0),
   reviewed_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('sha_claim_reviews').insert(payload).select('*').single()
  if (error) throw error

  const saved = {
   ...data,
   issues: parseReviewIssues(data.issues_json),
   estimated_approval_probability: Number(data.approval_probability ?? 0),
  }
  setClaimReviews(prev => [saved, ...prev.filter(item => item.id !== saved.id)])
  return saved
 }

 async function handleReviewClaim(claimId = selectedReviewClaimId) {
  const claim = reviewableClaims.find(record => record.id === claimId) || claims.find(record => record.id === claimId)
  if (!claim) {
   setReviewError('Select a pending or draft claim to review.')
   return
  }

  setReviewLoading(true)
  setReviewError('')

  try {
   const claimData = await buildClaimReviewData(claim)
   const { data, error } = await supabase.functions.invoke('review-sha-claim', {
    body: {
     claim_id: claim.id,
     hospital_id: hospitalId,
     claim_data: claimData,
    },
   })

   if (error) throw new Error(await readFunctionError(error))

   const normalized = {
    overall: ['PASS', 'WARN', 'FAIL'].includes(String(data?.overall || '').toUpperCase()) ? String(data.overall).toUpperCase() : 'WARN',
    score: Number(data?.score || 0),
    issues: parseReviewIssues(data?.issues),
    recommendation: String(data?.recommendation || ''),
    estimated_approval_probability: Number(data?.estimated_approval_probability || 0),
   }
   const ppbResults = validatePrescriptionPpb(claimData.drugs || [])
   const ppbIssues = ppbResults
    .filter(result => !result.approved || !result.sha_reimbursable)
    .map(result => ({
      severity: 'error',
      field: 'drugs',
      message: !result.approved
       ? `${result.drug_name || result.generic_name || 'Drug'} not on PPB catalogue`
       : `${result.drug_name || result.generic_name || 'Drug'} is not eligible for SHA reimbursement`,
      fix: 'Substitute with PPB-approved equivalent or document patient self-pay',
    }))

   if (ppbIssues.length > 0) {
    normalized.issues = [...normalized.issues, ...ppbIssues]
    normalized.overall = 'FAIL'
    normalized.score = Math.max(0, normalized.score - ppbIssues.length * 12)
    normalized.estimated_approval_probability = Math.max(0, normalized.estimated_approval_probability - ppbIssues.length * 18)
    normalized.recommendation = [normalized.recommendation, 'Resolve PPB/SHA reimbursement risks before submission.'].filter(Boolean).join(' ')
   }
   const savedReview = await saveClaimReview(claim.id, normalized)
   setReviewResult(savedReview)
  } catch (error) {
   setReviewError(error instanceof Error ? error.message : 'Claim review failed.')
  } finally {
   setReviewLoading(false)
  }
 }

 async function handleApplyReviewFixes() {
  if (!selectedReviewClaim || !reviewResult) return

  setReviewSaveLoading(true)
  try {
   const meta = parseClaimNotes(selectedReviewClaim.notes)
   const currentNotes = getClaimNotesText(selectedReviewClaim)
   let nextServiceType = selectedReviewClaim.service_type || SHA_SERVICES[0]
   let nextAmountClaimed = String(selectedReviewClaim.amount_claimed || '')
   let nextShaNumber = selectedReviewClaim.sha_number || ''
   let nextIdNumber = selectedReviewClaim.id_number || ''
   const noteAdditions = []

   reviewResult.issues.forEach(issue => {
    const combined = `${issue.message || ''} ${issue.fix || ''}`
    const field = String(issue.field || '').toLowerCase()
    const suggestedService = extractServiceType(combined)
    const suggestedAmount = extractCurrencyAmount(combined)
    const suggestedIcd = extractIcdCode(combined)
    const suggestedShaNumber = combined.match(/\bSHA[-A-Z0-9]{4,}\b/i)?.[0] || ''
    const suggestedId = combined.match(/\b\d{6,10}\b/)?.[0] || ''

    if ((field.includes('service') || combined.toLowerCase().includes('service type')) && suggestedService) {
     nextServiceType = suggestedService
    }
    if ((field.includes('amount') || combined.toLowerCase().includes('amount')) && suggestedAmount) {
     nextAmountClaimed = suggestedAmount
    }
    if ((field.includes('sha') || combined.toLowerCase().includes('member number')) && suggestedShaNumber) {
     nextShaNumber = suggestedShaNumber.toUpperCase()
    }
    if ((field.includes('id') || combined.toLowerCase().includes('national id')) && suggestedId) {
     nextIdNumber = suggestedId
    }
    if ((field.includes('icd') || combined.toLowerCase().includes('icd-10')) && suggestedIcd) {
     noteAdditions.push(`ICD-10 reviewer note: ${suggestedIcd}`)
    }
    if (issue.fix) {
     noteAdditions.push(`Reviewer fix (${issue.field || 'claim'}): ${issue.fix}`)
    }
   })

   if (reviewResult.recommendation) {
    noteAdditions.push(`Reviewer recommendation: ${reviewResult.recommendation}`)
   }

   const nextNotes = [...new Set([currentNotes, ...noteAdditions].filter(Boolean))].join('\n')
   const payload = {
    service_type: nextServiceType,
    amount_claimed: Number(nextAmountClaimed || 0),
    sha_number: nextShaNumber,
    id_number: nextIdNumber,
    notes: buildClaimNotes({
     ...meta,
     notes: nextNotes,
    }),
   }

   const { error } = await supabase.from('sha_claims').update(payload).eq('id', selectedReviewClaim.id)
   if (error) throw error

   await fetchAll()
   window.notifyFromLegacyAlert('Reviewer fixes applied to the claim. Re-running the review now.')
   await handleReviewClaim(selectedReviewClaim.id)
  } catch (error) {
   window.notifyFromLegacyAlert('Error applying review fixes: ' + (error instanceof Error ? error.message : 'Unknown error'))
  } finally {
   setReviewSaveLoading(false)
  }
 }

async function handleSubmitReviewedClaim() {
 if (!selectedReviewClaim || reviewResult?.overall !== 'WARN') return
 await submitClaimToSha(selectedReviewClaim)
 setReviewResult(current => current ? { ...current, submitted_at: new Date().toISOString() } : current)
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

 function openPreauthModal(record = null) {
  if (record) {
   const patient = record.patients || {}
   setEditingPreauth(record)
   setPreauthForm({
    patient_search: patient.full_name || record.patient_name || '',
    patient_id: record.patient_id || '',
    patient_name: patient.full_name || record.patient_name || '',
    patient_number: patient.patient_number || patient.mrn || '',
    sha_number: patient.insurance_number || patient.sha_member_no || record.sha_reference || '',
    id_number: patient.national_id || '',
    visit_id: record.visit_id || '',
    admission_type: record.admission_type || 'Elective',
    service_requested: record.service_requested || '',
    icd10_code: record.icd10_code || '',
    icd10_description: record.icd10_description || '',
    procedure_code: record.procedure_code || '',
    procedure_notes: record.procedure_notes || '',
    estimated_cost: record.estimated_cost || '',
    requesting_doctor: record.requesting_doctor || '',
    supporting_documents: Array.isArray(record.supporting_documents) ? record.supporting_documents : [],
    status: record.status || 'Draft',
   })
  } else {
   setEditingPreauth(null)
   setPreauthForm(emptyPreauthForm)
  }
  setPreauthPatients([])
  setShowPreauthModal(true)
 }

 function selectPreauthPatient(patient) {
  setPreauthForm({
   ...preauthForm,
   patient_search: patient.full_name || '',
   patient_id: patient.id,
   patient_name: patient.full_name || '',
   patient_number: patient.patient_number || patient.mrn || '',
   sha_number: patient.insurance_number || patient.sha_member_no || '',
   id_number: patient.national_id || '',
  })
  setPreauthPatients([])
 }

async function handleSavePreauth(nextStatus = 'Draft') {
  if (!preauthForm.patient_id || !preauthForm.patient_name) {
   window.notifyFromLegacyAlert('Select a patient before saving the pre-authorization request.')
   return
  }
  if (!preauthForm.icd10_description && !preauthForm.procedure_notes) {
   window.notifyFromLegacyAlert('Enter the proposed procedure or diagnosis.')
   return
  }
  if (!preauthForm.estimated_cost) {
   window.notifyFromLegacyAlert('Estimated cost is required.')
   return
  }

  setSaving(true)
  const nowIso = new Date().toISOString()
  const payload = {
   hospital_id: hospitalId,
   patient_id: preauthForm.patient_id,
   visit_id: preauthForm.visit_id || null,
   admission_type: preauthForm.admission_type,
   service_requested: preauthForm.service_requested || null,
   icd10_code: preauthForm.icd10_code || null,
   icd10_description: preauthForm.icd10_description || preauthForm.procedure_notes || null,
   procedure_code: preauthForm.procedure_code || null,
   procedure_notes: preauthForm.procedure_notes || null,
   estimated_cost: parseFloat(preauthForm.estimated_cost || 0),
   requesting_doctor: preauthForm.requesting_doctor || null,
   supporting_documents: Array.isArray(preauthForm.supporting_documents) ? preauthForm.supporting_documents : [],
   status: nextStatus,
   submitted_at: nextStatus === 'Submitted to SHA' ? nowIso : editingPreauth?.submitted_at || null,
   approved_at: nextStatus === 'Approved' ? nowIso : editingPreauth?.approved_at || null,
   created_at: editingPreauth?.created_at || nowIso,
  }

  const { error } = await executeWithFallback(
   () => editingPreauth?.id
    ? supabase.from('sha_preauth').update(payload).eq('id', editingPreauth.id)
    : supabase.from('sha_preauth').insert(payload),
   async () => {
    const fallbackPayload = omitKeys(payload, ['service_requested', 'procedure_code', 'supporting_documents'])
    return editingPreauth?.id
     ? supabase.from('sha_preauth').update(fallbackPayload).eq('id', editingPreauth.id)
     : supabase.from('sha_preauth').insert(fallbackPayload)
   },
  )
  if (error) {
   window.notifyFromLegacyAlert('Error: ' + error.message)
   setSaving(false)
   return
  }

  setShowPreauthModal(false)
  setEditingPreauth(null)
  setPreauthForm(emptyPreauthForm)
  await fetchAll()
  if (nextStatus === 'Approved') {
   try {
    await ensureClaimFromPreauth({
     ...(editingPreauth || {}),
     ...payload,
     id: editingPreauth?.id,
     patients: editingPreauth?.patients || preauthPatients.find(item => item.id === payload.patient_id),
    })
    await fetchAll()
    window.notifyFromLegacyAlert('Pre-auth approved and claim auto-created.')
   } catch (autoError) {
    window.notifyFromLegacyAlert('Pre-auth saved, but claim auto-create failed: ' + (autoError instanceof Error ? autoError.message : 'Unknown error'))
   }
  }
  setSaving(false)
 }

 async function submitPreauth(record) {
  await updatePreauthStatus(record, 'Submitted to SHA')
 }

 async function updatePreauthStatus(record, status) {
  if (!record?.id) return
  setSaving(true)
  const payload = {
   status,
   submitted_at: status === 'Submitted to SHA' ? new Date().toISOString() : record.submitted_at || null,
   approved_at: status === 'Approved' ? new Date().toISOString() : record.approved_at || null,
  }
  const { error } = await supabase.from('sha_preauth').update(payload).eq('id', record.id)
  if (error) {
   window.notifyFromLegacyAlert('Error: ' + error.message)
   setSaving(false)
   return
  }
  if (status === 'Approved') {
   try {
    await ensureClaimFromPreauth({ ...record, ...payload })
    window.notifyFromLegacyAlert('Pre-auth approved and claim auto-created.')
   } catch (autoError) {
    window.notifyFromLegacyAlert('Pre-auth approved, but claim auto-create failed: ' + (autoError instanceof Error ? autoError.message : 'Unknown error'))
   }
  }
  await fetchAll()
  setSaving(false)
 }

 function convertPreauthToClaim(record) {
  const patient = record.patients || {}
  setForm({
   ...emptyForm,
   patient_name: patient.full_name || record.patient_name || '',
   patient_id: record.patient_id || '',
   visit_id: record.visit_id || '',
   sha_number: patient.insurance_number || patient.sha_member_no || record.sha_reference || '',
   id_number: patient.national_id || '',
   service_type: record.service_requested || (record.admission_type === 'Emergency' ? 'Emergency Services' : record.admission_type === 'Maternity' ? 'Maternity / Delivery' : 'Inpatient Admission'),
   amount_claimed: record.estimated_cost || '',
   notes: [record.icd10_code ? `${record.icd10_code} - ${record.icd10_description || ''}` : record.icd10_description, record.procedure_notes, `Converted from SHA pre-auth ${record.id}`].filter(Boolean).join('\n'),
   status: 'Pending',
  })
  setShowAdd(true)
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
 const meta = getClaimMeta(claim)
 setSaving(true)
 const nextMeta = {
  ...meta,
  approved_at: status === 'Approved' ? new Date().toISOString() : meta.approved_at,
  payment_received_at: status === 'Paid' ? new Date().toISOString() : meta.payment_received_at,
  submitted_to_sha_at: status === 'Submitted to SHA' ? new Date().toISOString() : meta.submitted_to_sha_at,
 }
 const { error } = await supabase.from('sha_claims').update({ status, notes: buildClaimNotes(nextMeta) }).eq('id', id)
 if (error) {
 window.notifyFromLegacyAlert('Error: ' + error.message)
 setSaving(false)
 return
 }
 if (claim) await syncInvoiceForClaim(claim, status)
 await fetchAll()
 setSaving(false)
 if (claim && ['Approved', 'Rejected'].includes(status)) {
  void (async () => {
   try {
    const notificationConfig = await fetchNotificationConfig(hospitalId)
    const notificationType = status === 'Approved' ? 'sha_claim_approved' : 'sha_claim_rejected'
    const claimSetting = getNotificationSetting(notificationConfig, notificationType)
    if (!claimSetting.enabled || !claim?.patient_id) return

    const { data: patient } = await supabase
      .from('patients')
      .select('phone,phone2,full_name')
      .eq('hospital_id', hospitalId)
      .eq('id', claim.patient_id)
      .maybeSingle()

    const phone = patient?.phone || patient?.phone2 || null
    if (!phone) return

    const message = buildMessage(claimSetting.template || DEFAULT_TEMPLATES[notificationType], {
      patient_name: patient?.full_name || claim.patient_name || 'Patient',
      hospital_name: hospitalName || 'Brightpath Travel Scholars',
      amount: Number(claim.amount_claimed || 0).toLocaleString(),
    })

    const result = await sendPatientNotification({
      phone,
      message,
      hospitalName,
      notificationType,
      patientId: claim.patient_id,
      hospitalId,
    })

    if (!result.success && !result.skipped && result.error) {
      console.warn('SHA claim notification failed:', result.error)
    }
   } catch (error) {
    console.warn('SHA claim notification failed:', error)
   }
  })()
 }
 broadcastWorkflowChanged({ source: 'sha-claim-status', id, status })
}

 function openRejectionModal(claim) {
  const rejection = getClaimMeta(claim).rejection || {}
  setRejectionModal({
   claim,
   code: rejection.code || REJECTION_REASON_OPTIONS[0],
   explanation: rejection.explanation || '',
   notes: rejection.notes || '',
  })
 }

 async function saveRejection() {
  if (!rejectionModal?.claim) return
  const guide = getRejectionGuide(rejectionModal.code)
  const claim = rejectionModal.claim
  const meta = getClaimMeta(claim)
  const nextMeta = {
   ...meta,
   rejection: {
    code: rejectionModal.code,
    label: guide.label,
    explanation: rejectionModal.explanation || guide.explanation,
    notes: rejectionModal.notes || '',
    fixes: guide.fixes,
    recorded_at: new Date().toISOString(),
    appeal_due_date: new Date(Date.now() + 30 * 86400000).toISOString(),
   },
  }
  setSaving(true)
  const { error } = await supabase.from('sha_claims').update({ status: 'Rejected', notes: buildClaimNotes(nextMeta) }).eq('id', claim.id)
  if (error) {
   window.notifyFromLegacyAlert('Error: ' + error.message)
   setSaving(false)
   return
  }
  setRejectionModal(null)
  await fetchAll()
  setSaving(false)
 }

async function submitClaimToSha(claim, options = {}) {
  const validation = await validateClaimForSubmission(claim)
  if (!validation) return false
  cacheValidationResult(validation)
  if (!validation.passed) {
   setValidationModal(validation)
   return false
  }

  const meta = getClaimMeta(claim)
  const nextMeta = {
   ...meta,
   icd10_code: validation.icd10Code || meta.icd10_code,
   verified_sha_membership: true,
   approved_limit: validation.approvedLimit,
   preauth_id: validation.preauth?.id || meta.preauth_id,
   preauth_number: validation.preauth?.sha_reference || meta.preauth_number,
   validation_checks: validation.checklist,
   submitted_to_sha_at: new Date().toISOString(),
  }

  const { error } = await supabase.from('sha_claims').update({ status: 'Submitted to SHA', notes: buildClaimNotes(nextMeta) }).eq('id', claim.id)
  if (error) {
   window.notifyFromLegacyAlert('Error: ' + error.message)
   return false
  }
  if (!options.silent) window.notifyFromLegacyAlert('Claim validated and submitted to SHA.')
 await fetchAll()
 return true
}

 async function submitClaimViaFhir(claim, options = {}) {
  if (!hospitalId || !claim?.invoice_id) {
   window.notifyFromLegacyAlert('This claim needs a linked invoice before it can be sent via FHIR.')
   return false
  }

  try {
   setFhirSubmittingId(claim.id)
   const result = await submitShaClaimViaFhir({ hospitalId, invoiceId: claim.invoice_id })
   const responsePayload = result?.shaResponse || result?.claimResponse || result || {}
   const normalizedStatus = String(responsePayload?.status || responsePayload?.outcome || '').toLowerCase()
   const nextStatus = normalizedStatus === 'active' || normalizedStatus === 'accepted'
    ? 'Accepted'
    : normalizedStatus === 'error' || normalizedStatus === 'rejected'
      ? 'Rejected'
      : 'Submitted'

   await fetchAll()
   if (!options.silent) {
    window.notifyFromLegacyAlert(`FHIR claim sent successfully. Status: ${nextStatus}.`)
   }
   return true
  } catch (error) {
   const message = await readFunctionError(error)
   window.notifyFromLegacyAlert('FHIR submission failed: ' + message)
   await fetchAll()
   return false
  } finally {
   setFhirSubmittingId('')
  }
 }

 async function handleFixAndResubmit(claim) {
  const meta = getClaimMeta(claim)
  const rejection = meta.rejection || {}
  const guide = getRejectionGuide(rejection.code)
  const resubmissions = [...(meta.resubmissions || []), {
   resubmitted_at: new Date().toISOString(),
   reason_code: rejection.code || '',
   checklist: guide.fixes,
  }]
  const nextMeta = {
   ...meta,
   rejection: {},
   resubmissions,
   notes: [getClaimNotesText(claim), 'Resubmission checklist:', ...guide.fixes.map(item => `- ${item}`)].filter(Boolean).join('\n'),
  }

  const { error } = await supabase.from('sha_claims').update({ status: 'Draft', notes: buildClaimNotes(nextMeta) }).eq('id', claim.id)
  if (error) {
   window.notifyFromLegacyAlert('Error: ' + error.message)
   return
  }
  await fetchAll()
  const refreshedClaim = claims.find(item => item.id === claim.id) || { ...claim, status: 'Draft', notes: buildClaimNotes(nextMeta) }
  await submitClaimToSha(refreshedClaim, { silent: false })
 }

 function openAppealModal(claim) {
  const appeal = getClaimMeta(claim).appeal || {}
  setAppealModal({
   claim,
   grounds: appeal.grounds || '',
   status: appeal.status || 'Filed',
   filed_at: appeal.filed_at || new Date().toISOString(),
   supporting_documents: Array.isArray(appeal.supporting_documents) ? appeal.supporting_documents : [],
  })
 }

 async function saveAppeal() {
  if (!appealModal?.claim) return
  const claim = appealModal.claim
  const meta = getClaimMeta(claim)
  const nextMeta = {
   ...meta,
   appeal: {
    status: appealModal.status || 'Filed',
    grounds: appealModal.grounds || '',
    filed_at: appealModal.filed_at || new Date().toISOString(),
    supporting_documents: Array.isArray(appealModal.supporting_documents) ? appealModal.supporting_documents : [],
    due_date: meta.rejection?.appeal_due_date || new Date(Date.now() + 30 * 86400000).toISOString(),
   },
  }
  setSaving(true)
  const { error } = await supabase.from('sha_claims').update({ status: 'Appealed', notes: buildClaimNotes(nextMeta) }).eq('id', claim.id)
  if (error) {
   window.notifyFromLegacyAlert('Error: ' + error.message)
   setSaving(false)
   return
  }
  setAppealModal(null)
  await fetchAll()
  setSaving(false)
 }

 async function handleBatchSubmit() {
  const selectedDraftClaims = claims.filter(item => selectedClaimIds.includes(item.id) && ['Draft', 'Pending'].includes(item.status))
  if (!selectedDraftClaims.length) {
   window.notifyFromLegacyAlert('Select draft or pending claims before batch submission.')
   return
  }
  if (!await window.openConfirmDialog(`Submit ${selectedDraftClaims.length} claim(s) to SHA in one batch?`)) return

  setBatchSubmitting(true)
  const report = {
   generated_at: new Date().toISOString(),
   submitted: [],
   blocked: [],
  }

  for (const claim of selectedDraftClaims) {
   const validation = await validateClaimForSubmission(claim)
   cacheValidationResult(validation)
   if (!validation?.passed) {
    report.blocked.push({
     claim,
     reasons: (validation?.checklist || []).filter(item => !item.passed).map(item => item.label),
    })
    continue
   }

   const success = await submitClaimToSha(claim, { silent: true })
   if (success) report.submitted.push(claim)
   else report.blocked.push({ claim, reasons: ['Update failed during submission.'] })
  }

  setBatchReport(report)
  setBatchSubmitting(false)
 }

 async function handleImportEobFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  setEobImporting(true)
  try {
   const text = await file.text()
   const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
   if (lines.length < 2) throw new Error('Upload a CSV with at least one EOB row.')
   const headers = lines[0].split(',').map(item => item.trim().toLowerCase())
   const records = lines.slice(1).map(line => {
    const values = line.split(',').map(item => item.trim())
    return headers.reduce((acc, key, index) => ({ ...acc, [key]: values[index] || '' }), {})
   })

   for (const row of records) {
    const match = claims.find(claim =>
     claim.id === row.claim_id ||
     String(claim.sha_number || '').toLowerCase() === String(row.sha_number || '').toLowerCase() ||
     String(getClaimMeta(claim).invoice_no || '').toLowerCase() === String(row.invoice_no || '').toLowerCase()
    )
    if (!match) continue
    const meta = getClaimMeta(match)
    const nextMeta = {
     ...meta,
     payment_received_at: row.payment_received_at || meta.payment_received_at,
     payment_reference: row.payment_reference || meta.payment_reference,
     rejection: row.rejection_reason_code ? {
      ...meta.rejection,
      code: row.rejection_reason_code,
      explanation: row.rejection_reason_text || getRejectionGuide(row.rejection_reason_code).explanation,
      recorded_at: meta.rejection?.recorded_at || new Date().toISOString(),
      appeal_due_date: meta.rejection?.appeal_due_date || new Date(Date.now() + 30 * 86400000).toISOString(),
     } : meta.rejection,
    }
    await supabase.from('sha_claims').update({
     status: row.status || match.status,
     notes: buildClaimNotes(nextMeta),
    }).eq('id', match.id)
   }

   await fetchAll()
   window.notifyFromLegacyAlert('SHA EOB import completed.')
  } catch (error) {
   window.notifyFromLegacyAlert(error instanceof Error ? error.message : 'EOB import failed.')
  } finally {
   event.target.value = ''
   setEobImporting(false)
  }
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
 const pending = claims.filter(r => ['Pending','Submitted','Submitted to SHA','Under Review'].includes(r.status))
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

 const pendingPreauth = preauths.filter(r => ['Draft', 'Submitted to SHA'].includes(r.status))
 const approvedPreauthMonth = preauths.filter(r => {
 const now = new Date()
 const approvedDate = r.approved_at ? new Date(r.approved_at) : null
 return r.status === 'Approved' && approvedDate && approvedDate.getMonth() === now.getMonth() && approvedDate.getFullYear() === now.getFullYear()
 })
 const finalizedPreauth = preauths.filter(r => ['Approved', 'Rejected', 'Expired'].includes(r.status))
 const preauthApprovalRate = finalizedPreauth.length ? Math.round((preauths.filter(r => r.status === 'Approved').length / finalizedPreauth.length) * 100) : 0
 const draftClaims = claims.filter(r => ['Draft', 'Pending'].includes(r.status))
 const followUpClaims = claims.filter(item => getClaimFlags(item).some(flag => flag.label === 'Follow Up'))
 const paymentOverdueClaims = claims.filter(item => getClaimFlags(item).some(flag => flag.label === 'Payment Overdue'))
 const appealUrgentClaims = claims.filter(item => getClaimFlags(item).some(flag => flag.label === 'Appeal Due'))

 const monthlySubmissionData = useMemo(() => {
  const months = []
  for (let offset = 5; offset >= 0; offset -= 1) {
   const date = new Date()
   date.setMonth(date.getMonth() - offset)
   const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
   months.push({ key, label: date.toLocaleDateString('en-KE', { month: 'short' }), count: 0, amount: 0, approved: 0, totalResolved: 0 })
  }
  claims.forEach(claim => {
   const created = safeDate(claim.created_at)
   if (!created) return
   const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`
   const bucket = months.find(item => item.key === key)
   if (!bucket) return
   bucket.count += 1
   bucket.amount += Number(claim.amount_claimed || 0)
   if (['Approved', 'Paid'].includes(claim.status)) bucket.approved += 1
   if (['Approved', 'Paid', 'Rejected'].includes(claim.status)) bucket.totalResolved += 1
  })
  return months.map(item => ({
   ...item,
   target: 85,
   approvalRate: item.totalResolved > 0 ? Math.round((item.approved / item.totalResolved) * 100) : 0,
  }))
 }, [claims])

 const averageProcessingByType = useMemo(() => {
  const map = {}
  claims.forEach(claim => {
   const meta = getClaimMeta(claim)
   const closedAt = meta.payment_received_at || meta.approved_at || meta.rejection?.recorded_at
   const hours = diffHours(claim.created_at, closedAt)
   if (hours === null) return
   const key = claim.service_type || 'Other'
   if (!map[key]) map[key] = { name: key, totalHours: 0, count: 0 }
   map[key].totalHours += hours
   map[key].count += 1
  })
  return Object.values(map).map(item => ({
   name: item.name,
   hours: item.count > 0 ? Math.round((item.totalHours / item.count) * 10) / 10 : 0,
  })).sort((left, right) => right.hours - left.hours)
 }, [claims])

 const rejectionReasonData = useMemo(() => {
  const map = {}
  rejected.forEach(claim => {
   const code = getClaimMeta(claim).rejection?.code || 'UNSPECIFIED'
   map[code] = (map[code] || 0) + 1
  })
  return Object.entries(map).map(([name, value]) => ({ name, value }))
 }, [rejected])

 const recoveredRevenueThisMonth = useMemo(() => {
  const now = new Date()
  return claims.reduce((sum, claim) => {
   const meta = getClaimMeta(claim)
   const wasRejected = Boolean(meta.resubmissions?.length)
   const paidAt = safeDate(meta.payment_received_at)
   if (!wasRejected || !paidAt) return sum
   if (paidAt.getMonth() !== now.getMonth() || paidAt.getFullYear() !== now.getFullYear()) return sum
   return sum + Number(claim.amount_claimed || 0)
  }, 0)
 }, [claims])

 const paymentTracking = useMemo(() => {
  const approvedClaims = claims.filter(claim => {
   const meta = getClaimMeta(claim)
   return meta.approved_at && meta.payment_received_at
  })
  const gaps = approvedClaims.map(claim => diffDays(getClaimMeta(claim).approved_at, getClaimMeta(claim).payment_received_at)).filter(day => day !== null)
  const averageDays = gaps.length ? Math.round((gaps.reduce((sum, day) => sum + day, 0) / gaps.length) * 10) / 10 : 0
  return { averageDays, count: gaps.length }
 }, [claims])

 const oldestPendingDays = pending.reduce((maxDays, claim) => {
  const days = diffDays(getClaimMeta(claim).submitted_to_sha_at || claim.created_at)
  return days !== null && days > maxDays ? days : maxDays
 }, 0)

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
 <input ref={eobInputRef} type="file" accept=".csv,text/csv" style={{display:'none'}} onChange={handleImportEobFile} />
 <button style={{...css.btn,...css.btnGhost}} onClick={() => {
 const csv = activeTab === 'preauth'
 ? [
 `Patient,Patient Number,Requested Date,Admission Type,Service Requested,ICD10 Code,Diagnosis,CPT Code,Estimated Cost,Status,Requesting Doctor,Visit ID`,
 ...preauths.map(r => `${r.patients?.full_name || ''},${r.patients?.patient_number || r.patients?.mrn || ''},${formatDate(r.created_at)},${r.admission_type || ''},${r.service_requested || ''},${r.icd10_code || ''},${r.icd10_description || ''},${r.procedure_code || ''},${r.estimated_cost || 0},${r.status || ''},${r.requesting_doctor || ''},${r.visit_id || ''}`),
 ].join('\n')
 : [
 `Patient,SHA No,Service,Amount,Status,Visit Date,Submitted,Rejection Reason,Appeal Status`,
 ...claims.map(r=>`${r.patient_name},${r.sha_number||''},${r.service_type},${r.amount_claimed},${r.status},${r.visit_date||''},${r.created_at?new Date(r.created_at).toLocaleDateString('en-KE'):''},${getClaimMeta(r).rejection?.code || ''},${getClaimMeta(r).appeal?.status || ''}`),
 ].join('\n')
 const a = document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download=activeTab === 'preauth' ? 'sha_preauth.csv' : 'sha_claims.csv'; a.click()
 }} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Export CSV</button>
 <button style={{...css.btn,...css.btnGhost}} onClick={() => eobInputRef.current?.click()} disabled={eobImporting}>{eobImporting ? 'Importing EOB...' : 'Import SHA EOB'}</button>
 <button style={{...css.btn,...css.btnPri}} onClick={() => {
 if (activeTab === 'preauth') openPreauthModal()
 else { setForm(emptyForm); setShowAdd(true) }
 }}>{activeTab === 'preauth' ? '+ New Pre-Auth' : '+ New Claim'}</button>
 </div>
 </div>
 <div style={css.subtext}>
 {activeTab === 'preauth'
 ? <>Pre-authorization requests ready for SHA review and discharge follow-up. <span style={{color:C.primary,fontWeight:600}}>Approval rate: {preauthApprovalRate}%</span></>
 : <>This month: KES {monthAmt.toLocaleString()} across {monthRecs.length} claims
 {unimported.length > 0 ? <span style={{color:C.warn,fontWeight:600}}> · {unimported.length} pending auto-post</span> : <span style={{color:C.primary,fontWeight:600}}> · All billing SHA invoices auto-posted ✓</span>}</>}
 </div>

 <div style={css.statsRow}>
 {(activeTab === 'preauth' ? [
 { label:'Total Pre-Auths', value:preauths.length, sub:'All requests', color:C.text },
 { label:'Pending', value:pendingPreauth.length, sub:'Draft or submitted', color:C.warn },
 { label:'Approved This Month', value:approvedPreauthMonth.length, sub:'Cleared by SHA', color:C.primary },
 { label:'Approval Rate %', value:`${preauthApprovalRate}%`, sub:`${finalizedPreauth.length} finalized`, color:C.blue },
 { label:'Estimated Value', value:formatCurrency(preauths.reduce((sum, item) => sum + Number(item.estimated_cost || 0), 0)), sub:'Across all pre-auths', color:C.primary },
 ] : [
 { label:'Total Claimed', value:`KES ${totalClaimed.toLocaleString()}`, sub:`${claims.length} claims`, color:C.text },
 { label:'Approved / Paid', value:`KES ${approvedAmt.toLocaleString()}`, sub:`${approved.length} claims`, color:C.primary },
 { label:'Pending / Under Review', value:`KES ${pendingAmt.toLocaleString()}`, sub:`${pending.length} awaiting`, color:C.warn },
 { label:'Rejected', value:`KES ${rejectedAmt.toLocaleString()}`, sub:`${rejected.length} claims`, color:rejected.length>0?C.danger:C.muted },
 { label:'SHA Invoices in Billing', value:shaInvoices.length, sub:`KES ${shaInvoices.reduce((s,i)=>s+parseFloat(i.amount_kes||0),0).toLocaleString()}`, color:C.blue },
 ]).map(st => (
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
 { key:'reviewer', label:'Claim Reviewer' },
 { key:'preauth', label:`Pre-Authorization${pendingPreauth.length>0?` (${pendingPreauth.length})`:''}` },
 { key:'billing', label:`From Billing${unimported.length>0?` (${unimported.length} pending)`:''}` },
 { key:'pending', label:`Pending${pending.length>0?` (${pending.length})`:''}` },
 { key:'rejected', label:`Rejected${rejected.length>0?` (${rejected.length})`:''}` },
 { key:'analytics', label:'Analytics' },
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
 <option>Draft</option><option>Pending</option><option>Submitted</option><option>Submitted to SHA</option><option>Under Review</option>
 <option>Approved</option><option>Paid</option><option>Rejected</option><option>Appealed</option>
 </select>
 <button style={{...css.btn,...css.btnGhost}} onClick={() => setSelectedClaimIds(draftClaims.map(item => item.id))}>Select Drafts</button>
 <button style={{...css.btn,...css.btnPri}} onClick={handleBatchSubmit} disabled={batchSubmitting || selectedClaimIds.length === 0}>{batchSubmitting ? 'Submitting Batch...' : 'Submit All to SHA'}</button>
 </div>
 <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:'12px',marginBottom:'16px'}}>
  {[
   { label:'Draft / Pending', value:draftClaims.length, sub:'Ready for validation batch', color:C.blue },
   { label:'Follow Up Flags', value:followUpClaims.length, sub:'Pending >14 days', color:C.warn },
   { label:'Payment Overdue', value:paymentOverdueClaims.length, sub:'Approved >30 days unpaid', color:C.danger },
  ].map(item => (
   <div key={item.label} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:'10px',padding:'12px 14px'}}>
    <div style={css.statLbl}>{item.label}</div>
    <div style={{...css.statVal,color:item.color,fontSize:'22px'}}>{item.value}</div>
    <div style={css.statSub}>{item.sub}</div>
   </div>
  ))}
 </div>
 {batchReport && (
  <div style={{...css.cardPad,marginBottom:'16px'}}>
   <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',marginBottom:'12px'}}>
    <div>
     <div style={{fontWeight:800}}>SHA Batch Submission Report</div>
     <div style={{fontSize:'12px',color:C.sub}}>Generated {formatDate(batchReport.generated_at, true)}</div>
    </div>
    <button style={{...css.btn,...css.btnGhost}} onClick={() => setBatchReport(null)}>Dismiss</button>
   </div>
   <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px'}}>
    <div>
     <div style={css.sectionTitle}>Submitted</div>
     {batchReport.submitted.length === 0 ? <div style={{fontSize:'12px',color:C.sub}}>No claims submitted in this batch.</div> : batchReport.submitted.map(item => (
      <div key={item.id} style={css.uploadItem}>
       <span>{item.patient_name}</span>
       <strong>{formatCurrency(item.amount_claimed)}</strong>
      </div>
     ))}
    </div>
    <div>
     <div style={css.sectionTitle}>Blocked</div>
     {batchReport.blocked.length === 0 ? <div style={{fontSize:'12px',color:C.sub}}>No blocked claims.</div> : batchReport.blocked.map(item => (
      <div key={item.claim.id} style={{...css.uploadItem,alignItems:'flex-start'}}>
       <div>
        <div style={{fontWeight:700}}>{item.claim.patient_name}</div>
        <div style={{fontSize:'11px',color:C.sub}}>{item.reasons.join(' • ')}</div>
       </div>
       <button style={{...css.btn,...css.btnGhost,padding:'5px 9px'}} onClick={() => setShowDetail(item.claim)}>Review</button>
      </div>
     ))}
    </div>
   </div>
  </div>
 )}
 <div style={css.card}>
 <div style={css.cardHead}>
 <span>SHA Claims — {filtered.length} records</span>
 <span style={{fontSize:'12px',color:C.sub}}>Page {claimPage} of {Math.max(1, Math.ceil(claimTotalCount / claimPageSize))} ({claimTotalCount} total)</span>
 </div>
 <table style={css.table}>
 <thead>
 <tr>{['Select','Patient','SHA No / ID','Source','Service','Amount','Status','FHIR','Visit Date','Actions'].map(h=><th key={h} style={css.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {filtered.length===0 && <tr><td colSpan={10} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No claims found</td></tr>}
 {filtered.map(r => (
 <tr key={r.id} style={{cursor:'pointer'}} onClick={()=>setShowDetail(r)}>
 <td style={css.td} onClick={e=>e.stopPropagation()}>
  <input
   type="checkbox"
   checked={selectedClaimIds.includes(r.id)}
   onChange={e => {
    if (e.target.checked) setSelectedClaimIds(current => [...new Set([...current, r.id])])
    else setSelectedClaimIds(current => current.filter(id => id !== r.id))
   }}
  />
 </td>
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
 <td style={css.td}>
  <div style={{fontWeight:600}}>{r.service_type}</div>
  {!!getClaimMeta(r).cpt_code && <div style={{fontSize:'11px',color:C.sub}}>CPT {getClaimMeta(r).cpt_code}</div>}
 </td>
 <td style={{...css.td,fontWeight:700}}>KES {parseFloat(r.amount_claimed||0).toLocaleString()}</td>
 <td style={css.td}>
  <Badge status={r.status}/>
  {!!latestReviewByClaim[r.id] && <div style={{marginTop:'6px'}}><ReviewBadge overall={latestReviewByClaim[r.id].overall} compact /></div>}
  {getClaimFlags(r).length > 0 && (
   <div style={css.flagRow}>
   {getClaimFlags(r).map(flag => <span key={flag.label} style={{...css.flagBadge,background:flag.bg,color:flag.color}} title={flag.detail}>{flag.label}</span>)}
   </div>
  )}
 </td>
 <td style={css.td}>
  <FhirBadge status={r.fhir_status || 'Not Submitted'} />
  {r.fhir_submitted_at && <div style={{ marginTop:'6px', fontSize:'11px', color:C.sub }}>{formatDate(r.fhir_submitted_at, true)}</div>}
 </td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{r.visit_date?new Date(r.visit_date).toLocaleDateString('en-KE'):'—'}</td>
 <td style={css.td} onClick={e=>e.stopPropagation()}>
 <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
 {['Draft','Pending'].includes(r.status) && (
 <button style={{...css.btn,background:C.blueL,color:C.blue,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={async () => {
  setValidationLoadingId(r.id)
  const validation = await validateClaimForSubmission(r)
  cacheValidationResult(validation)
  setValidationModal(validation)
  setValidationLoadingId('')
 }}>Validate</button>
 )}
 {['Draft','Pending'].includes(r.status) && (
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>submitClaimToSha(r)} disabled={validationLoadingId === r.id}>Submit</button>
 )}
 {['Pending','Submitted','Submitted to SHA','Under Review'].includes(r.status) && (
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Approved')} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Approve</button>
 )}
 {r.status==='Approved' && (
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Paid')} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Mark Paid</button>
 )}
 {!['Rejected','Paid'].includes(r.status) && (
 <button style={{...css.btn,background:C.dangerL,color:C.danger,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>openRejectionModal(r)} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Reject</button>
 )}
 {r.status==='Rejected' && (
 <button style={{...css.btn,background:'#F3F4F6',color:C.sub,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>openAppealModal(r)}>Appeal</button>
 )}
 {r.status==='Rejected' && (
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>handleFixAndResubmit(r)}>Fix & Resubmit</button>
 )}
 {isAdmin && r.invoice_id && (
 <button
 style={{...css.btn,background:C.blueL,color:C.blue,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>submitClaimViaFhir(r)}
 disabled={fhirSubmittingId === r.id}
 >
  {fhirSubmittingId === r.id ? 'Sending...' : 'Submit via FHIR'}
 </button>
 )}
 {!!r.fhir_response && (
 <button
 style={{...css.btn,background:'#F3F4F6',color:C.text,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>setFhirResponseModal({ title: `FHIR Response • ${r.patient_name}`, payload: r.fhir_response })}
 >
  View Response
 </button>
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

 {/* CLAIM REVIEWER TAB */}
 {activeTab === 'reviewer' && (
 <>
 <div style={css.reviewCard}>
 <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap',marginBottom:'14px'}}>
 <div>
 <div style={{fontSize:'15px',fontWeight:700,color:C.text}}>AI Claim Reviewer</div>
 <div style={{fontSize:'12px',color:C.sub,marginTop:'4px'}}>Run a SHA compliance check before submitting pending or draft claims.</div>
 </div>
 {selectedReviewClaim && latestReviewByClaim[selectedReviewClaim.id] && (
 <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
 <span style={{fontSize:'12px',color:C.sub}}>Last review</span>
 <ReviewBadge overall={latestReviewByClaim[selectedReviewClaim.id].overall} />
 </div>
 )}
 </div>
 <div style={css.grid2}>
 <div>
 <label style={css.lbl}>Claim Selector</label>
 <select style={{...css.input,cursor:'pointer'}} value={selectedReviewClaimId} onChange={e=>setSelectedReviewClaimId(e.target.value)}>
 <option value="">{reviewableClaims.length ? '-- Select claim --' : 'No pending or draft claims available'}</option>
 {reviewableClaims.map(record => (
 <option key={record.id} value={record.id}>
 {`${record.patient_name} • ${formatCurrency(record.amount_claimed)} • ${record.service_type}`}
 </option>
 ))}
 </select>
 </div>
 <div style={{display:'flex',alignItems:'flex-end'}}>
 <button style={{...css.btn,...css.btnPri,width:'100%',padding:'10px 14px'}} onClick={() => handleReviewClaim()} disabled={!selectedReviewClaim || reviewLoading || reviewSaveLoading}>
 {reviewLoading ? 'Reviewing...' : 'Review This Claim'}
 </button>
 </div>
 </div>
 {selectedReviewClaim && (
 <div style={{marginTop:'8px',padding:'12px 14px',border:`1px solid ${C.border}`,borderRadius:'10px',background:'#FAFBFD'}}>
 <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:'10px'}}>
 <div><div style={{fontSize:'11px',color:C.sub,textTransform:'uppercase',marginBottom:'4px'}}>Patient</div><div style={{fontWeight:700}}>{selectedReviewClaim.patient_name}</div></div>
 <div><div style={{fontSize:'11px',color:C.sub,textTransform:'uppercase',marginBottom:'4px'}}>Amount</div><div style={{fontWeight:700}}>{formatCurrency(selectedReviewClaim.amount_claimed)}</div></div>
 <div><div style={{fontSize:'11px',color:C.sub,textTransform:'uppercase',marginBottom:'4px'}}>Service</div><div style={{fontWeight:700}}>{selectedReviewClaim.service_type}</div></div>
 <div><div style={{fontSize:'11px',color:C.sub,textTransform:'uppercase',marginBottom:'4px'}}>Status</div><div><Badge status={selectedReviewClaim.status} /></div></div>
 </div>
 </div>
 )}
 {reviewError && (
 <div style={{marginTop:'14px',padding:'12px 14px',background:C.dangerL,border:`1px solid ${C.danger}33`,borderRadius:'10px',fontSize:'12px',color:C.danger}}>
 {reviewError}
 </div>
 )}
 </div>

 <div style={css.reviewCard}>
 {!reviewResult ? (
 <div style={{fontSize:'12px',color:C.sub}}>Run a review to see SHA approval probability, flagged issues, and suggested fixes.</div>
 ) : (
 <>
 <div style={{display:'grid',gridTemplateColumns:'220px 1fr',gap:'18px',alignItems:'start',marginBottom:'18px'}}>
 <div style={{padding:'16px',borderRadius:'12px',background:(REVIEW_STATUS_COLORS[reviewResult.overall] || REVIEW_STATUS_COLORS.WARN).bg,border:`1px solid ${(REVIEW_STATUS_COLORS[reviewResult.overall] || REVIEW_STATUS_COLORS.WARN).color}22`}}>
 <div style={{fontSize:'11px',fontWeight:700,textTransform:'uppercase',letterSpacing:'.5px',color:(REVIEW_STATUS_COLORS[reviewResult.overall] || REVIEW_STATUS_COLORS.WARN).color,marginBottom:'8px'}}>Overall Result</div>
 <div style={{fontSize:'26px',fontWeight:800,color:(REVIEW_STATUS_COLORS[reviewResult.overall] || REVIEW_STATUS_COLORS.WARN).color,marginBottom:'6px'}}>{reviewResult.overall}</div>
 <div style={{fontSize:'12px',color:(REVIEW_STATUS_COLORS[reviewResult.overall] || REVIEW_STATUS_COLORS.WARN).color}}>Score: {Number(reviewResult.score || 0)}/100</div>
 </div>
 <div>
 <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
 <div style={{fontSize:'12px',fontWeight:700,color:C.text}}>Estimated Approval Probability</div>
 <div style={{fontSize:'12px',fontWeight:700,color:C.text}}>{Math.round(Number(reviewResult.estimated_approval_probability || 0))}%</div>
 </div>
 <div style={css.progressTrack}>
 <div style={{...css.progressFill,width:`${Math.max(0, Math.min(100, Number(reviewResult.estimated_approval_probability || 0)))}%`,background:reviewResult.overall==='PASS'?C.primary:reviewResult.overall==='FAIL'?C.danger:C.warn}} />
 </div>
 <div style={{marginTop:'12px',fontSize:'12px',color:C.sub,lineHeight:'1.6'}}>
 {reviewResult.recommendation || 'No recommendation provided.'}
 </div>
 </div>
 </div>

 <div style={{display:'flex',flexDirection:'column',gap:'10px',marginBottom:'18px'}}>
 {(reviewResult.issues || []).length === 0 && (
 <div style={{...css.reviewIssue,fontSize:'12px',color:C.sub}}>No issues were returned for this review.</div>
 )}
 {(reviewResult.issues || []).map((issue, index) => {
 const severity = getReviewSeverityStyle(issue.severity)
 return (
 <div key={`${issue.field}-${index}`} style={css.reviewIssue}>
 <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px',marginBottom:'6px'}}>
 <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
 <span style={{fontSize:'13px'}}>{severity.icon}</span>
 <span style={{...css.badge,background:severity.bg,color:severity.color}}>{issue.severity || 'info'}</span>
 <span style={{fontSize:'12px',fontWeight:700,color:C.text}}>{issue.field || 'claim'}</span>
 </div>
 </div>
 <div style={{fontSize:'13px',color:C.text,fontWeight:600,marginBottom:'4px'}}>{issue.message || 'No issue detail provided.'}</div>
 {issue.fix && <div style={{fontSize:'12px',color:C.sub}}>Suggested fix: {issue.fix}</div>}
 </div>
 )
 })}
 </div>

 <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
 <button style={{...css.btn,background:C.primaryL,color:C.primary}} onClick={handleApplyReviewFixes} disabled={reviewSaveLoading || reviewLoading || !selectedReviewClaim}>
 {reviewSaveLoading ? 'Applying Fixes...' : 'Fix & Resubmit'}
 </button>
 <button style={{...css.btn,background:C.warnL,color:C.warn}} onClick={handleSubmitReviewedClaim} disabled={reviewLoading || reviewSaveLoading || reviewResult.overall !== 'WARN' || !selectedReviewClaim}>
 Submit Anyway
 </button>
 </div>
 </>
 )}
 </div>
 </>
 )}

 {/* PRE-AUTH TAB */}
 {activeTab === 'preauth' && (
 <div style={css.card}>
 <div style={css.cardHead}>
 <span>SHA Pre-Authorization Requests</span>
 <span style={{fontSize:'12px',color:C.sub}}>{preauths.length} requests</span>
 </div>
 <table style={css.table}>
 <thead>
 <tr>{['Patient','Requested Date','Service / Diagnosis','Estimated Cost','Status','Actions'].map(h=><th key={h} style={css.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {preauths.length===0 && <tr><td colSpan={6} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No pre-authorization requests yet</td></tr>}
 {preauths.map(r => (
 <tr key={r.id}>
 <td style={css.td}>
 <div style={{fontWeight:700}}>{r.patients?.full_name || 'Unknown patient'}</div>
 <div style={{fontSize:'11px',color:C.sub}}>{r.patients?.patient_number || r.patients?.mrn || 'No patient number'}</div>
 </td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{formatDate(r.created_at)}</td>
 <td style={css.td}>
 <div style={{fontWeight:600}}>{r.icd10_code ? `${r.icd10_code} — ${r.icd10_description || ''}` : (r.icd10_description || '—')}</div>
 {r.procedure_notes && <div style={{fontSize:'11px',color:C.sub,marginTop:'4px'}}>{r.procedure_notes}</div>}
 </td>
 <td style={{...css.td,fontWeight:700}}>{formatCurrency(r.estimated_cost)}</td>
 <td style={css.td}>
 <div style={{display:'flex',flexDirection:'column',gap:'6px',alignItems:'flex-start'}}>
 <Badge status={r.status}/>
 {latestReviewByClaim[r.id] && <ReviewBadge overall={latestReviewByClaim[r.id].overall} compact />}
 </div>
 </td>
 <td style={css.td}>
 <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
 {r.status === 'Draft' && <button style={{...css.miniBtn,background:'#F3F4F6',color:C.text}} onClick={() => openPreauthModal(r)}>Edit</button>}
 {r.status === 'Draft' && <button style={{...css.miniBtn,background:C.blueL,color:C.blue}} onClick={() => submitPreauth(r)} disabled={saving}>Submit</button>}
 {r.status === 'Submitted to SHA' && <button style={{...css.miniBtn,background:C.warnL,color:C.warn}} onClick={() => updatePreauthStatus(r, 'Pending')} disabled={saving || !isAdmin}>Mark Pending</button>}
 {['Submitted to SHA', 'Pending'].includes(r.status) && <button style={{...css.miniBtn,background:C.primaryL,color:C.primary}} onClick={() => updatePreauthStatus(r, 'Approved')} disabled={saving || !isAdmin}>Approve</button>}
 {['Submitted to SHA', 'Pending'].includes(r.status) && <button style={{...css.miniBtn,background:C.dangerL,color:C.danger}} onClick={() => updatePreauthStatus(r, 'Rejected')} disabled={saving || !isAdmin}>Reject</button>}
 <button style={{...css.miniBtn,background:C.surface,border:`1px solid ${C.border}`,color:C.text}} onClick={() => setShowPreauthDetail(r)}>View</button>
 <button style={{...css.miniBtn,background:C.primaryL,color:C.primary}} onClick={() => convertPreauthToClaim(r)}>{r.status === 'Approved' ? 'Open Claim' : 'Convert to Claim'}</button>
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
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
 <button style={{...css.btn,background:C.blueL,color:C.blue,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={async () => {
  const validation = await validateClaimForSubmission(r)
  cacheValidationResult(validation)
  setValidationModal(validation)
 }}>Validate</button>
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>updateStatus(r.id,'Approved')}>Approve</button>
 <button style={{...css.btn,background:C.dangerL,color:C.danger,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>openRejectionModal(r)}>Reject</button>
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
 <tr>{['Patient','SHA No','Service','Amount','Date','Rejection','Action'].map(h=><th key={h} style={css.th}>{h}</th>)}</tr>
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
 <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>handleFixAndResubmit(r)}>Fix & Resubmit</button>
 <button style={{...css.btn,background:'#F3F4F6',color:C.sub,border:'none',padding:'4px 8px',fontSize:'11px'}}
 onClick={()=>openAppealModal(r)}>File Appeal</button>
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}

 {/* ANALYTICS TAB */}
 {activeTab === 'analytics' && (
 <div style={{display:'grid',gap:'16px'}}>
 <div style={css.kpiGrid}>
  {[
   { label:'Oldest Pending Claim', value:`${oldestPendingDays} days`, sub:'Age since submission / creation', color:C.warn },
   { label:'Recovered This Month', value:formatCurrency(recoveredRevenueThisMonth), sub:'From previously rejected claims', color:C.primary },
   { label:'Payment Lag', value:`${paymentTracking.averageDays} days`, sub:`Across ${paymentTracking.count} paid claims`, color:C.blue },
  ].map(item => (
   <div key={item.label} style={css.cardPad}>
    <div style={css.statLbl}>{item.label}</div>
    <div style={{...css.statVal,color:item.color}}>{item.value}</div>
    <div style={css.statSub}>{item.sub}</div>
   </div>
  ))}
 </div>

 <div style={css.splitGrid}>
  <div style={css.cardPad}>
   <div style={{fontWeight:800,marginBottom:'10px'}}>Monthly Submission Volume</div>
   <div style={css.chartWrap}>
    <ResponsiveContainer width="100%" height="100%">
     <BarChart data={monthlySubmissionData}>
      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
      <RechartsTooltip formatter={(value, name) => [name === 'amount' ? formatCurrency(value) : value, name === 'amount' ? 'Amount' : 'Claims']} />
      <Bar dataKey="count" fill={C.primary} radius={[8, 8, 0, 0]} />
     </BarChart>
    </ResponsiveContainer>
   </div>
  </div>
  <div style={css.cardPad}>
   <div style={{fontWeight:800,marginBottom:'10px'}}>Top Rejection Reasons</div>
   <div style={css.chartWrap}>
    <ResponsiveContainer width="100%" height="100%">
     <PieChart>
      <Pie data={rejectionReasonData} dataKey="value" nameKey="name" innerRadius={54} outerRadius={92} paddingAngle={3}>
       {rejectionReasonData.map((entry, index) => <Cell key={entry.name} fill={ANALYTICS_COLORS[index % ANALYTICS_COLORS.length]} />)}
      </Pie>
      <RechartsTooltip formatter={value => [value, 'Claims']} />
     </PieChart>
    </ResponsiveContainer>
   </div>
  </div>
 </div>

 <div style={css.splitGrid}>
  <div style={css.cardPad}>
   <div style={{fontWeight:800,marginBottom:'10px'}}>Approval Rate Trend</div>
   <div style={css.chartWrap}>
    <ResponsiveContainer width="100%" height="100%">
     <LineChart data={monthlySubmissionData}>
      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
      <RechartsTooltip formatter={value => [`${value}%`, 'Approval rate']} />
      <Line type="monotone" dataKey="approvalRate" stroke={C.success || C.primary} strokeWidth={3} dot={{ r: 3 }} />
      <Line type="monotone" dataKey="target" stroke={C.warn} strokeDasharray="4 4" dot={false} />
     </LineChart>
    </ResponsiveContainer>
   </div>
  </div>
  <div style={css.cardPad}>
   <div style={{fontWeight:800,marginBottom:'10px'}}>Average Processing Time by Claim Type</div>
   <div style={{display:'grid',gap:'10px'}}>
    {averageProcessingByType.slice(0, 6).map(item => (
     <div key={item.name} style={{display:'flex',justifyContent:'space-between',gap:'10px',paddingBottom:'10px',borderBottom:`1px solid ${C.border}`}}>
      <span>{item.name}</span>
      <strong>{item.hours} hrs</strong>
     </div>
    ))}
    {averageProcessingByType.length === 0 && <div style={{fontSize:'12px',color:C.sub}}>No resolved claims yet to calculate processing time.</div>}
   </div>
  </div>
 </div>
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

 {/* PREAUTH MODAL */}
 {showPreauthModal && (
 <div style={css.overlay} onClick={() => setShowPreauthModal(false)}>
 <div style={css.modal} onClick={e=>e.stopPropagation()}>
 <div style={css.modalH}>{editingPreauth ? 'Edit SHA Pre-Authorization' : 'New SHA Pre-Authorization'}</div>
 <label style={css.lbl}>Patient Search / Select</label>
 <input
 style={css.input}
 placeholder="Search by patient name, patient number, MRN or SHA number"
 value={preauthForm.patient_search}
 onChange={e => setPreauthForm({ ...preauthForm, patient_search: e.target.value })}
 />
 {preauthPatientLoading && <div style={css.hint}>Searching patients...</div>}
 {!preauthPatientLoading && preauthPatients.length > 0 && (
 <div style={{border:`1px solid ${C.border}`,borderRadius:'8px',padding:'6px',marginTop:'-4px',marginBottom:'12px',maxHeight:'180px',overflowY:'auto'}}>
 {preauthPatients.map(patient => (
 <button
 key={patient.id}
 type="button"
 onClick={() => selectPreauthPatient(patient)}
 style={{width:'100%',textAlign:'left',border:'none',background:'transparent',padding:'8px 10px',cursor:'pointer',borderBottom:`1px solid ${C.border}`}}
 >
 <div style={{fontWeight:700,color:C.text}}>{patient.full_name}</div>
 <div style={{fontSize:'11px',color:C.sub}}>{patient.patient_number || patient.mrn || 'No patient number'} {patient.insurance_number ? `• ${patient.insurance_number}` : ''}</div>
 </button>
 ))}
 </div>
 )}
 {preauthForm.patient_name && (
 <div style={{background:'#FAFBFD',border:`1px solid ${C.border}`,borderRadius:'8px',padding:'10px 12px',fontSize:'12px',color:C.sub,marginBottom:'12px'}}>
 <strong style={{color:C.text}}>{preauthForm.patient_name}</strong>
 <div>{preauthForm.patient_number || 'No patient number'} {preauthForm.sha_number ? `• ${preauthForm.sha_number}` : ''}</div>
 </div>
 )}
 <div style={css.grid2}>
 <div>
 <label style={css.lbl}>Admission Type</label>
 <select style={{...css.input,cursor:'pointer'}} value={preauthForm.admission_type} onChange={e=>setPreauthForm({...preauthForm,admission_type:e.target.value})}>
 <option>Elective</option>
 <option>Emergency</option>
 <option>Maternity</option>
 </select>
 </div>
 <div>
 <label style={css.lbl}>Service / Procedure Requested</label>
 <select style={{...css.input,cursor:'pointer'}} value={preauthForm.service_requested} onChange={e=>setPreauthForm({...preauthForm,service_requested:e.target.value})}>
 <option value="">Select requested service</option>
 {SHA_SERVICES.map(service => <option key={service} value={service}>{service}</option>)}
 </select>
 </div>
 </div>
 <div style={css.grid2}>
 <div>
 <label style={css.lbl}>CPT / Procedure Code</label>
 <input style={css.input} placeholder="e.g. 99213" value={preauthForm.procedure_code} onChange={e=>setPreauthForm({...preauthForm,procedure_code:e.target.value.toUpperCase()})}/>
 </div>
 <div>
 <label style={css.lbl}>Estimated Cost (KES)</label>
 <input style={css.input} type="number" placeholder="0" value={preauthForm.estimated_cost} onChange={e=>setPreauthForm({...preauthForm,estimated_cost:e.target.value})}/>
 </div>
 </div>
 <PreauthIcd10Field form={preauthForm} setForm={setPreauthForm} />
 <label style={css.lbl}>Supporting Notes</label>
 <textarea style={css.textarea} placeholder="Procedure details, supporting notes, comorbidities..." value={preauthForm.procedure_notes} onChange={e=>setPreauthForm({...preauthForm,procedure_notes:e.target.value})}/>
 <div style={css.grid2}>
 <div>
 <label style={css.lbl}>Requesting Doctor Name</label>
 <input style={css.input} placeholder="Dr. ..." value={preauthForm.requesting_doctor} onChange={e=>setPreauthForm({...preauthForm,requesting_doctor:e.target.value})}/>
 </div>
 <div>
 <label style={css.lbl}>Linked Visit / Admission ID</label>
 <input style={css.input} placeholder="Optional visit or admission ID" value={preauthForm.visit_id} onChange={e=>setPreauthForm({...preauthForm,visit_id:e.target.value})}/>
 </div>
 </div>
 <label style={css.lbl}>Supporting Documents</label>
 <input
 style={{...css.input,padding:'8px 10px'}}
 type="file"
 multiple
 onChange={async e => {
  const files = e.target.files
  if (!files?.length) return
  setPreauthUploading(true)
  const uploads = await uploadSupportingDocuments(files, 'preauth')
  setPreauthForm(current => ({ ...current, supporting_documents: [...(current.supporting_documents || []), ...uploads] }))
  setPreauthUploading(false)
  e.target.value = ''
 }}
 />
 {preauthUploading && <div style={css.hint}>Uploading supporting documents...</div>}
 {(preauthForm.supporting_documents || []).length > 0 && (
  <div style={css.uploadList}>
   {preauthForm.supporting_documents.map((item, index) => (
    <div key={`${item.name || 'doc'}-${index}`} style={css.uploadItem}>
     <div>
      <div style={{fontWeight:700,color:C.text}}>{item.name || `Document ${index + 1}`}</div>
      <div style={{fontSize:'11px',color:item.error ? C.danger : C.sub}}>{item.error || item.url || item.path || 'Saved for claim pack'}</div>
     </div>
     <button type="button" style={{...css.btn,...css.btnGhost,padding:'4px 8px'}} onClick={() => setPreauthForm(current => ({ ...current, supporting_documents: (current.supporting_documents || []).filter((_, docIndex) => docIndex !== index) }))}>Remove</button>
    </div>
   ))}
  </div>
 )}
 <hr style={css.divider}/>
 <div style={{display:'flex',gap:'8px'}}>
 <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={() => setShowPreauthModal(false)}>Cancel</button>
 <button style={{...css.btn,background:'#F3F4F6',color:C.text,flex:1,padding:'10px'}} onClick={() => handleSavePreauth('Draft')} disabled={saving}>{saving ? 'Saving...' : 'Save Draft'}</button>
 <button style={{...css.btn,...css.btnPri,flex:1.4,padding:'10px'}} onClick={() => handleSavePreauth('Submitted to SHA')} disabled={saving}>{saving ? 'Saving...' : 'Submit to SHA'}</button>
 </div>
 </div>
 </div>
 )}

 {/* PREAUTH DETAIL */}
 {showPreauthDetail && (
 <div style={css.overlay} onClick={() => setShowPreauthDetail(null)}>
 <div style={css.modal} onClick={e=>e.stopPropagation()}>
 <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
 <div style={css.modalH}>Pre-Authorization Detail</div>
 <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setShowPreauthDetail(null)}>Close</button>
 </div>
 {[
 ['Patient', showPreauthDetail.patients?.full_name || '—'],
 ['Patient Number', showPreauthDetail.patients?.patient_number || showPreauthDetail.patients?.mrn || '—'],
 ['Requested Date', formatDate(showPreauthDetail.created_at, true)],
 ['Admission Type', showPreauthDetail.admission_type || '—'],
 ['Diagnosis', showPreauthDetail.icd10_code ? `${showPreauthDetail.icd10_code} — ${showPreauthDetail.icd10_description || ''}` : (showPreauthDetail.icd10_description || '—')],
 ['Estimated Cost', formatCurrency(showPreauthDetail.estimated_cost)],
 ['Requesting Doctor', showPreauthDetail.requesting_doctor || '—'],
 ['Status', showPreauthDetail.status || '—'],
 ['Submitted At', formatDate(showPreauthDetail.submitted_at, true)],
 ['Linked Visit / Admission ID', showPreauthDetail.visit_id || '—'],
 ].map(([k,v]) => (
 <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:`1px solid ${C.border}`,fontSize:'13px',gap:'12px'}}>
 <span style={{color:C.sub,fontWeight:500}}>{k}</span>
 <span style={{fontWeight:600,textAlign:'right'}}>{k==='Status' ? <Badge status={v}/> : v}</span>
 </div>
 ))}
 {showPreauthDetail.procedure_notes && (
 <div style={{marginTop:'12px',padding:'12px',background:'#FAFBFD',borderRadius:'8px',border:`1px solid ${C.border}`,fontSize:'13px',color:C.sub,lineHeight:'1.6'}}>
 <div style={{fontWeight:600,color:C.text,marginBottom:'4px',fontSize:'11px',textTransform:'uppercase',letterSpacing:'.4px'}}>Supporting Notes</div>
 {showPreauthDetail.procedure_notes}
 </div>
 )}
 <div style={{marginTop:'16px',display:'flex',gap:'8px',flexWrap:'wrap'}}>
 {showPreauthDetail.status === 'Draft' && <button style={{...css.btn,background:'#F3F4F6',color:C.text,flex:1,padding:'10px'}} onClick={() => { setShowPreauthDetail(null); openPreauthModal(showPreauthDetail) }}>Edit</button>}
 {showPreauthDetail.status === 'Draft' && <button style={{...css.btn,background:C.blueL,color:C.blue,flex:1,padding:'10px'}} onClick={() => { submitPreauth(showPreauthDetail); setShowPreauthDetail(null) }}>Submit</button>}
 {showPreauthDetail.status === 'Submitted to SHA' && <button style={{...css.btn,background:C.warnL,color:C.warn,flex:1,padding:'10px'}} onClick={() => { updatePreauthStatus(showPreauthDetail, 'Pending'); setShowPreauthDetail(null) }}>Mark Pending</button>}
 {['Submitted to SHA', 'Pending'].includes(showPreauthDetail.status) && <button style={{...css.btn,background:C.primaryL,color:C.primary,flex:1,padding:'10px'}} onClick={() => { updatePreauthStatus(showPreauthDetail, 'Approved'); setShowPreauthDetail(null) }} disabled={!isAdmin}>Approve</button>}
 {['Submitted to SHA', 'Pending'].includes(showPreauthDetail.status) && <button style={{...css.btn,background:C.dangerL,color:C.danger,flex:1,padding:'10px'}} onClick={() => { updatePreauthStatus(showPreauthDetail, 'Rejected'); setShowPreauthDetail(null) }} disabled={!isAdmin}>Reject</button>}
 <button style={{...css.btn,background:C.primaryL,color:C.primary,flex:1,padding:'10px'}} onClick={() => { convertPreauthToClaim(showPreauthDetail); setShowPreauthDetail(null) }}>Convert to Claim</button>
 </div>
 </div>
 </div>
 )}

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
 <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={()=>setShowDetail(null)}>Close</button>
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
 {latestReviewByClaim[showDetail.id] && (
 <div style={{marginTop:'12px',padding:'12px',background:'#FAFBFD',borderRadius:'8px',border:`1px solid ${C.border}`}}>
 <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',marginBottom:'6px'}}>
 <div style={{fontWeight:600,color:C.text,fontSize:'11px',textTransform:'uppercase',letterSpacing:'.4px'}}>Last Claim Review</div>
 <ReviewBadge overall={latestReviewByClaim[showDetail.id].overall} />
 </div>
 <div style={{fontSize:'12px',color:C.sub}}>
 Score {latestReviewByClaim[showDetail.id].score || 0}/100 • Approval probability {Math.round(Number(latestReviewByClaim[showDetail.id].approval_probability || 0))}% • Reviewed {formatDate(latestReviewByClaim[showDetail.id].reviewed_at, true)}
 </div>
 </div>
 )}
 {getClaimNotesText(showDetail) && (
 <div style={{marginTop:'12px',padding:'12px',background:'#FAFBFD',borderRadius:'8px',border:`1px solid ${C.border}`,fontSize:'13px',color:C.sub,lineHeight:'1.6'}}>
 <div style={{fontWeight:600,color:C.text,marginBottom:'4px',fontSize:'11px',textTransform:'uppercase',letterSpacing:'.4px'}}>Notes</div>
 {getClaimNotesText(showDetail)}
 </div>
 )}
 {validationByClaim[showDetail.id] && (
  <div style={{marginTop:'12px',display:'grid',gap:'8px'}}>
   <div style={{fontWeight:700,fontSize:'12px',color:C.text}}>Submission Validation</div>
   {validationByClaim[showDetail.id].checklist.map(item => (
    <div key={item.key} style={css.checklistItem}>
     <div>
      <div style={{fontWeight:700,color:C.text}}>{item.label}</div>
      <div style={{fontSize:'11px',color:C.sub,marginTop:'4px'}}>{item.detail}</div>
     </div>
     <span style={{...css.badge,background:item.passed ? C.primaryL : C.dangerL,color:item.passed ? C.primary : C.danger}}>{item.passed ? 'PASS' : 'FAIL'}</span>
    </div>
   ))}
  </div>
 )}
 {Object.keys(getClaimMeta(showDetail).rejection || {}).length > 0 && (
  <div style={{marginTop:'12px',padding:'12px',background:C.dangerL,border:`1px solid ${C.danger}33`,borderRadius:'10px'}}>
   <div style={{fontWeight:700,color:C.danger,marginBottom:'6px'}}>Rejection: {getClaimMeta(showDetail).rejection?.label || getClaimMeta(showDetail).rejection?.code}</div>
   <div style={{fontSize:'12px',color:C.danger}}>{getClaimMeta(showDetail).rejection?.explanation || 'Review and correct the claim before resubmission.'}</div>
  </div>
 )}
 {Object.keys(getClaimMeta(showDetail).appeal || {}).length > 0 && (
  <div style={{marginTop:'12px',padding:'12px',background:C.blueL,border:`1px solid ${C.blue}33`,borderRadius:'10px'}}>
   <div style={{display:'flex',justifyContent:'space-between',gap:'10px',alignItems:'center'}}>
    <div>
     <div style={{fontWeight:700,color:C.blue}}>Appeal Status</div>
     <div style={{fontSize:'12px',color:C.blue,marginTop:'4px'}}>{getClaimMeta(showDetail).appeal?.grounds || 'Appeal filed.'}</div>
    </div>
    <Badge status={getClaimMeta(showDetail).appeal?.status || 'Filed'} />
   </div>
  </div>
 )}
 <div style={{marginTop:'12px',padding:'12px',background:'#FAFBFD',border:`1px solid ${C.border}`,borderRadius:'10px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
  <div>
   <div style={{fontWeight:700,color:C.text}}>FHIR Submission</div>
   <div style={{fontSize:'12px',color:C.sub,marginTop:'4px'}}>
    {showDetail.fhir_submitted_at ? `Last submitted ${formatDate(showDetail.fhir_submitted_at, true)}` : 'This claim has not been sent via FHIR yet.'}
   </div>
  </div>
  <FhirBadge status={showDetail.fhir_status || 'Not Submitted'} />
 </div>
 <div style={{marginTop:'16px',display:'flex',gap:'8px',flexWrap:'wrap'}}>
 {['Draft','Pending'].includes(showDetail.status) && <button style={{...css.btn,background:C.blueL,color:C.blue,border:'none',flex:1,padding:'10px'}} onClick={async()=>{ const validation = await validateClaimForSubmission(showDetail); cacheValidationResult(validation); setValidationModal(validation) }}>Validate</button>}
 {['Draft','Pending'].includes(showDetail.status) && <button style={{...css.btn,...css.btnPri,flex:1,padding:'10px'}} onClick={()=>{ submitClaimToSha(showDetail); setShowDetail(null) }}>Submit to SHA</button>}
 {['Pending','Submitted','Submitted to SHA','Under Review'].includes(showDetail.status) && (
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',flex:1,padding:'10px'}}
 onClick={()=>{updateStatus(showDetail.id,'Approved');setShowDetail(null)}} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Approve</button>
 )}
 {showDetail.status==='Approved' && (
 <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',flex:1,padding:'10px'}}
 onClick={()=>{updateStatus(showDetail.id,'Paid');setShowDetail(null)}} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Mark Paid</button>
 )}
 {!['Rejected','Paid'].includes(showDetail.status) && (
 <button style={{...css.btn,background:C.dangerL,color:C.danger,border:'none',flex:1,padding:'10px'}}
 onClick={()=>{openRejectionModal(showDetail); setShowDetail(null)}} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Reject</button>
 )}
 {showDetail.status==='Rejected' && (
 <button style={{...css.btn,background:'#F3F4F6',color:C.sub,border:'none',flex:1,padding:'10px'}}
 onClick={()=>{openAppealModal(showDetail); setShowDetail(null)}}>Lodge Appeal</button>
 )}
 {showDetail.status==='Rejected' && <button style={{...css.btn,background:C.primaryL,color:C.primary,border:'none',flex:1,padding:'10px'}} onClick={()=>{handleFixAndResubmit(showDetail); setShowDetail(null)}}>Fix & Resubmit</button>}
 {isAdmin && showDetail.invoice_id && (
 <button
 style={{...css.btn,background:C.blueL,color:C.blue,border:'none',flex:1,padding:'10px'}}
 onClick={()=>submitClaimViaFhir(showDetail)}
 disabled={fhirSubmittingId === showDetail.id}
 >
  {fhirSubmittingId === showDetail.id ? 'Sending via FHIR...' : 'Submit via FHIR'}
 </button>
 )}
 {!!showDetail.fhir_response && (
 <button
 style={{...css.btn,background:'#F3F4F6',color:C.text,border:'none',flex:1,padding:'10px'}}
 onClick={()=>setFhirResponseModal({ title: `FHIR Response • ${showDetail.patient_name}`, payload: showDetail.fhir_response })}
 >
  View Response
 </button>
 )}
 <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={()=>setShowDetail(null)}>Close</button>
 </div>
 </div>
 </div>
 )}

 {validationModal && (
  <div style={css.overlay} onClick={() => setValidationModal(null)}>
   <div style={css.modal} onClick={e => e.stopPropagation()}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
     <div style={css.modalH}>SHA Submission Validation</div>
     <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setValidationModal(null)}>Close</button>
    </div>
    <div style={{marginBottom:'12px',fontSize:'12px',color:C.sub}}>
     {validationModal.claim?.patient_name} • {validationModal.claim?.service_type} • {formatCurrency(validationModal.claim?.amount_claimed)}
    </div>
    <div style={{display:'grid',gap:'10px'}}>
     {validationModal.checklist.map(item => (
      <div key={item.key} style={css.checklistItem}>
       <div>
        <div style={{fontWeight:700,color:C.text}}>{item.label}</div>
        <div style={{fontSize:'11px',color:C.sub,marginTop:'4px'}}>{item.detail}</div>
       </div>
       <span style={{...css.badge,background:item.passed ? C.primaryL : C.dangerL,color:item.passed ? C.primary : C.danger}}>{item.passed ? 'PASS' : 'FAIL'}</span>
      </div>
     ))}
    </div>
    <div style={{display:'flex',gap:'8px',marginTop:'16px'}}>
     <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={() => setValidationModal(null)}>Close</button>
     <button style={{...css.btn,...css.btnPri,flex:1.3,padding:'10px'}} disabled={!validationModal.passed} onClick={async () => {
      const claim = validationModal.claim
      setValidationModal(null)
      if (claim) await submitClaimToSha(claim)
     }}>{validationModal.passed ? 'Submit to SHA' : 'Fix Validation Failures'}</button>
 </div>
  </div>
 </div>
)}

 {fhirResponseModal && (
  <div style={css.overlay} onClick={() => setFhirResponseModal(null)}>
   <div style={{...css.modal, width:'760px', maxWidth:'96vw'}} onClick={e => e.stopPropagation()}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px',gap:'12px'}}>
     <div style={css.modalH}>{fhirResponseModal.title || 'FHIR Response'}</div>
     <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setFhirResponseModal(null)}>Close</button>
    </div>
    <pre style={{margin:0,padding:'14px',border:`1px solid ${C.border}`,borderRadius:'10px',background:'#0F172A',color:'#E2E8F0',maxHeight:'60vh',overflow:'auto',fontSize:'12px',lineHeight:1.55}}>
{JSON.stringify(fhirResponseModal.payload || {}, null, 2)}
    </pre>
   </div>
  </div>
 )}

 {rejectionModal && (
  <div style={css.overlay} onClick={() => setRejectionModal(null)}>
   <div style={css.modal} onClick={e => e.stopPropagation()}>
    <div style={css.modalH}>Reject SHA Claim</div>
    <label style={css.lbl}>Reason Code</label>
    <select style={{...css.input,cursor:'pointer'}} value={rejectionModal.code} onChange={e => setRejectionModal(current => ({ ...current, code: e.target.value, explanation: getRejectionGuide(e.target.value).explanation }))}>
     {REJECTION_REASON_OPTIONS.map(code => <option key={code} value={code}>{code} — {getRejectionGuide(code).label}</option>)}
    </select>
    <label style={css.lbl}>Plain English Explanation</label>
    <textarea style={css.textarea} value={rejectionModal.explanation || getRejectionGuide(rejectionModal.code).explanation} onChange={e => setRejectionModal(current => ({ ...current, explanation: e.target.value }))} />
    <div style={css.sectionTitle}>Common Fixes</div>
    <div style={{display:'grid',gap:'8px',marginBottom:'12px'}}>
     {getRejectionGuide(rejectionModal.code).fixes.map(item => (
      <div key={item} style={css.uploadItem}>{item}</div>
     ))}
    </div>
    <label style={css.lbl}>Internal Notes</label>
    <textarea style={css.textarea} placeholder="Optional reviewer note for the corrections team" value={rejectionModal.notes} onChange={e => setRejectionModal(current => ({ ...current, notes: e.target.value }))} />
    <div style={{display:'flex',gap:'8px'}}>
     <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={() => setRejectionModal(null)}>Cancel</button>
     <button style={{...css.btn,background:C.danger,color:'#fff',flex:1.2,padding:'10px'}} onClick={saveRejection} disabled={saving}>{saving ? 'Saving...' : 'Save Rejection'}</button>
    </div>
   </div>
  </div>
 )}

 {appealModal && (
  <div style={css.overlay} onClick={() => setAppealModal(null)}>
   <div style={css.modal} onClick={e => e.stopPropagation()}>
    <div style={css.modalH}>File SHA Appeal</div>
    <div style={{background:C.warnL,border:`1px solid ${C.warn}33`,borderRadius:'8px',padding:'10px 12px',fontSize:'12px',color:C.warn,marginBottom:'12px'}}>
     {appealModal.claim ? `${appealModal.claim.patient_name} — ${Math.max(0, getAppealDaysRemaining(appealModal.claim) ?? 0)} day(s) remaining to file this appeal.` : 'Appeal deadline information unavailable.'}
    </div>
    <label style={css.lbl}>Appeal Status</label>
    <select style={{...css.input,cursor:'pointer'}} value={appealModal.status} onChange={e => setAppealModal(current => ({ ...current, status: e.target.value }))}>
     {['Filed', 'Under Review', 'Upheld', 'Dismissed'].map(status => <option key={status}>{status}</option>)}
    </select>
    <label style={css.lbl}>Grounds for Appeal</label>
    <textarea style={{...css.textarea,minHeight:'120px'}} placeholder="Explain why the claim should be reconsidered..." value={appealModal.grounds} onChange={e => setAppealModal(current => ({ ...current, grounds: e.target.value }))} />
    <label style={css.lbl}>Supporting Documents</label>
    <input
     style={{...css.input,padding:'8px 10px'}}
     type="file"
     multiple
     onChange={async e => {
      const files = e.target.files
      if (!files?.length) return
      setAppealUploading(true)
      const uploads = await uploadSupportingDocuments(files, 'appeals')
      setAppealModal(current => ({ ...current, supporting_documents: [...(current.supporting_documents || []), ...uploads] }))
      setAppealUploading(false)
      e.target.value = ''
     }}
    />
    {appealUploading && <div style={css.hint}>Uploading appeal documents...</div>}
    {(appealModal.supporting_documents || []).length > 0 && (
     <div style={css.uploadList}>
      {appealModal.supporting_documents.map((item, index) => (
       <div key={`${item.name || 'appeal-doc'}-${index}`} style={css.uploadItem}>
        <div>
         <div style={{fontWeight:700,color:C.text}}>{item.name || `Document ${index + 1}`}</div>
         <div style={{fontSize:'11px',color:item.error ? C.danger : C.sub}}>{item.error || item.url || item.path || 'Saved for appeal pack'}</div>
        </div>
        <button type="button" style={{...css.btn,...css.btnGhost,padding:'4px 8px'}} onClick={() => setAppealModal(current => ({ ...current, supporting_documents: (current.supporting_documents || []).filter((_, docIndex) => docIndex !== index) }))}>Remove</button>
       </div>
      ))}
     </div>
    )}
    <div style={{display:'flex',gap:'8px'}}>
     <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={() => setAppealModal(null)}>Cancel</button>
     <button style={{...css.btn,...css.btnPri,flex:1.2,padding:'10px'}} onClick={saveAppeal} disabled={saving || !String(appealModal.grounds || '').trim()}>{saving ? 'Saving...' : 'Save Appeal'}</button>
    </div>
   </div>
  </div>
 )}
 </div>
 )
}

