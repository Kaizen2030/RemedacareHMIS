import { useCallback, useEffect, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function isActiveStatus(status) {
  const normalized = normalizeText(status)
  if (!normalized) return true
  return !['pending approval', 'rejected', 'terminated', 'deceased', 'suspended', 'on leave'].includes(normalized)
}

function isAvailableShift(shift) {
  const normalized = normalizeText(shift)
  if (!normalized) return true
  return !normalized.includes('off duty') && !normalized.startsWith('off ')
}

export default function useStaff() {
  const { hospitalId } = useHospital()
  const [staff, setStaff] = useState([])
  const [loadingStaff, setLoadingStaff] = useState(true)

  const refreshStaff = useCallback(async () => {
    if (!hospitalId) {
      setStaff([])
      setLoadingStaff(false)
      return
    }
    setLoadingStaff(true)
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('hospital_id', hospitalId)
      .order('full_name')

    if (error) {
      console.warn('Unable to load staff', error.message)
      setStaff([])
    } else {
      setStaff(data || [])
    }
    setLoadingStaff(false)
  }, [hospitalId])

  useEffect(() => {
    refreshStaff()
  }, [hospitalId, refreshStaff])

  const activeStaff = staff.filter(s => isActiveStatus(s.status))
  const availableStaff = activeStaff.filter(s => isAvailableShift(s.current_shift))

  return {
    staff,
    activeStaff,
    availableStaff,
    loadingStaff,
    refreshStaff,
  }
}
