// Help panel opened from the top bar: a quick-start for the signed-in role and "Report a problem", which files an
// IT & Systems ticket with the screen, role, app version and recent errors attached automatically.
import { useState } from 'react'
import supabase from '../supabase'
import { colors } from '../theme'
import { guideForRole } from '../data/roleGuides'
import { buildProblemTicket, getRecentErrors, PROBLEM_KINDS, problemTicketText } from '../utils/problemReport'
import { version as APP_VERSION } from '../../package.json'

const s = {
  body: { padding: '4px 22px 22px', maxHeight: '72vh', overflowY: 'auto' },
  tabs: { display: 'flex', gap: 6, padding: '0 22px 12px', borderBottom: `1px solid ${colors.border}` },
  tab: { border: `1px solid ${colors.border}`, background: colors.card, color: colors.sub, borderRadius: 999, padding: '7px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  tabOn: { background: colors.primary, color: colors.white, borderColor: colors.primary },
  intro: { fontSize: 14, color: colors.sub, margin: '14px 0 12px', lineHeight: 1.5 },
  step: { display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderBottom: `1px solid ${colors.borderSoft || colors.border}` },
  num: { flex: '0 0 26px', height: 26, borderRadius: 13, background: colors.primaryL, color: colors.primary, fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontWeight: 700, fontSize: 14, color: colors.text },
  stepText: { fontSize: 13, color: colors.sub, marginTop: 2, lineHeight: 1.5 },
  go: { marginLeft: 'auto', flex: '0 0 auto', border: `1px solid ${colors.border}`, background: colors.card, color: colors.primary, borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  tips: { marginTop: 16, background: colors.bgAlt || colors.bg, borderRadius: 10, padding: '12px 16px', fontSize: 13, color: colors.sub, lineHeight: 1.6 },
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: colors.text, margin: '14px 0 6px' },
  input: { width: '100%', boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '9px 11px', fontSize: 14, background: colors.card, color: colors.text, fontFamily: 'inherit' },
  context: { marginTop: 12, fontSize: 12, color: colors.sub, background: colors.bgAlt || colors.bg, borderRadius: 8, padding: '10px 12px', lineHeight: 1.6 },
  primary: { border: 'none', background: colors.primary, color: colors.white, borderRadius: 8, padding: '10px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  ghost: { border: `1px solid ${colors.border}`, background: colors.card, color: colors.text, borderRadius: 8, padding: '10px 14px', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  ok: { marginTop: 14, background: colors.successL, color: colors.success, borderRadius: 8, padding: '12px 14px', fontSize: 14, fontWeight: 600 },
  err: { marginTop: 14, background: colors.dangerL, color: colors.danger, borderRadius: 8, padding: '12px 14px', fontSize: 14 },
}

export function QuickStart({ resolvedRole, onNavigate }) {
  const g = guideForRole(resolvedRole)
  return (
    <div>
      <p style={s.intro}><strong style={{ color: colors.text }}>{g.title}.</strong> {g.intro}</p>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {g.steps.map((step, i) => (
          <li key={step.title} style={s.step}>
            <span style={s.num} aria-hidden="true">{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <div style={s.stepTitle}>{step.title}</div>
              <div style={s.stepText}>{step.text}</div>
            </div>
            {step.path && onNavigate ? <button type="button" style={s.go} onClick={() => onNavigate(step.path)} aria-label={`Open the screen for: ${step.title}`}>Open</button> : null}
          </li>
        ))}
      </ol>
      <div style={s.tips}>
        <strong style={{ color: colors.text }}>Good to know</strong>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{g.tips.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
    </div>
  )
}

export function ReportProblem({ hospitalId, screen, path, role, userName, online = true }) {
  const [kind, setKind] = useState('')
  const [description, setDescription] = useState('')
  const [blocking, setBlocking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null)
  const [error, setError] = useState('')
  const [fallback, setFallback] = useState('')
  const errors = getRecentErrors()

  async function submit(event) {
    event.preventDefault()
    setError(''); setFallback('')
    let row
    try {
      row = buildProblemTicket({ hospitalId, kind, description, blocking, screen, path, role, userName, appVersion: APP_VERSION, online,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '', errors })
    } catch (e) { setError(e.message); return }
    setBusy(true)
    const { data, error: dbError } = await supabase.from('service_requests').insert(row).select('id').single()
    setBusy(false)
    if (dbError) {
      setError(online ? `The report could not be sent (${dbError.message}). Copy the text below and give it to IT.` : 'You are offline, so the report could not be sent. Copy the text below and give it to IT, or send it again when you are back online.')
      setFallback(problemTicketText(row))
      return
    }
    setSent({ ref: String(data?.id || '').slice(0, 8).toUpperCase(), priority: row.priority })
  }

  if (sent) {
    return (
      <div style={s.ok} role="status">
        Thank you — your report has reached the IT desk{sent.ref ? <> (reference <strong>{sent.ref}</strong>)</> : null}.
        {sent.priority === 'emergency' ? ' It is marked as stopping work, so it goes to the top of their list.' : ' You can carry on working.'}
      </div>
    )
  }

  return (
    <form onSubmit={submit}>
      <label style={s.label} htmlFor="report-kind">What kind of problem?</label>
      <select id="report-kind" style={s.input} value={kind} onChange={(e) => setKind(e.target.value)} required>
        <option value="">Choose one…</option>
        {PROBLEM_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>
      <label style={s.label} htmlFor="report-text">What happened? What did you expect?</label>
      <textarea id="report-text" style={{ ...s.input, minHeight: 110, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="e.g. I clicked Save on the lab result and nothing happened. The patient is still waiting." maxLength={2000} required />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 14, color: colors.text }}>
        <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} />
        This stops me from working (patients are waiting)
      </label>
      <div style={s.context}>
        Sent automatically with your report: screen <strong>{screen || '—'}</strong>, your role ({role || '—'}), app version {APP_VERSION}, browser, connection,
        {errors.length ? ` and the last ${errors.length} error message${errors.length > 1 ? 's' : ''} the app saw.` : ' and any recent error messages (none so far).'}
        {' '}Do not type patient details here.
      </div>
      {error ? <div style={s.err} role="alert">{error}</div> : null}
      {fallback ? <textarea aria-label="Report text to copy" readOnly style={{ ...s.input, minHeight: 140, marginTop: 8, fontFamily: 'monospace', fontSize: 12 }} value={fallback} onFocus={(e) => e.target.select()} /> : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <button type="submit" style={{ ...s.primary, opacity: busy ? 0.7 : 1 }} disabled={busy}>{busy ? 'Sending…' : 'Send to IT'}</button>
        {fallback && typeof navigator !== 'undefined' && navigator.clipboard ? <button type="button" style={s.ghost} onClick={() => void navigator.clipboard.writeText(fallback)}>Copy text</button> : null}
      </div>
    </form>
  )
}

export default function HelpCentre({ initialTab = 'start', resolvedRole, onNavigate, ...report }) {
  const [tab, setTab] = useState(initialTab)
  return (
    <div>
      <div style={s.tabs} role="tablist" aria-label="Help">
        {[['start', `Quick start${resolvedRole ? ` — ${resolvedRole}` : ''}`], ['report', 'Report a problem']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} style={{ ...s.tab, ...(tab === k ? s.tabOn : {}) }} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div style={s.body} role="tabpanel">
        {tab === 'start' ? <QuickStart resolvedRole={resolvedRole} onNavigate={onNavigate} /> : <ReportProblem {...report} role={report.role || resolvedRole} />}
      </div>
    </div>
  )
}
