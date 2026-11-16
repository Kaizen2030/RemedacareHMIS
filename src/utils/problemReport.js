// "Report a problem": keeps the last few app errors in memory and turns a user's report into an IT & Systems ticket
// (service_requests, department 'it', kind 'ticket'). Only technical context is attached: screen, role, app version,
// browser, connection state and recent error messages. Nothing typed into forms and no page content is copied.

const MAX_ERRORS = 8
const recentErrors = []
let installed = false

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

export function recordAppError(err, where = '') {
  const message = clip(err?.message || err?.reason?.message || err?.reason || err, 300)
  if (!message) return
  const last = recentErrors[recentErrors.length - 1]
  if (last && last.message === message) { last.count += 1; return }
  recentErrors.push({ at: new Date().toISOString(), message, where: clip(where, 80), count: 1 })
  if (recentErrors.length > MAX_ERRORS) recentErrors.shift()
}

export function getRecentErrors() {
  return recentErrors.map((e) => ({ ...e }))
}

export function clearRecentErrors() {
  recentErrors.length = 0
}

export function installErrorCapture(target = typeof window !== 'undefined' ? window : null) {
  if (!target || installed) return () => {}
  installed = true
  const onError = (event) => recordAppError(event?.error || event?.message, target.location?.hash || '')
  const onRejection = (event) => recordAppError(event?.reason, target.location?.hash || '')
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
    installed = false
  }
}

export const PROBLEM_KINDS = [
  { value: 'error', label: 'Something shows an error or will not save', priority: 'urgent' },
  { value: 'wrong', label: 'A number, result or bill looks wrong', priority: 'urgent' },
  { value: 'slow', label: 'The system is slow or freezes', priority: 'routine' },
  { value: 'access', label: 'I cannot see a screen I need', priority: 'routine' },
  { value: 'printer', label: 'Printer, scanner or computer problem', priority: 'routine' },
  { value: 'idea', label: 'Suggestion to make the work easier', priority: 'low' },
]

/** Build the service_requests row for a problem report. Throws a user-readable Error when the report is incomplete. */
export function buildProblemTicket({ hospitalId, kind, description, blocking = false, screen, path, role, userName, appVersion, online, userAgent, errors }) {
  if (!hospitalId) throw new Error('No hospital is selected.')
  const k = PROBLEM_KINDS.find((x) => x.value === kind)
  if (!k) throw new Error('Choose what kind of problem it is.')
  const text = clip(description, 2000)
  if (text.length < 5) throw new Error('Describe what happened in a few words.')
  const priority = blocking ? 'emergency' : k.priority
  return {
    hospital_id: hospitalId,
    department: 'it',
    kind: 'ticket',
    title: clip(`${screen || 'App'}: ${k.label}`, 200),
    priority,
    location: clip(screen || '', 120) || null,
    description: text,
    source: 'report_button',
    requested_by_name: clip(userName, 120) || null,
    details: {
      category: kind === 'printer' ? 'Hardware' : 'HMIS (RemedacareHMS)',
      problem_kind: kind,
      blocking: Boolean(blocking),
      screen: clip(screen, 120),
      path: clip(path, 200),
      role: clip(role, 60),
      app_version: clip(appVersion, 40),
      online: online !== false,
      browser: clip(userAgent, 200),
      recent_errors: (errors || []).slice(-MAX_ERRORS),
      reported_at: new Date().toISOString(),
    },
  }
}

/** Plain-text version for copying when the report cannot be sent (offline). */
export function problemTicketText(row) {
  const d = row.details || {}
  return [
    `Problem report — ${row.title}`,
    `Priority: ${row.priority}${d.blocking ? ' (stops work)' : ''}`,
    `Screen: ${d.screen} (${d.path})`,
    `Role: ${d.role}   App: ${d.app_version}   Online: ${d.online ? 'yes' : 'no'}`,
    `Reported by: ${row.requested_by_name || '-'} at ${d.reported_at}`,
    '',
    row.description,
    ...(d.recent_errors?.length ? ['', 'Recent errors:', ...d.recent_errors.map((e) => `- ${e.at} ${e.message}${e.count > 1 ? ` (×${e.count})` : ''}`)] : []),
  ].join('\n')
}
