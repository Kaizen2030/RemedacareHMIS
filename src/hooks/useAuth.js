import { useCallback, useEffect, useRef, useState } from 'react'
import supabase from '../supabase'
import { notifyWarning } from '../notifications'
import { resolveRole } from '../access'

const AUTH_GATE_KEY = 'remedacare:auth:gate'
const AUTH_CACHE_KEY = 'remedacare:auth:profile'
const AUTH_BRANDING_KEY = 'remedacare:auth:branding'
const AUTH_RETURN_PATH_KEY = 'remedacare:auth:return_path'
const DEFAULT_BRANDING = {
  hospitalName: 'RemedacareHMIS',
  logoBase64: '',
  level: 'Kenya',
  primaryColor: '#0F6E56',
}

function formatWorkspaceSetupError(prefix, error) {
  const message = error?.message || 'Unknown database error.'
  if (message.toLowerCase().includes('row-level security')) {
    return `${prefix} Database permissions blocked hospital setup. Check your Supabase RLS policies, especially any inserts into hospitals or wards.`
  }
  return `${prefix} ${message}`
}

function normalizeShiftLabel(value = 'Day (07:00-19:00)') {
  return value.replace(/Ã¢â‚¬â€œ/g, '-')
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (_) {
    return fallback
  }
}

function writeJson(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value))
  } catch (_) {
    // Ignore storage failures
  }
}

function removeStorage(storage, key) {
  try {
    storage?.removeItem(key)
  } catch (_) {
    // Ignore storage failures
  }
}

function readAuthGate() {
  if (typeof window === 'undefined') return null
  return readJson(window.sessionStorage, AUTH_GATE_KEY, null)
}

function writeAuthGate(value) {
  if (typeof window === 'undefined') return
  if (!value) {
    removeStorage(window.sessionStorage, AUTH_GATE_KEY)
    return
  }
  writeJson(window.sessionStorage, AUTH_GATE_KEY, value)
}

function clearAuthGate() {
  if (typeof window === 'undefined') return
  removeStorage(window.sessionStorage, AUTH_GATE_KEY)
}

function readBrandingCache() {
  if (typeof window === 'undefined') return DEFAULT_BRANDING
  return {
    ...DEFAULT_BRANDING,
    ...(readJson(window.localStorage, AUTH_BRANDING_KEY, {}) || {}),
  }
}

function writeBrandingCache(value) {
  if (typeof window === 'undefined') return
  writeJson(window.localStorage, AUTH_BRANDING_KEY, {
    ...DEFAULT_BRANDING,
    ...(value || {}),
  })
}

function readAuthCache() {
  if (typeof window === 'undefined') return null
  return readJson(window.localStorage, AUTH_CACHE_KEY, null)
}

function writeAuthCache(value) {
  if (typeof window === 'undefined') return
  writeJson(window.localStorage, AUTH_CACHE_KEY, value)
}

function writeLastUserContext({ userId, hospitalId, userRole }) {
  if (typeof window === 'undefined') return
  if (userId) window.localStorage.setItem('remedacare:last_user_id', userId)
  if (hospitalId) window.localStorage.setItem('remedacare:last_hospital_id', hospitalId)
  if (userRole) window.localStorage.setItem('remedacare:last_user_role', userRole)
}

function saveReturnPath(pathname) {
  if (typeof window === 'undefined' || !pathname) return
  writeJson(window.localStorage, AUTH_RETURN_PATH_KEY, {
    path: pathname,
    expiresAt: Date.now() + (2 * 60 * 60 * 1000),
  })
}

function consumeReturnPath() {
  if (typeof window === 'undefined') return null
  const payload = readJson(window.localStorage, AUTH_RETURN_PATH_KEY, null)
  removeStorage(window.localStorage, AUTH_RETURN_PATH_KEY)
  if (!payload?.path || !payload?.expiresAt || payload.expiresAt < Date.now()) return null
  return payload.path
}

function isConnectivityError(error) {
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('offline') ||
    message.includes('failed to fetch')
  )
}

function getDefaultLandingPath(role) {
  switch (resolveRole(role)) {
    case 'Doctor':
      return '/consultation'
    case 'Nurse':
      return '/patients'
    case 'Pharmacist':
      return '/pharmacy'
    case 'Lab Technician':
      return '/laboratory'
    case 'Receptionist':
      return '/patients'
    case 'Accountant':
      return '/billing'
    case 'Radiologist':
      return '/radiology'
    case 'Allied':
      return '/patients'
    case 'Admin':
    case 'Support':
    default:
      return '/dashboard'
  }
}

function getValidatedTimeoutMinutes(value) {
  const nextTimeout = Number(value || 30)
  return [15, 30, 60, 120].includes(nextTimeout) ? nextTimeout : 30
}

function gateMatchesUser(gate, authUser) {
  if (!gate?.stage || !authUser) return false
  if (gate.userId && gate.userId === authUser.id) return true
  if (gate.email && String(gate.email).toLowerCase() === String(authUser.email || '').toLowerCase()) return true
  return gate.stage === 'primary'
}

function buildBranding(hospitalName, brandingConfig = {}) {
  return {
    hospitalName: brandingConfig?.hospital_name || hospitalName || DEFAULT_BRANDING.hospitalName,
    logoBase64: brandingConfig?.logo_base64 || '',
    level: brandingConfig?.level || DEFAULT_BRANDING.level,
    primaryColor: brandingConfig?.primary_color || DEFAULT_BRANDING.primaryColor,
  }
}

export default function useAuth({ onSignedOut } = {}) {
  const [user, setUser] = useState(null)
  const [hospitalId, setHospitalId] = useState(null)
  const [hospitalName, setHospitalName] = useState('')
  const [userRole, setUserRole] = useState(null)
  const [authError, setAuthError] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [userDepartment, setUserDepartment] = useState(null)
  const [loginBranding, setLoginBranding] = useState(() => readBrandingCache())
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(30)
  const [postLoginRedirectPath, setPostLoginRedirectPath] = useState(null)
  const [offlineMode, setOfflineMode] = useState(false)
  const hospitalBootstrapRef = useRef(null)
  const concurrentSessionChannelRef = useRef(null)
  const sessionActivityRef = useRef({ establishedAt: 0, lastLocalLoginAt: 0, userId: null, email: null, hospitalId: null })

  const closeConcurrentSessionChannel = useCallback(() => {
    if (!concurrentSessionChannelRef.current) return
    try {
      supabase.removeChannel(concurrentSessionChannelRef.current)
    } catch (_) {
      try {
        concurrentSessionChannelRef.current.unsubscribe()
      } catch (__){
        // ignore
      }
    }
    concurrentSessionChannelRef.current = null
  }, [])

  const resetAuthState = useCallback(() => {
    closeConcurrentSessionChannel()
    setUser(null)
    setHospitalId(null)
    setHospitalName('')
    setUserRole(null)
    setUserDepartment(null)
    setAuthError(null)
    setCheckingAuth(false)
    setIsPasswordRecovery(false)
    setOfflineMode(false)
    setPostLoginRedirectPath(null)
    sessionActivityRef.current = { establishedAt: 0, lastLocalLoginAt: 0, userId: null, email: null, hospitalId: null }
  }, [closeConcurrentSessionChannel])

  const applyCachedOfflineAuth = useCallback((sessionUser) => {
    const cached = readAuthCache()
    if (!cached || cached.userId !== sessionUser?.id) return false

    setUser(sessionUser)
    setHospitalId(cached.hospitalId || null)
    setHospitalName(cached.hospitalName || '')
    setUserRole(cached.userRole || null)
    setUserDepartment(cached.userDepartment || null)
    setSessionTimeoutMinutes(getValidatedTimeoutMinutes(cached.sessionTimeoutMinutes))
    setLoginBranding({
      ...DEFAULT_BRANDING,
      ...(cached.loginBranding || readBrandingCache()),
    })
    setOfflineMode(true)
    setAuthError(null)
    setCheckingAuth(false)
    return true
  }, [])

  const clearStaleSession = useCallback(async (reason = 'Stored session is no longer valid.') => {
    console.warn(reason)
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch (error) {
      console.warn('Local sign-out cleanup failed:', error?.message || error)
    }
    resetAuthState()
  }, [resetAuthState])

  const ensureHospitalUserLink = useCallback(async (userId, nextHospitalId, role) => {
    if (!userId || !nextHospitalId || !role) return false

    const { error } = await supabase
      .from('hospital_users')
      .upsert([{ user_id: userId, hospital_id: nextHospitalId, role }], { onConflict: ['user_id', 'hospital_id'] })

    if (error) {
      console.warn('Hospital user link upsert failed:', error.message)
      return false
    }

    return true
  }, [])

  const handleDeepLink = useCallback((url) => {
    try {
      let params = new URLSearchParams()
      let token = null
      let type = null

      if (url.includes('#')) {
        params = new URLSearchParams(url.split('#')[1] || '')
      } else if (url.includes('?')) {
        params = new URLSearchParams(url.split('?')[1] || '')
      }

      token = params.get('token') || params.get('access_token')
      type = params.get('type')

      if (!token && (url.includes('access_token=') || url.includes('token='))) {
        const tokenMatch = url.match(/[?&](?:access_)?token=([^&?#]+)/)
        if (tokenMatch) token = tokenMatch[1]
      }

      if (!type && url.includes('/reset')) {
        type = 'recovery'
      }

      if (type === 'recovery' || token) {
        setIsPasswordRecovery(true)
        localStorage.setItem('remedacare_password_recovery', 'true')
        if (token) localStorage.setItem('remedacare_reset_token', token)
      }
    } catch (err) {
      console.error('Deep link parsing failed:', err)
    }
  }, [])

  useEffect(() => {
    const storedFlag = localStorage.getItem('remedacare_password_recovery')
    if (storedFlag === 'true') setIsPasswordRecovery(true)

    if (typeof window !== 'undefined') {
      const hash = window.location.hash
      const search = window.location.search
      const fullUrl = window.location.href
      if (
        hash.includes('access_token') ||
        hash.includes('token') ||
        search.includes('access_token') ||
        search.includes('token') ||
        fullUrl.includes('access_token') ||
        fullUrl.includes('token')
      ) {
        setIsPasswordRecovery(true)
      }
    }

    if (window.electronAPI && window.electronAPI.getCommandLine) {
      window.electronAPI.getCommandLine().then((args) => {
        const hasResetArg = args.some((arg) => arg.includes('reset') || arg.includes('token'))
        if (hasResetArg) setIsPasswordRecovery(true)
      }).catch(() => {})
    }
  }, [])

  const setupConcurrentSessionMonitor = useCallback(({ userId, email, nextHospitalId }) => {
    closeConcurrentSessionChannel()
    if (!userId || !nextHospitalId) return

    const channel = supabase
      .channel(`auth-watch-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'hospital_users',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const changedAt = payload?.new?.last_login_at ? new Date(payload.new.last_login_at).getTime() : 0
          const { establishedAt, lastLocalLoginAt } = sessionActivityRef.current
          if (!changedAt) return
          if (changedAt <= establishedAt + 10000) return
          if (lastLocalLoginAt && Math.abs(changedAt - lastLocalLoginAt) < 5000) return
          notifyWarning('This account appears to have logged in elsewhere. Review recent access if this was not you.')
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'staff',
          filter: `hospital_id=eq.${nextHospitalId}`,
        },
        (payload) => {
          if (!email) return
          if (String(payload?.new?.email || '').toLowerCase() !== String(email).toLowerCase()) return
          const changedAt = payload?.new?.last_login_at ? new Date(payload.new.last_login_at).getTime() : 0
          const { establishedAt, lastLocalLoginAt } = sessionActivityRef.current
          if (!changedAt) return
          if (changedAt <= establishedAt + 10000) return
          if (lastLocalLoginAt && Math.abs(changedAt - lastLocalLoginAt) < 5000) return
          notifyWarning('This account appears to have logged in elsewhere. Review recent access if this was not you.')
        },
      )

    channel.subscribe()
    concurrentSessionChannelRef.current = channel
  }, [closeConcurrentSessionChannel])

  const fetchHospitalId = useCallback(async (authUser) => {
    const userId = authUser?.id
    const email = authUser?.email
    const meta = authUser?.user_metadata || {}

    if (userId && hospitalBootstrapRef.current?.userId === userId) {
      return hospitalBootstrapRef.current.promise
    }

    const run = (async () => {
      setAuthError(null)

      if (!userId || !email) {
        setAuthError('Unable to resolve your account. Please sign out and sign in again.')
        setCheckingAuth(false)
        return null
      }

      let existingLinks = []
      const primaryLinkRes = await supabase
        .from('hospital_users')
        .select('hospital_id, hospitals(name), role, active, is_primary')
        .eq('user_id', userId)
      if (primaryLinkRes.error) {
        const fallbackLinkRes = await supabase
          .from('hospital_users')
          .select('hospital_id, hospitals(name), role, active')
          .eq('user_id', userId)
        existingLinks = (fallbackLinkRes.data || []).map((item) => ({ ...item, is_primary: false }))
      } else {
        existingLinks = primaryLinkRes.data || []
      }
      const activeLinks = Array.isArray(existingLinks)
        ? existingLinks.filter((item) => item?.hospital_id && item.active !== false)
        : []
      const existingLink = activeLinks.find((item) => item.is_primary) || activeLinks[0] || null

      if (existingLink?.hospital_id) {
        const nextHospitalId = existingLink.hospital_id
        const baseHospitalName = existingLink.hospitals?.name || ''

        let role = existingLink.role || 'staff'
        let dept = null

        const loginTimestamp = new Date().toISOString()

        await supabase
          .from('hospital_users')
          .update({ last_login_at: loginTimestamp })
          .eq('user_id', userId)
          .eq('hospital_id', nextHospitalId)

        const { data: hospital } = await supabase
          .from('hospitals')
          .select('owner_email')
          .eq('id', nextHospitalId)
          .single()

        const isOwner = hospital?.owner_email === email

        if (isOwner) {
          role = 'admin'
        } else {
          const { data: staffRecord } = await supabase
            .from('staff')
            .select('role, department')
            .eq('hospital_id', nextHospitalId)
            .eq('email', email)
            .maybeSingle()

          if (staffRecord?.role && staffRecord.role !== 'staff') {
            role = staffRecord.role
            await supabase.from('hospital_users')
              .update({ role })
              .eq('user_id', userId)
              .eq('hospital_id', nextHospitalId)
          }

          if (staffRecord?.department) {
            dept = staffRecord.department
          }

          await supabase
            .from('staff')
            .update({ last_login_at: loginTimestamp })
            .eq('hospital_id', nextHospitalId)
            .eq('email', email)
        }

        if (isOwner && existingLink.role !== 'admin') {
          const { error: rpcErr } = await supabase.rpc('set_staff_role', {
            p_hospital_id: nextHospitalId,
            p_email: email,
            p_role: 'admin',
          })

          if (rpcErr) {
            console.warn('Role sync failed:', rpcErr.message)
            await ensureHospitalUserLink(userId, nextHospitalId, 'admin')
          }
        }

        const { data: settings } = await supabase
          .from('hospital_settings')
          .select('branding_config, user_security_config')
          .eq('hospital_id', nextHospitalId)
          .maybeSingle()

        const branding = buildBranding(baseHospitalName, settings?.branding_config || {})
        const timeoutMinutes = getValidatedTimeoutMinutes(settings?.user_security_config?.session_timeout_minutes)

        setHospitalId(nextHospitalId)
        setHospitalName(branding.hospitalName)
        setUserRole(role)
        setUserDepartment(dept)
        setLoginBranding(branding)
        setSessionTimeoutMinutes(timeoutMinutes)
        setOfflineMode(false)
        setCheckingAuth(false)
        writeBrandingCache(branding)
        writeAuthCache({
          userId,
          hospitalId: nextHospitalId,
          hospitalName: branding.hospitalName,
          userRole: role,
          userDepartment: dept,
          sessionTimeoutMinutes: timeoutMinutes,
          loginBranding: branding,
          cachedAt: Date.now(),
        })
        writeLastUserContext({ userId, hospitalId: nextHospitalId, userRole: role })

        const establishedAt = Date.now()
        sessionActivityRef.current = {
          establishedAt,
          lastLocalLoginAt: new Date(loginTimestamp).getTime(),
          userId,
          email,
          hospitalId: nextHospitalId,
        }
        setupConcurrentSessionMonitor({ userId, email, nextHospitalId })
        return { hospitalId: nextHospitalId, hospitalName: branding.hospitalName, role, department: dept, sessionTimeoutMinutes: timeoutMinutes }
      }

      const { data: existingHospital } = await supabase
        .from('hospitals')
        .select('id, name')
        .eq('owner_email', email)
        .maybeSingle()

      const metaHospitalId = meta.hospital_id || null
      let nextHospitalId = null
      let nextHospitalName = ''
      let isNewHospital = false

      if (existingHospital) {
        nextHospitalId = existingHospital.id
        nextHospitalName = existingHospital.name
      } else if (metaHospitalId) {
        const { data: linkedHospital, error: linkedHospitalErr } = await supabase
          .from('hospitals')
          .select('id, name')
          .eq('id', metaHospitalId)
          .maybeSingle()

        if (linkedHospital) {
          nextHospitalId = linkedHospital.id
          nextHospitalName = linkedHospital.name
        } else {
          console.warn('Signup metadata hospital_id not found:', metaHospitalId, linkedHospitalErr)
          setAuthError('Unable to resolve your hospital workspace. Please contact support.')
          setCheckingAuth(false)
          return null
        }
      } else {
        isNewHospital = true
        const pendingHospitalName = meta.pending_hospital_name || 'My Hospital'
        const pendingHospitalLocation = meta.pending_hospital_location || 'Kenya'

        const { data: newHospital, error: createError } = await supabase
          .from('hospitals')
          .insert([{ name: pendingHospitalName, owner_email: email, location: pendingHospitalLocation }])
          .select('id, name')
          .single()

        if (createError) {
          console.warn('Hospital creation failed, checking for an already-created workspace:', createError.message)
          const { data: recoveredHospital, error: recoveryError } = await supabase
            .from('hospitals')
            .select('id, name')
            .eq('owner_email', email)
            .maybeSingle()

          if (recoveredHospital) {
            nextHospitalId = recoveredHospital.id
            nextHospitalName = recoveredHospital.name
            isNewHospital = false
          } else {
            console.error('Hospital creation failed:', createError, recoveryError)
            setAuthError(formatWorkspaceSetupError('Unable to create your hospital workspace.', createError))
            setCheckingAuth(false)
            return null
          }
        } else if (newHospital) {
          nextHospitalId = newHospital.id
          nextHospitalName = newHospital.name
        }
      }

      if (nextHospitalId && isNewHospital) {
        const { error: staffError } = await supabase.from('staff').insert({
          hospital_id: nextHospitalId,
          full_name: meta.full_name || 'Hospital Owner',
          email,
          role: 'admin',
          status: 'Active',
          employment_type: 'Full-time',
          current_shift: normalizeShiftLabel(),
        })

        if (staffError) {
          console.error('Owner staff creation failed:', staffError)
          setAuthError('Unable to create your admin user record. Please contact support.')
          setCheckingAuth(false)
          return null
        }

        const { error: rpcErr } = await supabase.rpc('set_staff_role', {
          p_hospital_id: nextHospitalId,
          p_email: email,
          p_role: 'admin',
        })

        if (rpcErr) {
          console.warn('Role sync failed:', rpcErr.message)
          const fallbackSuccess = await ensureHospitalUserLink(userId, nextHospitalId, 'admin')
          if (!fallbackSuccess) {
            setAuthError('Unable to create your admin login link. Please contact support.')
            setCheckingAuth(false)
            return null
          }
        }
      }

      if (nextHospitalId) {
        const { data: hospital, error: hospitalError } = await supabase
          .from('hospitals')
          .select('owner_email')
          .eq('id', nextHospitalId)
          .single()

        if (hospitalError) {
          console.error('Unable to verify hospital owner email:', hospitalError)
          setAuthError('Your hospital workspace could not be verified. Please refresh or contact support.')
          setCheckingAuth(false)
          return null
        }

        const isOwner = hospital?.owner_email === email
        let role = 'staff'

        if (isOwner) {
          role = 'admin'
          await ensureHospitalUserLink(userId, nextHospitalId, 'admin')

          const { data: existingOwnerStaff, error: ownerStaffError } = await supabase
            .from('staff')
            .select('id')
            .eq('hospital_id', nextHospitalId)
            .eq('email', email)
            .maybeSingle()

          if (ownerStaffError) {
            console.warn('Cannot verify owner staff entry:', ownerStaffError.message)
          } else if (!existingOwnerStaff) {
            await supabase.from('staff').insert({
              hospital_id: nextHospitalId,
              full_name: meta.full_name || 'Hospital Owner',
              email,
              role: 'admin',
              status: 'Active',
              employment_type: 'Full-time',
              current_shift: normalizeShiftLabel(),
            })
          }
        } else {
          const { data: staffRecord, error: staffError } = await supabase
            .from('staff')
            .select('role, department')
            .eq('hospital_id', nextHospitalId)
            .eq('email', email)
            .maybeSingle()

          if (staffError) {
            console.warn('Unable to verify staff role:', staffError.message)
          }

          if (staffRecord?.role?.toLowerCase() === 'admin') {
            role = 'admin'
            await ensureHospitalUserLink(userId, nextHospitalId, 'admin')
          } else if (staffRecord?.role) {
            role = staffRecord.role
          }
        }

        const { data: settings } = await supabase
          .from('hospital_settings')
          .select('branding_config, user_security_config')
          .eq('hospital_id', nextHospitalId)
          .maybeSingle()

        const branding = buildBranding(nextHospitalName, settings?.branding_config || {})
        const timeoutMinutes = getValidatedTimeoutMinutes(settings?.user_security_config?.session_timeout_minutes)
        const loginTimestamp = new Date().toISOString()

        await supabase
          .from('hospital_users')
          .update({ last_login_at: loginTimestamp })
          .eq('user_id', userId)
          .eq('hospital_id', nextHospitalId)

        await supabase
          .from('staff')
          .update({ last_login_at: loginTimestamp })
          .eq('hospital_id', nextHospitalId)
          .eq('email', email)

        setHospitalId(nextHospitalId)
        setHospitalName(branding.hospitalName)
        setUserRole(role)
        setUserDepartment(null)
        setLoginBranding(branding)
        setSessionTimeoutMinutes(timeoutMinutes)
        setOfflineMode(false)
        setAuthError(null)
        setCheckingAuth(false)
        writeBrandingCache(branding)
        writeAuthCache({
          userId,
          hospitalId: nextHospitalId,
          hospitalName: branding.hospitalName,
          userRole: role,
          userDepartment: null,
          sessionTimeoutMinutes: timeoutMinutes,
          loginBranding: branding,
          cachedAt: Date.now(),
        })
        writeLastUserContext({ userId, hospitalId: nextHospitalId, userRole: role })

        const establishedAt = Date.now()
        sessionActivityRef.current = {
          establishedAt,
          lastLocalLoginAt: new Date(loginTimestamp).getTime(),
          userId,
          email,
          hospitalId: nextHospitalId,
        }
        setupConcurrentSessionMonitor({ userId, email, nextHospitalId })
        return { hospitalId: nextHospitalId, hospitalName: branding.hospitalName, role, department: null, sessionTimeoutMinutes: timeoutMinutes }
      }

      setAuthError('Unable to resolve your hospital workspace. Please contact support.')
      setCheckingAuth(false)
      return null
    })()

    if (userId) {
      hospitalBootstrapRef.current = { userId, promise: run }
      run.finally(() => {
        if (hospitalBootstrapRef.current?.promise === run) {
          hospitalBootstrapRef.current = null
        }
      })
    }

    return run
  }, [ensureHospitalUserLink, setupConcurrentSessionMonitor])

  useEffect(() => {
    if (!window?.electronAPI?.onDeepLink) return undefined

    const unsubscribe = window.electronAPI.onDeepLink(handleDeepLink)
    return () => {
      if (unsubscribe && typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [handleDeepLink])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (!active) return

      if (error) {
        await clearStaleSession(`Unable to restore saved session: ${error.message}`)
        return
      }

      const gate = readAuthGate()
      if (session?.user && gateMatchesUser(gate, session.user)) {
        setCheckingAuth(false)
        return
      }

      if (session?.user && !isPasswordRecovery) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          if (applyCachedOfflineAuth(session.user)) return
        }

        const { error: userError } = await supabase.auth.getUser()
        if (!active) return

        if (userError) {
          const normalized = userError.message?.toLowerCase() || ''
          if (isConnectivityError(userError) && applyCachedOfflineAuth(session.user)) {
            return
          }
          if (normalized.includes('refresh token') || normalized.includes('jwt') || normalized.includes('session')) {
            await clearStaleSession(`Saved session expired: ${userError.message}`)
            return
          }
          console.warn('Session verification warning:', userError.message)
        }

        setUser(session.user)
        fetchHospitalId(session.user)
      } else {
        setCheckingAuth(false)
      }
    }).catch(async (error) => {
      if (!active) return
      await clearStaleSession(`Session bootstrap failed: ${error?.message || error}`)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true)
        setUser(null)
        setCheckingAuth(false)
        return
      }

      if (event === 'SIGNED_IN' && !isPasswordRecovery && session?.user) {
        const gate = readAuthGate()
        if (gateMatchesUser(gate, session.user)) {
          setCheckingAuth(false)
          return
        }
        setUser(session.user)
        fetchHospitalId(session.user)
      }

      if (event === 'SIGNED_OUT') {
        resetAuthState()
        onSignedOut?.()
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
      closeConcurrentSessionChannel()
    }
  }, [applyCachedOfflineAuth, clearStaleSession, closeConcurrentSessionChannel, fetchHospitalId, isPasswordRecovery, onSignedOut, resetAuthState])

  const handleLogin = useCallback(async (authUser, options = {}) => {
    clearAuthGate()
    setUser(authUser)
    const summary = await fetchHospitalId(authUser)
    const nextPath = consumeReturnPath() || getDefaultLandingPath(summary?.role)
    setPostLoginRedirectPath(options?.skipRedirect ? null : nextPath)
  }, [fetchHospitalId])

  const consumePostLoginRedirect = useCallback(() => {
    setPostLoginRedirectPath(null)
  }, [])

  const handleTimeoutLogout = useCallback(async (currentPath) => {
    if (currentPath) saveReturnPath(currentPath)
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
    } catch (error) {
      console.warn('Timeout sign-out cleanup failed:', error?.message || error)
    } finally {
      resetAuthState()
    }
  }, [resetAuthState])

  const handleLogout = useCallback(async () => {
    if (!await window.openConfirmDialog('Sign out from REMEDACARE HMS?')) return
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
    } catch (error) {
      console.warn('Sign-out cleanup failed:', error?.message || error)
    } finally {
      resetAuthState()
    }
  }, [resetAuthState])

  const resetPasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(false)
    localStorage.removeItem('remedacare_password_recovery')
    localStorage.removeItem('remedacare_reset_token')
  }, [])

  return {
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
    fetchHospitalId,
    handleLogin,
    handleLogout,
    handleTimeoutLogout,
    consumePostLoginRedirect,
    resetPasswordRecovery,
  }
}
