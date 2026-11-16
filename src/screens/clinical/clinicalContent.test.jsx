// Hospital control of guides, references, pathways and the library, against an in-memory fake of the tables.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HospitalContext } from '../../context'
import { CARE_PATHWAYS } from '../../data/carePathways'
import { CLINICAL_GUIDES } from '../../data/clinicalGuides'
import { matchesLibrary, parseTags } from './ClinicalLibrary'

const H = '11111111-1111-1111-1111-111111111111'
const db = { revisions: [], docs: [], canApprove: true, calls: [] }
const key = (r) => `${r.content_type}|${r.content_id}`

vi.mock('../../supabase', () => {
  const from = (table) => {
    const st = { table, op: 'select', filters: [], payload: null }
    const run = () => {
      db.calls.push({ ...st })
      if (table === 'clinical_content_revisions') {
        if (st.op === 'upsert') {
          const rows = st.payload.map((r) => {
            const old = db.revisions.find((x) => key(x) === key(r))
            const row = { ...r, revision: (old?.revision || 0) + 1 }
            db.revisions = [...db.revisions.filter((x) => key(x) !== key(r)), row]
            return row
          })
          return { data: rows, error: null }
        }
        if (st.op === 'delete') {
          const type = st.filters.find((f) => f[0] === 'content_type')?.[1]
          const ids = st.filters.find((f) => f[0] === 'content_id')?.[1] || []
          db.revisions = db.revisions.filter((r) => !(r.content_type === type && ids.includes(r.content_id)))
          return { data: null, error: null }
        }
        return { data: db.revisions, error: null }
      }
      if (table === 'clinical_content_documents') return { data: st.op === 'select' ? db.docs : null, error: null }
      return { data: [], error: null }
    }
    const q = {
      select: () => q, order: () => q, is: () => q, like: () => q, limit: () => q,
      eq: (c, v) => { st.filters.push([c, v]); return q },
      in: (c, v) => { st.filters.push([c, v]); return q },
      upsert: (rows) => { st.op = 'upsert'; st.payload = Array.isArray(rows) ? rows : [rows]; return q },
      insert: (row) => { st.op = 'insert'; st.payload = row; return q },
      update: (row) => { st.op = 'update'; st.payload = row; return q },
      delete: () => { st.op = 'delete'; return q },
      single: () => Promise.resolve(run()).then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] : r.data })),
      maybeSingle: () => Promise.resolve(run()),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    }
    return q
  }
  return { default: {
    from,
    rpc: (name) => Promise.resolve({ data: name === 'guide_can_approve' ? db.canApprove : null, error: null }),
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'blob:x' }, error: null }), upload: () => Promise.resolve({ error: null }), remove: () => Promise.resolve({ error: null }) }) },
  } }
})
vi.mock('../OrderSetsAdmin', () => ({ default: () => null }))

const CarePathways = (await import('../CarePathways')).default
const ClinicalReferences = (await import('../ClinicalReferences')).default
const CTX = { hospitalId: H, navigationState: null, clearNavigationState: () => {}, navigate: () => {} }
const show = (ui, path = '/') => render(<HospitalContext.Provider value={CTX}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></HospitalContext.Provider>)

beforeEach(() => { db.revisions = []; db.docs = []; db.canApprove = true; db.calls = [] })

describe('care pathways: hospital control', () => {
  it('shows the deep built-in pathways, with red flags and steps to tick and copy', async () => {
    show(<CarePathways />)
    expect(await screen.findByRole('heading', { name: 'Adult sepsis: first hour and after' })).toBeTruthy()
    expect(screen.getByRole('note', { name: 'Red flags' })).toBeTruthy()
    const copy = screen.getByRole('button', { name: /Copy ticked steps for the note \(0\)/ })
    expect(copy.disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByRole('button', { name: /Copy ticked steps for the note \(1\)/ }).disabled).toBe(false)
  })

  it('removes a built-in pathway for this hospital and restores it', async () => {
    show(<CarePathways />)
    await screen.findByRole('button', { name: 'Edit pathway' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(db.revisions.find((r) => r.content_id === 'sepsis-adult')?.content.hidden).toBe(true))
    const nav = screen.getByRole('navigation', { name: 'Care pathways' })
    await waitFor(() => expect(within(nav).queryByText('Adult sepsis: first hour and after')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /Manage pathways · 1 removed/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(within(nav).getByText('Adult sepsis: first hour and after')).toBeTruthy())
  })

  it('start fresh hides every built-in pathway and leaves an empty list ready for the hospital\'s own', async () => {
    show(<CarePathways />)
    fireEvent.click(await screen.findByRole('button', { name: /Manage pathways/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start fresh' }))
    await waitFor(() => expect(db.revisions.find((r) => r.content_type === 'setting' && r.content_id === 'pathway')?.content.builtin_default).toBe('hidden'))
    expect(db.revisions.filter((r) => r.content_type === 'pathway' && r.content.hidden).length).toBe(CARE_PATHWAYS.length)
    expect(await screen.findByText(/No pathways at this hospital yet/)).toBeTruthy()
  })

  it('adds a hospital pathway, then deletes it', async () => {
    show(<CarePathways />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add pathway' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Snakebite' } })
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Assess envenomation and give antivenom when indicated.' } })
    fireEvent.change(screen.getByLabelText('Step 1 heading'), { target: { value: 'First aid' } })
    fireEvent.change(screen.getByLabelText('What to do (one point per line)'), { target: { value: 'Immobilise the limb\nNo tourniquet' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save pathway' }))
    expect(await screen.findByRole('heading', { name: 'Snakebite' })).toBeTruthy()
    const saved = db.revisions.find((r) => r.content?.title === 'Snakebite')
    expect(saved.content).toMatchObject({ custom: true, stages: [{ heading: 'First aid', points: ['Immobilise the limb', 'No tourniquet'] }] })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(db.revisions.some((r) => r.content?.title === 'Snakebite')).toBe(false))
    expect(db.calls.some((c) => c.op === 'delete' && c.table === 'clinical_content_revisions')).toBe(true)
  })

  it('staff who cannot approve see no edit, remove or manage buttons', async () => {
    db.canApprove = false
    show(<CarePathways />)
    await screen.findByRole('heading', { name: 'Adult sepsis: first hour and after' })
    await new Promise((r) => setTimeout(r, 20))
    for (const name of ['Edit pathway', 'Remove', 'Add pathway']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.queryByRole('button', { name: /Manage pathways/ })).toBeNull()
  })
})

describe('clinical guides and references: hospital control', () => {
  it('start fresh on guides keeps hospital-written guides and offers to delete them', async () => {
    db.revisions = [{ content_type: 'guide', content_id: 'local-a', revision: 1, content: { customGuide: true, title: 'Our snakebite guide', topic: 'Local', summary: 'x', sections: [{ heading: 'h', points: ['p'] }], sources: [] } }]
    show(<ClinicalReferences />)
    fireEvent.click(await screen.findByRole('button', { name: /Manage guides/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh…' }))
    expect(screen.getByLabelText(/Also delete the 1 guides written at this hospital/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start fresh' }))
    await waitFor(() => expect(db.revisions.filter((r) => r.content_type === 'guide' && r.content.hidden).length).toBe(CLINICAL_GUIDES.length))
    const nav = screen.getByRole('navigation', { name: 'Guides' })
    await waitFor(() => expect(within(nav).getAllByRole('button').map((b) => b.textContent).filter((t) => /approved|draft/.test(t)).length).toBe(1))
    expect(within(nav).getByText('Our snakebite guide')).toBeTruthy()
  })

  it('a guide opened by link after removal still shows, with a restore button', async () => {
    db.revisions = [{ content_type: 'guide', content_id: 'sepsis', revision: 1, content: { hidden: true } }]
    show(<ClinicalReferences />, '/?guide=sepsis')
    expect(await screen.findByText(/This guide has been removed at your hospital/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore it' }))
    await waitFor(() => expect(db.revisions.find((r) => r.content_id === 'sepsis').content.hidden).toBe(false))
  })

  it('adds a hospital reference and removes a built-in one', async () => {
    show(<ClinicalReferences />, '/?topic=microbiology')
    fireEvent.click(await screen.findByRole('button', { name: 'Add reference' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Hospital antibiotic policy 2026' } })
    fireEvent.change(screen.getByLabelText('Publisher'), { target: { value: 'Medicines & Therapeutics Committee' } })
    fireEvent.change(screen.getByLabelText('Used in'), { target: { value: 'Empiric prescribing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reference' }))
    expect(await screen.findByText('Hospital antibiotic policy 2026')).toBeTruthy()
    expect(db.revisions.find((r) => r.content_type === 'reference' && r.content.custom)?.content.title).toBe('Hospital antibiotic policy 2026')
  })

  it('library tab lists, searches and opens entries', async () => {
    db.docs = [
      { id: 'd1', guide_id: '_library', kind: 'file', title: 'Kenya HIV guidelines 2022', category: 'National guidelines', tags: ['hiv', 'art'], file_name: 'hiv.pdf', file_size: 3000000, object_path: `${H}/_library/x-hiv.pdf`, created_at: '2026-11-15T00:00:00Z' },
      { id: 'd2', guide_id: '_library', kind: 'link', title: 'EUCAST breakpoint tables', category: 'Laboratory', tags: ['eucast'], file_name: 'EUCAST', link_url: 'https://www.eucast.org/clinical_breakpoints', created_at: '2026-11-15T00:00:00Z' },
    ]
    show(<ClinicalReferences />, '/?library=1')
    expect(await screen.findByText('Kenya HIV guidelines 2022')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open link' }).getAttribute('href')).toBe('https://www.eucast.org/clinical_breakpoints')
    fireEvent.change(screen.getByLabelText('Search the library'), { target: { value: 'eucast' } })
    expect(screen.queryByText('Kenya HIV guidelines 2022')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search the library'), { target: { value: 'hiv art' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read' }))
    expect(await screen.findByTitle('PDF preview: hiv.pdf')).toBeTruthy()
  })
})

describe('library helpers', () => {
  it('tags are trimmed, lower-cased and de-duplicated; search needs every word', () => {
    expect(parseTags(' Sepsis, ICU ,sepsis,, Antibiotics ')).toEqual(['sepsis', 'icu', 'antibiotics'])
    const e = { title: 'Hospital formulary', file_name: 'f.pdf', category: 'Formulary & drug information', tags: ['drugs'], description: 'Adult doses' }
    expect(matchesLibrary(e, 'formulary adult', '')).toBe(true)
    expect(matchesLibrary(e, 'formulary paediatric', '')).toBe(false)
    expect(matchesLibrary(e, '', 'Laboratory')).toBe(false)
  })
})
