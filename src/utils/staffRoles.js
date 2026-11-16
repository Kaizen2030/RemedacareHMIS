// Readable role groups for staff lists and duty summaries (large departments group and count by role).
export const ROLE_GROUPS = ['Doctors', 'Clinical officers', 'Nurses & midwives', 'Pharmacy', 'Laboratory & imaging', 'Allied health', 'Support & admin', 'Other']

export function staffRoleGroup(s = {}) {
  const t = `${s.role_category || ''} ${s.job_title || ''} ${s.role || ''}`.toLowerCase()
  if (/clinical officer|\bco\b/.test(t)) return 'Clinical officers'
  if (/doctor|physician|surgeon|consultant|registrar|medical officer|intern|paediatrician|pediatrician|obstetric|gynaec|anaesth|psychiatrist|radiologist|dentist|specialist/.test(t)) return 'Doctors'
  if (/nurs|midwi|matron/.test(t)) return 'Nurses & midwives'
  if (/pharm/.test(t)) return 'Pharmacy'
  if (/lab|radiograph|sonograph|imaging|microbiolog|technolog/.test(t)) return 'Laboratory & imaging'
  if (/physio|occupational|nutrition|dietit|counsel|psycholog|optom|social worker|speech/.test(t)) return 'Allied health'
  if (/clerk|admin|reception|cashier|account|record|driver|cleaner|housekeep|security|cook|porter|attendant|hr|it\b|ict|support|maintenance/.test(t)) return 'Support & admin'
  return 'Other'
}

/** "3 Doctors · 10 Nurses & midwives · 1 Other" for a list of people (staff objects). */
export function roleSummary(people) {
  const counts = {}
  for (const p of people) { const g = staffRoleGroup(p); counts[g] = (counts[g] || 0) + 1 }
  return ROLE_GROUPS.filter((g) => counts[g]).map((g) => `${counts[g]} ${g}`).join(' · ')
}
