import { useContext, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { HospitalContext } from '../context'
import supabase from '../supabase'
import { executeWithFallback } from '../utils/dbCompat'
import { buildAmrInterventions, formatAntibioticLabel, getSusceptibilityEntries, summarizeAmrInterventions } from '../utils/hospitalSignals'
import { executeMicrobiologyQuery } from '../utils/microbiologyResults'
import { colors as themeColors, typography } from '../theme'
import MohReports from './reports/MohReports'
import { notifySuccess, notifyWarning } from '../notifications'
import { openPromptDialog } from '../confirmDialog'
import NetworkSummary from './reports/NetworkSummary'

const C = {
  primary: themeColors.primaryDark,
  accent: themeColors.accent,
  bg: themeColors.bgAlt,
  card: themeColors.card,
  border: themeColors.borderSoft,
  text: themeColors.textStrong,
  muted: '#6B7280',
  danger: '#DC2626',
  warn: '#D97706',
  info: themeColors.info,
  purple: '#0A9272',
  green: themeColors.success,
  teal: '#0F766E',
  bars: themeColors.chartBars,
}

const RANGE_OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'year', label: 'This Year' },
]

const TAB_OPTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'moh', label: 'MOH & KHIS' },
  { id: 'network', label: 'All facilities' },
  { id: 'statutory', label: 'MOH & Statutory' },
  { id: 'finance', label: 'Financial' },
  { id: 'clinical', label: 'Clinical' },
  { id: 'pharmacy', label: 'Pharmacy & Inventory' },
  { id: 'amr', label: 'AMR & Infection Control' },
  { id: 'builder', label: 'Custom Builder' },
  { id: 'scheduled', label: 'Scheduled Reports' },
]

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const AGE_BUCKETS = [
  { label: '0-4', min: 0, max: 4 },
  { label: '5-17', min: 5, max: 17 },
  { label: '18-35', min: 18, max: 35 },
  { label: '36-59', min: 36, max: 59 },
  { label: '60+', min: 60, max: Infinity },
]
const ARV_TERMS = ['tdf', '3tc', 'dtg', 'azt', 'nvp', 'abc', 'lopinavir', 'ritonavir', 'efavirenz', 'lamivudine', 'tenofovir', 'dolutegravir']
const VACCINE_TERMS = ['bcg', 'opv', 'ipv', 'penta', 'pentavalent', 'pcv', 'rotavirus', 'mr', 'measles', 'rubella', 'tt', 'td', 'yellow fever', 'hpv', 'covid vaccine']
const DDD_MAP = {
  amoxicillin: 1.5,
  ceftriaxone: 2,
  ciprofloxacin: 1,
  metronidazole: 1.5,
  azithromycin: 0.5,
  doxycycline: 0.2,
  gentamicin: 0.24,
  meropenem: 3,
}
const REPORT_OPTIONS = [
  { key: 'moh_705a', label: 'MOH 705A' },
  { key: 'moh_705b', label: 'MOH 705B' },
  { key: 'moh_333', label: 'MOH 333 ART Monthly Summary' },
  { key: 'moh_710', label: 'MOH 710 EPI Report' },
  { key: 'daily_collections', label: 'Daily Collections Report' },
  { key: 'aged_debtors', label: 'Aged Debtors Report' },
  { key: 'insurance_performance', label: 'Insurance Performance Report' },
  { key: 'sha_reconciliation', label: 'SHA Claims Reconciliation' },
  { key: 'revenue_by_department', label: 'Revenue by Department' },
  { key: 'top_diagnoses', label: 'Top 10 Diagnoses' },
  { key: 'top_drugs', label: 'Top 10 Drugs Prescribed' },
  { key: 'stock_valuation', label: 'Stock Valuation' },
  { key: 'antibiogram_summary', label: 'Monthly Antibiogram Summary' },
]

const CUSTOM_TABLE_OPTIONS = [
  { key: 'patients', label: 'Patients', dateField: 'created_at' },
  { key: 'visits', label: 'Visits', dateField: 'created_at' },
  { key: 'consultations', label: 'Consultations', dateField: 'created_at' },
  { key: 'labTests', label: 'Lab Tests', dateField: 'ordered_at' },
  { key: 'invoices', label: 'Invoices', dateField: 'created_at' },
  { key: 'salesLedger', label: 'Pharmacy Sales', dateField: 'sold_at' },
  { key: 'prescriptions', label: 'Prescriptions', dateField: 'created_at' },
  { key: 'insuranceClaims', label: 'Insurance Claims', dateField: 'created_at' },
  { key: 'shaClaims', label: 'SHA Claims', dateField: 'created_at' },
  { key: 'pharmInventory', label: 'Inventory', dateField: 'updated_at' },
  { key: 'drugBatches', label: 'Drug Batches', dateField: 'created_at' },
  { key: 'microbiologyResults', label: 'Microbiology Results', dateField: 'reported_date' },
]

function getRange(id) {
  const now = new Date()
  const start = new Date(now)
  if (id === 'today') {
    start.setHours(0, 0, 0, 0)
  } else if (id === 'week') {
    start.setDate(now.getDate() - 6)
    start.setHours(0, 0, 0, 0)
  } else if (id === 'month') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  } else {
    start.setMonth(0, 1)
    start.setHours(0, 0, 0, 0)
  }
  return { from: start.toISOString(), to: now.toISOString() }
}

function getMonthPeriod(year, month) {
  const from = new Date(year, month - 1, 1, 0, 0, 0, 0)
  const to = new Date(year, month, 0, 23, 59, 59, 999)
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: `${MONTH_LABELS[month - 1]} ${year}`,
  }
}

function grid(cols, min = 220) {
  return { display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(${min}px, 1fr))`, gap: 16 }
}

function formatKES(value) {
  return `KES ${Number(value || 0).toLocaleString()}`
}

function formatNumber(value) {
  return value == null ? '—' : Number(value).toLocaleString()
}

function formatPercent(value, digits = 0) {
  return `${Number(value || 0).toFixed(digits)}%`
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase()
}

function safeDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function monthKey(value) {
  const date = safeDate(value)
  if (!date) return 'Unknown'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(value) {
  const date = safeDate(value)
  if (!date) return 'Unknown'
  return date.toLocaleDateString('en-KE', { month: 'short', year: '2-digit' })
}

function dayLabel(value) {
  const date = safeDate(value)
  if (!date) return 'Unknown'
  return date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })
}

function daysBetween(from, to) {
  const start = safeDate(from)
  const end = safeDate(to)
  if (!start || !end) return null
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
}

function patientAge(patient, reference = new Date()) {
  if (!patient) return null
  if (patient.dob) {
    const dob = safeDate(patient.dob)
    if (dob) {
      let age = reference.getFullYear() - dob.getFullYear()
      const beforeBirthday = reference.getMonth() < dob.getMonth() || (reference.getMonth() === dob.getMonth() && reference.getDate() < dob.getDate())
      if (beforeBirthday) age -= 1
      return age >= 0 ? age : null
    }
  }
  const fallback = Number(patient.age)
  return Number.isFinite(fallback) ? fallback : null
}

function ageBucketLabel(age) {
  if (age == null) return 'Unknown'
  const match = AGE_BUCKETS.find(bucket => age >= bucket.min && age <= bucket.max)
  return match ? match.label : 'Unknown'
}

function bucketDays(days) {
  if (days <= 30) return '0-30 days'
  if (days <= 60) return '31-60 days'
  if (days <= 90) return '61-90 days'
  return '>90 days'
}

function parseMaybeJson(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'object') return [value]
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

function groupCount(rows, keyFn) {
  const map = {}
  rows.forEach(row => {
    const key = keyFn(row) || 'Unknown'
    map[key] = (map[key] || 0) + 1
  })
  return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
}

function groupSum(rows, keyFn, valFn) {
  const map = {}
  rows.forEach(row => {
    const key = keyFn(row) || 'Unknown'
    map[key] = (map[key] || 0) + Number(valFn(row) || 0)
  })
  return Object.entries(map).map(([label, value]) => ({ label, value: Math.round(value) })).sort((a, b) => b.value - a.value)
}

function topRows(rows, limit = 10) {
  return rows.slice(0, limit)
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
  a.download = filename
  a.click()
}

async function downloadExcel(filename, sheetName, rows) {
  const XLSX = await import('xlsx')
  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(book, sheet, sheetName)
  XLSX.writeFile(book, filename)
}

function openPrintWindow(title, bodyHtml) {
  const win = window.open('', '_blank', 'width=1100,height=900')
  if (!win) return
  win.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: Arial, sans-serif; color: #111; margin: 0; }
          .sheet { padding: 10mm 8mm; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 16px; }
          .title { font-size: 22px; font-weight: 700; margin: 0; }
          .subtitle { font-size: 12px; color: #555; margin-top: 4px; }
          .meta { font-size: 12px; color: #333; text-align: right; }
          .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
          .summary-card { border: 1px solid #D7DED9; border-radius: 8px; padding: 10px 12px; }
          .summary-value { font-size: 17px; font-weight: 700; color: #0F6E56; }
          .summary-label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 2px; }
          .block { border: 1px solid #D7DED9; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; }
          .block-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #0F6E56; margin-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #CFD8D3; padding: 6px 8px; text-align: left; vertical-align: top; }
          th { background: #EEF6F2; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
          .right { text-align: right; }
          .footer { margin-top: 14px; font-size: 11px; color: #666; }
        </style>
      </head>
      <body>
        ${bodyHtml}
        <script>setTimeout(() => window.print(), 250)</script>
      </body>
    </html>
  `)
  win.document.close()
}

function buildReportHtml({ hospitalName, title, subtitle, summary = [], columns = [], rows = [] }) {
  return `
    <div class="sheet">
      <div class="header">
        <div>
          <h1 class="title">${escapeHtml(title)}</h1>
          <div class="subtitle">${escapeHtml(hospitalName)}${subtitle ? ` · ${escapeHtml(subtitle)}` : ''}</div>
        </div>
        <div class="meta">
          <div><strong>Generated:</strong> ${new Date().toLocaleString('en-KE')}</div>
          <div><strong>Rows:</strong> ${rows.length.toLocaleString()}</div>
        </div>
      </div>
      ${summary.length > 0 ? `
        <div class="summary">
          ${summary.map(item => `
            <div class="summary-card">
              <div class="summary-value">${escapeHtml(item.value)}</div>
              <div class="summary-label">${escapeHtml(item.label)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      <div class="block">
        <div class="block-title">Report Detail</div>
        <table>
          <thead>
            <tr>${columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? `<tr><td colspan="${columns.length || 1}">No data available for this period.</td></tr>`
              : rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="footer">Generated from live Supabase hospital data in RemedacareHMS.</div>
    </div>
  `
}

function normalizeReportingConfig(raw = {}) {
  return {
    templates: Array.isArray(raw.templates) ? raw.templates : [],
    schedules: Array.isArray(raw.schedules) ? raw.schedules : [],
    logs: Array.isArray(raw.logs) ? raw.logs : [],
  }
}

function nextRunFrom(frequency, base = new Date()) {
  const date = new Date(base)
  if (frequency === 'daily') date.setDate(date.getDate() + 1)
  else if (frequency === 'weekly') date.setDate(date.getDate() + 7)
  else date.setMonth(date.getMonth() + 1)
  return date.toISOString()
}

function startsWithinRange(value, from, to) {
  const date = safeDate(value)
  const left = safeDate(from)
  const right = safeDate(to)
  if (!date || !left || !right) return true
  return date >= left && date <= right
}

function Badge({ label, color = C.primary, bg = `${C.primary}18` }) {
  return (
    <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: bg, color, textTransform: 'uppercase', letterSpacing: 0.4 }}>
      {label}
    </span>
  )
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '34px 0' }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', border: '3px solid #E5E7EB', borderTopColor: C.primary, animation: 'spin .7s linear infinite' }} />
    </div>
  )
}

function KpiCard({ label, value, sub, color = C.primary, loading }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      {loading
        ? <div style={{ marginTop: 10, height: 22, width: '55%', borderRadius: 6, background: '#E5E7EB' }} />
        : <div style={{ marginTop: 8, fontSize: 24, fontWeight: 800, color }}>{value}</div>}
      {sub ? <div style={{ marginTop: 5, fontSize: 11.5, color: C.muted }}>{sub}</div> : null}
    </div>
  )
}

function SectionCard({ title, note, actions, children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{title}</div>
          {note ? <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{note}</div> : null}
        </div>
        {actions ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}

function ActionButton({ children, ghost = false, danger = false, onClick, disabled = false }) {
  const background = danger ? C.danger : ghost ? '#fff' : C.primary
  const color = danger ? '#fff' : ghost ? C.primary : '#fff'
  const border = ghost ? `1px solid ${C.primary}` : 'none'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ padding: '8px 14px', borderRadius: 9, border, background, color, fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
    >
      {children}
    </button>
  )
}

function DataTable({ columns, rows, loading }) {
  if (loading) return <Spinner />
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            {columns.map(column => (
              <th key={column} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: '18px 10px', color: C.muted, textAlign: 'center' }}>No data available.</td>
            </tr>
          ) : rows.map((row, index) => (
            <tr key={index} style={{ borderBottom: `1px solid ${C.border}`, background: index % 2 ? '#FBFCFD' : 'transparent' }}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} style={{ padding: '8px 10px', color: C.text, verticalAlign: 'top' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReBarCard({ title, note, data, bars, loading, stacked = false, height = 280, formatValue }) {
  return (
    <SectionCard title={title} note={note}>
      {loading ? <Spinner /> : data.length === 0 ? <div style={{ color: C.muted, fontSize: 12 }}>No data yet.</div> : (
        <div style={{ width: '100%', height, minHeight: height, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
              <Tooltip formatter={(value, name) => [formatValue ? formatValue(value) : value, name]} />
              <Legend />
              {bars.map((bar, index) => (
                <Bar key={bar.dataKey} dataKey={bar.dataKey} stackId={stacked ? 'stack' : undefined} fill={bar.color || C.bars[index % C.bars.length]} radius={[6, 6, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  )
}

function ReLineCard({ title, note, data, lines, loading, height = 280, formatValue }) {
  return (
    <SectionCard title={title} note={note}>
      {loading ? <Spinner /> : data.length === 0 ? <div style={{ color: C.muted, fontSize: 12 }}>No data yet.</div> : (
        <div style={{ width: '100%', height, minHeight: height, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
              <Tooltip formatter={(value, name) => [formatValue ? formatValue(value) : value, name]} />
              <Legend />
              {lines.map((line, index) => (
                <Line key={line.dataKey} type="monotone" dataKey={line.dataKey} stroke={line.color || C.bars[index % C.bars.length]} strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  )
}

function RePieCard({ title, note, data, loading, height = 280, valueFormatter }) {
  return (
    <SectionCard title={title} note={note}>
      {loading ? <Spinner /> : data.length === 0 ? <div style={{ color: C.muted, fontSize: 12 }}>No data yet.</div> : (
        <div style={{ width: '100%', height, minHeight: height, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {data.map((entry, index) => (
                  <Cell key={entry.label} fill={C.bars[index % C.bars.length]} />
                ))}
              </Pie>
              <Tooltip formatter={value => [valueFormatter ? valueFormatter(value) : value, 'Value']} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  )
}

export default function Reports() {
  const { hospitalId } = useContext(HospitalContext)
  const [tab, setTab] = useState('overview')
  const [range, setRange] = useState('month')
  const [loading, setLoading] = useState(true)
  const [hospitalName, setHospitalName] = useState('RemaCare Hospital')
  const today = new Date()
  const [reportMonth, setReportMonth] = useState(today.getMonth() + 1)
  const [reportYear, setReportYear] = useState(today.getFullYear())
  const [data, setData] = useState({})
  const [reportingConfig, setReportingConfig] = useState(() => normalizeReportingConfig())
  const [configLoaded, setConfigLoaded] = useState(false)
  const [builder, setBuilder] = useState({
    table: 'consultations',
    dateField: 'created_at',
    from: '',
    to: '',
    filterKey: '',
    filterValue: '',
    selectedColumns: [],
    templateName: '',
  })

  const storageKey = `remedacare-reports-config-${hospitalId || 'default'}`

  useEffect(() => {
    if (!hospitalId) return
    fetchAll()
  }, [hospitalId, range])

  useEffect(() => {
    if (!hospitalId) return
    loadReportingConfig()
  }, [hospitalId])

  useEffect(() => {
    if (!hospitalId || loading || !configLoaded) return
    runDueSchedules()
  }, [hospitalId, loading, configLoaded, reportingConfig.schedules])

  useEffect(() => {
    if (!builder.from || !builder.to) {
      const { from, to } = getRange(range)
      setBuilder(current => ({ ...current, from: from.slice(0, 10), to: to.slice(0, 10) }))
    }
  }, [range])

  async function loadReportingConfig() {
    const localFallback = () => {
      try {
        return normalizeReportingConfig(JSON.parse(localStorage.getItem(storageKey) || '{}'))
      } catch {
        return normalizeReportingConfig()
      }
    }
    const { data: settings, error } = await supabase.from('hospital_settings').select('*').eq('hospital_id', hospitalId).maybeSingle()
    if (error) {
      setReportingConfig(localFallback())
      setConfigLoaded(true)
      return
    }
    setReportingConfig(normalizeReportingConfig(settings?.reporting_config || localFallback()))
    setConfigLoaded(true)
  }

  async function saveReportingConfig(nextConfig) {
    const normalized = normalizeReportingConfig(nextConfig)
    try {
      localStorage.setItem(storageKey, JSON.stringify(normalized))
    } catch {}
    const { error } = await supabase.from('hospital_settings').upsert({
      hospital_id: hospitalId,
      reporting_config: normalized,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'hospital_id' })
    if (error) {
      setReportingConfig(normalized)
      return false
    }
    setReportingConfig(normalized)
    return true
  }

  async function fetchAll() {
    setLoading(true)
    const { from, to } = getRange(range)
    const hid = hospitalId

    const [
      hospitalRes,
      visitsRes,
      patientsRes,
      admissionsRes,
      consultationsRes,
      labRes,
      invoicesRes,
      salesRes,
      prescriptionsRes,
      insuranceRes,
      shaRes,
      inventoryRes,
      batchesRes,
      writeoffsRes,
      microRes,
      stewardshipRes,
      departmentsRes,
      wardsRes,
      bedsRes,
      radiologyRes,
      creditRes,
      haiRes,
    ] = await Promise.all([
      supabase.from('hospitals').select('*').eq('id', hid).maybeSingle(),
      supabase.from('visits').select('*').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
      supabase.from('patients').select('*').eq('hospital_id', hid),
      supabase.from('admissions').select('*').eq('hospital_id', hid).gte('admission_date', from).lte('admission_date', to),
      supabase.from('consultations').select('*').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
      supabase.from('lab_tests').select('*').eq('hospital_id', hid).gte('ordered_at', from).lte('ordered_at', to),
      supabase.from('invoices').select('*').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
      supabase.from('sales_ledger').select('*').eq('hospital_id', hid).gte('sold_at', from).lte('sold_at', to),
      supabase.from('prescriptions').select('*').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
      supabase.from('insurance_claims').select('*').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
      supabase.from('sha_claims').select('*').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
      supabase.from('pharmacy_inventory').select('*').eq('hospital_id', hid),
      supabase.from('drug_batches').select('*').eq('hospital_id', hid),
      executeWithFallback(
        () => supabase.from('drug_writeoffs').select('*').eq('hospital_id', hid).order('written_off_at', { ascending: false }),
        async () => ({ data: [], error: null, compatFallback: true }),
      ),
      executeMicrobiologyQuery(select => supabase.from('microbiology_results').select(select).eq('hospital_id', hid).order('updated_at', { ascending: false }).limit(240)),
      executeWithFallback(
        () => supabase.from('stewardship_interventions').select('*').eq('hospital_id', hid).order('created_at', { ascending: false }).limit(200),
        async () => ({ data: [], error: null, compatFallback: true }),
      ),
      supabase.from('departments').select('*').eq('hospital_id', hid).order('name'),
      executeWithFallback(
        () => supabase.from('wards').select('*').eq('hospital_id', hid).order('name'),
        async () => ({ data: [], error: null, compatFallback: true }),
      ),
      executeWithFallback(
        () => supabase.from('beds').select('*').eq('hospital_id', hid),
        async () => ({ data: [], error: null, compatFallback: true }),
      ),
      executeWithFallback(
        () => supabase.from('radiology_orders').select('*').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
        async () => ({ data: [], error: null, compatFallback: true }),
      ),
      executeWithFallback(
        () => supabase.from('credit_debts').select('*').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
        async () => ({ data: [], error: null, compatFallback: true }),
      ),
      executeWithFallback(
        () => supabase.from('hospital_acquired_infections').select('*').eq('hospital_id', hid).gte('created_at', from).lte('created_at', to),
        async () => ({ data: [], error: null, compatFallback: true }),
      ),
    ])

    setHospitalName(hospitalRes?.data?.name || 'RemaCare Hospital')
    setData({
      visits: visitsRes?.data || [],
      patients: patientsRes?.data || [],
      admissions: admissionsRes?.data || [],
      consultations: consultationsRes?.data || [],
      labTests: labRes?.data || [],
      invoices: invoicesRes?.data || [],
      salesLedger: salesRes?.data || [],
      prescriptions: prescriptionsRes?.data || [],
      insuranceClaims: insuranceRes?.data || [],
      shaClaims: shaRes?.data || [],
      pharmInventory: inventoryRes?.data || [],
      drugBatches: batchesRes?.data || [],
      writeoffs: writeoffsRes?.data || [],
      microbiologyResults: microRes?.data || [],
      stewardshipInterventions: stewardshipRes?.data || [],
      departments: departmentsRes?.data || [],
      wards: wardsRes?.data || [],
      beds: bedsRes?.data || [],
      radiologyOrders: radiologyRes?.data || [],
      creditDebts: creditRes?.data || [],
      haiRecords: haiRes?.data || [],
    })
    setLoading(false)
  }

  const monthPeriod = useMemo(() => getMonthPeriod(reportYear, reportMonth), [reportYear, reportMonth])
  const patientsById = useMemo(() => Object.fromEntries((data.patients || []).map(patient => [patient.id, patient])), [data.patients])

  const bedCapacity = useMemo(() => {
    const beds = data.beds || []
    if (beds.length > 0) return beds.length
    return (data.wards || []).reduce((sum, ward) => sum + Number(ward.total_beds || 0), 0)
  }, [data.beds, data.wards])

  const bedDays = useMemo(() => (data.admissions || []).reduce((sum, admission) => {
    const los = daysBetween(admission.admission_date, admission.discharge_date || new Date().toISOString())
    return sum + Number(los || 0)
  }, 0), [data.admissions])

  const topDiagnoses = useMemo(
    () => topRows(
      groupCount(
        data.consultations || [],
        row => (row.icd10_code ? `${row.icd10_code} - ${row.icd10_description || row.diagnosis || 'Diagnosis'}` : row.diagnosis || 'Unspecified'),
      ),
      10,
    ),
    [data.consultations],
  )

  const topDrugsPrescribed = useMemo(() => topRows(groupCount(data.prescriptions || [], row => row.drug_name || 'Unknown'), 10), [data.prescriptions])

  const revenueSeries = useMemo(() => {
    const map = {}
    ;(data.invoices || []).forEach(invoice => {
      const label = dayLabel(invoice.created_at)
      if (!map[label]) map[label] = { label, total: 0 }
      map[label].total += Number(invoice.amount_paid || invoice.paid_kes || invoice.amount_kes || invoice.total_amount || 0)
    })
    return Object.values(map).slice(-7)
  }, [data.invoices])

  const revenueByDepartment = useMemo(() => {
    const rows = (data.invoices || []).map(invoice => {
      const services = parseMaybeJson(invoice.services)
      if (services.length === 0) {
        return [{
          department: invoice.department || invoice.speciality || 'General',
          amount: Number(invoice.amount_kes || invoice.total_amount || 0),
        }]
      }
      return services.map(service => ({
        department: service.department || service.dept || service.category || invoice.department || 'General',
        amount: Number(service.amount || service.total || service.unit_price_kes || 0),
      }))
    }).flat()
    return topRows(groupSum(rows, row => row.department, row => row.amount), 10)
  }, [data.invoices])

  const dailyCollections = useMemo(() => {
    const map = {}
    ;(data.invoices || []).forEach(invoice => {
      const label = dayLabel(invoice.created_at)
      const method = String(invoice.payment_method || 'Unknown')
      const key = label
      if (!map[key]) {
        map[key] = { label, Cash: 0, 'M-Pesa': 0, Insurance: 0, SHA: 0, Credit: 0, total: 0, cashier: invoice.created_by || invoice.cashier_name || 'System' }
      }
      const amount = Number(invoice.amount_paid || invoice.paid_kes || invoice.amount_kes || invoice.total_amount || 0)
      map[key].total += amount
      if (method.toLowerCase().includes('sha')) map[key].SHA += amount
      else if (method.toLowerCase().includes('m-pesa')) map[key]['M-Pesa'] += amount
      else if (method.toLowerCase().includes('cash')) map[key].Cash += amount
      else if (method.toLowerCase().includes('credit')) map[key].Credit += amount
      else map[key].Insurance += amount
    })
    return Object.values(map).sort((a, b) => (safeDate(a.label)?.getTime() || 0) - (safeDate(b.label)?.getTime() || 0))
  }, [data.invoices])

  const debtRows = useMemo(() => {
    const invoiceDebts = (data.invoices || [])
      .filter(invoice => Number(invoice.balance_kes || (Number(invoice.amount_kes || invoice.total_amount || 0) - Number(invoice.paid_kes || invoice.amount_paid || 0))) > 0)
      .map(invoice => {
        const balance = Number(invoice.balance_kes || (Number(invoice.amount_kes || invoice.total_amount || 0) - Number(invoice.paid_kes || invoice.amount_paid || 0)))
        const ageDays = daysBetween(invoice.created_at, new Date().toISOString()) || 0
        const patient = patientsById[invoice.patient_id] || {}
        return {
          patient_name: invoice.patient_name || patient.full_name || 'Unknown patient',
          patient_number: invoice.patient_number || patient.patient_number || '—',
          balance,
          ageDays,
          bucket: bucketDays(ageDays),
        }
      })
    return invoiceDebts.sort((a, b) => b.balance - a.balance)
  }, [data.invoices, patientsById])

  const agedDebtorsSummary = useMemo(() => groupSum(debtRows, row => row.bucket, row => row.balance), [debtRows])

  const insurancePerformance = useMemo(() => {
    const grouped = {}
    ;(data.insuranceClaims || []).forEach(claim => {
      const insurer = claim.insurer_name || claim.insurer || 'Unknown insurer'
      if (!grouped[insurer]) grouped[insurer] = { insurer, submitted: 0, approved: 0, paid: 0, rejected: 0, totalClaimed: 0, totalPaid: 0, daysToPay: [] }
      grouped[insurer].submitted += 1
      grouped[insurer].totalClaimed += Number(claim.amount_claimed || 0)
      const status = String(claim.status || '').toLowerCase()
      if (status.includes('approved')) grouped[insurer].approved += 1
      if (status.includes('rejected')) grouped[insurer].rejected += 1
      if (status.includes('paid')) {
        grouped[insurer].paid += 1
        grouped[insurer].totalPaid += Number(claim.amount_approved || claim.amount_claimed || 0)
        const days = daysBetween(claim.created_at, claim.payment_received_at || claim.updated_at)
        if (days != null) grouped[insurer].daysToPay.push(days)
      }
    })
    return Object.values(grouped).map(item => ({
      ...item,
      approvalRate: item.submitted ? (item.approved / item.submitted) * 100 : 0,
      avgDaysToPay: item.daysToPay.length ? (item.daysToPay.reduce((sum, days) => sum + days, 0) / item.daysToPay.length) : 0,
      outstandingOver45: item.daysToPay.some(days => days > 45),
    })).sort((a, b) => b.totalClaimed - a.totalClaimed)
  }, [data.insuranceClaims])

  const shaMonthlyReconciliation = useMemo(() => {
    const grouped = {}
    ;(data.shaClaims || []).forEach(claim => {
      const key = monthKey(claim.created_at)
      if (!grouped[key]) grouped[key] = { label: monthLabel(claim.created_at), claimed: 0, paid: 0, pending: 0, rejected: 0 }
      grouped[key].claimed += Number(claim.amount_claimed || 0)
      grouped[key].paid += Number(claim.amount_paid || 0)
      const status = String(claim.status || '').toLowerCase()
      if (status.includes('pending') || status.includes('submitted') || status.includes('review')) grouped[key].pending += 1
      if (status.includes('reject')) grouped[key].rejected += 1
    })
    return Object.values(grouped).slice(-6)
  }, [data.shaClaims])

  const genderSplit = useMemo(() => groupCount(data.patients || [], patient => patient.gender || 'Unknown'), [data.patients])
  const ageDistribution = useMemo(() => groupCount(data.patients || [], patient => ageBucketLabel(patientAge(patient))), [data.patients])
  const residenceDistribution = useMemo(() => topRows(groupCount(data.patients || [], patient => patient.location || patient.sub_county || patient.county || patient.address || 'Not captured'), 10), [data.patients])

  const averageLosByWard = useMemo(() => {
    const grouped = {}
    ;(data.admissions || []).forEach(admission => {
      const ward = admission.ward || 'Unknown ward'
      const los = daysBetween(admission.admission_date, admission.discharge_date || new Date().toISOString())
      if (!los) return
      if (!grouped[ward]) grouped[ward] = { label: ward, totalDays: 0, count: 0 }
      grouped[ward].totalDays += los
      grouped[ward].count += 1
    })
    return Object.values(grouped).map(item => ({ label: item.label, value: Number((item.totalDays / item.count).toFixed(1)) })).sort((a, b) => b.value - a.value)
  }, [data.admissions])

  const occupancyTrend = useMemo(() => {
    const capacity = bedCapacity || 1
    const months = []
    for (let index = 5; index >= 0; index -= 1) {
      const monthStart = new Date(today.getFullYear(), today.getMonth() - index, 1)
      const monthEnd = new Date(today.getFullYear(), today.getMonth() - index + 1, 0, 23, 59, 59, 999)
      let occupiedDays = 0
      ;(data.admissions || []).forEach(admission => {
        const admissionDate = safeDate(admission.admission_date)
        if (!admissionDate) return
        const dischargeDate = safeDate(admission.discharge_date || new Date())
        const overlapStart = admissionDate > monthStart ? admissionDate : monthStart
        const overlapEnd = dischargeDate < monthEnd ? dischargeDate : monthEnd
        if (overlapEnd >= overlapStart) {
          occupiedDays += Math.max(1, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)))
        }
      })
      const daysInMonth = monthEnd.getDate()
      const occupancy = capacity > 0 ? (occupiedDays / (capacity * daysInMonth)) * 100 : 0
      months.push({ label: monthStart.toLocaleDateString('en-KE', { month: 'short' }), occupancy: Number(occupancy.toFixed(1)) })
    }
    return months
  }, [bedCapacity, data.admissions, today])

  const referralPatterns = useMemo(() => {
    const rows = (data.consultations || []).filter(row => row.referral_reason || row.refer_department || row.disposition)
    return topRows(groupCount(rows, row => row.refer_department || row.speciality || row.disposition || 'Referral'), 10)
  }, [data.consultations])

  const inventoryValuation = useMemo(() => {
    const items = (data.pharmInventory || []).map(item => {
      const qty = Number(item.quantity_in_stock || item.quantity || 0)
      const costValue = qty * Number(item.unit_cost || 0)
      const retailValue = qty * Number(item.selling_price || 0)
      return {
        ...item,
        qty,
        costValue,
        retailValue,
        suggestedOrderQty: Math.max((Number(item.reorder_level || 10) * 2) - qty, 0),
      }
    })
    return {
      items,
      totalCost: items.reduce((sum, item) => sum + item.costValue, 0),
      totalRetail: items.reduce((sum, item) => sum + item.retailValue, 0),
      byCategory: topRows(groupSum(items, item => item.category || 'Other', item => item.costValue), 10),
    }
  }, [data.pharmInventory])

  const reorderStatus = useMemo(() => inventoryValuation.items.filter(item => item.qty < Number(item.reorder_level || 10)).sort((a, b) => a.qty - b.qty), [inventoryValuation])
  const expiryLosses = useMemo(() => {
    const grouped = {}
    ;(data.writeoffs || []).forEach(row => {
      const key = monthKey(row.written_off_at || row.created_at)
      if (!grouped[key]) grouped[key] = { label: monthLabel(row.written_off_at || row.created_at), value: 0 }
      grouped[key].value += Number(row.total_loss || 0)
    })
    return Object.values(grouped).slice(-6)
  }, [data.writeoffs])

  const pharmacyConsumption = useMemo(() => {
    const grouped = {}
    ;(data.salesLedger || []).forEach(row => {
      const key = row.drug_name || 'Unknown'
      if (!grouped[key]) grouped[key] = { drug_name: key, quantity: 0, value: 0 }
      grouped[key].quantity += Number(row.quantity || row.qty_sold || 0)
      grouped[key].value += Number(row.total_price || row.total_kes || 0)
    })
    return Object.values(grouped).sort((a, b) => b.value - a.value)
  }, [data.salesLedger])

  const bedDaysValue = bedDays || 1
  const dddPer100BedDays = useMemo(() => {
    const totals = {}
    ;(data.prescriptions || []).forEach(row => {
      const key = normalizeName(row.drug_name)
      if (!key) return
      const dddUnit = Object.entries(DDD_MAP).find(([name]) => key.includes(name))
      if (!dddUnit) return
      if (!totals[dddUnit[0]]) totals[dddUnit[0]] = 0
      totals[dddUnit[0]] += Number(row.quantity || 1)
    })
    return Object.entries(totals).map(([drug, qty]) => {
      const dddValue = DDD_MAP[drug] || 1
      return {
        label: drug,
        value: Number((((qty / dddValue) / bedDaysValue) * 100).toFixed(2)),
      }
    }).sort((a, b) => b.value - a.value).slice(0, 10)
  }, [data.prescriptions, bedDaysValue])

  const stewardshipSummaryRows = useMemo(() => {
    const grouped = {}
    ;(data.stewardshipInterventions || []).forEach(item => {
      const key = item.intervention_type || item.decision_type || item.status || 'Recorded'
      if (!grouped[key]) grouped[key] = { type: key, count: 0, outcome: 0 }
      grouped[key].count += 1
      if (String(item.prescriber_decision || item.status || '').toLowerCase().includes('accept')) grouped[key].outcome += 1
    })
    return Object.values(grouped).sort((a, b) => b.count - a.count)
  }, [data.stewardshipInterventions])

  const haiSummary = useMemo(() => topRows(groupCount(data.haiRecords || [], item => item.infection_type || item.organism || 'HAI event'), 10), [data.haiRecords])

  const antibiogramRows = useMemo(() => {
    const grouped = {}
    ;(data.microbiologyResults || []).forEach(result => {
      const organism = result.organism_identified || 'Unspecified organism'
      getSusceptibilityEntries(result).forEach(entry => {
        const key = `${organism}|${entry.label}`
        if (!grouped[key]) grouped[key] = { organism, antibiotic: entry.label, tested: 0, susceptible: 0 }
        grouped[key].tested += 1
        if (entry.sir === 'S') grouped[key].susceptible += 1
      })
    })
    return Object.values(grouped).map(item => ({
      ...item,
      label: `${item.organism} / ${item.antibiotic}`,
      value: Number(((item.susceptible / Math.max(item.tested, 1)) * 100).toFixed(1)),
    })).sort((a, b) => b.tested - a.tested || b.value - a.value).slice(0, 12)
  }, [data.microbiologyResults])

  const amrItems = useMemo(() => buildAmrInterventions({
    results: data.microbiologyResults || [],
    prescriptions: data.prescriptions || [],
    interventions: data.stewardshipInterventions || [],
    maxAgeDays: 30,
  }), [data.microbiologyResults, data.prescriptions, data.stewardshipInterventions])
  const amrSummary = useMemo(() => summarizeAmrInterventions(amrItems), [amrItems])

  const moh705aRows = useMemo(() => {
    const grouped = {}
    ;(data.consultations || []).forEach(row => {
      const patient = patientsById[row.patient_id]
      const age = patientAge(patient, safeDate(row.created_at) || new Date())
      if (age == null || age >= 5) return
      const code = row.icd10_code || row.icd_code || 'UNCODED'
      const diagnosis = row.icd10_description || row.diagnosis || 'Unspecified diagnosis'
      const key = `${code}|${diagnosis}`
      const gender = String(patient?.gender || 'Unknown').toLowerCase().startsWith('f') ? 'female' : 'male'
      if (!grouped[key]) grouped[key] = { code, diagnosis, male: 0, female: 0, total: 0 }
      grouped[key][gender] += 1
      grouped[key].total += 1
    })
    return Object.values(grouped).sort((a, b) => b.total - a.total)
  }, [data.consultations, patientsById])

  const moh705bRows = useMemo(() => {
    const grouped = {}
    ;(data.consultations || []).forEach(row => {
      const patient = patientsById[row.patient_id]
      const age = patientAge(patient, safeDate(row.created_at) || new Date())
      if (age == null || age < 5) return
      const code = row.icd10_code || row.icd_code || 'UNCODED'
      const diagnosis = row.icd10_description || row.diagnosis || 'Unspecified diagnosis'
      const key = `${code}|${diagnosis}`
      const gender = String(patient?.gender || 'Unknown').toLowerCase().startsWith('f') ? 'female' : 'male'
      if (!grouped[key]) grouped[key] = { code, diagnosis, male: 0, female: 0, total: 0 }
      grouped[key][gender] += 1
      grouped[key].total += 1
    })
    return Object.values(grouped).sort((a, b) => b.total - a.total)
  }, [data.consultations, patientsById])

  const moh333Rows = useMemo(() => {
    const grouped = {}
    ;(data.prescriptions || []).forEach(row => {
      const drug = String(row.drug_name || '')
      if (!ARV_TERMS.some(term => normalizeName(drug).includes(term))) return
      if (!grouped[drug]) grouped[drug] = { regimen: drug, patients: new Set(), prescriptions: 0, dispensedQty: 0 }
      grouped[drug].patients.add(row.patient_id || row.patient_name || row.id)
      grouped[drug].prescriptions += 1
      grouped[drug].dispensedQty += Number(row.quantity || 1)
    })
    return Object.values(grouped).map(item => ({
      regimen: item.regimen,
      activePatients: item.patients.size,
      prescriptions: item.prescriptions,
      dispensedQty: item.dispensedQty,
    })).sort((a, b) => b.activePatients - a.activePatients)
  }, [data.prescriptions])

  const moh710Rows = useMemo(() => {
    const vaccineRows = []
    ;(data.prescriptions || []).forEach(row => {
      const drug = String(row.drug_name || '')
      if (VACCINE_TERMS.some(term => normalizeName(drug).includes(term))) {
        vaccineRows.push({ antigen: drug, source: 'Prescription' })
      }
    })
    ;(data.consultations || []).forEach(row => {
      const diagnosis = String(row.diagnosis || row.icd10_description || '')
      if (VACCINE_TERMS.some(term => normalizeName(diagnosis).includes(term))) {
        vaccineRows.push({ antigen: diagnosis, source: 'Consultation' })
      }
    })
    return groupCount(vaccineRows, row => row.antigen)
  }, [data.consultations, data.prescriptions])

  const customSource = useMemo(() => data[builder.table] || [], [data, builder.table])
  const customColumns = useMemo(() => {
    const keys = new Set()
    customSource.slice(0, 20).forEach(row => {
      Object.keys(row || {}).forEach(key => {
        if (['hospital_id'].includes(key)) return
        keys.add(key)
      })
    })
    return Array.from(keys)
  }, [customSource])

  useEffect(() => {
    if (builder.selectedColumns.length === 0 && customColumns.length > 0) {
      setBuilder(current => ({ ...current, selectedColumns: customColumns.slice(0, Math.min(6, customColumns.length)) }))
    }
  }, [customColumns])

  const customPreview = useMemo(() => {
    const filtered = customSource.filter(row => {
      const dateField = builder.dateField || CUSTOM_TABLE_OPTIONS.find(item => item.key === builder.table)?.dateField
      if (builder.from && builder.to && row?.[dateField]) {
        const date = safeDate(row[dateField])
        const from = safeDate(builder.from)
        const to = safeDate(`${builder.to}T23:59:59`)
        if (date && from && to && (date < from || date > to)) return false
      }
      if (builder.filterKey && builder.filterValue) {
        return String(row?.[builder.filterKey] ?? '').toLowerCase().includes(builder.filterValue.toLowerCase())
      }
      return true
    })
    return filtered.slice(0, 50)
  }, [builder, customSource])

  function addReportLog(entry) {
    const nextConfig = {
      ...reportingConfig,
      logs: [{ id: `${Date.now()}`, ...entry }, ...(reportingConfig.logs || [])].slice(0, 100),
    }
    saveReportingConfig(nextConfig)
  }

  function getReportPayload(reportKey) {
    switch (reportKey) {
      case 'moh_705a':
        return {
          title: 'MOH 705A',
          subtitle: `${monthPeriod.label} · Outpatient Summary Under 5`,
          summary: [
            { label: 'Diagnoses', value: String(moh705aRows.length) },
            { label: 'Total Cases', value: String(moh705aRows.reduce((sum, row) => sum + row.total, 0)) },
          ],
          columns: ['ICD-10', 'Diagnosis', 'Male', 'Female', 'Total'],
          rows: moh705aRows.map(row => [row.code, row.diagnosis, row.male, row.female, row.total]),
          excelRows: moh705aRows,
        }
      case 'moh_705b':
        return {
          title: 'MOH 705B',
          subtitle: `${monthPeriod.label} · Outpatient Summary 5+`,
          summary: [
            { label: 'Diagnoses', value: String(moh705bRows.length) },
            { label: 'Total Cases', value: String(moh705bRows.reduce((sum, row) => sum + row.total, 0)) },
          ],
          columns: ['ICD-10', 'Diagnosis', 'Male', 'Female', 'Total'],
          rows: moh705bRows.map(row => [row.code, row.diagnosis, row.male, row.female, row.total]),
          excelRows: moh705bRows,
        }
      case 'moh_333':
        return {
          title: 'MOH 333 ART Monthly Summary',
          subtitle: monthPeriod.label,
          summary: [
            { label: 'Regimens', value: String(moh333Rows.length) },
            { label: 'Active Patients', value: String(moh333Rows.reduce((sum, row) => sum + row.activePatients, 0)) },
          ],
          columns: ['Regimen', 'Active Patients', 'Prescriptions', 'Dispensed Qty'],
          rows: moh333Rows.map(row => [row.regimen, row.activePatients, row.prescriptions, row.dispensedQty]),
          excelRows: moh333Rows,
        }
      case 'moh_710':
        return {
          title: 'MOH 710 EPI Report',
          subtitle: monthPeriod.label,
          summary: [
            { label: 'Antigens', value: String(moh710Rows.length) },
            { label: 'Total Doses', value: String(moh710Rows.reduce((sum, row) => sum + row.value, 0)) },
          ],
          columns: ['Antigen', 'Doses'],
          rows: moh710Rows.map(row => [row.label, row.value]),
          excelRows: moh710Rows.map(row => ({ antigen: row.label, doses: row.value })),
        }
      case 'daily_collections':
        return {
          title: 'Daily Collections Report',
          subtitle: RANGE_OPTIONS.find(item => item.id === range)?.label || range,
          summary: [
            { label: 'Days', value: String(dailyCollections.length) },
            { label: 'Total Collected', value: formatKES(dailyCollections.reduce((sum, row) => sum + row.total, 0)) },
          ],
          columns: ['Date', 'Cash', 'M-Pesa', 'Insurance', 'SHA', 'Credit', 'Total', 'Cashier'],
          rows: dailyCollections.map(row => [row.label, formatKES(row.Cash), formatKES(row['M-Pesa']), formatKES(row.Insurance), formatKES(row.SHA), formatKES(row.Credit), formatKES(row.total), row.cashier]),
          excelRows: dailyCollections,
        }
      case 'aged_debtors':
        return {
          title: 'Aged Debtors Report',
          subtitle: RANGE_OPTIONS.find(item => item.id === range)?.label || range,
          summary: [
            { label: 'Debtors', value: String(debtRows.length) },
            { label: 'Outstanding', value: formatKES(debtRows.reduce((sum, row) => sum + row.balance, 0)) },
          ],
          columns: ['Patient', 'Patient No.', 'Balance', 'Age Days', 'Bucket'],
          rows: debtRows.map(row => [row.patient_name, row.patient_number, formatKES(row.balance), row.ageDays, row.bucket]),
          excelRows: debtRows,
        }
      case 'insurance_performance':
        return {
          title: 'Insurance Performance Report',
          subtitle: RANGE_OPTIONS.find(item => item.id === range)?.label || range,
          summary: [
            { label: 'Insurers', value: String(insurancePerformance.length) },
            { label: 'Claimed', value: formatKES(insurancePerformance.reduce((sum, row) => sum + row.totalClaimed, 0)) },
          ],
          columns: ['Insurer', 'Submitted', 'Approved', 'Paid', 'Approval Rate', 'Avg Days To Pay'],
          rows: insurancePerformance.map(row => [row.insurer, row.submitted, row.approved, row.paid, formatPercent(row.approvalRate), row.avgDaysToPay.toFixed(1)]),
          excelRows: insurancePerformance,
        }
      case 'sha_reconciliation':
        return {
          title: 'SHA Claims Reconciliation',
          subtitle: RANGE_OPTIONS.find(item => item.id === range)?.label || range,
          summary: [
            { label: 'Months', value: String(shaMonthlyReconciliation.length) },
            { label: 'Claimed', value: formatKES(shaMonthlyReconciliation.reduce((sum, row) => sum + row.claimed, 0)) },
          ],
          columns: ['Month', 'Claimed', 'Paid', 'Pending Claims', 'Rejected Claims'],
          rows: shaMonthlyReconciliation.map(row => [row.label, formatKES(row.claimed), formatKES(row.paid), row.pending, row.rejected]),
          excelRows: shaMonthlyReconciliation,
        }
      case 'revenue_by_department':
        return {
          title: 'Revenue by Department',
          subtitle: RANGE_OPTIONS.find(item => item.id === range)?.label || range,
          summary: [
            { label: 'Departments', value: String(revenueByDepartment.length) },
            { label: 'Total Revenue', value: formatKES(revenueByDepartment.reduce((sum, row) => sum + row.value, 0)) },
          ],
          columns: ['Department', 'Revenue'],
          rows: revenueByDepartment.map(row => [row.label, formatKES(row.value)]),
          excelRows: revenueByDepartment.map(row => ({ department: row.label, revenue: row.value })),
        }
      case 'top_diagnoses':
        return {
          title: 'Top 10 Diagnoses',
          subtitle: RANGE_OPTIONS.find(item => item.id === range)?.label || range,
          summary: [{ label: 'Diagnoses', value: String(topDiagnoses.length) }],
          columns: ['Diagnosis', 'Count'],
          rows: topDiagnoses.map(row => [row.label, row.value]),
          excelRows: topDiagnoses,
        }
      case 'top_drugs':
        return {
          title: 'Top 10 Drugs Prescribed',
          subtitle: RANGE_OPTIONS.find(item => item.id === range)?.label || range,
          summary: [{ label: 'Drugs', value: String(topDrugsPrescribed.length) }],
          columns: ['Drug', 'Count'],
          rows: topDrugsPrescribed.map(row => [row.label, row.value]),
          excelRows: topDrugsPrescribed,
        }
      case 'stock_valuation':
        return {
          title: 'Stock Valuation',
          subtitle: 'Inventory value at cost and retail',
          summary: [
            { label: 'Cost Value', value: formatKES(inventoryValuation.totalCost) },
            { label: 'Retail Value', value: formatKES(inventoryValuation.totalRetail) },
          ],
          columns: ['Drug', 'Category', 'Qty', 'Cost Value', 'Retail Value', 'Supplier'],
          rows: inventoryValuation.items.map(item => [item.drug_name, item.category || 'Other', item.qty, formatKES(item.costValue), formatKES(item.retailValue), item.supplier || '—']),
          excelRows: inventoryValuation.items,
        }
      case 'antibiogram_summary':
        return {
          title: 'Monthly Antibiogram Summary',
          subtitle: RANGE_OPTIONS.find(item => item.id === range)?.label || range,
          summary: [
            { label: 'Lines', value: String(antibiogramRows.length) },
            { label: 'Stewardship Alerts', value: String(amrSummary.pendingReview) },
          ],
          columns: ['Organism', 'Antibiotic', '% Susceptible', 'Tests'],
          rows: antibiogramRows.map(row => [row.organism, row.antibiotic, `${row.value}%`, row.tested]),
          excelRows: antibiogramRows,
        }
      default:
        return null
    }
  }

  async function exportReportExcel(reportKey) {
    const payload = getReportPayload(reportKey)
    if (!payload) return
    await downloadExcel(`${payload.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.xlsx`, payload.title.slice(0, 28), payload.excelRows)
    addReportLog({ reportKey, title: payload.title, generatedAt: new Date().toISOString(), rowCount: payload.rows.length, mode: 'excel' })
  }

  function printReport(reportKey) {
    const payload = getReportPayload(reportKey)
    if (!payload) return
    openPrintWindow(payload.title, buildReportHtml({
      hospitalName,
      title: payload.title,
      subtitle: payload.subtitle,
      summary: payload.summary,
      columns: payload.columns,
      rows: payload.rows,
    }))
    addReportLog({ reportKey, title: payload.title, generatedAt: new Date().toISOString(), rowCount: payload.rows.length, mode: 'pdf' })
  }

  function exportReportCsv(reportKey) {
    const payload = getReportPayload(reportKey)
    if (!payload) return
    downloadCsv(`${payload.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.csv`, payload.columns, payload.rows)
    addReportLog({ reportKey, title: payload.title, generatedAt: new Date().toISOString(), rowCount: payload.rows.length, mode: 'csv' })
  }

  async function runDueSchedules() {
    const now = new Date()
    const due = (reportingConfig.schedules || []).filter(item => item.enabled && safeDate(item.nextRunAt) && safeDate(item.nextRunAt) <= now)
    if (due.length === 0) return
    const nextSchedules = [...(reportingConfig.schedules || [])]
    const nextLogs = [...(reportingConfig.logs || [])]
    due.forEach(schedule => {
      const payload = getReportPayload(schedule.reportKey)
      if (!payload) return
      nextLogs.unshift({
        id: `${schedule.id}-${Date.now()}`,
        reportKey: schedule.reportKey,
        title: payload.title,
        generatedAt: now.toISOString(),
        rowCount: payload.rows.length,
        mode: 'scheduled',
        scheduleName: schedule.name,
      })
      const index = nextSchedules.findIndex(item => item.id === schedule.id)
      if (index >= 0) {
        nextSchedules[index] = { ...nextSchedules[index], lastRunAt: now.toISOString(), nextRunAt: nextRunFrom(schedule.frequency, now) }
      }
    })
    await saveReportingConfig({ ...reportingConfig, schedules: nextSchedules, logs: nextLogs.slice(0, 100) })
  }

  async function saveBuilderTemplate() {
    if (!builder.templateName.trim()) {
      notifyWarning('Enter a template name first.')
      return
    }
    const template = {
      id: `tpl-${Date.now()}`,
      name: builder.templateName.trim(),
      table: builder.table,
      dateField: builder.dateField,
      from: builder.from,
      to: builder.to,
      filterKey: builder.filterKey,
      filterValue: builder.filterValue,
      selectedColumns: builder.selectedColumns,
      createdAt: new Date().toISOString(),
    }
    await saveReportingConfig({
      ...reportingConfig,
      templates: [template, ...(reportingConfig.templates || [])].slice(0, 40),
    })
    setBuilder(current => ({ ...current, templateName: '' }))
    notifySuccess('Custom report template saved.')
  }

  function loadBuilderTemplate(template) {
    setBuilder({
      table: template.table,
      dateField: template.dateField,
      from: template.from,
      to: template.to,
      filterKey: template.filterKey,
      filterValue: template.filterValue,
      selectedColumns: template.selectedColumns,
      templateName: template.name,
    })
  }

  async function scheduleReport(reportKey) {
    const option = REPORT_OPTIONS.find(item => item.key === reportKey)
    if (!option) return
    const frequency = await openPromptDialog('How often? Type daily, weekly or monthly.', { title: 'Schedule frequency', defaultValue: 'monthly' })
    if (!['daily', 'weekly', 'monthly'].includes(String(frequency || '').toLowerCase())) return
    const schedule = {
      id: `sch-${Date.now()}`,
      name: option.label,
      reportKey,
      frequency: String(frequency).toLowerCase(),
      enabled: true,
      nextRunAt: nextRunFrom(String(frequency).toLowerCase(), new Date()),
      createdAt: new Date().toISOString(),
    }
    await saveReportingConfig({
      ...reportingConfig,
      schedules: [schedule, ...(reportingConfig.schedules || [])].slice(0, 40),
    })
    notifySuccess('Report schedule saved.')
  }

  async function exportCustomReport(format = 'excel') {
    const columns = builder.selectedColumns
    const rows = customPreview.map(row => Object.fromEntries(columns.map(column => [column, row[column]])))
    if (format === 'excel') {
      await downloadExcel(`custom_${builder.table}_${Date.now()}.xlsx`, 'Custom Report', rows)
    } else {
      downloadCsv(`custom_${builder.table}_${Date.now()}.csv`, columns, rows.map(row => columns.map(column => row[column])))
    }
    addReportLog({ reportKey: `custom:${builder.table}`, title: `Custom ${builder.table}`, generatedAt: new Date().toISOString(), rowCount: rows.length, mode: format })
  }

  const sharedChartHeight = 280

  return (
    <div style={{ minHeight: '100%', background: C.bg, padding: '20px 24px', fontFamily: typography.systemFontFamily }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text }}>Reports & Analytics</h2>
          <div style={{ marginTop: 4, fontSize: 12.5, color: C.muted }}>{hospitalName} live operational, statutory, clinical, pharmacy, and stewardship reporting.</div>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: 4, borderRadius: 12, border: `1px solid ${C.border}`, background: '#fff', flexWrap: 'wrap' }}>
          {RANGE_OPTIONS.map(option => (
            <button
              key={option.id}
              onClick={() => setRange(option.id)}
              style={{ border: 'none', cursor: 'pointer', padding: '7px 12px', borderRadius: 8, background: range === option.id ? C.primary : 'transparent', color: range === option.id ? '#fff' : C.muted, fontSize: 12, fontWeight: 700 }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', borderBottom: `1px solid ${C.border}`, marginBottom: 20 }}>
        {TAB_OPTIONS.map(option => (
          <button
            key={option.id}
            onClick={() => setTab(option.id)}
            style={{ border: 'none', background: 'transparent', padding: '10px 14px', cursor: 'pointer', fontSize: 12.5, fontWeight: tab === option.id ? 800 : 600, color: tab === option.id ? C.primary : C.muted, borderBottom: `2px solid ${tab === option.id ? C.primary : 'transparent'}`, whiteSpace: 'nowrap' }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={grid(4)}>
            <KpiCard label="Patients" value={formatNumber(data.patients?.length || 0)} sub="Registered patients" color={C.primary} loading={loading} />
            <KpiCard label="Visits" value={formatNumber(data.visits?.length || 0)} sub="This period" color={C.info} loading={loading} />
            <KpiCard label="Revenue Collected" value={formatKES((data.invoices || []).reduce((sum, row) => sum + Number(row.amount_paid || row.paid_kes || 0), 0))} sub="Paid invoices" color={C.green} loading={loading} />
            <KpiCard label="AMR Review Queue" value={formatNumber(amrSummary.pendingReview)} sub={`${amrSummary.highSeverity} high severity`} color={C.danger} loading={loading} />
          </div>
          <div style={grid(2, 320)}>
            <ReLineCard title="Revenue Trend" note="Collected invoice value over the current reporting window." data={revenueSeries} lines={[{ dataKey: 'total', color: C.primary }]} formatValue={value => `KES ${Number(value || 0).toLocaleString()}`} loading={loading} height={sharedChartHeight} />
            <RePieCard title="Patient Gender Mix" note="Registered patient mix by sex." data={genderSplit} loading={loading} height={sharedChartHeight} />
          </div>
          <div style={grid(2, 320)}>
            <ReBarCard title="Revenue by Department" note="Highest grossing departments from invoice service lines." data={revenueByDepartment} bars={[{ dataKey: 'value', color: C.teal }]} formatValue={value => `KES ${Number(value || 0).toLocaleString()}`} loading={loading} height={sharedChartHeight} />
            <ReBarCard title="Top Diagnoses" note="Most frequent diagnoses in the reporting period." data={topDiagnoses} bars={[{ dataKey: 'value', color: C.purple }]} loading={loading} height={sharedChartHeight} />
          </div>
          <div style={grid(2, 320)}>
            <SectionCard title="Priority Flags" note="Operational issues worth executive attention.">
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Pending SHA claims</span><strong>{formatNumber((data.shaClaims || []).filter(row => ['pending', 'submitted', 'under review'].includes(String(row.status || '').toLowerCase())).length)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Insurance backlog</span><strong>{formatNumber((data.insuranceClaims || []).filter(row => ['pending', 'submitted', 'under review', 'draft'].includes(String(row.status || '').toLowerCase())).length)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Low stock lines</span><strong>{formatNumber(reorderStatus.length)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Departments without active staff</span><strong>{formatNumber((data.departments || []).filter(department => !department.status || String(department.status).toLowerCase() !== 'inactive').filter(department => !(data.consultations || []).some(c => c.speciality === department.name)).length)}</strong></div>
              </div>
            </SectionCard>
            <SectionCard title="Generated Reports Log" note="Latest exports across PDF, Excel, CSV, and schedules.">
              <DataTable
                loading={false}
                columns={['Report', 'Generated', 'Mode', 'Rows']}
                rows={(reportingConfig.logs || []).slice(0, 6).map(item => [
                  item.title || item.reportKey,
                  safeDate(item.generatedAt)?.toLocaleString('en-KE') || '—',
                  item.mode || 'manual',
                  item.rowCount || 0,
                ])}
              />
            </SectionCard>
          </div>
        </div>
      )}

      {tab === 'moh' && <MohReports hospitalId={hospitalId} hospitalName={hospitalName} />}
      {tab === 'network' && <NetworkSummary hospitalId={hospitalId} />}

      {tab === 'statutory' && (
        <div style={{ display: 'grid', gap: 18 }}>
          <SectionCard
            title="MOH Statutory Reports"
            note="Select a month and auto-generate statutory reports from consultations, prescriptions, and immunisation activity."
            actions={[
              <select key="month" value={reportMonth} onChange={event => setReportMonth(Number(event.target.value))} style={{ minWidth: 160, padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}` }}>
                {MONTH_LABELS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
              </select>,
              <select key="year" value={reportYear} onChange={event => setReportYear(Number(event.target.value))} style={{ minWidth: 120, padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}` }}>
                {Array.from({ length: 6 }, (_, index) => today.getFullYear() - index).map(year => <option key={year} value={year}>{year}</option>)}
              </select>,
            ]}
          >
            <div style={grid(4)}>
              <KpiCard label="705A Rows" value={formatNumber(moh705aRows.length)} sub="Under 5 disease lines" color={C.green} loading={loading} />
              <KpiCard label="705B Rows" value={formatNumber(moh705bRows.length)} sub="Age 5+ disease lines" color={C.info} loading={loading} />
              <KpiCard label="MOH 333 Rows" value={formatNumber(moh333Rows.length)} sub="ART regimen lines" color={C.purple} loading={loading} />
              <KpiCard label="MOH 710 Rows" value={formatNumber(moh710Rows.length)} sub="Immunisation antigens" color={C.warn} loading={loading} />
            </div>
          </SectionCard>

          {[
            { key: 'moh_705a', note: 'Outpatient summary for children under 5 years.' },
            { key: 'moh_705b', note: 'Outpatient summary for patients 5 years and above.' },
            { key: 'moh_333', note: 'ART monthly summary based on ARV prescribing activity.' },
            { key: 'moh_710', note: 'EPI / immunisation tallies based on captured vaccine-related activity.' },
          ].map(item => {
            const payload = getReportPayload(item.key)
            return (
              <SectionCard
                key={item.key}
                title={payload?.title || item.key}
                note={item.note}
                actions={[
                  <ActionButton key="pdf" onClick={() => printReport(item.key)}>Print PDF</ActionButton>,
                  <ActionButton key="excel" ghost onClick={() => exportReportExcel(item.key)}>Excel</ActionButton>,
                  <ActionButton key="csv" ghost onClick={() => exportReportCsv(item.key)}>CSV</ActionButton>,
                ]}
              >
                <DataTable loading={loading} columns={payload?.columns || []} rows={payload?.rows || []} />
              </SectionCard>
            )
          })}
        </div>
      )}

      {tab === 'finance' && (
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={grid(4)}>
            <KpiCard label="Invoiced" value={formatKES((data.invoices || []).reduce((sum, row) => sum + Number(row.amount_kes || row.total_amount || 0), 0))} sub="Total billings" color={C.primary} loading={loading} />
            <KpiCard label="Collected" value={formatKES((data.invoices || []).reduce((sum, row) => sum + Number(row.paid_kes || row.amount_paid || 0), 0))} sub="Cash collected" color={C.green} loading={loading} />
            <KpiCard label="Receivables" value={formatKES(debtRows.reduce((sum, row) => sum + row.balance, 0))} sub="Outstanding invoices" color={C.warn} loading={loading} />
            <KpiCard label="Revenue Cycle Gap" value={formatPercent(((debtRows.reduce((sum, row) => sum + row.balance, 0)) / Math.max((data.invoices || []).reduce((sum, row) => sum + Number(row.amount_kes || row.total_amount || 0), 0), 1)) * 100, 1)} sub="Receivables as % of billings" color={C.danger} loading={loading} />
          </div>

          <div style={grid(2, 320)}>
            <ReBarCard
              title="Daily Collections by Payment Type"
              note="Collections split by Cash, M-Pesa, Insurance, SHA, and Credit."
              data={dailyCollections}
              bars={[
                { dataKey: 'Cash', color: '#374151' },
                { dataKey: 'M-Pesa', color: C.green },
                { dataKey: 'Insurance', color: C.warn },
                { dataKey: 'SHA', color: '#2563EB' },
                { dataKey: 'Credit', color: C.purple },
              ]}
              stacked
              formatValue={value => `KES ${Number(value || 0).toLocaleString()}`}
              loading={loading}
              height={sharedChartHeight}
            />
            <RePieCard title="Receivables Aging" note="Outstanding balances by aging bucket." data={agedDebtorsSummary} loading={loading} valueFormatter={value => formatKES(value)} height={sharedChartHeight} />
          </div>

          <div style={grid(2, 320)}>
            <SectionCard
              title="Financial Reports"
              note="Print or export standard finance reports."
              actions={[
                <ActionButton key="daily-pdf" onClick={() => printReport('daily_collections')}>Daily Collections PDF</ActionButton>,
                <ActionButton key="daily-xls" ghost onClick={() => exportReportExcel('daily_collections')}>Excel</ActionButton>,
                <ActionButton key="age-pdf" onClick={() => printReport('aged_debtors')}>Aged Debtors PDF</ActionButton>,
                <ActionButton key="age-xls" ghost onClick={() => exportReportExcel('aged_debtors')}>Excel</ActionButton>,
              ]}
            >
              <DataTable loading={loading} columns={['Date', 'Cash', 'M-Pesa', 'Insurance', 'SHA', 'Credit', 'Total']} rows={dailyCollections.map(row => [row.label, formatKES(row.Cash), formatKES(row['M-Pesa']), formatKES(row.Insurance), formatKES(row.SHA), formatKES(row.Credit), formatKES(row.total)])} />
            </SectionCard>
            <SectionCard
              title="Insurance Performance"
              note="Per-insurer submission, approval, payment, and delay profile."
              actions={[
                <ActionButton key="insurance-pdf" onClick={() => printReport('insurance_performance')}>Print PDF</ActionButton>,
                <ActionButton key="insurance-xls" ghost onClick={() => exportReportExcel('insurance_performance')}>Excel</ActionButton>,
              ]}
            >
              <DataTable
                loading={loading}
                columns={['Insurer', 'Claimed', 'Paid', 'Approval Rate', 'Avg Days To Pay', 'Flag']}
                rows={insurancePerformance.map(row => [
                  row.insurer,
                  formatKES(row.totalClaimed),
                  formatKES(row.totalPaid),
                  <Badge label={formatPercent(row.approvalRate)} color={row.approvalRate > 80 ? C.green : row.approvalRate >= 60 ? C.warn : C.danger} bg={row.approvalRate > 80 ? `${C.green}18` : row.approvalRate >= 60 ? `${C.warn}18` : `${C.danger}18`} />,
                  row.avgDaysToPay.toFixed(1),
                  row.outstandingOver45 ? <Badge label=">45d Outstanding" color={C.danger} bg={`${C.danger}18`} /> : <Badge label="Within SLA" color={C.green} bg={`${C.green}18`} />,
                ])}
              />
            </SectionCard>
          </div>

          <SectionCard
            title="SHA Claims Reconciliation"
            note="Monthly claimed versus paid values and backlog."
            actions={[
              <ActionButton key="sha-pdf" onClick={() => printReport('sha_reconciliation')}>Print PDF</ActionButton>,
              <ActionButton key="sha-xls" ghost onClick={() => exportReportExcel('sha_reconciliation')}>Excel</ActionButton>,
            ]}
          >
            <ReLineCard title="SHA Reconciliation Trend" note="" data={shaMonthlyReconciliation} lines={[{ dataKey: 'claimed', color: '#2563EB' }, { dataKey: 'paid', color: C.green }]} formatValue={value => `KES ${Number(value || 0).toLocaleString()}`} loading={loading} height={sharedChartHeight} />
          </SectionCard>
        </div>
      )}

      {tab === 'clinical' && (
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={grid(4)}>
            <KpiCard label="Consultations" value={formatNumber(data.consultations?.length || 0)} sub="Clinical encounters" color={C.primary} loading={loading} />
            <KpiCard label="Admissions" value={formatNumber(data.admissions?.length || 0)} sub="Inpatient episodes" color={C.warn} loading={loading} />
            <KpiCard label="Avg LOS" value={`${averageLosByWard[0]?.value || 0} days`} sub="Highest ward average shown" color={C.purple} loading={loading} />
            <KpiCard label="Referral Lines" value={formatNumber(referralPatterns.reduce((sum, row) => sum + row.value, 0))} sub="Consultations with referral intent" color={C.info} loading={loading} />
          </div>

          <div style={grid(2, 320)}>
            <ReBarCard title="Top 10 Diagnoses" note="Most frequent ICD-10 / diagnosis labels this period." data={topDiagnoses} bars={[{ dataKey: 'value', color: C.primary }]} loading={loading} height={sharedChartHeight} />
            <ReBarCard title="Top 10 Drugs Prescribed" note="Prescription volume by drug name." data={topDrugsPrescribed} bars={[{ dataKey: 'value', color: C.purple }]} loading={loading} height={sharedChartHeight} />
          </div>

          <div style={grid(3, 260)}>
            <RePieCard title="Age Distribution" note="Registered patients grouped into standard age bands." data={ageDistribution} loading={loading} valueFormatter={value => formatNumber(value)} height={sharedChartHeight} />
            <RePieCard title="Gender Split" note="Patient sex distribution." data={genderSplit} loading={loading} valueFormatter={value => formatNumber(value)} height={sharedChartHeight} />
            <ReBarCard title="Residential Area" note="Most common captured location/sub-county/county values." data={residenceDistribution} bars={[{ dataKey: 'value', color: C.teal }]} loading={loading} height={sharedChartHeight} />
          </div>

          <div style={grid(2, 320)}>
            <ReBarCard title="Average Length of Stay by Ward" note="Average inpatient days by ward." data={averageLosByWard} bars={[{ dataKey: 'value', color: C.warn }]} loading={loading} height={sharedChartHeight} />
            <ReLineCard title="Bed Occupancy Trend by Month" note="Estimated occupied bed days as a percentage of available capacity." data={occupancyTrend.map(item => ({ ...item, label: item.label, value: item.occupancy }))} lines={[{ dataKey: 'value', color: C.danger }]} formatValue={value => `${Number(value || 0).toFixed(0)}%`} loading={loading} height={sharedChartHeight} />
          </div>

          <SectionCard
            title="Referral Patterns"
            note="Most frequent destinations or referral-related consultation tags."
            actions={[
              <ActionButton key="revdept-pdf" onClick={() => printReport('revenue_by_department')}>Revenue by Dept PDF</ActionButton>,
              <ActionButton key="diag-xls" ghost onClick={() => exportReportExcel('top_diagnoses')}>Top Diagnoses Excel</ActionButton>,
            ]}
          >
            <DataTable loading={loading} columns={['Referral Destination / Pattern', 'Count']} rows={referralPatterns.map(row => [row.label, row.value])} />
          </SectionCard>
        </div>
      )}

      {tab === 'pharmacy' && (
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={grid(4)}>
            <KpiCard label="Inventory Cost Value" value={formatKES(inventoryValuation.totalCost)} sub="At purchase cost" color={C.primary} loading={loading} />
            <KpiCard label="Inventory Retail Value" value={formatKES(inventoryValuation.totalRetail)} sub="At retail value" color={C.green} loading={loading} />
            <KpiCard label="Low Stock Lines" value={formatNumber(reorderStatus.length)} sub="Below reorder level" color={C.danger} loading={loading} />
            <KpiCard label="Expiry Losses" value={formatKES((data.writeoffs || []).reduce((sum, row) => sum + Number(row.total_loss || 0), 0))} sub="Written-off stock value" color={C.warn} loading={loading} />
          </div>

          <div style={grid(2, 320)}>
            <ReBarCard title="Consumption Report" note="Dispensed value by drug from sales_ledger." data={topRows(pharmacyConsumption.map(item => ({ label: item.drug_name, value: item.value })), 10)} bars={[{ dataKey: 'value', color: C.green }]} formatValue={value => `KES ${Number(value || 0).toLocaleString()}`} loading={loading} height={sharedChartHeight} />
            <ReBarCard title="Stock Value by Category" note="Inventory valuation at cost by category." data={inventoryValuation.byCategory.map(item => ({ label: item.label, value: item.value }))} bars={[{ dataKey: 'value', color: C.purple }]} formatValue={value => `KES ${Number(value || 0).toLocaleString()}`} loading={loading} height={sharedChartHeight} />
          </div>

          <div style={grid(2, 320)}>
            <ReLineCard title="Expiry Loss Trend" note="Monthly KES value of expired/recalled write-offs." data={expiryLosses} lines={[{ dataKey: 'value', color: C.danger }]} formatValue={value => `KES ${Number(value || 0).toLocaleString()}`} loading={loading} height={sharedChartHeight} />
            <SectionCard
              title="Pharmacy & Inventory Reports"
              note="Exportable operational inventory reports."
              actions={[
                <ActionButton key="stock-pdf" onClick={() => printReport('stock_valuation')}>Stock Valuation PDF</ActionButton>,
                <ActionButton key="stock-xls" ghost onClick={() => exportReportExcel('stock_valuation')}>Excel</ActionButton>,
              ]}
            >
              <DataTable
                loading={loading}
                columns={['Drug', 'Qty', 'Cost', 'Retail', 'Reorder', 'Suggested Order']}
                rows={topRows(reorderStatus, 12).map(item => [
                  item.drug_name,
                  item.qty,
                  formatKES(item.costValue),
                  formatKES(item.retailValue),
                  item.reorder_level || 10,
                  item.suggestedOrderQty,
                ])}
              />
            </SectionCard>
          </div>
        </div>
      )}

      {tab === 'amr' && (
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={grid(4)}>
            <KpiCard label="AMR Pending Review" value={formatNumber(amrSummary.pendingReview)} sub="Interventions still awaiting review" color={C.danger} loading={loading} />
            <KpiCard label="High Severity Alerts" value={formatNumber(amrSummary.highSeverity)} sub="Resistant / high-risk flags" color={C.warn} loading={loading} />
            <KpiCard label="DDD / 100 Bed Days" value={dddPer100BedDays[0] ? dddPer100BedDays[0].value.toFixed(2) : '0.00'} sub="Highest antibiotic usage line" color={C.teal} loading={loading} />
            <KpiCard label="HAI Tracker" value={formatNumber((data.haiRecords || []).length)} sub="If HAI table is available" color={C.info} loading={loading} />
          </div>

          <div style={grid(2, 320)}>
            <ReBarCard title="Monthly Antibiogram Summary" note="Top organism / antibiotic susceptibility lines." data={antibiogramRows} bars={[{ dataKey: 'value', color: C.primary }]} formatValue={value => `${Number(value || 0).toFixed(0)}%`} loading={loading} height={sharedChartHeight} />
            <ReBarCard title="Antibiotic Usage Report" note="Approximate DDDs per 100 bed days from prescription volume." data={dddPer100BedDays} bars={[{ dataKey: 'value', color: C.teal }]} loading={loading} height={sharedChartHeight} />
          </div>

          <div style={grid(2, 320)}>
            <SectionCard
              title="Stewardship Interventions"
              note="Counts, categories, and accepted interventions."
              actions={[
                <ActionButton key="amr-pdf" onClick={() => printReport('antibiogram_summary')}>Print PDF</ActionButton>,
                <ActionButton key="amr-xls" ghost onClick={() => exportReportExcel('antibiogram_summary')}>Excel</ActionButton>,
              ]}
            >
              <DataTable
                loading={loading}
                columns={['Type', 'Count', 'Accepted / Actioned']}
                rows={stewardshipSummaryRows.map(row => [row.type, row.count, row.outcome])}
              />
            </SectionCard>
            <SectionCard title="HAI Tracker" note="Hospital-acquired infection events if a dedicated table is available.">
              <DataTable loading={loading} columns={['Infection / Organism', 'Count']} rows={haiSummary.map(row => [row.label, row.value])} />
            </SectionCard>
          </div>

          <SectionCard title="Active Stewardship Watchlist" note="Live overlap between microbiology resistance patterns and active prescriptions.">
            <DataTable
              loading={loading}
              columns={['Patient', 'Organism', 'Department', 'Severity', 'Review']}
              rows={amrItems.slice(0, 12).map(item => [
                item.patientName,
                item.organism,
                item.department || 'Not captured',
                <Badge label={item.severity} color={item.severity === 'high' ? C.danger : item.severity === 'medium' ? C.warn : C.info} bg={item.severity === 'high' ? `${C.danger}18` : item.severity === 'medium' ? `${C.warn}18` : `${C.info}18`} />,
                item.requiresReview ? 'Awaiting pharmacist review' : 'Tracked',
              ])}
            />
          </SectionCard>
        </div>
      )}

      {tab === 'builder' && (
        <div style={{ display: 'grid', gap: 18 }}>
          <SectionCard title="Custom Report Builder" note="Choose a table, date range, filters, and columns, then preview and export.">
            <div style={{ ...grid(4, 220), marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>Table</div>
                <select
                  value={builder.table}
                  onChange={event => {
                    const option = CUSTOM_TABLE_OPTIONS.find(item => item.key === event.target.value)
                    setBuilder(current => ({
                      ...current,
                      table: event.target.value,
                      dateField: option?.dateField || 'created_at',
                      filterKey: '',
                      filterValue: '',
                      selectedColumns: [],
                    }))
                  }}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}` }}
                >
                  {CUSTOM_TABLE_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>From</div>
                <input type="date" value={builder.from} onChange={event => setBuilder(current => ({ ...current, from: event.target.value }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}` }} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>To</div>
                <input type="date" value={builder.to} onChange={event => setBuilder(current => ({ ...current, to: event.target.value }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}` }} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>Filter Column</div>
                <select value={builder.filterKey} onChange={event => setBuilder(current => ({ ...current, filterKey: event.target.value }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}` }}>
                  <option value="">None</option>
                  {customColumns.map(column => <option key={column} value={column}>{column}</option>)}
                </select>
              </div>
            </div>

            <div style={{ ...grid(3, 260), marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>Filter Value</div>
                <input value={builder.filterValue} onChange={event => setBuilder(current => ({ ...current, filterValue: event.target.value }))} placeholder="Contains..." style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}` }} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>Template Name</div>
                <input value={builder.templateName} onChange={event => setBuilder(current => ({ ...current, templateName: event.target.value }))} placeholder="e.g. Weekly OPD raw export" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}` }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'end', gap: 8, flexWrap: 'wrap' }}>
                <ActionButton onClick={() => exportCustomReport('excel')}>Export Excel</ActionButton>
                <ActionButton ghost onClick={() => exportCustomReport('csv')}>Export CSV</ActionButton>
                <ActionButton ghost onClick={saveBuilderTemplate}>Save Template</ActionButton>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>Columns</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {customColumns.map(column => {
                  const selected = builder.selectedColumns.includes(column)
                  return (
                    <button
                      key={column}
                      onClick={() => setBuilder(current => ({
                        ...current,
                        selectedColumns: selected
                          ? current.selectedColumns.filter(item => item !== column)
                          : [...current.selectedColumns, column],
                      }))}
                      style={{ border: `1px solid ${selected ? C.primary : C.border}`, background: selected ? `${C.primary}12` : '#fff', color: selected ? C.primary : C.text, padding: '6px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 11.5, fontWeight: 600 }}
                    >
                      {column}
                    </button>
                  )
                })}
              </div>
            </div>

            <DataTable
              loading={loading}
              columns={builder.selectedColumns}
              rows={customPreview.map(row => builder.selectedColumns.map(column => {
                const value = row[column]
                if (typeof value === 'object' && value !== null) return JSON.stringify(value)
                return value == null ? '—' : String(value)
              }))}
            />
          </SectionCard>

          <SectionCard title="Saved Templates" note="Reuse your favourite custom report definitions.">
            <DataTable
              loading={false}
              columns={['Template', 'Table', 'Columns', 'Created', 'Action']}
              rows={(reportingConfig.templates || []).map(template => [
                template.name,
                template.table,
                template.selectedColumns?.length || 0,
                safeDate(template.createdAt)?.toLocaleString('en-KE') || '—',
                <button key={template.id} onClick={() => loadBuilderTemplate(template)} style={{ border: 'none', background: 'transparent', color: C.primary, cursor: 'pointer', fontWeight: 700 }}>Load</button>,
              ])}
            />
          </SectionCard>
        </div>
      )}

      {tab === 'scheduled' && (
        <div style={{ display: 'grid', gap: 18 }}>
          <SectionCard title="Schedule Standard Reports" note="Set reports to auto-generate when due. Schedules persist in hospital settings when supported, with local fallback.">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {REPORT_OPTIONS.map(option => (
                <ActionButton key={option.key} ghost onClick={() => scheduleReport(option.key)}>{option.label}</ActionButton>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Scheduled Reports" note="Active daily, weekly, and monthly schedules.">
            <DataTable
              loading={false}
              columns={['Report', 'Frequency', 'Next Run', 'Last Run', 'Status']}
              rows={(reportingConfig.schedules || []).map(schedule => [
                schedule.name,
                schedule.frequency,
                safeDate(schedule.nextRunAt)?.toLocaleString('en-KE') || '—',
                safeDate(schedule.lastRunAt)?.toLocaleString('en-KE') || 'Never',
                schedule.enabled ? <Badge label="Enabled" color={C.green} bg={`${C.green}18`} /> : <Badge label="Disabled" color={C.muted} bg="#E5E7EB" />,
              ])}
            />
          </SectionCard>

          <SectionCard title="Download Log" note="History of generated reports, including manual exports and due schedules.">
            <DataTable
              loading={false}
              columns={['Report', 'Generated At', 'Mode', 'Rows']}
              rows={(reportingConfig.logs || []).map(log => [
                log.title || log.reportKey,
                safeDate(log.generatedAt)?.toLocaleString('en-KE') || '—',
                log.mode || 'manual',
                log.rowCount || 0,
              ])}
            />
          </SectionCard>
        </div>
      )}
    </div>
  )
}

