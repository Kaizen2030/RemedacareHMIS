import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NavGroups, { filterNavGroups, initialOpenGroup, sectionTitle } from './NavGroups'

const GROUPS = [
  { label: 'OVERVIEW', link: true, items: [{ id: 'dashboard', path: '/dashboard', label: 'Dashboard' }] },
  { label: 'PATIENT CARE', items: [{ id: 'patients', path: '/patients', label: 'Patients' }, { id: 'consultation', path: '/consultation', label: 'Consultation' }, ...Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, path: `/p${i}`, label: `Patient screen ${i}` }))] },
  { label: 'DIAGNOSTICS', items: [{ id: 'lab', path: '/laboratory', label: 'Laboratory' }, { id: 'radiology', path: '/radiology', label: 'Radiology' }, { id: 'micro', path: '/microbiology', label: 'Microbiology surveillance' }] },
  { label: 'DEPARTMENTS', divider: true, items: [], emptyText: 'No departments added yet' },
]

beforeEach(() => { try { window.localStorage.clear() } catch { /* ignore */ } })

describe('main menu', () => {
  it('opens the section of the current screen, else the last one opened', () => {
    expect(initialOpenGroup(GROUPS, '/laboratory')).toBe('DIAGNOSTICS')
    expect(initialOpenGroup(GROUPS, '/nowhere', 'PATIENT CARE')).toBe('PATIENT CARE')
    expect(initialOpenGroup(GROUPS, '/nowhere', 'GONE')).toBe('')
    expect(sectionTitle('EMERGENCY & INPATIENT')).toBe('Emergency & inpatient')
  })

  it('filters across sections by screen or section name', () => {
    expect(filterNavGroups(GROUPS, 'micro').map((g) => g.items.map((i) => i.id))).toEqual([['micro']])
    expect(filterNavGroups(GROUPS, 'diagnostics')[0].items.length).toBe(3)
    expect(filterNavGroups(GROUPS, '')).toBe(GROUPS)
  })

  it('shows sections as headers with screens inside; one section open at a time; Dashboard is a top-level link', () => {
    const go = vi.fn()
    render(<NavGroups groups={GROUPS} activePath="/laboratory" onNavigate={go} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
    expect(go).toHaveBeenCalledWith(expect.objectContaining({ id: 'dashboard' }))
    expect(screen.getByRole('button', { name: 'Laboratory' }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('button', { name: 'Patients' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Patient care/ }))
    expect(screen.getByRole('button', { name: 'Patients' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Laboratory' })).toBeNull()
    expect(screen.getByRole('button', { name: /Diagnostics/ }).getAttribute('aria-expanded')).toBe('false')
    expect(window.localStorage.getItem('rc-nav-open-group')).toBe('PATIENT CARE')
    fireEvent.click(screen.getByRole('button', { name: /Departments/ }))
    expect(screen.getByText('No departments added yet')).toBeTruthy()
  })

  it('finds a screen by typing and opens it with Enter', () => {
    const go = vi.fn()
    render(<NavGroups groups={GROUPS} activePath="/laboratory" onNavigate={go} />)
    fireEvent.change(screen.getByLabelText('Find a screen in the menu'), { target: { value: 'radio' } })
    expect(screen.queryByRole('button', { name: 'Laboratory' })).toBeNull()
    fireEvent.keyDown(screen.getByLabelText('Find a screen in the menu'), { key: 'Enter' })
    expect(go).toHaveBeenCalledWith(expect.objectContaining({ id: 'radiology' }))
  })

  it('opens the section of a screen reached another way (e.g. Ctrl+K)', () => {
    const { rerender } = render(<NavGroups groups={GROUPS} activePath="/laboratory" onNavigate={() => {}} />)
    rerender(<NavGroups groups={GROUPS} activePath="/consultation" onNavigate={() => {}} />)
    expect(screen.getByRole('button', { name: 'Consultation' }).getAttribute('aria-current')).toBe('page')
  })
})
