import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Dashboards from './Dashboards'

const { data } = vi.hoisted(() => ({
  data: {
    exec_dashboard: { visits: { total: 120, opd: 100 }, beds: { total: 40, occupied: 38, cleaning: 1 }, emergency: null, billing: { billed: 500000, outstanding: 200000 },
      blood: [{ blood_group: 'O-', units: 1 }, { blood_group: 'A+', units: 6 }], maternity: { deliveries: 20, caesareans: 5, fresh_stillbirths: 1, maternal_deaths: 0 } },
    matron_dashboard: { wards: [{ ward: 'Medical', beds: 20, occupied: 19, cleaning: 0 }], observations: { high: 2, medium: 3, overdue: 4, not_escalated: 1 },
      deteriorating: [{ patient: 'Jane', bed: 'M4', scale: 'news2', score: 8, level: 'high', observed_at: new Date().toISOString(), escalated_to: null }] },
  },
}))
vi.mock('../supabase', () => ({
  default: {
    rpc: (fn) => (fn === 'claims_dashboard'
      ? Promise.resolve({ data: null, error: { message: 'Only administrators, finance and claims staff can see the claims dashboard' } })
      : Promise.resolve({ data: data[fn], error: null })),
  },
}))
vi.mock('../context', () => ({ useHospital: () => ({ hospitalId: 'h1' }) }))

describe('management dashboards', () => {
  it('shows executive figures, "—" for missing modules and low blood groups', async () => {
    render(<Dashboards />)
    expect(await screen.findByText('95%')).toBeTruthy()          // 38 of 40 beds
    expect(screen.getByText('O-')).toBeTruthy()                  // fewer than 2 units
    expect(screen.getByText('C/S 25% · 1 fresh stillbirths')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(3)   // emergency etc. not installed
  })
  it('matron view lists deteriorating patients; claims shows the access message', async () => {
    render(<Dashboards />)
    fireEvent.click(screen.getByRole('tab', { name: 'Matron / nursing' }))
    expect(await screen.findByText('Jane')).toBeTruthy()
    expect(screen.getByText(/not escalated/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Claims & receivables' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
