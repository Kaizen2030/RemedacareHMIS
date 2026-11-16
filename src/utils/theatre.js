export function hasChecklistCompleted(checklist = {}) {
  const required = ['sign_in', 'time_out', 'sign_out']
  return required.every((key) => Boolean(checklist[key]))
}

export function canStartCase(record = {}) {
  if (!record.patient_id) return { allowed: false, reason: 'Patient is required' }
  if (!record.surgeon) return { allowed: false, reason: 'Surgeon is required' }
  if (!record.room_id) return { allowed: false, reason: 'Theatre room is required' }
  if (!record.start_time) return { allowed: false, reason: 'Procedure start time is required' }
  const checklist = record.checklist || {}
  if (!checklist.sign_in || !checklist.time_out) {
    return { allowed: false, reason: 'Sign-in and time-out must be completed before the case starts' }
  }

  return { allowed: true, reason: 'Case can start' }
}

export function canCompleteCase(record = {}) {
  const startCheck = canStartCase(record)
  if (!startCheck.allowed) return startCheck
  if (!record.checklist?.sign_out) {
    return { allowed: false, reason: 'Sign-out must be completed before the case is completed' }
  }
  return { allowed: true, reason: 'Case can complete' }
}

export function hasRoomDoubleBooking(schedule = [], candidate = {}) {
  const start = new Date(candidate.start_time).getTime()
  const end = new Date(candidate.end_time).getTime()

  return schedule.some((item) => {
    if (!item || item.id === candidate.id) return false
    if (item.room_id !== candidate.room_id) return false
    const existsStart = new Date(item.start_time).getTime()
    const existsEnd = new Date(item.end_time).getTime()
    return start < existsEnd && end > existsStart
  })
}
