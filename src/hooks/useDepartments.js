import { useCallback, useEffect, useState } from 'react'
import supabase from '../supabase'

export default function useDepartments(hospitalId) {
  const [departments, setDepartments] = useState([])
  const [departmentsLoading, setDepartmentsLoading] = useState(false)

  const loadDepartments = useCallback(async () => {
    if (!hospitalId) {
      setDepartments([])
      setDepartmentsLoading(false)
      return
    }

    setDepartmentsLoading(true)
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .eq('hospital_id', hospitalId)
      .order('name')

    setDepartmentsLoading(false)

    if (error) {
      console.error('Failed to load departments', error)
      return
    }

    setDepartments(data || [])
  }, [hospitalId])

  useEffect(() => {
    void loadDepartments()
  }, [loadDepartments])

  return {
    departments,
    departmentsLoading,
    loadDepartments,
    refreshDepartments: loadDepartments,
  }
}
