// RemedacareHMS UI kit — one look and one behaviour across screens.
//   Button, Field (label + input wiring), Modal (focus trap, Esc, aria), StatusChip, DataTable (cards on phones),
//   PatientBanner (name, age, sex, allergies and alerts on clinical screens), plus toast / confirm / prompt helpers.
import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react'
import { colors as C, typography } from '../theme'
export { notifyError, notifyInfo, notifySuccess, notifyWarning } from '../notifications'
export { openConfirmDialog as confirm, openPromptDialog as prompt } from '../confirmDialog'

const VARIANTS = {
  primary: { background: C.primary, color: '#fff', border: `1px solid ${C.primary}` },
  secondary: { background: C.surface, color: C.text, border: `1px solid ${C.border}` },
  soft: { background: C.primaryL, color: C.primary, border: `1px solid ${C.primaryL}` },
  danger: { background: C.dangerL, color: C.danger, border: `1px solid ${C.dangerL}` },
  ghost: { background: 'transparent', color: C.text, border: '1px solid transparent' },
}
export function Button({ variant = 'secondary', size = 'md', busy = false, children, style, disabled, ...rest }) {
  const pad = size === 'sm' ? '5px 10px' : size === 'lg' ? '11px 18px' : '8px 14px'
  return (
    <button type="button" aria-busy={busy || undefined} disabled={disabled || busy} {...rest}
      style={{ padding: pad, borderRadius: 9, fontWeight: 700, fontSize: size === 'sm' ? 11 : 13, cursor: disabled || busy ? 'not-allowed' : 'pointer',
        opacity: disabled || busy ? 0.6 : 1, fontFamily: typography.fontFamily, ...VARIANTS[variant], ...style }}>
      {busy ? 'Working…' : children}
    </button>
  )
}

export const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, color: C.text, fontSize: 13 }

/** Wraps one input/select/textarea: wires label, id, hint and error for screen readers. */
export function Field({ label, hint, error, required, children, style }) {
  const id = useId()
  const child = Children.only(children)
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined
  const control = isValidElement(child)
    ? cloneElement(child, { id: child.props.id || id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, 'aria-required': required || undefined,
      style: { ...inputStyle, ...(error ? { borderColor: C.danger } : {}), ...child.props.style } })
    : child
  return (
    <div style={style}>
      <label htmlFor={child.props?.id || id} style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>
        {label}{required && <span aria-hidden="true" style={{ color: C.danger }}> *</span>}
      </label>
      {control}
      {hint && !error && <div id={`${id}-hint`} style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>{hint}</div>}
      {error && <div id={`${id}-err`} role="alert" style={{ fontSize: 11, color: C.danger, marginTop: 3 }}>{error}</div>}
    </div>
  )
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
/** Accessible dialog: traps Tab inside, closes on Esc, returns focus to where it was opened from. */
export function Modal({ title, onClose, children, footer, width = 640 }) {
  const box = useRef(null)
  const titleId = useId()
  useEffect(() => {
    const opener = document.activeElement
    const first = box.current?.querySelector(FOCUSABLE)
    first?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.() }
      if (e.key !== 'Tab' || !box.current) return
      const items = [...box.current.querySelectorAll(FOCUSABLE)]
      if (!items.length) return
      const [a, z] = [items[0], items[items.length - 1]]
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.() }
  }, [onClose])
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, zIndex: 1500 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId}
        style={{ width, maxWidth: '100%', maxHeight: '94vh', overflowY: 'auto', background: C.surface, borderRadius: 14, boxShadow: '0 24px 70px rgba(15,23,42,.28)', padding: 18, fontFamily: typography.fontFamily, color: C.text }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
          <h2 id={titleId} style={{ margin: 0, fontSize: 17 }}>{title}</h2>
          <Button size="sm" onClick={onClose} aria-label="Close">Close</Button>
        </div>
        {children}
        {footer && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>{footer}</div>}
      </div>
    </div>
  )
}

const TONE = { green: [C.successL, C.success], red: [C.dangerL, C.danger], yellow: [C.warnL, C.warn], blue: ['#EFF8FF', '#175CD3'], gray: ['#F2F4F7', '#475467'] }
/** Status with text AND colour (never colour alone). */
export function StatusChip({ tone = 'gray', children, icon }) {
  const [bg, fg] = TONE[tone] || TONE.gray
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: bg, color: fg, borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>{icon && <span aria-hidden="true">{icon}</span>}{children}</span>
}

export function useNarrow(maxWidth = 720) {
  const query = `(max-width: ${maxWidth}px)`
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false)
  useEffect(() => {
    if (!window.matchMedia) return undefined
    const mq = window.matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [query])
  return narrow
}

/** columns: [{ key, label, render?(row) }]. A table on desktop, stacked cards on phones. */
export function DataTable({ columns = [], rows = [], rowKey = (r, i) => r.id ?? i, onRowClick, empty = 'Nothing to show.', caption }) {
  const narrow = useNarrow()
  const cell = (c, r) => (c.render ? c.render(r) : r[c.key] ?? '—')
  if (!rows.length) return <div style={{ color: C.sub, fontSize: 13, padding: 16, textAlign: 'center' }}>{empty}</div>
  if (narrow) {
    return (
      <div role="list" aria-label={caption} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r, i) => (
          <div role="listitem" key={rowKey(r, i)} onClick={onRowClick ? () => onRowClick(r) : undefined} tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r) } : undefined}
            style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, background: C.surface, cursor: onRowClick ? 'pointer' : 'default' }}>
            {columns.map((c) => (
              <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0', fontSize: 13 }}>
                <span style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{c.label}</span>
                <span style={{ textAlign: 'right', minWidth: 0 }}>{cell(c, r)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        {caption && <caption style={{ textAlign: 'left', fontWeight: 800, padding: '0 0 8px' }}>{caption}</caption>}
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" style={{ textAlign: 'left', padding: '9px 8px', color: C.sub, fontSize: 11, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={rowKey(r, i)} onClick={onRowClick ? () => onRowClick(r) : undefined} tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r) } : undefined} style={{ cursor: onRowClick ? 'pointer' : 'default' }}>
            {columns.map((c) => <td key={c.key} style={{ padding: '9px 8px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' }}>{cell(c, r)}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

const NONE = /^\s*(nil|none|nkda|no known|n\/?a|-|no)\s*\.?\s*$/i
export function patientAge(p = {}) {
  if (p.date_of_birth) {
    const d = new Date(p.date_of_birth); if (!Number.isNaN(d.getTime())) {
      const months = (Date.now() - d.getTime()) / (30.44 * 86400000)
      return months < 24 ? `${Math.floor(months)} mo` : `${Math.floor(months / 12)} y`
    }
  }
  return p.age ? `${String(p.age).replace(/\s*(years?|yrs?)$/i, '')} y`.replace(/ y y$/, ' y') : null
}
/** Who this is, at a glance, on every clinical screen — allergies always visible. */
export function PatientBanner({ patient = {}, alerts = [], extra = null }) {
  const allergies = String(patient.allergies || '').trim()
  const hasAllergy = allergies && !NONE.test(allergies)
  const chronic = String(patient.chronic_conditions || '').trim()
  return (
    <div role="region" aria-label="Patient summary" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '8px 12px', border: `1px solid ${hasAllergy ? C.danger : C.border}`, borderRadius: 10, background: hasAllergy ? C.dangerL : C.surface, marginBottom: 10 }}>
      <strong style={{ fontSize: 14 }}>{patient.full_name || 'Patient'}</strong>
      <span style={{ fontSize: 12, color: C.sub }}>{[patientAge(patient), patient.gender || patient.sex, patient.patient_number, patient.blood_group && `Blood ${patient.blood_group}`].filter(Boolean).join(' · ')}</span>
      <StatusChip tone={hasAllergy ? 'red' : 'green'} icon={hasAllergy ? '⚠' : '✓'}>{hasAllergy ? `Allergy: ${allergies}` : allergies ? 'No known allergies' : 'Allergies not recorded'}</StatusChip>
      {chronic && !NONE.test(chronic) && <StatusChip tone="yellow">{chronic}</StatusChip>}
      {alerts.filter(Boolean).map((a) => <StatusChip key={a} tone="red" icon="!">{a}</StatusChip>)}
      {extra}
    </div>
  )
}
