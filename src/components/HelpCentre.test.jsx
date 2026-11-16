import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ROLE_GUIDES, guideForRole } from '../data/roleGuides'
import { DEFAULT_ROLE_PERMISSIONS } from '../access'
import { buildProblemTicket, clearRecentErrors, getRecentErrors, installErrorCapture, problemTicketText, recordAppError } from '../utils/problemReport'

const inserted = []
let insertError = null
vi.mock('../supabase', () => ({
  default: {
    from: (table) => ({
      insert: (row) => {
        inserted.push({ table, row })
        return { select: () => ({ single: () => Promise.resolve(insertError ? { data: null, error: insertError } : { data: { id: 'abcdef12-3456-7890-abcd-ef1234567890' }, error: null }) }) }
      },
    }),
  },
}))

const HelpCentre = (await import('./HelpCentre')).default
const BASE = { hospitalId: 'h1', screen: 'Laboratory', path: '/laboratory', role: 'Lab Scientist', userName: 'Jane Lab' }

beforeEach(() => { inserted.length = 0; insertError = null; clearRecentErrors() })

describe('role quick-start guides', () => {
  it('cover every built-in role and only point at screens that role can open', () => {
    for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS)) {
      expect(ROLE_GUIDES[role], role).toBeTruthy()
      const allowed = DEFAULT_ROLE_PERMISSIONS[role].screens
      for (const step of ROLE_GUIDES[role].steps) {
        if (!step.path || allowed.includes('*')) continue
        const base = '/' + step.path.split('/')[1]
        expect(allowed.includes(step.path) || allowed.includes(base), `${role}: ${step.title} → ${step.path}`).toBe(true)
      }
    }
  })

  it('falls back to a general guide for an unknown role', () => {
    expect(guideForRole('Gardener').role).toBe('Staff')
    expect(guideForRole('Nurse').steps.length).toBeGreaterThan(2)
  })

  it('shows the role guide and opens a screen from a step', () => {
    const onNavigate = vi.fn()
    render(<HelpCentre resolvedRole="Pharmacist" onNavigate={onNavigate} {...BASE} />)
    expect(screen.getByText('Review each patient card')).toBeTruthy()
    fireEvent.click(screen.getAllByText('Open')[0])
    expect(onNavigate).toHaveBeenCalledWith('/pharmacy')
  })
})

describe('report a problem', () => {
  it('builds an IT ticket with context and no form contents', () => {
    recordAppError(new Error('Failed to fetch'))
    recordAppError(new Error('Failed to fetch'))
    const row = buildProblemTicket({ ...BASE, kind: 'error', description: 'Save does nothing', blocking: true, appVersion: '1.0.2', online: false, userAgent: 'UA', errors: getRecentErrors() })
    expect(row).toMatchObject({ hospital_id: 'h1', department: 'it', kind: 'ticket', priority: 'emergency', source: 'report_button', location: 'Laboratory' })
    expect(row.details).toMatchObject({ category: 'HMIS (RemedacareHMS)', screen: 'Laboratory', role: 'Lab Scientist', online: false, blocking: true })
    expect(row.details.recent_errors).toEqual([expect.objectContaining({ message: 'Failed to fetch', count: 2 })])
    expect(problemTicketText(row)).toContain('Failed to fetch (×2)')
  })

  it('rejects incomplete reports with a readable message', () => {
    expect(() => buildProblemTicket({ ...BASE, kind: '', description: 'x x x x x' })).toThrow(/kind of problem/)
    expect(() => buildProblemTicket({ ...BASE, kind: 'slow', description: 'no' })).toThrow(/few words/)
  })

  it('captures window errors and unhandled rejections, keeping only the latest few', () => {
    const stop = installErrorCapture(window)
    for (let i = 0; i < 12; i++) window.dispatchEvent(new ErrorEvent('error', { message: `boom ${i}` }))
    const rejection = new Event('unhandledrejection'); rejection.reason = new Error('network down'); window.dispatchEvent(rejection)
    stop()
    const errs = getRecentErrors()
    expect(errs.length).toBe(8)
    expect(errs.at(-1).message).toBe('network down')
  })

  it('sends the report and shows a reference', async () => {
    render(<HelpCentre initialTab="report" resolvedRole="Lab Technician" {...BASE} />)
    fireEvent.change(screen.getByLabelText('What kind of problem?'), { target: { value: 'slow' } })
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: 'Results page takes a minute to open' } })
    fireEvent.click(screen.getByText('Send to IT'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('ABCDEF12'))
    expect(inserted[0]).toMatchObject({ table: 'service_requests', row: { department: 'it', priority: 'routine', requested_by_name: 'Jane Lab' } })
  })

  it('offers the text to copy when the report cannot be sent', async () => {
    insertError = { message: 'Failed to fetch' }
    render(<HelpCentre initialTab="report" resolvedRole="Nurse" {...BASE} online={false} />)
    fireEvent.change(screen.getByLabelText('What kind of problem?'), { target: { value: 'error' } })
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: 'Cannot save vitals' } })
    fireEvent.click(screen.getByText('Send to IT'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/offline/))
    expect(screen.getByLabelText('Report text to copy').value).toContain('Cannot save vitals')
  })

  it('has labelled fields and named buttons (axe)', async () => {
    const { container } = render(<HelpCentre initialTab="report" resolvedRole="Doctor" {...BASE} />)
    const r = await axe.run(container, { runOnly: { type: 'rule', values: ['label', 'select-name', 'button-name', 'aria-valid-attr', 'aria-required-attr'] } })
    expect(r.violations.map((v) => v.id)).toEqual([])
  })
})
