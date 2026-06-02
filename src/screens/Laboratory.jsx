import { useEffect, useMemo, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QRCodeSVG } from 'qrcode.react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import { canPerformAction } from '../access'
import supabase from '../supabase'
import { useHospital } from '../context'
import useStaff from '../hooks/useStaff'
import { executeWithFallback, omitKeys } from '../utils/dbCompat'
import { logAudit } from '../utils/audit'
import { buildWorkflowInvoiceNote, createServiceLine, SERVICE_SOURCES, stringifyServiceLines } from '../utils/workflowBilling'
import { buildMessage, DEFAULT_TEMPLATES, fetchNotificationConfig, getNotificationSetting, sendPatientNotification } from '../utils/notifications'
import {
  deriveMicrobiologyResultSummary,
  getLabTestsForCategory,
  inferMicrobiologySampleType,
  isMicrobiologySensitivityOrder,
  LAB_TEST_CATEGORIES,
} from '../utils/labCatalog'
import { generateSampleBarcode, getSampleStatusFromLabRow } from '../utils/labWorkflow'
import {
  MICRO_ANTIBIOTIC_OPTIONS,
  buildCriticalAlerts,
  buildStructuredDefaults,
  calculateEgfr,
  evaluateStructuredValue,
  getMicroEmpiricRecommendation,
  matchStructuredTemplate,
  normalizeSusceptibilityChoice,
  summarizeStructuredResult,
} from '../utils/labStructuredResults'
import LabOrdersTab from './laboratory/LabOrdersTab'
import LabResultsTab from './laboratory/LabResultsTab'
import LabReferralsTab from './laboratory/LabReferralsTab'
import LabSampleLabel from './laboratory/LabSampleLabel'

// ── Microbiology C&S tests that need antibiogram PDF upload instead of simple result entry ──
function isCultureSensitivityTest(testType, category) {
  if (isMicrobiologySensitivityOrder(testType, category)) return true
  const name = String(testType || '').toLowerCase()
  return (
    name.includes('culture') ||
    name.includes('c&s') ||
    name.includes('c & s') ||
    name.includes('sensitivity') ||
    name.includes('susceptibility') ||
    name.includes('antibiogram') ||
    (String(category || '').toLowerCase() === 'microbiology' && (
      name.includes('urine') || name.includes('blood') || name.includes('wound') ||
      name.includes('sputum') || name.includes('csf') || name.includes('hvs') ||
      name.includes('stool') || name.includes('swab')
    ))
  )
}

const STATUS_COLORS = {
  Pending: { bg: '#FFF3DC', color: '#C07000', border: '#FAC775' },
  'In Progress': { bg: '#E3F0FB', color: '#1a6fb5', border: '#90C4F0' },
  Complete: { bg: '#F3E8FF', color: '#5B21B6', border: '#D8B4FE' },
  Critical: { bg: '#FCEBEB', color: '#A32D2D', border: '#F09595' },
}

const PRIORITY_COLORS = {
  Routine: { bg: '#f5f5f5', color: '#666' },
  Urgent: { bg: '#FFF3DC', color: '#C07000' },
  STAT: { bg: '#FCEBEB', color: '#A32D2D' },
}

const SAMPLE_STATUS_COLORS = {
  Ordered: { bg: '#F3F4F6', color: '#555', border: '#D1D5DB' },
  Collected: { bg: '#FEF3C7', color: '#B45309', border: '#FCD34D' },
  'In Progress': { bg: '#DBEAFE', color: '#1D4ED8', border: '#93C5FD' },
  'Referred Out': { bg: '#F3E8FF', color: '#7C3AED', border: '#D8B4FE' },
  Resulted: { bg: '#DCFCE7', color: '#15803D', border: '#86EFAC' },
}

const LAB_STAGE_PIPELINE = ['Ordered', 'Sample Collected', 'Processing', 'Results Ready', 'Reviewed']
const AGE_BUCKET_COLORS = {
  fresh: { bg: '#F3E8FF', color: '#5B21B6', border: '#D8B4FE' },
  watch: { bg: '#FFF3DC', color: '#C07000', border: '#FAC775' },
  late: { bg: '#FFF0E3', color: '#C46600', border: '#FDBA74' },
  critical: { bg: '#FCEBEB', color: '#A32D2D', border: '#F09595' },
}

const PAGE_SIZE = 100
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200]
const REFERRAL_LABS = ['Lancet Kenya', 'AAR Healthcare', 'Pathologists Lancet', 'KEMRI', 'Aga Khan Hospital Lab', 'Other']
const REFERRAL_SAMPLE_TYPES = ['Blood', 'Urine', 'Stool', 'Swab', 'Tissue', 'CSF', 'Other']
const REFERRAL_TRANSPORT_METHODS = ['In-house', 'Patient carries', 'Courier']

function formatKES(value) {
  return `KES ${Number(value || 0).toLocaleString()}`
}

function buildStandaloneReferralNotes(testName, notes) {
  const cleanTestName = String(testName || '').trim()
  const cleanNotes = String(notes || '').trim()
  if (!cleanTestName) return cleanNotes
  return [`Test: ${cleanTestName}`, cleanNotes].filter(Boolean).join('\n')
}

function extractStandaloneReferralTestName(referral) {
  const linkedName = referral?.lab_tests?.test_name || referral?.lab_tests?.test_type
  if (linkedName) return linkedName
  const match = String(referral?.special_instructions || '').match(/^Test:\s*(.+)$/m)
  return match?.[1]?.trim() || 'Standalone referral'
}

function getReferralDisplayStatus(referral) {
  if (!referral) return 'Sent'
  if (referral.status === 'Result Received') return 'Result Received'
  if (referral.status === 'Overdue') return 'Overdue'
  if (referral.expected_return_date && new Date(referral.expected_return_date) < new Date()) return 'Overdue'
  return referral.status || 'Sent'
}

function hasLinkedLabInvoice(invoices, test) {
  if (!test) return false
  const notePrefix = `WF|${SERVICE_SOURCES.LABORATORY}|${test.id}|`
  return invoices.some(inv => {
    const note = String(inv.notes || '')
    if (note.startsWith(notePrefix)) return true
    if (test.visit_id && inv.visit_id === test.visit_id) {
      return String(inv.services || '').toLowerCase().includes(String(test.test_type || '').toLowerCase())
    }
    return false
  })
}

function getPatientNumber(patient) {
  return patient?.patient_number || patient?.patient_no || patient?.mrn || patient?.national_id || patient?.id || '—'
}

function getTimeDiffMinutes(startAt, endAt = Date.now()) {
  const start = new Date(startAt || 0).getTime()
  if (!start) return 0
  return Math.max(0, Math.floor((endAt - start) / 60000))
}

function formatAgingLabel(totalMinutes) {
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  return mins ? `${hours}h ${mins}m` : `${hours}h`
}

function getAgingMeta(test, nowValue = Date.now()) {
  const minutes = getTimeDiffMinutes(test?.ordered_at, nowValue)
  let bucket = 'fresh'
  if (minutes >= 480) bucket = 'critical'
  else if (minutes >= 240) bucket = 'late'
  else if (minutes >= 60) bucket = 'watch'
  return {
    minutes,
    label: formatAgingLabel(minutes),
    bucket,
    colors: AGE_BUCKET_COLORS[bucket],
    overFourHours: minutes >= 240,
  }
}

function getWorkflowStage(test) {
  if (test?.reviewed_at) return 'Reviewed'
  if (test?.results_ready_at || test?.sample_status === 'Resulted' || test?.status === 'Complete') return 'Results Ready'
  if (test?.processing_started_at || test?.sample_status === 'In Progress' || test?.status === 'In Progress') return 'Processing'
  if (test?.sample_collected_at || test?.sample_status === 'Collected') return 'Sample Collected'
  return 'Ordered'
}

function getNextWorkflowStage(test) {
  const currentStage = getWorkflowStage(test)
  const currentIndex = LAB_STAGE_PIPELINE.indexOf(currentStage)
  return LAB_STAGE_PIPELINE[Math.min(currentIndex + 1, LAB_STAGE_PIPELINE.length - 1)]
}

function getStageActionLabel(test) {
  const currentStage = getWorkflowStage(test)
  if (currentStage === 'Ordered') return 'Mark Sample Collected'
  if (currentStage === 'Sample Collected') return 'Start Processing'
  if (currentStage === 'Results Ready') return 'Mark Reviewed'
  return 'Advance Stage'
}

function buildStageUpdatePayload(test, nextStage, performer = '') {
  const now = new Date().toISOString()
  const payload = {}
  if (nextStage === 'Sample Collected') {
    payload.sample_status = 'Collected'
    payload.sample_collected_at = now
  }
  if (nextStage === 'Processing') {
    payload.sample_status = 'In Progress'
    payload.status = 'In Progress'
    payload.processing_started_at = now
    payload.sample_collected_at = test?.sample_collected_at || now
  }
  if (nextStage === 'Reviewed') {
    payload.reviewed_at = now
    payload.reviewed_by = performer || null
  }
  return payload
}

function getSampleTypeLabel(test) {
  return inferMicrobiologySampleType(test?.test_type || '') || 'Sample'
}

function openSampleLabelPrintWindow(test, patientRecord) {
  const sampleBarcode = test.sample_barcode || generateSampleBarcode()
  const patientNumber = getPatientNumber(patientRecord)
  const collectionStamp = new Date().toLocaleString('en-KE')
  const printWindow = window.open('', '_blank', 'width=520,height=320')
  if (!printWindow) return
  const labelMarkup = renderToStaticMarkup(
    <LabSampleLabel
      test={test}
      patientRecord={patientRecord}
      sampleBarcode={sampleBarcode}
      patientNumber={patientNumber}
      collectionStamp={collectionStamp}
    />
  )

  printWindow.document.write(`
    <html>
      <head>
        <title>Sample Label</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></script>
        <style>
          @page { size: 50mm 25mm; margin: 0; }
          body { margin: 0; font-family: Arial, sans-serif; background: #fff; }
          .page { width: 50mm; height: 25mm; display: flex; align-items: center; justify-content: center; }
          .label { width: 50mm; height: 25mm; box-sizing: border-box; border: 1px solid #CFE2D7; padding: 2.2mm; display: grid; grid-template-columns: 1fr; gap: 1.2mm; }
          .top { display: flex; justify-content: space-between; gap: 3mm; font-size: 7.2px; color: #2A3A34; }
          .name { font-weight: 700; font-size: 8px; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .meta { font-size: 6.8px; color: #47554F; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .barcode-wrap { display: flex; align-items: center; justify-content: center; }
          svg { width: 100%; height: 10mm; }
          .code { font-size: 7px; font-weight: 700; text-align: center; letter-spacing: 0.2px; }
          @media print {
            body * { visibility: hidden; }
            .page, .page * { visibility: visible; }
            .page { position: absolute; left: 0; top: 0; }
          }
        </style>
      </head>
      <body>
        ${labelMarkup}
        <script>
          JsBarcode('#sample-barcode', '${sampleBarcode}', { format: 'CODE128', displayValue: false, margin: 0, height: 32, width: 1.4 });
          setTimeout(() => window.print(), 250);
        </script>
      </body>
    </html>
  `)
  printWindow.document.close()
}

// ── Convert file to base64 ────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function Laboratory() {
  const { hospitalId, hospitalName, userRole, navigate } = useHospital()
  const [tests, setTests] = useState([])
  const [invoices, setInvoices] = useState([])
  const [labChargeCodes, setLabChargeCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterPriority, setFilterPriority] = useState('All')
  const [filterCategory, setFilterCategory] = useState('All')
  const [filterPatient, setFilterPatient] = useState('')
  const [filterSource, setFilterSource] = useState('All')
  const today = new Date().toISOString().split('T')[0]
  const [nowTick, setNowTick] = useState(Date.now())
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [scannerValue, setScannerValue] = useState('')

  const [selected, setSelected] = useState(null)
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [showResultModal, setShowResultModal] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [showReferralModal, setShowReferralModal] = useState(false)
  const [showReferralResultModal, setShowReferralResultModal] = useState(false)
  const [referrals, setReferrals] = useState([])
  const [selectedReferral, setSelectedReferral] = useState(null)
  const [referralTestSearch, setReferralTestSearch] = useState('')
  const [referralPatientSearch, setReferralPatientSearch] = useState('')

  // ── NEW: Antibiogram PDF upload modal ─────────────────────────────────────
  const [showAntibiogramModal, setShowAntibiogramModal] = useState(false)
  const [antibiogramForm, setAntibiogramForm] = useState({
    organism: '',
    sample_type: 'Urine',
    growth: 'Heavy',
    result_summary: '',
    interpretation: '',
    performed_by: '',
    verified_by: '',
    notes: '',
    esbl: false,
    mrsa: false,
    carbapenem_r: false,
    susceptibility_profile: {},
  })
  const [antibiogramFile, setAntibiogramFile] = useState(null)
  const [antibiogramFileName, setAntibiogramFileName] = useState('')
  const [antibiogramUploading, setAntibiogramUploading] = useState(false)
  const [antibiogramUploadStep, setAntibiogramUploadStep] = useState('')

  const { staff: allStaff, availableStaff: allAvailableStaff } = useStaff()

  const labStaff = useMemo(() => allStaff.filter(s =>
    s.role_category === 'Laboratory' ||
    s.department === 'Laboratory' ||
    (s.role || '').toLowerCase().includes('lab')
  ), [allStaff])

  const availableLabStaff = useMemo(() =>
    allAvailableStaff.filter(s => labStaff.some(m => m.id === s.id)),
  [allAvailableStaff, labStaff])

  const [orderForm, setOrderForm] = useState({
    patient_name: '', patient_id_text: '', phone: '',
    test_type: '', category: 'Haematology',
    priority: 'Routine', notes: '', ordered_by: '',
    payment_method: 'Cash', mpesa_ref: '', amount: '',
    test_location: 'In-House', assigned_to: '',
  })
  const [customTest, setCustomTest] = useState('')

  const [resultForm, setResultForm] = useState({
    result_text: '', result_value: '', reference_range: '',
    interpretation: '', performed_by: '', result_notes: '',
    result_file_url: '',
    structured_values: {},
    structured_template_key: '',
  })

  const [assignTech, setAssignTech] = useState('')
  const [customTech, setCustomTech] = useState('')
  const [activeTab, setActiveTab] = useState('tests')
  const [referralForm, setReferralForm] = useState({
    linked_mode: 'linked',
    lab_test_id: '',
    standalone_patient_id: '',
    standalone_test_name: '',
    referred_to: REFERRAL_LABS[0],
    sample_type: 'Blood',
    date_sent: new Date().toISOString().slice(0, 10),
    transport_method: 'In-house',
    expected_tat_days: 3,
    special_instructions: '',
    referral_cost: '',
  })
  const [referralResultForm, setReferralResultForm] = useState({
    result_text: '',
    result_date: new Date().toISOString().slice(0, 10),
    external_reference: '',
  })

  const [patients, setPatients] = useState([])
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState([])
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [uniquePatients, setUniquePatients] = useState([])
  const [testPage, setTestPage] = useState(1)
  const [testPageSize, setTestPageSize] = useState(PAGE_SIZE)
  const [testTotalCount, setTestTotalCount] = useState(0)
  const [invoicePage, setInvoicePage] = useState(1)
  const [invoicePageSize, setInvoicePageSize] = useState(PAGE_SIZE)
  const [invoiceTotalCount, setInvoiceTotalCount] = useState(0)

  const SAMPLE_TYPES = ['Urine', 'Blood', 'Wound Swab', 'Sputum', 'CSF', 'HVS', 'Stool', 'Other']
  const canPostLabResults = canPerformAction(userRole, 'post_lab_results')

  useEffect(() => {
    if (!hospitalId) { setLoading(false); return }
    fetchPatients(); fetchLabChargeCodes(); fetchReferrals()
  }, [hospitalId])

  useEffect(() => {
    if (!hospitalId) return undefined
    fetchTests(); fetchInvoices(); fetchReferrals()
    const localHandler = () => { fetchTests(); fetchInvoices(); fetchReferrals() }
    const channel = supabase
      .channel(`laboratory-screen-${hospitalId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lab_tests', filter: `hospital_id=eq.${hospitalId}` }, () => fetchTests())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `hospital_id=eq.${hospitalId}` }, () => fetchInvoices())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lab_referrals', filter: `hospital_id=eq.${hospitalId}` }, () => fetchReferrals())
      .subscribe()
    window.addEventListener('remedacare:workflow_changed', localHandler)
    return () => {
      window.removeEventListener('remedacare:workflow_changed', localHandler)
      try { supabase.removeChannel(channel) } catch (_) {}
    }
  }, [hospitalId])

  useEffect(() => {
    if (!hospitalId) return
    fetchTests(); fetchInvoices(); fetchReferrals()
  }, [hospitalId, dateFrom, dateTo, testPage, testPageSize, invoicePage, invoicePageSize])

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!tests.length) return
    try {
      const params = new URLSearchParams(window.location.search)
      const targetId = params.get('labResultId')
      if (!targetId) return
      const match = tests.find(test => String(test.id) === String(targetId))
      if (!match) return
      setActiveTab('tests')
      setSelected(match)
    } catch (_) {}
  }, [tests])

  useEffect(() => {
    if (!selected?.id || !tests.length) return
    const fresh = tests.find(test => test.id === selected.id)
    if (fresh) setSelected(prev => ({ ...prev, ...fresh }))
  }, [tests, selected?.id])

  async function fetchTests() {
    setLoading(true)
    const from = dateFrom || today
    const to = dateTo || today
    const start = (testPage - 1) * testPageSize
    const end = testPage * testPageSize - 1
    const { data, count } = await supabase.from('lab_tests')
      .select('*', { count: 'exact' })
      .eq('hospital_id', hospitalId)
      .gte('ordered_at', `${from}T00:00:00`)
      .lte('ordered_at', `${to}T23:59:59`)
      .order('ordered_at', { ascending: false })
      .range(start, end)
    const tests = data || []
    setTests(tests)
    setTestTotalCount(count || 0)
    setUniquePatients([...new Set(tests.map(t => t.patient_name).filter(Boolean))].sort())
    setLoading(false)
  }

  async function fetchInvoices() {
    const from = dateFrom || today
    const to = dateTo || today
    const start = (invoicePage - 1) * invoicePageSize
    const end = invoicePage * invoicePageSize - 1
    const { data, count } = await supabase
      .from('invoices')
      .select('id, visit_id, patient_id, patient_name, invoice_no, services, amount_kes, paid_kes, balance_kes, payment_method, status, notes, created_at', { count: 'exact' })
      .eq('hospital_id', hospitalId)
      .gte('created_at', `${from}T00:00:00`)
      .lte('created_at', `${to}T23:59:59`)
      .order('created_at', { ascending: false })
      .range(start, end)
    setInvoices(data || [])
    setInvoiceTotalCount(count || 0)
  }

  async function fetchReferrals() {
    if (!hospitalId) return
    const { data } = await supabase
      .from('lab_referrals')
      .select('*, patients(id, full_name, patient_number, mrn), lab_tests(id, test_name, test_type, patient_name)')
      .eq('hospital_id', hospitalId)
      .order('date_sent', { ascending: false })
    setReferrals(data || [])
  }

  async function fetchLabChargeCodes() {
    const { data } = await supabase
      .from('charge_codes')
      .select('id, code, name, unit_price_kes')
      .eq('hospital_id', hospitalId)
      .eq('category', 'Lab')
      .eq('is_active', true)
    setLabChargeCodes(data || [])
  }

  // ── Match a test name to the best charge_code entry ──────────────────────
  function matchLabChargeCode(testType) {
    if (!testType || !labChargeCodes.length) return null
    const needle = testType.toLowerCase().replace(/[()&\/]/g, ' ').replace(/\s+/g, ' ').trim()
    // 1. Exact name match
    let match = labChargeCodes.find(cc => cc.name.toLowerCase() === needle)
    if (match) return match
    // 2. Charge code name is contained in test name, or vice versa
    match = labChargeCodes.find(cc => {
      const hay = cc.name.toLowerCase().replace(/[()&\/]/g, ' ').replace(/\s+/g, ' ').trim()
      return needle.includes(hay) || hay.includes(needle)
    })
    if (match) return match
    // 3. Keyword overlap — at least 2 significant words in common
    const stopWords = new Set(['test', 'and', 'the', 'of', 'for', 'rapid', 'full', 'count'])
    const needleWords = needle.split(' ').filter(w => w.length > 2 && !stopWords.has(w))
    match = labChargeCodes.find(cc => {
      const hayWords = cc.name.toLowerCase().replace(/[()&\/]/g, ' ').split(' ').filter(w => w.length > 2 && !stopWords.has(w))
      const overlap = needleWords.filter(w => hayWords.some(h => h.startsWith(w) || w.startsWith(h)))
      return overlap.length >= 2
    })
    return match || null
  }

  // ── Auto-create invoice for a doctor-ordered lab test ────────────────────
  async function autoInvoiceLabTest(test) {
    if (!test?.id) return
    // Skip if already invoiced
    if (hasLinkedLabInvoice(invoices, test)) return

    const cc = matchLabChargeCode(test.test_type)
    const amount = cc?.unit_price_kes || 0
    // If no price match and amount is 0, still create a Pending invoice
    // so the billing desk can see and price it — don't silently drop it
    const isInsurance = !['Cash', 'M-Pesa'].includes(test.payment_method || 'Cash')
    const payMethod = test.payment_method || 'Cash'
    const paidAmount = (!isInsurance && amount > 0) ? amount : 0
    const balance = amount - paidAmount
    const status = amount === 0 ? 'Pending' : (balance <= 0 ? 'Paid' : 'Pending')
    const receiptNo = `INV-${Date.now().toString().slice(-6)}`

    await supabase.from('invoices').insert({
      hospital_id: hospitalId,
      patient_id: test.patient_id || null,
      visit_id: test.visit_id || null,
      patient_name: test.patient_name || '',
      invoice_no: receiptNo,
      services: stringifyServiceLines([createServiceLine({
        label: test.test_type,
        qty: 1,
        unitPrice: amount,
        total: amount,
        source: SERVICE_SOURCES.LABORATORY,
        sourceId: test.id,
        visitId: test.visit_id || null,
        meta: { category: test.category, priority: test.priority },
      })]),
      amount_kes: amount,
      paid_kes: paidAmount,
      balance_kes: balance,
      payment_method: payMethod,
      insurer: isInsurance ? payMethod : null,
      status,
      notes: buildWorkflowInvoiceNote({
        source: SERVICE_SOURCES.LABORATORY,
        sourceId: test.id,
        visitId: test.visit_id || null,
        summary: `Lab: ${test.test_type}${cc ? '' : ' — price to be set'}`,
      }),
      paid_at: status === 'Paid' ? new Date().toISOString() : null,
    })
    fetchInvoices()
    try {
      window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', {
        detail: { test_id: test.id, source: 'lab-auto-billing' },
      }))
    } catch (_) {}
  }

  async function fetchPatients() {
    const { data } = await supabase.from('patients')
      .select('*')
      .eq('hospital_id', hospitalId)
      .order('full_name')
      .limit(300)
    setPatients(data || [])
  }

  function searchPatients(q) {
    setPatientSearch(q)
    if (!q.trim()) { setPatientResults([]); return }
    setPatientResults(patients.filter(p => p.full_name?.toLowerCase().includes(q.toLowerCase()) || p.phone?.includes(q)).slice(0, 6))
  }

  function pickPatient(p) {
    setSelectedPatient(p)
    setPatientSearch(p.full_name)
    setPatientResults([])
    setOrderForm(f => ({ ...f, patient_name: p.full_name, phone: p.phone || '' }))
  }

  function openReferralModal() {
    setReferralForm({
      linked_mode: 'linked',
      lab_test_id: '',
      standalone_patient_id: '',
      standalone_test_name: '',
      referred_to: REFERRAL_LABS[0],
      sample_type: 'Blood',
      date_sent: new Date().toISOString().slice(0, 10),
      transport_method: 'In-house',
      expected_tat_days: 3,
      special_instructions: '',
      referral_cost: '',
    })
    setReferralTestSearch('')
    setReferralPatientSearch('')
    setShowReferralModal(true)
  }

  async function handleSaveReferral() {
    const linkedTest = tests.find(test => test.id === referralForm.lab_test_id) || null
    const standalonePatient = patients.find(patient => patient.id === referralForm.standalone_patient_id) || null
    const patientId = linkedTest?.patient_id || standalonePatient?.id || null
    const visitId = linkedTest?.visit_id || null
    const testName = linkedTest?.test_name || linkedTest?.test_type || referralForm.standalone_test_name

    if (!patientId) {
      window.notifyFromLegacyAlert('Select a patient or link the referral to an existing lab test.')
      return
    }
    if (!testName) {
      window.notifyFromLegacyAlert('Select a pending test or enter the standalone test name.')
      return
    }
    if (!referralForm.referred_to) {
      window.notifyFromLegacyAlert('Enter the referral facility name.')
      return
    }

    setSaving(true)
    const sentDate = new Date(`${referralForm.date_sent}T00:00:00`)
    const expectedDate = new Date(sentDate)
    expectedDate.setDate(expectedDate.getDate() + Number(referralForm.expected_tat_days || 0))

    const payload = {
      hospital_id: hospitalId,
      patient_id: patientId,
      visit_id: visitId,
      lab_test_id: linkedTest?.id || null,
      referred_to: referralForm.referred_to,
      sample_type: referralForm.sample_type,
      transport_method: referralForm.transport_method,
      date_sent: referralForm.date_sent,
      expected_return_date: expectedDate.toISOString().slice(0, 10),
      referral_cost: Number(referralForm.referral_cost || 0),
      special_instructions: linkedTest
        ? (referralForm.special_instructions || null)
        : buildStandaloneReferralNotes(testName, referralForm.special_instructions),
      status: 'Sent',
      created_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('lab_referrals').insert(payload)
    if (error) {
      window.notifyFromLegacyAlert('Error saving referral: ' + error.message)
      setSaving(false)
      return
    }

    if (linkedTest?.id) {
      await supabase.from('lab_tests').update({ sample_status: 'Referred Out' }).eq('id', linkedTest.id)
      if (selected?.id === linkedTest.id) {
        setSelected({ ...linkedTest, sample_status: 'Referred Out' })
      }
    }

    setShowReferralModal(false)
    setSaving(false)
    fetchTests()
    fetchReferrals()
  }

  function openReferralResultModal(referral) {
    setSelectedReferral(referral)
    setReferralResultForm({
      result_text: referral.result_text || '',
      result_date: referral.result_date || new Date().toISOString().slice(0, 10),
      external_reference: referral.external_reference || '',
    })
    setShowReferralResultModal(true)
  }

  async function handleSaveReferralResult() {
    if (!selectedReferral) return
    if (!referralResultForm.result_text.trim()) {
      window.notifyFromLegacyAlert('Enter the result text before saving.')
      return
    }
    setSaving(true)
    const referralUpdate = {
      status: 'Result Received',
      result_text: referralResultForm.result_text.trim(),
      result_date: referralResultForm.result_date,
      external_reference: referralResultForm.external_reference || null,
    }
    const { error } = await supabase.from('lab_referrals').update(referralUpdate).eq('id', selectedReferral.id)
    if (error) {
      window.notifyFromLegacyAlert('Error saving referral result: ' + error.message)
      setSaving(false)
      return
    }

    if (selectedReferral.lab_test_id) {
      await supabase.from('lab_tests').update({
        result_text: referralResultForm.result_text.trim(),
        result_notes: referralResultForm.external_reference ? `External lab reference: ${referralResultForm.external_reference}` : null,
        resulted_at: referralResultForm.result_date ? `${referralResultForm.result_date}T12:00:00` : new Date().toISOString(),
        status: 'Complete',
        sample_status: 'Resulted',
      }).eq('id', selectedReferral.lab_test_id)
    }

    setShowReferralResultModal(false)
    setSelectedReferral(null)
    setSaving(false)
    fetchTests()
    fetchReferrals()
  }

  async function markReferralOverdue(referral) {
    setSaving(true)
    await supabase.from('lab_referrals').update({ status: 'Overdue' }).eq('id', referral.id)
    setSaving(false)
    fetchReferrals()
  }

  // ── Open antibiogram upload modal for C&S tests ───────────────────────────
  function openAntibiogramModal(test) {
    const existingProfile = test?.result_json?.susceptibility_profile && typeof test.result_json.susceptibility_profile === 'object'
      ? test.result_json.susceptibility_profile
      : {}
    setSelected(test)
    setAntibiogramForm({
      organism: test?.result_value || '',
      sample_type: inferMicrobiologySampleType(test.test_type) || 'Urine',
      growth: 'Heavy',
      result_summary: test?.result_text || '',
      interpretation: test?.interpretation || '',
      performed_by: test?.performed_by || test.assigned_to || '',
      verified_by: '',
      notes: test.result_notes || test.notes || '',
      esbl: false,
      mrsa: false,
      carbapenem_r: false,
      susceptibility_profile: existingProfile,
    })
    setAntibiogramFile(null)
    setAntibiogramFileName('')
    setAntibiogramUploadStep('')
    setShowAntibiogramModal(true)
  }

  // ── Handle antibiogram PDF upload & result save ───────────────────────────
  async function handleSaveAntibiogram() {
    if (!antibiogramForm.organism) { window.notifyFromLegacyAlert('Enter the organism identified (or "No growth" if culture is negative)'); return }
    if (!antibiogramFile) { window.notifyFromLegacyAlert('Upload the PDF or image of the culture & sensitivity report from the lab machine'); return }
    if (!antibiogramForm.performed_by) { window.notifyFromLegacyAlert('Enter the name of the lab technician who performed this test'); return }

    setAntibiogramUploading(true)
    const test = selected
    const now = new Date().toISOString()
    const today = now.split('T')[0]

    try {
      const susceptibilityProfile = Object.fromEntries(
        Object.entries(antibiogramForm.susceptibility_profile || {})
          .map(([drug, value]) => [drug, normalizeSusceptibilityChoice(value)])
          .filter(([, value]) => value),
      )
      const empiricRecommendation = getMicroEmpiricRecommendation(antibiogramForm.organism, susceptibilityProfile)

      // Step 1 — Convert PDF/image to base64 for storage
      setAntibiogramUploadStep('Reading file...')
      const base64DataUrl = await fileToBase64(antibiogramFile)

      // Step 2 — Upload to Supabase Storage (microbiology-results bucket)
      // If storage not configured, we store as result_file_url reference
      setAntibiogramUploadStep('Uploading report...')
      let fileUrl = null
      try {
        const fileExt = antibiogramFile.name.split('.').pop()
        const filePath = `${hospitalId}/antibiograms/${test.id}_${Date.now()}.${fileExt}`
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('lab-reports')
          .upload(filePath, antibiogramFile, { contentType: antibiogramFile.type, upsert: true })
        if (!uploadError && uploadData) {
          const { data: urlData } = supabase.storage.from('lab-reports').getPublicUrl(filePath)
          fileUrl = urlData?.publicUrl || null
        }
      } catch (storageErr) {
        console.warn('Storage upload failed, proceeding without file URL:', storageErr)
        // Continue — the report data is stored in the antibiogram record
      }

      // Step 3 — Update lab_test to Complete with summary result
      setAntibiogramUploadStep('Saving lab result...')
      const resultText = [
        antibiogramForm.organism ? `Organism: ${antibiogramForm.organism}` : null,
        antibiogramForm.growth ? `Growth: ${antibiogramForm.growth}` : null,
        antibiogramForm.result_summary || null,
        antibiogramForm.esbl ? 'ESBL: Positive' : null,
        antibiogramForm.mrsa ? 'MRSA: Positive' : null,
        antibiogramForm.carbapenem_r ? 'Carbapenem Resistant: Yes' : null,
        Object.keys(susceptibilityProfile).length ? `Sensitivity: ${Object.entries(susceptibilityProfile).map(([drug, sir]) => `${drug} ${sir}`).join(', ')}` : null,
        empiricRecommendation ? `Empiric note: ${empiricRecommendation}` : null,
      ].filter(Boolean).join('\n')

      const { error: labUpdateError } = await executeWithFallback(
        () => supabase.from('lab_tests').update({
          result_text: resultText,
          result_value: antibiogramForm.organism || 'Culture complete — see antibiogram',
          interpretation: antibiogramForm.interpretation || null,
          performed_by: antibiogramForm.performed_by,
          result_notes: antibiogramForm.notes || null,
          result_file_url: fileUrl || null,
          status: 'Complete',
          sample_status: 'Resulted',
          resulted_at: now,
          results_ready_at: now,
          result_json: {
            susceptibility_profile: susceptibilityProfile,
            esbl: antibiogramForm.esbl,
            mrsa: antibiogramForm.mrsa,
            carbapenem_r: antibiogramForm.carbapenem_r,
            recommendation: empiricRecommendation,
          },
        }).eq('id', test.id),
        async () => supabase.from('lab_tests').update({
          result_text: resultText,
          result_value: antibiogramForm.organism || 'Culture complete — see antibiogram',
          interpretation: antibiogramForm.interpretation || null,
          performed_by: antibiogramForm.performed_by,
          result_notes: antibiogramForm.notes || null,
          result_file_url: fileUrl || null,
          status: 'Complete',
          sample_status: 'Resulted',
          resulted_at: now,
        }).eq('id', test.id),
      )

      if (labUpdateError) throw new Error('Lab test update failed: ' + labUpdateError.message)

      // Step 4 — Create/update microbiology_results record (feeds Antibiogram screen)
      setAntibiogramUploadStep('Syncing to Antibiogram...')
      const microPayload = {
        hospital_id: hospitalId,
        patient_id: test.patient_id || null,
        visit_id: test.visit_id || null,
        lab_test_id: test.id,
        patient_name: test.patient_name || null,
        sample_type: antibiogramForm.sample_type,
        collection_date: test.ordered_at ? String(test.ordered_at).split('T')[0] : today,
        received_date: today,
        reported_date: today,
        organism_identified: antibiogramForm.organism,
        growth: antibiogramForm.growth,
        clinical_notes: [antibiogramForm.result_summary, antibiogramForm.notes].filter(Boolean).join('\n\n') || null,
        performed_by: antibiogramForm.performed_by,
        verified_by: antibiogramForm.verified_by || null,
        esbl: antibiogramForm.esbl,
        mrsa: antibiogramForm.mrsa,
        carbapenem_r: antibiogramForm.carbapenem_r,
        vre: false,
        susceptibility_profile: susceptibilityProfile,
        updated_at: now,
        // Store file reference in ai_suggestion field if no storage URL
        ai_suggestion: fileUrl ? null : `PDF uploaded: ${antibiogramFile.name} (${(antibiogramFile.size / 1024).toFixed(0)} KB) — view in lab reports`,
      }

      // Check if microbiology result already exists for this lab test
      const { data: existing } = await supabase
        .from('microbiology_results')
        .select('id')
        .eq('hospital_id', hospitalId)
        .eq('lab_test_id', test.id)
        .maybeSingle()

      const { error: microError } = await executeWithFallback(
        () => existing?.id
          ? supabase.from('microbiology_results').update(microPayload).eq('id', existing.id)
          : supabase.from('microbiology_results').insert(microPayload),
        async () => {
          const fallback = omitKeys(microPayload, ['susceptibility_profile', 'lab_test_id', 'received_date', 'reported_date'])
          return existing?.id
            ? supabase.from('microbiology_results').update(fallback).eq('id', existing.id)
            : supabase.from('microbiology_results').insert(fallback)
        }
      )
      if (microError) console.warn('Microbiology result sync warning:', microError)

      // Step 5 — Also update/create legacy antibiogram record for backward compat
      await supabase.from('antibiograms').upsert({
        hospital_id: hospitalId,
        patient_id: test.patient_id,
        visit_id: test.visit_id,
        test_id: test.id,
        organism: antibiogramForm.organism,
        result_summary: `${resultText}${empiricRecommendation ? `\n\n${empiricRecommendation}` : ''}`,
        interpretation: antibiogramForm.interpretation || null,
        created_at: now,
      }, { onConflict: 'test_id' }).then(() => {}).catch(() => {}) // ignore if antibiograms table missing

      // Step 6 — Return patient to Doctor queue if all critical in-house tests done
      setAntibiogramUploadStep('Updating patient queue...')
      if (test.visit_id) {
        const { data: allVisitTests } = await supabase
          .from('lab_tests')
          .select('id, status, priority, test_location')
          .eq('visit_id', test.visit_id)

        const withCurrent = (allVisitTests || []).map(t =>
          t.id === test.id ? { ...t, status: 'Complete' } : t
        )
        const criticalPending = withCurrent.filter(t =>
          (t.test_location || 'In-House') === 'In-House' &&
          (t.priority === 'Urgent' || t.priority === 'STAT') &&
          t.status !== 'Complete' && t.status !== 'Critical'
        )
        if (criticalPending.length === 0) {
          await supabase.from('visits').update({ status: 'Doctor' }).eq('id', test.visit_id)
        }
      }

      // Step 7 — Broadcast events so Consultation + Pharmacy screens update
      try {
        window.dispatchEvent(new CustomEvent('remedacare:antibiogram_updated', {
          detail: { test_id: test.id, patient_id: test.patient_id, visit_id: test.visit_id, source: 'lab-pdf-upload' }
        }))
        window.dispatchEvent(new CustomEvent('remedacare:antibiogram_generated', {
          detail: { test_id: test.id, patient_id: test.patient_id }
        }))
        window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', {
          detail: { visit_id: test.visit_id, status: 'Doctor', source: 'antibiogram-complete' }
        }))
      } catch (_) {}

      setShowAntibiogramModal(false)
      setAntibiogramFile(null)
      setAntibiogramFileName('')
      fetchTests()
      window.notifyFromLegacyAlert(`✅ Culture & Sensitivity report saved successfully!\n\nOrganism: ${antibiogramForm.organism}\nThe result is now visible in:\n• Antibiogram screen (full S/I/R can be entered there)\n• Consultation — Labs tab\n• Pharmacy — AMR Stewardship watchlist`)

    } catch (err) {
      window.notifyFromLegacyAlert('Error saving antibiogram: ' + err.message)
    }

    setAntibiogramUploading(false)
    setAntibiogramUploadStep('')
  }

  function buildMicrobiologyResultPayloadFromLab(test, form, existingRow = null) {
    const now = new Date().toISOString()
    const today = now.split('T')[0]
    const summary = deriveMicrobiologyResultSummary({
      resultValue: form.result_value,
      resultText: form.result_text,
      interpretation: form.interpretation,
    })
    return {
      hospital_id: hospitalId,
      patient_id: test.patient_id || null,
      visit_id: test.visit_id || existingRow?.visit_id || null,
      lab_test_id: test.id,
      patient_name: test.patient_name || existingRow?.patient_name || null,
      sample_type: existingRow?.sample_type || inferMicrobiologySampleType(test.test_type),
      collection_date: existingRow?.collection_date || (test.ordered_at ? String(test.ordered_at).split('T')[0] : today),
      received_date: existingRow?.received_date || (test.ordered_at ? String(test.ordered_at).split('T')[0] : today),
      reported_date: today,
      organism_identified: summary.organismIdentified || existingRow?.organism_identified || null,
      colony_count: existingRow?.colony_count || null,
      gram_stain: existingRow?.gram_stain || null,
      growth: summary.growth || existingRow?.growth || null,
      diagnosis: existingRow?.diagnosis || null,
      ward_department: existingRow?.ward_department || null,
      clinical_notes: [form.result_text, form.result_notes].filter(Boolean).join('\n\n') || existingRow?.clinical_notes || null,
      performed_by: form.performed_by || existingRow?.performed_by || null,
      verified_by: existingRow?.verified_by || null,
      esbl: existingRow?.esbl || false,
      mrsa: existingRow?.mrsa || false,
      vre: existingRow?.vre || false,
      carbapenem_r: existingRow?.carbapenem_r || false,
      ai_suggestion: existingRow?.ai_suggestion || null,
      susceptibility_profile: existingRow?.susceptibility_profile || {},
      updated_at: now,
    }
  }

  async function syncMicrobiologyResultFromLab(test, form) {
    const existingResult = await executeWithFallback(
      () => supabase.from('microbiology_results').select('id, visit_id, patient_name, sample_type, collection_date, received_date, organism_identified, colony_count, gram_stain, growth, diagnosis, ward_department, clinical_notes, performed_by, verified_by, esbl, mrsa, vre, carbapenem_r, ai_suggestion, susceptibility_profile').eq('hospital_id', hospitalId).eq('lab_test_id', test.id).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      async () => ({ data: null, error: null, compatFallback: true }),
    )
    const payload = buildMicrobiologyResultPayloadFromLab(test, form, existingResult.data || null)
    const saveResult = await executeWithFallback(
      () => existingResult.data?.id
        ? supabase.from('microbiology_results').update(payload).eq('id', existingResult.data.id).eq('hospital_id', hospitalId)
        : supabase.from('microbiology_results').insert(payload),
      async () => {
        const fallbackPayload = omitKeys(payload, ['visit_id', 'lab_test_id', 'received_date', 'reported_date', 'diagnosis', 'clinical_notes', 'performed_by', 'verified_by', 'susceptibility_profile'])
        return existingResult.data?.id
          ? supabase.from('microbiology_results').update(fallbackPayload).eq('id', existingResult.data.id).eq('hospital_id', hospitalId)
          : supabase.from('microbiology_results').insert(fallbackPayload)
      },
    )
    if (saveResult.error) { console.error('Could not sync microbiology result', saveResult.error); return }
    try {
      window.dispatchEvent(new CustomEvent('remedacare:antibiogram_updated', { detail: { test_id: test.id, patient_id: test.patient_id || null, visit_id: test.visit_id || null, source: 'lab-result-sync' } }))
    } catch (_) {}
  }

  async function handleOrderTest() {
    const testName = orderForm.test_type === '__custom__' ? customTest : orderForm.test_type
    if (!testName) { window.notifyFromLegacyAlert('Select or enter a test name'); return }
    if (!orderForm.patient_name) { window.notifyFromLegacyAlert('Patient name required'); return }
    setSaving(true)
    const manualAmount = parseFloat(orderForm.amount) || 0
    const ccMatch = manualAmount === 0 ? matchLabChargeCode(testName) : null
    const amount = manualAmount > 0 ? manualAmount : (ccMatch?.unit_price_kes || 0)
    const receiptNumber = `LAB-${Date.now().toString().slice(-8)}`
    const orderedAt = new Date().toISOString()
    const assignedTo = (orderForm.assigned_to || '').trim()
    const sampleBarcode = generateSampleBarcode(new Date(orderedAt))
    const { data: createdTest, error } = await supabase.from('lab_tests').insert({
      hospital_id: hospitalId,
      patient_id: selectedPatient?.id || null,
      patient_name: orderForm.patient_name,
      phone: orderForm.phone,
      test_type: testName,
      category: orderForm.category,
      priority: orderForm.priority,
      notes: orderForm.notes,
      ordered_by: orderForm.ordered_by,
      assigned_to: assignedTo || null,
      status: assignedTo ? 'In Progress' : 'Pending',
      sample_barcode: sampleBarcode,
      sample_status: assignedTo ? 'In Progress' : 'Ordered',
      payment_method: orderForm.payment_method,
      mpesa_ref: orderForm.mpesa_ref || null,
      amount,
      source: 'Walk-in',
      test_location: orderForm.test_location,
      sent_to_external_at: orderForm.test_location === 'External' ? new Date().toISOString() : null,
      ordered_at: orderedAt,
    }).select('*').single()
    if (error) { window.notifyFromLegacyAlert('Error: ' + error.message); setSaving(false); return }
    if (amount > 0) {
      const isInsurance = !['Cash', 'M-Pesa'].includes(orderForm.payment_method)
      const invoiceStatus = isInsurance ? 'Pending' : 'Paid'
      const paidAmount = isInsurance ? 0 : amount
      const balanceAmount = isInsurance ? amount : 0
      const ledgerPayload = { hospital_id: hospitalId, patient_id: selectedPatient?.id || null, visit_id: createdTest?.visit_id || null, patient_name: orderForm.patient_name, drug_name: testName, quantity: 1, unit_price: amount, total_kes: amount, payment_method: orderForm.payment_method, mpesa_ref: orderForm.mpesa_ref || null, category: 'Laboratory', receipt_number: receiptNumber, sold_at: orderedAt }
      await executeWithFallback(() => supabase.from('sales_ledger').insert(ledgerPayload), async () => supabase.from('sales_ledger').insert(omitKeys(ledgerPayload, ['visit_id'])))
      await supabase.from('invoices').insert({ hospital_id: hospitalId, patient_id: selectedPatient?.id || null, visit_id: createdTest?.visit_id || null, patient_name: orderForm.patient_name, invoice_no: receiptNumber.replace('LAB-', 'INV-'), services: stringifyServiceLines([createServiceLine({ label: testName, qty: 1, unitPrice: amount, total: amount, source: SERVICE_SOURCES.LABORATORY, sourceId: createdTest?.id || null, visitId: createdTest?.visit_id || null, meta: { category: orderForm.category, priority: orderForm.priority } })]), amount_kes: amount, paid_kes: paidAmount, balance_kes: balanceAmount, payment_method: orderForm.payment_method, insurer: isInsurance ? orderForm.payment_method : null, sha_member_no: null, status: invoiceStatus, notes: buildWorkflowInvoiceNote({ source: SERVICE_SOURCES.LABORATORY, sourceId: createdTest?.id || 'walkin', visitId: createdTest?.visit_id || null, summary: `Lab receipt: ${receiptNumber}` }), paid_at: invoiceStatus === 'Paid' ? orderedAt : null, created_at: orderedAt })
    }
    setShowOrderModal(false)
    resetOrderForm()
    fetchTests()
    fetchInvoices()
    try { window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { test_id: createdTest?.id, source: 'lab-order' } })) } catch (e) {}
    setSaving(false)
  }

  function resetOrderForm() {
    setOrderForm({ patient_name: '', patient_id_text: '', phone: '', test_type: '', category: 'Haematology', priority: 'Routine', notes: '', ordered_by: '', payment_method: 'Cash', mpesa_ref: '', amount: '', test_location: 'In-House', assigned_to: '' })
    setCustomTest('')
    setSelectedPatient(null)
    setPatientSearch('')
    setPatientResults([])
  }

  function emptyResultForm(test = null) {
    const template = matchStructuredTemplate(test?.test_type, test?.category)
    return {
      result_text: '',
      result_value: '',
      reference_range: '',
      interpretation: '',
      performed_by: test?.assigned_to || '',
      result_notes: '',
      result_file_url: '',
      structured_values: template ? buildStructuredDefaults(template) : {},
      structured_template_key: template?.key || '',
    }
  }

  function buildResultFormFromTest(test) {
    const template = matchStructuredTemplate(test?.test_type, test?.category)
    const existingStructured = test?.result_json && typeof test.result_json === 'object' ? test.result_json : {}
    return {
      result_text: test?.result_text || '',
      result_value: test?.result_value || '',
      reference_range: test?.reference_range || '',
      interpretation: test?.interpretation || '',
      performed_by: test?.performed_by || test?.assigned_to || '',
      result_notes: test?.result_notes || '',
      result_file_url: test?.result_file_url || '',
      structured_values: template ? { ...buildStructuredDefaults(template), ...existingStructured } : {},
      structured_template_key: template?.key || '',
    }
  }

  function openResultEntry(test) {
    if (!test) return
    setSelected(test)
    if (isCultureSensitivityTest(test.test_type, test.category)) {
      openAntibiogramModal(test)
      return
    }
    setResultForm(buildResultFormFromTest(test))
    setShowResultModal(true)
  }

  function printLabResultReport(test) {
    if (!test) return
    const patientRecord = patientsById[test.patient_id] || patients.find(patient => patient.full_name === test.patient_name) || null
    const verificationUrl = `${window.location.origin}${window.location.pathname}?labResultId=${test.id}`
    const reportMarkup = renderToStaticMarkup(
      <div style={{ fontFamily: 'Arial, sans-serif', padding: 32, color: '#1F2937' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{hospitalName || 'Brightpath Travel Scholars'}</div>
            <div style={{ fontSize: 12, color: '#6B7280' }}>Laboratory Result Report</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 6 }}>Logo / Letterhead placeholder</div>
          </div>
          <QRCodeSVG value={verificationUrl} size={96} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div><strong>Patient:</strong> {patientRecord?.full_name || test.patient_name || 'Patient'}</div>
          <div><strong>Patient No:</strong> {getPatientNumber(patientRecord)}</div>
          <div><strong>DOB:</strong> {patientRecord?.date_of_birth || '—'}</div>
          <div><strong>Gender:</strong> {patientRecord?.gender || '—'}</div>
          <div><strong>Test:</strong> {test.test_type}</div>
          <div><strong>Sample Type:</strong> {getSampleTypeLabel(test)}</div>
          <div><strong>Ordered At:</strong> {test.ordered_at ? new Date(test.ordered_at).toLocaleString('en-KE') : '—'}</div>
          <div><strong>Reported At:</strong> {test.resulted_at ? new Date(test.resulted_at).toLocaleString('en-KE') : '—'}</div>
        </div>
        <div style={{ border: '1px solid #D1D5DB', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ background: '#F9FAFB', padding: '10px 14px', fontWeight: 700 }}>Result Summary</div>
          <div style={{ padding: 16 }}>
            {test.result_value && <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{test.result_value}</div>}
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{test.result_text || 'No structured result text recorded.'}</div>
            {test.reference_range && <div style={{ marginTop: 12 }}><strong>Reference range:</strong> {test.reference_range}</div>}
            {test.interpretation && <div style={{ marginTop: 8 }}><strong>Interpretation:</strong> {test.interpretation}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 30 }}>
          <div>
            <div><strong>Lab Tech:</strong> {test.performed_by || test.assigned_to || '—'}</div>
            <div><strong>Reviewed:</strong> {test.reviewed_at ? new Date(test.reviewed_at).toLocaleString('en-KE') : 'Pending review'}</div>
          </div>
          <div style={{ fontSize: 12, color: '#6B7280' }}>Scan QR to verify result</div>
        </div>
      </div>,
    )
    const printWindow = window.open('', '_blank', 'width=900,height=720')
    if (!printWindow) return
    printWindow.document.write(`
      <html>
        <head>
          <title>Lab Result Report</title>
          <style>
            @page { size: A4; margin: 14mm; }
            body { margin: 0; background: #fff; }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>${reportMarkup}<script>setTimeout(() => window.print(), 250)</script></body>
      </html>
    `)
    printWindow.document.close()
  }

  function setEntireSusceptibilityProfile(value) {
    setAntibiogramForm(prev => ({
      ...prev,
      susceptibility_profile: value
        ? Object.fromEntries(MICRO_ANTIBIOTIC_OPTIONS.map(drug => [drug, value]))
        : {},
    }))
  }

  async function handleScannerLookup() {
    const code = scannerValue.trim().toUpperCase()
    if (!code) return
    const test = tests.find(item => String(item.sample_barcode || '').toUpperCase() === code)
    if (!test) {
      window.notifyFromLegacyAlert(`No lab sample found for barcode ${code}.`)
      return
    }
    setSelected(test)
    setScannerValue('')
    openResultEntry(test)
  }

  async function updateSampleStatus(test, sampleStatus) {
    const payload = { sample_status: sampleStatus }
    if (sampleStatus === 'In Progress') payload.status = 'In Progress'
    if (sampleStatus === 'Resulted') payload.status = 'Complete'
    if (sampleStatus === 'Collected') payload.sample_collected_at = new Date().toISOString()
    if (sampleStatus === 'In Progress') payload.processing_started_at = new Date().toISOString()
    if (sampleStatus === 'Resulted') payload.results_ready_at = new Date().toISOString()
    const { error } = await executeWithFallback(
      () => supabase.from('lab_tests').update(payload).eq('id', test.id),
      async () => supabase.from('lab_tests').update(omitKeys(payload, ['sample_collected_at', 'processing_started_at', 'results_ready_at'])).eq('id', test.id),
    )
    if (error) {
      window.notifyFromLegacyAlert('Error updating sample status: ' + error.message)
      return
    }
    fetchTests()
    if (selected?.id === test.id) setSelected({ ...selected, ...payload })
  }

  async function updateStatus(test, status) {
    const nextSampleStatus = status === 'In Progress' ? 'In Progress' : getSampleStatusFromLabRow(test)
    const extraPayload = status === 'In Progress'
      ? { processing_started_at: test?.processing_started_at || new Date().toISOString() }
      : {}
    const { error } = await executeWithFallback(
      () => supabase.from('lab_tests').update({ status, sample_status: nextSampleStatus, ...extraPayload }).eq('id', test.id),
      async () => supabase.from('lab_tests').update({ status, sample_status: nextSampleStatus }).eq('id', test.id),
    )
    if (error) { window.notifyFromLegacyAlert('Error updating status: ' + error.message); return }
    // Auto-invoice doctor-ordered tests the moment they are picked up
    if (status === 'In Progress' && test.source === 'Doctor' && !hasLinkedLabInvoice(invoices, test)) {
      await autoInvoiceLabTest(test)
    }
    fetchTests()
    try { window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { test_id: test.id, status } })) } catch (e) {}
    if (selected?.id === test.id) setSelected({ ...selected, status, sample_status: nextSampleStatus })
  }

  async function advanceWorkflowStage(test) {
    if (!test) return
    const currentStage = getWorkflowStage(test)
    if (currentStage === 'Processing') {
      openResultEntry(test)
      return
    }
    if (currentStage === 'Reviewed') return
    const nextStage = getNextWorkflowStage(test)
    const payload = buildStageUpdatePayload(test, nextStage, selected?.performed_by || selected?.assigned_to || '')
    const result = await executeWithFallback(
      () => supabase.from('lab_tests').update(payload).eq('id', test.id),
      async () => supabase.from('lab_tests').update(omitKeys(payload, ['sample_collected_at', 'processing_started_at', 'reviewed_at', 'reviewed_by'])).eq('id', test.id),
    )
    if (result.error) {
      window.notifyFromLegacyAlert('Error advancing workflow stage: ' + result.error.message)
      return
    }
    fetchTests()
    if (selected?.id === test.id) setSelected({ ...selected, ...payload })
  }

  async function handleAssignTechnician() {
    const tech = assignTech === '__custom__' ? customTech : assignTech
    if (!tech) { window.notifyFromLegacyAlert('Select or enter technician name'); return }
    setSaving(true)
    const nextStatus = selected.status === 'Pending' ? 'In Progress' : selected.status
    const { error } = await supabase.from('lab_tests').update({ assigned_to: tech, status: nextStatus, sample_status: nextStatus === 'In Progress' ? 'In Progress' : getSampleStatusFromLabRow(selected) }).eq('id', selected.id)
    if (error) { window.notifyFromLegacyAlert('Error assigning technician: ' + error.message); setSaving(false); return }
    // Auto-invoice doctor-ordered tests when assigned
    if (selected.source === 'Doctor' && !hasLinkedLabInvoice(invoices, selected)) {
      await autoInvoiceLabTest({ ...selected, status: 'In Progress' })
    }
    setShowAssignModal(false)
    setAssignTech('')
    setCustomTech('')
    fetchTests()
    try { window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { test_id: selected.id, assigned_to: tech } })) } catch (e) {}
    setSaving(false)
  }

  async function handleSaveResult() {
    if (!canPostLabResults) {
      window.notifyFromLegacyAlert('Only lab technicians can post results.')
      return
    }
    const template = matchStructuredTemplate(selected?.test_type, selected?.category)
    const patientRecord = patientsById[selected?.patient_id] || patients.find(patient => patient.full_name === selected?.patient_name) || null
    const structuredValues = { ...(resultForm.structured_values || {}) }
    if (template?.key === 'rfts' && !structuredValues.egfr) {
      structuredValues.egfr = calculateEgfr(structuredValues, patientRecord)
    }
    const structuredSummary = template ? summarizeStructuredResult(template, structuredValues) : null
    const criticalAlerts = template ? buildCriticalAlerts(template, structuredValues) : []
    if (!resultForm.result_text && !resultForm.result_value && !structuredSummary?.resultText) {
      window.notifyFromLegacyAlert('Enter result details')
      return
    }
    if (criticalAlerts.length > 0) {
      const confirmed = window.confirm(`Critical value detected.\n\n${criticalAlerts.join('\n')}\n\nNotify clinician before saving.\nContinue to save?`)
      if (!confirmed) return
    }
    setSaving(true)
    const updatePayload = {
      result_text: resultForm.result_text || structuredSummary?.resultText || null,
      result_value: resultForm.result_value || structuredSummary?.resultValue || null,
      reference_range: resultForm.reference_range || (template ? template.fields.map(field => `${field.label}: ${field.reference}`).join(' | ') : null),
      interpretation: resultForm.interpretation || structuredSummary?.interpretation || null,
      performed_by: resultForm.performed_by || null,
      result_notes: resultForm.result_notes || null,
      result_file_url: resultForm.result_file_url || null,
      status: 'Complete',
      sample_status: 'Resulted',
      resulted_at: new Date().toISOString(),
      results_ready_at: new Date().toISOString(),
      result_json: template ? structuredValues : null,
      result_template_key: template?.key || null,
      critical_flags: criticalAlerts,
    }
    const { error: updateErr } = await executeWithFallback(
      () => supabase.from('lab_tests').update(updatePayload).eq('id', selected.id),
      async () => supabase.from('lab_tests').update(omitKeys(updatePayload, ['results_ready_at', 'result_json', 'result_template_key', 'critical_flags'])).eq('id', selected.id),
    )
    if (updateErr) { window.notifyFromLegacyAlert('Error saving result: ' + updateErr.message); setSaving(false); return }

    if (isMicrobiologySensitivityOrder(selected.test_type, selected.category)) {
      await syncMicrobiologyResultFromLab(selected, resultForm)
      await supabase.from('antibiograms').upsert({ hospital_id: hospitalId, patient_id: selected.patient_id, visit_id: selected.visit_id, test_id: selected.id, organism: resultForm.result_value || 'Pending Identification', result_summary: resultForm.result_text || '', interpretation: resultForm.interpretation || null, created_at: new Date().toISOString() }, { onConflict: 'test_id' })
      try {
        window.dispatchEvent(new CustomEvent('remedacare:antibiogram_generated', { detail: { test_id: selected.id, patient_id: selected.patient_id } }))
        window.dispatchEvent(new CustomEvent('remedacare:antibiogram_updated', { detail: { test_id: selected.id, patient_id: selected.patient_id, visit_id: selected.visit_id || null, source: 'lab-result' } }))
      } catch (e) {}
    }

    if (selected.visit_id) {
      const { data: allVisitTests } = await supabase.from('lab_tests').select('id, status, priority, test_location').eq('visit_id', selected.visit_id)
      const withCurrent = (allVisitTests || []).map(t => t.id === selected.id ? { ...t, status: 'Complete' } : t)
      const criticalPending = withCurrent.filter(t => (t.test_location || 'In-House') === 'In-House' && (t.priority === 'Urgent' || t.priority === 'STAT') && t.status !== 'Complete' && t.status !== 'Critical')
      if (criticalPending.length === 0) {
        await supabase.from('visits').update({ status: 'Doctor' }).eq('id', selected.visit_id)
        try { window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: selected.visit_id, status: 'Doctor' } })) } catch (e) {}
      }
    }

    await logAudit(supabase, {
      hospitalId,
      userRole,
      action: 'lab_result_posted',
      targetTable: 'lab_tests',
      targetId: selected?.id,
      details: {
        test: selected?.test_type,
        patient: selected?.patient_name,
        result: resultForm?.result_value || structuredSummary?.resultValue,
      },
    })

    void (async () => {
      try {
        const phone = patientRecord?.phone || selected.phone || ''
        if (!phone) return

        const notificationConfig = await fetchNotificationConfig(hospitalId)
        const labSetting = getNotificationSetting(notificationConfig, 'lab_result')
        if (!labSetting.enabled) return

        const message = buildMessage(labSetting.template || DEFAULT_TEMPLATES.lab_result, {
          patient_name: selected.patient_name || patientRecord?.full_name || 'Patient',
          hospital_name: hospitalName || 'Brightpath Travel Scholars',
          test_name: selected.test_type || selected.test_name || 'lab test',
        })

        const result = await sendPatientNotification({
          phone,
          message,
          hospitalName,
          notificationType: 'lab_result',
          patientId: selected.patient_id,
          hospitalId,
        })

        if (!result.success && !result.skipped && result.error) {
          console.warn('Lab result notification failed:', result.error)
        }
      } catch (error) {
        console.warn('Lab result notification failed:', error)
      }
    })()

    setShowResultModal(false)
    setResultForm(emptyResultForm())
    fetchTests()
    setSaving(false)
  }

  const enrichedTests = useMemo(() => tests.map(test => ({
    ...test,
    aging: getAgingMeta(test, nowTick),
    workflowStage: getWorkflowStage(test),
  })), [tests, nowTick])

  const filtered = useMemo(() => enrichedTests.filter(t => {
    const query = search.trim().toLowerCase()
    const matchSearch = !query || [t.test_type, t.patient_name, t.ordered_by, t.assigned_to, t.notes, t.category, t.sample_barcode].some(f => String(f || '').toLowerCase().includes(query))
    const matchStatus = filterStatus === 'All' || t.status === filterStatus
    const matchPriority = filterPriority === 'All' || t.priority === filterPriority
    const matchCat = filterCategory === 'All' || t.category === filterCategory
    const matchPatient = !filterPatient || t.patient_name === filterPatient
    const matchSource = filterSource === 'All' || (filterSource === 'Doctor' ? !!t.visit_id : !t.visit_id)
    return matchSearch && matchStatus && matchPriority && matchCat && matchPatient && matchSource
  }).sort((a, b) => {
    const priorityRank = { STAT: 0, Urgent: 1, Routine: 2 }
    const priorityDiff = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)
    if (priorityDiff !== 0) return priorityDiff
    return (b.aging?.minutes || 0) - (a.aging?.minutes || 0)
  }), [enrichedTests, search, filterStatus, filterPriority, filterCategory, filterPatient, filterSource])

  const counts = {
    All: tests.length,
    Pending: tests.filter(t => t.status === 'Pending').length,
    Processing: tests.filter(t => t.status === 'In Progress').length,
    Completed: tests.filter(t => t.status === 'Complete').length,
    Critical: tests.filter(t => t.status === 'Critical').length,
  }

  const dashboardMetrics = useMemo(() => {
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000)
    const statuses = [
      { name: 'Pending', value: tests.filter(test => test.status === 'Pending').length, color: '#C07000' },
      { name: 'In Progress', value: tests.filter(test => test.status === 'In Progress').length, color: '#1a6fb5' },
      { name: 'Complete', value: tests.filter(test => test.status === 'Complete').length, color: '#5B21B6' },
      { name: 'Critical', value: tests.filter(test => test.status === 'Critical').length, color: '#A32D2D' },
    ].filter(item => item.value > 0)

    const weeklyByCategory = tests
      .filter(test => new Date(test.ordered_at || 0).getTime() >= weekAgo && test.resulted_at)
      .reduce((acc, test) => {
        const key = test.category || 'Other'
        const tatHours = (new Date(test.resulted_at).getTime() - new Date(test.ordered_at || 0).getTime()) / 3600000
        if (!acc[key]) acc[key] = { total: 0, count: 0 }
        if (Number.isFinite(tatHours) && tatHours >= 0) {
          acc[key].total += tatHours
          acc[key].count += 1
        }
        return acc
      }, {})

    const categoryTat = Object.entries(weeklyByCategory)
      .map(([category, value]) => ({
        category,
        avgHours: value.count ? Number((value.total / value.count).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.avgHours - a.avgHours)

    const pendingByTechnician = tests
      .filter(test => ['Pending', 'In Progress', 'Critical'].includes(test.status))
      .reduce((acc, test) => {
        const key = test.assigned_to || 'Unassigned'
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})

    const unreviewed = tests
      .filter(test => test.status === 'Complete' && !test.reviewed_at)
      .sort((a, b) => new Date(a.resulted_at || 0).getTime() - new Date(b.resulted_at || 0).getTime())

    return {
      statuses,
      categoryTat,
      pendingByTechnician: Object.entries(pendingByTechnician).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      unreviewed,
    }
  }, [tests])

  const activeResultTemplate = useMemo(
    () => matchStructuredTemplate(selected?.test_type, selected?.category),
    [selected],
  )
  const activeStructuredAlerts = useMemo(
    () => activeResultTemplate ? buildCriticalAlerts(activeResultTemplate, resultForm.structured_values || {}) : [],
    [activeResultTemplate, resultForm.structured_values],
  )
  const antibiogramProfileSummary = useMemo(() => {
    const entries = Object.entries(antibiogramForm.susceptibility_profile || {})
      .map(([drug, value]) => [drug, normalizeSusceptibilityChoice(value)])
      .filter(([, value]) => value)
    return {
      testedCount: entries.length,
      sensitive: entries.filter(([, value]) => value === 'S').length,
      intermediate: entries.filter(([, value]) => value === 'I').length,
      resistant: entries.filter(([, value]) => value === 'R').length,
      resistantDrugs: entries.filter(([, value]) => value === 'R').map(([drug]) => drug).slice(0, 4),
    }
  }, [antibiogramForm.susceptibility_profile])
  const inferredMicroFlags = useMemo(() => {
    const organism = String(antibiogramForm.organism || '').toLowerCase()
    return {
      mrsa: organism.includes('mrsa') || organism.includes('methicillin resistant'),
      esbl: organism.includes('esbl') || organism.includes('extended spectrum'),
      carbapenem_r: organism.includes('cre') || organism.includes('carbapenem'),
    }
  }, [antibiogramForm.organism])

  const pendingReferralTests = tests.filter(test =>
    ['Pending', 'In Progress', 'Critical'].includes(test.status) &&
    getSampleStatusFromLabRow(test) !== 'Resulted'
  )
  const filteredReferralTests = pendingReferralTests.filter(test => {
    const q = referralTestSearch.trim().toLowerCase()
    if (!q) return true
    return `${test.patient_name || ''} ${test.test_name || ''} ${test.test_type || ''}`.toLowerCase().includes(q)
  })
  const filteredReferralPatients = patients.filter(patient => {
    const q = referralPatientSearch.trim().toLowerCase()
    if (!q) return false
    return `${patient.full_name || ''} ${getPatientNumber(patient)}`.toLowerCase().includes(q)
  }).slice(0, 6)
  const pendingReferrals = referrals.filter(referral => getReferralDisplayStatus(referral) === 'Sent')
  const overdueReferrals = referrals.filter(referral => getReferralDisplayStatus(referral) === 'Overdue')
  const referralResultsThisMonth = referrals.filter(referral => {
    if (getReferralDisplayStatus(referral) !== 'Result Received' || !referral.result_date) return false
    const resultDate = new Date(referral.result_date)
    const now = new Date()
    return resultDate.getMonth() === now.getMonth() && resultDate.getFullYear() === now.getFullYear()
  })

  const groupedByPatient = filtered.reduce((acc, t) => {
    const key = t.patient_name || 'Unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(t)
    return acc
  }, {})

  const patientsById = useMemo(() => patients.reduce((acc, p) => { acc[p.id] = p; return acc }, {}), [patients])

  const patientCards = useMemo(() => Object.entries(groupedByPatient).map(([name, items]) => {
    const latestOrderedAt = items.reduce((l, i) => { const t = new Date(i.ordered_at || 0).getTime(); return t > l ? t : l }, 0)
    const patientRecord = items.map(i => patientsById[i.patient_id]).find(Boolean) || patients.find(p => p.full_name === name) || null
    const linkedInvoices = invoices.filter(inv => items.some(test => hasLinkedLabInvoice([inv], test)))
    const billedTestIds = new Set(items.filter(test => hasLinkedLabInvoice(invoices, test)).map(test => test.id))
    return {
      key: name, patientName: name, patient: patientRecord, latestOrderedAt, items,
      visitId: items.find(i => i.visit_id)?.visit_id || null,
      pending: items.filter(i => i.status === 'Pending').length,
      processing: items.filter(i => i.status === 'In Progress').length,
      completed: items.filter(i => i.status === 'Complete').length,
      critical: items.filter(i => i.status === 'Critical').length,
      totalAmount: items.reduce((s, i) => s + (Number(i.amount) || 0), 0),
      billedAmount: linkedInvoices.reduce((s, i) => s + (Number(i.amount_kes) || 0), 0),
      balanceAmount: linkedInvoices.reduce((s, i) => s + (Number(i.balance_kes) || 0), 0),
      billedCount: billedTestIds.size,
      unbilledTests: items.filter(test => !billedTestIds.has(test.id)),
    }
  }).sort((a, b) => b.latestOrderedAt - a.latestOrderedAt), [groupedByPatient, invoices, patients, patientsById])

  if (loading) return (
    <div style={s.loadWrap}><div style={s.spinner} /><p style={{ color: '#5B21B6', marginTop: 12 }}>Loading Lab...</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={s.page}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .test-card:hover{box-shadow:0 4px 16px rgba(15,110,86,0.10)!important;}
        .action-btn:hover{opacity:0.85;}
      `}</style>

      {/* HEADER */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Laboratory</h1>
          <p style={s.subtitle}>
            {activeTab === 'referrals' ? (
              <>
                {referrals.length} total referrals &nbsp;&bull;&nbsp;
                <span style={{ color: '#C07000', fontWeight: 600 }}>{pendingReferrals.length} pending</span> &nbsp;&bull;&nbsp;
                <span style={{ color: '#A32D2D', fontWeight: 600 }}>{overdueReferrals.length} overdue</span> &nbsp;&bull;&nbsp;
                <span style={{ color: '#5B21B6', fontWeight: 600 }}>{referralResultsThisMonth.length} results this month</span>
              </>
            ) : activeTab === 'dashboard' ? (
              <>
                <span style={{ color: '#5B21B6', fontWeight: 600 }}>{dashboardMetrics.statuses.reduce((sum, item) => sum + item.value, 0)} tracked tests</span> &nbsp;&bull;&nbsp;
                <span style={{ color: '#C07000', fontWeight: 600 }}>{dashboardMetrics.unreviewed.length} results ready for doctor review</span> &nbsp;&bull;&nbsp;
                <span style={{ color: '#A32D2D', fontWeight: 600 }}>{filtered.filter(test => test.aging?.overFourHours && test.status !== 'Complete').length} pending over 4h</span>
              </>
            ) : (
              <>
                {counts.All} total &nbsp;&bull;&nbsp;
                <span style={{ color: '#C07000', fontWeight: 600 }}>{counts.Pending} pending</span> &nbsp;&bull;&nbsp;
                <span style={{ color: '#1a6fb5', fontWeight: 600 }}>{counts.Processing} processing</span> &nbsp;&bull;&nbsp;
                <span style={{ color: '#5B21B6', fontWeight: 600 }}>{counts.Completed} completed</span>
              </>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...s.btn, background: activeTab === 'dashboard' ? '#1a6fb5' : '#fff', color: activeTab === 'dashboard' ? '#fff' : '#1a6fb5', border: '1px solid #1a6fb5' }} onClick={() => setActiveTab('dashboard')}>
            Dashboard
          </button>
          <button style={{ ...s.btn, background: activeTab === 'tests' ? '#5B21B6' : '#fff', color: activeTab === 'tests' ? '#fff' : '#5B21B6', border: '1px solid #5B21B6' }} onClick={() => setActiveTab('tests')}>
            Tests
          </button>
          <button style={{ ...s.btn, background: activeTab === 'technicians' ? '#7B5EA7' : '#fff', color: activeTab === 'technicians' ? '#fff' : '#7B5EA7', border: '1px solid #7B5EA7' }} onClick={() => setActiveTab('technicians')}>
            Technicians
          </button>
          <button style={{ ...s.btn, background: activeTab === 'referrals' ? '#B45309' : '#fff', color: activeTab === 'referrals' ? '#fff' : '#B45309', border: '1px solid #B45309' }} onClick={() => setActiveTab('referrals')}>
            Referrals
          </button>
          {activeTab === 'referrals' ? (
            <button style={{ ...s.btn, background: '#B45309' }} onClick={openReferralModal}>+ New Referral</button>
          ) : activeTab === 'dashboard' ? (
            <button style={{ ...s.btn, background: '#1a6fb5' }} onClick={() => setActiveTab('tests')}>Open Active Queue</button>
          ) : (
            <button style={s.btn} onClick={() => { resetOrderForm(); setShowOrderModal(true) }}>+ Order Lab Test</button>
          )}
          <button style={{ ...s.btn, background: '#fff', color: '#5B21B6', border: '1px solid #5B21B6' }} onClick={() => { fetchTests(); fetchReferrals(); fetchInvoices() }}>Refresh</button>
        </div>
      </div>

      {activeTab !== 'referrals' && activeTab !== 'dashboard' && (
      <LabResultsTab
        variant="scanner"
        styles={s}
        scannerValue={scannerValue}
        setScannerValue={setScannerValue}
        handleScannerLookup={handleScannerLookup}
      />
      )}

      {activeTab === 'dashboard' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
            <div style={s.metricCard}>
              <div style={s.metricLabel}>Pending Queue</div>
              <div style={s.metricValue}>{tests.filter(test => test.status === 'Pending').length}</div>
              <div style={s.metricSub}>Including {filtered.filter(test => test.priority === 'STAT' && test.status !== 'Complete').length} STAT orders</div>
            </div>
            <div style={s.metricCard}>
              <div style={s.metricLabel}>Results Ready</div>
              <div style={s.metricValue}>{dashboardMetrics.unreviewed.length}</div>
              <div style={s.metricSub}>Awaiting clinician review</div>
            </div>
            <div style={s.metricCard}>
              <div style={s.metricLabel}>Over 4h Aging</div>
              <div style={s.metricValue}>{filtered.filter(test => test.aging?.overFourHours && test.status !== 'Complete').length}</div>
              <div style={s.metricSub}>Backlog needing escalation</div>
            </div>
            <div style={s.metricCard}>
              <div style={s.metricLabel}>Average Weekly TAT</div>
              <div style={s.metricValue}>{dashboardMetrics.categoryTat[0]?.avgHours ? `${dashboardMetrics.categoryTat[0].avgHours}h` : '—'}</div>
              <div style={s.metricSub}>{dashboardMetrics.categoryTat[0]?.category || 'No completed tests this week'}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 16, alignItems: 'stretch' }}>
            <div style={s.dashboardCard}>
              <div style={s.dashboardCardTitle}>Tests By Status</div>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={dashboardMetrics.statuses} dataKey="value" nameKey="name" outerRadius={90} innerRadius={48} paddingAngle={2}>
                      {dashboardMetrics.statuses.map(item => <Cell key={item.name} fill={item.color} />)}
                    </Pie>
                    <RechartsTooltip formatter={value => [`${value} tests`, 'Count']} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={s.dashboardCard}>
              <div style={s.dashboardCardTitle}>Average Turnaround This Week</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {dashboardMetrics.categoryTat.length === 0 && <div style={{ color: '#6B7280', fontSize: 13 }}>No completed tests recorded this week yet.</div>}
                {dashboardMetrics.categoryTat.map(item => (
                  <div key={item.category}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: '#1F2937' }}>{item.category}</span>
                      <span style={{ color: '#5B21B6', fontWeight: 700 }}>{item.avgHours}h</span>
                    </div>
                    <div style={{ background: '#E5E7EB', borderRadius: 999, height: 8 }}>
                      <div style={{ width: `${Math.min(100, item.avgHours * 8)}%`, background: item.avgHours > 8 ? '#A32D2D' : item.avgHours > 4 ? '#C07000' : '#5B21B6', borderRadius: 999, height: '100%' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={s.dashboardCard}>
              <div style={s.dashboardCardTitle}>Pending By Technician</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {dashboardMetrics.pendingByTechnician.length === 0 && <div style={{ color: '#6B7280', fontSize: 13 }}>No active pending workload.</div>}
                {dashboardMetrics.pendingByTechnician.map(item => (
                  <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', border: '1px solid #E5E7EB', borderRadius: 10 }}>
                    <span style={{ fontSize: 13, color: '#1F2937', fontWeight: 600 }}>{item.name}</span>
                    <span style={{ ...s.pill, background: item.name === 'Unassigned' ? '#FCEBEB' : '#E3F0FB', color: item.name === 'Unassigned' ? '#A32D2D' : '#1a6fb5' }}>{item.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={s.dashboardCard}>
              <div style={s.dashboardCardTitle}>Results Not Yet Reviewed By Doctor</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {dashboardMetrics.unreviewed.length === 0 && <div style={{ color: '#5B21B6', fontSize: 13, fontWeight: 600 }}>All completed results have been reviewed.</div>}
                {dashboardMetrics.unreviewed.slice(0, 8).map(test => (
                  <button
                    key={test.id}
                    type="button"
                    onClick={() => { setActiveTab('tests'); setSelected(test) }}
                    style={{ ...s.listButton, justifyContent: 'space-between' }}
                  >
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <span style={{ fontWeight: 700, color: '#1F2937', fontSize: 13 }}>{test.patient_name}</span>
                      <span style={{ fontSize: 12, color: '#6B7280' }}>{test.test_type}</span>
                    </span>
                    <span style={{ ...s.pill, background: '#FFF3DC', color: '#C07000' }}>{test.resulted_at ? new Date(test.resulted_at).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Ready'}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TECHNICIANS VIEW */}
      {activeTab === 'technicians' && (() => {
        const activeTech = tests.filter(t => t.status !== 'Complete' && t.status !== 'Critical')
        const unassigned = activeTech.filter(t => !t.assigned_to)
        const techMap = {}
        const staffTechNames = labStaff.map(s => s.full_name).filter(Boolean)
        staffTechNames.forEach(tech => { techMap[tech] = { pending: [], processing: [], completed: [] } })
        tests.forEach(t => {
          if (!t.assigned_to || !techMap[t.assigned_to]) return
          if (t.status === 'Pending') techMap[t.assigned_to].pending.push(t)
          if (t.status === 'In Progress') techMap[t.assigned_to].processing.push(t)
          if (t.status === 'Complete') techMap[t.assigned_to].completed.push(t)
        })
        const customTechs = [...new Set(tests.map(t => t.assigned_to).filter(t => t && !staffTechNames.includes(t)))]
        customTechs.forEach(tech => {
          techMap[tech] = { pending: [], processing: [], completed: [] }
          tests.forEach(t => {
            if (t.assigned_to !== tech) return
            if (t.status === 'Pending') techMap[tech].pending.push(t)
            if (t.status === 'In Progress') techMap[tech].processing.push(t)
            if (t.status === 'Complete') techMap[tech].completed.push(t)
          })
        })
        const allTechs = [...staffTechNames, ...customTechs]
        return (
          <div>
            {unassigned.length > 0 && (
              <div style={{ background: '#FCEBEB', border: '1px solid #F09595', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 700, color: '#A32D2D', fontSize: 14 }}>⚠ {unassigned.length} Unassigned Test{unassigned.length !== 1 ? 's' : ''}</span>
                  <div style={{ fontSize: 12, color: '#A32D2D', marginTop: 3 }}>{unassigned.map(t => t.test_type).join(', ')}</div>
                </div>
                <button style={{ ...s.btn, background: '#A32D2D', fontSize: 12, padding: '8px 14px' }} onClick={() => setActiveTab('tests')}>View & Assign →</button>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
              {allTechs.map(tech => {
                const w = techMap[tech]
                const active = w.pending.length + w.processing.length
                return (
                  <div key={tech} style={{ background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: '16px 18px', boxShadow: '0 2px 6px rgba(0,0,0,.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>🔬 {tech}</div>
                        <div style={{ fontSize: 12, color: active > 0 ? '#C07000' : '#5B21B6', fontWeight: 600, marginTop: 3 }}>{active > 0 ? `${active} active test${active !== 1 ? 's' : ''}` : 'No active tests'}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: active > 3 ? '#A32D2D' : active > 0 ? '#C07000' : '#5B21B6' }}>{active}</div>
                        <div style={{ fontSize: 10, color: '#aaa', fontWeight: 600 }}>ACTIVE</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      {[['#FFF3DC', '#C07000', w.pending.length, 'PENDING'], ['#E3F0FB', '#1a6fb5', w.processing.length, 'PROCESSING'], ['#F3E8FF', '#5B21B6', w.completed.length, 'DONE']].map(([bg, color, count, label]) => (
                        <div key={label} style={{ flex: 1, background: bg, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color }}>{count}</div>
                          <div style={{ fontSize: 10, color, fontWeight: 600 }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {activeTab === 'referrals' && (
        <LabReferralsTab
          referrals={referrals}
          pendingReferrals={pendingReferrals}
          overdueReferrals={overdueReferrals}
          referralResultsThisMonth={referralResultsThisMonth}
          search={search}
          setSearch={setSearch}
          extractStandaloneReferralTestName={extractStandaloneReferralTestName}
          getReferralDisplayStatus={getReferralDisplayStatus}
          getPatientNumber={getPatientNumber}
          openReferralResultModal={openReferralResultModal}
          markReferralOverdue={markReferralOverdue}
          styles={s}
        />
      )}

      {/* TESTS VIEW */}
      {activeTab === 'tests' && (
        <LabOrdersTab
          styles={s}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          counts={counts}
          search={search}
          setSearch={setSearch}
          dateFrom={dateFrom}
          setDateFrom={setDateFrom}
          dateTo={dateTo}
          setDateTo={setDateTo}
          filterPatient={filterPatient}
          setFilterPatient={setFilterPatient}
          uniquePatients={uniquePatients}
          filterSource={filterSource}
          setFilterSource={setFilterSource}
          filterPriority={filterPriority}
          setFilterPriority={setFilterPriority}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          labTestCategories={LAB_TEST_CATEGORIES}
          groupedByPatient={groupedByPatient}
          patientCards={patientCards}
          setSelected={setSelected}
          selected={selected}
          isCultureSensitivityTest={isCultureSensitivityTest}
          navigate={navigate}
          formatKES={formatKES}
          filtered={filtered}
          statusColors={STATUS_COLORS}
          sampleStatusColors={SAMPLE_STATUS_COLORS}
          getSampleStatusFromLabRow={getSampleStatusFromLabRow}
          priorityColors={PRIORITY_COLORS}
          invoices={invoices}
          hasLinkedLabInvoice={hasLinkedLabInvoice}
          updateStatus={updateStatus}
          updateSampleStatus={updateSampleStatus}
          getAgingMeta={getAgingMeta}
          getWorkflowStage={getWorkflowStage}
          labStagePipeline={LAB_STAGE_PIPELINE}
          advanceWorkflowStage={advanceWorkflowStage}
          getStageActionLabel={getStageActionLabel}
          openSampleLabelPrintWindow={openSampleLabelPrintWindow}
          openResultEntry={openResultEntry}
          printLabResultReport={printLabResultReport}
          patientsById={patientsById}
          patients={patients}
          openAntibiogramModal={openAntibiogramModal}
          setShowResultModal={setShowResultModal}
          setResultForm={setResultForm}
          setAssignTech={setAssignTech}
          setShowAssignModal={setShowAssignModal}
          testTotalCount={testTotalCount}
          tests={tests}
          testPageSize={testPageSize}
          setTestPageSize={setTestPageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          testPage={testPage}
          setTestPage={setTestPage}
          detailPanel={
            <LabResultsTab
              styles={s}
              selected={selected}
              setSelected={setSelected}
              statusColors={STATUS_COLORS}
              sampleStatusColors={SAMPLE_STATUS_COLORS}
              getSampleStatusFromLabRow={getSampleStatusFromLabRow}
              isCultureSensitivityTest={isCultureSensitivityTest}
              getPatientNumber={getPatientNumber}
              patientsById={patientsById}
              patients={patients}
              setAssignTech={setAssignTech}
              setShowAssignModal={setShowAssignModal}
              updateSampleStatus={updateSampleStatus}
              openSampleLabelPrintWindow={openSampleLabelPrintWindow}
              openResultEntry={openResultEntry}
              openAntibiogramModal={openAntibiogramModal}
              setResultForm={setResultForm}
              setShowResultModal={setShowResultModal}
              updateStatus={updateStatus}
              getAgingMeta={getAgingMeta}
              getWorkflowStage={getWorkflowStage}
              labStagePipeline={LAB_STAGE_PIPELINE}
              advanceWorkflowStage={advanceWorkflowStage}
              getStageActionLabel={getStageActionLabel}
              printLabResultReport={printLabResultReport}
            />
          }
        />
      )}

      {/* ===== ANTIBIOGRAM UPLOAD MODAL ===== */}
      {showAntibiogramModal && selected && (
        <div style={s.overlay} onClick={() => !antibiogramUploading && setShowAntibiogramModal(false)}>
          <div style={{ ...s.modal, maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitle}>🧫 Culture & Sensitivity Workbench</h2>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{selected.test_type} — {selected.patient_name}</div>
                {selected.visit_id && <div style={{ fontSize: 12, color: '#7B5EA7', marginTop: 2, fontWeight: 600 }}>📋 Doctor-ordered — completing this returns patient to Doctor queue</div>}
              </div>
              <button style={s.closeBtn} onClick={() => !antibiogramUploading && setShowAntibiogramModal(false)}>✕</button>
            </div>
            <div style={s.modalBody}>

              {/* PDF Upload zone */}
              <div style={{ background: '#F5F0FF', border: '2px dashed #7B3AED', borderRadius: 12, padding: '20px', marginBottom: 16, textAlign: 'center', cursor: 'pointer' }}
                onClick={() => document.getElementById('antibiogram-pdf-input').click()}>
                <input id="antibiogram-pdf-input" type="file" accept=".pdf,image/*,.jpg,.jpeg,.png" style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) { setAntibiogramFile(file); setAntibiogramFileName(file.name) }
                    e.target.value = ''
                  }} />
                <div style={{ fontSize: 32, marginBottom: 8 }}>{antibiogramFile ? '✅' : '📎'}</div>
                <div style={{ fontWeight: 700, color: '#7B3AED', fontSize: 14 }}>
                  {antibiogramFile ? antibiogramFileName : 'Click to upload VITEK / WHONET / Lab PDF or Image'}
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  {antibiogramFile
                    ? `${(antibiogramFile.size / 1024).toFixed(0)} KB — ${antibiogramFile.type}`
                    : 'Supports PDF, JPG, PNG — attach the machine report or a clear photograph of the result sheet'}
                </div>
                {antibiogramFile && (
                  <button style={{ marginTop: 8, fontSize: 11, color: '#A32D2D', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={e => { e.stopPropagation(); setAntibiogramFile(null); setAntibiogramFileName('') }}>
                    Remove file
                  </button>
                )}
              </div>

              <div style={{ background: '#FFF7ED', border: '1px solid #FCD34D', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#92400E', marginBottom: 16 }}>
                ℹ After uploading, the full S/I/R antibiogram table can be completed in the <strong>Antibiogram screen</strong>. This step records the organism, sends the result to Consultation and Pharmacy, and returns the patient to the Doctor queue.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginBottom: 16 }}>
                <div style={s.microCard}>
                  <div style={s.microCardLabel}>Sample Barcode</div>
                  <div style={s.microCardValue}>{selected.sample_barcode || 'Pending barcode'}</div>
                </div>
                <div style={s.microCard}>
                  <div style={s.microCardLabel}>Sample Type</div>
                  <div style={s.microCardValue}>{antibiogramForm.sample_type || getSampleTypeLabel(selected)}</div>
                </div>
                <div style={s.microCard}>
                  <div style={s.microCardLabel}>Queue Age</div>
                  <div style={s.microCardValue}>{getAgingMeta(selected, nowTick).label}</div>
                </div>
                <div style={s.microCard}>
                  <div style={s.microCardLabel}>Current Stage</div>
                  <div style={s.microCardValue}>{getWorkflowStage(selected)}</div>
                </div>
              </div>

              <div style={s.sectionLabel}>Culture Result</div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Organism Identified *</label>
                  <input style={s.input} placeholder="e.g. Escherichia coli, MRSA, No Growth"
                    value={antibiogramForm.organism} onChange={e => setAntibiogramForm(f => ({ ...f, organism: e.target.value }))} />
                  {(inferredMicroFlags.mrsa || inferredMicroFlags.esbl || inferredMicroFlags.carbapenem_r) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {inferredMicroFlags.mrsa && <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #F09595' }}>MRSA keyword detected</span>}
                      {inferredMicroFlags.esbl && <span style={{ ...s.pill, background: '#FFF3DC', color: '#C07000', border: '1px solid #FAC775' }}>ESBL keyword detected</span>}
                      {inferredMicroFlags.carbapenem_r && <span style={{ ...s.pill, background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}>CRE keyword detected</span>}
                    </div>
                  )}
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Sample Type</label>
                  <select style={s.input} value={antibiogramForm.sample_type} onChange={e => setAntibiogramForm(f => ({ ...f, sample_type: e.target.value }))}>
                    {SAMPLE_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Growth</label>
                  <select style={s.input} value={antibiogramForm.growth} onChange={e => setAntibiogramForm(f => ({ ...f, growth: e.target.value }))}>
                    {['Heavy', 'Moderate', 'Light', 'No Growth'].map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Interpretation</label>
                  <select style={s.input} value={antibiogramForm.interpretation} onChange={e => setAntibiogramForm(f => ({ ...f, interpretation: e.target.value }))}>
                    <option value="">-- Select --</option>
                    {['Sensitive — treat per susceptibility', 'Resistant — consider alternative therapy', 'No growth — culture negative', 'Contaminated — repeat recommended', 'Mixed growth — clinical correlation needed'].map(i => <option key={i}>{i}</option>)}
                  </select>
                </div>
              </div>

              {/* Resistance flags */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
                {[['esbl', 'ESBL Positive'], ['mrsa', 'MRSA'], ['carbapenem_r', 'Carbapenem Resistant']].map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', fontWeight: antibiogramForm[key] ? 700 : 400, color: antibiogramForm[key] ? '#A32D2D' : '#555' }}>
                    <input type="checkbox" checked={!!antibiogramForm[key]} onChange={e => setAntibiogramForm(f => ({ ...f, [key]: e.target.checked }))} />
                    {label}
                  </label>
                ))}
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={s.sectionLabel}>Sensitivity Pattern</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ ...s.pill, background: '#F3E8FF', color: '#5B21B6', border: '1px solid #D8B4FE' }}>{antibiogramProfileSummary.sensitive} Sensitive</span>
                    <span style={{ ...s.pill, background: '#FFF3DC', color: '#C07000', border: '1px solid #FAC775' }}>{antibiogramProfileSummary.intermediate} Intermediate</span>
                    <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #F09595' }}>{antibiogramProfileSummary.resistant} Resistant</span>
                    <span style={{ ...s.pill, background: '#F3F4F6', color: '#555', border: '1px solid #D1D5DB' }}>{antibiogramProfileSummary.testedCount} Tested</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" style={s.microQuickBtn} onClick={() => setEntireSusceptibilityProfile('S')}>Mark all S</button>
                    <button type="button" style={s.microQuickBtn} onClick={() => setEntireSusceptibilityProfile('')}>Clear grid</button>
                    <button
                      type="button"
                      style={{ ...s.microQuickBtn, background: '#FFF7ED', borderColor: '#FCD34D', color: '#92400E' }}
                      onClick={() => {
                        setEntireSusceptibilityProfile('')
                        setAntibiogramForm(prev => ({
                          ...prev,
                          growth: 'No Growth',
                          interpretation: 'No growth — culture negative',
                        }))
                      }}
                    >
                      No growth template
                    </button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
                  {MICRO_ANTIBIOTIC_OPTIONS.map(drug => (
                    <div key={drug} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1F2937', marginBottom: 8 }}>{drug}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
                        {[
                          ['', 'NT', '#F3F4F6', '#555'],
                          ['S', 'S', '#F3E8FF', '#5B21B6'],
                          ['I', 'I', '#FFF3DC', '#C07000'],
                          ['R', 'R', '#FCEBEB', '#A32D2D'],
                        ].map(([value, label, bg, color]) => {
                          const active = (antibiogramForm.susceptibility_profile?.[drug] || '') === value
                          return (
                            <button
                              key={label}
                              type="button"
                              onClick={() => setAntibiogramForm(prev => ({
                                ...prev,
                                susceptibility_profile: {
                                  ...(prev.susceptibility_profile || {}),
                                  [drug]: value,
                                },
                              }))}
                              style={{
                                border: `1px solid ${active ? color : '#D1D5DB'}`,
                                background: active ? bg : '#fff',
                                color: active ? color : '#6B7280',
                                borderRadius: 8,
                                padding: '8px 0',
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#1D4ED8', marginBottom: 16 }}>
                <strong>Empiric recommendation:</strong> {getMicroEmpiricRecommendation(antibiogramForm.organism, antibiogramForm.susceptibility_profile)}
              </div>
              {antibiogramProfileSummary.resistantDrugs.length > 0 && (
                <div style={{ background: '#FFF7ED', border: '1px solid #FCD34D', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#92400E', marginBottom: 16 }}>
                  <strong>Top resistant drugs:</strong> {antibiogramProfileSummary.resistantDrugs.join(', ')}
                </div>
              )}

              <div style={s.formGroup}>
                <label style={s.label}>Result Summary / Clinical Notes</label>
                <textarea style={{ ...s.input, height: 70, resize: 'vertical' }}
                  placeholder="Summarise key findings, e.g. E.coli — sensitive to nitrofurantoin and ciprofloxacin, resistant to amoxicillin. Full S/I/R data in Antibiogram module."
                  value={antibiogramForm.result_summary} onChange={e => setAntibiogramForm(f => ({ ...f, result_summary: e.target.value }))} />
              </div>

              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Performed By *</label>
                  <select style={s.input} value={antibiogramForm.performed_by} onChange={e => setAntibiogramForm(f => ({ ...f, performed_by: e.target.value }))}>
                    <option value="">-- Select Technician --</option>
                    {labStaff.map(t => <option key={t.id} value={t.full_name}>{t.full_name}{t.role ? ` — ${t.role}` : ''}</option>)}
                    <option value="__other__">Other (type below)</option>
                  </select>
                  {antibiogramForm.performed_by === '__other__' && (
                    <input style={{ ...s.input, marginTop: 6 }} placeholder="Enter technician name" onChange={e => setAntibiogramForm(f => ({ ...f, performed_by: e.target.value }))} />
                  )}
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Verified By (optional)</label>
                  <input style={s.input} placeholder="Consultant or senior tech" value={antibiogramForm.verified_by} onChange={e => setAntibiogramForm(f => ({ ...f, verified_by: e.target.value }))} />
                </div>
              </div>

              <div style={{ background: '#F3E8FF', border: '1px solid #D8B4FE', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#5B21B6', fontWeight: 600 }}>
                ✅ After saving:
                <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 11, fontWeight: 400 }}>
                  <li>The lab test is marked <strong>Complete</strong></li>
                  <li>Result appears in <strong>Consultation → Labs tab</strong> for the doctor</li>
                  <li>Pharmacy <strong>AMR Stewardship watchlist</strong> is updated</li>
                  <li>Full S/I/R antibiogram table available in <strong>Antibiogram screen</strong> for detailed entry</li>
                  <li>Patient is <strong>returned to Doctor queue</strong> (if all critical tests done)</li>
                </ul>
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => !antibiogramUploading && setShowAntibiogramModal(false)} disabled={antibiogramUploading}>Cancel</button>
              <button style={{ ...s.submitBtn, background: '#7B3AED', minWidth: 180 }} onClick={handleSaveAntibiogram} disabled={antibiogramUploading}>
                {antibiogramUploading ? `⏳ ${antibiogramUploadStep || 'Saving...'}` : '🧫 Save C&S Result & Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ASSIGN TECHNICIAN MODAL ===== */}
      {showAssignModal && selected && (
        <div style={s.overlay} onClick={() => setShowAssignModal(false)}>
          <div style={{ ...s.modal, maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitle}>👤 Assign Technician</h2>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{selected.test_type} — {selected.patient_name}</div>
              </div>
              <button style={s.closeBtn} onClick={() => setShowAssignModal(false)}>✕</button>
            </div>
            <div style={s.modalBody}>
              {selected.assigned_to && <div style={{ background: '#E3F0FB', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#1a6fb5', marginBottom: 14, fontWeight: 600 }}>Currently: {selected.assigned_to}</div>}
              <div style={s.sectionLabel}>Select Technician</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {availableLabStaff.map(tech => {
                  const workload = tests.filter(t => t.assigned_to === tech.full_name && (t.status === 'Pending' || t.status === 'In Progress')).length
                  return (
                    <div key={tech.id} style={{ padding: '10px 14px', borderRadius: 8, border: `2px solid ${assignTech === tech.full_name ? '#7B5EA7' : '#eee'}`, background: assignTech === tech.full_name ? '#F0EAFC' : '#fafafa', cursor: 'pointer', fontSize: 13, fontWeight: assignTech === tech.full_name ? 700 : 400, color: assignTech === tech.full_name ? '#7B5EA7' : '#333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      onClick={() => setAssignTech(tech.full_name)}>
                      <span>{tech.full_name}{tech.role ? ` — ${tech.role}` : ''}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: workload === 0 ? '#F3E8FF' : workload < 3 ? '#FFF3DC' : '#FCEBEB', color: workload === 0 ? '#5B21B6' : workload < 3 ? '#C07000' : '#A32D2D' }}>{workload} active</span>
                    </div>
                  )
                })}
                {availableLabStaff.length === 0 && <div style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #F5F3F5', background: '#FEF3F2', color: '#B91C1C', fontSize: 12 }}>No active lab staff found. Add laboratory staff in HR.</div>}
                <div style={{ padding: '10px 14px', borderRadius: 8, border: `2px solid ${assignTech === '__custom__' ? '#7B5EA7' : '#eee'}`, background: assignTech === '__custom__' ? '#F0EAFC' : '#fafafa', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#888' }} onClick={() => setAssignTech('__custom__')}>Other / Custom</div>
              </div>
              {assignTech === '__custom__' && (
                <div style={s.formGroup}>
                  <label style={s.label}>Custom Technician Name</label>
                  <input style={s.input} placeholder="Enter full name" value={customTech} onChange={e => setCustomTech(e.target.value)} autoFocus />
                </div>
              )}
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => setShowAssignModal(false)}>Cancel</button>
              <button style={{ ...s.submitBtn, background: '#7B5EA7' }} onClick={handleAssignTechnician} disabled={saving}>{saving ? 'Saving...' : '✅ Assign & Process'}</button>
            </div>
          </div>
        </div>
      )}

      {showReferralModal && (
        <div style={s.overlay} onClick={() => !saving && setShowReferralModal(false)}>
          <div style={{ ...s.modal, maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitle}>External Lab Referral</h2>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>Send an ordered sample out or create a standalone referral.</div>
              </div>
              <button style={s.closeBtn} onClick={() => !saving && setShowReferralModal(false)}>×</button>
            </div>
            <div style={s.modalBody}>
              <div style={s.sectionLabel}>Referral Source</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {[
                  { key: 'linked', label: 'Link Existing Test' },
                  { key: 'standalone', label: 'Standalone Referral' },
                ].map(option => (
                  <button
                    key={option.key}
                    style={{
                      ...s.actionBtn,
                      flex: 1,
                      padding: '10px 12px',
                      background: referralForm.linked_mode === option.key ? '#5B21B6' : '#fff',
                      color: referralForm.linked_mode === option.key ? '#fff' : '#5B21B6',
                      border: '1px solid #5B21B6',
                    }}
                    onClick={() => setReferralForm(prev => ({ ...prev, linked_mode: option.key, lab_test_id: '', standalone_patient_id: '', standalone_test_name: '' }))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {referralForm.linked_mode === 'linked' ? (
                <>
                  <div style={s.formGroup}>
                    <label style={s.label}>Search Pending Test</label>
                    <input
                      style={s.input}
                      placeholder="Type patient name or test name..."
                      value={referralTestSearch}
                      onChange={e => setReferralTestSearch(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, maxHeight: 190, overflowY: 'auto' }}>
                    {filteredReferralTests.map(test => (
                      <div
                        key={test.id}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: `1px solid ${referralForm.lab_test_id === test.id ? '#5B21B6' : '#E6ECE8'}`,
                          background: referralForm.lab_test_id === test.id ? '#FAF5FF' : '#fff',
                          cursor: 'pointer',
                        }}
                        onClick={() => setReferralForm(prev => ({
                          ...prev,
                          lab_test_id: test.id,
                          standalone_patient_id: '',
                          standalone_test_name: '',
                          sample_type: prev.sample_type || 'Blood',
                        }))}
                      >
                        <div style={{ fontWeight: 700, color: '#111' }}>{test.patient_name}</div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{test.test_name || test.test_type} • {test.sample_barcode || 'No barcode yet'}</div>
                      </div>
                    ))}
                    {filteredReferralTests.length === 0 && (
                      <div style={{ background: '#FAFBFD', border: '1px dashed #D7E5DE', borderRadius: 10, padding: 12, fontSize: 12, color: '#777' }}>No pending in-house test matches that search.</div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div style={s.formGroup}>
                    <label style={s.label}>Search Patient</label>
                    <input
                      style={s.input}
                      placeholder="Type patient name or number..."
                      value={referralPatientSearch}
                      onChange={e => setReferralPatientSearch(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, maxHeight: 160, overflowY: 'auto' }}>
                    {filteredReferralPatients.map(patient => (
                      <div
                        key={patient.id}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: `1px solid ${referralForm.standalone_patient_id === patient.id ? '#5B21B6' : '#E6ECE8'}`,
                          background: referralForm.standalone_patient_id === patient.id ? '#FAF5FF' : '#fff',
                          cursor: 'pointer',
                        }}
                        onClick={() => setReferralForm(prev => ({ ...prev, standalone_patient_id: patient.id, lab_test_id: '' }))}
                      >
                        <div style={{ fontWeight: 700, color: '#111' }}>{patient.full_name}</div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{getPatientNumber(patient)} • {patient.gender || '-'} {patient.age ? `• ${patient.age}y` : ''}</div>
                      </div>
                    ))}
                  </div>
                  <div style={s.formGroup}>
                    <label style={s.label}>Standalone Test Name</label>
                    <input
                      style={s.input}
                      placeholder="e.g. Histopathology review, specialized PCR"
                      value={referralForm.standalone_test_name}
                      onChange={e => setReferralForm(prev => ({ ...prev, standalone_test_name: e.target.value }))}
                    />
                  </div>
                </>
              )}

              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Referred To</label>
                  <input
                    style={s.input}
                    list="lab-referral-labs"
                    value={referralForm.referred_to}
                    onChange={e => setReferralForm(prev => ({ ...prev, referred_to: e.target.value }))}
                  />
                  <datalist id="lab-referral-labs">
                    {REFERRAL_LABS.map(lab => <option key={lab} value={lab} />)}
                  </datalist>
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Sample Type</label>
                  <select style={s.input} value={referralForm.sample_type} onChange={e => setReferralForm(prev => ({ ...prev, sample_type: e.target.value }))}>
                    {REFERRAL_SAMPLE_TYPES.map(type => <option key={type}>{type}</option>)}
                  </select>
                </div>
              </div>

              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Date Sent</label>
                  <input style={s.input} type="date" value={referralForm.date_sent} onChange={e => setReferralForm(prev => ({ ...prev, date_sent: e.target.value }))} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Transport Method</label>
                  <select style={s.input} value={referralForm.transport_method} onChange={e => setReferralForm(prev => ({ ...prev, transport_method: e.target.value }))}>
                    {REFERRAL_TRANSPORT_METHODS.map(method => <option key={method}>{method}</option>)}
                  </select>
                </div>
              </div>

              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Expected TAT (days)</label>
                  <input style={s.input} type="number" min="0" value={referralForm.expected_tat_days} onChange={e => setReferralForm(prev => ({ ...prev, expected_tat_days: e.target.value }))} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Referral Cost (KES)</label>
                  <input style={s.input} type="number" min="0" value={referralForm.referral_cost} onChange={e => setReferralForm(prev => ({ ...prev, referral_cost: e.target.value }))} />
                </div>
              </div>

              <div style={s.formGroup}>
                <label style={s.label}>Special Instructions</label>
                <textarea
                  style={{ ...s.input, minHeight: 84, resize: 'vertical' }}
                  placeholder="Sample handling notes, packaging requirements, contact person..."
                  value={referralForm.special_instructions}
                  onChange={e => setReferralForm(prev => ({ ...prev, special_instructions: e.target.value }))}
                />
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => !saving && setShowReferralModal(false)}>Cancel</button>
              <button style={{ ...s.submitBtn, background: '#B45309' }} onClick={handleSaveReferral} disabled={saving}>
                {saving ? 'Saving...' : 'Save Referral'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReferralResultModal && selectedReferral && (
        <div style={s.overlay} onClick={() => !saving && setShowReferralResultModal(false)}>
          <div style={{ ...s.modal, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitle}>Record External Result</h2>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{extractStandaloneReferralTestName(selectedReferral)} — {selectedReferral.patients?.full_name || selectedReferral.lab_tests?.patient_name || 'Unknown patient'}</div>
              </div>
              <button style={s.closeBtn} onClick={() => !saving && setShowReferralResultModal(false)}>×</button>
            </div>
            <div style={s.modalBody}>
              <div style={s.formGroup}>
                <label style={s.label}>Result Text</label>
                <textarea
                  style={{ ...s.input, minHeight: 110, resize: 'vertical' }}
                  placeholder="Enter the full result returned by the external laboratory..."
                  value={referralResultForm.result_text}
                  onChange={e => setReferralResultForm(prev => ({ ...prev, result_text: e.target.value }))}
                />
              </div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Result Date</label>
                  <input style={s.input} type="date" value={referralResultForm.result_date} onChange={e => setReferralResultForm(prev => ({ ...prev, result_date: e.target.value }))} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>External Reference</label>
                  <input style={s.input} placeholder="Reference / accession number" value={referralResultForm.external_reference} onChange={e => setReferralResultForm(prev => ({ ...prev, external_reference: e.target.value }))} />
                </div>
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => !saving && setShowReferralResultModal(false)}>Cancel</button>
              <button style={{ ...s.submitBtn, background: '#1a6fb5' }} onClick={handleSaveReferralResult} disabled={saving}>
                {saving ? 'Saving...' : 'Save Result'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ORDER MODAL ===== */}
      {showOrderModal && (
        <div style={s.overlay} onClick={() => setShowOrderModal(false)}>
          <div style={{ ...s.modal, maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>🔬 Order Lab Test</h2>
              <button style={s.closeBtn} onClick={() => setShowOrderModal(false)}>✕</button>
            </div>
            <div style={s.modalBody}>
              <div style={s.sectionLabel}>Patient</div>
              <div style={{ position: 'relative', marginBottom: 14 }}>
                <input style={s.input} placeholder="Search registered patient or type name..." value={patientSearch}
                  onChange={e => { searchPatients(e.target.value); setOrderForm(f => ({ ...f, patient_name: e.target.value })); setSelectedPatient(null) }} />
                {patientResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: 8, zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', marginTop: 4 }}>
                    {patientResults.map(p => (
                      <div key={p.id} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f5f5f5' }} onMouseDown={() => pickPatient(p)}>
                        <span style={{ fontWeight: 600 }}>{p.full_name}</span>
                        <span style={{ color: '#888', marginLeft: 8 }}>{p.age && `${p.age}y`} {p.gender} • {p.phone}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}><label style={s.label}>Patient Name *</label><input style={s.input} placeholder="Full name" value={orderForm.patient_name} onChange={e => setOrderForm(f => ({ ...f, patient_name: e.target.value }))} /></div>
                <div style={s.formGroup}><label style={s.label}>Phone</label><input style={s.input} placeholder="07XXXXXXXX" value={orderForm.phone} onChange={e => setOrderForm(f => ({ ...f, phone: e.target.value }))} /></div>
              </div>
              <div style={s.sectionLabel}>Test Details</div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Category</label>
                  <select style={s.input} value={orderForm.category} onChange={e => setOrderForm(f => ({ ...f, category: e.target.value, test_type: '' }))}>
                    {LAB_TEST_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Test Name *</label>
                  <select style={s.input} value={orderForm.test_type} onChange={e => setOrderForm(f => ({ ...f, test_type: e.target.value }))}>
                    <option value="">-- Select Test --</option>
                    {getLabTestsForCategory(orderForm.category).map(t => <option key={t}>{t}</option>)}
                    <option value="__custom__">✏️ Custom / Other</option>
                  </select>
                </div>
              </div>
              {orderForm.test_type === '__custom__' && <div style={s.formGroup}><label style={s.label}>Custom Test Name *</label><input style={s.input} placeholder="Enter test name" value={customTest} onChange={e => setCustomTest(e.target.value)} /></div>}
              {/* Show antibiogram hint if Microbiology category */}
              {orderForm.category === 'Microbiology' && (
                <div style={{ background: '#F5F0FF', border: '1px solid #DDD6FE', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#7B3AED', fontWeight: 600, marginBottom: 12 }}>
                  🧫 Microbiology C&S tests will use the <strong>Upload Antibiogram</strong> flow when entering results — attaches the VITEK/lab PDF and feeds the Antibiogram module.
                </div>
              )}
              <div style={s.formGrid2}>
                <div style={s.formGroup}><label style={s.label}>Priority</label><select style={s.input} value={orderForm.priority} onChange={e => setOrderForm(f => ({ ...f, priority: e.target.value }))}><option>Routine</option><option>Urgent</option><option>STAT</option></select></div>
                <div style={s.formGroup}><label style={s.label}>Ordered By (Doctor)</label><input style={s.input} placeholder="Dr. name" value={orderForm.ordered_by} onChange={e => setOrderForm(f => ({ ...f, ordered_by: e.target.value }))} /></div>
              </div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}><label style={s.label}>Test Location *</label><select style={s.input} value={orderForm.test_location} onChange={e => setOrderForm(f => ({ ...f, test_location: e.target.value }))}><option value="In-House">In-House Lab</option><option value="External">Send to External Lab</option></select></div>
                <div style={s.formGroup}><label style={s.label}>Assign Technician (optional)</label><select style={s.input} value={orderForm.assigned_to || ''} onChange={e => setOrderForm(f => ({ ...f, assigned_to: e.target.value }))}><option value="">-- Assign Later --</option>{labStaff.map(t => <option key={t.id} value={t.full_name}>{t.full_name}{t.role ? ` — ${t.role}` : ''}</option>)}</select></div>
              </div>
              <div style={s.formGroup}><label style={s.label}>Clinical Notes</label><input style={s.input} placeholder="Special instructions..." value={orderForm.notes} onChange={e => setOrderForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <div style={s.sectionLabel}>Payment</div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}><label style={s.label}>Amount (KES)</label><input style={s.input} type="number" placeholder="e.g. 500" value={orderForm.amount} onChange={e => setOrderForm(f => ({ ...f, amount: e.target.value }))} /></div>
                <div style={s.formGroup}><label style={s.label}>Payment Method</label><select style={s.input} value={orderForm.payment_method} onChange={e => setOrderForm(f => ({ ...f, payment_method: e.target.value }))}><option>Cash</option><option>M-Pesa</option><option>Insurance</option><option>SHA</option><option>Credit</option></select></div>
              </div>
              {orderForm.payment_method === 'M-Pesa' && <div style={s.formGroup}><label style={s.label}>M-Pesa Ref</label><input style={{ ...s.input, textTransform: 'uppercase', letterSpacing: 1 }} placeholder="e.g. QHJ2KL8MNP" value={orderForm.mpesa_ref} onChange={e => setOrderForm(f => ({ ...f, mpesa_ref: e.target.value.toUpperCase() }))} /></div>}
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => setShowOrderModal(false)}>Cancel</button>
              <button style={s.submitBtn} onClick={handleOrderTest} disabled={saving}>{saving ? 'Saving...' : '🔬 Order Test'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== RESULT MODAL (non-C&S tests only) ===== */}
      {showResultModal && selected && (
        <div style={s.overlay} onClick={() => setShowResultModal(false)}>
          <div style={{ ...s.modal, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitle}>📝 Enter Result</h2>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{selected.test_type} — {selected.patient_name}</div>
                {selected.assigned_to && <div style={{ fontSize: 12, color: '#1a6fb5', marginTop: 2 }}>Assigned to: {selected.assigned_to}</div>}
                {selected.visit_id && <div style={{ fontSize: 12, color: '#7B5EA7', marginTop: 2, fontWeight: 600 }}>📋 Doctor-ordered — saving returns patient to Doctor queue</div>}
              </div>
              <button style={s.closeBtn} onClick={() => setShowResultModal(false)}>✕</button>
            </div>
            <div style={s.modalBody}>
              {activeResultTemplate && (
                <div style={{ marginBottom: 16 }}>
                  <div style={s.sectionLabel}>{activeResultTemplate.label} Structured Entry</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
                    {activeResultTemplate.fields.map(field => {
                      const evaluation = evaluateStructuredValue(field, resultForm.structured_values?.[field.key])
                      const isAlert = evaluation.status === 'low' || evaluation.status === 'high'
                      return (
                        <div key={field.key} style={{ border: `1px solid ${evaluation.critical ? '#F09595' : isAlert ? '#FCD34D' : '#E5E7EB'}`, borderRadius: 10, padding: 12, background: evaluation.critical ? '#FFF5F5' : isAlert ? '#FFF9ED' : '#fff' }}>
                          <label style={{ ...s.label, marginBottom: 8 }}>{field.label}{field.unit ? ` (${field.unit})` : ''}</label>
                          <input
                            style={s.input}
                            readOnly={field.readOnly}
                            value={resultForm.structured_values?.[field.key] || ''}
                            onChange={e => setResultForm(prev => {
                              const nextValues = { ...(prev.structured_values || {}), [field.key]: e.target.value }
                              if (activeResultTemplate.key === 'rfts') {
                                nextValues.egfr = calculateEgfr(nextValues, patientsById[selected?.patient_id] || patients.find(patient => patient.full_name === selected?.patient_name) || null)
                              }
                              return { ...prev, structured_values: nextValues }
                            })}
                          />
                          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 6 }}>Ref: {field.reference || 'Use lab standard range'}</div>
                          {isAlert && <div style={{ fontSize: 11, color: evaluation.critical ? '#A32D2D' : '#C07000', marginTop: 6, fontWeight: 700 }}>{evaluation.status === 'low' ? 'Below range' : 'Above range'}</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {activeStructuredAlerts.length > 0 && (
                <div style={{ background: '#FCEBEB', border: '1px solid #F09595', borderRadius: 10, padding: '10px 14px', color: '#A32D2D', fontSize: 12, fontWeight: 700, marginBottom: 14 }}>
                  ⚠️ Critical value — notify clinician before saving
                  <div style={{ fontWeight: 500, marginTop: 6 }}>{activeStructuredAlerts.join(' ')}</div>
                </div>
              )}
              <div style={s.formGroup}>
                <label style={s.label}>Result Text / Full Report</label>
                <textarea style={{ ...s.input, height: 100, resize: 'vertical' }} placeholder="Enter full result report, findings, or detailed text..." value={resultForm.result_text} onChange={e => setResultForm(f => ({ ...f, result_text: e.target.value }))} />
              </div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}><label style={s.label}>Key Value / Reading</label><input style={s.input} placeholder="e.g. 11.2 g/dL, Positive" value={resultForm.result_value} onChange={e => setResultForm(f => ({ ...f, result_value: e.target.value }))} /></div>
                <div style={s.formGroup}><label style={s.label}>Reference Range</label><input style={s.input} placeholder="e.g. 12–16 g/dL, Negative" value={resultForm.reference_range} onChange={e => setResultForm(f => ({ ...f, reference_range: e.target.value }))} /></div>
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>Interpretation</label>
                <select style={s.input} value={resultForm.interpretation} onChange={e => setResultForm(f => ({ ...f, interpretation: e.target.value }))}>
                  <option value="">-- Select --</option>
                  {['Normal', 'Abnormal - Low', 'Abnormal - High', 'Positive', 'Negative', 'Borderline', 'Inconclusive', 'Pending Confirmation'].map(i => <option key={i}>{i}</option>)}
                </select>
              </div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Performed By</label>
                  <select style={s.input} value={resultForm.performed_by} onChange={e => setResultForm(f => ({ ...f, performed_by: e.target.value }))}>
                    <option value="">-- Select Technician --</option>
                    {labStaff.map(t => <option key={t.id} value={t.full_name}>{t.full_name}{t.role ? ` — ${t.role}` : ''}</option>)}
                    <option value="__custom__">Other</option>
                  </select>
                </div>
                <div style={s.formGroup}><label style={s.label}>Result File URL (optional)</label><input style={s.input} placeholder="Link to PDF/image" value={resultForm.result_file_url} onChange={e => setResultForm(f => ({ ...f, result_file_url: e.target.value }))} /></div>
              </div>
              <div style={s.formGroup}><label style={s.label}>Additional Notes</label><textarea style={{ ...s.input, height: 60, resize: 'vertical' }} placeholder="Any additional clinical notes..." value={resultForm.result_notes} onChange={e => setResultForm(f => ({ ...f, result_notes: e.target.value }))} /></div>
              {selected.visit_id && (
                <div style={{ background: '#F0EAFC', border: '1px solid #D4C5F5', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#7B5EA7', fontWeight: 600 }}>
                  ⚡ Saving returns patient to Doctor queue when all critical in-house tests are done.
                </div>
              )}
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => setShowResultModal(false)}>Cancel</button>
              <button
                style={s.submitBtn}
                onClick={handleSaveResult}
                disabled={saving || !canPostLabResults}
                title={!canPostLabResults ? 'Only lab technicians can post results' : ''}
              >
                {saving ? 'Saving...' : '✅ Save Result & Complete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  page: { padding: '20px 24px', flex: 1, overflowY: 'auto', background: '#f7f8f7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', minHeight: '100vh', boxSizing: 'border-box' },
  loadWrap: { height: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  spinner: { width: 36, height: 36, border: '3px solid #e8ebe8', borderTop: '3px solid #5B21B6', borderRadius: '50%', animation: 'spin 0.9s linear infinite' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  title: { fontSize: 24, fontWeight: 800, margin: 0, color: '#111' },
  subtitle: { color: '#777', margin: '4px 0 0', fontSize: 13 },
  btn: { background: '#5B21B6', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13 },
  tabRow: { display: 'flex', gap: 4, marginBottom: 14, background: '#fff', padding: '6px 8px', borderRadius: 10, border: '1px solid #eee', flexWrap: 'wrap' },
  tabBtn: { padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#888', borderRadius: 7, display: 'flex', alignItems: 'center', gap: 6 },
  tabBtnActive: { background: '#5B21B6', color: '#fff' },
  tabCount: { fontSize: 11, padding: '2px 7px', borderRadius: 99, background: '#f0f0f0', color: '#666', fontWeight: 700 },
  tabCountActive: { background: 'rgba(255,255,255,0.25)', color: '#fff' },
  patientCardActive: { border: '2px solid #5B21B6', background: '#FAF5FF', borderRadius: 12 },
  testCard: { borderRadius: 12, padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.04)', flexWrap: 'wrap', transition: 'box-shadow 0.15s' },
  detailPanel: { width: 300, flexShrink: 0, background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 18, overflowY: 'auto', maxHeight: 'calc(100vh - 140px)' },
  sectionLabel: { fontSize: 11, fontWeight: 700, color: '#5B21B6', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10, marginTop: 4, paddingBottom: 5, borderBottom: '1px solid #F3E8FF' },
  pill: { fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99, display: 'inline-block' },
  chip: { fontSize: 11, padding: '5px 12px', borderRadius: 99, border: '1px solid #e0e0e0', background: '#fff', cursor: 'pointer', fontWeight: 500, color: '#555' },
  chipActive: { background: '#5B21B6', color: '#fff', border: '1px solid #5B21B6' },
  actionBtn: { fontSize: 12, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', border: 'none' },
  btnPri: { background: '#5B21B6', color: '#fff' },
  btnGhost: { background: '#F3F4F6', color: '#9CA3AF', border: '1px solid #E5E7EB' },
  empty: { textAlign: 'center', padding: '80px 20px', color: '#999' },
  metricCard: { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: 16, boxShadow: '0 2px 10px rgba(15,110,86,0.04)' },
  metricLabel: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.7px', color: '#6B7280' },
  metricValue: { fontSize: 28, fontWeight: 800, color: '#111827', marginTop: 8 },
  metricSub: { fontSize: 12, color: '#6B7280', marginTop: 6 },
  dashboardCard: { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 18, boxShadow: '0 2px 10px rgba(15,110,86,0.04)' },
  dashboardCardTitle: { fontSize: 14, fontWeight: 800, color: '#111827', marginBottom: 14 },
  listButton: { width: '100%', border: '1px solid #E5E7EB', borderRadius: 10, background: '#fff', padding: '10px 12px', display: 'flex', alignItems: 'center', cursor: 'pointer', textAlign: 'left' },
  microCard: { background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 12 },
  microCardLabel: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: '#64748B' },
  microCardValue: { fontSize: 13, fontWeight: 700, color: '#111827', marginTop: 6 },
  microQuickBtn: { border: '1px solid #D1D5DB', background: '#fff', color: '#374151', borderRadius: 8, padding: '8px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal: { background: '#fff', borderRadius: 16, width: '100%', maxWidth: 700, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', animation: 'fadeIn 0.2s ease' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 24px', borderBottom: '1px solid #f0f0f0' },
  modalTitle: { fontSize: 17, fontWeight: 700, margin: 0, color: '#111' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#aaa' },
  modalBody: { padding: '20px 24px', overflowY: 'auto', flex: 1 },
  modalFooter: { padding: '14px 24px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end', gap: 10 },
  formGrid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  formGroup: { marginBottom: 14 },
  label: { fontSize: 12, color: '#666', display: 'block', marginBottom: 5, fontWeight: 500 },
  input: { width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#111', fontFamily: 'inherit' },
  cancelBtn: { padding: '10px 20px', border: '1px solid #ddd', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#555' },
  submitBtn: { padding: '10px 24px', border: 'none', borderRadius: 8, background: '#5B21B6', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
}


