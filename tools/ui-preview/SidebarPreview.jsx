// The real menu (NAV_GROUPS + styles from App.jsx) inside a sidebar-sized box, for screenshots.
import { useState } from 'react'
import NavGroups from '../../src/components/NavGroups'
import { APP_STYLES, NAV_GROUPS } from '../../src/App'

const DEPARTMENTS = ['Outpatient (OPD)', 'Maternity', 'Paediatrics', 'IT & Systems']

export default function SidebarPreview() {
  const [path, setPath] = useState(new URLSearchParams(window.location.search).get('active') || '/laboratory')
  const groups = [
    ...NAV_GROUPS.map((g) => (g.label === 'OVERVIEW' ? { ...g, link: true } : g)),
    { label: 'DEPARTMENTS', divider: true, items: DEPARTMENTS.map((name) => ({ id: name, path: `/departments/${encodeURIComponent(name)}`, label: name })) },
  ]
  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <aside style={{ ...APP_STYLES.sidebar, height: '100vh' }} aria-label="Main menu">
        <div style={APP_STYLES.nav}>
          <NavGroups groups={groups} activePath={path} onNavigate={(item) => setPath(item.path)} />
        </div>
      </aside>
      <main style={{ padding: 24 }}>Current screen: {path}</main>
    </div>
  )
}
