// Section buttons across the top of a department page: one section is shown at a time instead of a long scroll.
// Counts sit on each button; alert counts (things waiting for this department) are dark red. Arrow keys move between tabs.
import { useEffect, useRef } from 'react'

export default function DepartmentTabs({ tabs, active, onChange }) {
  const bar = useRef(null)
  // on a phone the bar scrolls sideways: keep the chosen tab in view (only the bar moves, not the page)
  useEffect(() => {
    const el = bar.current, btn = el?.querySelector('[aria-selected="true"]')
    if (el && btn && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, btn.offsetLeft - 24)
  }, [active, tabs]) // again when counts arrive: the badges change the tab widths
  const onKey = (e) => {
    const i = tabs.findIndex((t) => t.id === active)
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null
    if (next) { e.preventDefault(); onChange(next.id); document.getElementById(`dept-tab-${next.id}`)?.focus() }
  }
  return (
    <div ref={bar} role="tablist" aria-label="Department sections" onKeyDown={onKey}
      style={{ position: 'relative', display: 'flex', gap: 4, overflowX: 'auto', borderBottom: '2px solid #EAECF0', marginBottom: 14, scrollbarWidth: 'thin' }}>
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button key={t.id} id={`dept-tab-${t.id}`} type="button" role="tab" aria-selected={on} aria-controls={`dept-panel-${t.id}`} tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', marginBottom: -2, background: 'none', cursor: 'pointer',
              borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: `3px solid ${on ? '#0F6E56' : 'transparent'}`,
              color: on ? '#0F6E56' : '#344054', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {t.label}
            {t.count != null && t.count !== 0 && (
              <span style={{ fontSize: 11.5, fontWeight: 800, borderRadius: 999, padding: '1px 8px',
                background: t.alert ? '#912018' : on ? '#0F6E56' : '#F2F4F7', color: t.alert || on ? '#FFFFFF' : '#101828' }}>{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
