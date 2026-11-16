// UI preview: renders one screen with fake (empty) data and no login, for screenshots and visual review.
//   npx vite --config tools/ui-preview/vite.config.mjs   then open  http://localhost:5199/?screen=CarePathways
import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { HospitalContext } from '../../src/context'
import { PREVIEW_DB } from './previewData'

// ?data=1 fills the fake database with the fictional sample isolates
if (new URLSearchParams(window.location.search).get('data')) window.__PREVIEW_DB__ = PREVIEW_DB

const SCREENS = {
  CarePathways: lazy(() => import('../../src/screens/CarePathways')),
  ClinicalReferences: lazy(() => import('../../src/screens/ClinicalReferences')),
  Patients: lazy(() => import('../../src/screens/Patients')),
  Billing: lazy(() => import('../../src/screens/Billing')),
  Sidebar: lazy(() => import('./SidebarPreview')),
  Antibiogram: lazy(() => import('../../src/screens/Antibiogram')),
  Login: lazy(() => import('../../src/screens/Login')),
  Department: lazy(() => import('../../src/screens/department').then((m) => ({ default: () => <m.default department={new URLSearchParams(window.location.search).get('dept') || 'Cardiology'} onBack={() => {}} /> }))),
}
const params = new URLSearchParams(window.location.search)
const Screen = SCREENS[params.get('screen')] || SCREENS.CarePathways
const CONTEXT = { hospitalId: '11111111-1111-1111-1111-111111111111', hospitalName: 'Preview Hospital', userRole: 'Admin', departments: [], navigate: () => {},
  navigationState: null, clearNavigationState: () => {}, hospitalProfile: {} }

ReactDOM.createRoot(document.getElementById('root')).render(
  <HospitalContext.Provider value={CONTEXT}>
    <MemoryRouter initialEntries={[params.get('path') || '/']}>
      <Suspense fallback={<p>Loading…</p>}><Screen /></Suspense>
    </MemoryRouter>
  </HospitalContext.Provider>,
)
