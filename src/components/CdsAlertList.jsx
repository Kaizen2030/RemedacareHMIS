// Decision-support alerts for one prescription line. 'danger' alerts need "I have reviewed this alert"
// plus a written clinical reason before the prescription can be saved (both are audited).
import { SEVERITY_ORDER } from '../utils/cds'

const TONE = {
  danger: { bg: '#FEF3F2', border: '#FDA29B', fg: '#B42318', icon: '⛔', word: 'Stop and check' },
  warning: { bg: '#FFFAEB', border: '#FEDF89', fg: '#B54708', icon: '⚠️', word: 'Caution' },
  info: { bg: '#EFF8FF', border: '#B2DDFF', fg: '#175CD3', icon: 'ℹ️', word: 'Note' },
}

export default function CdsAlertList({ alerts = [], acknowledged = false, reason = '', onAcknowledge, onReasonChange, canAcknowledge = true, idPrefix = 'cds' }) {
  if (!alerts.length) return null
  const sorted = [...alerts].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  const hasDanger = sorted.some((a) => a.severity === 'danger')
  return (
    <div role="alert" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      {sorted.map((a, i) => {
        const t = TONE[a.severity] || TONE.info
        return (
          <div key={`${a.rule}-${i}`} style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.fg, borderRadius: 8, padding: '8px 10px', fontSize: 12, lineHeight: 1.45 }}>
            <strong>{t.icon} {t.word} — {a.title}:</strong> {a.message}
          </div>
        )
      })}
      {hasDanger && onAcknowledge && (
        <div style={{ border: '1px dashed #FDA29B', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
          {canAcknowledge ? (
            <>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700, color: '#B42318' }}>
                <input type="checkbox" checked={acknowledged} onChange={(e) => onAcknowledge(e.target.checked)} />
                I have reviewed this alert and still want to prescribe
              </label>
              <label htmlFor={`${idPrefix}-reason`} style={{ display: 'block', marginTop: 6, color: '#475467' }}>Clinical reason (saved to the audit trail)</label>
              <input id={`${idPrefix}-reason`} value={reason} onChange={(e) => onReasonChange?.(e.target.value)} placeholder="e.g. Benefit outweighs risk; INR to be checked in 3 days"
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: '1px solid #D0D5DD', borderRadius: 7, marginTop: 3, fontSize: 12 }} />
            </>
          ) : (
            <span style={{ color: '#B42318', fontWeight: 700 }}>A doctor or admin must review this alert before the prescription can be saved.</span>
          )}
        </div>
      )}
    </div>
  )
}
