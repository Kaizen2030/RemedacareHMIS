import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { HospitalContext } from './context'
import ConfirmDialog from './components/ConfirmDialog'
import AccessDenied from './components/AccessDenied'
import ErrorBoundary from './components/ErrorBoundary'
import SkeletonLoader from './components/SkeletonLoader'
import ToastViewport from './components/ToastViewport'
import { canAccessScreen, resolveRole } from './access'
import { openConfirmDialog } from './confirmDialog'
import useAuth from './hooks/useAuth'
import useDepartments from './hooks/useDepartments'
import useOnlineSync from './hooks/useOnlineSync'
import useSessionTimeout from './hooks/useSessionTimeout'
import Login from './screens/Login'
import Dashboard from './screens/Dashboard'
import { notifyFromLegacyAlert } from './notifications'
import supabase from './supabase'
import { performSyncableAction } from './utils/offlineSync'
import { fetchAppNotifications, markAllNotificationsRead, markNotificationRead, APP_NOTIFICATION_TYPES } from './utils/appNotifications'
import { searchAcrossHospital, groupSearchResults } from './utils/globalSearch'
import useDebouncedValue from './utils/useDebouncedValue'
import { APP_SHORTCUTS, resolveShortcutSequence, shouldIgnoreShortcutTarget } from './utils/appShortcuts'
import { openPrintPreview, printTemplates } from './utils/printSystem'
import { buildBilingualWhatsAppMessage, generateWhatsAppLink } from './utils/whatsapp'
import { registerPwaServiceWorker } from './utils/pwa'
import { applyThemeMode, colors, getStoredThemeMode, THEME_MODES, typography } from './theme'

const Patients = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Patients'))
const Appointments = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Appointments'))
const Consultation = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/consultation'))
const CarePathways = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/CarePathways'))
const ChronicDisease = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/ChronicDisease'))
const Referrals = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Referrals'))
const Wards = lazy(() => import(/* @vite-chunk-name: "clinical" */ './screens/Wards'))
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
    label: 'CLINICAL',
    items: [
      { id: 'patients', path: '/patients', label: 'Patients', icon: '' },
      { id: 'appointments', path: '/appointments', label: 'Appointments', icon: '' },
      { id: 'consultation', path: '/consultation', label: 'Consultation', icon: '' },
      { id: 'care-pathways', path: '/care-pathways', label: 'Care Pathways', icon: '' },
      { id: 'chronic-disease', path: '/chronic-disease', label: 'Chronic Disease', icon: '' },
      { id: 'referrals', path: '/referrals', label: 'Referrals', icon: '' },
      { id: 'wards', path: '/wards', label: 'Ward & Beds', icon: '' },
      { id: 'lab', path: '/laboratory', label: 'Laboratory', icon: '' },
      { id: 'radiology', path: '/radiology', label: 'Radiology', icon: '' },
      { id: 'antibiogram', path: '/antibiogram', label: 'Antibiogram', icon: '' },
      { id: 'prescriptions', path: '/prescriptions', label: 'Prescriptions', icon: '' },
      { id: 'expiry', path: '/expiry', label: 'Expiry Alerts', icon: '' },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { id: 'pharmacy', path: '/pharmacy', label: 'Pharmacy & POS', icon: '' },
      { id: 'inventory', path: '/inventory', label: 'Drug Inventory', icon: '' },
      { id: 'billing', path: '/billing', label: 'Billing', icon: '' },
      { id: 'credit', path: '/credit', label: 'Credit & Debts', icon: '' },
    ],
  },
  {
    label: 'FINANCE',
    items: [
      { id: 'mpesa', path: '/mpesa', label: 'M-Pesa', icon: '' },
      { id: 'sha', path: '/sha-claims', label: 'SHA Claims', icon: '' },
      { id: 'insurance', path: '/insurance', label: 'Insurance Claims', icon: '' },
      { id: 'etims', path: '/etims', label: 'eTIMS / KRA', icon: '' },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { id: 'hr', path: '/hr', label: 'HR & Staff', icon: '' },
      { id: 'ai', path: '/ai', label: 'AI Clinical Assist', icon: '' },
      { id: 'reports', path: '/reports', label: 'Reports', icon: '' },
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
  lab: '/laboratory',
  radiology: '/radiology',
  antibiogram: '/antibiogram',
  prescriptions: '/prescriptions',
  expiry: '/expiry',
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
          <button type="button" style={styles.modalClose} onClick={onClose}>×</button>
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
  const [departmentsOpen, setDepartmentsOpen] = useState(false)

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
    userRole,
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
  const [appNotifications, setAppNotifications] = useState([])
  const [notificationsCompat, setNotificationsCompat] = useState(false)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
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
  const zoomPercentLabel = `${Math.round((zoomFactor || DEFAULT_ZOOM_FACTOR) * 100)}%`
  const canZoomOut = zoomFactor > MIN_ZOOM_FACTOR + 0.001
  const canZoomIn = zoomFactor < MAX_ZOOM_FACTOR - 0.001

  const handleResetDone = useCallback(() => {
    resetPasswordRecovery()
    setDeepLinkRecovery(false)
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

      const branchMap = new Map(branchRows.map((row) => [String(row.id), row]))
      const branches = branchIds
        .map((branchId) => normalizeBranchRecord(
          branchMap.get(String(branchId)) || {
            id: branchId,
            name: String(branchId) === String(hospitalId) ? (hospitalName || 'Hospital Branch') : 'Hospital Branch',
          },
          accessMap.get(String(branchId)) || {
            hospital_id: branchId,
            role: userRole,
            is_primary: String(branchId) === String(hospitalId),
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
  }, [hospitalId, hospitalName, user?.id, userRole])

  // FIXED: Deep link handler that restores session from tokens
  useEffect(() => {
    if (!window?.electronAPI?.onDeepLink) return undefined

    let active = true

    const unsubscribe = window.electronAPI.onDeepLink(async (url) => {
      if (!active) return

      console.log('Deep link received:', url)

      const hash = url.includes('#') ? url.split('#')[1] || '' : ''
      const query = url.includes('?') ? url.split('?')[1]?.split('#')[0] || '' : ''
      const params = new URLSearchParams(hash || query)
      const type = params.get('type')
      const accessToken = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      const code = params.get('code')

      if (type === 'recovery') {
        try {
          let sessionRestored = false

          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })

            if (error) {
              console.error('Session restore failed:', error)
            } else {
              console.log('Recovery session restored successfully')
              sessionRestored = true
            }
          } else if (code) {
            const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
            if (exchangeError) {
              console.error('Code exchange failed:', exchangeError)
            } else {
              console.log('Recovery session restored from code successfully')
              sessionRestored = true
            }
          } else {
            console.warn('Missing recovery credentials in deep link URL')
          }

          if (active) {
            setDeepLinkRecovery(true)
          }

          if (sessionRestored) {
            setTimeout(() => {
              if (active) {
                window.location.reload()
              }
            }, 100)
          }
        } catch (e) {
          console.error('Deep link session error:', e)
          if (code) {
            try {
              const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
              if (exchangeError) {
                console.error('Fallback code exchange failed:', exchangeError)
              } else if (active) {
                setTimeout(() => {
                  if (active) {
                    window.location.reload()
                  }
                }, 100)
              }
            } catch (exchangeError) {
              console.error('Fallback code exchange threw:', exchangeError)
            }
          }
          if (active) {
            setDeepLinkRecovery(true)
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
  const { isOnlineState, syncStatus } = useOnlineSync()

  useEffect(() => {
    if (!effectiveHospitalId) {
      setHospitalProfile((previous) => ({ ...previous, name: effectiveHospitalName || loginBranding?.hospitalName || 'RemedacareHMIS' }))
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
        name: brandingConfig?.hospital_name || effectiveHospitalName || loginBranding?.hospitalName || 'RemedacareHMIS',
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

  const departmentNames = departments.map((department) => department.name).filter(Boolean)
  
  const visibleDepartmentNames = (() => {
    const resolved = resolveRole(userRole)
    if (resolved === 'Admin') return departmentNames
    if (departmentsLoading || !userRole) return departmentNames
    if (!userDepartment) return departmentNames
    const filtered = departmentNames.filter(n => n === userDepartment)
    return filtered.length > 0 ? filtered : departmentNames
  })()
  
  const selectedDepartment = getDepartmentNameFromPath(location.pathname)
  const userInitials = (user?.email || 'U').slice(0, 2).toUpperCase()
  const resolvedRole = resolveRole(userRole)
  const isAdmin = resolvedRole === 'Admin'
  const financialActionsBlocked = offlineMode || !isOnlineState
  const unreadNotifications = appNotifications.filter((item) => !item.is_read && !item.read_at).length
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
      items: group.items.filter((item) => (isAdmin || canAccessScreen(userRole, item.path)) && !(financialActionsBlocked && OFFLINE_RESTRICTED_PATHS.includes(item.path))),
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
    return (
      <div style={styles.fullscreen}>
        <div style={{ width: '220px' }}>
          <SkeletonLoader rows={3} height={14} width={['40%', '100%', '70%']} />
          <p style={{ color: colors.sub, fontSize: '13px' }}>Loading RemedacareHMIS...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <Login
        onLogin={handleLogin}
        isPasswordRecovery={isPasswordRecovery || deepLinkRecovery}
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
        <aside style={styles.sidebar}>
          <div style={styles.logoArea}>
            <div style={styles.avatar}>RC</div>
            <div style={{ minWidth: 0 }}>
              <p style={styles.logoText}>REMEDACARE HMS</p>
              <p style={styles.logoSub}>{effectiveHospitalName || 'Hospital workspace'}</p>
            </div>
          </div>

          <div style={styles.nav}>
            {visibleNavGroups.map((group) => (
              <div key={group.label} style={styles.navSection}>
                <div style={styles.navSectionTitle}>{group.label}</div>
                {group.items.map((item) => {
                  const active = location.pathname === item.path
                  return (
                    <button
                      key={item.id}
                      type="button"
                      style={{ ...styles.navItem, ...(active ? styles.navItemActive : {}) }}
                      onClick={() => navigateApp(item.id)}
                    >
                      <span style={styles.navIcon}>{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </div>
            ))}

            <div style={styles.navSection}>
              <button
                type="button"
                style={styles.navSectionToggle}
                onClick={() => setDepartmentsOpen((previous) => !previous)}
              >
                <span>DEPARTMENTS</span>
                <span>{departmentsOpen ? '-' : '+'}</span>
              </button>

              {departmentsOpen && (
                <div style={{ paddingBottom: '6px' }}>
                  {departmentsLoading && (
                    <div style={{ ...styles.navItem, ...styles.navStaticItem }}>
                      <div style={{ width: '100%' }}>
                        <SkeletonLoader rows={2} height={10} width={['85%', '60%']} />
                      </div>
                    </div>
                  )}

                  {!departmentsLoading && visibleDepartmentNames.map((name) => {
                    const active = selectedDepartment === name
                    return (
                      <button
                        key={name}
                        type="button"
                        style={{ ...styles.navItem, ...(active ? styles.navItemActive : {}) }}
                        onClick={() => navigateApp('department', { department: name })}
                      >
                        <span style={styles.navIcon}></span>
                        <span>{name}</span>
                      </button>
                    )
                  })}

                  {!departmentsLoading && visibleDepartmentNames.length === 0 && (
                    <div style={{ ...styles.navItem, ...styles.navStaticItem }}>
                      <span style={styles.navIcon}></span>
                      <span>No departments added yet</span>
                    </div>
                  )}
                </div>
              )}
            </div>
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

        <main style={styles.main}>
          <div style={styles.topbar}>
            <div>
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
              <button type="button" style={styles.headerIconBtn} onClick={() => setShortcutHelpOpen(true)} title="Keyboard shortcuts">
                ?
              </button>
              <button type="button" style={styles.notificationBtn} onClick={() => setNotificationCenterOpen(true)} title="Notification centre">
                Bell
                {unreadNotifications > 0 ? <span style={styles.notificationBadge}>{unreadNotifications}</span> : null}
              </button>
            </div>
          </div>

          {syncStatus !== 'idle' && (
            <div style={styles.syncBanner}>
              {syncStatus === 'syncing'
                ? 'Syncing offline changes...'
                : 'Offline sync failed. Some actions still need to be retried.'}
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
            {renderProtectedRoute('/laboratory', 'Laboratory', <LaboratoryRoute navigateApp={navigateApp} />)}
            {renderProtectedRoute('/radiology', 'Radiology', <Radiology />)}
            {renderProtectedRoute('/antibiogram', 'Antibiogram', <AntibiogramRoute navigateApp={navigateApp} />)}
            {renderProtectedRoute('/prescriptions', 'Prescriptions', <Prescriptions />)}
            {renderProtectedRoute('/expiry', 'Expiry', <Expiry />)}
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

export default function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  )
}

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
    width: '210px',
    background: colors.primaryDark,
    color: colors.white,
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  logoArea: {
    padding: '18px 16px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.12)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  logoText: { fontSize: '14px', fontWeight: '700', margin: 0, letterSpacing: '0.3px' },
  logoSub: {
    fontSize: '10px',
    color: 'rgba(255,255,255,0.5)',
    margin: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  nav: { flex: 1, overflowY: 'auto', padding: '8px 0' },
  navSection: { marginBottom: '6px' },
  navSectionTitle: {
    fontSize: '9px',
    color: 'rgba(255,255,255,0.35)',
    padding: '10px 16px 4px',
    textTransform: 'uppercase',
    fontWeight: '600',
    letterSpacing: '0.8px',
  },
  navSectionToggle: {
    width: '100%',
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.35)',
    padding: '10px 16px 4px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '9px',
    fontWeight: '600',
    letterSpacing: '0.8px',
  },
  navItem: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 16px',
    fontSize: '12.5px',
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    border: 'none',
    borderLeft: '3px solid transparent',
    background: 'transparent',
    textAlign: 'left',
  },
  navStaticItem: {
    color: 'rgba(255,255,255,0.55)',
    cursor: 'default',
  },
  navItemActive: {
    background: 'rgba(255,255,255,0.14)',
    color: colors.white,
    borderLeft: `3px solid ${colors.accent}`,
    fontWeight: '500',
  },
  navIcon: { fontSize: '14px', width: '18px', textAlign: 'center', flexShrink: 0 },
  userBar: {
    marginTop: 'auto',
    padding: '12px 16px',
    borderTop: '1px solid rgba(255,255,255,0.12)',
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
    color: 'rgba(255,255,255,0.5)',
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
  main: { flex: 1, overflowY: 'auto', background: colors.bgAlt },
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
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.text,
    borderRadius: 12,
    padding: '10px 14px',
    cursor: 'pointer',
    fontWeight: 700,
    minWidth: 74,
  },
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
