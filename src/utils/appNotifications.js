import supabase from '../supabase'

export const APP_NOTIFICATION_TYPES = {
  system: { label: 'System', icon: '⚙️', color: '#64748b' },
  appointment: { label: 'Appointment', icon: '📅', color: '#2563eb' },
  laboratory: { label: 'Laboratory', icon: '🧪', color: '#0A9272' },
  pharmacy: { label: 'Pharmacy', icon: '💊', color: '#059669' },
  billing: { label: 'Billing', icon: '💳', color: '#d97706' },
  patient: { label: 'Patient', icon: '🏥', color: '#0f766e' },
  alert: { label: 'Alert', icon: '⚠️', color: '#dc2626' },
}

const selectFields = 'id, hospital_id, notification_type, title, message, target_path, payload_json, is_read, read_at, created_at'

export async function fetchAppNotifications(hospitalId, limit = 50) {
  if (!hospitalId) return { rows: [], compat: false }

  const primary = await supabase
    .from('notifications')
    .select(selectFields)
    .eq('hospital_id', hospitalId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (!primary.error) return { rows: primary.data || [], compat: false }

  // Some older deployments only have the minimal notification columns.
  const fallback = await supabase
    .from('notifications')
    .select('id, hospital_id, title, message, is_read, read_at, created_at')
    .eq('hospital_id', hospitalId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return {
    rows: (fallback.data || []).map((row) => ({ ...row, notification_type: 'system', target_path: null, payload_json: null })),
    compat: true,
  }
}

export async function markNotificationRead(id) {
  if (!id) return
  const { error } = await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function markAllNotificationsRead(hospitalId) {
  if (!hospitalId) return
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('hospital_id', hospitalId)
    .or('is_read.is.null,is_read.eq.false')
  if (error) throw error
}
