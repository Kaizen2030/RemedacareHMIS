// Main menu. Two clear levels:
//   • Sections (Patient care, Diagnostics, …): icon + larger bright title + chevron, full-width row.
//   • Screens inside a section: indented under the section title, smaller and softer, on a darker "drawer" with a
//     guide line on the left. The current screen is highlighted, and its section is marked even when closed.
// One section is open at a time (the menu stays short); the section of the current screen opens by itself.
// "Find a screen" searches every screen. Top-level links (Dashboard) look like sections, without a chevron.
import { useEffect, useMemo, useState } from 'react'

const STORE = 'rc-nav-open-group'
const readStore = () => { try { return window.localStorage.getItem(STORE) || '' } catch { return '' } }
const writeStore = (v) => { try { window.localStorage.setItem(STORE, v) } catch { /* private window: not remembered */ } }

const ICON_PATHS = {
  OVERVIEW: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  'PATIENT CARE': 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  'EMERGENCY & INPATIENT': 'M3 18V6 M3 14h18v4 M21 14v-1a3 3 0 0 0-3-3h-8v4 M6.5 10.5a1.5 1.5 0 1 0 0 .01',
  DIAGNOSTICS: 'M9 3h6 M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3 M7.5 14h9',
  PHARMACY: 'M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7z M8.5 8.5l7 7',
  'BILLING & FINANCE': 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 10h18 M7 15h3',
  'HOSPITAL MANAGEMENT': 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16 M16 9h2a2 2 0 0 1 2 2v10 M3 21h18 M8 7h4 M8 11h4 M8 15h4',
  SYSTEM: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9 7 7 M17 17l2.1 2.1 M4.9 19.1 7 17 M17 7l2.1-2.1',
  DEPARTMENTS: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
}
const FALLBACK_ICON = 'M5 5h14v14H5z'

function Icon({ name }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={ICON_PATHS[name] || FALLBACK_ICON} />
    </svg>
  )
}

/** "EMERGENCY & INPATIENT" → "Emergency & inpatient" */
export const sectionTitle = (label) => String(label).charAt(0) + String(label).slice(1).toLowerCase()

// Solid colours only (no transparency) so every label is fully visible on the green sidebar.
const C = {
  header: { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', background: 'transparent', color: '#FFFFFF', fontSize: 14, fontWeight: 700, textAlign: 'left', cursor: 'pointer', borderRadius: 8, fontFamily: 'inherit' },
  headerOpen: { background: '#033D2D', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  headerHasCurrent: {},
  headerActiveLink: { background: '#FFFFFF', color: '#075A44' },
  drawer: { background: '#033D2D', borderBottomLeftRadius: 8, borderBottomRightRadius: 8, padding: '2px 0 8px' },
  guide: { marginLeft: 22, borderLeft: '2px solid #9FE1CB' },
  item: { width: '100%', display: 'block', padding: '8px 10px 8px 16px', border: 'none', background: 'transparent', color: '#FFFFFF', fontSize: 13, fontWeight: 500, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.35, borderRadius: '0 6px 6px 0' },
  itemActive: { color: '#075A44', fontWeight: 800, background: '#FFFFFF' },
  dot: { width: 8, height: 8, borderRadius: 4, background: '#FACC15', flexShrink: 0 },
  search: { width: '100%', boxSizing: 'border-box', background: '#033D2D', border: '2px solid #9FE1CB', borderRadius: 8, color: '#FFFFFF', padding: '8px 10px', fontSize: 13, outline: 'none', fontFamily: 'inherit' },
  divider: { height: 2, background: '#9FE1CB', margin: '10px 14px' },
  muted: { padding: '8px 10px 8px 16px', color: '#FFFFFF', fontSize: 12.5, fontStyle: 'italic' },
}

/** Which section starts open: the one holding the current screen, else the one last opened on this computer. */
export function initialOpenGroup(groups, activePath, remembered = '') {
  const current = groups.find((g) => g.items.some((i) => i.path === activePath))
  if (current) return current.label
  return groups.some((g) => g.label === remembered) ? remembered : ''
}

export function filterNavGroups(groups, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return groups
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => `${i.label} ${g.label}`.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length > 0)
}

/**
 * groups: [{ label, items: [{ id, path, label }], link?: true, divider?: true, loading?: true, emptyText? }]
 * A group with link: true and one item is a top-level link (e.g. Dashboard).
 */
export default function NavGroups({ groups, activePath, onNavigate }) {
  const [open, setOpen] = useState(() => initialOpenGroup(groups, activePath, readStore()))
  const [query, setQuery] = useState('')
  const total = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups])
  useEffect(() => {
    const g = groups.find((x) => !x.link && x.items.some((i) => i.path === activePath))
    if (g) setOpen(g.label)
  }, [activePath, groups])
  const toggle = (label) => setOpen((o) => { const next = o === label ? '' : label; writeStore(next); return next })
  const searching = Boolean(query.trim())
  const shown = filterNavGroups(groups, query)
  const first = shown.flatMap((g) => g.items)[0]

  return (
    <nav aria-label="Screens" style={{ padding: '0 8px' }}>
      <style>{'.rc-nav-search::placeholder{color:#FFFFFF;opacity:1}'}</style>
      {total > 10 && (
        <div style={{ padding: '4px 4px 10px' }}>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a screen…" aria-label="Find a screen in the menu" className="rc-nav-search" style={C.search}
            onKeyDown={(e) => { if (e.key === 'Enter' && first) { onNavigate(first); setQuery('') } if (e.key === 'Escape') setQuery('') }} />
        </div>
      )}
      {shown.map((group) => {
        const hasCurrent = group.items.some((i) => i.path === activePath)
        if (group.link && !searching) {
          const item = group.items[0]
          return (
            <div key={group.label} style={{ marginBottom: 2 }}>
              <button type="button" aria-current={hasCurrent ? 'page' : undefined} onClick={() => onNavigate(item)} style={{ ...C.header, ...(hasCurrent ? C.headerActiveLink : {}) }}>
                <Icon name={group.label} /><span style={{ flex: 1 }}>{item.label}</span>
              </button>
            </div>
          )
        }
        const isOpen = searching || open === group.label
        const panelId = `rc-nav-${group.label.replace(/\W+/g, '-').toLowerCase()}`
        return (
          <div key={group.label} style={{ marginBottom: 2 }}>
            {group.divider && !searching && <div style={C.divider} aria-hidden="true" />}
            <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(group.label)} disabled={searching}
              style={{ ...C.header, ...(hasCurrent ? C.headerHasCurrent : {}), ...(isOpen ? C.headerOpen : {}), cursor: searching ? 'default' : 'pointer' }}>
              <Icon name={group.label} />
              <span style={{ flex: 1 }}>{sectionTitle(group.label)}</span>
              {hasCurrent && !isOpen && <span style={C.dot} title="The screen you are on is in this section" />}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
                style={{ flexShrink: 0, transition: 'transform .15s', transform: isOpen ? 'rotate(90deg)' : 'none' }}><path d="M9 6l6 6-6 6" /></svg>
            </button>
            {isOpen && (
              <div id={panelId} style={C.drawer}>
                <div style={C.guide}>
                  {group.loading && <div style={C.muted}>Loading…</div>}
                  {!group.loading && group.items.map((item) => {
                    const active = activePath === item.path
                    return (
                      <button key={item.id} type="button" aria-current={active ? 'page' : undefined} style={{ ...C.item, ...(active ? C.itemActive : {}) }}
                        onClick={() => { onNavigate(item); if (searching) setQuery('') }}>
                        {item.label}
                      </button>
                    )
                  })}
                  {!group.loading && group.items.length === 0 && <div style={C.muted}>{group.emptyText || 'Nothing here yet'}</div>}
                </div>
              </div>
            )}
          </div>
        )
      })}
      {searching && shown.length === 0 && <div style={{ ...C.muted, padding: '8px 14px' }}>No screen matches “{query}”.</div>}
    </nav>
  )
}
