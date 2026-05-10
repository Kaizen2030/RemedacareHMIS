import { useCallback, useEffect, useMemo, useState } from 'react'
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
import Patients from './screens/Patients'
import Consultation from './screens/consultation'
import Wards from './screens/Wards'
import Laboratory from './screens/Laboratory'
import Pharmacy from './screens/pharmacy'
import DrugInventory from './screens/Inventory'
import Billing from './screens/Billing'
import Prescriptions from './screens/Prescriptions'
import Expiry from './screens/Expiry'
import Credit from './screens/Credit'
import Mpesa from './screens/Mpesa'
import SHAClaims from './screens/SHAClaims'
import Insurance from './screens/Insurance'
import Etims from './screens/Etims'
import HR from './screens/HR'
import AI from './screens/AI'
import Reports from './screens/Reports'
import Settings from './screens/Settings'
import DepartmentDetail from './screens/department'
import Antibiogram from './screens/Antibiogram'
import { notifyFromLegacyAlert } from './notifications'
import supabase from './supabase'
import { performSyncableAction } from './utils/offlineSync'
import { colors, typography } from './theme'

const NAV_GROUPS = [
  {
    label: 'OVERVIEW',
    items: [{ id: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: '' }],
  },
  {
    label: 'CLINICAL',
    items: [
      { id: 'patients', path: '/patients', label: 'Patients', icon: '' },
      { id: 'consultation', path: '/consultation', label: 'Consultation', icon: '' },
      { id: 'wards', path: '/wards', label: 'Ward & Beds', icon: '' },
      { id: 'lab', path: '/laboratory', label: 'Laboratory', icon: '' },
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
  consultation: '/consultation',
  wards: '/wards',
  lab: '/laboratory',
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

function ScreenFrame({ label, children }) {
  return <ErrorBoundary label={label}>{children}</ErrorBoundary>
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
    authError,
    checkingAuth,
    isPasswordRecovery,
    handleLogin,
    handleLogout,
    resetPasswordRecovery,
  } = useAuth({ onSignedOut: handleSignedOut })

  const handleSessionTimeout = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  useSessionTimeout({ onTimeout: handleSessionTimeout, timeoutMinutes: 30, warningMinutes: 5 })

  const { departments, departmentsLoading, loadDepartments } = useDepartments(hospitalId)
  const { isOnlineState, syncStatus } = useOnlineSync()

  const navigationState = location.state || null
  const clearNavigationState = useCallback(() => {
    if (!location.state) return
    routerNavigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, routerNavigate])

  const departmentNames = departments.map((department) => department.name).filter(Boolean)
  const selectedDepartment = getDepartmentNameFromPath(location.pathname)
  const userInitials = (user?.email || 'U').slice(0, 2).toUpperCase()
  const resolvedRole = resolveRole(userRole)
  const isAdmin = resolvedRole === 'Admin'
  const visibleNavGroups = NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isAdmin || canAccessScreen(userRole, item.path)),
    }))
    .filter((group) => group.items.length > 0)

  function renderProtectedRoute(path, label, element) {
    const allowed = isAdmin || canAccessScreen(userRole, path)
    const content = allowed
      ? element
      : <AccessDenied role={userRole} screen={path} />

    return (
      <Route
        path={path}
        element={<ScreenFrame label={label}>{content}</ScreenFrame>}
      />
    )
  }

  const contextValue = useMemo(() => ({
    hospitalId,
    hospitalName,
    userRole,
    departments,
    departmentsLoading,
    refreshDepartments: loadDepartments,
    navigate: navigateApp,
    navigationState,
    clearNavigationState,
    isOnline: isOnlineState,
    syncStatus,
    performSyncableAction: (action) => performSyncableAction(supabase, action),
  }), [
    clearNavigationState,
    departments,
    departmentsLoading,
    hospitalId,
    hospitalName,
    isOnlineState,
    loadDepartments,
    navigateApp,
    navigationState,
    syncStatus,
    userRole,
  ])

  if (checkingAuth) {
    return (
      <div style={styles.fullscreen}>
        <div style={{ width: '220px' }}>
          <SkeletonLoader rows={3} height={14} width={['40%', '100%', '70%']} />
          <p style={{ color: colors.sub, fontSize: '13px' }}>Loading Remedacare HMS...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <Login
        onLogin={handleLogin}
        isPasswordRecovery={isPasswordRecovery}
        onResetDone={resetPasswordRecovery}
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
              <p style={styles.logoSub}>{hospitalName || 'Hospital workspace'}</p>
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

                  {!departmentsLoading && departmentNames.map((name) => {
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

                  {!departmentsLoading && departmentNames.length === 0 && (
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
          {syncStatus !== 'idle' && (
            <div style={styles.syncBanner}>
              {syncStatus === 'syncing'
                ? 'Syncing offline changes...'
                : 'Offline sync failed. Some actions still need to be retried.'}
            </div>
          )}

          {!isOnlineState && (
            <div style={styles.offlineBanner}>
              Offline mode enabled - changes are queued locally until connectivity returns.
            </div>
          )}

          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            {renderProtectedRoute('/dashboard', 'Dashboard', <Dashboard />)}
            {renderProtectedRoute('/patients', 'Patients', <Patients />)}
            {renderProtectedRoute('/consultation', 'Consultation', <Consultation />)}
            {renderProtectedRoute('/wards', 'Wards', <Wards />)}
            {renderProtectedRoute('/laboratory', 'Laboratory', <LaboratoryRoute navigateApp={navigateApp} />)}
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
  offlineBanner: {
    background: '#FCEBC9',
    color: '#7F4E00',
    border: '1px solid #F0C36D',
    borderRadius: '10px',
    padding: '10px 14px',
    margin: '16px 16px 0',
    fontSize: '13px',
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
