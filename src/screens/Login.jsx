import { useState, useEffect } from 'react'
import supabase from '../supabase'

export default function Login({ onLogin, isPasswordRecovery, onResetDone }) {
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

  useEffect(() => {
    if (isPasswordRecovery) setMode('reset')
  }, [isPasswordRecovery])

  useEffect(() => {
    async function checkActivationLink() {
      if (typeof window === 'undefined') return
      const params = new URLSearchParams(window.location.search)
      const type = params.get('type')

      if (type === 'signup') {
        setMode('login')
        setActivationMessage('✅ Account activated successfully! Please log in to continue.')
        const cleanUrl = window.location.origin + window.location.pathname
        window.history.replaceState({}, document.title, cleanUrl)
      }
    }

    checkActivationLink()
  }, [])

  function getErrorMessage(err) {
    if (!err) return ''
    if (typeof err === 'string') return err
    if (err.message) return err.message
    if (err.error_description) return err.error_description
    return 'Something went wrong. Please try again.'
  }

  async function handleLogin() {
    if (!email || !password) return setError('Enter email and password')
    setLoading(true)
    setError('')
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) { setError(getErrorMessage(err)); setLoading(false); return }

      const { data: profile } = await supabase
        .from('hospital_users')
        .select('hospital_id, hospitals(name)')
        .eq('user_id', data.user.id)
        .maybeSingle()

      if (profile?.hospital_id) {
        onLogin({ ...data.user, hospital_id: profile.hospital_id, hospital_name: profile.hospitals?.name })
      } else {
        // No hospital_users record yet — first login after email confirmation
        // App.jsx fetchHospitalId will create the hospital from metadata
        onLogin(data.user)
      }
    } catch (e) {
      setError('Login failed. Try again.')
    }
    setLoading(false)
  }

  async function handleSignup() {
    if (!email || !password || !name || !newHospitalName) return setError('All fields are required')
    if (password.length < 6) return setError('Password must be at least 6 characters')
    setLoading(true)
    setError('')

    const timeout = setTimeout(() => {
      setLoading(false)
      setError('Request timed out. Please try again.')
    }, 10000)

    try {
      // Only create the auth account here.
      // Hospital is created in App.jsx after email is confirmed and user logs in.
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            pending_hospital_name: newHospitalName.trim(),
            pending_hospital_location: newHospitalLocation.trim() || 'Kenya',
          }
        }
      })

      clearTimeout(timeout)

      if (err) { setError(getErrorMessage(err)); setLoading(false); return }

      window.notifyFromLegacyAlert('Account created! Check your email to confirm, then sign in.')
      setMode('login')
      setName(''); setEmail(''); setPassword('')
      setNewHospitalName(''); setNewHospitalLocation('Kenya')
    } catch (e) {
      clearTimeout(timeout)
      setError('Signup failed. Try again.')
    }
    setLoading(false)
  }

  async function handleForgotPassword() {
    if (!email) return setError('Enter your email address')
    setLoading(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      })
      if (err) setError(getErrorMessage(err))
      else setResetSent(true)
    } catch (e) {
      setError('Failed to send reset email.')
    }
    setLoading(false)
  }

  async function handleResetPassword() {
    if (!newPassword || !confirmPassword) return setError('Fill in both fields')
    if (newPassword.length < 6) return setError('Password must be at least 6 characters')
    if (newPassword !== confirmPassword) return setError('Passwords do not match')
    setLoading(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.updateUser({ password: newPassword })
      if (err) setError(getErrorMessage(err))
      else {
        window.notifyFromLegacyAlert('Password updated! Please sign in.')
        await supabase.auth.signOut()
        setMode('login')
        setNewPassword(''); setConfirmPassword('')
        onResetDone()
      }
    } catch (e) {
      setError('Failed to update password.')
    }
    setLoading(false)
  }

  return (
    <div style={st.page}>
      <div style={st.card}>
        <div style={st.logoArea}>
          <div style={st.logoIcon}></div>
          <h1 style={st.logoText}>RemedacareOS</h1>
          <p style={st.logoSub}>Hospital Management System</p>
        </div>

        {activationMessage && <div style={st.infoBox}>✅ {activationMessage}</div>}
        {error && <div style={st.errorBox}>⚠️ {error}</div>}

        {mode !== 'forgot' && mode !== 'reset' && (
          <div style={st.tabs}>
            <button style={{ ...st.tab, ...(mode === 'login' ? st.tabActive : {}) }}
              onClick={() => { setMode('login'); setError('') }}>Sign In</button>
            <button style={{ ...st.tab, ...(mode === 'signup' ? st.tabActive : {}) }}
              onClick={() => { setMode('signup'); setError('') }}>Create Account</button>
          </div>
        )}

        {/* RESET PASSWORD */}
        {mode === 'reset' && (
          <>
            <h3 style={st.sectionTitle}>Set New Password</h3>
            <div style={st.formGroup}>
              <label style={st.label}>New Password</label>
              <div style={{ position: 'relative' }}>
                <input style={st.input} type={showResetPassword ? 'text' : 'password'} placeholder="••••••••"
                  value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                <button type="button" onClick={() => setShowResetPassword(v => !v)} style={st.eyeBtn}>
                  {showResetPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input style={st.input} type={showConfirmPassword ? 'text' : 'password'} placeholder="••••••••"
                  value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
                <button type="button" onClick={() => setShowConfirmPassword(v => !v)} style={st.eyeBtn}>
                  {showConfirmPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button style={st.btnPrimary} onClick={handleResetPassword} disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </>
        )}

        {/* FORGOT PASSWORD */}
        {mode === 'forgot' && (
          <>
            <p style={{ fontSize: '13px', color: '#555', marginBottom: '16px' }}>
              Enter your email and we'll send a reset link.
            </p>
            <div style={st.formGroup}>
              <label style={st.label}>Email Address</label>
              <input style={st.input} type="email" placeholder="admin@hospital.co.ke"
                value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            {resetSent
              ? <div style={{ color: '#0F6E56', textAlign: 'center', padding: '16px 0', fontSize: '13px' }}>
                  ✅ Reset link sent! Check your email.
                </div>
              : <button style={st.btnPrimary} onClick={handleForgotPassword} disabled={loading}>
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
            }
            <p style={st.footerNote}>
              <span style={st.link} onClick={() => { setMode('login'); setResetSent(false) }}>← Back to Login</span>
            </p>
          </>
        )}

        {/* LOGIN */}
        {mode === 'login' && (
          <>
            <div style={st.formGroup}>
              <label style={st.label}>Email Address</label>
              <input style={st.input} type="email" placeholder="admin@hospital.co.ke"
                value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div style={{ textAlign: 'right', marginBottom: '8px' }}>
              <span style={st.link} onClick={() => setMode('forgot')}>Forgot Password?</span>
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>Password</label>
              <div style={{ position: 'relative' }}>
                <input style={st.input} type={showPassword ? 'text' : 'password'} placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()} />
                <button type="button" onClick={() => setShowPassword(v => !v)} style={st.eyeBtn}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button style={st.btnPrimary} onClick={handleLogin} disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <p style={st.footerNote}>
              Don't have an account?{' '}
              <span style={st.link} onClick={() => { setMode('signup'); setError('') }}>Create one</span>
            </p>
          </>
        )}

        {/* SIGNUP */}
        {mode === 'signup' && (
          <>
            <div style={st.formGroup}>
              <label style={st.label}>Hospital Name</label>
              <input style={st.input} placeholder="My Hospital"
                value={newHospitalName} onChange={e => setNewHospitalName(e.target.value)} />
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>Location</label>
              <input style={st.input} placeholder="City, Country"
                value={newHospitalLocation} onChange={e => setNewHospitalLocation(e.target.value)} />
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>Full Name</label>
              <input style={st.input} placeholder="Dr. John Doe"
                value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>Email Address</label>
              <input style={st.input} type="email" placeholder="admin@hospital.co.ke"
                value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div style={st.formGroup}>
              <label style={st.label}>Password</label>
              <div style={{ position: 'relative' }}>
                <input style={st.input} type={showPassword ? 'text' : 'password'} placeholder="Min. 6 characters"
                  value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPassword(v => !v)} style={st.eyeBtn}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button style={st.btnPrimary} onClick={handleSignup} disabled={loading}>
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
            <p style={st.footerNote}>
              Already have an account?{' '}
              <span style={st.link} onClick={() => { setMode('login'); setError('') }}>Sign in</span>
            </p>
          </>
        )}

        <p style={st.version}>RemedacareOS • v1.0 • Secure Multi-Hospital</p>
      </div>
    </div>
  )
}

const st = {
  page: { height: '100vh', background: '#f0f2f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  card: { background: '#fff', borderRadius: '16px', padding: '40px', width: '420px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #e8ebe8' },
  logoArea: { textAlign: 'center', marginBottom: '24px' },
  logoIcon: { fontSize: '44px', marginBottom: '8px' },
  logoText: { fontSize: '22px', fontWeight: '700', color: '#0F6E56', margin: 0 },
  logoSub: { fontSize: '12px', color: '#888', margin: '4px 0 0' },
  tabs: { display: 'flex', background: '#f0f2f0', borderRadius: '8px', padding: '4px', marginBottom: '20px' },
  tab: { flex: 1, padding: '8px', border: 'none', background: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', color: '#666', fontWeight: '500' },
  tabActive: { background: '#fff', color: '#0F6E56', fontWeight: '600', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  infoBox: { background: '#E6F8EE', border: '1px solid #A0D9B8', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#0F6E56', marginBottom: '14px' },
  errorBox: { background: '#FCEBEB', border: '1px solid #F09595', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#A32D2D', marginBottom: '14px' },
  sectionTitle: { fontSize: '15px', fontWeight: '600', color: '#111', marginBottom: '14px' },
  formGroup: { marginBottom: '14px' },
  label: { fontSize: '12px', color: '#666', display: 'block', marginBottom: '5px', fontWeight: '500' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#111' },
  eyeBtn: { position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', color: '#0F6E56', cursor: 'pointer', fontSize: '12px', padding: '2px 4px', fontWeight: '600' },
  btnPrimary: { width: '100%', background: '#0F6E56', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginTop: '4px' },
  footerNote: { textAlign: 'center', fontSize: '12px', color: '#888', marginTop: '16px' },
  link: { color: '#0F6E56', cursor: 'pointer', fontWeight: '600', fontSize: '12px' },
  version: { textAlign: 'center', fontSize: '10px', color: '#bbb', marginTop: '20px' }
}
