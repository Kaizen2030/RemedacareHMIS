// Logs that the current user opened a patient record (Data Protection Act: who viewed what).
// For a confidential patient the server asks for a reason first (break-glass); this hook prompts for it.
import { useEffect, useRef, useState } from 'react'
import supabase from '../supabase'
import { openPromptDialog } from '../confirmDialog'

export async function logPatientAccess(hospitalId, patientId, action = 'view', context = null) {
  if (!hospitalId || !patientId) return { allowed: true }
  const { data, error } = await supabase.rpc('log_patient_access', { p_hospital: hospitalId, p_patient: patientId, p_action: action, p_context: context, p_reason: null })
  if (error) return { allowed: true, unavailable: true }          // not installed / offline: never block care
  if (data?.needs_reason) {
    const reason = await openPromptDialog('This patient\'s record is confidential. Why do you need to open it? Your name, the time and the reason are recorded and reviewed by the administrator.',
      { title: 'Confidential record — break-glass', placeholder: 'e.g. Emergency review on the ward', tone: 'danger', confirmLabel: 'Open record' })
    if (!reason || reason.trim().length < 10) return { allowed: false }
    const bg = await supabase.rpc('log_patient_access', { p_hospital: hospitalId, p_patient: patientId, p_action: 'break_glass', p_context: context, p_reason: reason })
    if (bg.error) return { allowed: false, error: bg.error.message }
    await supabase.rpc('log_patient_access', { p_hospital: hospitalId, p_patient: patientId, p_action: action, p_context: context, p_reason: null })
    return { allowed: true, breakGlass: true }
  }
  return { allowed: data?.allowed !== false }
}

/** const allowed = usePatientAccessLog(hospitalId, patientId, 'consultation') — false while a confidential record is refused. */
export default function usePatientAccessLog(hospitalId, patientId, context) {
  const [allowed, setAllowed] = useState(true)
  const last = useRef('')
  useEffect(() => {
    const key = `${hospitalId}|${patientId}|${context}`
    if (!hospitalId || !patientId || last.current === key) return
    last.current = key
    let live = true
    void logPatientAccess(hospitalId, patientId, 'view', context).then((r) => { if (live) setAllowed(r.allowed !== false) })
    return () => { live = false }
  }, [hospitalId, patientId, context])
  return allowed
}
