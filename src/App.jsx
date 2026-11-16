import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { HospitalContext } from './context'
import ConfirmDialog from './components/ConfirmDialog'
import AccessDenied from './components/AccessDenied'
import ErrorBoundary from './components/ErrorBoundary'
import SkeletonLoader from './components/SkeletonLoader'
import ToastViewport from './components/ToastViewport'
import { canAccessPayroll, canAccessScreen, resolveRole } from './access'
import { openConfirmDialog } from './confirmDialog'
import useAuth from './hooks/useAuth'
import useDepartments from './hooks/useDepartments'
import useOnlineSync from './hooks/useOnlineSync'
import SyncIndicator from './components/SyncIndicator'
import HelpCentre from './components/HelpCentre'
import NavGroups from './components/NavGroups'
import { canonicalDepartmentName, uniqueDepartmentNames } from './utils/departmentNames'
import { installErrorCapture } from './utils/problemReport'
import useSessionTimeout from './hooks/useSessionTimeout'
import Login from './screens/Login'
import Dashboard from './screens/Dashboard'
import HospitalWorkflowBoard from './screens/HospitalWorkflowBoard'
import { HOSPITAL_WORKFLOW_MODULES } from './screens/hospitalWorkflowModules'
import { notifyFromLegacyAlert } from './notifications'
import supabase from './supabase'
import { loadRoleOverrides } from './utils/hospitalConfig'
import { performSyncableAction } from './utils/offlineSync'
import { fetchAppNotifications, markAllNotificationsRead, markNotificationRead, APP_NOTIFICATION_TYPES } from './utils/appNotifications'
import { searchAcrossHospital, groupSearchResults } from './utils/globalSearch'
import useDebouncedValue from './utils/useDebouncedValue'
import { APP_SHORTCUTS, resolveShortcutSequence, shouldIgnoreShortcutTarget } from './utils/appShortcuts'
import { openPrintPreview, printTemplates } from './utils/printSystem'
import { buildBilingualWhatsAppMessage, generateWhatsAppLink } from './utils/whatsapp'
import { registerPwaServiceWorker } from './utils/pwa'
import { applyThemeMode, colors, getStoredThemeMode, THEME_MODES, typography } from './theme'
import hmsLogo from './assets/remedacarehms-logo.svg'

const Patients = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Patients'))
const Appointments = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Appointments'))
const Consultation = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/consultation'))
const CarePathways = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/CarePathways'))
const ChronicDisease = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/ChronicDisease'))
const HivTb = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/HivTb'))
const Emergency = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Emergency'))
const Theatre = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Theatre'))
const ICU = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/ICU'))
const PharmacyControls = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/PharmacyControls'))
const Dialysis = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Dialysis'))
const Mortuary = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Mortuary'))
const Dashboards = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Dashboards'))
const Microbiology = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Microbiology'))
const CriticalResults = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/CriticalResults'))
const ClinicalReferences = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/ClinicalReferences'))
const Maternity = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Maternity'))
const Referrals = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Referrals'))
const Wards = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Wards'))
const BloodBank = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/BloodBank'))
const Laboratory = lazy(() => import(/* @vite-chunk-name: "lab" */ './screens/Laboratory'))
const Radiology = lazy(() => import(/* @vite-chunk-name: "lab" */ './screens/Radiology'))
const Pharmacy = lazy(() => import(/* @vite-chunk-name: "pharmacy" */ './screens/pharmacy'))
const Prescriptions = lazy(() => import(/* @vite-chunk-name: "pharmacy" */ './screens/Prescriptions'))
const Expiry = lazy(() => import(/* @vite-chunk-name: "pharmacy" */ './screens/Expiry'))
const Billing = lazy(() => import(/* @vite-chunk-name: "finance" */ './screens/Billing'))
const Credit = lazy(() => import(/* @vite-chunk-name: "finance" */ './screens/Credit'))
const Mpesa = lazy(() => import(/* @vite-chunk-name: "finance" */ './screens/Mpesa'))
const Insurance = lazy(() => import(/* @vite-chunk-name: "finance" */ './screens/Insurance'))
const SHAClaims = lazy(() => import(/* @vite-chunk-name: "finance" */ './screens/SHAClaims'))
const Etims = lazy(() => import(/* @vite-chunk-name: "finance" */ './screens/Etims'))
const DrugInventory = lazy(() => import(/* @vite-chunk-name: "admin" */ './screens/Inventory'))
const HR = lazy(() => import(/* @vite-chunk-name: "admin" */ './screens/HR'))
const Reports = lazy(() => import(/* @vite-chunk-name: "admin" */ './screens/Reports'))
const Settings = lazy(() => import(/* @vite-chunk-name: "admin" */ './screens/Settings'))
const DepartmentDetail = lazy(() => import(/* @vite-chunk-name: "admin" */ './screens/department'))
const AI = lazy(() => import(/* @vite-chunk-name: "clinical-tools" */ './screens/AI'))
const Antibiogram = lazy(() => import(/* @vite-chunk-name: "clinical-tools" */ './screens/Antibiogram'))

const NAV_GROUPS = [
  {
    label: 'OVERVIEW',
    items: [{ id: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: '' }],
  },
  {
    label: 'PATIENT CARE',
    items: [
      { id: 'patients', path: '/patients', label: 'Patients', icon: '' },
      { id: 'appointments', path: '/appointments', label: 'Appointments', icon: '' },
      { id: 'consultation', path: '/consultation', label: 'Consultation', icon: '' },
      { id: 'referrals', path: '/referrals', label: 'Referrals', icon: '' },
      { id: 'care-pathways', path: '/care-pathways', label: 'Care Pathways', icon: '' },
      { id: 'references', path: '/references', label: 'Clinical guides & references', icon: '' },
      { id: 'chronic-disease', path: '/chronic-disease', label: 'Chronic Disease', icon: '' },
      { id: 'hivtb', path: '/hivtb', label: 'HIV & TB Care', icon: '' },
      { id: 'maternity', path: '/maternity', label: 'Maternity & Child Health', icon: '' },
      { id: 'telemedicine', path: '/telemedicine', label: 'Telemedicine', icon: '' },
      { id: 'ai', path: '/ai', label: 'AI Clinical Assist', icon: '' },
    ],
  },
  {
    label: 'EMERGENCY & INPATIENT',
    items: [
      { id: 'wards', path: '/wards', label: 'Ward & Beds', icon: '' },
      { id: 'dialysis', path: '/dialysis', label: 'Dialysis', icon: '' },
    ],
  },
  {
    label: 'DIAGNOSTICS',
    items: [
      { id: 'lab', path: '/laboratory', label: 'Laboratory', icon: '' },
      { id: 'radiology', path: '/radiology', label: 'Radiology', icon: '' },
      { id: 'blood-bank', path: '/blood-bank', label: 'Blood Bank', icon: '' },
      { id: 'antibiogram', path: '/antibiogram', label: 'Antibiogram & AMR', icon: '' },
      { id: 'microbiology', path: '/microbiology', label: 'Microbiology surveillance', icon: '' },
      { id: 'critical-results', path: '/critical-results', label: 'Critical results & TDM', icon: '' },
    ],
  },
  {
    label: 'PHARMACY',
    items: [
      { id: 'pharmacy', path: '/pharmacy', label: 'Pharmacy & POS', icon: '' },
      { id: 'prescriptions', path: '/prescriptions', label: 'Prescriptions', icon: '' },
      { id: 'inventory', path: '/inventory', label: 'Drug Inventory', icon: '' },
      { id: 'expiry', path: '/expiry', label: 'Expiry Alerts', icon: '' },
      { id: 'pharmacy-controls', path: '/pharmacy-controls', label: 'Controlled drugs & ward stock', icon: '' },
    ],
  },
  {
    label: 'BILLING & FINANCE',
    items: [
      { id: 'billing', path: '/billing', label: 'Billing', icon: '' },
      { id: 'credit', path: '/credit', label: 'Credit & Debts', icon: '' },
      { id: 'mpesa', path: '/mpesa', label: 'M-Pesa', icon: '' },
      { id: 'sha', path: '/sha-claims', label: 'SHA Claims', icon: '' },
      { id: 'insurance', path: '/insurance', label: 'Insurance Claims', icon: '' },
      { id: 'etims', path: '/etims', label: 'eTIMS / KRA', icon: '' },
    ],
  },
  {
    label: 'HOSPITAL MANAGEMENT',
    items: [
      { id: 'hr', path: '/hr', label: 'HR & Staff', icon: '' },
      { id: 'procurement', path: '/procurement', label: 'Procurement', icon: '' },
      { id: 'biomedical', path: '/biomedical', label: 'Biomedical', icon: '' },
      { id: 'quality-safety', path: '/quality-safety', label: 'Quality & Safety', icon: '' },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { id: 'reports', path: '/reports', label: 'Reports', icon: '' },
      { id: 'dashboards', path: '/dashboards', label: 'Management dashboards', icon: '' },
      { id: 'settings', path: '/settings', label: 'Settings', icon: '' },
    ],
  },
]

const SCREEN_PATHS = {
  dashboard: '/dashboard',
  patients: '/patients',
  appointments: '/appointments',
  consultation: '/consultation',
  'care-pathways': '/care-pathways',
  'chronic-disease': '/chronic-disease',
  referrals: '/referrals',
  wards: '/wards',
  'blood-bank': '/blood-bank',
  morgue: '/morgue',
  theatre: '/theatre',
  lab: '/laboratory',
  radiology: '/radiology',
  telemedicine: '/telemedicine',
  maternity: '/maternity',
  dialysis: '/dialysis',
  emergency: '/emergency',
  ed: '/emergency',
  'theatre-suite': '/theatre',
  icu: '/icu',
  nutrition: '/nutrition',
  hivtb: '/hivtb',
  biomedical: '/biomedical',
  'quality-safety': '/quality-safety',
  procurement: '/procurement',
  payroll: '/payroll',
  antibiogram: '/antibiogram',
  microbiology: '/microbiology',
  'critical-results': '/critical-results',
  references: '/references',
  prescriptions: '/prescriptions',
  expiry: '/expiry',
  'pharmacy-controls': '/pharmacy-controls',
  dashboards: '/dashboards',
  pharmacy: '/pharmacy',
  inventory: '/inventory',
  billing: '/billing',
  credit: '/credit',
  mpesa: '/mpesa',
  sha: '/sha-claims',
  insurance: '/insurance',
  etims: '/etims',
  hr: '/hr',
  ai: '/ai',
  reports: '/reports',
  settings: '/settings',
}
const HMS_LOGO_SRC = hmsLogo

const OFFLINE_RESTRICTED_PATHS = ['/billing', '/credit', '/mpesa', '/sha-claims', '/insurance', '/etims']
const SEARCH_CATEGORY_ICONS = {
  Patients: 'Patient',
  Invoices: 'Receipt',
  Staff: 'Staff',
  Drugs: 'Drug',
}
const ACTIVE_BRANCH_STORAGE_PREFIX = 'remedacare:active_branch:'
const DEFAULT_ZOOM_FACTOR = 1
const MIN_ZOOM_FACTOR = 0.75
const MAX_ZOOM_FACTOR = 1.5

function buildPath(target, params = null) {
  const request = typeof target === 'string' ? { screen: target, ...(params || {}) } : (target || {})
  if (request.screen === 'department') {
    const departmentName = request.department || request.departmentName || request.name || ''
    return departmentName ? `/departments/${encodeURIComponent(departmentName)}` : '/hr'
  }

  return SCREEN_PATHS[request.screen] || '/dashboard'
}

function getDepartmentNameFromPath(pathname) {
  if (!pathname.startsWith('/departments/')) return null
  return decodeURIComponent(pathname.replace('/departments/', ''))
}

function getBranchStorageKey(userId) {
  return `${ACTIVE_BRANCH_STORAGE_PREFIX}${userId || 'anonymous'}`
}

function readStoredBranchId(userId) {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(getBranchStorageKey(userId))
  } catch (_) {
    return null
  }
}

function writeStoredBranchId(userId, branchId) {
  if (typeof window === 'undefined' || !branchId) return
  try {
    window.localStorage.setItem(getBranchStorageKey(userId), String(branchId))
  } catch (_) {
    // Ignore storage failures
  }
}

function normalizeBranchRecord(record = {}, access = {}) {
  const status = record.branch_status || 'Active'
  return {
    id: String(record.id || access.hospital_id || ''),
    name: record.name || 'Hospital Branch',
    branchCode: record.branch_code || '',
    county: record.county || '',
    subCounty: record.sub_county || '',
    location: record.location || '',
    networkId: record.network_id || null,
    isMainBranch: record.is_main_branch === true,
    status,
    accessRole: access.role || null,
    isPrimaryAccess: access.is_primary === true,
  }
}

function sortBranches(left, right) {
  if ((left.isPrimaryAccess ? 1 : 0) !== (right.isPrimaryAccess ? 1 : 0)) {
    return left.isPrimaryAccess ? -1 : 1
  }
  if ((left.isMainBranch ? 1 : 0) !== (right.isMainBranch ? 1 : 0)) {
    return left.isMainBranch ? -1 : 1
  }
  return String(left.name || '').localeCompare(String(right.name || ''))
}

function buildBranchOptionLabel(branch) {
  const tags = []
  if (branch.branchCode) tags.push(branch.branchCode)
  if (branch.isMainBranch) tags.push('Main')
  if (branch.county) tags.push(branch.county)
  return tags.length ? `${branch.name} (${tags.join(' • ')})` : branch.name
}

function ScreenFrame({ label, children }) {
  return <ErrorBoundary label={label}>{children}</ErrorBoundary>
}

function RouteFallback() {
  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ maxWidth: '360px' }}>
        <SkeletonLoader rows={4} height={14} width={['42%', '100%', '88%', '68%']} />
      </div>
    </div>
  )
}

function ShellModal({ title, subtitle, onClose, children, width = 760 }) {
  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={{ ...styles.modalCard, maxWidth: width }} onClick={(event) => event.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div>
            <div style={styles.modalTitle}>{title}</div>
            {subtitle ? <div style={styles.modalSubtitle}>{subtitle}</div> : null}
          </div>
          <button type="button" style={styles.modalClose} onClick={onClose} aria-label="Close" title="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Breadcrumbs({ items, onNavigate }) {
  if (!items?.length) return null
  return (
    <div style={styles.breadcrumbs}>
      {items.map((item, index) => (
        <div key={`${item.path}-${index}`} style={styles.breadcrumbItem}>
          {index > 0 ? <span style={styles.breadcrumbSep}>/</span> : null}
          {item.path && index < items.length - 1 ? (
            <button type="button" style={styles.breadcrumbLink} onClick={() => onNavigate(item.path)}>
              {item.label}
            </button>
          ) : (
            <span style={styles.breadcrumbCurrent}>{item.label}</span>
          )}
        </div>
      ))}
    </div>
  )
}

function LaboratoryRoute({ navigateApp }) {
  return <Laboratory onNavigateAntibiogram={() => navigateApp('antibiogram')} />
}

function AntibiogramRoute({ navigateApp }) {
  return (
    <Antibiogram
      onNavigateLab={() => navigateApp('lab')}
      onNavigateAI={() => navigateApp('ai')}
    />
  )
}

function HRRoute({ navigateApp }) {
  return <HR onNavigateDepartment={(department) => navigateApp('department', { department })} />
}

function DepartmentRoute({ navigateApp }) {
  const { departmentName } = useParams()
  const selectedDepartment = departmentName ? decodeURIComponent(departmentName) : null
  return <DepartmentDetail department={selectedDepartment} onBack={() => navigateApp('hr')} />
}

function AppShell() {
  const routerNavigate = useNavigate()
  const location = useLocation()
  // Phones / tablets: the sidebar is a slide-in drawer, closed whenever the page changes.
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => { setNavOpen(false) }, [location.pathname])


  useEffect(() => {
    const originalAlert = window.alert
    const originalConfirm = window.openConfirmDialog
    const originalLegacyNotify = window.notifyFromLegacyAlert
    window.alert = (message) => notifyFromLegacyAlert(message)
    window.openConfirmDialog = (message, options) => openConfirmDialog(message, options)
    window.notifyFromLegacyAlert = (message) => notifyFromLegacyAlert(message)

    return () => {
      window.alert = originalAlert
      if (typeof originalConfirm === 'function') {
        window.openConfirmDialog = originalConfirm
      } else {
        delete window.openConfirmDialog
      }
      if (typeof originalLegacyNotify === 'function') {
        window.notifyFromLegacyAlert = originalLegacyNotify
      } else {
        delete window.notifyFromLegacyAlert
      }
    }
  }, [])

  const navigateApp = useCallback((target, params = null) => {
    const request = typeof target === 'string' ? { screen: target, ...(params || {}) } : (target || {})
    const nextPath = buildPath(request)
    const state = Object.keys(request).length > 1 ? request : null
    routerNavigate(nextPath, state ? { state } : undefined)
  }, [routerNavigate])

  const handleSignedOut = useCallback(() => {
    setDepartmentsOpen(false)
    routerNavigate('/dashboard', { replace: true, state: null })
  }, [routerNavigate])

  const {
    user,
    hospitalId,
    hospitalName,
    userRole: homeRole,
    userDepartment,
    authError,
    checkingAuth,
    isPasswordRecovery,
    sessionTimeoutMinutes,
    offlineMode,
    loginBranding,
    postLoginRedirectPath,
    handleLogin,
    handleLogout,
    handleTimeoutLogout,
    consumePostLoginRedirect,
    resetPasswordRecovery,
  } = useAuth({ onSignedOut: handleSignedOut })

  const [deepLinkRecovery, setDeepLinkRecovery] = useState(false)
  const [deepLinkActivation, setDeepLinkActivation] = useState('')
  const [idleWarning, setIdleWarning] = useState(null)
  const [themeMode, setThemeMode] = useState(() => getStoredThemeMode())
  const [zoomFactor, setZoomFactor] = useState(DEFAULT_ZOOM_FACTOR)
  const [hospitalProfile, setHospitalProfile] = useState({ name: hospitalName || '', logoBase64: '', address: '', phone: '', email: '', county: '', facilityCode: '', shaProviderNumber: '' })
  const [availableBranches, setAvailableBranches] = useState([])
  const [branchNetwork, setBranchNetwork] = useState(null)
  const [activeBranchId, setActiveBranchId] = useState(null)
  const [branchCompatMode, setBranchCompatMode] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchTerm, setGlobalSearchTerm] = useState('')
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalSearchResults, setGlobalSearchResults] = useState([])
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [appNotifications, setAppNotifications] = useState([])
  const [notificationsCompat, setNotificationsCompat] = useState(false)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const [helpTab, setHelpTab] = useState(null)
  useEffect(() => installErrorCapture(), [])
  const shortcutSequenceRef = useRef([])
  const shortcutTimerRef = useRef(null)
  const globalSearchDebounced = useDebouncedValue(globalSearchTerm, 300)
  const effectiveHospitalId = activeBranchId || hospitalId
  const zoomSupported = typeof window !== 'undefined' && Boolean(window.electronAPI?.getZoomFactor)
  const activeBranch = useMemo(
    () => availableBranches.find((item) => String(item.id) === String(effectiveHospitalId)) || null,
    [availableBranches, effectiveHospitalId],
  )
  const effectiveHospitalName = activeBranch?.name || hospitalName
  // Per-site roles: at another facility the user works with that facility's role (its staff / hospital_users row)
  const userRole = (activeBranch && String(activeBranch.id) !== String(hospitalId) && activeBranch.accessRole) || homeRole
  const zoomPercentLabel = `${Math.round((zoomFactor || DEFAULT_ZOOM_FACTOR) * 100)}%`
  const canZoomOut = zoomFactor > MIN_ZOOM_FACTOR + 0.001
  const canZoomIn = zoomFactor < MAX_ZOOM_FACTOR - 0.001
  const recoveryMode = isPasswordRecovery || deepLinkRecovery
  const activationMode = Boolean(deepLinkActivation)

  const handleResetDone = useCallback(() => {
    resetPasswordRecovery()
    setDeepLinkRecovery(false)
    setDeepLinkActivation('')
  }, [resetPasswordRecovery])

  const runZoomAction = useCallback(async (actionName) => {
    if (!zoomSupported) return
    const action = window.electronAPI?.[actionName]
    if (typeof action !== 'function') return
    try {
      const factor = await action()
      if (Number.isFinite(factor)) setZoomFactor(factor)
    } catch (error) {
      console.error(`Zoom action failed: ${actionName}`, error)
    }
  }, [zoomSupported])

  const handleZoomOut = useCallback(() => {
    void runZoomAction('zoomOut')
  }, [runZoomAction])

  const handleResetZoom = useCallback(() => {
    void runZoomAction('resetZoom')
  }, [runZoomAction])

  const handleZoomIn = useCallback(() => {
    void runZoomAction('zoomIn')
  }, [runZoomAction])

  useEffect(() => {
    applyThemeMode(themeMode)
  }, [themeMode])

  useEffect(() => {
    if (!zoomSupported) return undefined

    let active = true
    void window.electronAPI.getZoomFactor()
      .then((factor) => {
        if (active && Number.isFinite(factor)) setZoomFactor(factor)
      })
      .catch(() => {})

    const unsubscribe = typeof window.electronAPI.onZoomChanged === 'function'
      ? window.electronAPI.onZoomChanged((factor) => {
        if (Number.isFinite(factor)) setZoomFactor(factor)
      })
      : null

    return () => {
      active = false
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [zoomSupported])

  useEffect(() => {
    registerPwaServiceWorker()
  }, [])

  useEffect(() => {
    if (!user?.id || !hospitalId) {
      setAvailableBranches([])
      setActiveBranchId(null)
      setBranchNetwork(null)
      setBranchCompatMode(false)
      return
    }

    let active = true
    void (async () => {
      let compatMode = false
      let accessRows = []

      const primaryAccessRes = await supabase
        .from('hospital_users')
        .select('hospital_id, role, active, is_primary')
        .eq('user_id', user.id)

      if (primaryAccessRes.error) {
        compatMode = true
        const fallbackAccessRes = await supabase
          .from('hospital_users')
          .select('hospital_id, role, active')
          .eq('user_id', user.id)
        accessRows = (fallbackAccessRes.data || []).map((row) => ({ ...row, is_primary: false }))
      } else {
        accessRows = primaryAccessRes.data || []
      }

      const accessMap = new Map(
        accessRows
          .filter((row) => row?.hospital_id && row.active !== false)
          .map((row) => [String(row.hospital_id), row]),
      )

      const branchIds = [...new Set([hospitalId, ...Array.from(accessMap.keys())].filter(Boolean).map(String))]
      let branchRows = []
      const branchSelect = 'id, name, network_id, branch_code, is_main_branch, branch_status, county, sub_county, location'
      const branchRes = await supabase
        .from('hospitals')
        .select(branchSelect)
        .in('id', branchIds)

      if (branchRes.error) {
        compatMode = true
        const fallbackBranchRes = await supabase
          .from('hospitals')
          .select('id, name, location')
          .in('id', branchIds)
        branchRows = fallbackBranchRes.data || []
      } else {
        branchRows = branchRes.data || []
      }

      // The role at each facility comes from that facility's staff record (hospital_users.role can be a generic 'staff')
      const staffRoleByBranch = new Map()
      if (user.email) {
        const staffRes = await supabase.from('staff').select('hospital_id, role, status').ilike('email', user.email).in('hospital_id', branchIds)
        for (const row of staffRes.data || []) {
          if (row?.role && !/suspend|terminat|reject/i.test(String(row.status || ''))) staffRoleByBranch.set(String(row.hospital_id), row.role)
        }
      }

      const branchMap = new Map(branchRows.map((row) => [String(row.id), row]))
      const branches = branchIds
        .map((branchId) => normalizeBranchRecord(
          branchMap.get(String(branchId)) || {
            id: branchId,
            name: String(branchId) === String(hospitalId) ? (hospitalName || 'Hospital Branch') : 'Hospital Branch',
          },
          {
            ...(accessMap.get(String(branchId)) || { hospital_id: branchId, role: homeRole, is_primary: String(branchId) === String(hospitalId) }),
            ...(staffRoleByBranch.has(String(branchId)) ? { role: staffRoleByBranch.get(String(branchId)) } : {}),
          },
        ))
        .filter((branch) => branch.id)
        .sort(sortBranches)

      let networkRecord = null
      const networkId = branches.find((branch) => branch.networkId)?.networkId || null
      if (networkId) {
        const networkRes = await supabase
          .from('hospital_networks')
          .select('id, name')
          .eq('id', networkId)
          .maybeSingle()
        if (!networkRes.error) {
          networkRecord = networkRes.data || null
        } else {
          compatMode = true
        }
      }

      const storedBranchId = readStoredBranchId(user.id)
      const preferredBranchId =
        branches.find((branch) => String(branch.id) === String(storedBranchId) && branch.status !== 'Archived')?.id
        || branches.find((branch) => String(branch.id) === String(hospitalId))?.id
        || branches.find((branch) => branch.isPrimaryAccess)?.id
        || branches[0]?.id
        || null

      if (!active) return

      setAvailableBranches(branches)
      setActiveBranchId(preferredBranchId)
      setBranchNetwork(networkRecord)
      setBranchCompatMode(compatMode)
      if (preferredBranchId) {
        writeStoredBranchId(user.id, preferredBranchId)
      }
    })()

    return () => {
      active = false
    }
  }, [hospitalId, hospitalName, user?.id, user?.email, homeRole])

  // Role matrix from Settings → Configuration; re-render the menus once loaded or after an admin saves it
  const [, setRoleConfigVersion] = useState(0)
  useEffect(() => {
    let active = true
    const load = () => loadRoleOverrides(supabase, effectiveHospitalId).then(() => { if (active) setRoleConfigVersion((v) => v + 1) })
    void load()
    window.addEventListener('rc-role-config-changed', load)
    return () => { active = false; window.removeEventListener('rc-role-config-changed', load) }
  }, [effectiveHospitalId])

  // FIXED: Deep link handler that restores session from tokens
  useEffect(() => {
    if (!window?.electronAPI?.onDeepLink) return undefined

    let active = true

    const unsubscribe = window.electronAPI.onDeepLink(async (url) => {
      if (!active) return

      console.log('Deep link received:', url)

      const urlObj = new URL(url)
      const hashParams = new URLSearchParams(urlObj.hash.replace(/^#/, ''))
      const queryParams = new URLSearchParams(urlObj.search.replace(/^\?/, ''))
      const params = new URLSearchParams()
      hashParams.forEach((value, key) => params.set(key, value))
      queryParams.forEach((value, key) => params.set(key, value))

      const type = String(params.get('type') || '').toLowerCase()
      const host = String(urlObj.host || '').toLowerCase()
      const pathname = String(urlObj.pathname || '').toLowerCase()
      const accessToken = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      const code = params.get('code')

      const isRecoveryLink = type === 'recovery' || host === 'reset' || pathname.includes('/reset')
      const isActivationLink = type === 'signup' || type === 'invite' || type === 'confirmation' || host === 'activate' || pathname.includes('/activate')

      if (!isRecoveryLink && !isActivationLink) {
        return
      }

      try {
        if (isRecoveryLink) {
          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })

            if (error) {
              console.error('Session restore failed:', error)
            } else {
              console.log('Auth session restored successfully')
            }
          } else if (code) {
            const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
            if (exchangeError) {
              console.error('Code exchange failed:', exchangeError)
            } else {
              console.log('Auth session restored from code successfully')
            }
          } else {
            console.warn('Missing auth credentials in deep link URL')
          }
        } else if (isActivationLink) {
          console.log('Activation link detected; skipping session restore.')
        }

        if (active) {
          if (isRecoveryLink) {
            setDeepLinkRecovery(true)
            setDeepLinkActivation('')
          } else if (isActivationLink) {
            setDeepLinkActivation(
              'Email confirmed. Your email address is ready. Enter your password to sign in.',
            )
            setDeepLinkRecovery(false)
          }
        }
      } catch (e) {
        console.error('Deep link session error:', e)
        if (isRecoveryLink && code) {
          try {
            const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
            if (exchangeError) {
              console.error('Fallback code exchange failed:', exchangeError)
            }
          } catch (exchangeError) {
            console.error('Fallback code exchange threw:', exchangeError)
          }
        }
        if (active) {
          if (isRecoveryLink) {
            setDeepLinkRecovery(true)
            setDeepLinkActivation('')
          } else if (isActivationLink) {
            setDeepLinkActivation('Email confirmed. Your email address is ready. Enter your password to sign in.')
            setDeepLinkRecovery(false)
          }
        }
      }
    })

    return () => {
      active = false
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  const handleSessionTimeout = useCallback(async () => {
    await handleTimeoutLogout(location.pathname)
  }, [handleTimeoutLogout, location.pathname])

  const switchBranch = useCallback((nextBranchId) => {
    if (!nextBranchId) return
    setActiveBranchId(String(nextBranchId))
    writeStoredBranchId(user?.id, nextBranchId)
  }, [user?.id])

  const sessionControls = useSessionTimeout({
    onTimeout: handleSessionTimeout,
    timeoutMinutes: sessionTimeoutMinutes,
    warningMinutes: 2,
    onWarning: ({ extendSession, logoutNow, warningMinutes }) => {
      setIdleWarning({ extendSession, logoutNow, warningMinutes })
    },
  })

  const { departments, departmentsLoading, loadDepartments } = useDepartments(effectiveHospitalId)
  const { isOnlineState, syncStatus, queue: offlineQueue, syncPendingActions: syncOfflineNow, applyAnyway: applyOfflineAnyway, discard: discardOffline } = useOnlineSync()

  useEffect(() => {
    if (!effectiveHospitalId) {
      setHospitalProfile((previous) => ({ ...previous, name: effectiveHospitalName || loginBranding?.hospitalName || 'RemedacareHMS' }))
      return
    }

    let active = true
    void (async () => {
      const { data } = await supabase
        .from('hospital_settings')
        .select('branding_config')
        .eq('hospital_id', effectiveHospitalId)
        .maybeSingle()

      if (!active) return
      const brandingConfig = data?.branding_config || {}
      setHospitalProfile({
        name: brandingConfig?.hospital_name || effectiveHospitalName || loginBranding?.hospitalName || 'RemedacareHMS',
        logoBase64: brandingConfig?.logo_data_url || brandingConfig?.logo_base64 || '',
        address: brandingConfig?.physical_address || '',
        phone: brandingConfig?.phone || '',
        email: brandingConfig?.email || '',
        county: brandingConfig?.county || '',
        facilityCode: brandingConfig?.moh_facility_code || '',
        shaProviderNumber: brandingConfig?.sha_provider_number || '',
      })
    })()

    return () => {
      active = false
    }
  }, [effectiveHospitalId, effectiveHospitalName, loginBranding?.hospitalName])

  const loadNotifications = useCallback(async () => {
    if (!effectiveHospitalId) {
      setAppNotifications([])
      return
    }
    const result = await fetchAppNotifications(effectiveHospitalId, 50)
    setAppNotifications(result.rows)
    setNotificationsCompat(result.compat)
  }, [effectiveHospitalId])

  useEffect(() => {
    void loadNotifications()
  }, [loadNotifications])

  useEffect(() => {
    if (!effectiveHospitalId) return undefined
    const channel = supabase
      .channel(`app-notifications-${effectiveHospitalId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `hospital_id=eq.${effectiveHospitalId}` }, () => { void loadNotifications() })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [effectiveHospitalId, loadNotifications])

  useEffect(() => {
    if (!user || !postLoginRedirectPath) return
    if (location.pathname === postLoginRedirectPath) {
      consumePostLoginRedirect()
      return
    }
    routerNavigate(postLoginRedirectPath, { replace: true })
    consumePostLoginRedirect()
  }, [consumePostLoginRedirect, location.pathname, postLoginRedirectPath, routerNavigate, user])

  useEffect(() => {
    if (!globalSearchOpen) {
      setGlobalSearchResults([])
      setGlobalSearchLoading(false)
      return
    }
    if (!effectiveHospitalId || !globalSearchDebounced || globalSearchDebounced.trim().length < 2) {
      setGlobalSearchResults([])
      setGlobalSearchLoading(false)
      return
    }

    let active = true
    setGlobalSearchLoading(true)
    void searchAcrossHospital({ hospitalId: effectiveHospitalId, query: globalSearchDebounced })
      .then((results) => {
        if (!active) return
        setGlobalSearchResults(results)
        setGlobalSearchLoading(false)
      })
      .catch(() => {
        if (!active) return
        setGlobalSearchResults([])
        setGlobalSearchLoading(false)
      })

    return () => {
      active = false
    }
  }, [effectiveHospitalId, globalSearchDebounced, globalSearchOpen])

  const openGlobalSearch = useCallback(() => {
    setGlobalSearchOpen(true)
    setGlobalSearchTerm('')
  }, [])

  const handleSearchResultOpen = useCallback((result) => {
    if (!result?.path) return
    setGlobalSearchOpen(false)
    setGlobalSearchTerm('')
    routerNavigate(result.path, { state: result.state || null })
  }, [routerNavigate])

  const navigateFromShortcut = useCallback((path) => {
    routerNavigate(path)
  }, [routerNavigate])

  useEffect(() => {
    const clearShortcutSequence = () => {
      shortcutSequenceRef.current = []
      if (shortcutTimerRef.current) {
        window.clearTimeout(shortcutTimerRef.current)
        shortcutTimerRef.current = null
      }
    }

    const commitSequence = () => {
      const { exact, hasLongerPrefix } = resolveShortcutSequence(shortcutSequenceRef.current)
      if (exact && !hasLongerPrefix) {
        navigateFromShortcut(exact.path)
        clearShortcutSequence()
        return
      }
      if (exact && hasLongerPrefix) {
        if (shortcutTimerRef.current) window.clearTimeout(shortcutTimerRef.current)
        shortcutTimerRef.current = window.setTimeout(() => {
          navigateFromShortcut(exact.path)
          clearShortcutSequence()
        }, 360)
        return
      }
      if (!hasLongerPrefix) {
        clearShortcutSequence()
      }
    }

    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openGlobalSearch()
        return
      }

      if (event.key === '?' && !shouldIgnoreShortcutTarget(event.target)) {
        event.preventDefault()
        setShortcutHelpOpen(true)
        return
      }

      if (shouldIgnoreShortcutTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return

      const key = event.key.toLowerCase()
      if (!/^[a-z]$/.test(key)) return

      const nextSequence = [...shortcutSequenceRef.current, key].slice(-3)
      shortcutSequenceRef.current = nextSequence
      commitSequence()

      if (shortcutTimerRef.current) window.clearTimeout(shortcutTimerRef.current)
      shortcutTimerRef.current = window.setTimeout(() => {
        clearShortcutSequence()
      }, 900)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      clearShortcutSequence()
    }
  }, [navigateFromShortcut, openGlobalSearch])

  const navigationState = location.state || null
  const clearNavigationState = useCallback(() => {
    if (!location.state) return
    routerNavigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, routerNavigate])

  // One entry per real department: spellings and synonyms ("Psychiatry" / "Mental Health") are merged.
  const departmentNames = uniqueDepartmentNames(departments.map((department) => department.name))

  const visibleDepartmentNames = (() => {
    const resolved = resolveRole(userRole)
    if (resolved === 'Admin') return departmentNames
    if (departmentsLoading || !userRole) return departmentNames
    if (!userDepartment) return departmentNames
    const own = canonicalDepartmentName(userDepartment)
    const filtered = departmentNames.filter(n => n === own)
    return filtered.length > 0 ? filtered : departmentNames
  })()
  
  const selectedDepartment = getDepartmentNameFromPath(location.pathname)
  const userInitials = (user?.email || 'U').slice(0, 2).toUpperCase()
  const resolvedRole = resolveRole(userRole)
  const isAdmin = resolvedRole === 'Admin'
  const canSeePayroll = canAccessPayroll(userRole) || isAdmin
  const financialActionsBlocked = offlineMode || !isOnlineState
  const unreadNotifications = appNotifications.filter((item) => !item.is_read && !item.read_at).length
  const accountDisplayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'Signed-in account'
  const accountDisplayRole = resolvedRole === 'Admin' ? 'Administrator' : (resolvedRole || 'User')
  const accountAvatarText = accountDisplayName.slice(0, 1).toUpperCase()
  const groupedSearchResults = useMemo(() => groupSearchResults(globalSearchResults), [globalSearchResults])
  const shortcutGroups = useMemo(() => {
    const baseShortcuts = APP_SHORTCUTS.filter((item) => item.type !== 'command' || item.id !== 'help')
    if (!zoomSupported) return baseShortcuts
    return [
      ...baseShortcuts,
      { id: 'zoom-in', label: 'Zoom in', combo: 'Ctrl/Cmd + Plus' },
      { id: 'zoom-out', label: 'Zoom out', combo: 'Ctrl/Cmd + -' },
      { id: 'zoom-reset', label: 'Reset zoom', combo: 'Ctrl/Cmd + 0' },
    ]
  }, [zoomSupported])
  const printApi = useMemo(() => ({
    receipt: (bodyHtml) => printTemplates.receipt(bodyHtml, hospitalProfile),
    labReport: (bodyHtml) => printTemplates.labReport(bodyHtml, hospitalProfile),
    prescription: (bodyHtml) => printTemplates.prescription(bodyHtml, hospitalProfile),
    referralLetter: (bodyHtml) => printTemplates.referralLetter(bodyHtml, hospitalProfile),
    lpo: (bodyHtml) => printTemplates.lpo(bodyHtml, hospitalProfile),
    dischargeSummary: (bodyHtml) => printTemplates.dischargeSummary(bodyHtml, hospitalProfile),
  }), [hospitalProfile])
  const currentScreenLabel = useMemo(() => {
    const direct = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.path === location.pathname)
    if (direct) return direct.label
    if (location.pathname.startsWith('/departments/')) return selectedDepartment || 'Department'
    return 'Dashboard'
  }, [location.pathname, selectedDepartment])
  // First sign-in on this computer for this user and role: show the quick-start once.
  useEffect(() => {
    if (!user?.id || !resolvedRole) return
    const key = `rc-quickstart-seen:${user.id}:${resolvedRole}`
    try {
      if (window.localStorage.getItem(key)) return
      window.localStorage.setItem(key, new Date().toISOString())
    } catch { return }
    setHelpTab('start')
  }, [user?.id, resolvedRole])
  const breadcrumbItems = useMemo(() => {
    if (location.pathname === '/dashboard') return [{ label: 'Dashboard', path: null }]
    if (location.pathname.startsWith('/departments/')) {
      return [
        { label: 'Dashboard', path: '/dashboard' },
        { label: 'HR & Staff', path: '/hr' },
        { label: selectedDepartment || 'Department', path: null },
      ]
    }
    return [
      { label: 'Dashboard', path: '/dashboard' },
      { label: currentScreenLabel, path: null },
    ]
  }, [currentScreenLabel, location.pathname, selectedDepartment])
  
  const visibleNavGroups = NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => item.path !== '/payroll' || canSeePayroll)
        .filter((item) => (isAdmin || canAccessScreen(userRole, item.path)) && !(financialActionsBlocked && OFFLINE_RESTRICTED_PATHS.includes(item.path))),
    }))
    .filter((group) => group.items.length > 0)

  function renderProtectedRoute(path, label, element) {
    const allowed = (isAdmin || canAccessScreen(userRole, path)) && !(financialActionsBlocked && OFFLINE_RESTRICTED_PATHS.includes(path))
    const content = allowed
      ? element
      : <AccessDenied role={userRole} screen={financialActionsBlocked && OFFLINE_RESTRICTED_PATHS.includes(path) ? 'Offline mode blocks financial workflows on this screen.' : path} />

    return (
      <Route
        path={path}
        element={(
          <ScreenFrame label={label}>
            <Suspense fallback={<RouteFallback />}>
              {content}
            </Suspense>
          </ScreenFrame>
        )}
      />
    )
  }

  const handleNotificationClick = useCallback(async (item) => {
    await markNotificationRead(item.id)
    await loadNotifications()
    setNotificationCenterOpen(false)
    if (item.target_path) {
      routerNavigate(item.target_path, { state: item.payload_json || null })
    }
  }, [loadNotifications, routerNavigate])

  const handleMarkAllNotificationsRead = useCallback(async () => {
    await markAllNotificationsRead(effectiveHospitalId)
    await loadNotifications()
  }, [effectiveHospitalId, loadNotifications])

  const toggleThemeMode = useCallback(() => {
    setThemeMode((previous) => (previous === THEME_MODES.dark ? THEME_MODES.light : THEME_MODES.dark))
  }, [])

  const contextValue = useMemo(() => ({
    hospitalId: effectiveHospitalId,
    hospitalName: effectiveHospitalName,
    rootHospitalId: hospitalId,
    branchId: effectiveHospitalId,
    branchName: activeBranch?.name || effectiveHospitalName,
    networkName: branchNetwork?.name || '',
    availableBranches,
    switchBranch,
    hospitalProfile,
    userRole,
    departments,
    departmentsLoading,
    refreshDepartments: loadDepartments,
    navigate: navigateApp,
    navigationState,
    clearNavigationState,
    isOnline: isOnlineState,
    syncStatus,
    themeMode,
    toggleThemeMode,
    openGlobalSearch,
    openPrintPreview: (options) => openPrintPreview({ hospitalProfile, ...(options || {}) }),
    printTemplates: printApi,
    generateWhatsAppLink,
    buildBilingualWhatsAppMessage,
    performSyncableAction: (action) => performSyncableAction(supabase, action),
  }), [
    activeBranch?.name,
    availableBranches,
    branchNetwork?.name,
    clearNavigationState,
    departments,
    departmentsLoading,
    effectiveHospitalId,
    effectiveHospitalName,
    hospitalId,
    hospitalProfile,
    isOnlineState,
    loadDepartments,
    navigateApp,
    navigationState,
    openGlobalSearch,
    printApi,
    switchBranch,
    syncStatus,
    themeMode,
    toggleThemeMode,
    userRole,
  ])

  if (checkingAuth) {
    if (recoveryMode || activationMode) {
      return (
        <Login
          onLogin={handleLogin}
          isPasswordRecovery={recoveryMode}
          activationMessage={deepLinkActivation}
          onResetDone={handleResetDone}
          branding={loginBranding}
        />
      )
    }

    return (
      <div style={styles.fullscreen}>
        <div style={{ width: '220px' }}>
          <SkeletonLoader rows={3} height={14} width={['40%', '100%', '70%']} />
          <p style={{ color: colors.sub, fontSize: '13px' }}>Loading RemedacareHMS...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <Login
        onLogin={handleLogin}
        isPasswordRecovery={recoveryMode}
        activationMessage={deepLinkActivation}
        onResetDone={handleResetDone}
        branding={loginBranding}
      />
    )
  }

  if (authError) {
    return (
      <div style={{ ...styles.fullscreen, padding: 24 }}>
        <div style={styles.authCard}>
          <h1 style={{ margin: 0, color: colors.text }}>Account issue detected</h1>
          <p style={{ color: colors.sub, marginTop: 16, lineHeight: 1.7 }}>
            {authError}
          </p>
          <button style={styles.authButton} onClick={handleLogout}>
            Sign out and try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <HospitalContext.Provider value={contextValue}>
      <div style={styles.container}>
        <style>{RESPONSIVE_CSS}</style>
        {navOpen && <div className="rc-nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}
        <aside id="rc-sidebar" className={`rc-sidebar${navOpen ? ' open' : ''}`} style={styles.sidebar} aria-label="Main menu">
          <div style={styles.logoArea}>
            <img src={hospitalProfile.logoBase64 || loginBranding?.logoBase64 || HMS_LOGO_SRC} alt="RemedacareHMS logo" style={styles.brandLogo} />
            <div style={{ minWidth: 0 }}>
              <p style={styles.logoText}>REMEDACARE HMS</p>
              <p style={styles.logoSub}>{effectiveHospitalName || 'Hospital workspace'}</p>
            </div>
          </div>

          <div style={styles.nav}>
            <NavGroups
              groups={[
                ...visibleNavGroups.map((group) => (group.label === 'OVERVIEW' ? { ...group, link: true } : group)),
                {
                  label: 'DEPARTMENTS', divider: true, loading: departmentsLoading, emptyText: 'No departments added yet',
                  items: visibleDepartmentNames.map((name) => ({ id: `dept:${name}`, path: `/departments/${encodeURIComponent(name)}`, label: name, department: name })),
                },
              ]}
              activePath={selectedDepartment ? `/departments/${encodeURIComponent(canonicalDepartmentName(selectedDepartment))}` : location.pathname}
              onNavigate={(item) => (item.department ? navigateApp('department', { department: item.department }) : navigateApp(item.id))}
            />
          </div>

          <div style={styles.userBar}>
            <div style={styles.avatar}>{userInitials}</div>
            <div style={styles.userInfo}>
              <p style={styles.userName}>{user?.email || 'Signed in user'}</p>
              <p style={styles.userRole}>{userRole || 'User'}</p>
            </div>
            <button type="button" style={styles.logoutBtn} onClick={handleLogout} title="Sign out">
              ↩
            </button>
          </div>
        </aside>

        <main className="rc-main" style={styles.main}>
          <div style={styles.topbar}>
            <button type="button" className="rc-menu-btn" aria-label={navOpen ? 'Close menu' : 'Open menu'} aria-expanded={navOpen} aria-controls="rc-sidebar"
              onClick={() => setNavOpen((v) => !v)}>☰</button>
            <div style={{ minWidth: 0 }}>
              <Breadcrumbs items={breadcrumbItems} onNavigate={(path) => routerNavigate(path)} />
              <div style={styles.screenTitle}>{currentScreenLabel}</div>
              <div style={styles.screenSubtitle}>
                {hospitalProfile.name || effectiveHospitalName || 'Hospital workspace'}
                {branchNetwork?.name ? ` • ${branchNetwork.name}` : ''}
                {activeBranch?.branchCode ? ` • ${activeBranch.branchCode}` : ''}
                {branchCompatMode ? ' • Branch access running in compatibility mode' : ''}
                {notificationsCompat ? ' • Notification centre running in compatibility mode' : ''}
              </div>
            </div>
            <div style={styles.topbarActions}>
              {availableBranches.length > 1 ? (
                <label style={styles.branchSelectWrap}>
                  <span style={styles.branchSelectLabel}>Branch</span>
                  <select
                    style={styles.branchSelect}
                    value={effectiveHospitalId || ''}
                    onChange={(event) => switchBranch(event.target.value)}
                  >
                    {availableBranches.map((branch) => (
                      <option key={branch.id} value={branch.id} disabled={branch.status === 'Archived'}>
                        {buildBranchOptionLabel(branch)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button type="button" style={styles.searchButton} onClick={openGlobalSearch}>
                Search
                <span style={styles.searchHint}>Ctrl/Cmd + K</span>
              </button>
              {zoomSupported ? (
                <div style={styles.zoomControl}>
                  <button
                    type="button"
                    style={{ ...styles.zoomBtn, ...(canZoomOut ? {} : styles.zoomBtnDisabled) }}
                    onClick={handleZoomOut}
                    title="Zoom out (Ctrl/Cmd + -)"
                    disabled={!canZoomOut}
                  >
                    -
                  </button>
                  <button
                    type="button"
                    style={styles.zoomReadoutBtn}
                    onClick={handleResetZoom}
                    title="Reset zoom (Ctrl/Cmd + 0)"
                  >
                    {zoomPercentLabel}
                  </button>
                  <button
                    type="button"
                    style={{ ...styles.zoomBtn, ...(canZoomIn ? {} : styles.zoomBtnDisabled) }}
                    onClick={handleZoomIn}
                    title="Zoom in (Ctrl/Cmd + Plus)"
                    disabled={!canZoomIn}
                  >
                    +
                  </button>
                </div>
              ) : null}
              <button type="button" style={styles.headerIconBtn} onClick={toggleThemeMode} title="Toggle dark mode">
                {themeMode === THEME_MODES.dark ? 'Light' : 'Dark'}
              </button>
              <button type="button" style={styles.headerIconBtn} onClick={() => setHelpTab('start')} title="Quick start for your role and Report a problem">
                Help
              </button>
              <button type="button" style={styles.headerIconBtn} onClick={() => setShortcutHelpOpen(true)} title="Keyboard shortcuts" aria-label="Keyboard shortcuts">
                ?
              </button>
              <button
                type="button"
                style={styles.notificationBtn}
                onClick={() => { setAccountMenuOpen(false); setNotificationCenterOpen(true) }}
                title="Notification centre"
                aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ''}`}
                aria-expanded={notificationCenterOpen}
              >
                <span aria-hidden="true">{String.fromCodePoint(0x1F514)}</span>
                {unreadNotifications > 0 ? <span style={styles.notificationBadge}>{unreadNotifications}</span> : null}
              </button>
              <div style={styles.accountMenuWrap}>
                <button
                  type="button"
                  style={styles.accountMenuButton}
                  onClick={() => { setNotificationCenterOpen(false); setAccountMenuOpen(open => !open) }}
                  aria-expanded={accountMenuOpen}
                  aria-label={`Account: ${accountDisplayName}, ${accountDisplayRole}`}
                >
                  <span style={styles.accountAvatar}>{accountAvatarText}</span>
                  <span style={styles.accountIdentity}>
                    <strong>{accountDisplayName}</strong>
                    <span>{accountDisplayRole}</span>
                  </span>
                  <span style={styles.accountChevron} aria-hidden="true">▾</span>
                </button>
                {accountMenuOpen && (
                  <div style={styles.accountMenuDropdown}>
                    <div style={styles.accountMenuHeading}>Account</div>
                    <div style={styles.accountMenuEmail}>{user?.email || 'Signed-in account'}</div>
                    <div style={styles.accountMenuDivider} />
                    <div style={styles.accountMenuHeading}>Active workspace</div>
                    <div style={styles.accountMenuWorkspace}>{effectiveHospitalName || 'Hospital workspace'}</div>
                    <button type="button" style={styles.accountMenuAction} onClick={() => { setAccountMenuOpen(false); navigateApp('settings') }}>
                      Profile &amp; settings
                    </button>
                    <button type="button" style={styles.accountMenuSignOut} onClick={() => { setAccountMenuOpen(false); handleLogout() }}>
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {(offlineQueue.length > 0 || !isOnlineState || syncStatus === 'syncing') && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 18px 0' }}>
              <SyncIndicator online={isOnlineState} syncStatus={syncStatus} queue={offlineQueue}
                onRetry={() => void syncOfflineNow()} onApply={(id) => void applyOfflineAnyway(id)} onDiscard={(id) => void discardOffline(id)} />
            </div>
          )}

          {!isOnlineState && (
            <div style={styles.offlineBanner}>
              Offline mode enabled - cached access is available, but financial workflows are blocked until connectivity returns.
            </div>
          )}

          {offlineMode && (
            <div style={styles.offlineBannerStrong}>
              Offline Mode - read-only shell access is active from your cached session.
            </div>
          )}

          {idleWarning && (
            <div style={styles.warningOverlay}>
              <div style={styles.warningCard}>
                <div style={styles.warningTitle}>Session Expiring Soon</div>
                <div style={styles.warningText}>
                  You'll be logged out in {idleWarning.warningMinutes} minutes due to inactivity.
                </div>
                <div style={styles.warningActions}>
                  <button
                    type="button"
                    style={styles.warningSecondary}
                    onClick={() => {
                      setIdleWarning(null)
                      idleWarning.logoutNow()
                    }}
                  >
                    Sign Out Now
                  </button>
                  <button
                    type="button"
                    style={styles.warningPrimary}
                    onClick={() => {
                      setIdleWarning(null)
                      idleWarning.extendSession()
                      sessionControls.resetTimers()
                    }}
                  >
                    Extend Session
                  </button>
                </div>
              </div>
            </div>
          )}

          {globalSearchOpen && (
            <ShellModal
              title="Global Search"
              subtitle="Patients, invoices, staff, and drugs"
              onClose={() => setGlobalSearchOpen(false)}
              width={840}
            >
              <div style={styles.modalBody}>
                <input
                  style={styles.globalSearchInput}
                  placeholder="Search patient, invoice number, staff, or drug..."
                  value={globalSearchTerm}
                  onChange={(event) => setGlobalSearchTerm(event.target.value)}
                  autoFocus
                />
                {globalSearchLoading ? (
                  <div style={{ padding: '12px 0' }}>
                    <SkeletonLoader rows={4} height={12} width={['75%', '92%', '68%', '84%']} />
                  </div>
                ) : null}
                {!globalSearchLoading && groupedSearchResults.length === 0 ? (
                  <div style={styles.modalEmpty}>
                    {globalSearchTerm.trim().length < 2 ? 'Type at least 2 characters to search the hospital.' : 'No matching results found.'}
                  </div>
                ) : null}
                {!globalSearchLoading && groupedSearchResults.map((group) => (
                  <div key={group.key} style={styles.searchGroup}>
                    <div style={styles.searchGroupTitle}>
                      <span>{SEARCH_CATEGORY_ICONS[group.label] || 'Item'}</span>
                      <span>{group.label}</span>
                    </div>
                    <div style={styles.searchGroupList}>
                      {group.items.map((item) => (
                        <button key={`${item.category}-${item.id}`} type="button" style={styles.searchResultBtn} onClick={() => handleSearchResultOpen(item)}>
                          <div style={styles.searchResultLabel}>{item.label}</div>
                          <div style={styles.searchResultMeta}>{item.description || 'Open record'}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ShellModal>
          )}

          {notificationCenterOpen && (
            <ShellModal
              title="Notification Centre"
              subtitle="Operational alerts and workflow updates"
              onClose={() => setNotificationCenterOpen(false)}
              width={680}
            >
              <div style={styles.modalBody}>
                <div style={styles.modalActions}>
                  <button type="button" style={styles.modalActionBtn} onClick={() => { void handleMarkAllNotificationsRead() }} disabled={!appNotifications.length}>
                    Mark all read
                  </button>
                </div>
                {appNotifications.length === 0 ? (
                  <div style={styles.modalEmpty}>No notifications yet.</div>
                ) : (
                  <div style={styles.notificationList}>
                    {appNotifications.map((item) => {
                      const meta = APP_NOTIFICATION_TYPES[item.notification_type] || APP_NOTIFICATION_TYPES.system
                      return (
                        <button
                          key={item.id}
                          type="button"
                          style={{ ...styles.notificationRow, ...(item.is_read || item.read_at ? styles.notificationRowRead : {}) }}
                          onClick={() => { void handleNotificationClick(item) }}
                        >
                          <div style={styles.notificationIcon}>{meta.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={styles.notificationTitle}>{item.title || meta.label}</div>
                            <div style={styles.notificationMessage}>{item.message}</div>
                            <div style={styles.notificationMeta}>
                              {new Date(item.created_at || item.createdAt || Date.now()).toLocaleString('en-KE')}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </ShellModal>
          )}

          {helpTab && (
            <ShellModal
              title="Help"
              subtitle="How to use RemedacareHMS in your role, and a quick way to tell IT when something is wrong"
              onClose={() => setHelpTab(null)}
              width={720}
            >
              <HelpCentre
                key={helpTab}
                initialTab={helpTab}
                resolvedRole={resolvedRole}
                onNavigate={(path) => { setHelpTab(null); routerNavigate(path) }}
                hospitalId={effectiveHospitalId}
                screen={currentScreenLabel}
                path={location.pathname}
                role={userRole}
                userName={accountDisplayName}
                online={isOnlineState && !offlineMode}
              />
            </ShellModal>
          )}

          {shortcutHelpOpen && (
            <ShellModal
              title="Keyboard Shortcuts"
              subtitle="Fast navigation and app actions"
              onClose={() => setShortcutHelpOpen(false)}
              width={620}
            >
              <div style={styles.modalBody}>
                <div style={styles.shortcutsGrid}>
                  {shortcutGroups.map((item) => (
                    <div key={item.id} style={styles.shortcutRow}>
                      <div style={styles.shortcutLabel}>{item.label}</div>
                      <div style={styles.shortcutCombo}>{item.combo}</div>
                    </div>
                  ))}
                </div>
              </div>
            </ShellModal>
          )}

          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            {renderProtectedRoute('/dashboard', 'Dashboard', <Dashboard />)}
            {renderProtectedRoute('/patients', 'Patients', <Patients />)}
            {renderProtectedRoute('/appointments', 'Appointments', <Appointments />)}
            {renderProtectedRoute('/consultation', 'Consultation', <Consultation />)}
            {renderProtectedRoute('/care-pathways', 'Care Pathways', <CarePathways />)}
            {renderProtectedRoute('/chronic-disease', 'Chronic Disease', <ChronicDisease />)}
            {renderProtectedRoute('/referrals', 'Referrals', <Referrals />)}
            {renderProtectedRoute('/wards', 'Wards', <Wards />)}
            {renderProtectedRoute('/blood-bank', 'Blood Bank', <BloodBank />)}
            {renderProtectedRoute('/morgue', 'Mortuary', <Mortuary />)}
            {renderProtectedRoute('/theatre', 'Theatre', <Theatre />)}
            {renderProtectedRoute('/telemedicine', 'Telemedicine', <HospitalWorkflowBoard config={HOSPITAL_WORKFLOW_MODULES.telemedicine} />)}
            {renderProtectedRoute('/maternity', 'Maternity', <Maternity />)}
            {renderProtectedRoute('/dialysis', 'Dialysis', <Dialysis />)}
            {renderProtectedRoute('/emergency', 'Emergency department', <Emergency />)}
            {renderProtectedRoute('/icu', 'ICU / HDU', <ICU />)}
            <Route path="/nutrition" element={<Navigate to="/departments/Nutrition%20%26%20Dietetics?module=nutrition" replace />} />
            {renderProtectedRoute('/hivtb', 'HIV & TB Care', <HivTb />)}
            {renderProtectedRoute('/biomedical', 'Biomedical', <HospitalWorkflowBoard config={HOSPITAL_WORKFLOW_MODULES.biomedical} />)}
            {renderProtectedRoute('/quality-safety', 'Quality & Safety', <HospitalWorkflowBoard config={HOSPITAL_WORKFLOW_MODULES['quality-safety']} />)}
            {renderProtectedRoute('/procurement', 'Procurement', <HospitalWorkflowBoard config={HOSPITAL_WORKFLOW_MODULES.procurement} />)}
            <Route path="/payroll" element={<Navigate to="/hr?tab=payroll" replace />} />
            {renderProtectedRoute('/laboratory', 'Laboratory', <LaboratoryRoute navigateApp={navigateApp} />)}
            {renderProtectedRoute('/radiology', 'Radiology', <Radiology />)}
            {renderProtectedRoute('/antibiogram', 'Antibiogram', <AntibiogramRoute navigateApp={navigateApp} />)}
            {renderProtectedRoute('/microbiology', 'Microbiology surveillance', <Microbiology />)}
            {renderProtectedRoute('/critical-results', 'Critical results & TDM', <CriticalResults />)}
            {renderProtectedRoute('/references', 'Clinical guides & references', <ClinicalReferences />)}
            {renderProtectedRoute('/prescriptions', 'Prescriptions', <Prescriptions />)}
            {renderProtectedRoute('/expiry', 'Expiry', <Expiry />)}
            {renderProtectedRoute('/pharmacy-controls', 'Controlled drugs & ward stock', <PharmacyControls />)}
            {renderProtectedRoute('/dashboards', 'Management dashboards', <Dashboards />)}
            {renderProtectedRoute('/pharmacy', 'Pharmacy', <Pharmacy />)}
            {renderProtectedRoute('/inventory', 'Inventory', <DrugInventory />)}
            {renderProtectedRoute('/billing', 'Billing', <Billing />)}
            {renderProtectedRoute('/credit', 'Credit', <Credit />)}
            {renderProtectedRoute('/mpesa', 'M-Pesa', <Mpesa />)}
            {renderProtectedRoute('/sha-claims', 'SHA Claims', <SHAClaims />)}
            {renderProtectedRoute('/insurance', 'Insurance', <Insurance />)}
            {renderProtectedRoute('/etims', 'eTIMS', <Etims />)}
            {renderProtectedRoute('/hr', 'HR', <HRRoute navigateApp={navigateApp} />)}
            {renderProtectedRoute('/departments/:departmentName', 'Department', <DepartmentRoute navigateApp={navigateApp} />)}
            {renderProtectedRoute('/ai', 'AI', <AI />)}
            {renderProtectedRoute('/reports', 'Reports', <Reports />)}
            {renderProtectedRoute('/settings', 'Settings', <Settings />)}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          <ToastViewport />
          <ConfirmDialog />
        </main>
      </div>
    </HospitalContext.Provider>
  )
}

// Public pages (no staff sign-in): referral letter links and the patient portal. Everything else is the staff app.
const SharedReferral = lazy(() => import('./screens/public/SharedReferral'))
const PatientPortal = lazy(() => import('./screens/portal/PatientPortal'))

function RootSwitch() {
  const { pathname } = useLocation()
  if (pathname.startsWith('/shared/') || pathname.startsWith('/portal')) {
    return (
      <Suspense fallback={<div style={{ padding: 24, fontFamily: 'system-ui' }}>Loading…</div>}>
        <Routes>
          <Route path="/shared/referral/:token" element={<SharedReferral />} />
          <Route path="/portal/*" element={<PatientPortal />} />
          <Route path="*" element={<Navigate to="/portal" replace />} />
        </Routes>
      </Suspense>
    )
  }
  return <AppShell />
}

export default function App() {
  return (
    <HashRouter>
      <RootSwitch />
    </HashRouter>
  )
}

// Layout rules that inline styles cannot express: phone / tablet drawer, scrollable tables, visible keyboard focus.
const RESPONSIVE_CSS = `
.rc-menu-btn { display: none; }
.rc-main :focus-visible, .rc-sidebar :focus-visible { outline: 2px solid #12B76A; outline-offset: 2px; }
@media (max-width: 900px) {
  .rc-sidebar { position: fixed; top: 0; bottom: 0; left: 0; z-index: 1300; width: min(280px, 86vw) !important; overflow-y: auto;
    transform: translateX(-105%); transition: transform .2s ease; box-shadow: 0 0 40px rgba(15,23,42,.35); }
  .rc-sidebar.open { transform: translateX(0); }
  .rc-nav-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,.45); z-index: 1250; }
  .rc-menu-btn { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; flex-shrink: 0;
    border: 1px solid #D0D5DD; border-radius: 10px; background: #fff; font-size: 20px; cursor: pointer; }
  .rc-main table { display: block; max-width: 100%; overflow-x: auto; }
  .rc-main input, .rc-main select, .rc-main textarea { font-size: 16px; }
}
@media (prefers-reduced-motion: reduce) { .rc-sidebar { transition: none; } }
`

const styles = {
  fullscreen: {
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: colors.bgAlt,
    fontFamily: typography.systemFontFamily,
  },
  authCard: {
    maxWidth: 580,
    width: '100%',
    background: colors.surface,
    borderRadius: 18,
    padding: 28,
    boxShadow: '0 12px 30px rgba(0,0,0,0.08)',
  },
  authButton: {
    marginTop: 20,
    padding: '12px 22px',
    borderRadius: 10,
    border: 'none',
    background: colors.primaryDark,
    color: colors.white,
    cursor: 'pointer',
  },
  container: {
    display: 'flex',
    height: '100vh',
    background: colors.bgAlt,
    fontFamily: typography.systemFontFamily,
  },
  sidebar: {
    width: '252px',
    background: colors.primaryDark,
    color: colors.white,
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  logoArea: {
    padding: '18px 16px 14px',
    borderBottom: '1px solid #9FE1CB',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  brandLogo: {
    width: '34px',
    height: '34px',
    objectFit: 'contain',
    flexShrink: 0,
  },
  logoText: { fontSize: '14px', fontWeight: '700', margin: 0, letterSpacing: '0.3px' },
  logoSub: {
    fontSize: '10px',
    color: '#FFFFFF',
    margin: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  nav: { flex: 1, overflowY: 'auto', padding: '8px 0' },
  navSection: { marginBottom: '6px' },
  navSectionTitle: {
    fontSize: '9px',
    color: '#FFFFFF',
    padding: '10px 16px 4px',
    textTransform: 'uppercase',
    fontWeight: '600',
    letterSpacing: '0.8px',
  },
  navSectionToggle: {
    width: '100%',
    background: 'transparent',
    border: 'none',
    color: '#FFFFFF',
    padding: '9px 16px 7px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '10.5px',
    fontWeight: '700',
    letterSpacing: '0.7px',
    textAlign: 'left',
  },
  navSectionToggleActive: { color: colors.white },
  navCount: { fontSize: '10px', fontWeight: 600, color: '#FFFFFF', background: '#033D2D', borderRadius: '999px', padding: '1px 7px' },
  navSearch: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#033D2D',
    border: '1px solid #9FE1CB',
    borderRadius: '8px',
    color: colors.white,
    padding: '7px 10px',
    fontSize: '12.5px',
    outline: 'none',
  },
  navItem: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 16px',
    fontSize: '12.5px',
    color: '#FFFFFF',
    cursor: 'pointer',
    border: 'none',
    borderLeft: '3px solid transparent',
    background: 'transparent',
    textAlign: 'left',
  },
  navStaticItem: {
    color: '#FFFFFF',
    cursor: 'default',
  },
  navItemActive: {
    background: '#033D2D',
    color: colors.white,
    borderLeft: `3px solid ${colors.accent}`,
    fontWeight: '500',
  },
  navIcon: { fontSize: '14px', width: '18px', textAlign: 'center', flexShrink: 0 },
  userBar: {
    marginTop: 'auto',
    padding: '12px 16px',
    borderTop: '1px solid #9FE1CB',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  avatar: {
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    background: colors.accent,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: '700',
    color: colors.primaryDark,
    flexShrink: 0,
  },
  userInfo: { flex: 1, overflow: 'hidden' },
  userName: {
    fontSize: '12px',
    color: colors.white,
    margin: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userRole: {
    fontSize: '10px',
    color: '#FFFFFF',
    margin: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  logoutBtn: {
    background: '#E24B4A',
    color: colors.white,
    border: 'none',
    width: '30px',
    height: '30px',
    borderRadius: '7px',
    cursor: 'pointer',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  main: { flex: 1, overflowY: 'auto', background: colors.bgAlt, minWidth: 0 },
  topbar: {
    position: 'sticky',
    top: 0,
    zIndex: 20,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    padding: '16px 18px 12px',
    background: colors.bgAlt,
    borderBottom: `1px solid ${colors.border}`,
    flexWrap: 'wrap',
  },
  breadcrumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  breadcrumbItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  breadcrumbSep: {
    fontSize: 12,
    color: colors.muted,
  },
  breadcrumbLink: {
    border: 'none',
    background: 'transparent',
    color: colors.primaryDark,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    padding: 0,
  },
  breadcrumbCurrent: {
    fontSize: 12,
    color: colors.sub,
    fontWeight: 600,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: 800,
    color: colors.text,
  },
  screenSubtitle: {
    fontSize: 12,
    color: colors.sub,
    marginTop: 4,
  },
  topbarActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  branchSelectWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 220,
  },
  branchSelectLabel: {
    fontSize: 11,
    color: colors.sub,
    fontWeight: 700,
  },
  branchSelect: {
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.text,
    borderRadius: 12,
    padding: '10px 12px',
    cursor: 'pointer',
    fontWeight: 600,
    minHeight: 42,
  },
  searchButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.text,
    borderRadius: 12,
    padding: '10px 14px',
    cursor: 'pointer',
    fontWeight: 700,
  },
  searchHint: {
    fontSize: 11,
    color: colors.sub,
    background: colors.panel,
    borderRadius: 999,
    padding: '2px 8px',
  },
  zoomControl: {
    display: 'flex',
    alignItems: 'center',
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  zoomBtn: {
    border: 'none',
    background: 'transparent',
    color: colors.text,
    padding: '10px 12px',
    cursor: 'pointer',
    fontWeight: 800,
    minWidth: 40,
  },
  zoomBtnDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  zoomReadoutBtn: {
    border: 'none',
    borderLeft: `1px solid ${colors.border}`,
    borderRight: `1px solid ${colors.border}`,
    background: colors.panel,
    color: colors.text,
    padding: '10px 12px',
    cursor: 'pointer',
    fontWeight: 700,
    minWidth: 68,
  },
  headerIconBtn: {
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.text,
    borderRadius: 12,
    padding: '10px 12px',
    cursor: 'pointer',
    fontWeight: 700,
    minWidth: 54,
  },
  notificationBtn: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.text,
    borderRadius: 12,
    width: 42,
    height: 42,
    padding: 0,
    cursor: 'pointer',
    fontSize: 18,
  },
  accountMenuWrap: { position: 'relative' },
  accountMenuButton: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 168, maxWidth: 240, padding: '4px 7px', border: `1px solid ${colors.border}`, borderRadius: 12, background: colors.surface, color: colors.text, cursor: 'pointer', textAlign: 'left' },
  accountAvatar: { width: 32, height: 32, borderRadius: '50%', background: colors.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 },
  accountIdentity: { display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden', flex: 1, fontSize: 11 },
  accountChevron: { color: colors.primary, fontSize: 13, flexShrink: 0 },
  accountMenuDropdown: { position: 'absolute', right: 0, top: 'calc(100% + 7px)', width: 240, padding: 12, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, boxShadow: '0 16px 34px rgba(16,24,40,0.16)', zIndex: 80 },
  accountMenuHeading: { color: colors.sub, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' },
  accountMenuEmail: { color: colors.text, fontSize: 12, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  accountMenuWorkspace: { color: colors.text, fontSize: 13, fontWeight: 700, margin: '4px 0 8px' },
  accountMenuDivider: { height: 1, background: colors.border, margin: '10px 0' },
  accountMenuAction: { width: '100%', padding: '9px 8px', border: 0, borderRadius: 8, background: 'transparent', color: colors.primary, fontSize: 12, textAlign: 'left', cursor: 'pointer' },
  accountMenuSignOut: { width: '100%', padding: '9px 8px', marginTop: 3, border: 0, borderRadius: 8, background: '#FCEBEB', color: '#A32D2D', fontSize: 12, fontWeight: 700, textAlign: 'left', cursor: 'pointer' },
  notificationBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    borderRadius: 999,
    background: colors.danger,
    color: colors.white,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 800,
    padding: '0 6px',
  },
  offlineBanner: {
    background: '#FCEBC9',
    color: '#7F4E00',
    border: '1px solid #F0C36D',
    borderRadius: '10px',
    padding: '10px 14px',
    margin: '16px 16px 0',
    fontSize: '13px',
  },
  offlineBannerStrong: {
    background: '#DCEBFF',
    color: '#18417C',
    border: '1px solid #A5C2F0',
    borderRadius: '10px',
    padding: '10px 14px',
    margin: '12px 16px 0',
    fontSize: '13px',
    fontWeight: 700,
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: colors.overlay,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 2500,
  },
  modalCard: {
    width: '100%',
    background: colors.surface,
    borderRadius: 20,
    border: `1px solid ${colors.border}`,
    boxShadow: '0 32px 60px rgba(15, 23, 42, 0.28)',
    maxHeight: '85vh',
    overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    padding: '18px 20px 16px',
    borderBottom: `1px solid ${colors.border}`,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 800,
    color: colors.text,
  },
  modalSubtitle: {
    fontSize: 12,
    color: colors.sub,
    marginTop: 4,
  },
  modalClose: {
    border: 'none',
    background: 'transparent',
    color: colors.sub,
    cursor: 'pointer',
    fontSize: 28,
    lineHeight: 1,
  },
  modalBody: {
    padding: 20,
    overflowY: 'auto',
    maxHeight: 'calc(85vh - 82px)',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginBottom: 12,
  },
  modalActionBtn: {
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.text,
    borderRadius: 10,
    padding: '9px 12px',
    cursor: 'pointer',
    fontWeight: 700,
  },
  modalEmpty: {
    padding: '18px 0',
    color: colors.sub,
    fontSize: 13,
  },
  globalSearchInput: {
    width: '100%',
    border: `1px solid ${colors.border}`,
    background: colors.panel,
    color: colors.text,
    borderRadius: 14,
    padding: '14px 16px',
    fontSize: 15,
    marginBottom: 14,
  },
  searchGroup: {
    marginBottom: 18,
  },
  searchGroupTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    fontWeight: 800,
    color: colors.sub,
    textTransform: 'uppercase',
    letterSpacing: '.05em',
    marginBottom: 8,
  },
  searchGroupList: {
    display: 'grid',
    gap: 8,
  },
  searchResultBtn: {
    textAlign: 'left',
    border: `1px solid ${colors.border}`,
    background: colors.panel,
    borderRadius: 14,
    padding: '12px 14px',
    cursor: 'pointer',
  },
  searchResultLabel: {
    fontSize: 14,
    fontWeight: 800,
    color: colors.text,
  },
  searchResultMeta: {
    fontSize: 12,
    color: colors.sub,
    marginTop: 4,
  },
  notificationList: {
    display: 'grid',
    gap: 10,
  },
  notificationRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    textAlign: 'left',
    border: `1px solid ${colors.border}`,
    background: colors.panel,
    borderRadius: 14,
    padding: '12px 14px',
    cursor: 'pointer',
  },
  notificationRowRead: {
    opacity: 0.72,
  },
  notificationIcon: {
    minWidth: 40,
    height: 40,
    borderRadius: 12,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 800,
    color: colors.primaryDark,
  },
  notificationTitle: {
    fontSize: 13,
    fontWeight: 800,
    color: colors.text,
  },
  notificationMessage: {
    fontSize: 12,
    color: colors.sub,
    lineHeight: 1.6,
    marginTop: 4,
  },
  notificationMeta: {
    fontSize: 11,
    color: colors.mutedStrong,
    marginTop: 6,
  },
  shortcutsGrid: {
    display: 'grid',
    gap: 10,
  },
  shortcutRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    border: `1px solid ${colors.border}`,
    background: colors.panel,
    borderRadius: 14,
    padding: '12px 14px',
  },
  shortcutLabel: {
    fontSize: 13,
    color: colors.text,
    fontWeight: 700,
  },
  shortcutCombo: {
    fontSize: 12,
    color: colors.primaryDark,
    fontWeight: 800,
  },
  warningOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.32)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 1200,
  },
  warningCard: {
    width: '100%',
    maxWidth: 420,
    background: colors.surface,
    borderRadius: 18,
    padding: 24,
    boxShadow: '0 24px 60px rgba(15, 23, 42, 0.2)',
  },
  warningTitle: {
    fontSize: 18,
    fontWeight: 800,
    color: colors.text,
    marginBottom: 10,
  },
  warningText: {
    fontSize: 14,
    color: colors.sub,
    lineHeight: 1.7,
  },
  warningActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  warningSecondary: {
    padding: '10px 14px',
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.text,
    cursor: 'pointer',
  },
  warningPrimary: {
    padding: '10px 14px',
    borderRadius: 10,
    border: 'none',
    background: colors.primaryDark,
    color: colors.white,
    cursor: 'pointer',
    fontWeight: 700,
  },
  syncBanner: {
    background: '#E1F7F9',
    color: colors.primaryDark,
    border: '1px solid #8DD6DA',
    borderRadius: '10px',
    padding: '10px 14px',
    margin: '16px 16px 0',
    fontSize: '13px',
  },
}

// Used by tools/ui-preview to show the real menu in screenshots.
export { NAV_GROUPS, styles as APP_STYLES }
