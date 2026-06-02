import { useCallback, useEffect, useMemo, useState } from 'react'
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
import SkeletonLoader from '../components/SkeletonLoader'
import supabase from '../supabase'
import { useHospital } from '../context'
import { executeWithFallback, omitKeys } from '../utils/dbCompat'
import { logAudit } from '../utils/audit'
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

const META_PREFIX = '[credit-meta]'
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'accounts', label: 'Credit Accounts' },
  { key: 'aging', label: 'Aging Report' },
  { key: 'followups', label: 'Follow-up Workflow' },
  { key: 'corporate', label: 'Corporate Accounts' },
  { key: 'writeoffs', label: 'Write-offs' },
  { key: 'analytics', label: 'Debt Analytics' },
  { key: 'ledger', label: 'Ledger' },
]
const ACCOUNT_TYPES = ['Individual', 'Corporate', 'Insurer']
const PAYMENT_METHODS = ['Cash', 'M-Pesa', 'EFT', 'Bank Transfer', 'Cheque', 'Waived']
const FOLLOW_UP_STATUSES = ['No Contact', 'Promised Payment', 'Dispute', 'Legal', 'Written Off']
const RECORD_TYPES = ['Debt', 'Credit']
const CATEGORIES = ['Consultation', 'Lab', 'Pharmacy', 'Radiology', 'Procedures', 'Accommodation', 'Deposit', 'Overpayment', 'Other']
const CHART_COLORS = ['#5B21B6', '#EAB308', '#F97316', '#D32F2F']
const LOCAL_ACCOUNT_KEY_PREFIX = 'remedacare:credit_accounts:'
const LOCAL_PAYMENT_KEY_PREFIX = 'remedacare:credit_payments:'
const LOCAL_FOLLOWUP_KEY_PREFIX = 'remedacare:credit_followups:'
const LOCAL_WRITEOFF_KEY_PREFIX = 'remedacare:credit_writeoffs:'

const EMPTY_RECORD_FORM = {
  type: 'Debt',
  account_type: 'Individual',
  patient_id: '',
  credit_account_id: '',
  corporate_name: '',
  insurer_name: '',
  category: 'Consultation',
  description: '',
  amount_charged: '',
  amount_paid: '0',
  payment_method: 'Cash',
  reference_no: '',
  due_date: '',
  credit_limit_kes: '',
  guarantor_name: '',
  guarantor_phone: '',
  guarantor_employer: '',
  payment_plan_installment: '',
  payment_plan_next_date: '',
  notes: '',
}

const EMPTY_ACCOUNT_FORM = {
  account_type: 'Individual',
  patient_id: '',
  account_name: '',
  contact_phone: '',
  contact_email: '',
  employer_name: '',
  guarantor_name: '',
  guarantor_phone: '',
  guarantor_employer: '',
  credit_limit_kes: '',
  notes: '',
}

const EMPTY_PAYMENT_FORM = {
  amount_kes: '',
  payment_method: 'Cash',
  reference_no: '',
  paid_at: new Date().toISOString().slice(0, 16),
  notes: '',
}

const EMPTY_FOLLOWUP_FORM = {
  contact_date: new Date().toISOString().slice(0, 16),
  contact_made_to: '',
  response: '',
  follow_up_status: 'No Contact',
  next_follow_up_date: '',
  notes: '',
}

const EMPTY_WRITEOFF_FORM = {
  amount_kes: '',
  reason: '',
  approved_by: '',
  remainder_installment: '',
  remainder_next_date: '',
  notes: '',
}

function createUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.random() * 16 | 0
    const value = char === 'x' ? rand : ((rand & 0x3) | 0x8)
    return value.toString(16)
  })
}

function readLocalRows(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch (_) {
    return []
  }
}

function writeLocalRows(key, rows) {
  localStorage.setItem(key, JSON.stringify(rows || []))
}

function localAccountKey(hospitalId) {
  return `${LOCAL_ACCOUNT_KEY_PREFIX}${hospitalId || 'default'}`
}

function localPaymentKey(hospitalId) {
  return `${LOCAL_PAYMENT_KEY_PREFIX}${hospitalId || 'default'}`
}

function localFollowUpKey(hospitalId) {
  return `${LOCAL_FOLLOWUP_KEY_PREFIX}${hospitalId || 'default'}`
}

function localWriteOffKey(hospitalId) {
  return `${LOCAL_WRITEOFF_KEY_PREFIX}${hospitalId || 'default'}`
}

function parseNotesMeta(notes) {
  const raw = String(notes || '')
  const index = raw.indexOf(META_PREFIX)
  if (index < 0) {
    return { noteText: raw.trim(), meta: {} }
  }
  const noteText = raw.slice(0, index).trim()
  const metaRaw = raw.slice(index + META_PREFIX.length).trim()
  try {
    return { noteText, meta: metaRaw ? JSON.parse(metaRaw) : {} }
  } catch (_) {
    return { noteText: raw.trim(), meta: {} }
  }
}

function mergeNotesMeta(noteText, meta) {
  const base = String(noteText || '').trim()
  const payload = Object.entries(meta || {}).reduce((acc, [key, value]) => {
    if (value === undefined || value === null || value === '') return acc
    acc[key] = value
    return acc
  }, {})
  if (!Object.keys(payload).length) return base
  const json = JSON.stringify(payload)
  return base ? `${base}\n${META_PREFIX}${json}` : `${META_PREFIX}${json}`
}

function formatKES(value) {
  return `KES ${Number(value || 0).toLocaleString()}`
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('en-KE')
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('en-KE')
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function maskAccount(value) {
  const text = String(value || '')
  if (text.length <= 4) return text ? `****${text}` : '-'
  return `${'*'.repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`
}

function normalizePhoneForWhatsApp(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('254')) return digits
  if (digits.startsWith('0')) return `254${digits.slice(1)}`
  if (digits.startsWith('7') || digits.startsWith('1')) return `254${digits}`
  return digits
}

function openWhatsAppMessage(phone, message) {
  const normalized = normalizePhoneForWhatsApp(phone)
  if (!normalized) return false
  window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  return true
}

function getDaysOutstanding(row) {
  const anchor = row.due_date || row.created_at
  if (!anchor) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(anchor).getTime()) / 86400000))
}

function getAgingBucket(days) {
  if (days <= 30) return 'Current (0-30 days)'
  if (days <= 60) return '31-60 days'
  if (days <= 90) return '61-90 days'
  return '>90 days'
}

function getAgingMeta(days) {
  if (days <= 30) return { label: 'Current', bg: '#ECFDF5', color: '#047857' }
  if (days <= 60) return { label: '31-60', bg: '#FEF3C7', color: '#B45309' }
  if (days <= 90) return { label: '61-90', bg: '#FFEDD5', color: '#C2410C' }
  return { label: '>90', bg: '#FEE2E2', color: '#B91C1C' }
}

function createReceiptNumber(date = new Date(), seed = '') {
  const d = new Date(date)
  const suffix = String(seed || Date.now()).replace(/\D/g, '').slice(-6).padStart(6, '0')
  return `CRD/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${suffix}`
}

function monthKey(value) {
  const date = value ? new Date(value) : new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(value) {
  const date = value ? new Date(value) : new Date()
  return date.toLocaleDateString('en-KE', { month: 'short', year: 'numeric' })
}

function getLastMonths(count = 6) {
  const items = []
  const base = new Date()
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(base.getFullYear(), base.getMonth() - index, 1)
    items.push({
      key: monthKey(date),
      label: monthLabel(date),
    })
  }
  return items
}

function openPrintWindow(title, html) {
  const popup = window.open('', '_blank', 'width=980,height=820')
  if (!popup) {
    window.notifyFromLegacyAlert?.('Popup blocked. Please allow popups to print this document.')
    return
  }
  popup.document.write(`<!doctype html><html><head><title>${title}</title><style>
    body{font-family:Arial,sans-serif;padding:24px;color:#111827}
    h1,h2,h3{margin:0 0 8px}
    .muted{color:#64748B}
    .section{margin-top:18px}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{border:1px solid #E5E7EB;padding:8px 10px;font-size:12px;text-align:left;vertical-align:top}
    .right{text-align:right}
    .pill{display:inline-block;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700}
    @media print{body{padding:0 12px}}
  </style></head><body>${html}</body></html>`)
  popup.document.close()
  popup.focus()
  popup.print()
}

function buildPaymentReceiptHtml({ hospitalName, payment, account, allocations, patientLookup }) {
  const allocationRows = allocations.map((item) => {
    const patientName = patientLookup[item.patient_id]?.full_name || item.patient_name || account.account_name
    return `<tr>
      <td>${patientName}</td>
      <td>${item.description || 'Credit allocation'}</td>
      <td>${item.invoice_no || '-'}</td>
      <td class="right">${formatKES(item.amount_kes)}</td>
    </tr>`
  }).join('')
  return `
    <h1>${hospitalName || 'Brightpath Travel Scholars'}</h1>
    <div class="muted">Computer-generated credit payment receipt</div>
    <div class="section">
      <table>
        <tr><th>Receipt No</th><td>${payment.receipt_no}</td><th>Paid At</th><td>${formatDateTime(payment.paid_at)}</td></tr>
        <tr><th>Account</th><td>${account.account_name}</td><th>Method</th><td>${payment.payment_method}</td></tr>
        <tr><th>Reference</th><td>${payment.reference_no || '-'}</td><th>Amount</th><td>${formatKES(payment.amount_kes)}</td></tr>
      </table>
    </div>
    <div class="section">
      <h3>Allocation</h3>
      <table>
        <thead><tr><th>Patient</th><th>Description</th><th>Invoice</th><th class="right">Allocated</th></tr></thead>
        <tbody>${allocationRows}</tbody>
      </table>
    </div>
  `
}

function buildCorporateStatementHtml({ hospitalName, account, rows, month }) {
  const total = rows.reduce((sum, row) => sum + Number(row.balance || 0), 0)
  const body = rows.map((row) => `
    <tr>
      <td>${formatDate(row.created_at)}</td>
      <td>${row.patients?.full_name || account.account_name}</td>
      <td>${row.description || '-'}</td>
      <td>${row.category || '-'}</td>
      <td class="right">${formatKES(row.amount_charged)}</td>
      <td class="right">${formatKES(row.amount_paid)}</td>
      <td class="right">${formatKES(row.balance)}</td>
    </tr>
  `).join('')
  return `
    <h1>${hospitalName || 'Brightpath Travel Scholars'}</h1>
    <div class="muted">Corporate credit statement for ${account.account_name}</div>
    <div class="section">
      <table>
        <tr><th>Statement Month</th><td>${month}</td><th>Credit Limit</th><td>${formatKES(account.credit_limit_kes)}</td></tr>
        <tr><th>Contact</th><td>${account.contact_phone || '-'}</td><th>Outstanding</th><td>${formatKES(total)}</td></tr>
      </table>
    </div>
    <div class="section">
      <table>
        <thead><tr><th>Date</th><th>Patient</th><th>Description</th><th>Category</th><th class="right">Charged</th><th class="right">Paid</th><th class="right">Balance</th></tr></thead>
        <tbody>${body || '<tr><td colspan="7">No activity in the selected period.</td></tr>'}</tbody>
      </table>
    </div>
  `
}

async function exportWorkbook(filename, sheets) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()
  sheets.forEach(({ name, rows }) => {
    const sheet = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  })
  XLSX.writeFile(workbook, filename)
}

async function syncPaymentToBillingInvoice(hospitalId, record, amountPaid, paymentMethod, referenceNo) {
  if (!record.visit_id && !record.patient_id) return
  let query = supabase
    .from('invoices')
    .select('id, amount_kes, paid_kes, balance_kes, status, payment_method')
    .eq('hospital_id', hospitalId)
    .in('status', ['Pending', 'Partial'])
    .order('created_at', { ascending: true })
    .limit(1)
  if (record.visit_id) query = query.eq('visit_id', record.visit_id)
  else query = query.eq('patient_id', record.patient_id)
  const { data } = await query
  if (!data || !data.length) return
  const invoice = data[0]
  const newPaid = Math.min(Number(invoice.amount_kes || 0), Number(invoice.paid_kes || 0) + Number(amountPaid || 0))
  const newBalance = Math.max(0, Number(invoice.amount_kes || 0) - newPaid)
  const newStatus = newBalance <= 0 ? 'Paid' : newPaid > 0 ? 'Partial' : 'Pending'
  await supabase.from('invoices').update({
    paid_kes: newPaid,
    balance_kes: newBalance,
    status: newStatus,
    payment_method: paymentMethod || invoice.payment_method,
    mpesa_ref: paymentMethod === 'M-Pesa' ? (referenceNo || null) : undefined,
    paid_at: newStatus === 'Paid' ? new Date().toISOString() : null,
  }).eq('id', invoice.id)
}

function normalizeDebtRecord(record = {}) {
  const { noteText, meta } = parseNotesMeta(record.notes)
  const accountType = record.account_type || meta.account_type || 'Individual'
  const payerType = record.payer_type || meta.payer_type || accountType
  const accountName = record.corporate_account_name || meta.account_name || record.patients?.full_name || 'Unassigned Account'
  const creditLimit = Number(record.credit_limit_kes ?? meta.credit_limit_kes ?? 0)
  const paymentPlan = record.payment_plan_json || meta.payment_plan || {}
  return {
    ...record,
    notes_text: noteText,
    notes_meta: meta,
    account_type: accountType,
    payer_type: payerType,
    account_name: accountName,
    credit_limit_kes: creditLimit,
    guarantor_name: record.guarantor_name || meta.guarantor_name || '',
    guarantor_phone: record.guarantor_phone || meta.guarantor_phone || '',
    guarantor_employer: record.guarantor_employer || meta.guarantor_employer || '',
    payment_plan: paymentPlan,
    days_outstanding: getDaysOutstanding(record),
  }
}

function getRecordAccountKey(record) {
  if (record.credit_account_id) return `account:${record.credit_account_id}`
  if (record.account_type === 'Corporate') return `corporate:${normalizeText(record.account_name || record.corporate_account_name)}`
  if (record.account_type === 'Insurer') return `insurer:${normalizeText(record.account_name || record.corporate_account_name || record.payer_type)}`
  return `patient:${record.patient_id || normalizeText(record.account_name || record.patients?.full_name)}`
}

function normalizeAccountRecord(account = {}) {
  return {
    ...account,
    account_name: account.account_name || account.corporate_name || account.employer_name || 'Untitled Account',
    account_type: account.account_type || 'Individual',
    credit_limit_kes: Number(account.credit_limit_kes || 0),
    contact_phone: account.contact_phone || '',
    contact_email: account.contact_email || '',
    guarantor_name: account.guarantor_name || '',
    guarantor_phone: account.guarantor_phone || '',
    guarantor_employer: account.guarantor_employer || '',
    notes: account.notes || '',
    active: account.active !== false,
  }
}

function groupAgingRows(records) {
  return records.reduce((acc, row) => {
    const key = row.patient_id || row.account_name || row.id
    if (!acc[key]) {
      acc[key] = {
        key,
        patient_name: row.patients?.full_name || row.account_name || 'Unknown',
        phone: row.patients?.phone || '',
        current: 0,
        d31: 0,
        d61: 0,
        d91: 0,
        total: 0,
        payer_type: row.account_type || row.payer_type || 'Individual',
      }
    }
    const balance = Number(row.balance || 0)
    const days = row.days_outstanding
    acc[key].total += balance
    if (days <= 30) acc[key].current += balance
    else if (days <= 60) acc[key].d31 += balance
    else if (days <= 90) acc[key].d61 += balance
    else acc[key].d91 += balance
    return acc
  }, {})
}

function MetricCard({ title, value, hint, accent = C.primary, background = C.surface }) {
  return (
    <div style={{ ...styles.metricCard, background, borderColor: `${accent}22` }}>
      <div style={styles.metricTitle}>{title}</div>
      <div style={{ ...styles.metricValue, color: accent }}>{value}</div>
      {hint ? <div style={styles.metricHint}>{hint}</div> : null}
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    Pending: { bg: '#FFF7ED', color: '#C2410C' },
    Partial: { bg: '#DBEAFE', color: '#1D4ED8' },
    Paid: { bg: '#DCFCE7', color: '#15803D' },
    Waived: { bg: '#F3F4F6', color: '#475569' },
    Disputed: { bg: '#FEE2E2', color: '#B91C1C' },
    Credit: { bg: '#ECFDF5', color: '#0F766E' },
    'Promised Payment': { bg: '#DBEAFE', color: '#1D4ED8' },
    Legal: { bg: '#FEE2E2', color: '#B91C1C' },
    'No Contact': { bg: '#FFF7ED', color: '#C2410C' },
    'Written Off': { bg: '#F3F4F6', color: '#475569' },
  }
  const style = map[status] || { bg: '#F8FAFC', color: '#475569' }
  return <span style={{ ...styles.badge, background: style.bg, color: style.color }}>{status || '-'}</span>
}

function ModalShell({ title, subtitle, onClose, maxWidth = 760, children, footer }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxWidth }} onClick={(event) => event.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div>
            <h2 style={styles.modalTitle}>{title}</h2>
            {subtitle ? <div style={styles.modalSubtitle}>{subtitle}</div> : null}
          </div>
          <button style={styles.closeBtn} onClick={onClose}>x</button>
        </div>
        <div style={styles.modalBody}>{children}</div>
        {footer ? <div style={styles.modalFooter}>{footer}</div> : null}
      </div>
    </div>
  )
}

function SectionCard({ title, subtitle, actions, children }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div>
          <div style={styles.cardTitle}>{title}</div>
          {subtitle ? <div style={styles.cardSubtitle}>{subtitle}</div> : null}
        </div>
        {actions ? <div style={styles.headerActions}>{actions}</div> : null}
      </div>
      <div style={styles.cardBody}>{children}</div>
    </div>
  )
}

export default function CreditDebts() {
  const { hospitalId, userRole, hospitalName } = useHospital()
  const isAdmin = ['Admin', 'admin'].includes(userRole || '')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('all')
  const [accountTypeFilter, setAccountTypeFilter] = useState('all')
  const [records, setRecords] = useState([])
  const [patients, setPatients] = useState([])
  const [invoices, setInvoices] = useState([])
  const [accounts, setAccounts] = useState([])
  const [payments, setPayments] = useState([])
  const [followUps, setFollowUps] = useState([])
  const [writeOffs, setWriteOffs] = useState([])
  const [compatMode, setCompatMode] = useState({ accounts: false, payments: false, followups: false, writeoffs: false })

  const [showRecordModal, setShowRecordModal] = useState(false)
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [paymentTarget, setPaymentTarget] = useState(null)
  const [followUpTarget, setFollowUpTarget] = useState(null)
  const [writeOffTarget, setWriteOffTarget] = useState(null)
  const [detailTarget, setDetailTarget] = useState(null)

  const [editingRecord, setEditingRecord] = useState(null)
  const [editingAccount, setEditingAccount] = useState(null)
  const [recordForm, setRecordForm] = useState(EMPTY_RECORD_FORM)
  const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT_FORM)
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT_FORM)
  const [followUpForm, setFollowUpForm] = useState(EMPTY_FOLLOWUP_FORM)
  const [writeOffForm, setWriteOffForm] = useState(EMPTY_WRITEOFF_FORM)

  const loadData = useCallback(async (showSpinner = true) => {
    if (!hospitalId) {
      setLoading(false)
      return
    }
    if (showSpinner) setLoading(true)

    const [recordRes, patientRes, invoiceRes, accountRes, paymentRes, followUpRes, writeOffRes] = await Promise.all([
      supabase
        .from('credit_debts')
        .select('*, patients(id, full_name, phone, patient_number)')
        .eq('hospital_id', hospitalId)
        .order('created_at', { ascending: false }),
      supabase
        .from('patients')
        .select('id, full_name, phone, patient_number')
        .eq('hospital_id', hospitalId)
        .order('full_name'),
      supabase
        .from('invoices')
        .select('id, patient_id, visit_id, patient_name, invoice_no, amount_kes, paid_kes, balance_kes, payment_method, status, created_at')
        .eq('hospital_id', hospitalId)
        .order('created_at', { ascending: false })
        .limit(500),
      executeWithFallback(
        () => supabase.from('credit_accounts').select('*').eq('hospital_id', hospitalId).order('account_name'),
        async () => ({ data: readLocalRows(localAccountKey(hospitalId)), error: null, compatFallback: true }),
      ),
      executeWithFallback(
        () => supabase.from('credit_payments').select('*').eq('hospital_id', hospitalId).order('paid_at', { ascending: false }),
        async () => ({ data: readLocalRows(localPaymentKey(hospitalId)), error: null, compatFallback: true }),
      ),
      executeWithFallback(
        () => supabase.from('credit_followups').select('*').eq('hospital_id', hospitalId).order('contact_date', { ascending: false }),
        async () => ({ data: readLocalRows(localFollowUpKey(hospitalId)), error: null, compatFallback: true }),
      ),
      executeWithFallback(
        () => supabase.from('credit_writeoffs').select('*').eq('hospital_id', hospitalId).order('written_off_at', { ascending: false }),
        async () => ({ data: readLocalRows(localWriteOffKey(hospitalId)), error: null, compatFallback: true }),
      ),
    ])

    setRecords((recordRes.data || []).map(normalizeDebtRecord))
    setPatients(patientRes.data || [])
    setInvoices(invoiceRes.data || [])
    setAccounts((accountRes.data || []).map(normalizeAccountRecord))
    setPayments(paymentRes.data || [])
    setFollowUps(followUpRes.data || [])
    setWriteOffs(writeOffRes.data || [])
    setCompatMode({
      accounts: Boolean(accountRes.compatFallback),
      payments: Boolean(paymentRes.compatFallback),
      followups: Boolean(followUpRes.compatFallback),
      writeoffs: Boolean(writeOffRes.compatFallback),
    })
    setLoading(false)
  }, [hospitalId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (!hospitalId) return undefined
    const channel = supabase
      .channel(`credit-live-${hospitalId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_debts', filter: `hospital_id=eq.${hospitalId}` }, () => { void loadData(false) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_accounts', filter: `hospital_id=eq.${hospitalId}` }, () => { void loadData(false) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_payments', filter: `hospital_id=eq.${hospitalId}` }, () => { void loadData(false) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_followups', filter: `hospital_id=eq.${hospitalId}` }, () => { void loadData(false) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_writeoffs', filter: `hospital_id=eq.${hospitalId}` }, () => { void loadData(false) })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [hospitalId, loadData])

  const patientLookup = useMemo(
    () => patients.reduce((acc, patient) => {
      acc[patient.id] = patient
      return acc
    }, {}),
    [patients],
  )

  const accountRows = useMemo(() => {
    const map = new Map()
    accounts.forEach((account) => {
      const key = account.id ? `account:${account.id}` : `${account.account_type}:${normalizeText(account.account_name)}`
      map.set(key, {
        ...account,
        key,
        source: 'table',
      })
    })
    records.forEach((record) => {
      const key = getRecordAccountKey(record)
      const existing = map.get(key)
      if (existing) return
      map.set(key, {
        id: record.credit_account_id || null,
        key,
        account_type: record.account_type || 'Individual',
        payer_type: record.payer_type || record.account_type || 'Individual',
        patient_id: record.patient_id || null,
        account_name: record.account_name,
        contact_phone: record.patients?.phone || '',
        credit_limit_kes: Number(record.credit_limit_kes || 0),
        guarantor_name: record.guarantor_name || '',
        guarantor_phone: record.guarantor_phone || '',
        guarantor_employer: record.guarantor_employer || '',
        notes: record.notes_text || '',
        active: true,
        source: 'derived',
      })
    })
    return [...map.values()]
  }, [accounts, records])

  const openDebtRows = useMemo(
    () => records.filter((row) => row.type === 'Debt' && Number(row.balance || 0) > 0 && row.status !== 'Waived'),
    [records],
  )

  const accountSummaries = useMemo(() => {
    const paymentsByAccount = payments.reduce((acc, row) => {
      const key = row.credit_account_id ? `account:${row.credit_account_id}` : (row.account_key || '')
      if (!key) return acc
      acc[key] = (acc[key] || 0) + Number(row.amount_kes || 0)
      return acc
    }, {})
    const followupByAccount = followUps.reduce((acc, row) => {
      const key = row.credit_account_id ? `account:${row.credit_account_id}` : (row.account_key || '')
      if (!key) return acc
      if (!acc[key] || new Date(row.contact_date).getTime() > new Date(acc[key].contact_date).getTime()) {
        acc[key] = row
      }
      return acc
    }, {})
    const writeoffByAccount = writeOffs.reduce((acc, row) => {
      const key = row.credit_account_id ? `account:${row.credit_account_id}` : (row.account_key || '')
      if (!key) return acc
      acc[key] = (acc[key] || 0) + Number(row.amount_kes || 0)
      return acc
    }, {})

    return accountRows.map((account) => {
      const key = account.key || (account.id ? `account:${account.id}` : `${account.account_type}:${normalizeText(account.account_name)}`)
      const debts = records.filter((row) => getRecordAccountKey(row) === key && row.type === 'Debt')
      const credits = records.filter((row) => getRecordAccountKey(row) === key && row.type === 'Credit')
      const balance = debts.reduce((sum, row) => sum + Number(row.balance || 0), 0)
      const totalInvoiced = debts.reduce((sum, row) => sum + Number(row.amount_charged || 0), 0)
      const totalPaid = debts.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0)
      const creditBalance = credits.reduce((sum, row) => sum + Number(row.balance || 0), 0)
      const limit = Number(account.credit_limit_kes || 0)
      const utilisation = limit > 0 ? Math.round((balance / limit) * 100) : 0
      const latestFollowUp = followupByAccount[key] || null
      const dueToday = latestFollowUp?.next_follow_up_date && new Date(latestFollowUp.next_follow_up_date) <= new Date()
      return {
        ...account,
        key,
        debts,
        credits,
        balance,
        totalInvoiced,
        totalPaid,
        creditBalance,
        utilisation,
        overUtilised: limit > 0 && utilisation >= 80,
        latestFollowUp,
        dueToday: Boolean(dueToday),
        followupStatus: latestFollowUp?.follow_up_status || 'No Contact',
        collectedViaReceipts: Number(paymentsByAccount[key] || 0),
        writtenOff: Number(writeoffByAccount[key] || 0),
      }
    }).sort((left, right) => right.balance - left.balance)
  }, [accountRows, followUps, payments, records, writeOffs])

  const accountSummaryMap = useMemo(
    () => accountSummaries.reduce((acc, account) => {
      acc[account.key] = account
      return acc
    }, {}),
    [accountSummaries],
  )

  const filteredAccounts = useMemo(() => {
    return accountSummaries.filter((account) => {
      const term = search.trim().toLowerCase()
      const matchesSearch = !term
        || account.account_name.toLowerCase().includes(term)
        || String(account.contact_phone || '').toLowerCase().includes(term)
        || String(account.guarantor_name || '').toLowerCase().includes(term)
      const matchesType = accountTypeFilter === 'all' || account.account_type === accountTypeFilter
      return matchesSearch && matchesType
    })
  }, [accountSummaries, accountTypeFilter, search])

  const filteredLedger = useMemo(() => {
    return records.filter((record) => {
      const term = search.trim().toLowerCase()
      const matchesSearch = !term
        || String(record.patients?.full_name || '').toLowerCase().includes(term)
        || String(record.account_name || '').toLowerCase().includes(term)
        || String(record.description || '').toLowerCase().includes(term)
      const matchesType = accountTypeFilter === 'all' || record.account_type === accountTypeFilter
      const created = record.created_at ? new Date(record.created_at) : null
      if (dateFilter === 'today' && created) {
        const now = new Date()
        if (created.toDateString() !== now.toDateString()) return false
      }
      if (dateFilter === 'month' && created) {
        const now = new Date()
        if (created.getMonth() !== now.getMonth() || created.getFullYear() !== now.getFullYear()) return false
      }
      return matchesSearch && matchesType
    })
  }, [accountTypeFilter, dateFilter, records, search])

  const agingRows = useMemo(
    () => Object.values(groupAgingRows(openDebtRows)).sort((left, right) => right.total - left.total),
    [openDebtRows],
  )

  const agingTotals = useMemo(() => openDebtRows.reduce((acc, row) => {
    const balance = Number(row.balance || 0)
    const bucket = getAgingBucket(row.days_outstanding)
    acc[bucket] = (acc[bucket] || 0) + balance
    return acc
  }, {
    'Current (0-30 days)': 0,
    '31-60 days': 0,
    '61-90 days': 0,
    '>90 days': 0,
  }), [openDebtRows])

  const agingSummary = useMemo(() => ([
    { label: 'Current (0-30 days)', value: agingTotals['Current (0-30 days)'], colors: getAgingMeta(0) },
    { label: '31-60 days', value: agingTotals['31-60 days'], colors: getAgingMeta(45) },
    { label: '61-90 days', value: agingTotals['61-90 days'], colors: getAgingMeta(75) },
    { label: '>90 days', value: agingTotals['>90 days'], colors: getAgingMeta(120) },
  ]), [agingTotals])

  const dueForFollowUpToday = useMemo(
    () => accountSummaries.filter((account) => account.balance > 0 && account.dueToday),
    [accountSummaries],
  )

  const topDebtors = useMemo(
    () => accountSummaries.filter((account) => account.balance > 0).slice(0, 5),
    [accountSummaries],
  )

  const openExposure = useMemo(
    () => accountSummaries.reduce((sum, account) => sum + Number(account.balance || 0), 0),
    [accountSummaries],
  )

  const creditRevenue = useMemo(
    () => records.filter((row) => row.type === 'Debt').reduce((sum, row) => sum + Number(row.amount_charged || 0), 0),
    [records],
  )

  const totalWriteOffs = useMemo(
    () => writeOffs.reduce((sum, row) => sum + Number(row.amount_kes || 0), 0),
    [writeOffs],
  )

  const collectionEfficiency = useMemo(() => {
    const eligible = records.filter((row) => row.type === 'Debt' && row.created_at)
    if (!eligible.length) return 0
    const collectedWithinSixty = eligible
      .filter((row) => Number(row.amount_paid || 0) > 0 && row.paid_at && (new Date(row.paid_at).getTime() - new Date(row.created_at).getTime()) <= (60 * 86400000))
      .reduce((sum, row) => sum + Number(row.amount_paid || 0), 0)
    const totalCharged = eligible.reduce((sum, row) => sum + Number(row.amount_charged || 0), 0)
    return totalCharged > 0 ? Math.round((collectedWithinSixty / totalCharged) * 100) : 0
  }, [records])

  const badDebtRate = useMemo(
    () => creditRevenue > 0 ? Number(((totalWriteOffs / creditRevenue) * 100).toFixed(1)) : 0,
    [creditRevenue, totalWriteOffs],
  )

  const exposureByPayerType = useMemo(() => {
    const totals = { Individual: 0, Corporate: 0, Insurer: 0 }
    accountSummaries.forEach((account) => {
      const type = ACCOUNT_TYPES.includes(account.account_type) ? account.account_type : 'Individual'
      totals[type] += Number(account.balance || 0)
    })
    return Object.entries(totals).map(([name, value]) => ({ name, value }))
  }, [accountSummaries])

  const paymentTrend = useMemo(() => {
    const months = getLastMonths(6).reduce((acc, item) => {
      acc[item.key] = { month: item.label, invoiced: 0, collected: 0, writtenOff: 0 }
      return acc
    }, {})
    records.forEach((row) => {
      if (row.type !== 'Debt') return
      const key = monthKey(row.created_at)
      if (!months[key]) return
      months[key].invoiced += Number(row.amount_charged || 0)
    })
    payments.forEach((row) => {
      const key = monthKey(row.paid_at)
      if (!months[key]) return
      months[key].collected += Number(row.amount_kes || 0)
    })
    writeOffs.forEach((row) => {
      const key = monthKey(row.written_off_at)
      if (!months[key]) return
      months[key].writtenOff += Number(row.amount_kes || 0)
    })
    return Object.values(months)
  }, [payments, records, writeOffs])

  const corporateAccounts = useMemo(
    () => accountSummaries.filter((account) => account.account_type === 'Corporate'),
    [accountSummaries],
  )

  const corporateMonthOptions = useMemo(() => {
    const months = new Set(records.map((row) => monthKey(row.created_at)))
    return [...months].sort().reverse()
  }, [records])

  const paymentPreview = useMemo(() => {
    if (!paymentTarget) return []
    const amount = Number(paymentForm.amount_kes || 0)
    if (!amount) return []
    let remaining = amount
    return (paymentTarget.debts || [])
      .filter((row) => Number(row.balance || 0) > 0)
      .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
      .map((row) => {
        if (remaining <= 0) return null
        const applied = Math.min(Number(row.balance || 0), remaining)
        remaining -= applied
        return {
          id: row.id,
          patient_id: row.patient_id,
          patient_name: row.patients?.full_name || paymentTarget.account_name,
          description: row.description,
          invoice_no: row.description?.startsWith('Invoice ') ? row.description.replace('Invoice ', '') : '',
          amount_kes: applied,
          visit_id: row.visit_id,
        }
      })
      .filter(Boolean)
  }, [paymentForm.amount_kes, paymentTarget])

  const persistAccountRows = useCallback(async (rows) => {
    if (compatMode.accounts) {
      writeLocalRows(localAccountKey(hospitalId), rows)
      return { error: null }
    }
    return supabase.from('credit_accounts').upsert(rows)
  }, [compatMode.accounts, hospitalId])

  const persistPaymentRows = useCallback(async (rows) => {
    if (compatMode.payments) {
      writeLocalRows(localPaymentKey(hospitalId), rows)
      return { error: null }
    }
    return supabase.from('credit_payments').upsert(rows)
  }, [compatMode.payments, hospitalId])

  const persistFollowUpRows = useCallback(async (rows) => {
    if (compatMode.followups) {
      writeLocalRows(localFollowUpKey(hospitalId), rows)
      return { error: null }
    }
    return supabase.from('credit_followups').upsert(rows)
  }, [compatMode.followups, hospitalId])

  const persistWriteOffRows = useCallback(async (rows) => {
    if (compatMode.writeoffs) {
      writeLocalRows(localWriteOffKey(hospitalId), rows)
      return { error: null }
    }
    return supabase.from('credit_writeoffs').upsert(rows)
  }, [compatMode.writeoffs, hospitalId])

  const resetRecordModal = useCallback(() => {
    setEditingRecord(null)
    setRecordForm(EMPTY_RECORD_FORM)
  }, [])

  const openRecordModal = useCallback((record = null) => {
    if (!record) {
      resetRecordModal()
      setShowRecordModal(true)
      return
    }
    const account = accountSummaryMap[getRecordAccountKey(record)]
    setEditingRecord(record)
    setRecordForm({
      type: record.type || 'Debt',
      account_type: record.account_type || 'Individual',
      patient_id: record.patient_id || '',
      credit_account_id: record.credit_account_id || account?.id || '',
      corporate_name: record.account_type === 'Corporate' ? (record.account_name || '') : '',
      insurer_name: record.account_type === 'Insurer' ? (record.account_name || '') : '',
      category: record.category || 'Consultation',
      description: record.description || '',
      amount_charged: String(record.amount_charged || ''),
      amount_paid: String(record.amount_paid || 0),
      payment_method: record.payment_method || 'Cash',
      reference_no: record.mpesa_ref || '',
      due_date: record.due_date ? String(record.due_date).slice(0, 10) : '',
      credit_limit_kes: String(record.credit_limit_kes || account?.credit_limit_kes || ''),
      guarantor_name: record.guarantor_name || account?.guarantor_name || '',
      guarantor_phone: record.guarantor_phone || account?.guarantor_phone || '',
      guarantor_employer: record.guarantor_employer || account?.guarantor_employer || '',
      payment_plan_installment: String(record.payment_plan?.monthly_installment || ''),
      payment_plan_next_date: record.payment_plan?.next_payment_date || '',
      notes: record.notes_text || '',
    })
    setShowRecordModal(true)
  }, [accountSummaryMap, resetRecordModal])

  const openAccountModal = useCallback((account = null) => {
    if (!account) {
      setEditingAccount(null)
      setAccountForm(EMPTY_ACCOUNT_FORM)
      setShowAccountModal(true)
      return
    }
    setEditingAccount(account)
    setAccountForm({
      account_type: account.account_type || 'Individual',
      patient_id: account.patient_id || '',
      account_name: account.account_name || '',
      contact_phone: account.contact_phone || '',
      contact_email: account.contact_email || '',
      employer_name: account.employer_name || account.guarantor_employer || '',
      guarantor_name: account.guarantor_name || '',
      guarantor_phone: account.guarantor_phone || '',
      guarantor_employer: account.guarantor_employer || '',
      credit_limit_kes: String(account.credit_limit_kes || ''),
      notes: account.notes || '',
    })
    setShowAccountModal(true)
  }, [])

  const ensureAccount = useCallback(async (form) => {
    const accountType = form.account_type || 'Individual'
    const selectedPatient = patientLookup[form.patient_id]
    const accountName = accountType === 'Individual'
      ? (selectedPatient?.full_name || '')
      : accountType === 'Corporate'
        ? String(form.corporate_name || form.account_name || '').trim()
        : String(form.insurer_name || form.account_name || '').trim()

    if (!accountName && accountType !== 'Individual') {
      window.notifyFromLegacyAlert(`Enter the ${accountType === 'Corporate' ? 'corporate' : 'insurer'} account name.`)
      return null
    }
    if (accountType === 'Individual' && !form.patient_id) {
      window.notifyFromLegacyAlert('Select a patient account first.')
      return null
    }

    const existing = accountRows.find((account) => {
      if (accountType === 'Individual') return account.patient_id && account.patient_id === form.patient_id
      return account.account_type === accountType && normalizeText(account.account_name) === normalizeText(accountName)
    })

    const payload = normalizeAccountRecord({
      id: existing?.source === 'table' ? existing.id : existing?.id || createUuid(),
      hospital_id: hospitalId,
      account_type: accountType,
      patient_id: accountType === 'Individual' ? form.patient_id || null : null,
      account_name: accountType === 'Individual' ? (selectedPatient?.full_name || accountName || 'Patient Account') : accountName,
      contact_phone: accountType === 'Individual' ? (selectedPatient?.phone || form.contact_phone || form.guarantor_phone || '') : (form.contact_phone || form.guarantor_phone || ''),
      contact_email: form.contact_email || '',
      employer_name: form.employer_name || form.guarantor_employer || '',
      guarantor_name: form.guarantor_name || '',
      guarantor_phone: form.guarantor_phone || '',
      guarantor_employer: form.guarantor_employer || '',
      credit_limit_kes: Number(form.credit_limit_kes || 0),
      notes: form.notes || '',
      active: true,
      updated_at: new Date().toISOString(),
      created_at: existing?.created_at || new Date().toISOString(),
    })

    const nextRows = existing
      ? accountRows.map((row) => (row.key === existing.key ? { ...row, ...payload, source: 'table' } : row)).filter((row) => row.source === 'table' || !row.id)
      : [...accountRows.filter((row) => row.source === 'table' || row.id), { ...payload, source: 'table' }]

    const { error } = await persistAccountRows(nextRows.map((row) => omitKeys(row, ['key', 'source', 'debts', 'credits', 'balance', 'totalInvoiced', 'totalPaid', 'creditBalance', 'utilisation', 'overUtilised', 'latestFollowUp', 'dueToday', 'followupStatus', 'collectedViaReceipts', 'writtenOff'])))
    if (error) {
      window.notifyFromLegacyAlert(`Could not save credit account: ${error.message}`)
      return null
    }
    return payload
  }, [accountRows, hospitalId, patientLookup, persistAccountRows])

  const saveDebtRecord = useCallback(async (payload, recordId = null) => {
    const extraKeys = ['credit_account_id', 'account_type', 'corporate_account_name', 'credit_limit_kes', 'guarantor_name', 'guarantor_phone', 'guarantor_employer', 'payment_plan_json', 'writeoff_reason', 'writeoff_approved_by', 'payer_type']
    const operation = recordId
      ? () => supabase.from('credit_debts').update(payload).eq('id', recordId).select('*, patients(id, full_name, phone, patient_number)').single()
      : () => supabase.from('credit_debts').insert(payload).select('*, patients(id, full_name, phone, patient_number)').single()
    return executeWithFallback(operation, async () => {
      const fallbackPayload = omitKeys(payload, extraKeys)
      return recordId
        ? supabase.from('credit_debts').update(fallbackPayload).eq('id', recordId).select('*, patients(id, full_name, phone, patient_number)').single()
        : supabase.from('credit_debts').insert(fallbackPayload).select('*, patients(id, full_name, phone, patient_number)').single()
    })
  }, [])

  const handleSaveAccount = useCallback(async () => {
    if (accountForm.account_type === 'Individual' && !accountForm.patient_id) {
      window.notifyFromLegacyAlert('Select the patient linked to this individual credit account.')
      return
    }
    if (accountForm.account_type !== 'Individual' && !String(accountForm.account_name || '').trim()) {
      window.notifyFromLegacyAlert('Account name is required.')
      return
    }
    setSaving(true)
    const saved = await ensureAccount(accountForm)
    if (saved) {
      await loadData(false)
      setShowAccountModal(false)
      setEditingAccount(null)
      setAccountForm(EMPTY_ACCOUNT_FORM)
    }
    setSaving(false)
  }, [accountForm, ensureAccount, loadData])

  const handleSaveRecord = useCallback(async () => {
    if (!recordForm.description.trim()) return window.notifyFromLegacyAlert('Enter the credit or debt description.')
    if (!recordForm.amount_charged) return window.notifyFromLegacyAlert('Enter the amount charged.')
    if (recordForm.account_type === 'Individual' && !recordForm.patient_id) return window.notifyFromLegacyAlert('Select a patient account.')
    if (recordForm.account_type !== 'Individual' && !(recordForm.corporate_name || recordForm.insurer_name)) {
      return window.notifyFromLegacyAlert(`Enter the ${recordForm.account_type === 'Corporate' ? 'corporate' : 'insurer'} account name.`)
    }

    setSaving(true)
    const account = await ensureAccount({
      ...recordForm,
      account_name: recordForm.account_type === 'Corporate' ? recordForm.corporate_name : recordForm.insurer_name,
    })
    if (!account) {
      setSaving(false)
      return
    }

    const amountCharged = Number(recordForm.amount_charged || 0)
    const amountPaid = Number(recordForm.amount_paid || 0)
    const balance = Math.max(0, amountCharged - amountPaid)
    const selectedAccount = accountSummaryMap[account.id ? `account:${account.id}` : `${account.account_type}:${normalizeText(account.account_name)}`]
    const projectedBalance = Number(selectedAccount?.balance || 0) + (editingRecord ? 0 : balance)
    if (account.credit_limit_kes > 0 && projectedBalance > account.credit_limit_kes && !isAdmin) {
      window.notifyFromLegacyAlert(`Credit limit would be exceeded: ${formatKES(projectedBalance)} against a limit of ${formatKES(account.credit_limit_kes)}.`)
      setSaving(false)
      return
    }

    const paymentPlan = {
      monthly_installment: Number(recordForm.payment_plan_installment || 0) || null,
      next_payment_date: recordForm.payment_plan_next_date || null,
    }
    const payload = {
      hospital_id: hospitalId,
      patient_id: recordForm.account_type === 'Individual' ? recordForm.patient_id || null : null,
      visit_id: editingRecord?.visit_id || null,
      type: recordForm.type,
      category: recordForm.category,
      description: recordForm.description,
      amount_charged: amountCharged,
      amount_paid: amountPaid,
      balance,
      status: balance <= 0 ? 'Paid' : amountPaid > 0 ? 'Partial' : 'Pending',
      payment_method: amountPaid > 0 ? recordForm.payment_method : null,
      mpesa_ref: recordForm.payment_method === 'M-Pesa' ? (recordForm.reference_no || null) : null,
      due_date: recordForm.due_date || null,
      notes: mergeNotesMeta(recordForm.notes, {
        account_type: account.account_type,
        account_name: account.account_name,
        payer_type: account.account_type,
        credit_limit_kes: account.credit_limit_kes,
        guarantor_name: account.guarantor_name,
        guarantor_phone: account.guarantor_phone,
        guarantor_employer: account.guarantor_employer,
        payment_plan,
      }),
      created_by: editingRecord ? undefined : (localStorage.getItem('nexus_user_name') || 'Staff'),
      paid_at: balance <= 0 && amountPaid > 0 ? new Date().toISOString() : null,
      credit_account_id: account.id || null,
      account_type: account.account_type,
      corporate_account_name: account.account_type === 'Individual' ? null : account.account_name,
      credit_limit_kes: account.credit_limit_kes,
      guarantor_name: account.guarantor_name || null,
      guarantor_phone: account.guarantor_phone || null,
      guarantor_employer: account.guarantor_employer || null,
      payment_plan_json: paymentPlan,
      payer_type: account.account_type,
    }
    if (editingRecord) delete payload.created_by

    const { data, error } = await saveDebtRecord(payload, editingRecord?.id || null)
    if (error) {
      window.notifyFromLegacyAlert(`Error saving credit record: ${error.message}`)
      setSaving(false)
      return
    }

    if (amountPaid > 0) {
      const paymentRow = {
        id: createUuid(),
        hospital_id: hospitalId,
        credit_account_id: account.id || null,
        account_key: account.id ? `account:${account.id}` : `${account.account_type}:${normalizeText(account.account_name)}`,
        credit_debt_id: data.id,
        patient_id: payload.patient_id,
        amount_kes: amountPaid,
        payment_method: recordForm.payment_method,
        reference_no: recordForm.reference_no || null,
        paid_at: payload.paid_at || new Date().toISOString(),
        allocations_json: [{ credit_debt_id: data.id, amount_kes: amountPaid, description: data.description }],
        recorded_by: localStorage.getItem('nexus_user_name') || 'Staff',
        receipt_no: createReceiptNumber(new Date(), data.id),
        notes: recordForm.notes || '',
      }
      const paymentRows = compatMode.payments ? [...payments, paymentRow] : [...payments.filter((row) => row.id !== paymentRow.id), paymentRow]
      const paymentResult = await persistPaymentRows(paymentRows)
      if (paymentResult.error) {
        window.notifyFromLegacyAlert(`Credit record saved, but payment receipt logging failed: ${paymentResult.error.message}`)
      }
      await syncPaymentToBillingInvoice(hospitalId, data, amountPaid, recordForm.payment_method, recordForm.reference_no)
    }

    await logAudit(supabase, {
      hospitalId,
      userRole,
      action: editingRecord ? 'credit_record_updated' : 'credit_record_created',
      targetTable: 'credit_debts',
      targetId: data.id,
      details: {
        account_type: account.account_type,
        account_name: account.account_name,
        amount_charged: amountCharged,
        amount_paid: amountPaid,
        balance,
      },
    })
    broadcastWorkflowChanged({ source: editingRecord ? 'credit-update' : 'credit-create', patient_id: payload.patient_id, balance })
    await loadData(false)
    setShowRecordModal(false)
    resetRecordModal()
    setSaving(false)
  }, [accountSummaryMap, compatMode.payments, editingRecord, ensureAccount, hospitalId, isAdmin, loadData, payments, persistPaymentRows, recordForm, resetRecordModal, saveDebtRecord, userRole])

  const handleRecordPayment = useCallback(async () => {
    if (!paymentTarget) return
    const amount = Number(paymentForm.amount_kes || 0)
    if (!amount || amount <= 0) return window.notifyFromLegacyAlert('Enter the payment amount first.')
    if (amount > Number(paymentTarget.balance || 0)) {
      return window.notifyFromLegacyAlert('This payment is higher than the open balance. Record the extra amount as a separate patient credit instead.')
    }

    setSaving(true)
    const accountKey = paymentTarget.key
    const targetRows = (paymentTarget.debts || [])
      .filter((row) => Number(row.balance || 0) > 0)
      .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())

    let remaining = amount
    const appliedRows = []
    for (const row of targetRows) {
      if (remaining <= 0) break
      const applied = Math.min(Number(row.balance || 0), remaining)
      const nextPaid = Number(row.amount_paid || 0) + applied
      const nextBalance = Math.max(0, Number(row.balance || 0) - applied)
      const nextStatus = nextBalance <= 0 ? 'Paid' : 'Partial'
      const paymentPlan = {
        ...(row.payment_plan || {}),
      }
      const payload = {
        amount_paid: nextPaid,
        balance: nextBalance,
        status: nextStatus,
        payment_method: paymentForm.payment_method,
        mpesa_ref: paymentForm.payment_method === 'M-Pesa' ? (paymentForm.reference_no || null) : row.mpesa_ref,
        paid_at: nextBalance <= 0 ? new Date(paymentForm.paid_at).toISOString() : row.paid_at,
        notes: mergeNotesMeta(row.notes_text, {
          ...(row.notes_meta || {}),
          account_type: row.account_type,
          account_name: row.account_name,
          payer_type: row.payer_type,
          credit_limit_kes: row.credit_limit_kes,
          guarantor_name: row.guarantor_name,
          guarantor_phone: row.guarantor_phone,
          guarantor_employer: row.guarantor_employer,
          payment_plan: paymentPlan,
        }),
      }
      const updateResult = await supabase.from('credit_debts').update(payload).eq('id', row.id)
      if (updateResult.error) {
        window.notifyFromLegacyAlert(`Could not update balance for ${row.description}: ${updateResult.error.message}`)
        setSaving(false)
        return
      }
      await syncPaymentToBillingInvoice(hospitalId, row, applied, paymentForm.payment_method, paymentForm.reference_no)
      appliedRows.push({
        credit_debt_id: row.id,
        patient_id: row.patient_id,
        patient_name: row.patients?.full_name || paymentTarget.account_name,
        description: row.description,
        invoice_no: row.description?.startsWith('Invoice ') ? row.description.replace('Invoice ', '') : '',
        amount_kes: applied,
      })
      remaining -= applied
    }

    const receiptNo = createReceiptNumber(new Date(paymentForm.paid_at), accountKey.replace(/\D/g, '').slice(-6))
    const paymentRow = {
      id: createUuid(),
      hospital_id: hospitalId,
      credit_account_id: paymentTarget.id || null,
      account_key: accountKey,
      patient_id: paymentTarget.patient_id || null,
      amount_kes: amount,
      payment_method: paymentForm.payment_method,
      reference_no: paymentForm.reference_no || null,
      paid_at: new Date(paymentForm.paid_at).toISOString(),
      allocations_json: appliedRows,
      recorded_by: localStorage.getItem('nexus_user_name') || 'Staff',
      receipt_no: receiptNo,
      notes: paymentForm.notes || '',
    }
    const nextPaymentRows = [...payments.filter((row) => row.id !== paymentRow.id), paymentRow]
    const paymentResult = await persistPaymentRows(nextPaymentRows)
    if (paymentResult.error) {
      window.notifyFromLegacyAlert(`Payment applied, but receipt logging failed: ${paymentResult.error.message}`)
    }

    await logAudit(supabase, {
      hospitalId,
      userRole,
      action: 'credit_payment_recorded',
      targetTable: 'credit_accounts',
      targetId: paymentTarget.id || paymentTarget.key,
      details: {
        amount,
        payment_method: paymentForm.payment_method,
        reference_no: paymentForm.reference_no,
        allocations: appliedRows,
      },
    })
    broadcastWorkflowChanged({ source: 'credit-payment', patient_id: paymentTarget.patient_id || null, amount })
    openPrintWindow('Credit Payment Receipt', buildPaymentReceiptHtml({
      hospitalName,
      payment: paymentRow,
      account: paymentTarget,
      allocations: appliedRows,
      patientLookup,
    }))
    await loadData(false)
    setPaymentTarget(null)
    setPaymentForm(EMPTY_PAYMENT_FORM)
    setSaving(false)
  }, [hospitalId, hospitalName, loadData, patientLookup, paymentForm, paymentTarget, payments, persistPaymentRows, userRole])

  const handleSaveFollowUp = useCallback(async () => {
    if (!followUpTarget) return
    if (!followUpForm.contact_made_to.trim()) return window.notifyFromLegacyAlert('Enter the contact person or recipient.')
    setSaving(true)
    const row = {
      id: createUuid(),
      hospital_id: hospitalId,
      credit_account_id: followUpTarget.id || null,
      account_key: followUpTarget.key,
      credit_debt_id: followUpTarget.debts?.[0]?.id || null,
      patient_id: followUpTarget.patient_id || followUpTarget.debts?.[0]?.patient_id || null,
      contact_date: new Date(followUpForm.contact_date).toISOString(),
      contact_made_to: followUpForm.contact_made_to,
      response: followUpForm.response,
      follow_up_status: followUpForm.follow_up_status,
      next_follow_up_date: followUpForm.next_follow_up_date || null,
      created_by: localStorage.getItem('nexus_user_name') || 'Staff',
      notes: followUpForm.notes || '',
    }
    const result = await persistFollowUpRows([row, ...followUps.filter((item) => item.id !== row.id)])
    if (result.error) {
      window.notifyFromLegacyAlert(`Could not save follow-up log: ${result.error.message}`)
      setSaving(false)
      return
    }
    await logAudit(supabase, {
      hospitalId,
      userRole,
      action: 'credit_followup_logged',
      targetTable: 'credit_accounts',
      targetId: followUpTarget.id || followUpTarget.key,
      details: row,
    })
    await loadData(false)
    setFollowUpTarget(null)
    setFollowUpForm(EMPTY_FOLLOWUP_FORM)
    setSaving(false)
  }, [followUpForm, followUpTarget, followUps, hospitalId, loadData, persistFollowUpRows, userRole])

  const handleWriteOff = useCallback(async () => {
    if (!writeOffTarget) return
    if (!isAdmin) return window.notifyFromLegacyAlert('Only Admin users can approve write-offs.')
    const amount = Number(writeOffForm.amount_kes || 0)
    if (!amount || amount <= 0) return window.notifyFromLegacyAlert('Enter the amount to write off.')
    if (amount > Number(writeOffTarget.balance || 0)) return window.notifyFromLegacyAlert('Write-off amount cannot exceed the current balance.')
    if (!writeOffForm.reason.trim()) return window.notifyFromLegacyAlert('Enter the write-off reason.')
    if (!writeOffForm.approved_by.trim()) return window.notifyFromLegacyAlert('Enter the approving officer name.')
    if (!await window.openConfirmDialog(`Write off ${formatKES(amount)} from ${writeOffTarget.patients?.full_name || writeOffTarget.account_name}?`)) return

    setSaving(true)
    const nextBalance = Math.max(0, Number(writeOffTarget.balance || 0) - amount)
    const nextStatus = nextBalance <= 0 ? 'Waived' : 'Partial'
    const paymentPlan = {
      monthly_installment: Number(writeOffForm.remainder_installment || 0) || null,
      next_payment_date: writeOffForm.remainder_next_date || null,
    }
    const patch = {
      balance: nextBalance,
      status: nextStatus,
      writeoff_reason: writeOffForm.reason,
      writeoff_approved_by: writeOffForm.approved_by,
      notes: mergeNotesMeta(writeOffTarget.notes_text, {
        ...(writeOffTarget.notes_meta || {}),
        account_type: writeOffTarget.account_type,
        account_name: writeOffTarget.account_name,
        payer_type: writeOffTarget.payer_type,
        credit_limit_kes: writeOffTarget.credit_limit_kes,
        guarantor_name: writeOffTarget.guarantor_name,
        guarantor_phone: writeOffTarget.guarantor_phone,
        guarantor_employer: writeOffTarget.guarantor_employer,
        payment_plan,
        writeoff_reason: writeOffForm.reason,
      }),
      payment_plan_json: paymentPlan,
      paid_at: nextBalance <= 0 ? new Date().toISOString() : writeOffTarget.paid_at,
    }
    const updateResult = await executeWithFallback(
      () => supabase.from('credit_debts').update(patch).eq('id', writeOffTarget.id),
      async () => supabase.from('credit_debts').update(omitKeys(patch, ['writeoff_reason', 'writeoff_approved_by', 'payment_plan_json'])).eq('id', writeOffTarget.id),
    )
    if (updateResult.error) {
      window.notifyFromLegacyAlert(`Could not apply write-off: ${updateResult.error.message}`)
      setSaving(false)
      return
    }
    const row = {
      id: createUuid(),
      hospital_id: hospitalId,
      credit_account_id: writeOffTarget.credit_account_id || writeOffTarget.credit_account_id || null,
      account_key: getRecordAccountKey(writeOffTarget),
      credit_debt_id: writeOffTarget.id,
      patient_id: writeOffTarget.patient_id || null,
      amount_kes: amount,
      reason: writeOffForm.reason,
      approved_by: writeOffForm.approved_by,
      remainder_payment_plan_json: paymentPlan,
      written_off_at: new Date().toISOString(),
      notes: writeOffForm.notes || '',
    }
    const result = await persistWriteOffRows([row, ...writeOffs.filter((item) => item.id !== row.id)])
    if (result.error) {
      window.notifyFromLegacyAlert(`Debt updated, but write-off register failed: ${result.error.message}`)
    }
    await logAudit(supabase, {
      hospitalId,
      userRole,
      action: 'credit_writeoff_recorded',
      targetTable: 'credit_debts',
      targetId: writeOffTarget.id,
      details: row,
    })
    broadcastWorkflowChanged({ source: 'credit-writeoff', patient_id: writeOffTarget.patient_id || null, amount })
    await loadData(false)
    setWriteOffTarget(null)
    setWriteOffForm(EMPTY_WRITEOFF_FORM)
    setSaving(false)
  }, [hospitalId, isAdmin, loadData, persistWriteOffRows, userRole, writeOffForm, writeOffTarget, writeOffs])

  const exportAgingToExcel = useCallback(async () => {
    await exportWorkbook(`credit_aging_${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        name: 'Aging Summary',
        rows: agingSummary.map((row) => ({
          bucket: row.label,
          total_kes: row.value,
        })),
      },
      {
        name: 'Aging Detail',
        rows: agingRows.map((row) => ({
          patient: row.patient_name,
          phone: row.phone,
          payer_type: row.payer_type,
          current_0_30: row.current,
          days_31_60: row.d31,
          days_61_90: row.d61,
          days_90_plus: row.d91,
          total_balance: row.total,
        })),
      },
    ])
  }, [agingRows, agingSummary])

  const printCorporateStatement = useCallback((account, month) => {
    const rows = (account.debts || []).filter((row) => monthKey(row.created_at) === month)
    openPrintWindow('Corporate Credit Statement', buildCorporateStatementHtml({
      hospitalName,
      account,
      rows,
      month: monthLabel(`${month}-01`),
    }))
  }, [hospitalName])

  const openPaymentModal = useCallback((account) => {
    setPaymentTarget(account)
    setPaymentForm({
      ...EMPTY_PAYMENT_FORM,
      amount_kes: String(account.balance || ''),
    })
  }, [])

  const handleSendReminder = useCallback((account) => {
    const message = `Dear ${account.account_name}, this is a reminder from ${hospitalName || 'our hospital'} that your outstanding balance is ${formatKES(account.balance)}. Please contact the accounts team to settle or confirm your payment plan.`
    if (!openWhatsAppMessage(account.contact_phone || account.guarantor_phone, message)) {
      window.notifyFromLegacyAlert('No valid phone number is available for this WhatsApp reminder.')
    }
  }, [hospitalName])

  const markAsPaid = useCallback(async (record) => {
    if (!await window.openConfirmDialog(`Mark ${record.description} as fully paid?`)) return
    setSaving(true)
    const amountCharged = Number(record.amount_charged || 0)
    const payload = {
      amount_paid: amountCharged,
      balance: 0,
      status: 'Paid',
      paid_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('credit_debts').update(payload).eq('id', record.id)
    if (error) {
      window.notifyFromLegacyAlert(`Could not update the record: ${error.message}`)
      setSaving(false)
      return
    }
    await syncPaymentToBillingInvoice(hospitalId, record, Number(record.balance || 0), record.payment_method, record.mpesa_ref)
    await loadData(false)
    setSaving(false)
  }, [hospitalId, loadData])

  if (loading) {
    return (
      <div style={styles.loadingWrap}>
        <div style={{ width: 260 }}>
          <SkeletonLoader rows={4} height={14} width={['55%', '100%', '82%', '66%']} />
        </div>
        <p style={{ color: C.primary, marginTop: 12 }}>Loading credit and debt management...</p>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Credit & Debt Management</h1>
          <div style={styles.subtitle}>
            Open exposure {formatKES(openExposure)} across {accountSummaries.filter((account) => account.balance > 0).length} active account(s)
          </div>
        </div>
        <div style={styles.headerActions}>
          <button style={styles.ghostBtn} onClick={exportAgingToExcel}>Export Aging</button>
          <button style={styles.ghostBtn} onClick={() => openAccountModal()}>New Account</button>
          <button style={styles.primaryBtn} onClick={() => openRecordModal()}>Add Credit Record</button>
        </div>
      </div>

      {(compatMode.accounts || compatMode.payments || compatMode.followups || compatMode.writeoffs) ? (
        <div style={styles.notice}>
          Some advanced credit workflow tables are still in compatibility mode. Apply the latest migration to move accounts, payment receipts, follow-up logs, and write-offs into shared Supabase storage.
        </div>
      ) : null}

      <div style={styles.metricsGrid}>
        <MetricCard title="Total Credit Exposure" value={formatKES(openExposure)} hint={`${openDebtRows.length} open debt line(s)`} accent={C.danger} background="#FEF2F2" />
        <MetricCard title="Accounts >80% Utilisation" value={accountSummaries.filter((account) => account.overUtilised).length} hint="Review limits before more billing" accent="#C2410C" background="#FFF7ED" />
        <MetricCard title="Follow-up Due Today" value={dueForFollowUpToday.length} hint="Accounts requiring action now" accent="#1D4ED8" background="#EFF6FF" />
        <MetricCard title="Bad Debt Rate" value={`${badDebtRate}%`} hint={`Collection efficiency ${collectionEfficiency}% in 60 days`} accent="#0F766E" background="#ECFDF5" />
      </div>

      <div style={styles.tabRow}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            style={{ ...styles.tab, ...(activeTab === tab.key ? styles.tabActive : {}) }}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={styles.toolbar}>
        <input
          style={{ ...styles.input, flex: 1 }}
          placeholder="Search account, patient, guarantor, or description..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select style={styles.inputCompact} value={accountTypeFilter} onChange={(event) => setAccountTypeFilter(event.target.value)}>
          <option value="all">All Payer Types</option>
          {ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select style={styles.inputCompact} value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
          <option value="all">All Dates</option>
          <option value="today">Today</option>
          <option value="month">This Month</option>
        </select>
      </div>

      <div style={styles.body}>
        {activeTab === 'overview' && (
          <div style={styles.stack}>
            <div style={styles.splitTwo}>
              <SectionCard title="Top Debtors" subtitle="Highest outstanding balances across accounts">
                {topDebtors.length === 0 ? <div style={styles.emptyState}>No open debtor accounts right now.</div> : topDebtors.map((account) => (
                  <div key={account.key} style={styles.listRow}>
                    <div>
                      <div style={styles.listTitle}>
                        {account.account_name}
                        {account.overUtilised ? <span style={styles.warningText}> Utilisation {account.utilisation}%</span> : null}
                      </div>
                      <div style={styles.listMeta}>
                        {account.account_type} | {account.contact_phone || 'No phone'} | Credit limit {account.credit_limit_kes > 0 ? formatKES(account.credit_limit_kes) : 'Not set'}
                      </div>
                    </div>
                    <div style={styles.listActions}>
                      <div style={{ fontWeight: 800, color: C.danger }}>{formatKES(account.balance)}</div>
                      <button style={styles.lightBtn} onClick={() => setDetailTarget(account)}>Open</button>
                    </div>
                  </div>
                ))}
              </SectionCard>

              <SectionCard title="Accounts Due for Follow-up" subtitle="Reminder scheduler for the accounts team">
                {dueForFollowUpToday.length === 0 ? <div style={styles.emptyState}>No accounts are due for follow-up today.</div> : dueForFollowUpToday.map((account) => (
                  <div key={account.key} style={styles.listRow}>
                    <div>
                      <div style={styles.listTitle}>{account.account_name}</div>
                      <div style={styles.listMeta}>
                        {account.latestFollowUp?.follow_up_status || 'No Contact'} | Next {formatDate(account.latestFollowUp?.next_follow_up_date)}
                      </div>
                    </div>
                    <div style={styles.listActions}>
                      <button style={styles.lightBtn} onClick={() => { setFollowUpTarget(account); setFollowUpForm(EMPTY_FOLLOWUP_FORM) }}>Log Follow-up</button>
                      <button style={styles.ghostBtnSmall} onClick={() => handleSendReminder(account)}>WhatsApp</button>
                    </div>
                  </div>
                ))}
              </SectionCard>
            </div>

            <SectionCard title="Aging Snapshot" subtitle="Standard current / 31-60 / 61-90 / >90 day buckets">
              <div style={styles.metricsGrid}>
                {agingSummary.map((row) => (
                  <MetricCard
                    key={row.label}
                    title={row.label}
                    value={formatKES(row.value)}
                    hint={`${openDebtRows.filter((item) => getAgingBucket(item.days_outstanding) === row.label).length} account line(s)`}
                    accent={row.colors.color}
                    background={row.colors.bg}
                  />
                ))}
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === 'accounts' && (
          <SectionCard title="Credit Account Management" subtitle="Limits, balances, guarantors, and utilisation">
            {filteredAccounts.length === 0 ? <div style={styles.emptyState}>No credit accounts match the current filters.</div> : (
              <div style={styles.accountGrid}>
                {filteredAccounts.map((account) => {
                  const utilisationColor = account.utilisation >= 100 ? C.danger : account.utilisation >= 80 ? '#C2410C' : C.primary
                  return (
                    <div key={account.key} style={styles.accountCard}>
                      <div style={styles.accountTop}>
                        <div>
                          <div style={styles.accountName}>{account.account_name}</div>
                          <div style={styles.accountMeta}>{account.account_type} | {account.contact_phone || 'No phone on file'}</div>
                        </div>
                        <StatusBadge status={account.followupStatus} />
                      </div>
                      <div style={styles.accountMetrics}>
                        <div>
                          <div style={styles.smallLabel}>Outstanding</div>
                          <div style={{ ...styles.bigFigure, color: C.danger }}>{formatKES(account.balance)}</div>
                        </div>
                        <div>
                          <div style={styles.smallLabel}>Credit Limit</div>
                          <div style={styles.mediumFigure}>{account.credit_limit_kes > 0 ? formatKES(account.credit_limit_kes) : 'Not set'}</div>
                        </div>
                        <div>
                          <div style={styles.smallLabel}>Utilisation</div>
                          <div style={{ ...styles.mediumFigure, color: utilisationColor }}>{account.credit_limit_kes > 0 ? `${account.utilisation}%` : '-'}</div>
                        </div>
                      </div>
                      <div style={styles.progressTrack}>
                        <div style={{ ...styles.progressFill, width: `${Math.min(100, Math.max(0, account.utilisation))}%`, background: utilisationColor }} />
                      </div>
                      <div style={styles.accountFooter}>
                        <div style={styles.smallMuted}>
                          Guarantor: {account.guarantor_name || 'Not captured'}{account.guarantor_employer ? ` | ${account.guarantor_employer}` : ''}
                        </div>
                        <div style={styles.inlineActions}>
                          <button style={styles.lightBtn} onClick={() => setDetailTarget(account)}>Open</button>
                          <button style={styles.lightBtn} onClick={() => openPaymentModal(account)} disabled={account.balance <= 0}>Receive Payment</button>
                          <button style={styles.ghostBtnSmall} onClick={() => handleSendReminder(account)}>WhatsApp</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        )}

        {activeTab === 'aging' && (
          <div style={styles.stack}>
            <SectionCard title="Aging Buckets" subtitle="Color-coded receivables aging report" actions={<button style={styles.ghostBtnSmall} onClick={exportAgingToExcel}>Export Excel</button>}>
              <div style={styles.metricsGrid}>
                {agingSummary.map((row) => (
                  <MetricCard key={row.label} title={row.label} value={formatKES(row.value)} accent={row.colors.color} background={row.colors.bg} />
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Per-Patient Aging Detail" subtitle="Open balances grouped by patient or account">
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Patient / Account</th>
                    <th style={styles.th}>Phone</th>
                    <th style={styles.th}>Current</th>
                    <th style={styles.th}>31-60</th>
                    <th style={styles.th}>61-90</th>
                    <th style={styles.th}>&gt;90</th>
                    <th style={styles.th}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {agingRows.map((row) => (
                    <tr key={row.key} style={styles.rowBorder}>
                      <td style={styles.td}><strong>{row.patient_name}</strong><div style={styles.tinyMuted}>{row.payer_type}</div></td>
                      <td style={styles.td}>{row.phone || '-'}</td>
                      <td style={styles.td}>{row.current > 0 ? <span style={{ color: '#15803D', fontWeight: 700 }}>{formatKES(row.current)}</span> : '-'}</td>
                      <td style={styles.td}>{row.d31 > 0 ? <span style={{ color: '#B45309', fontWeight: 700 }}>{formatKES(row.d31)}</span> : '-'}</td>
                      <td style={styles.td}>{row.d61 > 0 ? <span style={{ color: '#C2410C', fontWeight: 700 }}>{formatKES(row.d61)}</span> : '-'}</td>
                      <td style={styles.td}>{row.d91 > 0 ? <span style={{ color: '#B91C1C', fontWeight: 800 }}>{formatKES(row.d91)}</span> : '-'}</td>
                      <td style={styles.td}><strong style={{ color: C.danger }}>{formatKES(row.total)}</strong></td>
                    </tr>
                  ))}
                  {agingRows.length === 0 ? <tr><td style={styles.emptyCell} colSpan={7}>No aging rows yet.</td></tr> : null}
                </tbody>
              </table>
            </SectionCard>
          </div>
        )}

        {activeTab === 'followups' && (
          <div style={styles.stack}>
            <SectionCard title="Follow-up Due Today" subtitle="Accounts team action list">
              {dueForFollowUpToday.length === 0 ? <div style={styles.emptyState}>No follow-up reminders for today.</div> : dueForFollowUpToday.map((account) => (
                <div key={account.key} style={styles.listRow}>
                  <div>
                    <div style={styles.listTitle}>{account.account_name}</div>
                    <div style={styles.listMeta}>
                      Status: {account.latestFollowUp?.follow_up_status || 'No Contact'} | Next follow-up {formatDate(account.latestFollowUp?.next_follow_up_date)}
                    </div>
                  </div>
                  <div style={styles.inlineActions}>
                    <button style={styles.lightBtn} onClick={() => { setFollowUpTarget(account); setFollowUpForm(EMPTY_FOLLOWUP_FORM) }}>Log Contact</button>
                    <button style={styles.ghostBtnSmall} onClick={() => handleSendReminder(account)}>WhatsApp</button>
                  </div>
                </div>
              ))}
            </SectionCard>

            <SectionCard title="Follow-up Log" subtitle="Contact history and next action date">
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Account</th>
                    <th style={styles.th}>Contact Made</th>
                    <th style={styles.th}>Response</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Next Follow-up</th>
                  </tr>
                </thead>
                <tbody>
                  {followUps.map((row) => (
                    <tr key={row.id} style={styles.rowBorder}>
                      <td style={styles.td}>{formatDateTime(row.contact_date)}</td>
                      <td style={styles.td}>{accountSummaryMap[row.credit_account_id ? `account:${row.credit_account_id}` : row.account_key]?.account_name || 'Account'}</td>
                      <td style={styles.td}>{row.contact_made_to}</td>
                      <td style={styles.td}>{row.response || '-'}</td>
                      <td style={styles.td}><StatusBadge status={row.follow_up_status} /></td>
                      <td style={styles.td}>{row.next_follow_up_date ? formatDate(row.next_follow_up_date) : '-'}</td>
                    </tr>
                  ))}
                  {followUps.length === 0 ? <tr><td style={styles.emptyCell} colSpan={6}>No follow-up entries recorded yet.</td></tr> : null}
                </tbody>
              </table>
            </SectionCard>
          </div>
        )}

        {activeTab === 'corporate' && (
          <div style={styles.stack}>
            <SectionCard title="Corporate Accounts" subtitle="Employer-led debtors and monthly statements">
              {corporateAccounts.length === 0 ? <div style={styles.emptyState}>No corporate credit accounts captured yet.</div> : corporateAccounts.map((account) => (
                <div key={account.key} style={styles.corporateCard}>
                  <div>
                    <div style={styles.listTitle}>{account.account_name}</div>
                    <div style={styles.listMeta}>
                      Credit limit {account.credit_limit_kes > 0 ? formatKES(account.credit_limit_kes) : 'Not set'} | Outstanding {formatKES(account.balance)}
                    </div>
                  </div>
                  <div style={styles.inlineActions}>
                    <select style={styles.inputCompact} defaultValue={corporateMonthOptions[0] || ''} onChange={(event) => { if (event.target.value) printCorporateStatement(account, event.target.value) }}>
                      <option value="">Print monthly statement...</option>
                      {corporateMonthOptions.map((month) => <option key={month} value={month}>{monthLabel(`${month}-01`)}</option>)}
                    </select>
                    <button style={styles.lightBtn} onClick={() => setDetailTarget(account)}>Open Account</button>
                  </div>
                </div>
              ))}
            </SectionCard>
          </div>
        )}

        {activeTab === 'writeoffs' && (
          <div style={styles.stack}>
            <SectionCard title="Write-off Report" subtitle="Bad debt register, reasons, and recovery watch">
              <div style={styles.metricsGrid}>
                <MetricCard title="Written Off This Month" value={formatKES(writeOffs.filter((row) => monthKey(row.written_off_at) === monthKey()).reduce((sum, row) => sum + Number(row.amount_kes || 0), 0))} accent={C.danger} background="#FEF2F2" />
                <MetricCard title="Year-to-Date Write-offs" value={formatKES(totalWriteOffs)} accent="#C2410C" background="#FFF7ED" />
                <MetricCard title="Recovery Rate" value={`${Math.max(0, 100 - badDebtRate).toFixed(1)}%`} hint="Credit revenue not lost to write-off" accent="#0F766E" background="#ECFDF5" />
              </div>
            </SectionCard>

            <SectionCard title="Write-off Detail" subtitle="Full and partial debt write-offs">
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Account</th>
                    <th style={styles.th}>Amount</th>
                    <th style={styles.th}>Reason</th>
                    <th style={styles.th}>Approved By</th>
                    <th style={styles.th}>Remainder Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {writeOffs.map((row) => {
                    const remainder = row.remainder_payment_plan_json || {}
                    return (
                      <tr key={row.id} style={styles.rowBorder}>
                        <td style={styles.td}>{formatDate(row.written_off_at)}</td>
                        <td style={styles.td}>{accountSummaryMap[row.credit_account_id ? `account:${row.credit_account_id}` : row.account_key]?.account_name || 'Account'}</td>
                        <td style={styles.td}><strong style={{ color: C.danger }}>{formatKES(row.amount_kes)}</strong></td>
                        <td style={styles.td}>{row.reason || '-'}</td>
                        <td style={styles.td}>{row.approved_by || '-'}</td>
                        <td style={styles.td}>{remainder?.monthly_installment ? `${formatKES(remainder.monthly_installment)} monthly from ${formatDate(remainder.next_payment_date)}` : '-'}</td>
                      </tr>
                    )
                  })}
                  {writeOffs.length === 0 ? <tr><td style={styles.emptyCell} colSpan={6}>No write-offs recorded yet.</td></tr> : null}
                </tbody>
              </table>
            </SectionCard>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div style={styles.stack}>
            <div style={styles.splitTwo}>
              <SectionCard title="Exposure by Payer Type" subtitle="Individual vs corporate vs insurer">
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={exposureByPayerType} dataKey="value" nameKey="name" outerRadius={92} innerRadius={54}>
                        {exposureByPayerType.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                      </Pie>
                      <RechartsTooltip formatter={(value) => formatKES(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              <SectionCard title="Debt Performance" subtitle="Collection speed and bad debt posture">
                <div style={styles.metricStack}>
                  <MetricCard title="Collected in 60 Days" value={`${collectionEfficiency}%`} hint="Collection efficiency benchmark" accent="#0F766E" background="#ECFDF5" />
                  <MetricCard title="Bad Debt Rate" value={`${badDebtRate}%`} hint="Write-offs as a share of credit revenue" accent={C.danger} background="#FEF2F2" />
                </div>
              </SectionCard>
            </div>

            <SectionCard title="Month-on-Month Credit Trend" subtitle="Invoiced, collected, and written off">
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                  <LineChart data={paymentTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(value) => `${Math.round(Number(value || 0) / 1000)}k`} tick={{ fontSize: 11 }} />
                    <RechartsTooltip formatter={(value) => formatKES(value)} />
                    <Line type="monotone" dataKey="invoiced" stroke="#5B21B6" strokeWidth={3} dot={false} name="Invoiced" />
                    <Line type="monotone" dataKey="collected" stroke="#1D4ED8" strokeWidth={3} dot={false} name="Collected" />
                    <Line type="monotone" dataKey="writtenOff" stroke="#D32F2F" strokeWidth={3} dot={false} name="Written Off" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === 'ledger' && (
          <SectionCard title="Credit Ledger" subtitle="All debt and credit transactions">
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Account</th>
                  <th style={styles.th}>Patient</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Description</th>
                  <th style={styles.th}>Charged</th>
                  <th style={styles.th}>Paid</th>
                  <th style={styles.th}>Balance</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLedger.map((row) => (
                  <tr key={row.id} style={styles.rowBorder}>
                    <td style={styles.td}>{formatDate(row.created_at)}</td>
                    <td style={styles.td}>{row.account_name}</td>
                    <td style={styles.td}>{row.patients?.full_name || '-'}</td>
                    <td style={styles.td}>{row.type}</td>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 600 }}>{row.description}</div>
                      <div style={styles.tinyMuted}>{row.category} | {row.payment_method || 'No receipt yet'}</div>
                    </td>
                    <td style={styles.td}>{formatKES(row.amount_charged)}</td>
                    <td style={styles.td}>{formatKES(row.amount_paid)}</td>
                    <td style={styles.td}><strong style={{ color: row.type === 'Debt' ? C.danger : C.primary }}>{formatKES(row.balance)}</strong></td>
                    <td style={styles.td}><StatusBadge status={row.status} /></td>
                    <td style={styles.td}>
                      <div style={styles.inlineActions}>
                        <button style={styles.lightBtn} onClick={() => openRecordModal(row)}>Edit</button>
                        {row.type === 'Debt' && Number(row.balance || 0) > 0 ? <button style={styles.lightBtn} onClick={() => openPaymentModal(accountSummaryMap[getRecordAccountKey(row)] || { ...row, debts: [row], account_name: row.account_name, key: getRecordAccountKey(row) })}>Pay</button> : null}
                        {row.type === 'Debt' && row.status !== 'Waived' && Number(row.balance || 0) > 0 && isAdmin ? <button style={styles.dangerGhostBtn} onClick={() => { setWriteOffTarget(row); setWriteOffForm({ ...EMPTY_WRITEOFF_FORM, amount_kes: String(row.balance || '') }) }}>Write Off</button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredLedger.length === 0 ? <tr><td style={styles.emptyCell} colSpan={10}>No credit ledger rows match the current filters.</td></tr> : null}
              </tbody>
            </table>
          </SectionCard>
        )}
      </div>

      {showRecordModal ? (
        <ModalShell
          title={editingRecord ? 'Edit Credit Record' : 'New Credit / Debt Record'}
          subtitle="Capture debtor, credit limit, guarantor, and payment plan details."
          onClose={() => { setShowRecordModal(false); resetRecordModal() }}
          footer={(
            <>
              <button style={styles.cancelBtn} onClick={() => { setShowRecordModal(false); resetRecordModal() }}>Cancel</button>
              <button style={styles.submitBtn} onClick={handleSaveRecord} disabled={saving}>{saving ? 'Saving...' : editingRecord ? 'Save Changes' : 'Create Record'}</button>
            </>
          )}
        >
          <div style={styles.formGridThree}>
            <div style={styles.fieldWide}>
              <label style={styles.label}>Record Type</label>
              <div style={styles.segmentRow}>
                {RECORD_TYPES.map((type) => (
                  <button
                    key={type}
                    style={{ ...styles.segmentBtn, ...(recordForm.type === type ? styles.segmentBtnActive : {}) }}
                    onClick={() => setRecordForm((current) => ({ ...current, type }))}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={styles.label}>Account Type</label>
              <select style={styles.input} value={recordForm.account_type} onChange={(event) => setRecordForm((current) => ({ ...current, account_type: event.target.value, patient_id: '', credit_account_id: '', corporate_name: '', insurer_name: '' }))}>
                {ACCOUNT_TYPES.map((type) => <option key={type}>{type}</option>)}
              </select>
            </div>
            <div>
              <label style={styles.label}>Category</label>
              <select style={styles.input} value={recordForm.category} onChange={(event) => setRecordForm((current) => ({ ...current, category: event.target.value }))}>
                {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
              </select>
            </div>

            {recordForm.account_type === 'Individual' ? (
              <div className="fieldWide" style={styles.fieldWide}>
                <label style={styles.label}>Patient Account</label>
                <select style={styles.input} value={recordForm.patient_id} onChange={(event) => setRecordForm((current) => ({ ...current, patient_id: event.target.value }))}>
                  <option value="">Select patient</option>
                  {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.full_name} {patient.patient_number ? `(${patient.patient_number})` : ''}</option>)}
                </select>
              </div>
            ) : (
              <div style={styles.fieldWide}>
                <label style={styles.label}>{recordForm.account_type === 'Corporate' ? 'Corporate Account Name' : 'Insurer Account Name'}</label>
                <input
                  style={styles.input}
                  value={recordForm.account_type === 'Corporate' ? recordForm.corporate_name : recordForm.insurer_name}
                  onChange={(event) => setRecordForm((current) => current.account_type === 'Corporate'
                    ? { ...current, corporate_name: event.target.value }
                    : { ...current, insurer_name: event.target.value })}
                  placeholder={recordForm.account_type === 'Corporate' ? 'Employer / corporate client' : 'Insurer or payer'}
                />
              </div>
            )}

            <div style={styles.fieldWide}>
              <label style={styles.label}>Description</label>
              <input style={styles.input} value={recordForm.description} onChange={(event) => setRecordForm((current) => ({ ...current, description: event.target.value }))} placeholder="Invoice 2026-000123, inpatient package, unpaid tests..." />
            </div>

            <div>
              <label style={styles.label}>Amount Charged (KES)</label>
              <input style={styles.input} type="number" value={recordForm.amount_charged} onChange={(event) => setRecordForm((current) => ({ ...current, amount_charged: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Amount Paid Now (KES)</label>
              <input style={styles.input} type="number" value={recordForm.amount_paid} onChange={(event) => setRecordForm((current) => ({ ...current, amount_paid: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Due Date</label>
              <input style={styles.input} type="date" value={recordForm.due_date} onChange={(event) => setRecordForm((current) => ({ ...current, due_date: event.target.value }))} />
            </div>

            <div>
              <label style={styles.label}>Credit Limit (KES)</label>
              <input style={styles.input} type="number" value={recordForm.credit_limit_kes} onChange={(event) => setRecordForm((current) => ({ ...current, credit_limit_kes: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Guarantor Name</label>
              <input style={styles.input} value={recordForm.guarantor_name} onChange={(event) => setRecordForm((current) => ({ ...current, guarantor_name: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Guarantor Phone</label>
              <input style={styles.input} value={recordForm.guarantor_phone} onChange={(event) => setRecordForm((current) => ({ ...current, guarantor_phone: event.target.value }))} />
            </div>

            <div>
              <label style={styles.label}>Guarantor Employer / Next of Kin</label>
              <input style={styles.input} value={recordForm.guarantor_employer} onChange={(event) => setRecordForm((current) => ({ ...current, guarantor_employer: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Payment Method</label>
              <select style={styles.input} value={recordForm.payment_method} onChange={(event) => setRecordForm((current) => ({ ...current, payment_method: event.target.value }))}>
                {PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}
              </select>
            </div>
            <div>
              <label style={styles.label}>Reference / M-Pesa Ref</label>
              <input style={styles.input} value={recordForm.reference_no} onChange={(event) => setRecordForm((current) => ({ ...current, reference_no: event.target.value }))} />
            </div>

            <div>
              <label style={styles.label}>Payment Plan Installment</label>
              <input style={styles.input} type="number" value={recordForm.payment_plan_installment} onChange={(event) => setRecordForm((current) => ({ ...current, payment_plan_installment: event.target.value }))} placeholder="Monthly installment" />
            </div>
            <div>
              <label style={styles.label}>Next Payment Date</label>
              <input style={styles.input} type="date" value={recordForm.payment_plan_next_date} onChange={(event) => setRecordForm((current) => ({ ...current, payment_plan_next_date: event.target.value }))} />
            </div>
            <div style={styles.fieldWide}>
              <label style={styles.label}>Notes</label>
              <textarea style={{ ...styles.input, minHeight: 90, resize: 'vertical' }} value={recordForm.notes} onChange={(event) => setRecordForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>
          </div>
        </ModalShell>
      ) : null}

      {showAccountModal ? (
        <ModalShell
          title={editingAccount ? 'Edit Credit Account' : 'Create Credit Account'}
          subtitle="Use this for individual patients, corporate employers, or insurer debtors."
          onClose={() => { setShowAccountModal(false); setEditingAccount(null); setAccountForm(EMPTY_ACCOUNT_FORM) }}
          footer={(
            <>
              <button style={styles.cancelBtn} onClick={() => { setShowAccountModal(false); setEditingAccount(null); setAccountForm(EMPTY_ACCOUNT_FORM) }}>Cancel</button>
              <button style={styles.submitBtn} onClick={handleSaveAccount} disabled={saving}>{saving ? 'Saving...' : editingAccount ? 'Save Account' : 'Create Account'}</button>
            </>
          )}
        >
          <div style={styles.formGridThree}>
            <div>
              <label style={styles.label}>Account Type</label>
              <select style={styles.input} value={accountForm.account_type} onChange={(event) => setAccountForm((current) => ({ ...current, account_type: event.target.value, patient_id: '' }))}>
                {ACCOUNT_TYPES.map((type) => <option key={type}>{type}</option>)}
              </select>
            </div>
            {accountForm.account_type === 'Individual' ? (
              <div style={styles.fieldWide}>
                <label style={styles.label}>Patient</label>
                <select style={styles.input} value={accountForm.patient_id} onChange={(event) => setAccountForm((current) => ({ ...current, patient_id: event.target.value }))}>
                  <option value="">Select patient</option>
                  {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.full_name} {patient.patient_number ? `(${patient.patient_number})` : ''}</option>)}
                </select>
              </div>
            ) : (
              <div style={styles.fieldWide}>
                <label style={styles.label}>Account Name</label>
                <input style={styles.input} value={accountForm.account_name} onChange={(event) => setAccountForm((current) => ({ ...current, account_name: event.target.value }))} placeholder={accountForm.account_type === 'Corporate' ? 'Corporate client / employer' : 'Insurer / payer'} />
              </div>
            )}
            <div>
              <label style={styles.label}>Contact Phone</label>
              <input style={styles.input} value={accountForm.contact_phone} onChange={(event) => setAccountForm((current) => ({ ...current, contact_phone: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Contact Email</label>
              <input style={styles.input} value={accountForm.contact_email} onChange={(event) => setAccountForm((current) => ({ ...current, contact_email: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Credit Limit (KES)</label>
              <input style={styles.input} type="number" value={accountForm.credit_limit_kes} onChange={(event) => setAccountForm((current) => ({ ...current, credit_limit_kes: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Employer / Organisation</label>
              <input style={styles.input} value={accountForm.employer_name} onChange={(event) => setAccountForm((current) => ({ ...current, employer_name: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Guarantor Name</label>
              <input style={styles.input} value={accountForm.guarantor_name} onChange={(event) => setAccountForm((current) => ({ ...current, guarantor_name: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Guarantor Phone</label>
              <input style={styles.input} value={accountForm.guarantor_phone} onChange={(event) => setAccountForm((current) => ({ ...current, guarantor_phone: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Guarantor Employer</label>
              <input style={styles.input} value={accountForm.guarantor_employer} onChange={(event) => setAccountForm((current) => ({ ...current, guarantor_employer: event.target.value }))} />
            </div>
            <div style={styles.fieldWide}>
              <label style={styles.label}>Notes</label>
              <textarea style={{ ...styles.input, minHeight: 90, resize: 'vertical' }} value={accountForm.notes} onChange={(event) => setAccountForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>
          </div>
        </ModalShell>
      ) : null}

      {paymentTarget ? (
        <ModalShell
          title="Record Credit Payment"
          subtitle={`${paymentTarget.account_name} | Open balance ${formatKES(paymentTarget.balance)}`}
          onClose={() => { setPaymentTarget(null); setPaymentForm(EMPTY_PAYMENT_FORM) }}
          maxWidth={880}
          footer={(
            <>
              <button style={styles.cancelBtn} onClick={() => { setPaymentTarget(null); setPaymentForm(EMPTY_PAYMENT_FORM) }}>Cancel</button>
              <button style={styles.submitBtn} onClick={handleRecordPayment} disabled={saving}>{saving ? 'Posting...' : 'Record Payment & Print Receipt'}</button>
            </>
          )}
        >
          <div style={styles.splitTwo}>
            <div style={styles.stack}>
              <div>
                <label style={styles.label}>Amount Paying Now (KES)</label>
                <input style={styles.input} type="number" value={paymentForm.amount_kes} onChange={(event) => setPaymentForm((current) => ({ ...current, amount_kes: event.target.value }))} />
              </div>
              <div>
                <label style={styles.label}>Payment Method</label>
                <select style={styles.input} value={paymentForm.payment_method} onChange={(event) => setPaymentForm((current) => ({ ...current, payment_method: event.target.value }))}>
                  {PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Reference</label>
                <input style={styles.input} value={paymentForm.reference_no} onChange={(event) => setPaymentForm((current) => ({ ...current, reference_no: event.target.value }))} placeholder="Cash receipt, M-Pesa ref, EFT ref..." />
              </div>
              <div>
                <label style={styles.label}>Payment Date</label>
                <input style={styles.input} type="datetime-local" value={paymentForm.paid_at} onChange={(event) => setPaymentForm((current) => ({ ...current, paid_at: event.target.value }))} />
              </div>
              <div>
                <label style={styles.label}>Notes</label>
                <textarea style={{ ...styles.input, minHeight: 90, resize: 'vertical' }} value={paymentForm.notes} onChange={(event) => setPaymentForm((current) => ({ ...current, notes: event.target.value }))} />
              </div>
            </div>
            <div>
              <div style={styles.inlineBanner}>
                Partial payments are allocated oldest-first across this account&apos;s unpaid invoices.
              </div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Patient</th>
                    <th style={styles.th}>Description</th>
                    <th style={styles.th}>Invoice</th>
                    <th style={styles.th}>Allocated</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentPreview.map((row) => (
                    <tr key={row.id} style={styles.rowBorder}>
                      <td style={styles.td}>{row.patient_name || '-'}</td>
                      <td style={styles.td}>{row.description}</td>
                      <td style={styles.td}>{row.invoice_no || '-'}</td>
                      <td style={styles.td}><strong style={{ color: C.primary }}>{formatKES(row.amount_kes)}</strong></td>
                    </tr>
                  ))}
                  {paymentPreview.length === 0 ? <tr><td style={styles.emptyCell} colSpan={4}>Enter a payment amount to preview the oldest-first allocation.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {followUpTarget ? (
        <ModalShell
          title="Log Debt Follow-up"
          subtitle={`${followUpTarget.account_name} | Balance ${formatKES(followUpTarget.balance)}`}
          onClose={() => { setFollowUpTarget(null); setFollowUpForm(EMPTY_FOLLOWUP_FORM) }}
          footer={(
            <>
              <button style={styles.cancelBtn} onClick={() => { setFollowUpTarget(null); setFollowUpForm(EMPTY_FOLLOWUP_FORM) }}>Cancel</button>
              <button style={styles.submitBtn} onClick={handleSaveFollowUp} disabled={saving}>{saving ? 'Saving...' : 'Save Follow-up'}</button>
            </>
          )}
        >
          <div style={styles.formGridThree}>
            <div>
              <label style={styles.label}>Contact Date</label>
              <input style={styles.input} type="datetime-local" value={followUpForm.contact_date} onChange={(event) => setFollowUpForm((current) => ({ ...current, contact_date: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Contact Made To</label>
              <input style={styles.input} value={followUpForm.contact_made_to} onChange={(event) => setFollowUpForm((current) => ({ ...current, contact_made_to: event.target.value }))} placeholder="Patient, spouse, HR office, insurer..." />
            </div>
            <div>
              <label style={styles.label}>Status</label>
              <select style={styles.input} value={followUpForm.follow_up_status} onChange={(event) => setFollowUpForm((current) => ({ ...current, follow_up_status: event.target.value }))}>
                {FOLLOW_UP_STATUSES.map((status) => <option key={status}>{status}</option>)}
              </select>
            </div>
            <div style={styles.fieldWide}>
              <label style={styles.label}>Response</label>
              <textarea style={{ ...styles.input, minHeight: 90, resize: 'vertical' }} value={followUpForm.response} onChange={(event) => setFollowUpForm((current) => ({ ...current, response: event.target.value }))} placeholder="Promised to settle on Friday, disputed amount, requested itemized statement..." />
            </div>
            <div>
              <label style={styles.label}>Next Follow-up Date</label>
              <input style={styles.input} type="date" value={followUpForm.next_follow_up_date} onChange={(event) => setFollowUpForm((current) => ({ ...current, next_follow_up_date: event.target.value }))} />
            </div>
            <div style={styles.fieldWide}>
              <label style={styles.label}>Notes</label>
              <textarea style={{ ...styles.input, minHeight: 90, resize: 'vertical' }} value={followUpForm.notes} onChange={(event) => setFollowUpForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>
          </div>
        </ModalShell>
      ) : null}

      {writeOffTarget ? (
        <ModalShell
          title="Write Off Debt"
          subtitle={`${writeOffTarget.patients?.full_name || writeOffTarget.account_name} | Balance ${formatKES(writeOffTarget.balance)}`}
          onClose={() => { setWriteOffTarget(null); setWriteOffForm(EMPTY_WRITEOFF_FORM) }}
          footer={(
            <>
              <button style={styles.cancelBtn} onClick={() => { setWriteOffTarget(null); setWriteOffForm(EMPTY_WRITEOFF_FORM) }}>Cancel</button>
              <button style={{ ...styles.submitBtn, background: C.danger }} onClick={handleWriteOff} disabled={saving}>{saving ? 'Applying...' : 'Approve Write-off'}</button>
            </>
          )}
        >
          <div style={styles.inlineBannerDanger}>
            Use this for bad debt or hardship write-offs. Partial write-offs can leave a payment plan on the remainder.
          </div>
          <div style={styles.formGridThree}>
            <div>
              <label style={styles.label}>Amount to Write Off</label>
              <input style={styles.input} type="number" value={writeOffForm.amount_kes} onChange={(event) => setWriteOffForm((current) => ({ ...current, amount_kes: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Approved By</label>
              <input style={styles.input} value={writeOffForm.approved_by} onChange={(event) => setWriteOffForm((current) => ({ ...current, approved_by: event.target.value }))} />
            </div>
            <div style={styles.fieldWide}>
              <label style={styles.label}>Reason</label>
              <textarea style={{ ...styles.input, minHeight: 90, resize: 'vertical' }} value={writeOffForm.reason} onChange={(event) => setWriteOffForm((current) => ({ ...current, reason: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Remainder Installment</label>
              <input style={styles.input} type="number" value={writeOffForm.remainder_installment} onChange={(event) => setWriteOffForm((current) => ({ ...current, remainder_installment: event.target.value }))} />
            </div>
            <div>
              <label style={styles.label}>Next Payment Date</label>
              <input style={styles.input} type="date" value={writeOffForm.remainder_next_date} onChange={(event) => setWriteOffForm((current) => ({ ...current, remainder_next_date: event.target.value }))} />
            </div>
            <div style={styles.fieldWide}>
              <label style={styles.label}>Notes</label>
              <textarea style={{ ...styles.input, minHeight: 90, resize: 'vertical' }} value={writeOffForm.notes} onChange={(event) => setWriteOffForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>
          </div>
        </ModalShell>
      ) : null}

      {detailTarget ? (
        <ModalShell
          title={detailTarget.account_name}
          subtitle={`${detailTarget.account_type} credit account | Outstanding ${formatKES(detailTarget.balance)}`}
          onClose={() => setDetailTarget(null)}
          maxWidth={980}
          footer={(
            <>
              <button style={styles.cancelBtn} onClick={() => setDetailTarget(null)}>Close</button>
              <button style={styles.ghostBtn} onClick={() => handleSendReminder(detailTarget)}>WhatsApp Reminder</button>
              <button style={styles.lightBtn} onClick={() => { setDetailTarget(null); openPaymentModal(detailTarget) }} disabled={detailTarget.balance <= 0}>Receive Payment</button>
            </>
          )}
        >
          <div style={styles.stack}>
            <div style={styles.metricsGrid}>
              <MetricCard title="Outstanding" value={formatKES(detailTarget.balance)} accent={C.danger} background="#FEF2F2" />
              <MetricCard title="Credit Limit" value={detailTarget.credit_limit_kes > 0 ? formatKES(detailTarget.credit_limit_kes) : 'Not set'} accent={C.primary} background="#EFF6FF" />
              <MetricCard title="Utilisation" value={detailTarget.credit_limit_kes > 0 ? `${detailTarget.utilisation}%` : '-'} accent={detailTarget.overUtilised ? '#C2410C' : C.primary} background={detailTarget.overUtilised ? '#FFF7ED' : '#ECFDF5'} />
              <MetricCard title="Guarantor" value={detailTarget.guarantor_name || 'Not captured'} hint={detailTarget.guarantor_phone || detailTarget.guarantor_employer || ''} accent={C.sub} background={C.surface} />
            </div>

            <SectionCard title="Open Debt Lines" subtitle="Outstanding invoices linked to this account">
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Patient</th>
                    <th style={styles.th}>Description</th>
                    <th style={styles.th}>Balance</th>
                    <th style={styles.th}>Aging</th>
                    <th style={styles.th}>Plan</th>
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(detailTarget.debts || []).map((row) => {
                    const aging = getAgingMeta(row.days_outstanding)
                    return (
                      <tr key={row.id} style={styles.rowBorder}>
                        <td style={styles.td}>{formatDate(row.created_at)}</td>
                        <td style={styles.td}>{row.patients?.full_name || detailTarget.account_name}</td>
                        <td style={styles.td}>
                          <div style={{ fontWeight: 600 }}>{row.description}</div>
                          <div style={styles.tinyMuted}>{row.category} | Due {row.due_date ? formatDate(row.due_date) : 'Not set'}</div>
                        </td>
                        <td style={styles.td}><strong style={{ color: C.danger }}>{formatKES(row.balance)}</strong></td>
                        <td style={styles.td}><span style={{ ...styles.badge, background: aging.bg, color: aging.color }}>{row.days_outstanding} day(s)</span></td>
                        <td style={styles.td}>{row.payment_plan?.monthly_installment ? `${formatKES(row.payment_plan.monthly_installment)} from ${formatDate(row.payment_plan.next_payment_date)}` : '-'}</td>
                        <td style={styles.td}>
                          <div style={styles.inlineActions}>
                            <button style={styles.lightBtn} onClick={() => { setDetailTarget(null); openRecordModal(row) }}>Edit</button>
                            <button style={styles.lightBtn} onClick={() => { setDetailTarget(null); openPaymentModal(detailTarget) }}>Pay</button>
                            {isAdmin && Number(row.balance || 0) > 0 ? <button style={styles.dangerGhostBtn} onClick={() => { setDetailTarget(null); setWriteOffTarget(row); setWriteOffForm({ ...EMPTY_WRITEOFF_FORM, amount_kes: String(row.balance || '') }) }}>Write Off</button> : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {(detailTarget.debts || []).length === 0 ? <tr><td style={styles.emptyCell} colSpan={7}>No debt rows linked to this account yet.</td></tr> : null}
                </tbody>
              </table>
            </SectionCard>

            <SectionCard title="Payment Receipts" subtitle="Receipts recorded against this account">
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Receipt No</th>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Method</th>
                    <th style={styles.th}>Reference</th>
                    <th style={styles.th}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.filter((row) => (row.credit_account_id && detailTarget.id ? row.credit_account_id === detailTarget.id : row.account_key === detailTarget.key)).map((row) => (
                    <tr key={row.id} style={styles.rowBorder}>
                      <td style={styles.td}>{row.receipt_no}</td>
                      <td style={styles.td}>{formatDateTime(row.paid_at)}</td>
                      <td style={styles.td}>{row.payment_method}</td>
                      <td style={styles.td}>{row.reference_no || '-'}</td>
                      <td style={styles.td}><strong style={{ color: C.primary }}>{formatKES(row.amount_kes)}</strong></td>
                    </tr>
                  ))}
                  {payments.filter((row) => (row.credit_account_id && detailTarget.id ? row.credit_account_id === detailTarget.id : row.account_key === detailTarget.key)).length === 0 ? <tr><td style={styles.emptyCell} colSpan={5}>No payment receipts logged for this account yet.</td></tr> : null}
                </tbody>
              </table>
            </SectionCard>
          </div>
        </ModalShell>
      ) : null}
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: C.bg,
    fontFamily: typography.fontFamily,
    color: C.text,
    padding: '20px 24px 36px',
    boxSizing: 'border-box',
  },
  loadingWrap: {
    minHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 18,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 800,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: C.sub,
  },
  headerActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  notice: {
    background: '#FFF7ED',
    color: '#9A3412',
    border: '1px solid #FDBA74',
    borderRadius: 12,
    padding: '12px 14px',
    fontSize: 13,
    marginBottom: 16,
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginBottom: 16,
  },
  metricCard: {
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: '16px 18px',
  },
  metricTitle: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: 700,
    color: C.sub,
  },
  metricValue: {
    marginTop: 8,
    fontSize: 22,
    fontWeight: 800,
  },
  metricHint: {
    marginTop: 6,
    fontSize: 12,
    color: C.sub,
  },
  tabRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: '10px 12px',
    marginBottom: 14,
  },
  tab: {
    border: '1px solid transparent',
    background: 'transparent',
    borderRadius: 10,
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    color: C.sub,
    cursor: 'pointer',
  },
  tabActive: {
    background: C.primary,
    color: '#fff',
  },
  toolbar: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  body: {
    animation: 'fadeIn .2s ease',
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  splitTwo: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: 16,
  },
  card: {
    background: C.surface,
    borderRadius: 16,
    border: `1px solid ${C.border}`,
    overflow: 'hidden',
  },
  cardHeader: {
    padding: '16px 20px',
    borderBottom: `1px solid ${C.border}`,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 800,
  },
  cardSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: C.sub,
  },
  cardBody: {
    padding: '18px 20px',
  },
  accountGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 14,
  },
  accountCard: {
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 16,
    background: '#fff',
  },
  accountTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start',
  },
  accountName: {
    fontSize: 15,
    fontWeight: 800,
  },
  accountMeta: {
    fontSize: 12,
    color: C.sub,
    marginTop: 4,
  },
  accountMetrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
    marginTop: 14,
  },
  progressTrack: {
    marginTop: 12,
    height: 10,
    background: '#E2E8F0',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  accountFooter: {
    marginTop: 12,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  metricStack: {
    display: 'grid',
    gap: 12,
  },
  smallLabel: {
    fontSize: 11,
    color: C.sub,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: 700,
  },
  bigFigure: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: 800,
  },
  mediumFigure: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: 700,
  },
  smallMuted: {
    fontSize: 12,
    color: C.sub,
  },
  listRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: `1px solid ${C.border}`,
  },
  listTitle: {
    fontSize: 14,
    fontWeight: 700,
  },
  listMeta: {
    marginTop: 4,
    fontSize: 12,
    color: C.sub,
  },
  listActions: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  warningText: {
    color: '#C2410C',
    fontWeight: 700,
  },
  inlineActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: C.sub,
    borderBottom: `2px solid ${C.border}`,
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '11px 12px',
    fontSize: 13,
    verticalAlign: 'top',
  },
  rowBorder: {
    borderBottom: `1px solid ${C.border}`,
  },
  badge: {
    display: 'inline-block',
    borderRadius: 999,
    padding: '4px 9px',
    fontSize: 11,
    fontWeight: 700,
  },
  emptyState: {
    padding: '36px 12px',
    textAlign: 'center',
    color: C.sub,
  },
  emptyCell: {
    padding: '26px 12px',
    textAlign: 'center',
    color: C.sub,
    fontSize: 13,
  },
  tinyMuted: {
    fontSize: 11,
    color: C.sub,
    marginTop: 4,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: '#fff',
    padding: '10px 12px',
    fontFamily: 'inherit',
    fontSize: 13,
    color: C.text,
    outline: 'none',
  },
  inputCompact: {
    minWidth: 160,
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: '#fff',
    padding: '10px 12px',
    fontFamily: 'inherit',
    fontSize: 13,
    color: C.text,
  },
  label: {
    display: 'block',
    marginBottom: 6,
    fontSize: 12,
    color: C.sub,
    fontWeight: 600,
  },
  primaryBtn: {
    border: 'none',
    borderRadius: 10,
    background: C.primary,
    color: '#fff',
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  ghostBtn: {
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    background: '#fff',
    color: C.text,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  ghostBtnSmall: {
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    background: '#fff',
    color: C.text,
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  lightBtn: {
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    background: '#EFF6FF',
    color: C.primary,
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  dangerGhostBtn: {
    border: `1px solid #FECACA`,
    borderRadius: 10,
    background: '#FEF2F2',
    color: C.danger,
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.35)',
    zIndex: 1100,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  modal: {
    width: '100%',
    maxHeight: '92vh',
    background: C.surface,
    borderRadius: 18,
    boxShadow: '0 20px 60px rgba(15, 23, 42, 0.2)',
    display: 'flex',
    flexDirection: 'column',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
    padding: '18px 22px',
    borderBottom: `1px solid ${C.border}`,
  },
  modalTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 800,
  },
  modalSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: C.sub,
  },
  closeBtn: {
    border: 'none',
    background: 'transparent',
    color: C.sub,
    fontSize: 18,
    cursor: 'pointer',
  },
  modalBody: {
    padding: '18px 22px',
    overflowY: 'auto',
  },
  modalFooter: {
    padding: '14px 22px',
    borderTop: `1px solid ${C.border}`,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelBtn: {
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    background: '#fff',
    color: C.text,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  submitBtn: {
    border: 'none',
    borderRadius: 10,
    background: C.primary,
    color: '#fff',
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  formGridThree: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 14,
  },
  fieldWide: {
    gridColumn: '1 / -1',
  },
  segmentRow: {
    display: 'flex',
    gap: 8,
  },
  segmentBtn: {
    flex: 1,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    background: '#fff',
    color: C.text,
    padding: '10px 12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  segmentBtnActive: {
    background: C.primaryL,
    color: C.primary,
    borderColor: C.primary,
  },
  inlineBanner: {
    background: '#EFF6FF',
    border: '1px solid #BFDBFE',
    borderRadius: 12,
    padding: '12px 14px',
    color: '#1D4ED8',
    fontSize: 13,
    marginBottom: 14,
  },
  inlineBannerDanger: {
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: 12,
    padding: '12px 14px',
    color: '#B91C1C',
    fontSize: 13,
    marginBottom: 14,
  },
  corporateCard: {
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 16,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
}

