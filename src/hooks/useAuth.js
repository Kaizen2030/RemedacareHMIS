import { useCallback, useEffect, useState } from 'react'
import supabase from '../supabase'

function normalizeShiftLabel(value = 'Day (07:00-19:00)') {
  return value.replace(/â€“/g, '-')
}

export default function useAuth({ onSignedOut } = {}) {
  const [user, setUser] = useState(null)
  const [hospitalId, setHospitalId] = useState(null)
  const [hospitalName, setHospitalName] = useState('')
  const [userRole, setUserRole] = useState(null)
  const [authError, setAuthError] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)

  const resetAuthState = useCallback(() => {
    setUser(null)
    setHospitalId(null)
    setHospitalName('')
    setUserRole(null)
    setAuthError(null)
    setCheckingAuth(false)
    setIsPasswordRecovery(false)
  }, [])

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

  const fetchHospitalId = useCallback(async (authUser) => {
    const userId = authUser?.id
    const email = authUser?.email
    const meta = authUser?.user_metadata || {}

    setAuthError(null)

    if (!userId || !email) {
      setAuthError('Unable to resolve your account. Please sign out and sign in again.')
      setCheckingAuth(false)
      return
    }

    const { data: existingLink } = await supabase
      .from('hospital_users')
      .select('hospital_id, hospitals(name), role')
      .eq('user_id', userId)
      .maybeSingle()

    if (existingLink?.hospital_id) {
      setHospitalId(existingLink.hospital_id)
      setHospitalName(existingLink.hospitals?.name || '')

      const { data: hospital } = await supabase
        .from('hospitals')
        .select('owner_email')
        .eq('id', existingLink.hospital_id)
        .single()

      const isOwner = hospital?.owner_email === email
      const role = isOwner ? 'admin' : (existingLink.role || 'staff')

      if (isOwner && existingLink.role !== 'admin') {
        const { error: rpcErr } = await supabase.rpc('set_staff_role', {
          p_hospital_id: existingLink.hospital_id,
          p_email: email,
          p_role: 'admin',
        })

        if (rpcErr) {
          console.warn('Role sync failed:', rpcErr.message)
          await ensureHospitalUserLink(userId, existingLink.hospital_id, 'admin')
        }
      }

      setUserRole(role)
      setCheckingAuth(false)
      return
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
        return
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
        console.error('Hospital creation failed:', createError)
        setAuthError('Unable to create your hospital workspace. Please contact support.')
        setCheckingAuth(false)
        return
      }

      if (newHospital) {
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
        return
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
          return
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
        return
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
          .select('role')
          .eq('hospital_id', nextHospitalId)
          .eq('email', email)
          .maybeSingle()

        if (staffError) {
          console.warn('Unable to verify staff role:', staffError.message)
        }

        if (staffRecord?.role?.toLowerCase() === 'admin') {
          role = 'admin'
          await ensureHospitalUserLink(userId, nextHospitalId, 'admin')
        }
      }

      setHospitalId(nextHospitalId)
      setHospitalName(nextHospitalName)
      setUserRole(role)
      setAuthError(null)
      setCheckingAuth(false)
      return
    }

    setAuthError('Unable to resolve your hospital workspace. Please contact support.')
    setCheckingAuth(false)
  }, [ensureHospitalUserLink])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return

      if (session?.user) {
        setUser(session.user)
        fetchHospitalId(session.user)
      } else {
        setCheckingAuth(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true)
        setUser(null)
        setCheckingAuth(false)
        return
      }

      if (event === 'SIGNED_IN' && !isPasswordRecovery && session?.user) {
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
    }
  }, [fetchHospitalId, isPasswordRecovery, onSignedOut, resetAuthState])

  const handleLogin = useCallback(async (authUser) => {
    setUser(authUser)
    await fetchHospitalId(authUser)
  }, [fetchHospitalId])

  const handleLogout = useCallback(async () => {
    if (!await window.openConfirmDialog('Sign out from REMEDACARE HMS?')) return
    await supabase.auth.signOut()
  }, [])

  const resetPasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(false)
  }, [])

  return {
    user,
    hospitalId,
    hospitalName,
    userRole,
    authError,
    checkingAuth,
    isPasswordRecovery,
    fetchHospitalId,
    handleLogin,
    handleLogout,
    resetPasswordRecovery,
  }
}
