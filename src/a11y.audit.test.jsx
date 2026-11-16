// Accessibility / usability audit of the busiest screens with axe-core. Each screen renders against an empty database;
// the test fails if a screen has form fields without a label, buttons or links without a name, duplicate ids, or other
// serious axe violations. Colour contrast is not checked here (jsdom has no layout).
import { fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import axe from 'axe-core'
import { describe, expect, it, vi } from 'vitest'
import { HospitalContext } from './context'

vi.mock('./supabase', () => {
  const q = () => {
    const o = {}
    for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'ilike', 'like', 'or', 'not', 'order', 'limit', 'range', 'match', 'filter', 'contains', 'textSearch', 'insert', 'update', 'upsert', 'delete']) o[m] = () => o
    o.single = () => Promise.resolve({ data: null, error: null })
    o.maybeSingle = () => Promise.resolve({ data: null, error: null })
    o.then = (res, rej) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej)
    return o
  }
  const channel = () => { const c = { on: () => c, subscribe: () => c, unsubscribe: () => {} }; return c }
  return { default: {
    from: q, rpc: () => q(), channel, removeChannel: () => {},
    auth: { getSession: () => Promise.resolve({ data: { session: null } }), getUser: () => Promise.resolve({ data: { user: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({ upload: () => Promise.resolve({}), createSignedUrl: () => Promise.resolve({ data: null }), remove: () => Promise.resolve({}) }) },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  } }
})

const CONTEXT = { hospitalId: '11111111-1111-1111-1111-111111111111', hospitalName: 'Test Hospital', userRole: 'Admin', departments: [], navigate: () => {},
  navigationState: null, clearNavigationState: () => {}, hospitalProfile: {} }

const SCREENS = {
  Patients: () => import('./screens/Patients'),
  Consultation: () => import('./screens/consultation'),
  Pharmacy: () => import('./screens/pharmacy'),
  Billing: () => import('./screens/Billing'),
  Laboratory: () => import('./screens/Laboratory'),
  Wards: () => import('./screens/Wards'),
  Appointments: () => import('./screens/Appointments'),
  CarePathways: () => import('./screens/CarePathways'),
  ClinicalReferences: () => import('./screens/ClinicalReferences'),
}
const RULES = ['label', 'select-name', 'button-name', 'link-name', 'image-alt', 'duplicate-id-aria', 'aria-valid-attr', 'aria-required-attr', 'list', 'listitem', 'nested-interactive']

export async function audit(container) {
  const r = await axe.run(container, { runOnly: { type: 'rule', values: RULES }, resultTypes: ['violations'] })
  return r.violations.map((v) => ({ rule: v.id, count: v.nodes.length, examples: v.nodes.slice(0, 6).map((n) => { const el = container.querySelector(n.target[0]); return el?.tagName === 'SELECT' ? 'select: ' + [...el.options].slice(0, 3).map((o) => o.text).join(' | ') : n.html.slice(0, 140) }) }))
}

describe('accessibility audit of the busiest screens', () => {
  for (const [name, load] of Object.entries(SCREENS)) {
    it(`${name} has no unlabelled fields, unnamed buttons or other serious problems`, async () => {
      const Screen = (await load()).default
      const { container } = render(<HospitalContext.Provider value={CONTEXT}><MemoryRouter><Screen /></MemoryRouter></HospitalContext.Provider>)
      await waitFor(() => expect(container.innerHTML.length).toBeGreaterThan(200))
      await new Promise((r) => setTimeout(r, 50))
      const v = await audit(container)
      if (v.length) console.log(`\n[a11y] ${name}:\n` + v.map((x) => `  ${x.rule} ×${x.count}\n    ${x.examples.join('\n    ')}`).join('\n'))
      expect(v.map((x) => `${x.rule} ×${x.count}`)).toEqual([])
    }, 30000)

    it(`${name}: the forms behind its New / Register / Add / Create buttons are labelled`, async () => {
      const Screen = (await load()).default
      const first = render(<HospitalContext.Provider value={CONTEXT}><MemoryRouter><Screen /></MemoryRouter></HospitalContext.Provider>)
      await waitFor(() => expect(first.container.innerHTML.length).toBeGreaterThan(200))
      const labels = [...first.container.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /^[+＋]?\s*(new|register|add|create|order|admit|record)\b/i.test(t)).slice(0, 4)
      first.unmount()
      const problems = []
      for (const text of [...new Set(labels)]) {
        const { container, unmount } = render(<HospitalContext.Provider value={CONTEXT}><MemoryRouter><Screen /></MemoryRouter></HospitalContext.Provider>)
        await waitFor(() => expect(container.innerHTML.length).toBeGreaterThan(200))
        const button = [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
        if (button && !button.disabled) {
          fireEvent.click(button)
          await new Promise((r) => setTimeout(r, 50))
          for (const x of await audit(container)) problems.push({ form: text, ...x })
        }
        unmount()
      }
      if (problems.length) console.log(`\n[a11y forms] ${name}:\n` + problems.map((x) => `  "${x.form}" → ${x.rule} ×${x.count}\n    ${x.examples.join('\n    ')}`).join('\n'))
      expect(problems.map((x) => `"${x.form}": ${x.rule} ×${x.count}`)).toEqual([])
    }, 60000)
  }
})
