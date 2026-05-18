import { useEffect, useMemo, useState } from 'react'
import supabase from '../supabase'
import { sendPatientNotification } from '../utils/notifications'

const AUTH_GATE_KEY = 'remedacare:auth:gate'
const KNOWN_USERS_KEY = 'remedacare:auth:known_users'
const DEVICE_TOKEN_KEY = 'remedacare:auth:device_token'
const TRUSTED_DEVICE_KEY = 'remedacare:auth:trusted_devices'
const REMEMBER_PREF_KEY = 'remedacare:auth:remember_device'
const LOGIN_ATTEMPTS_KEY = 'remedacare:auth:login_attempts'
const BRANDING_CACHE_KEY = 'remedacare:auth:branding'
const DEFAULT_BRANDING = {
  hospitalName: 'RemedacareHMIS',
  logoBase64: '',
  level: 'Kenya',
  primaryColor: '#0F6E56',
}
const MFA_WINDOW_MS = 5 * 60 * 1000
const DEVICE_TRUST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000
const MAX_LOGIN_ATTEMPTS = 5

function isRlsError(error) {
  const message = error?.message?.toLowerCase() || ''
  return message.includes('row-level security') || error?.code === '42501'
}

function formatRlsAwareError(prefix, error) {
  if (!error) return prefix
  if (isRlsError(error)) {
    return `${prefix} Database permissions blocked this action. Check the relevant Supabase RLS policies.`
  }
  return `${prefix} ${error.message || error}`
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
    // ignore storage errors
  }
}

function removeStorage(storage, key) {
  try {
    storage?.removeItem(key)
  } catch (_) {
    // ignore
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
    ...(readJson(window.localStorage, BRANDING_CACHE_KEY, {}) || {}),
  }
}

function writeBrandingCache(value) {
  if (typeof window === 'undefined') return
  writeJson(window.localStorage, BRANDING_CACHE_KEY, {
    ...DEFAULT_BRANDING,
    ...(value || {}),
  })
}

function getKnownUsers() {
  if (typeof window === 'undefined') return []
  return readJson(window.localStorage, KNOWN_USERS_KEY, [])
}

function rememberKnownUser(email, branding) {
  if (typeof window === 'undefined' || !email) return
  const current = getKnownUsers()
  const next = [
    { email: String(email).toLowerCase(), lastSeenAt: new Date().toISOString() },
    ...current.filter((item) => String(item?.email || '').toLowerCase() !== String(email).toLowerCase()),
  ].slice(0, 12)
  writeJson(window.localStorage, KNOWN_USERS_KEY, next)
  if (branding) writeBrandingCache(branding)
}

function getOrCreateDeviceToken(persist = true) {
  if (typeof window === 'undefined') return 'device-web'
  const targetStorage = persist ? window.localStorage : window.sessionStorage
  const fallbackStorage = persist ? window.sessionStorage : window.localStorage
  let token = targetStorage.getItem(DEVICE_TOKEN_KEY) || fallbackStorage.getItem(DEVICE_TOKEN_KEY)
  if (!token) {
    token = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
  try {
    targetStorage.setItem(DEVICE_TOKEN_KEY, token)
  } catch (_) {
    fallbackStorage.setItem(DEVICE_TOKEN_KEY, token)
  }
  return token
}

function getTrustedDevices() {
  if (typeof window === 'undefined') return []
  return readJson(window.localStorage, TRUSTED_DEVICE_KEY, [])
}

function isTrustedDevice(userId) {
  if (typeof window === 'undefined' || !userId) return false
  const deviceToken = getOrCreateDeviceToken(true)
  return getTrustedDevices().some((entry) => (
    entry?.userId === userId &&
    entry?.deviceToken === deviceToken &&
    Number(entry?.expiresAt || 0) > Date.now()
  ))
}

function trustDevice(userId, email) {
  if (typeof window === 'undefined' || !userId) return
  const deviceToken = getOrCreateDeviceToken(true)
  const next = [
    {
      userId,
      email: String(email || '').toLowerCase(),
      deviceToken,
      trustedAt: new Date().toISOString(),
      expiresAt: Date.now() + DEVICE_TRUST_WINDOW_MS,
    },
    ...getTrustedDevices().filter((entry) => !(entry?.userId === userId && entry?.deviceToken === deviceToken)),
  ].slice(0, 30)
  writeJson(window.localStorage, TRUSTED_DEVICE_KEY, next)
}

function getLoginAttempts(email) {
  if (typeof window === 'undefined') return []
  const all = readJson(window.localStorage, LOGIN_ATTEMPTS_KEY, {})
  return Array.isArray(all?.[String(email || '').toLowerCase()]) ? all[String(email || '').toLowerCase()] : []
}

function saveLoginAttempts(email, attempts) {
  if (typeof window === 'undefined') return
  const cleanEmail = String(email || '').toLowerCase()
  const all = readJson(window.localStorage, LOGIN_ATTEMPTS_KEY, {})
  all[cleanEmail] = attempts
  writeJson(window.localStorage, LOGIN_ATTEMPTS_KEY, all)
}

function getActiveLock(email) {
  const now = Date.now()
  const attempts = getLoginAttempts(email).filter((entry) => now - Number(entry?.at || 0) < LOGIN_LOCK_WINDOW_MS)
  if (attempts.length < MAX_LOGIN_ATTEMPTS) return null
  const lockedUntil = Number(attempts[attempts.length - 1]?.at || now) + LOGIN_LOCK_WINDOW_MS
  return lockedUntil > now ? lockedUntil : null
}

function recordFailedAttempt(email) {
  const now = Date.now()
  const current = getLoginAttempts(email).filter((entry) => now - Number(entry?.at || 0) < LOGIN_LOCK_WINDOW_MS)
  current.push({ at: now })
  saveLoginAttempts(email, current)
  return getActiveLock(email)
}

function clearFailedAttempts(email) {
  if (!email) return
  saveLoginAttempts(email, [])
}

function maskEmail(email = '') {
  const [local, domain] = String(email || '').split('@')
  if (!local || !domain) return email || 'your email'
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`
  return `${local.slice(0, 2)}***@${domain}`
}

function maskPhone(phone = '') {
  const clean = String(phone || '').replace(/\s+/g, '')
  if (clean.length < 4) return phone || 'your phone'
  return `${clean.slice(0, 4)}***${clean.slice(-2)}`
}

function getErrorMessage(err) {
  if (!err) return ''
  if (typeof err === 'string') return err
  if (err.message) return err.message
  if (err.error_description) return err.error_description
  return 'Something went wrong. Please try again.'
}

async function getFriendlyLoginError(err, email) {
  const message = getErrorMessage(err)
  const lower = message.toLowerCase()

  if (lower.includes('email not confirmed')) {
    return 'This account has not been confirmed yet. Please check your email for the activation link.'
  }
  if (lower.includes('too many requests') || lower.includes('rate limit')) {
    return 'Too many sign-in attempts were made. Please wait a few minutes and try again.'
  }
  if (lower.includes('invalid login credentials')) {
    const known = getKnownUsers().some((item) => String(item?.email || '').toLowerCase() === String(email || '').toLowerCase())
    if (known) return 'The password you entered is incorrect for this email address.'

    try {
      const { data, error } = await supabase
        .from('staff')
        .select('id')
        .eq('email', String(email || '').toLowerCase())
        .maybeSingle()

      if (!error && data?.id) {
        return 'The password you entered is incorrect for this email address.'
      }
      if (!error && !data) {
        return 'No active account was found for this email address.'
      }
    } catch (_) {
      // fall through to generic error
    }

    return 'We could not sign you in. Check the email address and password, then try again.'
  }

  return message
}

function getPasswordStrength(password = '') {
  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1

  if (!password) return { label: 'Enter a password', color: '#9CA3AF', score: 0 }
  if (score <= 2) return { label: 'Weak', color: '#DC2626', score }
  if (score === 3) return { label: 'Fair', color: '#D97706', score }
  if (score === 4) return { label: 'Strong', color: '#0F6E56', score }
  return { label: 'Very strong', color: '#0B5F4B', score }
}

function buildBranding(hospitalName, brandingConfig = {}) {
  return {
    hospitalName: brandingConfig?.hospital_name || hospitalName || DEFAULT_BRANDING.hospitalName,
    logoBase64: brandingConfig?.logo_base64 || '',
    level: brandingConfig?.level || DEFAULT_BRANDING.level,
    primaryColor: brandingConfig?.primary_color || DEFAULT_BRANDING.primaryColor,
  }
}

async function loadAuthProfile(authUser, email) {
  const cleanEmail = String(email || authUser?.email || '').toLowerCase()
  const { data: hospitalUser } = await supabase
    .from('hospital_users')
    .select('hospital_id, role, active, must_change_password, two_factor_enabled, custom_permissions, hospitals(name)')
    .eq('user_id', authUser.id)
    .maybeSingle()

  const { data: staff } = await supabase
    .from('staff')
    .select('id, full_name, email, phone, role, department, must_change_password, two_factor_enabled, custom_permissions')
    .eq('email', cleanEmail)
    .maybeSingle()

  const hospitalId = hospitalUser?.hospital_id || authUser?.user_metadata?.hospital_id || null
  let settings = null
  if (hospitalId) {
    const { data } = await supabase
      .from('hospital_settings')
      .select('branding_config, user_security_config')
      .eq('hospital_id', hospitalId)
      .maybeSingle()
    settings = data || null
  }

  const hospitalName = hospitalUser?.hospitals?.name || authUser?.user_metadata?.pending_hospital_name || DEFAULT_BRANDING.hospitalName
  const branding = buildBranding(hospitalName, settings?.branding_config || {})
  const role = staff?.role || hospitalUser?.role || 'staff'
  const roleResolved = role
  const twoFactorEnabled = Boolean(
    hospitalUser?.two_factor_enabled ||
    staff?.two_factor_enabled ||
    (Array.isArray(settings?.user_security_config?.require_mfa_roles) && settings.user_security_config.require_mfa_roles.includes(roleResolved))
  )
  const mustChangePassword = hospitalUser?.must_change_password === true || staff?.must_change_password === true
  const customPermissions = {
    ...(hospitalUser?.custom_permissions || {}),
    ...(staff?.custom_permissions || {}),
  }

  return {
    authUser,
    email: cleanEmail,
    hospitalId,
    hospitalName: branding.hospitalName,
    branding,
    settings,
    hospitalUser,
    staff,
    role: roleResolved,
    mustChangePassword,
    twoFactorEnabled,
    customPermissions,
  }
}

function getTotpSecret(profile) {
  return (
    profile?.customPermissions?.mfa_totp_secret ||
    profile?.customPermissions?.totp_secret ||
    profile?.hospitalUser?.custom_permissions?.mfa_totp_secret ||
    profile?.staff?.custom_permissions?.mfa_totp_secret ||
    ''
  )
}

function getMfaMethod(profile) {
  const preferred = String(profile?.customPermissions?.mfa_method || '').toLowerCase()
  const totpSecret = getTotpSecret(profile)
  if (totpSecret) return 'totp'
  if (preferred === 'sms' && profile?.staff?.phone) return 'sms'
  if (preferred === 'email') return 'email'
  if (profile?.staff?.phone) return 'sms'
  return 'email'
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function base32ToBytes(input = '') {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = String(input || '').toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '')
  let bits = ''
  for (const char of clean) {
    const index = alphabet.indexOf(char)
    if (index < 0) continue
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  return new Uint8Array(bytes)
}

function buildCounterBytes(counter) {
  const bytes = new Uint8Array(8)
  let value = counter
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = value & 0xff
    value = Math.floor(value / 256)
  }
  return bytes
}

async function generateTotp(secret, timestamp = Date.now()) {
  if (!window?.crypto?.subtle) return null
  const keyData = base32ToBytes(secret)
  if (!keyData.length) return null
  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const counter = Math.floor(timestamp / 30000)
  const signature = new Uint8Array(await window.crypto.subtle.sign('HMAC', cryptoKey, buildCounterBytes(counter)))
  const offset = signature[signature.length - 1] & 0x0f
  const binary = (
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff)
  )
  return String(binary % 1000000).padStart(6, '0')
}

async function verifyTotp(secret, code) {
  const candidate = String(code || '').trim()
  if (!candidate || candidate.length < 6) return false
  for (let offset = -1; offset <= 1; offset += 1) {
    const generated = await generateTotp(secret, Date.now() + (offset * 30000))
    if (generated === candidate) return true
  }
  return false
}

async function logAuthAudit(action, details = {}, hospitalId = null) {
  try {
    await supabase.from('audit_log').insert({
      hospital_id: hospitalId || 'auth',
      user_role: 'Authentication',
      action,
      target_table: 'auth',
      target_id: details?.email || details?.userId || null,
      details: JSON.stringify({
        ...details,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        ip_address: null,
      }),
      performed_at: new Date().toISOString(),
    })
  } catch (_) {
    // Auth logging is best-effort. Pre-login failures can still be blocked by RLS.
  }
}

export default function Login({ onLogin, isPasswordRecovery, onResetDone, branding }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activationMessage, setActivationMessage] = useState('')
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [newHospitalName, setNewHospitalName] = useState('')
  const [newHospitalLocation, setNewHospitalLocation] = useState('Kenya')
  const [showPassword, setShowPassword] = useState(false)
  const [showResetPassword, setShowResetPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pendingUser, setPendingUser] = useState(null)
  const [showFirstNewPw, setShowFirstNewPw] = useState(false)
  const [showFirstConfirmPw, setShowFirstConfirmPw] = useState(false)
  const [rememberDevice, setRememberDevice] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem(REMEMBER_PREF_KEY) !== 'false'
  })
  const [trustThisDevice, setTrustThisDevice] = useState(true)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaChallenge, setMfaChallenge] = useState(null)
  const [displayBranding, setDisplayBranding] = useState(() => ({
    ...readBrandingCache(),
    ...(branding || {}),
  }))

  const passwordStrength = useMemo(() => getPasswordStrength(newPassword || password), [newPassword, password])

  useEffect(() => {
    setDisplayBranding({
      ...readBrandingCache(),
      ...(branding || {}),
    })
  }, [branding])

  useEffect(() => {
    if (isPasswordRecovery) {
      setMode('reset')
      setNewPassword('')
      setConfirmPassword('')
      setError('')
    }
  }, [isPasswordRecovery])

  useEffect(() => {
    const gate = readAuthGate()
    if (!gate?.stage) return

    if (gate.stage === 'first_login') {
      setPendingUser({ id: gate.userId, email: gate.email })
      setMode('first_login')
      setError('')
      setDisplayBranding({
        ...readBrandingCache(),
        hospitalName: gate.hospitalName || readBrandingCache().hospitalName,
      })
    }

    if (gate.stage === 'mfa') {
      setPendingUser({ id: gate.userId, email: gate.email })
      setMfaChallenge(gate)
      setMode('mfa')
      setError('')
      setDisplayBranding({
        ...readBrandingCache(),
        hospitalName: gate.hospitalName || readBrandingCache().hospitalName,
      })
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const checkDeepLink = async () => {
      if (window.electronAPI) {
        return window.electronAPI.onDeepLink(async (url) => {
          const urlObj = new URL(url)
          const token = urlObj.searchParams.get('token')
          const hash = urlObj.hash.replace(/^#/, '')
          if (token || hash) {
            setMode('reset')
            setError('')
          }
        })
      }

      const searchParams = new URLSearchParams(window.location.search)
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const hasToken = searchParams.has('token') || hashParams.has('access_token') || hashParams.has('token')
      if (hasToken) {
        setMode('reset')
        setError('')
      }
      return undefined
    }

    let unsubscribe
    checkDeepLink().then((cleanup) => {
      unsubscribe = cleanup
    })

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  function resetAuthFlowState() {
    setPendingUser(null)
    setMfaChallenge(null)
    setMfaCode('')
    setTrustThisDevice(true)
    clearAuthGate()
  }

  function showLockMessage(lockedUntil) {
    const minutes = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000))
    setError(`This device is locked for ${minutes} more minute${minutes === 1 ? '' : 's'} after repeated failed sign-in attempts.`)
  }

  async function startMfaChallenge(authUser, profile, rememberPreference) {
    const method = getMfaMethod(profile)
    const deviceToken = getOrCreateDeviceToken(Boolean(rememberPreference))
    const baseChallenge = {
      stage: 'mfa',
      userId: authUser.id,
      email: profile.email,
      hospitalId: profile.hospitalId,
      hospitalName: profile.hospitalName,
      rememberDevice: Boolean(rememberPreference),
      deviceToken,
      method,
      expiresAt: Date.now() + MFA_WINDOW_MS,
      issuedAt: Date.now(),
      fullName: profile.staff?.full_name || authUser?.user_metadata?.full_name || '',
      phone: profile.staff?.phone || '',
    }

    if (method === 'totp') {
      const nextChallenge = {
        ...baseChallenge,
        deliveryHint: 'Open Google Authenticator or your hospital authenticator app to continue.',
        totpSecret: getTotpSecret(profile),
      }
      writeAuthGate(nextChallenge)
      setMfaChallenge(nextChallenge)
      setMode('mfa')
      return
    }

    if (method === 'sms') {
      const otpCode = generateOtpCode()
      const sendResult = await sendPatientNotification({
        phone: profile.staff?.phone,
        message: `${profile.hospitalName}: Your login verification code is ${otpCode}. It expires in 5 minutes.`,
        hospitalName: profile.hospitalName,
        notificationType: 'auth_mfa',
        patientId: null,
        hospitalId: profile.hospitalId,
      })

      if (sendResult.success) {
        const nextChallenge = {
          ...baseChallenge,
          otpCode,
          deliveryHint: `A verification code was sent to ${maskPhone(profile.staff?.phone)}.`,
        }
        writeAuthGate(nextChallenge)
        setMfaChallenge(nextChallenge)
        setMode('mfa')
        return
      }
    }

    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: profile.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: 'remedacare://reset',
      },
    })

    if (otpErr) {
      throw new Error('Multi-factor verification could not send a code. Check notification configuration and try again.')
    }

    const nextChallenge = {
      ...baseChallenge,
      method: 'email',
      deliveryHint: `Enter the one-time code sent to ${maskEmail(profile.email)}.`,
    }
    writeAuthGate(nextChallenge)
    setMfaChallenge(nextChallenge)
    setMode('mfa')
  }

  async function finalizeSuccessfulLogin(authUser, profile, rememberPreference) {
    clearFailedAttempts(profile?.email || authUser?.email)
    rememberKnownUser(profile?.email || authUser?.email, profile?.branding)
    writeBrandingCache(profile?.branding)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(REMEMBER_PREF_KEY, rememberPreference ? 'true' : 'false')
      if (rememberPreference) {
        getOrCreateDeviceToken(true)
      }
    }
    resetAuthFlowState()
    await logAuthAudit('login_success', {
      email: profile?.email || authUser?.email,
      userId: authUser?.id,
      remember_device: Boolean(rememberPreference),
    }, profile?.hospitalId || null)
    onLogin(authUser)
  }

  async function handleLogin() {
    if (!email || !password) {
      setError('Enter email and password')
      return
    }

    const lockedUntil = getActiveLock(email)
    if (lockedUntil) {
      showLockMessage(lockedUntil)
      return
    }

    setLoading(true)
    setError('')

    try {
      writeAuthGate({
        stage: 'primary',
        email: String(email).toLowerCase(),
        rememberDevice: Boolean(rememberDevice),
        startedAt: Date.now(),
      })

      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) throw err

      const authUser = data.user
      const profile = await loadAuthProfile(authUser, email)
      setPendingUser(authUser)
      setDisplayBranding(profile.branding)

      if (profile.hospitalUser?.active === false) {
        await supabase.auth.signOut({ scope: 'local' })
        resetAuthFlowState()
        setError('Your account has been deactivated. Please contact your hospital administrator.')
        setLoading(false)
        return
      }

      if (profile.mustChangePassword) {
        writeAuthGate({
          stage: 'first_login',
          userId: authUser.id,
          email: profile.email,
          rememberDevice: Boolean(rememberDevice),
          hospitalName: profile.hospitalName,
        })
        setMode('first_login')
        setLoading(false)
        return
      }

      if (profile.twoFactorEnabled && !isTrustedDevice(authUser.id)) {
        await startMfaChallenge(authUser, profile, rememberDevice)
        setLoading(false)
        return
      }

      await finalizeSuccessfulLogin(authUser, profile, rememberDevice)
    } catch (e) {
      clearAuthGate()
      const nextLock = recordFailedAttempt(email)
      const friendly = await getFriendlyLoginError(e, email)
      setError(nextLock ? `${friendly} This device is now locked for 15 minutes after repeated failed attempts.` : friendly)
      await logAuthAudit('login_failed', {
        email: String(email || '').toLowerCase(),
        reason: getErrorMessage(e),
        locked_until: nextLock || null,
      })
    }
    setLoading(false)
  }

  async function handleFirstLoginPasswordChange() {
    if (!newPassword || !confirmPassword) return setError('Fill in both fields')
    if (newPassword.length < 8) return setError('Password must be at least 8 characters')
    if (newPassword !== confirmPassword) return setError('Passwords do not match')

    setLoading(true)
    setError('')
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword })
      if (updateErr) throw updateErr

      const gate = readAuthGate()
      const userId = gate?.userId || pendingUser?.id
      const userEmail = String(gate?.email || pendingUser?.email || '').toLowerCase()
      const syncErrors = []

      if (userId) {
        const { error: hospitalUserUpdateError } = await supabase
          .from('hospital_users')
          .update({ must_change_password: false })
          .eq('user_id', userId)
        if (hospitalUserUpdateError) syncErrors.push(hospitalUserUpdateError)
      }
      if (userEmail) {
        const { error: staffUpdateError } = await supabase
          .from('staff')
          .update({ must_change_password: false })
          .eq('email', userEmail)
        if (staffUpdateError) syncErrors.push(staffUpdateError)
      }

      if (syncErrors.length > 0) {
        const rlsError = syncErrors.find(isRlsError)
        if (rlsError) {
          setError(formatRlsAwareError('Password updated, but first-login flags could not be cleared.', rlsError))
          setLoading(false)
          return
        }
      }

      const { data: sessionData } = await supabase.auth.getSession()
      const authUser = sessionData?.session?.user || pendingUser
      if (!authUser) throw new Error('Session expired. Please sign in again.')

      const profile = await loadAuthProfile(authUser, userEmail || authUser.email)
      if (profile.twoFactorEnabled && !isTrustedDevice(authUser.id)) {
        await startMfaChallenge(authUser, profile, gate?.rememberDevice)
        setLoading(false)
        return
      }

      window.notifyFromLegacyAlert('Password set successfully!')
      await finalizeSuccessfulLogin(authUser, profile, gate?.rememberDevice)
    } catch (e) {
      setError(`Failed to update password: ${getErrorMessage(e)}`)
    }
    setLoading(false)
  }

  async function handleVerifyMfa() {
    if (!mfaCode.trim()) {
      setError('Enter the verification code to continue.')
      return
    }

    const challenge = mfaChallenge || readAuthGate()
    if (!challenge?.userId) {
      setError('Your verification session has expired. Please sign in again.')
      resetAuthFlowState()
      setMode('login')
      return
    }
    if (Number(challenge.expiresAt || 0) < Date.now()) {
      setError('This verification code has expired. Please sign in again to get a new code.')
      resetAuthFlowState()
      setMode('login')
      return
    }

    setLoading(true)
    setError('')
    try {
      let verified = false

      if (challenge.method === 'totp') {
        verified = await verifyTotp(challenge.totpSecret, mfaCode)
      } else if (challenge.method === 'email') {
        if (!supabase.auth.verifyOtp) {
          throw new Error('Email OTP verification is not available in this environment.')
        }
        const { error: verifyErr } = await supabase.auth.verifyOtp({
          email: challenge.email,
          token: mfaCode.trim(),
          type: 'email',
        })
        if (verifyErr) throw verifyErr
        verified = true
      } else {
        verified = String(challenge.otpCode || '').trim() === String(mfaCode || '').trim()
      }

      if (!verified) {
        setError('The verification code is incorrect. Please try again.')
        setLoading(false)
        return
      }

      const { data: sessionData } = await supabase.auth.getSession()
      const authUser = sessionData?.session?.user || pendingUser
      if (!authUser) throw new Error('Your session is no longer available. Please sign in again.')

      const profile = await loadAuthProfile(authUser, challenge.email)
      if (trustThisDevice) trustDevice(challenge.userId, challenge.email)
      await finalizeSuccessfulLogin(authUser, profile, challenge.rememberDevice)
    } catch (e) {
      setError(getErrorMessage(e))
    }
    setLoading(false)
  }

  async function handleResendMfaCode() {
    const challenge = mfaChallenge || readAuthGate()
    if (!challenge?.userId) {
      setError('Your verification session has expired. Please sign in again.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const authUser = sessionData?.session?.user || pendingUser
      if (!authUser) throw new Error('Your session is no longer available. Please sign in again.')

      const profile = await loadAuthProfile(authUser, challenge.email)
      await startMfaChallenge(authUser, profile, challenge.rememberDevice)
      window.notifyFromLegacyAlert('A new verification code has been sent.')
    } catch (e) {
      setError(getErrorMessage(e))
    }
    setLoading(false)
  }

  async function handleResetPassword() {
    if (!newPassword || !confirmPassword) return setError('Fill in both fields')
    if (newPassword.length < 8) return setError('Password must be at least 8 characters')
    if (newPassword !== confirmPassword) return setError('Passwords do not match')

    setLoading(true)
    setError('')

    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword })

      if (updateErr) {
        if (
          updateErr.message?.includes('session') ||
          updateErr.message?.includes('missing') ||
          updateErr.message?.includes('expired')
        ) {
          setError('Session expired. Please request a new password reset link.')
          setMode('forgot')
        } else {
          throw updateErr
        }
      } else {
        window.notifyFromLegacyAlert('Password updated successfully!')
        await supabase.auth.signOut()
        setMode('login')
        setNewPassword('')
        setConfirmPassword('')
        setResetSent(false)
        onResetDone?.()
      }
    } catch (err) {
      setError(getErrorMessage(err))
    }
    setLoading(false)
  }

  async function handleForgotPassword() {
    if (!email) return setError('Enter your email address')
    setLoading(true)
    setError('')
    try {
      const redirectTo = 'remedacare://reset'
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
      if (err) throw err

      setResetSent(true)
      window.notifyFromLegacyAlert('Password reset link sent to your email!')
    } catch (e) {
      setError(getErrorMessage(e))
    }
    setLoading(false)
  }

  async function handleSignup() {
    if (!email || !password || !name || !newHospitalName) return setError('All fields are required')
    if (password.length < 8) return setError('Password must be at least 8 characters')
    setLoading(true)
    setError('')

    try {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            pending_hospital_name: newHospitalName.trim(),
            pending_hospital_location: newHospitalLocation.trim() || 'Kenya',
          },
        },
      })

      if (err) throw err

      window.notifyFromLegacyAlert('Account created. Check your email to confirm, then sign in.')
      setMode('login')
      setName('')
      setEmail('')
      setPassword('')
      setNewHospitalName('')
      setNewHospitalLocation('Kenya')
    } catch (e) {
      setError(getErrorMessage(e))
    }
    setLoading(false)
  }

  const brandAccent = displayBranding.primaryColor || '#0F6E56'
  const strengthForDisplay = mode === 'signup' ? getPasswordStrength(password) : getPasswordStrength(newPassword)
  const lockExpiresAt = getActiveLock(email)

  return (
    <div style={st.page}>
      <div style={st.heroGlow(brandAccent)} />
      <div style={st.card}>
        <div style={st.logoArea}>
          {displayBranding.logoBase64 ? (
            <img src={displayBranding.logoBase64} alt="Hospital logo" style={st.logoImage} />
          ) : (
            <div style={{ ...st.logoIcon, color: brandAccent }}>Hospital</div>
          )}
          <div style={st.hospitalBadge}>Kenya {displayBranding.level || 'Level Facility'}</div>
          <h1 style={{ ...st.logoText, color: brandAccent }}>{displayBranding.hospitalName || 'RemedacareHMIS'}</h1>
          <p style={st.logoSub}>Secure clinical sign-in and hospital workspace access</p>
        </div>

        {activationMessage && <div style={st.infoBox}>{activationMessage}</div>}
        {error && <div style={st.errorBox}>{error}</div>}
        {!error && lockExpiresAt ? <div style={st.warningBox}>This device is temporarily locked after repeated failed sign-in attempts.</div> : null}

        {(mode === 'login' || mode === 'signup') && (
          <div style={st.tabs}>
            <button
              style={{ ...st.tab, ...(mode === 'login' ? st.tabActive(brandAccent) : {}) }}
              onClick={() => { setMode('login'); setError('') }}
            >
              Sign In
            </button>
            <button
              style={{ ...st.tab, ...(mode === 'signup' ? st.tabActive(brandAccent) : {}) }}
              onClick={() => { setMode('signup'); setError('') }}
            >
              Create Account
            </button>
          </div>
        )}

        {mode === 'first_login' && (
          <>
            <div style={st.firstLoginBadge}>First-time login detected</div>
            <h3 style={st.sectionTitle}>Set Your Personal Password</h3>
            <p style={st.firstLoginNote}>
              Your account was created by an administrator. Please set a strong personal password before continuing.
            </p>
            <div style={st.formGroup}>
              <label style={st.label}>New Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={st.input}
                  type={showFirstNewPw ? 'text' : 'password'}
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoFocus
                />
                <button type="button" onClick={() => setShowFirstNewPw((v) => !v)} style={st.eyeBtn}>
                  {showFirstNewPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div style={st.strengthRow}>
              <div style={{ ...st.strengthBar, background: strengthForDisplay.color, width: `${Math.max(18, strengthForDisplay.score * 20)}%` }} />
              <span style={{ ...st.strengthText, color: strengthForDisplay.color }}>{strengthForDisplay.label}</span>
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={st.input}
                  type={showFirstConfirmPw ? 'text' : 'password'}
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleFirstLoginPasswordChange()}
                />
                <button type="button" onClick={() => setShowFirstConfirmPw((v) => !v)} style={st.eyeBtn}>
                  {showFirstConfirmPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button style={{ ...st.btnPrimary, background: brandAccent }} onClick={handleFirstLoginPasswordChange} disabled={loading}>
              {loading ? 'Setting password...' : 'Set Password & Continue'}
            </button>
          </>
        )}

        {mode === 'mfa' && (
          <>
            <div style={st.firstLoginBadge}>Multi-factor verification required</div>
            <h3 style={st.sectionTitle}>Verify Your Identity</h3>
            <p style={st.note}>
              {mfaChallenge?.deliveryHint || 'Enter the verification code to continue.'}
            </p>
            <div style={st.formGroup}>
              <label style={st.label}>Verification Code</label>
              <input
                style={{ ...st.input, letterSpacing: '4px', textAlign: 'center', fontSize: '20px', fontWeight: 700 }}
                placeholder="123456"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyMfa()}
                autoFocus
              />
            </div>
            <label style={st.checkboxRow}>
              <input type="checkbox" checked={trustThisDevice} onChange={(e) => setTrustThisDevice(e.target.checked)} />
              <span>Trust this device for 30 days</span>
            </label>
            <button style={{ ...st.btnPrimary, background: brandAccent }} onClick={handleVerifyMfa} disabled={loading}>
              {loading ? 'Verifying...' : 'Verify & Continue'}
            </button>
            <div style={st.secondaryActions}>
              <button type="button" style={st.linkBtn} onClick={handleResendMfaCode} disabled={loading}>
                Resend Code
              </button>
              <button
                type="button"
                style={st.linkBtn}
                onClick={async () => {
                  resetAuthFlowState()
                  await supabase.auth.signOut({ scope: 'local' })
                  setMode('login')
                }}
              >
                Back to Login
              </button>
            </div>
          </>
        )}

        {mode === 'reset' && (
          <>
            <h3 style={st.sectionTitle}>Set New Password</h3>
            <div style={st.formGroup}>
              <label style={st.label}>New Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={st.input}
                  type={showResetPassword ? 'text' : 'password'}
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoFocus
                />
                <button type="button" onClick={() => setShowResetPassword((v) => !v)} style={st.eyeBtn}>
                  {showResetPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div style={st.strengthRow}>
              <div style={{ ...st.strengthBar, background: strengthForDisplay.color, width: `${Math.max(18, strengthForDisplay.score * 20)}%` }} />
              <span style={{ ...st.strengthText, color: strengthForDisplay.color }}>{strengthForDisplay.label}</span>
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={st.input}
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleResetPassword()}
                />
                <button type="button" onClick={() => setShowConfirmPassword((v) => !v)} style={st.eyeBtn}>
                  {showConfirmPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button style={{ ...st.btnPrimary, background: brandAccent }} onClick={handleResetPassword} disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </>
        )}

        {mode === 'forgot' && (
          <>
            <p style={st.note}>Enter your email address to receive a secure Supabase password reset link.</p>
            <div style={st.formGroup}>
              <label style={st.label}>Email Address</label>
              <input
                style={st.input}
                type="email"
                placeholder="admin@hospital.co.ke"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !resetSent && handleForgotPassword()}
              />
            </div>
            {resetSent ? (
              <div style={st.successBox}>Reset link sent. Check your email for the secure magic link.</div>
            ) : (
              <button style={{ ...st.btnPrimary, background: brandAccent }} onClick={handleForgotPassword} disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            )}
            <p style={st.footerNote}>
              <span style={{ ...st.link, color: brandAccent }} onClick={() => { setMode('login'); setResetSent(false) }}>Back to Login</span>
            </p>
          </>
        )}

        {mode === 'login' && (
          <>
            <div style={st.formGroup}>
              <label style={st.label}>Email Address</label>
              <input
                style={st.input}
                type="email"
                placeholder="admin@hospital.co.ke"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div style={{ textAlign: 'right', marginBottom: '8px' }}>
              <span style={{ ...st.link, color: brandAccent }} onClick={() => setMode('forgot')}>Forgot Password?</span>
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={st.input}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} style={st.eyeBtn}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <label style={st.checkboxRow}>
              <input type="checkbox" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} />
              <span>Remember this device</span>
            </label>
            <button style={{ ...st.btnPrimary, background: brandAccent }} onClick={handleLogin} disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <p style={st.footerNote}>
              Don't have an account?{' '}
              <span style={{ ...st.link, color: brandAccent }} onClick={() => { setMode('signup'); setError('') }}>Create one</span>
            </p>
          </>
        )}

        {mode === 'signup' && (
          <>
            <div style={st.formGroup}>
              <label style={st.label}>Hospital Name</label>
              <input
                style={st.input}
                placeholder="My Hospital"
                value={newHospitalName}
                onChange={(e) => setNewHospitalName(e.target.value)}
              />
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>Location</label>
              <input
                style={st.input}
                placeholder="Kenya"
                value={newHospitalLocation}
                onChange={(e) => setNewHospitalLocation(e.target.value)}
              />
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>Full Name</label>
              <input
                style={st.input}
                placeholder="Dr. John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>Email Address</label>
              <input
                style={st.input}
                type="email"
                placeholder="admin@hospital.co.ke"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={st.input}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} style={st.eyeBtn}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div style={st.strengthRow}>
              <div style={{ ...st.strengthBar, background: passwordStrength.color, width: `${Math.max(18, passwordStrength.score * 20)}%` }} />
              <span style={{ ...st.strengthText, color: passwordStrength.color }}>{passwordStrength.label}</span>
            </div>
            <button style={{ ...st.btnPrimary, background: brandAccent }} onClick={handleSignup} disabled={loading}>
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
            <p style={st.footerNote}>
              Already have an account?{' '}
              <span style={{ ...st.link, color: brandAccent }} onClick={() => { setMode('login'); setError('') }}>Sign in</span>
            </p>
          </>
        )}

        <p style={st.version}>RemedacareHMIS v1.0 • Secure Hospital Management</p>
      </div>
    </div>
  )
}

const st = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #F5FBF8 0%, #EEF3F1 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 16px',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  heroGlow: (accent) => ({
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: '50%',
    background: `${accent}18`,
    filter: 'blur(40px)',
    top: -140,
    right: -80,
    pointerEvents: 'none',
  }),
  card: {
    background: '#fff',
    borderRadius: '20px',
    padding: '38px',
    width: '100%',
    maxWidth: '460px',
    boxShadow: '0 24px 60px rgba(15,110,86,0.12)',
    border: '1px solid #E6ECE8',
    position: 'relative',
    zIndex: 1,
  },
  logoArea: { textAlign: 'center', marginBottom: '24px' },
  logoImage: { width: 76, height: 76, objectFit: 'cover', borderRadius: 18, marginBottom: 10, border: '1px solid #E6ECE8' },
  logoIcon: {
    width: 76,
    height: 76,
    borderRadius: 18,
    margin: '0 auto 10px',
    background: '#EFF6F2',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 800,
  },
  hospitalBadge: {
    display: 'inline-block',
    background: '#EFF6F2',
    color: '#0F6E56',
    padding: '6px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 10,
  },
  logoText: { fontSize: '24px', fontWeight: '800', margin: 0, letterSpacing: '-0.02em' },
  logoSub: { fontSize: '12px', color: '#6B7280', margin: '6px 0 0' },
  tabs: {
    display: 'flex',
    background: '#F3F5F4',
    borderRadius: '10px',
    padding: '4px',
    marginBottom: '20px',
  },
  tab: {
    flex: 1,
    padding: '9px',
    border: 'none',
    background: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    cursor: 'pointer',
    color: '#6B7280',
    fontWeight: '600',
  },
  tabActive: (accent) => ({
    background: '#fff',
    color: accent,
    boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
  }),
  infoBox: {
    background: '#E6F8EE',
    border: '1px solid #A0D9B8',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '12px',
    color: '#0F6E56',
    marginBottom: '14px',
  },
  warningBox: {
    background: '#FFF6DB',
    border: '1px solid #F3D98F',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '12px',
    color: '#8A6200',
    marginBottom: '14px',
  },
  errorBox: {
    background: '#FCEBEB',
    border: '1px solid #F09595',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '12px',
    color: '#A32D2D',
    marginBottom: '14px',
  },
  successBox: {
    background: '#E6F8EE',
    border: '1px solid #A0D9B8',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '13px',
    color: '#0F6E56',
    marginBottom: '14px',
    textAlign: 'center',
  },
  firstLoginBadge: {
    background: '#FFF8E6',
    border: '1px solid #F5D78E',
    borderRadius: '10px',
    padding: '8px 14px',
    fontSize: '12px',
    color: '#8A6200',
    marginBottom: '12px',
    fontWeight: '700',
    textAlign: 'center',
  },
  firstLoginNote: {
    fontSize: '12px',
    color: '#666',
    marginBottom: '16px',
    lineHeight: '1.6',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#111827',
    marginBottom: '14px',
  },
  note: {
    fontSize: '13px',
    color: '#4B5563',
    marginBottom: '16px',
    lineHeight: '1.6',
  },
  formGroup: { marginBottom: '14px' },
  label: {
    fontSize: '12px',
    color: '#4B5563',
    display: 'block',
    marginBottom: '6px',
    fontWeight: '600',
  },
  input: {
    width: '100%',
    padding: '11px 12px',
    border: '1px solid #D7DEDA',
    borderRadius: '10px',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box',
    background: '#fff',
    color: '#111',
  },
  eyeBtn: {
    position: 'absolute',
    right: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    border: 'none',
    background: 'none',
    color: '#0F6E56',
    cursor: 'pointer',
    fontSize: '12px',
    padding: '2px 4px',
    fontWeight: '700',
  },
  btnPrimary: {
    width: '100%',
    color: '#fff',
    border: 'none',
    padding: '12px',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    marginTop: '4px',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: '#4B5563',
    marginBottom: 12,
  },
  secondaryActions: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 14,
  },
  linkBtn: {
    border: 'none',
    background: 'transparent',
    color: '#0F6E56',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    padding: 0,
  },
  strengthRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  strengthBar: {
    height: 7,
    borderRadius: 999,
    background: '#0F6E56',
    flexBasis: '70%',
    transition: 'width 180ms ease',
  },
  strengthText: {
    fontSize: 11,
    fontWeight: 700,
    color: '#0F6E56',
  },
  footerNote: {
    textAlign: 'center',
    fontSize: '12px',
    color: '#6B7280',
    marginTop: '16px',
  },
  link: {
    cursor: 'pointer',
    fontWeight: '700',
    fontSize: '12px',
  },
  version: {
    textAlign: 'center',
    fontSize: '10px',
    color: '#9CA3AF',
    marginTop: '20px',
  },
}
