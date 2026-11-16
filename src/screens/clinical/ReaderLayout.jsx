// Reading layout for long clinical content (guides, pathways): a narrow list that stays in view next to a comfortable
// reading column on wide screens, and list → full-width reader (with a back button) on narrow screens and phones.
// Width is measured on the container itself, because the app sidebar takes part of the window.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { C, s } from '../ncd/ui'

const NARROW = 760

export function useContainerWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200))
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const update = () => setWidth(el.getBoundingClientRect().width || window.innerWidth)
    update()
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', update); return () => window.removeEventListener('resize', update) }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

const PRINT_CSS = `@media print {
  .rc-reader-list, .rc-reader-noprint, #rc-sidebar, .rc-sidebar, .rc-menu-btn { display: none !important; }
  .rc-reader-grid { display: block !important; }
  .rc-reader-article { max-width: none !important; border: none !important; box-shadow: none !important; }
  details.rc-step { break-inside: avoid; }
  details.rc-step > summary { list-style: none; }
}`

/**
 * list: the item list; article: the reader (or editor); hasSelection: something chosen to read;
 * readerRequested: the user tapped an item (or arrived by a link), so narrow screens show the reader.
 */
export default function ReaderLayout({ list, article, hasSelection, readerRequested, onBack, backLabel = 'Back to the list', listLabel = 'List' }) {
  const [ref, width] = useContainerWidth()
  const narrow = width < NARROW
  const showReader = !narrow || (hasSelection && readerRequested)
  const showList = !narrow || !showReader
  useEffect(() => {
    if (narrow && readerRequested && ref.current) ref.current.scrollIntoView?.({ block: 'start' })
  }, [narrow, readerRequested, ref])
  return (
    <div ref={ref} className="rc-reader-grid" data-layout={narrow ? 'narrow' : 'wide'}
      style={narrow ? { display: 'block' } : { display: 'grid', gridTemplateColumns: 'minmax(230px, 300px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      <style>{PRINT_CSS}</style>
      {showList && (
        <aside className="rc-reader-list" aria-label={listLabel}
          style={{ ...s.card, padding: 12, ...(narrow ? {} : { position: 'sticky', top: 12, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto' }) }}>
          {list}
        </aside>
      )}
      {showReader && (
        <div style={{ minWidth: 0 }}>
          {narrow && (
            <button type="button" className="rc-reader-noprint" onClick={onBack} style={{ ...s.btn, ...s.ghost, marginBottom: 10 }}>← {backLabel}</button>
          )}
          {article}
        </div>
      )}
    </div>
  )
}

/** Article wrapper with a readable line length. */
export function ReaderArticle({ label, children }) {
  return <article className="rc-reader-article" aria-label={label} style={{ ...s.card, maxWidth: 860, padding: '18px 22px' }}>{children}</article>
}

/** A collapsible step / section. Native <details> keeps it keyboard- and screen-reader-friendly and prints open. */
export function ReaderSection({ title, badge, open, onToggle, children, id }) {
  return (
    <details className="rc-step" id={id} open={open} onToggle={(e) => onToggle?.(e.currentTarget.open)}
      style={{ borderTop: `1px solid ${C.border}`, padding: '10px 0' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 800, fontSize: 15, color: C.textStrong, display: 'flex', gap: 8, alignItems: 'center', listStyle: 'revert' }}>
        <span style={{ flex: 1 }}>{title}</span>
        {badge ? <span style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>{badge}</span> : null}
      </summary>
      <div style={{ marginTop: 8 }}>{children}</div>
    </details>
  )
}

/** Expand all / Collapse all / Print row. */
export function ReaderTools({ allOpen, onExpandAll, onCollapseAll }) {
  return (
    <div className="rc-reader-noprint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0 4px' }}>
      <button type="button" style={{ ...s.btn, ...s.ghost, padding: '5px 10px' }} onClick={allOpen ? onCollapseAll : onExpandAll}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
      <button type="button" style={{ ...s.btn, ...s.ghost, padding: '5px 10px' }} onClick={() => window.print()}>Print</button>
    </div>
  )
}
